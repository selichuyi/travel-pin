import {
  loadData,
  saveData,
  exportJson,
  parseImport,
  resetToSample,
  clearAllTravelStorage,
  computeStats,
  getJourneyPath,
  daysBetween,
  normalizeDateString,
  normalizeDateListString,
  SEGMENT_JOIN,
  resolveDays,
  linkDataFile,
  isFileLinked,
  getLinkedFileName,
  ensureTagMigration,
  loadTagRegistry
} from './data.js?v=86';
import { initTheme, toggleTheme } from './theme.js?v=86';
import { initMap2D, refreshMap2D, flyTo, geocodePlace } from './map2d.js?v=86';
import { initMap3D, refreshMap3D, isMap3DReady } from './map3d.js?v=86';
import { renderStats } from './stats.js?v=86';
import {
  initSidebar,
  filterPlaces,
  filterJourneys,
  setListYear
} from './sidebar.js?v=86';
import { initTimeline } from './timeline.js?v=86';
import {
  initDrawer,
  initModal,
  openPlace,
  openJourney,
  closeDrawer,
  openPlaceForm,
  openJourneyForm
} from './editor.js?v=87';
import {
  isLocalDev,
  isEditMode,
  getToken,
  setToken,
  clearToken,
  apiAuthorize
} from './auth.js?v=86';

const state = {
  data: { places: [], journeys: [] },
  mode: '2d',
  year: 'all',
  selected: null,
  sidebar: null,
  timeline: null,
  drawerApi: null,
  modalApi: null,
  map2d: null,
  map3d: null,
  map3dInit: false,
  filters: {
    year: 'all',
    continent: 'all',
    tag: 'all',
    query: ''
  }
};

function $(sel) {
  return document.querySelector(sel);
}

async function boot() {
  initTheme();
  applyAuthState();

  try {
    state.data = await loadData();
    // 首次运行：旧标签归并到 长居/旅行/文化 三个初始标签
    if (ensureTagMigration(state.data)) saveData(state.data);
  } catch (err) {
    console.warn('boot loadData failed', err);
    state.data = { places: [], journeys: [] };
  }

  state.sidebar = initSidebar($('#side-panel'), {
    onSelect: handleSelect,
    onFilter: handleFilter,
    onNewJourney: () => openJourneyForm(null, state.data.places),
    onNewPlace: () => openPlaceForm({ journeys: state.data.journeys })
  });
  state.timeline = initTimeline($('#timeline'), handleYearSelect);
  state.drawerApi = initDrawer($('#drawer'), {
    onClose: () => {
      state.selected = null;
      syncMap();
    },
    onEdit: (place) => openPlaceForm({ place, journeys: state.data.journeys }),
    onDeletePlace: deletePlace,
    onEditJourney: (j) => openJourneyForm(j, state.data.places),
    onDeleteJourney: deleteJourney,
    onMoveJourneyPlace: moveJourneyPlace,
    onNewPlaceForJourney: (j) =>
      openPlaceForm({ journeys: state.data.journeys, journeyId: j.id })
  });
  state.modalApi = initModal($('#modal'), {
    onSavePlace: savePlaceForm,
    // journey saved via same form reader — handled in savePlaceForm by kind
  });

  // Patch modal save to also handle journeys
  // initModal already calls handlers.onSavePlace; we intercept both in savePlaceForm

  wireChrome();
  $('#btn-file-link')?.classList.toggle('is-active', isFileLinked());
  try {
    ensureMap2D();
  } catch (err) {
    console.error('2D map boot failed', err);
    $('#map2d-loading').textContent = '地图启动失败，请刷新页面';
  }
  renderAll();
  maybeShowHint();

  // Force map data/labels sync a few times after boot (map ready can race)
  let syncTries = 0;
  const syncTimer = setInterval(() => {
    syncMap({ fit: syncTries === 0 });
    syncTries += 1;
    if (syncTries >= 6) clearInterval(syncTimer);
  }, 250);
}

function wireChrome() {
  $('#btn-theme').addEventListener('click', () => {
    const next = toggleTheme();
    $('#btn-theme').classList.toggle('is-active', next === 'light');
    // map2d updates paint on travel-theme; re-push once more as a safety net
    requestAnimationFrame(() => {
      syncMap({ fit: false });
    });
  });

  $('#btn-mode-2d').addEventListener('click', () => setMode('2d'));
  $('#btn-mode-3d').addEventListener('click', () => setMode('3d'));

  $('#btn-panel').addEventListener('click', () => {
    $('#stage').classList.toggle('is-panel-collapsed');
    setTimeout(() => state.map2d?.resize?.(), 280);
  });

  $('#btn-file-link').addEventListener('click', async () => {
    const r = await linkDataFile();
    if (r.ok) {
      toast(`已关联 ${r.name}，之后保存会自动写回该文件`);
    } else if (r.reason === 'unsupported') {
      toast('当前浏览器不支持直接写文件（可用「导出 JSON」手动保存）');
    } else if (r.reason === 'error') {
      toast('关联失败，请重试');
    }
    // cancel：用户放弃授权，不提示
  });

  document.addEventListener('travel-file-link', (e) => {
    $('#btn-file-link')?.classList.toggle('is-active', !!e.detail?.ok);
  });

  document.addEventListener('travel-file-write-failed', (e) => {
    setTimeout(() => {
      toast(e.detail?.message || '写回本地文件失败');
    }, 2400);
  });

  document.addEventListener('travel-file-link-hint', () => {
    setTimeout(() => {
      toast('数据已保存到浏览器，点顶栏「文件」按钮可关联本地 data/travel.json');
    }, 2400);
  });

  $('#btn-save-local')?.addEventListener('click', async () => {
    if (!isEditMode()) {
      toast('请先点顶栏锁图标登录，再保存');
      openAuthModal();
      return;
    }
    const payload = { ...state.data, tags: loadTagRegistry() };
    const headers = { 'Content-Type': 'application/json' };
    // 线上附加 Bearer token;本地 serve.py 免鉴权
    if (!isLocalDev() && getToken()) {
      headers.Authorization = `Bearer ${getToken()}`;
    }
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(out.error || `HTTP ${res.status}`);
        err.code = res.status;
        throw err;
      }
      toast(
        isLocalDev()
          ? `已保存到本地 travel.json（${out.places} 个地点）`
          : `已保存到线上数据（${out.places} 个地点）`
      );
    } catch (err) {
      if (err?.code === 401 && !isLocalDev()) {
        clearToken();
        applyAuthState();
        toast('登录已过期，请重新输入密码');
        openAuthModal();
      } else {
        toast(`保存失败：${err?.message || err}`);
      }
    }
  });

  $('#btn-export').addEventListener('click', () => {
    exportJson(state.data);
    toast('已导出 JSON 备份');
  });

  $('#btn-import').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        state.data = parseImport(text);
        saveData(state.data);
        state.selected = null;
        closeDrawer();
        renderAll();
        syncMap({ fit: true });
        toast('已导入数据');
      } catch {
        toast('导入失败：JSON 无效');
      }
    });
    input.click();
  });

  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('恢复为内置示例足迹（示例·东京、示例·巴黎）？当前数据将被覆盖。')) {
      return;
    }
    clearAllTravelStorage();
    state.data = resetToSample();
    state.selected = null;
    closeDrawer();
    renderAll();
    syncMap({ fit: true });
    toast('已恢复默认足迹数据');
  });

  $('#btn-new-journey')?.addEventListener('click', () => {
    openJourneyForm(null, state.data.places);
  });

  $('#btn-auth')?.addEventListener('click', () => {
    if (isEditMode()) {
      if (isLocalDev()) {
        toast('本地开发模式：始终可编辑，无需登录');
        return;
      }
      if (confirm('退出编辑模式？')) {
        clearToken();
        applyAuthState();
        toast('已退出编辑模式');
      }
      return;
    }
    openAuthModal();
  });

  $('#auth-close')?.addEventListener('click', closeAuthModal);
  $('#auth-cancel')?.addEventListener('click', closeAuthModal);
  $('#auth-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAuthModal();
  });
  $('#auth-pass')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAuthModal();
  });
  $('#auth-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = $('#auth-pass').value;
    const submit = $('#auth-submit');
    const errorEl = $('#auth-error');
    submit.disabled = true;
    submit.textContent = '验证中…';
    errorEl.hidden = true;
    try {
      const token = await apiAuthorize(pass);
      setToken(token);
      closeAuthModal();
      applyAuthState();
      toast('已进入编辑模式');
    } catch (err) {
      errorEl.textContent =
        err?.code === 429
          ? '尝试过于频繁，请稍后再试'
          : err instanceof TypeError
            ? '写接口不可达（检查 auth.js 中的 API_BASE 是否已配置）'
            : '密码错误，请重试';
      errorEl.hidden = false;
      $('#auth-pass').value = '';
      $('#auth-pass').focus();
    } finally {
      submit.disabled = false;
      submit.textContent = '登录';
    }
  });

  window.addEventListener('map2d-ready', () => {
    $('#map2d-loading')?.classList.add('is-hidden');
    syncMap({ fit: true });
    // second pass: labels + pins after styles settle
    setTimeout(() => syncMap({ fit: false }), 150);
  });

  window.addEventListener('map3d-ready', () => {
    syncMap({ fit: true });
  });
}

function applyAuthState() {
  const edit = isEditMode();
  document.body.classList.toggle('is-readonly', !edit);
  const btn = $('#btn-auth');
  if (btn) {
    btn.classList.toggle('is-active', edit);
    btn.title = isLocalDev() ? '本地开发模式' : edit ? '当前为编辑模式（点击退出）' : '进入编辑模式';
  }
  if (!isLocalDev()) {
    $('#btn-save-local')?.setAttribute(
      'title',
      edit ? '保存到线上数据（GitHub）' : '保存到线上数据'
    );
  }
}

function openAuthModal() {
  if (isLocalDev()) return;
  $('#auth-error')?.setAttribute('hidden', '');
  $('#auth-pass').value = '';
  $('#auth-modal')?.classList.add('is-open');
  setTimeout(() => $('#auth-pass')?.focus(), 60);
}

function closeAuthModal() {
  $('#auth-modal')?.classList.remove('is-open');
}

function ensureMap2D() {
  if (state.map2d) return;
  state.map2d = initMap2D($('#map2d'), {
    onSelect: (props) => {
      handleSelect({ type: 'place', id: props.id });
    }
  });
}

function ensureMap3D() {
  if (state.map3d) return;
  state.map3d = initMap3D($('#map3d'), {
    onSelect: (p) => {
      handleSelect({ type: 'place', id: p.id });
    }
  });
  state.map3dInit = true;
}

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  const area = $('#map-area');
  area.classList.toggle('is-3d', mode === '3d');
  $('#btn-mode-2d').classList.toggle('is-active', mode === '2d');
  $('#btn-mode-3d').classList.toggle('is-active', mode === '3d');

  if (mode === '3d') {
    ensureMap3D();
    setTimeout(() => {
      state.map3d?.resize?.();
      syncMap({ fit: true });
    }, 50);
  } else {
    setTimeout(() => {
      state.map2d?.resize?.();
      syncMap({ fit: false });
    }, 50);
  }
}

function handleFilter(filters) {
  state.filters = {
    year: filters.year || 'all',
    continent: filters.continent || 'all',
    tag: filters.tag || 'all',
    query: filters.query || ''
  };
  state.year = state.filters.year;
  state.timeline.update(state.data, state.year);
  refreshPanel();
  syncMap({ fit: false });
}

function handleYearSelect(year) {
  state.year = year;
  state.filters.year = year;
  setListYear(year);
  state.timeline.update(state.data, year);
  state.sidebar.update(filteredData(), {
    activeId: state.selected?.id
  });
  syncMap({ fit: true });
  showHint(year === 'all' ? '' : `已筛选 ${year}`, true, 1600);
}

function handleSelect(sel) {
  state.selected = sel;
  state.sidebar.setActive(sel.id);

  if (sel.type === 'place') {
    const place = state.data.places.find((p) => p.id === sel.id);
    if (!place) return;
    const journey = state.data.journeys.find((j) => j.id === place.journeyId);
    openPlace(place, journey);
    if (state.mode === '2d') flyTo(place.lng, place.lat);
  } else {
    const journey = state.data.journeys.find((j) => j.id === sel.id);
    if (!journey) return;
    const path = getJourneyPath(state.data, journey.id);
    openJourney(
      journey,
      path
    );
    if (state.mode === '2d' && path.length) {
      // fit path bounds roughly by flying to midpoint
      const mid = path[Math.floor(path.length / 2)];
      flyTo(mid.lng, mid.lat, 3.5);
    }
  }
  syncMap({ fit: false });
}

function moveJourneyPlace(journeyId, placeId, dir) {
  const journey = state.data.journeys.find((j) => j.id === journeyId);
  if (!journey) return;
  const i = journey.placeIds.indexOf(placeId);
  const to = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || to < 0 || to >= journey.placeIds.length) return;
  [journey.placeIds[i], journey.placeIds[to]] = [
    journey.placeIds[to],
    journey.placeIds[i]
  ];
  saveData(state.data);
  renderAll();
  syncMap({ fit: false });
  openJourney(journey, getJourneyPath(state.data, journeyId));
}

function savePlaceForm(payload) {
  if (!payload) return;

  if (payload.kind === 'journey') {
    upsertJourney(payload);
    toast(payload.id ? '旅程已更新' : '旅程已创建');
    renderAll();
    syncMap({ fit: false });
    return;
  }

  const prevSelected = state.selected;
  upsertPlaceAsync(payload).then(({ place, geocoded, source, merged }) => {
    // keep journey context when the edit came from a journey drawer
    if (
      prevSelected?.type === 'journey' &&
      state.data.journeys.some((j) => j.id === prevSelected.id)
    ) {
      state.selected = prevSelected;
    }
    renderAll();
    syncMap({ fit: false });

    // refresh whichever drawer is open so date edits show up everywhere
    if (state.selected?.type === 'journey') {
      const j = state.data.journeys.find((x) => x.id === state.selected.id);
      openJourney(j, getJourneyPath(state.data, j.id));
    } else if (prevSelected?.type === 'place') {
      const pl = state.data.places.find((x) => x.id === place.id);
      if (pl) {
        openPlace(pl, state.data.journeys.find((j) => j.id === pl.journeyId));
      }
    }

    if (merged) {
      toast('该地点已存在，已合并为同一标记（追加到访时间）');
      return;
    }
    const verb = payload.id ? '地点已更新' : '地点已添加';
    if (geocoded && source === 'remote') toast(`${verb}（已联网检索坐标）`);
    else if (geocoded) toast(`${verb}（坐标已自动识别）`);
    else toast(`${verb}（未能自动识别坐标，可编辑名称后重试）`);
  });
}

async function upsertPlaceAsync(p) {
  let existing = state.data.places.find((x) => x.id === p.id) || null;
  let merged = false;

  // one marker per place: a new entry whose name (or English name) matches an
  // existing place is merged into that record instead of creating a second pin
  if (!existing && p.name) {
    const key = p.name.trim().toLowerCase();
    existing =
      state.data.places.find(
        (x) =>
          (x.name && x.name.trim().toLowerCase() === key) ||
          (x.nameEn && x.nameEn.trim().toLowerCase() === key)
      ) || null;
    if (existing) merged = true;
  }

  let lat = null;
  let lng = null;
  let country = '';
  let continent = '';
  let nameEn = '';
  let level = 'city';
  let geocoded = false;
  let source = 'none';

  try {
    const patch = await geocodePlace({
      name: p.name,
      nameEn: existing?.nameEn,
      level: existing?.level || 'city',
      country: existing?.country
    });
    if (patch) {
      if (patch.lat != null && (patch.lat !== 0 || patch.lng !== 0)) {
        lat = patch.lat;
        lng = patch.lng;
        geocoded = true;
        source = patch.matched === 'remote' ? 'remote' : 'local';
      }
      if (patch.country) country = patch.country;
      if (patch.continent) continent = patch.continent;
      if (patch.nameEn) nameEn = patch.nameEn;
      if (patch.matched === 'country') level = 'country';
      else if (patch.matched === 'city') level = 'city';
    }
  } catch (err) {
    console.warn('geocode failed', err);
  }

  // Fallbacks: previous place coords
  if (lat == null || lng == null || (!lat && !lng)) {
    if (
      existing &&
      Number.isFinite(existing.lat) &&
      Number.isFinite(existing.lng) &&
      (existing.lat || existing.lng)
    ) {
      lat = existing.lat;
      lng = existing.lng;
      country = country || existing.country;
      continent = continent || existing.continent;
      nameEn = nameEn || existing.nameEn;
      level = existing.level || level;
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    lat = Number(lat) || 0;
    lng = Number(lng) || 0;
  }

  // merge keeps the existing stay interval as a start~end segment
  const existingSpan =
    merged && existing.endDate && existing.date && existing.endDate !== existing.date
      ? `${existing.date}${SEGMENT_JOIN}${existing.endDate}`
      : existing?.date;
  const date = merged
    ? normalizeDateListString([existingSpan, p.date].filter(Boolean).join(','))
    : normalizeDateListString(p.date);
  const isMulti =
    /[,，、;；]/.test(date || '') || (date || '').includes(SEGMENT_JOIN);
  const endDate = isMulti ? null : normalizeDateString(p.endDate) || date;
  const place = {
    id: p.id || existing?.id || `p-${Date.now()}`,
    name: p.name,
    nameEn,
    country,
    countryCode: '',
    continent: continent || '未知',
    level,
    lat: Number(lat),
    lng: Number(lng),
    date,
    endDate,
    days: resolveDays({ date, endDate, days: null, tags: p.tags }),
    tags: p.tags || [],
    journeyId: p.journeyId || null
  };

  const idx = state.data.places.findIndex((x) => x.id === place.id);
  const isNew = idx < 0;
  if (idx >= 0) {
    state.data.places[idx] = place;
  } else {
    state.data.places.push(place);
  }

  // sync journey membership
  for (const j of state.data.journeys) {
    const has = j.placeIds.includes(place.id);
    if (place.journeyId === j.id && !has) j.placeIds.push(place.id);
    if (place.journeyId && place.journeyId !== j.id && has) {
      j.placeIds = j.placeIds.filter((id) => id !== place.id);
    }
    if (!place.journeyId && has) {
      j.placeIds = j.placeIds.filter((id) => id !== place.id);
    }
  }

  // only auto-sort the journey that just gained a brand-new place;
  // manual ordering (journey drawer ↑↓) wins afterwards
  if (isNew && place.journeyId) sortJourneyPlaces(place.journeyId);
  saveData(state.data);
  state.selected = { type: 'place', id: place.id };
  return { place, geocoded, source, merged };
}

function upsertJourney(j) {
  const journey = {
    id: j.id || `j-${Date.now()}`,
    name: j.name,
    startDate: j.startDate || null,
    endDate: j.endDate || null,
    placeIds: j.placeIds || [],
    tags: j.tags || []
  };
  const idx = state.data.journeys.findIndex((x) => x.id === journey.id);
  if (idx >= 0) state.data.journeys[idx] = journey;
  else state.data.journeys.push(journey);

  // update places journeyId backref
  for (const p of state.data.places) {
    const inJourney = journey.placeIds.includes(p.id);
    if (inJourney) p.journeyId = journey.id;
    else if (p.journeyId === journey.id) p.journeyId = null;
  }

  saveData(state.data);
  state.selected = { type: 'journey', id: journey.id };
}

function sortJourneyPlaces(onlyId = null) {
  const byId = new Map(state.data.places.map((p) => [p.id, p]));
  for (const j of state.data.journeys) {
    if (onlyId && j.id !== onlyId) continue;
    j.placeIds.sort((a, b) => {
      const da = byId.get(a)?.date || '';
      const db = byId.get(b)?.date || '';
      return da.localeCompare(db);
    });
  }
}

function deletePlace(id) {
  state.data.places = state.data.places.filter((p) => p.id !== id);
  for (const j of state.data.journeys) {
    j.placeIds = j.placeIds.filter((pid) => pid !== id);
  }
  saveData(state.data);
  state.selected = null;
  closeDrawer();
  renderAll();
  syncMap({ fit: false });
  toast('地点已删除');
}

function deleteJourney(id) {
  state.data.journeys = state.data.journeys.filter((j) => j.id !== id);
  for (const p of state.data.places) {
    if (p.journeyId === id) p.journeyId = null;
  }
  saveData(state.data);
  state.selected = null;
  closeDrawer();
  renderAll();
  syncMap({ fit: false });
  toast('旅程已删除');
}

function filteredData() {
  const places = filterPlaces(
    state.data.places,
    state.filters,
    state.data.journeys
  );
  const journeys = filterJourneys(
    state.data.journeys,
    state.filters,
    state.data.places
  );
  return { places, journeys };
}

function renderAll() {
  renderStats($('#stats'), state.data);
  state.sidebar.update(filteredData(), {
    activeId: state.selected?.id
  });
  state.timeline.update(state.data, state.year);
}

function refreshPanel() {
  state.sidebar.update(filteredData(), {
    activeId: state.selected?.id
  });
}

function syncMap(options = {}) {
  const view = filteredData();
  const selectedId = state.selected?.type === 'place' ? state.selected.id : null;
  const opts = {
    places: view.places,
    journeys: view.journeys,
    selectedId,
    fit: options.fit || false
  };

  if (state.mode === '2d') {
    refreshMap2D(state.data, opts);
  } else if (state.map3d || isMap3DReady()) {
    ensureMap3D();
    refreshMap3D(state.data, opts);
  }
}

function maybeShowHint() {
  if (!state.data.places.length) {
    showHint('还没有地点？点击侧栏「+ 地点」添加第一个足迹', true);
  }
}

function showHint(text, visible = true, autoHideMs = 0) {
  const el = $('#map-hint');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('is-visible', Boolean(visible && text));
  if (autoHideMs && visible && text) {
    setTimeout(() => el.classList.remove('is-visible'), autoHideMs);
  }
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('is-visible'), 2200);
}

// Expose for modal journey saves — editor already merges handlers
// Re-bind save handler is enough because openJourneyForm uses same form path.

boot();
