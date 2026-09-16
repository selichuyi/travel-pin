/* Detail drawer + place form modal */

import { parseDateSegments, SEGMENT_JOIN, daysBetween, loadTagRegistry, addTagToRegistry } from './data.js?v=86';

let drawerEl = null;
let modalEl = null;
let handlers = {};

export function initDrawer(root, h = {}) {
  drawerEl = root;
  handlers = { ...handlers, ...h };
  root.innerHTML = `
    <div class="drawer-head">
      <div>
        <div class="drawer-kicker" id="drawer-kicker"></div>
        <h2 class="drawer-title" id="drawer-title"></h2>
      </div>
      <button type="button" class="icon-btn" id="drawer-close" aria-label="关闭">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="drawer-body" id="drawer-body"></div>
    <div class="drawer-actions" id="drawer-actions"></div>
  `;

  root.querySelector('#drawer-close').addEventListener('click', () => {
    closeDrawer();
    handlers.onClose?.();
  });

  return {
    openPlace,
    openJourney,
    close: closeDrawer
  };
}

export function closeDrawer() {
  drawerEl?.classList.remove('is-open');
}

export function openPlace(place, journey) {
  if (!drawerEl || !place) return;
  drawerEl.querySelector('#drawer-kicker').textContent = '地点';
  drawerEl.querySelector('#drawer-title').textContent = place.name;

  const body = drawerEl.querySelector('#drawer-body');
  body.innerHTML = `
    <dl class="meta-grid">
      <div class="meta-item"><dt>粒度</dt><dd>${place.level === 'country' ? '国家' : '城市'}</dd></div>
      <div class="meta-item"><dt>国家</dt><dd>${esc(place.country || '—')}</dd></div>
      <div class="meta-item"><dt>大洲</dt><dd>${esc(place.continent || '—')}</dd></div>
      <div class="meta-item"><dt>到访</dt><dd>${renderDates(place)}</dd></div>
      <div class="meta-item"><dt>天数</dt><dd>${place.days != null && place.days > 0 ? place.days : '—'}</dd></div>
      <div class="meta-item"><dt>坐标</dt><dd style="font-family:var(--font-mono);font-size:12px">${place.lat.toFixed(3)}, ${place.lng.toFixed(3)}</dd></div>
      <div class="meta-item"><dt>英文名</dt><dd>${esc(place.nameEn || '—')}</dd></div>
    </dl>
    ${place.tags?.length ? `<h3 class="section-title">标签</h3><div class="tag-row">${place.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    ${
      journey
        ? `<h3 class="section-title" style="margin-top:18px">所属旅程</h3>
           <p style="margin:0;font-size:13px">${esc(journey.name)}</p>`
        : ''
    }
  `;

  const actions = drawerEl.querySelector('#drawer-actions');
  actions.innerHTML = `
    <button type="button" class="btn edit-only" id="drawer-edit">编辑</button>
    <button type="button" class="btn btn-danger edit-only" id="drawer-delete">删除</button>
  `;
  actions.querySelector('#drawer-edit')?.addEventListener('click', () => {
    handlers.onEdit?.(place);
  });
  actions.querySelector('#drawer-delete')?.addEventListener('click', () => {
    if (confirm(`删除地点「${place.name}」？`)) {
      handlers.onDeletePlace?.(place.id);
    }
  });

  drawerEl.classList.add('is-open');
}

export function openJourney(journey, places) {
  if (!drawerEl || !journey) return;
  drawerEl.querySelector('#drawer-kicker').textContent = '旅程';
  drawerEl.querySelector('#drawer-title').textContent = journey.name;

  const path = places.filter((p) => journey.placeIds.includes(p.id));
  // 旅程总天数按起止日期计算（含端），而非累加地点天数
  const totalDays =
    journey.startDate && journey.endDate
      ? daysBetween(journey.startDate, journey.endDate)
      : null;
  const body = drawerEl.querySelector('#drawer-body');
  body.innerHTML = `
    <dl class="meta-grid">
      <div class="meta-item"><dt>开始</dt><dd>${esc(journey.startDate || '—')}</dd></div>
      <div class="meta-item"><dt>结束</dt><dd>${esc(journey.endDate || '—')}</dd></div>
      <div class="meta-item"><dt>地点数</dt><dd>${path.length}</dd></div>
      <div class="meta-item"><dt>总天数</dt><dd>${totalDays || '—'}</dd></div>
    </dl>
    ${
      journey.tags?.length
        ? `<h3 class="section-title">标签</h3><div class="tag-row">${journey.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`
        : ''
    }
    <h3 class="section-title" style="margin-top:18px">路径</h3>
    ${
      path.length
        ? `<p class="help-text" style="margin:0 0 8px">点击地点可修改到访时间；↑ ↓ 调整顺序。</p>
           <ul class="path-list">${path
            .map(
              (p, i) => `
          <li>
            <span class="path-node"></span>
            <button type="button" class="path-place edit-only" data-edit-place="${p.id}">
              <strong style="font-weight:500">${esc(p.name)}</strong>
              <div style="color:var(--text-muted);font-size:11px;margin-top:2px">${esc(p.country || '')}${p.date ? ' · ' + esc(p.date) : ''}</div>
            </button>
            <span class="path-ops edit-only">
              <button type="button" data-move="up" data-id="${p.id}" ${i === 0 ? 'disabled' : ''} aria-label="上移" title="上移">↑</button>
              <button type="button" data-move="down" data-id="${p.id}" ${i === path.length - 1 ? 'disabled' : ''} aria-label="下移" title="下移">↓</button>
            </span>
          </li>`
            )
            .join('')}</ul>`
        : `<div class="empty-state">该旅程暂无关联地点</div>`
    }
    <button type="button" class="btn path-add edit-only" id="path-add-place">＋ 添加地点到此旅程</button>
  `;

  body.querySelector('#path-add-place')?.addEventListener('click', () => {
    handlers.onNewPlaceForJourney?.(journey);
  });

  body.querySelectorAll('[data-edit-place]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const place = places.find((x) => x.id === btn.getAttribute('data-edit-place'));
      if (place) handlers.onEdit?.(place);
    });
  });
  body.querySelectorAll('[data-move]').forEach((btn) => {
    btn.addEventListener('click', () => {
      handlers.onMoveJourneyPlace?.(
        journey.id,
        btn.getAttribute('data-id'),
        btn.getAttribute('data-move')
      );
    });
  });

  const actions = drawerEl.querySelector('#drawer-actions');
  actions.innerHTML = `
    <button type="button" class="btn edit-only" id="drawer-edit-journey">编辑</button>
    <button type="button" class="btn btn-danger edit-only" id="drawer-delete-journey">删除旅程</button>
  `;
  actions.querySelector('#drawer-edit-journey')?.addEventListener('click', () => {
    handlers.onEditJourney?.(journey);
  });
  actions.querySelector('#drawer-delete-journey')?.addEventListener('click', () => {
    if (confirm(`删除旅程「${journey.name}」？地点会保留。`)) {
      handlers.onDeleteJourney?.(journey.id);
    }
  });

  drawerEl.classList.add('is-open');
}

/* ─── Modal form ─── */

export function initModal(root, h = {}) {
  modalEl = root;
  handlers = { ...handlers, ...h };
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3 class="modal-title" id="modal-title">添加地点</h3>
        <button type="button" class="icon-btn" id="modal-close" aria-label="关闭">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <form id="place-form">
        <div class="modal-body" id="modal-body"></div>
        <div class="modal-foot">
          <button type="button" class="btn" id="modal-cancel">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    </div>
  `;

  root.addEventListener('click', (e) => {
    if (e.target === root) closeModal();
  });
  document.addEventListener('mousedown', (e) => {
    const menu = modalEl?.querySelector('#tag-menu');
    const picker = modalEl?.querySelector('#tag-picker');
    if (menu && !menu.hidden && picker && !picker.contains(e.target)) {
      menu.hidden = true;
    }
  });
  root.querySelector('#modal-close').addEventListener('click', closeModal);
  root.querySelector('#modal-cancel').addEventListener('click', closeModal);
  root.querySelector('#place-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = readForm();
    handlers.onSavePlace?.(data);
    closeModal();
  });

  return { openPlaceForm, openJourneyForm, close: closeModal };
}

let editingId = null;

/** 把地点的多段日期渲染成可读列表（每段一行，含可选结束日期）。 */
function renderDates(place) {
  const segs = parseDateSegments(place?.date);
  if (!place?.date && !place?.endDate) return '—';
  if (!segs.length && place.endDate) {
    return `${esc(place.date || '—')}${' → ' + esc(place.endDate)}`;
  }
  if (!segs.length) return esc(place.date || '—');
  return segs
    .map(
      (s) => `${esc(s.start)}${s.end ? ' → ' + esc(s.end) : ''}`
    )
    .join('<br>');
}

let dateRowSeq = 0;

function createDateRow({ date = '', end = '' } = {}) {
  const row = document.createElement('div');
  row.className = 'form-row date-row';
  dateRowSeq += 1;
  const idDate = `f-date-${dateRowSeq}`;
  const idEnd = `f-end-${dateRowSeq}`;
  row.innerHTML = `
    <div class="field">
      <label class="field-label" for="${idDate}">到访日期</label>
      <input class="f-date" type="text" value="${esc(date)}" placeholder="2024 / 2024-12 / 2024-12-13 / 2024-2026" />
    </div>
    <div class="field">
      <label class="field-label" for="${idEnd}">结束日期</label>
      <input class="f-end" type="text" value="${esc(end)}" placeholder="可选" />
    </div>
    <div class="date-row-ops">
      <button type="button" class="date-op date-add" title="在本行下方添加一段日期" aria-label="添加一段日期">＋</button>
      <button type="button" class="date-op date-del" title="删除此段日期" aria-label="删除此段日期" disabled>✕</button>
    </div>`;

  row.querySelector('.date-add').addEventListener('click', () => {
    const next = createDateRow({});
    row.after(next);
    syncDateRowDeletes();
    next.querySelector('.f-date')?.focus();
  });
  row.querySelector('.date-del').addEventListener('click', () => {
    const rows = [...row.parentElement.querySelectorAll('.date-row')];
    if (rows.length <= 1) return;
    row.remove();
    syncDateRowDeletes();
  });
  return row;
}

function syncDateRowDeletes() {
  const list = modalEl?.querySelector('#date-list');
  const rows = list ? [...list.querySelectorAll('.date-row')] : [];
  for (const r of rows) {
    const del = r.querySelector('.date-del');
    if (del) del.disabled = rows.length <= 1;
  }
}

export function openPlaceForm({ place = null, journeys = [], journeyId = null } = {}) {
  if (!modalEl) return;
  modalEl._tagCleanup?.();
  modalEl._tagCleanup = null;
  editingId = place?.id || null;
  const presetJourneyId = place?.journeyId ?? journeyId;
  modalEl.querySelector('#modal-title').textContent = place ? '编辑地点' : '添加地点';

  const body = modalEl.querySelector('#modal-body');
  body.innerHTML = `
    <div class="field">
      <label class="field-label" for="f-name">地点名称 *</label>
      <input id="f-name" required value="${esc(place?.name || '')}" placeholder="例如：东京 或 日本" />
    </div>
    <div class="field">
      <span class="field-label">到访日期（可多段）</span>
      <div class="date-list" id="date-list"></div>
    </div>
    <div class="field">
      <span class="field-label">标签</span>
      <div class="tag-picker" id="tag-picker">
        <div class="tag-picker-chips" id="tag-chips"></div>
        <input id="f-tag-input" type="text" placeholder="点选已有标签，或输入后回车新建" autocomplete="off" />
        <div class="tag-picker-menu" id="tag-menu" hidden></div>
      </div>
    </div>
    <div class="field">
      <label class="field-label" for="f-journey">所属旅程</label>
      <select id="f-journey">
        <option value="">独立地点</option>
        ${journeys
          .map(
            (j) =>
              `<option value="${j.id}" ${presetJourneyId === j.id ? 'selected' : ''}>${esc(j.name)}</option>`
          )
          .join('')}
      </select>
    </div>
    <p class="help-text">
      日期支持：年（2024）、年月（2024-12）、完整日期（2024-12-13）、年份区间（2024-2026）。每行是一次停留，点行尾 ＋ 可添加下一段，结束日期可选。保存后会自动匹配国家、大洲、坐标与天数。
    </p>
  `;

  const listEl = body.querySelector('#date-list');
  const isMultiDate =
    /[,，、;；]/.test(place?.date || '') ||
    (place?.date || '').includes(SEGMENT_JOIN);
  if (place && !isMultiDate && (place.date || place.endDate)) {
    // 旧格式单段：到访 + 可选结束 还原为一行
    listEl.appendChild(
      createDateRow({ date: place.date || '', end: place.endDate || '' })
    );
  } else {
    const segs = place ? parseDateSegments(place.date) : [];
    if (segs.length) {
      for (const s of segs) {
        listEl.appendChild(createDateRow({ date: s.start, end: s.end || '' }));
      }
    } else {
      listEl.appendChild(createDateRow({}));
    }
  }
  syncDateRowDeletes();
  initTagPicker(body, place?.tags || []);

  modalEl.classList.add('is-open');
  body.querySelector('#f-name')?.focus();
}

/* ─── 标签点选器：下拉选已有标签，回车新建 ─── */

function initTagPicker(body, initialTags) {
  const picker = body.querySelector('#tag-picker');
  const chipsEl = body.querySelector('#tag-chips');
  const input = body.querySelector('#f-tag-input');
  const menu = body.querySelector('#tag-menu');
  if (!picker || !chipsEl || !input || !menu) return;
  const selected = [...new Set(initialTags.filter(Boolean))];

  const renderChips = () => {
    chipsEl.innerHTML = selected
      .map(
        (t) =>
          `<span class="tag tag-removable">${esc(t)}<button type="button" class="tag-x" data-remove="${esc(t)}" aria-label="移除标签 ${esc(t)}">✕</button></span>`
      )
      .join('');
  };

  const renderMenu = () => {
    const registry = loadTagRegistry();
    const f = input.value.trim();
    const items = registry.filter(
      (t) => !selected.includes(t) && (!f || t.includes(f))
    );
    const canCreate = f && !registry.includes(f) && !selected.includes(f);
    menu.innerHTML =
      items
        .map((t) => `<button type="button" data-pick="${esc(t)}">${esc(t)}</button>`)
        .join('') +
      (canCreate
        ? `<button type="button" class="tag-menu-create" data-create="${esc(f)}">＋ 创建「${esc(f)}」</button>`
        : '');
    menu.hidden = !menu.innerHTML;
  };

  const add = (name) => {
    const t = String(name || '').trim();
    if (!t || selected.includes(t)) return;
    addTagToRegistry(t);
    selected.push(t);
    renderChips();
  };

  // 离开输入框或点击控件外部时收起下拉（blur 延迟让菜单点击先完成
  // （mousedown 在 blur 之前），外部点击需在 blur 前捕获）
  const closeMenu = () => {
    menu.hidden = true;
  };
  input.addEventListener('blur', () => setTimeout(closeMenu, 150));
  const onDocDown = (e) => {
    if (picker && !picker.contains(e.target)) closeMenu();
  };
  document.addEventListener('mousedown', onDocDown);
  picker._cleanup = () => document.removeEventListener('mousedown', onDocDown);
  modalEl._tagCleanup = picker._cleanup;

  input.addEventListener('focus', renderMenu);
  input.addEventListener('click', renderMenu);
  input.addEventListener('input', renderMenu);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    input.value
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach(add);
    input.value = '';
    renderMenu();
  });
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick], [data-create]');
    if (!btn) return;
    add(btn.getAttribute('data-pick') || btn.getAttribute('data-create'));
    input.value = '';
    renderMenu();
    input.focus();
  });
  chipsEl.addEventListener('click', (e) => {
    const x = e.target.closest('[data-remove]');
    if (!x) return;
    const i = selected.indexOf(x.getAttribute('data-remove'));
    if (i >= 0) selected.splice(i, 1);
    renderChips();
    renderMenu();
  });

  picker._getTags = () => [...selected];
  renderChips();
}

export function openJourneyForm(journey = null, places = []) {
  if (!modalEl) return;
  editingId = journey?.id || null;
  modalEl.querySelector('#modal-title').textContent = journey ? '编辑旅程' : '新建旅程';

  const body = modalEl.querySelector('#modal-body');
  const selected = new Set(journey?.placeIds || []);

  body.innerHTML = `
    <div class="field">
      <label class="field-label" for="j-name">旅程名称 *</label>
      <input id="j-name" required value="${esc(journey?.name || '')}" placeholder="例如：2024 西欧穿越" />
    </div>
    <div class="form-row">
      <div class="field">
        <label class="field-label" for="j-start">开始日期</label>
        <input id="j-start" type="text" value="${esc(journey?.startDate || '')}" placeholder="2024 / 2024-12 / 2024-12-13" />
      </div>
      <div class="field">
        <label class="field-label" for="j-end">结束日期</label>
        <input id="j-end" type="text" value="${esc(journey?.endDate || '')}" placeholder="可选" />
      </div>
    </div>
    <div class="field">
      <label class="field-label" for="j-tags">标签</label>
      <input id="j-tags" value="${esc((journey?.tags || []).join(', '))}" placeholder="长途, 文化" />
    </div>
    <div class="field">
      <span class="field-label">路径地点（按顺序）</span>
      <div style="max-height:180px;overflow:auto;border:1px solid var(--line);border-radius:var(--radius);padding:6px">
        ${
          places.length
            ? places
                .map(
                  (p) => `
            <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;cursor:pointer">
              <input type="checkbox" data-place-id="${p.id}" ${selected.has(p.id) ? 'checked' : ''} />
              <span style="flex:1">${esc(p.name)}</span>
              <span style="color:var(--text-muted);font-size:11px">${esc(p.date || '')}</span>
            </label>`
                )
                .join('')
            : '<div class="empty-state">请先添加地点</div>'
        }
      </div>
      <p class="help-text">勾选顺序将作为旅程路径顺序（按日期排序更清晰）。</p>
    </div>
  `;

  modalEl.classList.add('is-open');
  body.querySelector('#j-name')?.focus();
}

function readForm() {
  const v = (id) => modalEl.querySelector(`#${id}`)?.value ?? '';
  // journey form
  if (modalEl.querySelector('#j-name')) {
    const placeIds = [...modalEl.querySelectorAll('[data-place-id]')]
      .filter((el) => el.checked)
      .map((el) => el.getAttribute('data-place-id'));
    return {
      kind: 'journey',
      id: editingId,
      name: v('j-name'),
      startDate: v('j-start') || null,
      endDate: v('j-end') || null,
      tags: v('j-tags')
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      placeIds
    };
  }

  const tags = modalEl.querySelector('#tag-picker')?._getTags?.() ?? [];
  // 多行日期 → 段列表（每段 start 或 start~end），逗号连接
  const segments = [];
  for (const row of modalEl.querySelectorAll('.date-row')) {
    const start = (row.querySelector('.f-date')?.value || '').trim();
    const end = (row.querySelector('.f-end')?.value || '').trim();
    if (!start) continue;
    segments.push(
      end && end !== start ? `${start}${SEGMENT_JOIN}${end}` : start
    );
  }
  const date = segments.length ? segments.join(', ') : null;

  return {
    kind: 'place',
    id: editingId,
    name: v('f-name').trim(),
    date,
    endDate: null,
    tags,
    journeyId: v('f-journey') || null
  };
}

export function closeModal() {
  modalEl?._tagCleanup?.();
  modalEl._tagCleanup = null;
  modalEl?.classList.remove('is-open');
  editingId = null;
}

export function getEditingId() {
  return editingId;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
