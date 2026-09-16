/* Sidebar: filters + place/journey list */

import { placeCoversYear, parseDateSegments, loadTagRegistry } from './data.js?v=86';

/** 侧栏时间紧凑展示：段内 start → end，多段取前两段，其余以 +N 示意。 */
function shortDateList(dateStr) {
  const segs = parseDateSegments(dateStr);
  if (!segs.length) return '';
  const shown = segs
    .slice(0, 2)
    .map((s) => (s.end ? `${s.start} → ${s.end}` : s.start));
  const more = segs.length > 2 ? ` +${segs.length - 2}` : '';
  return `${shown.join('、')}${more}`;
}

const state = {
  tab: 'places',
  year: 'all',
  continent: 'all',
  tag: 'all',
  query: '',
  activeId: null,
  listeners: {
    onSelect: null,
    onFilter: null,
    onNewJourney: null,
    onNewPlace: null
  }
};

export function initSidebar(root, handlers = {}) {
  state.listeners.onSelect = handlers.onSelect || null;
  state.listeners.onFilter = handlers.onFilter || null;
  state.listeners.onNewJourney = handlers.onNewJourney || null;
  state.listeners.onNewPlace = handlers.onNewPlace || null;

  root.innerHTML = `
    <div class="stats" id="stats"></div>
    <div class="filters" id="filters"></div>
    <div class="list-header">
      <div class="list-tabs">
        <button type="button" class="list-tab is-active" data-tab="places">地点</button>
        <button type="button" class="list-tab" data-tab="journeys">旅程</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button type="button" class="chip chip-primary edit-only" id="btn-new-place" title="添加地点">+ 地点</button>
        <button type="button" class="chip edit-only" id="btn-new-journey" title="新建旅程" hidden>+ 旅程</button>
        <span class="list-count" id="list-count"></span>
      </div>
    </div>
    <div class="list-scroll" id="list-scroll"></div>
  `;

  root.querySelector('#btn-new-place')?.addEventListener('click', () => {
    handlers.onNewPlace?.();
  });
  root.querySelector('#btn-new-journey')?.addEventListener('click', () => {
    handlers.onNewJourney?.();
  });

  root.querySelectorAll('.list-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = btn.getAttribute('data-tab');
      root.querySelectorAll('.list-tab').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
      });
      const nj = root.querySelector('#btn-new-journey');
      const np = root.querySelector('#btn-new-place');
      if (nj) nj.hidden = state.tab !== 'journeys';
      if (np) np.hidden = state.tab !== 'places';
      state.listeners.onFilter?.(getFilters());
    });
  });

  return {
    update: (data, options = {}) => updateSidebar(root, data, options),
    getFilters,
    setActive(id) {
      state.activeId = id;
      renderList(root, lastData, { ...lastOptions, activeId: id });
    },
    resetFilters() {
      state.year = 'all';
      state.continent = 'all';
      state.tag = 'all';
      state.query = '';
      state.listeners.onFilter?.(getFilters());
    }
  };
}

let lastData = { places: [], journeys: [] };
let lastOptions = {};

function getFilters() {
  return {
    tab: state.tab,
    year: state.year,
    continent: state.continent,
    tag: state.tag,
    query: state.query
  };
}

function updateSidebar(root, data, options = {}) {
  lastData = data;
  lastOptions = options;
  if (options.activeId !== undefined) state.activeId = options.activeId;
  renderFilters(root, data);
  renderList(root, data, options);
}

function renderFilters(root, data) {
  const host = root.querySelector('#filters');
  if (!host) return;

  // 搜索框持有焦点（尤其中文输入法组词中）时不要重建筛选区，
  // 否则每敲一个键焦点就被打掉，输入被打断
  const search = host.querySelector('#filter-q');
  if (search && document.activeElement === search) return;

  const continents = [...new Set(data.places.map((p) => p.continent).filter(Boolean))].sort();
  // 标签筛选区 = 受控注册表（初始三个 + 用户新建），不罗列数据里的杂散标签
  const tags = loadTagRegistry();
  if (state.tag !== 'all' && !tags.includes(state.tag)) state.tag = 'all';

  host.innerHTML = `
    <div class="field">
      <label class="field-label" for="filter-continent">大洲</label>
      <select id="filter-continent">
        <option value="all">全部大洲</option>
        ${continents.map((c) => `<option value="${c}" ${state.continent === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label class="field-label" for="filter-q">搜索</label>
      <input id="filter-q" type="search" placeholder="城市 / 国家 / 旅程" value="${escapeAttr(state.query)}" />
    </div>
    <div class="field">
      <span class="field-label">标签</span>
      <div class="chip-row">
        <button type="button" class="chip ${state.tag === 'all' ? 'is-active' : ''}" data-tag="all">全部</button>
        ${tags.map((t) => `<button type="button" class="chip ${state.tag === t ? 'is-active' : ''}" data-tag="${escapeAttr(t)}">${escapeHtml(t)}</button>`).join('')}
      </div>
    </div>
  `;

  host.querySelector('#filter-continent')?.addEventListener('change', (e) => {
    state.continent = e.target.value;
    state.listeners.onFilter?.(getFilters());
  });
  host.querySelector('#filter-q')?.addEventListener('input', (e) => {
    state.query = e.target.value;
    state.listeners.onFilter?.(getFilters());
  });
  host.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.tag = chip.getAttribute('data-tag');
      state.listeners.onFilter?.(getFilters());
    });
  });
}

/** 把 "YYYY / YYYY-MM / YYYY-MM-DD / YYYY-YYYY" 转成可比较数值（缺省月日取 01）。 */
function dateNumeric(t) {
  let s = String(t || '').trim();
  if (/^\d{4}-\d{4}$/.test(s)) s = s.slice(0, 4); // 年份区间取起年
  const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(s);
  if (!m) return 0;
  return (
    Number(m[1]) * 10000 +
    (m[2] ? Number(m[2]) : 1) * 100 +
    (m[3] ? Number(m[3]) : 1)
  );
}

/** 地点的排序时间：取最近一次到访（多段取最大 start/end）；无日期返回 null。 */
function placeSortKey(p) {
  const segs = parseDateSegments(p.date);
  if (!segs.length) return null;
  let max = -1;
  for (const s of segs) {
    const t = Math.max(dateNumeric(s.start), dateNumeric(s.end));
    if (t > max) max = t;
  }
  return max;
}

/** 侧栏地点：按到访时间倒序（年→月→日），无到访时间的排最后。 */
function sortPlacesByDateDesc(places) {
  const items = [...places];
  const key = (p) => placeSortKey(p);
  items.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null) return kb === null ? 0 : 1;
    if (kb === null) return -1;
    return kb - ka;
  });
  return items;
}

function renderList(root, data, options = {}) {
  const scroll = root.querySelector('#list-scroll');
  const countEl = root.querySelector('#list-count');
  if (!scroll) return;

  const activeId = state.activeId;
  const filters = getFilters();

  if (filters.tab === 'places') {
    const items = sortPlacesByDateDesc(data.places);
    countEl.textContent = `${items.length}`;
    if (!items.length) {
      scroll.innerHTML = emptyHtml('还没有地点', '点击顶栏「+ 地点」按钮，添加第一个足迹。');
      return;
    }
    scroll.innerHTML = items
      .map((p) => {
        const active = p.id === activeId ? 'is-active' : '';
        return `
          <button type="button" class="list-item ${active}" data-type="place" data-id="${p.id}">
            <span class="list-dot"></span>
            <span class="list-main">
              <span class="list-title">${escapeHtml(p.name)}</span>
              <span class="list-meta">${escapeHtml(p.country || '')}${p.date ? ' · ' + escapeHtml(shortDateList(p.date)) : ''}${p.tags?.length ? ' · ' + escapeHtml(p.tags.join(' ')) : ''}</span>
            </span>
            <span class="list-days">${p.days != null && p.days > 0 ? p.days + 'd' : ''}</span>
          </button>
        `;
      })
      .join('');
  } else {
    const items = data.journeys;
    countEl.textContent = `${items.length}`;
    if (!items.length) {
      scroll.innerHTML = emptyHtml('还没有旅程', '编辑数据时创建旅程，并把多个地点串联起来。');
      return;
    }
    const byId = new Map(data.places.map((p) => [p.id, p]));
    scroll.innerHTML = items
      .map((j) => {
        const names = j.placeIds
          .map((id) => byId.get(id)?.name)
          .filter(Boolean)
          .join(' → ');
        const active = j.id === activeId ? 'is-active' : '';
        return `
          <button type="button" class="list-item is-journey ${active}" data-type="journey" data-id="${j.id}">
            <span class="list-dot"></span>
            <span class="list-main">
              <span class="list-title">${escapeHtml(j.name)}</span>
              <span class="list-meta">${escapeHtml(names || j.startDate || '')}</span>
            </span>
            <span class="list-days">${j.placeIds.length}</span>
          </button>
        `;
      })
      .join('');
  }

  scroll.querySelectorAll('.list-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeId = btn.getAttribute('data-id');
      scroll.querySelectorAll('.list-item').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.listeners.onSelect?.({
        type: btn.getAttribute('data-type'),
        id: btn.getAttribute('data-id')
      });
    });
  });
}

function emptyHtml(title, desc) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(desc)}</div>`;
}

export function filterPlaces(places, filters, journeys) {
  const q = (filters.query || '').trim().toLowerCase();
  return places.filter((p) => {
    if (filters.year !== 'all' && !placeCoversYear(p, filters.year)) return false;
    if (filters.continent !== 'all' && p.continent !== filters.continent) return false;
    if (filters.tag !== 'all' && !(p.tags || []).includes(filters.tag)) return false;
    if (q) {
      const hay = [p.name, p.nameEn, p.country, p.continent, (p.tags || []).join(' ')]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function filterJourneys(journeys, filters, places) {
  const q = (filters.query || '').trim().toLowerCase();
  return journeys.filter((j) => {
    if (filters.tag !== 'all' && !(j.tags || []).includes(filters.tag)) {
      const byId = new Map(places.map((p) => [p.id, p]));
      const hasPlaceTag = j.placeIds.some((id) =>
        (byId.get(id)?.tags || []).includes(filters.tag)
      );
      if (!hasPlaceTag) return false;
    }
    if (filters.year !== 'all') {
      const byId = new Map(places.map((p) => [p.id, p]));
      const covers =
        placeCoversYear({ date: j.startDate, endDate: j.endDate }, filters.year) ||
        j.placeIds.some((id) => {
          const p = byId.get(id);
          return p ? placeCoversYear(p, filters.year) : false;
        });
      if (!covers) return false;
    }
    if (q) {
      const byId = new Map(places.map((p) => [p.id, p]));
      const placeNames = j.placeIds.map((id) => byId.get(id)?.name || '').join(' ');
      const hay = `${j.name} ${j.tags.join(' ')} ${placeNames}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function setListYear(year) {
  state.year = year;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
