/* Travel Pin — data model, sample seed, persistence */

import { isLocalDev } from './auth.js?v=86';

const STORAGE_KEY = 'travel-pin:v3';

/* ─── 标签注册表：受控词表（初始 长居/旅行/文化 + 用户新建）─── */

const TAGS_KEY = 'travel-pin:tags';
export const BASE_TAGS = ['长居', '旅行', '文化'];

export function loadTagRegistry() {
  try {
    const raw = localStorage.getItem(TAGS_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr)) {
      return [
        ...new Set([
          ...BASE_TAGS,
          ...arr.map((t) => String(t).trim()).filter(Boolean)
        ])
      ];
    }
  } catch {
    /* ignore */
  }
  return [...BASE_TAGS];
}

export function saveTagRegistry(tags) {
  try {
    localStorage.setItem(TAGS_KEY, JSON.stringify([...new Set(tags)]));
  } catch {
    /* ignore */
  }
}

export function addTagToRegistry(tag) {
  const t = String(tag ?? '').trim();
  const list = loadTagRegistry();
  if (t && !list.includes(t)) {
    list.push(t);
    saveTagRegistry(list);
  }
  return list;
}

/** 不在注册表里的旧标签统一归入「旅行」。 */
function foldDataTags(data, registry) {
  const foldList = (tags) => [
    ...new Set((tags || []).map((t) => (registry.includes(t) ? t : '旅行')))
  ];
  for (const p of data.places || []) p.tags = foldList(p.tags);
  for (const j of data.journeys || []) j.tags = foldList(j.tags);
}

/** 首次运行：初始化注册表，并把历史数据里的旧标签归并到三个初始标签。 */
export function ensureTagMigration(data) {
  let initialized = false;
  try {
    initialized = localStorage.getItem(TAGS_KEY) != null;
  } catch {
    initialized = true;
  }
  if (initialized) return false;
  saveTagRegistry(BASE_TAGS);
  const before = JSON.stringify([
    (data.places || []).map((p) => p.tags),
    (data.journeys || []).map((j) => j.tags)
  ]);
  foldDataTags(data, BASE_TAGS);
  const after = JSON.stringify([
    (data.places || []).map((p) => p.tags),
    (data.journeys || []).map((j) => j.tags)
  ]);
  return before !== after;
}

/* 开源仓库中的示例数据(脱敏):明显虚构,不包含任何真实足迹。
 * 你部署后的线上真实数据存在 Cloudflare KV 中,与这里无关。 */
const SAMPLE_DATA = {
  places: [
    {
      id: 'p-demo-tokyo',
      name: '示例·东京',
      nameEn: 'Demo Tokyo',
      country: '日本',
      countryCode: 'JP',
      continent: '亚洲',
      lat: 35.6762,
      lng: 139.6503,
      date: '2030-04-10',
      endDate: '2030-04-12',
      days: 3,
      tags: ['旅行'],
      journeyId: 'j-demo-jp'
    },
    {
      id: 'p-demo-paris',
      name: '示例·巴黎',
      nameEn: 'Demo Paris',
      country: '法国',
      countryCode: 'FR',
      continent: '欧洲',
      lat: 48.8566,
      lng: 2.3522,
      date: '2030-05-06',
      endDate: '2030-05-08',
      days: 3,
      tags: ['旅行'],
      journeyId: 'j-demo-fr'
    }
  ],
  journeys: [
    {
      id: 'j-demo-jp',
      name: '示例旅程 · 日本',
      startDate: '2030-04-10',
      endDate: '2030-04-12',
      placeIds: ['p-demo-tokyo'],
      tags: ['旅行']
    },
    {
      id: 'j-demo-fr',
      name: '示例旅程 · 巴黎',
      startDate: '2030-05-06',
      endDate: '2030-05-08',
      placeIds: ['p-demo-paris'],
      tags: ['旅行']
    }
  ]
};

export function createEmptyData() {
  return { places: [], journeys: [] };
}

export function cloneSample() {
  const inline = document.getElementById('default-travel-data');
  if (inline?.textContent) {
    try {
      return JSON.parse(inline.textContent);
    } catch (err) {
      console.warn('inline default data parse failed', err);
    }
  }
  return JSON.parse(JSON.stringify(SAMPLE_DATA));
}

export function clearAllTravelStorage() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('travel-pin:')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function normalizeData(raw) {
  const data = raw && typeof raw === 'object' ? raw : createEmptyData();
  return {
    places: Array.isArray(data.places) ? data.places.map(normalizePlace) : [],
    journeys: Array.isArray(data.journeys)
      ? data.journeys.map(normalizeJourney)
      : []
  };
}

function isFullDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Days rule:
 * - explicit positive days wins
 * - multi-visit date lists / start~end ranges sum their full-date segments
 * - incomplete dates (year / month only) → null (unable to compute)
 */
export function resolveDays({ date, endDate, days, tags } = {}) {
  if (Number.isFinite(days) && days > 0) return days;

  const segs = parseDateSegments(date);
  if (segs.length > 1 || (date || '').includes(SEGMENT_JOIN)) {
    let total = 0;
    let anyFull = false;
    for (const { start, end } of segs) {
      if (!isFullDate(start)) continue;
      total += Math.max(1, daysBetween(start, end || start));
      anyFull = true;
    }
    return anyFull ? total : null;
  }

  const start = date;
  const end = endDate || date;
  if (!isFullDate(start) || !isFullDate(end)) return null;
  return Math.max(1, daysBetween(start, end));
}

function normalizePlace(p, index = 0) {
  const date = normalizeDateListString(p.date);
  const isMulti =
    /[,，、;；]/.test(date || '') || (date || '').includes(SEGMENT_JOIN);
  const endDate = isMulti
    ? null
    : normalizeDateString(p.endDate) || date;
  const level = p.level === 'country' ? 'country' : 'city';
  const tags = Array.isArray(p.tags) ? p.tags.filter(Boolean) : [];
  const hasFullRange = isFullDate(date) && isFullDate(endDate || date);
  const days = resolveDays({
    date,
    endDate,
    days: hasFullRange ? p.days : null,
    tags
  });

  return {
    id: p.id || `p-${Date.now()}-${index}`,
    name: p.name || '未命名地点',
    nameEn: p.nameEn || '',
    country: p.country || '',
    countryCode: (p.countryCode || '').toUpperCase(),
    continent: p.continent || '未知',
    lat: Number(p.lat) || 0,
    lng: Number(p.lng) || 0,
    date,
    endDate,
    days,
    level,
    tags,
    journeyId: p.journeyId || null
  };
}

/** Accept YYYY / YYYY-MM / YYYY-MM-DD / YYYY-YYYY (year range). */
export function normalizeDateString(value) {
  if (value == null) return null;
  const s = String(value).trim().replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d{4}$/.test(s)) return s;
  // year range e.g. 2024-2026
  if (/^\d{4}-\d{4}$/.test(s)) {
    const [a, b] = s.split('-').map(Number);
    if (b < a) return `${b}-${a}`;
    return `${a}-${b}`;
  }
  if (/^\d{4}-\d{1,2}$/.test(s)) {
    const [y, m] = s.split('-');
    return `${y}-${m.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s || null;
}

/** 段内分隔符：一段到访的 start~end（如 2024-12-13~2024-12-14）。 */
export const SEGMENT_JOIN = '~';

/**
 * “段” = 一次到访。字符串为逗号分隔的段列表，段内可选 start~end 表示停留区间。
 * 如 "2023-08-12, 2024-12~2025-01"。
 */
export function parseDateSegments(value) {
  if (value == null) return [];
  return String(value)
    .split(/[,，、;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const [start, end] = part.includes(SEGMENT_JOIN)
        ? part.split(SEGMENT_JOIN)
        : [part, null];
      const s = normalizeDateString(start);
      const e = normalizeDateString(end);
      return { start: s, end: e && e !== s ? e : null };
    })
    .filter((seg) => seg.start);
}

/**
 * Multi-visit date list, e.g. "2023-08-12, 2024-12~2025-01"。
 * Each segment is normalized individually; joined with ", ".
 */
export function normalizeDateListString(value) {
  const segs = parseDateSegments(value);
  if (!segs.length) return null;
  return segs
    .sort((a, b) => a.start.localeCompare(b.start))
    .map(({ start, end }) => (end ? `${start}${SEGMENT_JOIN}${end}` : start))
    .join(', ');
}

export function yearOf(dateStr) {
  if (!dateStr) return null;
  return String(dateStr).slice(0, 4) || null;
}

/** All calendar years covered by a date list / range string (segments included). */
export function yearsOfDate(dateStr) {
  if (!dateStr) return [];
  const s = String(dateStr);
  if (s.includes(SEGMENT_JOIN)) {
    return [
      ...new Set(
        s.split(SEGMENT_JOIN).flatMap((part) => yearsOfDate(part.trim()))
      )
    ];
  }
  if (s.includes(',')) {
    return [
      ...new Set(s.split(',').flatMap((part) => yearsOfDate(part.trim())))
    ];
  }
  if (/^\d{4}-\d{4}$/.test(s)) {
    const [a, b] = s.split('-').map(Number);
    const out = [];
    for (let y = a; y <= b; y++) out.push(String(y));
    return out;
  }
  const y = s.slice(0, 4);
  return /^\d{4}$/.test(y) ? [y] : [];
}

export function placeCoversYear(place, year) {
  if (!year || year === 'all') return true;
  const ys = [
    ...yearsOfDate(place.date),
    ...yearsOfDate(place.endDate)
  ];
  if (!ys.length) {
    // undated places only show on "all"
    return false;
  }
  // also handle start-end spanning years without explicit range form
  const start = yearOf(place.date);
  const end = yearOf(place.endDate || place.date);
  if (start && end) {
    const a = Number(start);
    const b = Number(end);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
      const yNum = Number(year);
      if (yNum >= a && yNum <= b) return true;
    }
  }
  return ys.includes(String(year));
}

function normalizeJourney(j, index = 0) {
  return {
    id: j.id || `j-${Date.now()}-${index}`,
    name: j.name || '未命名旅程',
    startDate: j.startDate || null,
    endDate: j.endDate || null,
    placeIds: Array.isArray(j.placeIds) ? j.placeIds.slice() : [],
    tags: Array.isArray(j.tags) ? j.tags.filter(Boolean) : []
  };
}

export function daysBetween(start, end) {
  if (!start || !end) return 1;
  const a = parsePartialDate(start);
  const b = parsePartialDate(end);
  if (!a || !b) return 1;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function parsePartialDate(s) {
  if (!s) return null;
  const str = String(s);
  if (/^\d{4}$/.test(str)) return new Date(Number(str), 0, 1);
  if (/^\d{4}-\d{2}$/.test(str)) {
    const [y, m] = str.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const d = new Date(str + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Shared city coordinates — used for geocoding and auto-repairing (0,0) pins. */
export const CITY_COORD_GAZETTEER = {
  // Korea
  首尔: { lat: 37.5665, lng: 126.978, country: '韩国', continent: '亚洲', nameEn: 'Seoul' },
  seoul: { lat: 37.5665, lng: 126.978, country: '韩国', continent: '亚洲', nameEn: 'Seoul' },
  仁川: { lat: 37.4563, lng: 126.7052, country: '韩国', continent: '亚洲', nameEn: 'Incheon' },
  釜山: { lat: 35.1796, lng: 129.0756, country: '韩国', continent: '亚洲', nameEn: 'Busan' },
  济州: { lat: 33.4996, lng: 126.5312, country: '韩国', continent: '亚洲', nameEn: 'Jeju' },
  // Japan
  东京: { lat: 35.6762, lng: 139.6503, country: '日本', continent: '亚洲', nameEn: 'Tokyo' },
  大阪: { lat: 34.6937, lng: 135.5023, country: '日本', continent: '亚洲', nameEn: 'Osaka' },
  京都: { lat: 35.0116, lng: 135.7681, country: '日本', continent: '亚洲', nameEn: 'Kyoto' },
  福冈: { lat: 33.5904, lng: 130.4017, country: '日本', continent: '亚洲', nameEn: 'Fukuoka' },
  静冈: { lat: 34.9756, lng: 138.3828, country: '日本', continent: '亚洲', nameEn: 'Shizuoka' },
  奈良: { lat: 34.6851, lng: 135.8048, country: '日本', continent: '亚洲', nameEn: 'Nara' },
  宇治: { lat: 34.8893, lng: 135.8077, country: '日本', continent: '亚洲', nameEn: 'Uji' },
  横滨: { lat: 35.4437, lng: 139.638, country: '日本', continent: '亚洲', nameEn: 'Yokohama' },
  名古屋: { lat: 35.1815, lng: 136.9066, country: '日本', continent: '亚洲', nameEn: 'Nagoya' },
  札幌: { lat: 43.0618, lng: 141.3545, country: '日本', continent: '亚洲', nameEn: 'Sapporo' },
  冲绳: { lat: 26.2124, lng: 127.6809, country: '日本', continent: '亚洲', nameEn: 'Okinawa' },
  // China / Asia
  北京: { lat: 39.9042, lng: 116.4074, country: '中国', continent: '亚洲', nameEn: 'Beijing' },
  上海: { lat: 31.2304, lng: 121.4737, country: '中国', continent: '亚洲', nameEn: 'Shanghai' },
  广州: { lat: 23.1291, lng: 113.2644, country: '中国', continent: '亚洲', nameEn: 'Guangzhou' },
  深圳: { lat: 22.5431, lng: 114.0579, country: '中国', continent: '亚洲', nameEn: 'Shenzhen' },
  成都: { lat: 30.5728, lng: 104.0668, country: '中国', continent: '亚洲', nameEn: 'Chengdu' },
  杭州: { lat: 30.2741, lng: 120.1551, country: '中国', continent: '亚洲', nameEn: 'Hangzhou' },
  西安: { lat: 34.3416, lng: 108.9398, country: '中国', continent: '亚洲', nameEn: "Xi'an" },
  重庆: { lat: 29.563, lng: 106.5516, country: '中国', continent: '亚洲', nameEn: 'Chongqing' },
  武汉: { lat: 30.5928, lng: 114.3055, country: '中国', continent: '亚洲', nameEn: 'Wuhan' },
  南京: { lat: 32.0603, lng: 118.7969, country: '中国', continent: '亚洲', nameEn: 'Nanjing' },
  厦门: { lat: 24.4798, lng: 118.0894, country: '中国', continent: '亚洲', nameEn: 'Xiamen' },
  青岛: { lat: 36.0671, lng: 120.3826, country: '中国', continent: '亚洲', nameEn: 'Qingdao' },
  香港: { lat: 22.3193, lng: 114.1694, country: '中国', continent: '亚洲', nameEn: 'Hong Kong' },
  台北: { lat: 25.033, lng: 121.5654, country: '中国', continent: '亚洲', nameEn: 'Taipei' },
  曼谷: { lat: 13.7563, lng: 100.5018, country: '泰国', continent: '亚洲', nameEn: 'Bangkok' },
  清迈: { lat: 18.7883, lng: 98.9853, country: '泰国', continent: '亚洲', nameEn: 'Chiang Mai' },
  普吉: { lat: 7.8804, lng: 98.3923, country: '泰国', continent: '亚洲', nameEn: 'Phuket' },
  吉隆坡: { lat: 3.139, lng: 101.6869, country: '马来西亚', continent: '亚洲', nameEn: 'Kuala Lumpur' },
  槟城: { lat: 5.4141, lng: 100.3288, country: '马来西亚', continent: '亚洲', nameEn: 'Penang' },
  沙巴: { lat: 5.9804, lng: 116.0735, country: '马来西亚', continent: '亚洲', nameEn: 'Sabah' },
  雅加达: { lat: -6.2088, lng: 106.8456, country: '印度尼西亚', continent: '亚洲', nameEn: 'Jakarta' },
  巴厘岛: { lat: -8.4095, lng: 115.1889, country: '印度尼西亚', continent: '亚洲', nameEn: 'Bali' },
  马尼拉: { lat: 14.5995, lng: 120.9842, country: '菲律宾', continent: '亚洲', nameEn: 'Manila' },
  河内: { lat: 21.0278, lng: 105.8342, country: '越南', continent: '亚洲', nameEn: 'Hanoi' },
  胡志明市: { lat: 10.8231, lng: 106.6297, country: '越南', continent: '亚洲', nameEn: 'Ho Chi Minh City' },
  金边: { lat: 11.5564, lng: 104.9282, country: '柬埔寨', continent: '亚洲', nameEn: 'Phnom Penh' },
  柬埔寨: { lat: 11.5564, lng: 104.9282, country: '柬埔寨', continent: '亚洲', nameEn: 'Cambodia' },
  cambodia: { lat: 11.5564, lng: 104.9282, country: '柬埔寨', continent: '亚洲', nameEn: 'Cambodia' },
  老挝: { lat: 17.9757, lng: 102.6331, country: '老挝', continent: '亚洲', nameEn: 'Laos' },
  缅甸: { lat: 19.7633, lng: 96.0785, country: '缅甸', continent: '亚洲', nameEn: 'Myanmar' },
  尼泊尔: { lat: 27.7172, lng: 85.324, country: '尼泊尔', continent: '亚洲', nameEn: 'Nepal' },
  斯里兰卡: { lat: 6.9271, lng: 79.8612, country: '斯里兰卡', continent: '亚洲', nameEn: 'Sri Lanka' },
  印度: { lat: 28.6139, lng: 77.209, country: '印度', continent: '亚洲', nameEn: 'India' },
  巴基斯坦: { lat: 33.6844, lng: 73.0479, country: '巴基斯坦', continent: '亚洲', nameEn: 'Pakistan' },
  孟加拉国: { lat: 23.8103, lng: 90.4125, country: '孟加拉国', continent: '亚洲', nameEn: 'Bangladesh' },
  蒙古: { lat: 47.8864, lng: 106.9057, country: '蒙古', continent: '亚洲', nameEn: 'Mongolia' },
  哈萨克斯坦: { lat: 51.1605, lng: 71.4704, country: '哈萨克斯坦', continent: '亚洲', nameEn: 'Kazakhstan' },
  以色列: { lat: 31.7683, lng: 35.2137, country: '以色列', continent: '亚洲', nameEn: 'Israel' },
  沙特阿拉伯: { lat: 24.7136, lng: 46.7153, country: '沙特阿拉伯', continent: '亚洲', nameEn: 'Saudi Arabia' },
  卡塔尔: { lat: 25.2854, lng: 51.531, country: '卡塔尔', continent: '亚洲', nameEn: 'Qatar' },
  科威特: { lat: 29.3759, lng: 47.9774, country: '科威特', continent: '亚洲', nameEn: 'Kuwait' },
  约旦: { lat: 31.9454, lng: 35.9284, country: '约旦', continent: '亚洲', nameEn: 'Jordan' },
  黎巴嫩: { lat: 33.8938, lng: 35.5018, country: '黎巴嫩', continent: '亚洲', nameEn: 'Lebanon' },
  // countries as first-class names (capital / representative pin)
  日本: { lat: 35.6895, lng: 139.6917, country: '日本', continent: '亚洲', nameEn: 'Japan' },
  韩国: { lat: 37.5665, lng: 126.978, country: '韩国', continent: '亚洲', nameEn: 'South Korea' },
  中国: { lat: 39.9042, lng: 116.4074, country: '中国', continent: '亚洲', nameEn: 'China' },
  泰国: { lat: 13.7563, lng: 100.5018, country: '泰国', continent: '亚洲', nameEn: 'Thailand' },
  越南: { lat: 21.0278, lng: 105.8342, country: '越南', continent: '亚洲', nameEn: 'Vietnam' },
  马来西亚: { lat: 3.139, lng: 101.6869, country: '马来西亚', continent: '亚洲', nameEn: 'Malaysia' },
  印度尼西亚: { lat: -6.2088, lng: 106.8456, country: '印度尼西亚', continent: '亚洲', nameEn: 'Indonesia' },
  菲律宾: { lat: 14.5995, lng: 120.9842, country: '菲律宾', continent: '亚洲', nameEn: 'Philippines' },
  澳大利亚: { lat: -35.2809, lng: 149.13, country: '澳大利亚', continent: '大洋洲', nameEn: 'Australia' },
  新西兰: { lat: -41.2865, lng: 174.7633, country: '新西兰', continent: '大洋洲', nameEn: 'New Zealand' },
  美国: { lat: 38.9072, lng: -77.0369, country: '美国', continent: '北美洲', nameEn: 'United States' },
  加拿大: { lat: 45.4215, lng: -75.6972, country: '加拿大', continent: '北美洲', nameEn: 'Canada' },
  墨西哥: { lat: 19.4326, lng: -99.1332, country: '墨西哥', continent: '北美洲', nameEn: 'Mexico' },
  巴西: { lat: -15.7942, lng: -47.8825, country: '巴西', continent: '南美洲', nameEn: 'Brazil' },
  阿根廷: { lat: -34.6037, lng: -58.3816, country: '阿根廷', continent: '南美洲', nameEn: 'Argentina' },
  智利: { lat: -33.4489, lng: -70.6693, country: '智利', continent: '南美洲', nameEn: 'Chile' },
  秘鲁: { lat: -12.0464, lng: -77.0428, country: '秘鲁', continent: '南美洲', nameEn: 'Peru' },
  英国: { lat: 51.5074, lng: -0.1278, country: '英国', continent: '欧洲', nameEn: 'United Kingdom' },
  法国: { lat: 48.8566, lng: 2.3522, country: '法国', continent: '欧洲', nameEn: 'France' },
  德国: { lat: 52.52, lng: 13.405, country: '德国', continent: '欧洲', nameEn: 'Germany' },
  意大利: { lat: 41.9028, lng: 12.4964, country: '意大利', continent: '欧洲', nameEn: 'Italy' },
  西班牙: { lat: 40.4168, lng: -3.7038, country: '西班牙', continent: '欧洲', nameEn: 'Spain' },
  葡萄牙: { lat: 38.7223, lng: -9.1393, country: '葡萄牙', continent: '欧洲', nameEn: 'Portugal' },
  荷兰: { lat: 52.3676, lng: 4.9041, country: '荷兰', continent: '欧洲', nameEn: 'Netherlands' },
  比利时: { lat: 50.8503, lng: 4.3517, country: '比利时', continent: '欧洲', nameEn: 'Belgium' },
  奥地利: { lat: 48.2082, lng: 16.3738, country: '奥地利', continent: '欧洲', nameEn: 'Austria' },
  希腊: { lat: 37.9838, lng: 23.7275, country: '希腊', continent: '欧洲', nameEn: 'Greece' },
  土耳其: { lat: 39.9334, lng: 32.8597, country: '土耳其', continent: '欧洲', nameEn: 'Turkey' },
  俄罗斯: { lat: 55.7558, lng: 37.6173, country: '俄罗斯', continent: '欧洲', nameEn: 'Russia' },
  波兰: { lat: 52.2297, lng: 21.0122, country: '波兰', continent: '欧洲', nameEn: 'Poland' },
  捷克: { lat: 50.0755, lng: 14.4378, country: '捷克', continent: '欧洲', nameEn: 'Czechia' },
  匈牙利: { lat: 47.4979, lng: 19.0402, country: '匈牙利', continent: '欧洲', nameEn: 'Hungary' },
  瑞典: { lat: 59.3293, lng: 18.0686, country: '瑞典', continent: '欧洲', nameEn: 'Sweden' },
  挪威: { lat: 59.9139, lng: 10.7522, country: '挪威', continent: '欧洲', nameEn: 'Norway' },
  丹麦: { lat: 55.6761, lng: 12.5683, country: '丹麦', continent: '欧洲', nameEn: 'Denmark' },
  芬兰: { lat: 60.1699, lng: 24.9384, country: '芬兰', continent: '欧洲', nameEn: 'Finland' },
  爱尔兰: { lat: 53.3498, lng: -6.2603, country: '爱尔兰', continent: '欧洲', nameEn: 'Ireland' },
  冰岛: { lat: 64.1466, lng: -21.9426, country: '冰岛', continent: '欧洲', nameEn: 'Iceland' },
  埃及: { lat: 30.0444, lng: 31.2357, country: '埃及', continent: '非洲', nameEn: 'Egypt' },
  南非: { lat: -26.2041, lng: 28.0473, country: '南非', continent: '非洲', nameEn: 'South Africa' },
  摩洛哥: { lat: 33.9716, lng: -6.8498, country: '摩洛哥', continent: '非洲', nameEn: 'Morocco' },
  肯尼亚: { lat: -1.2921, lng: 36.8219, country: '肯尼亚', continent: '非洲', nameEn: 'Kenya' },
  尼日利亚: { lat: 9.0765, lng: 3.3792, country: '尼日利亚', continent: '非洲', nameEn: 'Nigeria' },
  迪拜: { lat: 25.2048, lng: 55.2708, country: '阿联酋', continent: '亚洲', nameEn: 'Dubai' },
  新加坡: { lat: 1.3521, lng: 103.8198, country: '新加坡', continent: '亚洲', nameEn: 'Singapore' },
  伊斯坦布尔: { lat: 41.0082, lng: 28.9784, country: '土耳其', continent: '欧洲', nameEn: 'Istanbul' },
  // US — major + travel-friendly
  纽约: { lat: 40.7128, lng: -74.006, country: '美国', continent: '北美洲', nameEn: 'New York' },
  旧金山: { lat: 37.7749, lng: -122.4194, country: '美国', continent: '北美洲', nameEn: 'San Francisco' },
  洛杉矶: { lat: 34.0522, lng: -118.2437, country: '美国', continent: '北美洲', nameEn: 'Los Angeles' },
  西雅图: { lat: 47.6062, lng: -122.3321, country: '美国', continent: '北美洲', nameEn: 'Seattle' },
  波特兰: { lat: 45.5152, lng: -122.6784, country: '美国', continent: '北美洲', nameEn: 'Portland' },
  拉斯维加斯: { lat: 36.1699, lng: -115.1398, country: '美国', continent: '北美洲', nameEn: 'Las Vegas' },
  芝加哥: { lat: 41.8781, lng: -87.6298, country: '美国', continent: '北美洲', nameEn: 'Chicago' },
  波士顿: { lat: 42.3601, lng: -71.0589, country: '美国', continent: '北美洲', nameEn: 'Boston' },
  伯克利: { lat: 37.8715, lng: -122.273, country: '美国', continent: '北美洲', nameEn: 'Berkeley' },
  匹兹堡: { lat: 40.4406, lng: -79.9959, country: '美国', continent: '北美洲', nameEn: 'Pittsburgh' },
  pittsburgh: { lat: 40.4406, lng: -79.9959, country: '美国', continent: '北美洲', nameEn: 'Pittsburgh' },
  费城: { lat: 39.9526, lng: -75.1652, country: '美国', continent: '北美洲', nameEn: 'Philadelphia' },
  华盛顿: { lat: 38.9072, lng: -77.0369, country: '美国', continent: '北美洲', nameEn: 'Washington DC' },
  迈阿密: { lat: 25.7617, lng: -80.1918, country: '美国', continent: '北美洲', nameEn: 'Miami' },
  奥斯汀: { lat: 30.2672, lng: -97.7431, country: '美国', continent: '北美洲', nameEn: 'Austin' },
  休斯顿: { lat: 29.7604, lng: -95.3698, country: '美国', continent: '北美洲', nameEn: 'Houston' },
  达拉斯: { lat: 32.7767, lng: -96.797, country: '美国', continent: '北美洲', nameEn: 'Dallas' },
  丹佛: { lat: 39.7392, lng: -104.9903, country: '美国', continent: '北美洲', nameEn: 'Denver' },
  圣地亚哥: { lat: 32.7157, lng: -117.1611, country: '美国', continent: '北美洲', nameEn: 'San Diego' },
  亚特兰大: { lat: 33.749, lng: -84.388, country: '美国', continent: '北美洲', nameEn: 'Atlanta' },
  底特律: { lat: 42.3314, lng: -83.0458, country: '美国', continent: '北美洲', nameEn: 'Detroit' },
  明尼阿波利斯: { lat: 44.9778, lng: -93.265, country: '美国', continent: '北美洲', nameEn: 'Minneapolis' },
  凤凰城: { lat: 33.4484, lng: -112.074, country: '美国', continent: '北美洲', nameEn: 'Phoenix' },
  新泽西: { lat: 40.0583, lng: -74.4057, country: '美国', continent: '北美洲', nameEn: 'New Jersey' },
  'new jersey': { lat: 40.0583, lng: -74.4057, country: '美国', continent: '北美洲', nameEn: 'New Jersey' },
  纽瓦克: { lat: 40.7357, lng: -74.1724, country: '美国', continent: '北美洲', nameEn: 'Newark' },
  夏威夷: { lat: 21.3069, lng: -157.8583, country: '美国', continent: '北美洲', nameEn: 'Hawaii' },
  hawaii: { lat: 21.3069, lng: -157.8583, country: '美国', continent: '北美洲', nameEn: 'Hawaii' },
  火奴鲁鲁: { lat: 21.3069, lng: -157.8583, country: '美国', continent: '北美洲', nameEn: 'Honolulu' },
  檀香山: { lat: 21.3069, lng: -157.8583, country: '美国', continent: '北美洲', nameEn: 'Honolulu' },
  honolulu: { lat: 21.3069, lng: -157.8583, country: '美国', continent: '北美洲', nameEn: 'Honolulu' },
  欧胡岛: { lat: 21.4389, lng: -158.0001, country: '美国', continent: '北美洲', nameEn: 'Oahu' },
  多伦多: { lat: 43.6532, lng: -79.3832, country: '加拿大', continent: '北美洲', nameEn: 'Toronto' },
  温哥华: { lat: 49.2827, lng: -123.1207, country: '加拿大', continent: '北美洲', nameEn: 'Vancouver' },
  蒙特利尔: { lat: 45.5017, lng: -73.5673, country: '加拿大', continent: '北美洲', nameEn: 'Montreal' },
  墨西哥城: { lat: 19.4326, lng: -99.1332, country: '墨西哥', continent: '北美洲', nameEn: 'Mexico City' },
  // South America
  里约热内卢: { lat: -22.9068, lng: -43.1729, country: '巴西', continent: '南美洲', nameEn: 'Rio de Janeiro' },
  圣保罗: { lat: -23.5505, lng: -46.6333, country: '巴西', continent: '南美洲', nameEn: 'Sao Paulo' },
  布宜诺斯艾利斯: { lat: -34.6037, lng: -58.3816, country: '阿根廷', continent: '南美洲', nameEn: 'Buenos Aires' },
  // Europe
  伦敦: { lat: 51.5074, lng: -0.1278, country: '英国', continent: '欧洲', nameEn: 'London' },
  巴黎: { lat: 48.8566, lng: 2.3522, country: '法国', continent: '欧洲', nameEn: 'Paris' },
  罗马: { lat: 41.9028, lng: 12.4964, country: '意大利', continent: '欧洲', nameEn: 'Rome' },
  梵蒂冈: { lat: 41.9029, lng: 12.4534, country: '梵蒂冈', continent: '欧洲', nameEn: 'Vatican City' },
  vatican: { lat: 41.9029, lng: 12.4534, country: '梵蒂冈', continent: '欧洲', nameEn: 'Vatican City' },
  'vatican city': { lat: 41.9029, lng: 12.4534, country: '梵蒂冈', continent: '欧洲', nameEn: 'Vatican City' },
  米兰: { lat: 45.4642, lng: 9.19, country: '意大利', continent: '欧洲', nameEn: 'Milan' },
  佛罗伦萨: { lat: 43.7696, lng: 11.2558, country: '意大利', continent: '欧洲', nameEn: 'Florence' },
  威尼斯: { lat: 45.4408, lng: 12.3155, country: '意大利', continent: '欧洲', nameEn: 'Venice' },
  柏林: { lat: 52.52, lng: 13.405, country: '德国', continent: '欧洲', nameEn: 'Berlin' },
  慕尼黑: { lat: 48.1351, lng: 11.582, country: '德国', continent: '欧洲', nameEn: 'Munich' },
  阿姆斯特丹: { lat: 52.3676, lng: 4.9041, country: '荷兰', continent: '欧洲', nameEn: 'Amsterdam' },
  巴塞罗那: { lat: 41.3874, lng: 2.1686, country: '西班牙', continent: '欧洲', nameEn: 'Barcelona' },
  马德里: { lat: 40.4168, lng: -3.7038, country: '西班牙', continent: '欧洲', nameEn: 'Madrid' },
  里斯本: { lat: 38.7223, lng: -9.1393, country: '葡萄牙', continent: '欧洲', nameEn: 'Lisbon' },
  苏黎世: { lat: 47.3769, lng: 8.5417, country: '瑞士', continent: '欧洲', nameEn: 'Zurich' },
  瑞士: { lat: 46.948, lng: 7.4474, country: '瑞士', continent: '欧洲', nameEn: 'Switzerland' },
  switzerland: { lat: 46.948, lng: 7.4474, country: '瑞士', continent: '欧洲', nameEn: 'Switzerland' },
  伯尔尼: { lat: 46.948, lng: 7.4474, country: '瑞士', continent: '欧洲', nameEn: 'Bern' },
  日内瓦: { lat: 46.2044, lng: 6.1432, country: '瑞士', continent: '欧洲', nameEn: 'Geneva' },
  维也纳: { lat: 48.2082, lng: 16.3738, country: '奥地利', continent: '欧洲', nameEn: 'Vienna' },
  布拉格: { lat: 50.0755, lng: 14.4378, country: '捷克', continent: '欧洲', nameEn: 'Prague' },
  雅典: { lat: 37.9838, lng: 23.7275, country: '希腊', continent: '欧洲', nameEn: 'Athens' },
  雷克雅未克: { lat: 64.1466, lng: -21.9426, country: '冰岛', continent: '欧洲', nameEn: 'Reykjavik' },
  // Oceania / Africa
  悉尼: { lat: -33.8688, lng: 151.2093, country: '澳大利亚', continent: '大洋洲', nameEn: 'Sydney' },
  墨尔本: { lat: -37.8136, lng: 144.9631, country: '澳大利亚', continent: '大洋洲', nameEn: 'Melbourne' },
  奥克兰: { lat: -36.8509, lng: 174.7645, country: '新西兰', continent: '大洋洲', nameEn: 'Auckland' },
  开罗: { lat: 30.0444, lng: 31.2357, country: '埃及', continent: '非洲', nameEn: 'Cairo' },
  开普敦: { lat: -33.9249, lng: 18.4241, country: '南非', continent: '非洲', nameEn: 'Cape Town' },
  内罗毕: { lat: -1.2921, lng: 36.8219, country: '肯尼亚', continent: '非洲', nameEn: 'Nairobi' },
  // 扩充：中国大陆城市 & 港澳台 (2026-09)
  天津: { lat: 39.3434, lng: 117.3616, country: '中国', continent: '亚洲', nameEn: 'Tianjin' },
  苏州: { lat: 31.2989, lng: 120.5853, country: '中国', continent: '亚洲', nameEn: 'Suzhou' },
  无锡: { lat: 31.4912, lng: 120.3119, country: '中国', continent: '亚洲', nameEn: 'Wuxi' },
  宁波: { lat: 29.8683, lng: 121.544, country: '中国', continent: '亚洲', nameEn: 'Ningbo' },
  温州: { lat: 27.9938, lng: 120.6994, country: '中国', continent: '亚洲', nameEn: 'Wenzhou' },
  福州: { lat: 26.0745, lng: 119.2965, country: '中国', continent: '亚洲', nameEn: 'Fuzhou' },
  长沙: { lat: 28.2282, lng: 112.9388, country: '中国', continent: '亚洲', nameEn: 'Changsha' },
  郑州: { lat: 34.7466, lng: 113.6254, country: '中国', continent: '亚洲', nameEn: 'Zhengzhou' },
  昆明: { lat: 24.8801, lng: 102.8329, country: '中国', continent: '亚洲', nameEn: 'Kunming' },
  云南: { lat: 25.0389, lng: 102.7183, country: '中国', continent: '亚洲', nameEn: 'Yunnan' },
  yunnan: { lat: 25.0389, lng: 102.7183, country: '中国', continent: '亚洲', nameEn: 'Yunnan' },
  山西: { lat: 37.8706, lng: 112.5489, country: '中国', continent: '亚洲', nameEn: 'Shanxi' },
  shanxi: { lat: 37.8706, lng: 112.5489, country: '中国', continent: '亚洲', nameEn: 'Shanxi' },
  山东: { lat: 36.6512, lng: 117.1201, country: '中国', continent: '亚洲', nameEn: 'Shandong' },
  shandong: { lat: 36.6512, lng: 117.1201, country: '中国', continent: '亚洲', nameEn: 'Shandong' },
  // 中国省级（取省会坐标，避免联网匹配跑偏）
  河北: { lat: 38.0428, lng: 114.5149, country: '中国', continent: '亚洲', nameEn: 'Hebei' },
  辽宁: { lat: 41.8057, lng: 123.4315, country: '中国', continent: '亚洲', nameEn: 'Liaoning' },
  吉林: { lat: 43.8171, lng: 125.3235, country: '中国', continent: '亚洲', nameEn: 'Jilin' },
  黑龙江: { lat: 45.8038, lng: 126.535, country: '中国', continent: '亚洲', nameEn: 'Heilongjiang' },
  江苏: { lat: 32.0603, lng: 118.7969, country: '中国', continent: '亚洲', nameEn: 'Jiangsu' },
  浙江: { lat: 30.2741, lng: 120.1551, country: '中国', continent: '亚洲', nameEn: 'Zhejiang' },
  安徽: { lat: 31.8206, lng: 117.2272, country: '中国', continent: '亚洲', nameEn: 'Anhui' },
  福建: { lat: 26.0745, lng: 119.2965, country: '中国', continent: '亚洲', nameEn: 'Fujian' },
  江西: { lat: 28.682, lng: 115.8579, country: '中国', continent: '亚洲', nameEn: 'Jiangxi' },
  jiangxi: { lat: 28.682, lng: 115.8579, country: '中国', continent: '亚洲', nameEn: 'Jiangxi' },
  河南: { lat: 34.7466, lng: 113.6254, country: '中国', continent: '亚洲', nameEn: 'Henan' },
  湖北: { lat: 30.5928, lng: 114.3055, country: '中国', continent: '亚洲', nameEn: 'Hubei' },
  湖南: { lat: 28.2282, lng: 112.9388, country: '中国', continent: '亚洲', nameEn: 'Hunan' },
  广东: { lat: 23.1291, lng: 113.2644, country: '中国', continent: '亚洲', nameEn: 'Guangdong' },
  海南: { lat: 20.0174, lng: 110.3492, country: '中国', continent: '亚洲', nameEn: 'Hainan' },
  四川: { lat: 30.5728, lng: 104.0668, country: '中国', continent: '亚洲', nameEn: 'Sichuan' },
  贵州: { lat: 26.647, lng: 106.6302, country: '中国', continent: '亚洲', nameEn: 'Guizhou' },
  陕西: { lat: 34.3416, lng: 108.9398, country: '中国', continent: '亚洲', nameEn: 'Shaanxi' },
  甘肃: { lat: 36.0611, lng: 103.8343, country: '中国', continent: '亚洲', nameEn: 'Gansu' },
  青海: { lat: 36.6171, lng: 101.7782, country: '中国', continent: '亚洲', nameEn: 'Qinghai' },
  台湾: { lat: 25.033, lng: 121.5654, country: '中国', continent: '亚洲', nameEn: 'Taiwan' },
  内蒙古: { lat: 40.8426, lng: 111.7492, country: '中国', continent: '亚洲', nameEn: 'Inner Mongolia' },
  广西: { lat: 22.817, lng: 108.3665, country: '中国', continent: '亚洲', nameEn: 'Guangxi' },
  西藏: { lat: 29.652, lng: 91.1721, country: '中国', continent: '亚洲', nameEn: 'Tibet' },
  宁夏: { lat: 38.4872, lng: 106.2309, country: '中国', continent: '亚洲', nameEn: 'Ningxia' },
  新疆: { lat: 43.8256, lng: 87.6168, country: '中国', continent: '亚洲', nameEn: 'Xinjiang' },
  贵阳: { lat: 26.647, lng: 106.6302, country: '中国', continent: '亚洲', nameEn: 'Guiyang' },
  南宁: { lat: 22.817, lng: 108.3665, country: '中国', continent: '亚洲', nameEn: 'Nanning' },
  哈尔滨: { lat: 45.8038, lng: 126.535, country: '中国', continent: '亚洲', nameEn: 'Harbin' },
  长春: { lat: 43.8171, lng: 125.3235, country: '中国', continent: '亚洲', nameEn: 'Changchun' },
  沈阳: { lat: 41.8057, lng: 123.4315, country: '中国', continent: '亚洲', nameEn: 'Shenyang' },
  石家庄: { lat: 38.0428, lng: 114.5149, country: '中国', continent: '亚洲', nameEn: 'Shijiazhuang' },
  太原: { lat: 37.8706, lng: 112.5489, country: '中国', continent: '亚洲', nameEn: 'Taiyuan' },
  济南: { lat: 36.6512, lng: 117.1201, country: '中国', continent: '亚洲', nameEn: 'Jinan' },
  合肥: { lat: 31.8206, lng: 117.2272, country: '中国', continent: '亚洲', nameEn: 'Hefei' },
  南昌: { lat: 28.682, lng: 115.8579, country: '中国', continent: '亚洲', nameEn: 'Nanchang' },
  三亚: { lat: 18.2528, lng: 109.5119, country: '中国', continent: '亚洲', nameEn: 'Sanya' },
  大连: { lat: 38.914, lng: 121.6147, country: '中国', continent: '亚洲', nameEn: 'Dalian' },
  乌鲁木齐: { lat: 43.8256, lng: 87.6168, country: '中国', continent: '亚洲', nameEn: 'Urumqi' },
  拉萨: { lat: 29.652, lng: 91.1721, country: '中国', continent: '亚洲', nameEn: 'Lhasa' },
  兰州: { lat: 36.0611, lng: 103.8343, country: '中国', continent: '亚洲', nameEn: 'Lanzhou' },
  西宁: { lat: 36.6171, lng: 101.7782, country: '中国', continent: '亚洲', nameEn: 'Xining' },
  银川: { lat: 38.4872, lng: 106.2309, country: '中国', continent: '亚洲', nameEn: 'Yinchuan' },
  澳门: { lat: 22.1987, lng: 113.5439, country: '中国', continent: '亚洲', nameEn: 'Macau' },
  高雄: { lat: 22.6273, lng: 120.3014, country: '中国', continent: '亚洲', nameEn: 'Kaohsiung' },
  台中: { lat: 24.1477, lng: 120.6736, country: '中国', continent: '亚洲', nameEn: 'Taichung' },
  台南: { lat: 22.9997, lng: 120.227, country: '中国', continent: '亚洲', nameEn: 'Tainan' },
  镰仓: { lat: 35.3192, lng: 139.5467, country: '日本', continent: '亚洲', nameEn: 'Kamakura' },
  箱根: { lat: 35.233, lng: 139.0527, country: '日本', continent: '亚洲', nameEn: 'Hakone' },
  轻井泽: { lat: 36.3485, lng: 138.596, country: '日本', continent: '亚洲', nameEn: 'Karuizawa' },
  长野: { lat: 36.6486, lng: 138.1947, country: '日本', continent: '亚洲', nameEn: 'Nagano' },
  金泽: { lat: 36.5613, lng: 136.6562, country: '日本', continent: '亚洲', nameEn: 'Kanazawa' },
  仙台: { lat: 38.2682, lng: 140.8694, country: '日本', continent: '亚洲', nameEn: 'Sendai' },
  长崎: { lat: 32.7503, lng: 129.8777, country: '日本', continent: '亚洲', nameEn: 'Nagasaki' },
  鹿儿岛: { lat: 31.5966, lng: 130.5577, country: '日本', continent: '亚洲', nameEn: 'Kagoshima' },
  广岛: { lat: 34.3853, lng: 132.4553, country: '日本', continent: '亚洲', nameEn: 'Hiroshima' },
  神户: { lat: 34.6901, lng: 135.1955, country: '日本', continent: '亚洲', nameEn: 'Kobe' },
  冈山: { lat: 34.6551, lng: 133.9195, country: '日本', continent: '亚洲', nameEn: 'Okayama' },
  松本: { lat: 36.238, lng: 137.9647, country: '日本', continent: '亚洲', nameEn: 'Matsumoto' },
  高松: { lat: 34.3403, lng: 134.0433, country: '日本', continent: '亚洲', nameEn: 'Takamatsu' },
  大邱: { lat: 35.8714, lng: 128.6014, country: '韩国', continent: '亚洲', nameEn: 'Daegu' },
  光州: { lat: 35.1595, lng: 126.8526, country: '韩国', continent: '亚洲', nameEn: 'Gwangju' },
  春川: { lat: 37.8813, lng: 127.73, country: '韩国', continent: '亚洲', nameEn: 'Chuncheon' },
  芭提雅: { lat: 12.9236, lng: 100.8825, country: '泰国', continent: '亚洲', nameEn: 'Pattaya' },
  苏梅岛: { lat: 9.512, lng: 100.0133, country: '泰国', continent: '亚洲', nameEn: 'Koh Samui' },
  甲米: { lat: 8.0863, lng: 98.9063, country: '泰国', continent: '亚洲', nameEn: 'Krabi' },
  拜县: { lat: 19.36, lng: 98.437, country: '泰国', continent: '亚洲', nameEn: 'Pai' },
  岘港: { lat: 16.0471, lng: 108.2064, country: '越南', continent: '亚洲', nameEn: 'Da Nang' },
  芽庄: { lat: 12.2388, lng: 109.1967, country: '越南', continent: '亚洲', nameEn: 'Nha Trang' },
  会安: { lat: 15.8803, lng: 108.338, country: '越南', continent: '亚洲', nameEn: 'Hoi An' },
  富国岛: { lat: 10.2278, lng: 103.9678, country: '越南', continent: '亚洲', nameEn: 'Phu Quoc' },
  暹粒: { lat: 13.3671, lng: 103.8448, country: '柬埔寨', continent: '亚洲', nameEn: 'Siem Reap' },
  西哈努克: { lat: 10.6099, lng: 103.5295, country: '柬埔寨', continent: '亚洲', nameEn: 'Sihanoukville' },
  万象: { lat: 17.9757, lng: 102.6331, country: '老挝', continent: '亚洲', nameEn: 'Vientiane' },
  琅勃拉邦: { lat: 19.8863, lng: 102.1354, country: '老挝', continent: '亚洲', nameEn: 'Luang Prabang' },
  仰光: { lat: 16.8409, lng: 96.1735, country: '缅甸', continent: '亚洲', nameEn: 'Yangon' },
  曼德勒: { lat: 21.9588, lng: 96.0891, country: '缅甸', continent: '亚洲', nameEn: 'Mandalay' },
  蒲甘: { lat: 21.1717, lng: 94.8581, country: '缅甸', continent: '亚洲', nameEn: 'Bagan' },
  宿务: { lat: 10.3157, lng: 123.8854, country: '菲律宾', continent: '亚洲', nameEn: 'Cebu' },
  长滩岛: { lat: 11.9674, lng: 121.9248, country: '菲律宾', continent: '亚洲', nameEn: 'Boracay' },
  马六甲: { lat: 2.1896, lng: 102.2501, country: '马来西亚', continent: '亚洲', nameEn: 'Malacca' },
  兰卡威: { lat: 6.3508, lng: 99.8101, country: '马来西亚', continent: '亚洲', nameEn: 'Langkawi' },
  日惹: { lat: -7.7956, lng: 110.3695, country: '印度尼西亚', continent: '亚洲', nameEn: 'Yogyakarta' },
  龙目岛: { lat: -8.565, lng: 116.351, country: '印度尼西亚', continent: '亚洲', nameEn: 'Lombok' },
  孟买: { lat: 19.076, lng: 72.8777, country: '印度', continent: '亚洲', nameEn: 'Mumbai' },
  新德里: { lat: 28.614, lng: 77.209, country: '印度', continent: '亚洲', nameEn: 'New Delhi' },
  德里: { lat: 28.7041, lng: 77.1025, country: '印度', continent: '亚洲', nameEn: 'Delhi' },
  斋浦尔: { lat: 26.9124, lng: 75.7873, country: '印度', continent: '亚洲', nameEn: 'Jaipur' },
  阿格拉: { lat: 27.1767, lng: 78.0081, country: '印度', continent: '亚洲', nameEn: 'Agra' },
  果阿: { lat: 15.2993, lng: 74.124, country: '印度', continent: '亚洲', nameEn: 'Goa' },
  瓦拉纳西: { lat: 25.3176, lng: 82.9739, country: '印度', continent: '亚洲', nameEn: 'Varanasi' },
  班加罗尔: { lat: 12.9716, lng: 77.5946, country: '印度', continent: '亚洲', nameEn: 'Bengaluru' },
  加德满都: { lat: 27.7172, lng: 85.324, country: '尼泊尔', continent: '亚洲', nameEn: 'Kathmandu' },
  科伦坡: { lat: 6.9271, lng: 79.8612, country: '斯里兰卡', continent: '亚洲', nameEn: 'Colombo' },
  加勒: { lat: 6.0354, lng: 80.2178, country: '斯里兰卡', continent: '亚洲', nameEn: 'Galle' },
  多哈: { lat: 25.2854, lng: 51.531, country: '卡塔尔', continent: '亚洲', nameEn: 'Doha' },
  阿布扎比: { lat: 24.4539, lng: 54.3773, country: '阿联酋', continent: '亚洲', nameEn: 'Abu Dhabi' },
  马斯喀特: { lat: 23.588, lng: 58.3829, country: '阿曼', continent: '亚洲', nameEn: 'Muscat' },
  利雅得: { lat: 24.7136, lng: 46.6753, country: '沙特阿拉伯', continent: '亚洲', nameEn: 'Riyadh' },
  安曼: { lat: 31.9454, lng: 35.9284, country: '约旦', continent: '亚洲', nameEn: 'Amman' },
  贝鲁特: { lat: 33.8938, lng: 35.5018, country: '黎巴嫩', continent: '亚洲', nameEn: 'Beirut' },
  耶路撒冷: { lat: 31.7683, lng: 35.2137, country: '以色列', continent: '亚洲', nameEn: 'Jerusalem' },
  德黑兰: { lat: 35.6892, lng: 51.389, country: '伊朗', continent: '亚洲', nameEn: 'Tehran' },
  布鲁塞尔: { lat: 50.8503, lng: 4.3517, country: '比利时', continent: '欧洲', nameEn: 'Brussels' },
  卢森堡: { lat: 49.6116, lng: 6.1319, country: '卢森堡', continent: '欧洲', nameEn: 'Luxembourg' },
  尼斯: { lat: 43.7102, lng: 7.262, country: '法国', continent: '欧洲', nameEn: 'Nice' },
  马赛: { lat: 43.2965, lng: 5.3698, country: '法国', continent: '欧洲', nameEn: 'Marseille' },
  里昂: { lat: 45.764, lng: 4.8357, country: '法国', continent: '欧洲', nameEn: 'Lyon' },
  波尔多: { lat: 44.8378, lng: -0.5792, country: '法国', continent: '欧洲', nameEn: 'Bordeaux' },
  那不勒斯: { lat: 40.8518, lng: 14.2681, country: '意大利', continent: '欧洲', nameEn: 'Naples' },
  比萨: { lat: 43.7228, lng: 10.4017, country: '意大利', continent: '欧洲', nameEn: 'Pisa' },
  热那亚: { lat: 44.4056, lng: 8.9463, country: '意大利', continent: '欧洲', nameEn: 'Genoa' },
  杜布罗夫尼克: { lat: 42.6507, lng: 18.0944, country: '克罗地亚', continent: '欧洲', nameEn: 'Dubrovnik' },
  圣托里尼: { lat: 36.3932, lng: 25.4615, country: '希腊', continent: '欧洲', nameEn: 'Santorini' },
  米科诺斯: { lat: 37.4467, lng: 25.3289, country: '希腊', continent: '欧洲', nameEn: 'Mykonos' },
  萨格勒布: { lat: 45.815, lng: 15.9819, country: '克罗地亚', continent: '欧洲', nameEn: 'Zagreb' },
  卢布尔雅那: { lat: 46.0569, lng: 14.5058, country: '斯洛文尼亚', continent: '欧洲', nameEn: 'Ljubljana' },
  贝尔格莱德: { lat: 44.7866, lng: 20.4489, country: '塞尔维亚', continent: '欧洲', nameEn: 'Belgrade' },
  布加勒斯特: { lat: 44.4268, lng: 26.1025, country: '罗马尼亚', continent: '欧洲', nameEn: 'Bucharest' },
  索菲亚: { lat: 42.6977, lng: 23.3219, country: '保加利亚', continent: '欧洲', nameEn: 'Sofia' },
  克拉科夫: { lat: 50.0647, lng: 19.945, country: '波兰', continent: '欧洲', nameEn: 'Krakow' },
  华沙: { lat: 52.2297, lng: 21.0122, country: '波兰', continent: '欧洲', nameEn: 'Warsaw' },
  爱丁堡: { lat: 55.9533, lng: -3.1883, country: '英国', continent: '欧洲', nameEn: 'Edinburgh' },
  曼彻斯特: { lat: 53.4808, lng: -2.2426, country: '英国', continent: '欧洲', nameEn: 'Manchester' },
  利物浦: { lat: 53.4084, lng: -2.9916, country: '英国', continent: '欧洲', nameEn: 'Liverpool' },
  剑桥: { lat: 52.2053, lng: 0.1218, country: '英国', continent: '欧洲', nameEn: 'Cambridge' },
  牛津: { lat: 51.752, lng: -1.2577, country: '英国', continent: '欧洲', nameEn: 'Oxford' },
  汉堡: { lat: 53.5511, lng: 9.9937, country: '德国', continent: '欧洲', nameEn: 'Hamburg' },
  法兰克福: { lat: 50.1109, lng: 8.6821, country: '德国', continent: '欧洲', nameEn: 'Frankfurt' },
  科隆: { lat: 50.9375, lng: 6.9603, country: '德国', continent: '欧洲', nameEn: 'Cologne' },
  斯图加特: { lat: 48.7758, lng: 9.1829, country: '德国', continent: '欧洲', nameEn: 'Stuttgart' },
  瓦伦西亚: { lat: 39.4699, lng: -0.3763, country: '西班牙', continent: '欧洲', nameEn: 'Valencia' },
  塞维利亚: { lat: 37.3891, lng: -5.9845, country: '西班牙', continent: '欧洲', nameEn: 'Seville' },
  格拉纳达: { lat: 37.1773, lng: -3.5986, country: '西班牙', continent: '欧洲', nameEn: 'Granada' },
  毕尔巴鄂: { lat: 43.263, lng: -2.935, country: '西班牙', continent: '欧洲', nameEn: 'Bilbao' },
  圣塞瓦斯蒂安: { lat: 43.3183, lng: -1.9812, country: '西班牙', continent: '欧洲', nameEn: 'San Sebastian' },
  波尔图: { lat: 41.1579, lng: -8.6291, country: '葡萄牙', continent: '欧洲', nameEn: 'Porto' },
  瓦莱塔: { lat: 35.8989, lng: 14.5146, country: '马耳他', continent: '欧洲', nameEn: 'Valletta' },
  尼科西亚: { lat: 35.1856, lng: 33.3823, country: '塞浦路斯', continent: '欧洲', nameEn: 'Nicosia' },
  摩纳哥: { lat: 43.7384, lng: 7.4246, country: '摩纳哥', continent: '欧洲', nameEn: 'Monaco' },
  新奥尔良: { lat: 29.9511, lng: -90.0715, country: '美国', continent: '北美洲', nameEn: 'New Orleans' },
  纳什维尔: { lat: 36.1627, lng: -86.7816, country: '美国', continent: '北美洲', nameEn: 'Nashville' },
  盐湖城: { lat: 40.7608, lng: -111.891, country: '美国', continent: '北美洲', nameEn: 'Salt Lake City' },
  圣安东尼奥: { lat: 29.4252, lng: -98.4946, country: '美国', continent: '北美洲', nameEn: 'San Antonio' },
  圣路易斯: { lat: 38.627, lng: -90.1994, country: '美国', continent: '北美洲', nameEn: 'St. Louis' },
  渥太华: { lat: 45.4215, lng: -75.6972, country: '加拿大', continent: '北美洲', nameEn: 'Ottawa' },
  卡尔加里: { lat: 51.0447, lng: -114.0719, country: '加拿大', continent: '北美洲', nameEn: 'Calgary' },
  坎昆: { lat: 21.1619, lng: -86.8515, country: '墨西哥', continent: '北美洲', nameEn: 'Cancun' },
  瓜纳华托: { lat: 21.019, lng: -101.2574, country: '墨西哥', continent: '北美洲', nameEn: 'Guanajuato' },
  哈瓦那: { lat: 23.1136, lng: -82.3666, country: '古巴', continent: '北美洲', nameEn: 'Havana' },
  波哥大: { lat: 4.711, lng: -74.0721, country: '哥伦比亚', continent: '南美洲', nameEn: 'Bogota' },
  卡塔赫纳: { lat: 10.3932, lng: -75.4832, country: '哥伦比亚', continent: '南美洲', nameEn: 'Cartagena' },
  库斯科: { lat: -13.5319, lng: -71.9675, country: '秘鲁', continent: '南美洲', nameEn: 'Cusco' },
  蒙得维的亚: { lat: -34.9011, lng: -56.1645, country: '乌拉圭', continent: '南美洲', nameEn: 'Montevideo' },
  布里斯班: { lat: -27.4705, lng: 153.026, country: '澳大利亚', continent: '大洋洲', nameEn: 'Brisbane' },
  珀斯: { lat: -31.9523, lng: 115.8613, country: '澳大利亚', continent: '大洋洲', nameEn: 'Perth' },
  阿德莱德: { lat: -34.929, lng: 138.601, country: '澳大利亚', continent: '大洋洲', nameEn: 'Adelaide' },
  惠灵顿: { lat: -41.2866, lng: 174.7758, country: '新西兰', continent: '大洋洲', nameEn: 'Wellington' },
  皇后镇: { lat: -45.0312, lng: 168.6629, country: '新西兰', continent: '大洋洲', nameEn: 'Queenstown' },
  楠迪: { lat: -17.7765, lng: 177.435, country: '斐济', continent: '大洋洲', nameEn: 'Nadi' },
  亚历山大: { lat: 31.2001, lng: 29.9187, country: '埃及', continent: '非洲', nameEn: 'Alexandria' },
  卢克索: { lat: 25.6872, lng: 32.6396, country: '埃及', continent: '非洲', nameEn: 'Luxor' },
  阿斯旺: { lat: 24.13, lng: 32.903, country: '埃及', continent: '非洲', nameEn: 'Aswan' },
  卡萨布兰卡: { lat: 33.5731, lng: -7.5898, country: '摩洛哥', continent: '非洲', nameEn: 'Casablanca' },
  马拉喀什: { lat: 31.6295, lng: -7.9811, country: '摩洛哥', continent: '非洲', nameEn: 'Marrakesh' },
  丹吉尔: { lat: 35.7595, lng: -5.834, country: '摩洛哥', continent: '非洲', nameEn: 'Tangier' },
  突尼斯: { lat: 36.8065, lng: 10.1815, country: '突尼斯', continent: '非洲', nameEn: 'Tunis' },
  阿尔及尔: { lat: 36.7538, lng: 3.0588, country: '阿尔及利亚', continent: '非洲', nameEn: 'Algiers' },
  达累斯萨拉姆: { lat: -6.7925, lng: 39.2083, country: '坦桑尼亚', continent: '非洲', nameEn: 'Dar es Salaam' },
  亚的斯亚贝巴: { lat: 9.0054, lng: 38.7636, country: '埃塞俄比亚', continent: '非洲', nameEn: 'Addis Ababa' },
  基加利: { lat: -1.9441, lng: 30.0619, country: '卢旺达', continent: '非洲', nameEn: 'Kigali' },
  乌克兰: { lat: 50.4501, lng: 30.5234, country: '乌克兰', continent: '欧洲', nameEn: 'Ukraine' },
  白俄罗斯: { lat: 53.9045, lng: 27.5615, country: '白俄罗斯', continent: '欧洲', nameEn: 'Belarus' },
  立陶宛: { lat: 54.6872, lng: 25.2797, country: '立陶宛', continent: '欧洲', nameEn: 'Lithuania' },
  拉脱维亚: { lat: 56.9496, lng: 24.1052, country: '拉脱维亚', continent: '欧洲', nameEn: 'Latvia' },
  爱沙尼亚: { lat: 59.437, lng: 24.7536, country: '爱沙尼亚', continent: '欧洲', nameEn: 'Estonia' },
  摩尔多瓦: { lat: 47.0105, lng: 28.8638, country: '摩尔多瓦', continent: '欧洲', nameEn: 'Moldova' },
  罗马尼亚: { lat: 44.4268, lng: 26.1025, country: '罗马尼亚', continent: '欧洲', nameEn: 'Romania' },
  保加利亚: { lat: 42.6977, lng: 23.3219, country: '保加利亚', continent: '欧洲', nameEn: 'Bulgaria' },
  塞尔维亚: { lat: 44.7866, lng: 20.4489, country: '塞尔维亚', continent: '欧洲', nameEn: 'Serbia' },
  克罗地亚: { lat: 45.815, lng: 15.9819, country: '克罗地亚', continent: '欧洲', nameEn: 'Croatia' },
  斯洛文尼亚: { lat: 46.0569, lng: 14.5058, country: '斯洛文尼亚', continent: '欧洲', nameEn: 'Slovenia' },
  斯洛伐克: { lat: 48.1486, lng: 17.1077, country: '斯洛伐克', continent: '欧洲', nameEn: 'Slovakia' },
  阿尔巴尼亚: { lat: 41.3275, lng: 19.8187, country: '阿尔巴尼亚', continent: '欧洲', nameEn: 'Albania' },
  北马其顿: { lat: 41.6086, lng: 21.7453, country: '北马其顿', continent: '欧洲', nameEn: 'North Macedonia' },
  波黑: { lat: 43.8563, lng: 18.4131, country: '波黑', continent: '欧洲', nameEn: 'Bosnia and Herzegovina' },
  黑山: { lat: 42.4426, lng: 19.2686, country: '黑山', continent: '欧洲', nameEn: 'Montenegro' },
  塞浦路斯: { lat: 35.1856, lng: 33.3823, country: '塞浦路斯', continent: '欧洲', nameEn: 'Cyprus' },
  马耳他: { lat: 35.8989, lng: 14.5146, country: '马耳他', continent: '欧洲', nameEn: 'Malta' },
  安道尔: { lat: 42.5063, lng: 1.5218, country: '安道尔', continent: '欧洲', nameEn: 'Andorra' },
  列支敦士登: { lat: 47.166, lng: 9.5554, country: '列支敦士登', continent: '欧洲', nameEn: 'Liechtenstein' },
  圣马力诺: { lat: 43.9424, lng: 12.4578, country: '圣马力诺', continent: '欧洲', nameEn: 'San Marino' },
  格鲁吉亚: { lat: 41.7151, lng: 44.8271, country: '格鲁吉亚', continent: '亚洲', nameEn: 'Georgia' },
  亚美尼亚: { lat: 40.1792, lng: 44.4991, country: '亚美尼亚', continent: '亚洲', nameEn: 'Armenia' },
  阿塞拜疆: { lat: 40.4093, lng: 49.8671, country: '阿塞拜疆', continent: '亚洲', nameEn: 'Azerbaijan' },
  伊朗: { lat: 35.6892, lng: 51.389, country: '伊朗', continent: '亚洲', nameEn: 'Iran' },
  伊拉克: { lat: 33.3152, lng: 44.3661, country: '伊拉克', continent: '亚洲', nameEn: 'Iraq' },
  阿曼: { lat: 23.588, lng: 58.3829, country: '阿曼', continent: '亚洲', nameEn: 'Oman' },
  也门: { lat: 15.3694, lng: 44.191, country: '也门', continent: '亚洲', nameEn: 'Yemen' },
  叙利亚: { lat: 33.5138, lng: 36.2765, country: '叙利亚', continent: '亚洲', nameEn: 'Syria' },
  阿富汗: { lat: 34.5553, lng: 69.2075, country: '阿富汗', continent: '亚洲', nameEn: 'Afghanistan' },
  乌兹别克斯坦: { lat: 41.2995, lng: 69.2401, country: '乌兹别克斯坦', continent: '亚洲', nameEn: 'Uzbekistan' },
  土库曼斯坦: { lat: 37.9601, lng: 58.3261, country: '土库曼斯坦', continent: '亚洲', nameEn: 'Turkmenistan' },
  吉尔吉斯斯坦: { lat: 42.8746, lng: 74.5698, country: '吉尔吉斯斯坦', continent: '亚洲', nameEn: 'Kyrgyzstan' },
  塔吉克斯坦: { lat: 38.5598, lng: 68.787, country: '塔吉克斯坦', continent: '亚洲', nameEn: 'Tajikistan' },
  巴林: { lat: 26.2285, lng: 50.586, country: '巴林', continent: '亚洲', nameEn: 'Bahrain' },
  哥伦比亚: { lat: 4.711, lng: -74.0721, country: '哥伦比亚', continent: '南美洲', nameEn: 'Colombia' },
  委内瑞拉: { lat: 10.4806, lng: -66.9036, country: '委内瑞拉', continent: '南美洲', nameEn: 'Venezuela' },
  厄瓜多尔: { lat: -0.1807, lng: -78.4678, country: '厄瓜多尔', continent: '南美洲', nameEn: 'Ecuador' },
  玻利维亚: { lat: -16.4897, lng: -68.1193, country: '玻利维亚', continent: '南美洲', nameEn: 'Bolivia' },
  巴拉圭: { lat: -25.2637, lng: -57.5759, country: '巴拉圭', continent: '南美洲', nameEn: 'Paraguay' },
  乌拉圭: { lat: -34.9011, lng: -56.1645, country: '乌拉圭', continent: '南美洲', nameEn: 'Uruguay' },
  圭亚那: { lat: 6.8013, lng: -58.1551, country: '圭亚那', continent: '南美洲', nameEn: 'Guyana' },
  苏里南: { lat: 5.852, lng: -55.2038, country: '苏里南', continent: '南美洲', nameEn: 'Suriname' },
  埃塞俄比亚: { lat: 9.0054, lng: 38.7636, country: '埃塞俄比亚', continent: '非洲', nameEn: 'Ethiopia' },
  坦桑尼亚: { lat: -6.7925, lng: 39.2083, country: '坦桑尼亚', continent: '非洲', nameEn: 'Tanzania' },
  乌干达: { lat: 0.3476, lng: 32.5825, country: '乌干达', continent: '非洲', nameEn: 'Uganda' },
  加纳: { lat: 5.6037, lng: -0.187, country: '加纳', continent: '非洲', nameEn: 'Ghana' },
  塞内加尔: { lat: 14.7167, lng: -17.4677, country: '塞内加尔', continent: '非洲', nameEn: 'Senegal' },
  科特迪瓦: { lat: 5.3599, lng: -4.0083, country: '科特迪瓦', continent: '非洲', nameEn: 'Ivory Coast' },
  喀麦隆: { lat: 3.848, lng: 11.5021, country: '喀麦隆', continent: '非洲', nameEn: 'Cameroon' },
  安哥拉: { lat: -8.839, lng: 13.2894, country: '安哥拉', continent: '非洲', nameEn: 'Angola' },
  莫桑比克: { lat: -25.9653, lng: 32.5885, country: '莫桑比克', continent: '非洲', nameEn: 'Mozambique' },
  津巴布韦: { lat: -17.8252, lng: 31.0335, country: '津巴布韦', continent: '非洲', nameEn: 'Zimbabwe' },
  赞比亚: { lat: -15.3875, lng: 28.3228, country: '赞比亚', continent: '非洲', nameEn: 'Zambia' },
  纳米比亚: { lat: -22.5609, lng: 17.0658, country: '纳米比亚', continent: '非洲', nameEn: 'Namibia' },
  博茨瓦纳: { lat: -24.6282, lng: 25.9231, country: '博茨瓦纳', continent: '非洲', nameEn: 'Botswana' },
  马达加斯加: { lat: -18.8792, lng: 47.5079, country: '马达加斯加', continent: '非洲', nameEn: 'Madagascar' },
  卢旺达: { lat: -1.9441, lng: 30.0619, country: '卢旺达', continent: '非洲', nameEn: 'Rwanda' },
  布隆迪: { lat: -3.3614, lng: 29.3599, country: '布隆迪', continent: '非洲', nameEn: 'Burundi' },
  斐济: { lat: -18.1416, lng: 178.441, country: '斐济', continent: '大洋洲', nameEn: 'Fiji' },
  萨摩亚: { lat: -13.8333, lng: -171.7667, country: '萨摩亚', continent: '大洋洲', nameEn: 'Samoa' },
  汤加: { lat: -21.1392, lng: -175.2049, country: '汤加', continent: '大洋洲', nameEn: 'Tonga' },
  瓦努阿图: { lat: -17.7333, lng: 168.3273, country: '瓦努阿图', continent: '大洋洲', nameEn: 'Vanuatu' },
  所罗门群岛: { lat: -9.4295, lng: 159.9495, country: '所罗门群岛', continent: '大洋洲', nameEn: 'Solomon Islands' },
};

export function lookupCityGazetteer(name, nameEn) {
  if (!name && !nameEn) return null;
  const keys = [name, nameEn]
    .filter(Boolean)
    .flatMap((n) => [
      String(n).trim(),
      String(n).trim().toLowerCase(),
      String(n).replace(/[（(].*?[）)]/g, '').trim(),
      String(n).replace(/[（(].*?[）)]/g, '').trim().toLowerCase()
    ]);
  for (const k of keys) {
    if (k && CITY_COORD_GAZETTEER[k]) return CITY_COORD_GAZETTEER[k];
  }
  return null;
}

/** One-time pin fixes + auto-repair (0,0) from gazetteer. */
function applyKnownPinFixes(places) {
  let changed = false;
  for (const p of places) {
    const fix =
      lookupCityGazetteer(p.name, p.nameEn) || null;
    if (!fix) continue;
    const bad =
      p.lat == null ||
      p.lng == null ||
      (p.lat === 0 && p.lng === 0) ||
      Math.abs(p.lat - fix.lat) > 1.5 ||
      Math.abs(p.lng - fix.lng) > 1.5;
    if (bad) {
      p.lat = fix.lat;
      p.lng = fix.lng;
      p.country = p.country || fix.country;
      p.continent =
        !p.continent || p.continent === '未知' ? fix.continent : p.continent;
      if (!p.nameEn) p.nameEn = fix.nameEn;
      if (p.level !== 'country') p.level = 'city';
      changed = true;
    }
  }
  return changed;
}

const FILE_DATA_URL = './data/travel.json';
const REMOTE_DATA_URL = '/api/data';

async function fetchFileData() {
  try {
    const res = await fetch(`${FILE_DATA_URL}?t=${Date.now()}`);
    if (!res.ok) return null;
    const raw = await res.json();
    if (Array.isArray(raw?.tags)) {
      saveTagRegistry([...loadTagRegistry(), ...raw.tags]);
    }
    const data = normalizeData(raw);
    return data.places.length ? data : null;
  } catch {
    return null;
  }
}

/** 线上真实数据:仅存在于 Cloudflare KV,经 /api/data 读取。 */
async function fetchRemoteData() {
  try {
    const res = await fetch(REMOTE_DATA_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const raw = await res.json();
    if (Array.isArray(raw?.tags)) {
      saveTagRegistry([...loadTagRegistry(), ...raw.tags]);
    }
    const data = normalizeData(raw);
    return data.places.length || data.journeys.length ? data : null;
  } catch {
    return null;
  }
}

function loadStorageData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const data = normalizeData(parsed.data && parsed.places ? parsed.data : parsed);
    return data.places.length ? data : null;
  } catch (err) {
    console.warn('Failed to load travel data', err);
    return null;
  }
}

/**
 * 加载顺序:
 *   线上 → Cloudflare KV(/api/data),优先;
 *           KV 还没来得及灌数据时回退到仓库里的脱敏示例文件,站点不至于白屏;
 *   本地 → 项目文件 data/travel.json + localStorage 合并(旧规则,编辑以本地为准)。
 */
export async function loadData() {
  const [remoteData, fileData, localData] = await Promise.all([
    isLocalDev() ? Promise.resolve(null) : fetchRemoteData(),
    fetchFileData(),
    Promise.resolve(loadStorageData())
  ]);

  if (!isLocalDev()) {
    const data = remoteData || fileData;
    if (data) {
      if (applyKnownPinFixes(data.places)) saveData(data);
      else saveData(data);
      return data;
    }
    const seeded = cloneSample();
    saveData(seeded);
    return seeded;
  }

  if (fileData && localData) {
    const useFile = fileData.places.length >= localData.places.length;
    const data = useFile ? fileData : localData;
    if (applyKnownPinFixes(data.places)) saveData(data);
    else if (useFile) saveData(data);
    return data;
  }

  if (fileData) {
    if (applyKnownPinFixes(fileData.places)) saveData(fileData);
    else saveData(fileData);
    return fileData;
  }

  if (localData) {
    if (applyKnownPinFixes(localData.places)) saveData(localData);
    return localData;
  }

  const seeded = cloneSample();
  saveData(seeded);
  return seeded;
}

/* ─── 保存即回写本地文件（File System Access API，需用户手势首次授权）─── */

let linkedFileHandle = null;
let linkHintShown = false;

export function isFileLinked() {
  return !!linkedFileHandle;
}

export function getLinkedFileName() {
  return linkedFileHandle ? linkedFileHandle.name : '';
}

/** 打开保存选择器，让用户授权要回写的数据文件（如 data/travel.json）。 */
export async function linkDataFile() {
  if (!window.showSaveFilePicker) {
    return { ok: false, reason: 'unsupported' };
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'travel.json',
      types: [
        {
          description: '旅行数据 JSON',
          accept: { 'application/json': ['.json'] }
        }
      ]
    });
    linkedFileHandle = handle;
    document.dispatchEvent(
      new CustomEvent('travel-file-link', {
        detail: { ok: true, name: handle.name }
      })
    );
    return { ok: true, name: handle.name };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: 'cancel' };
    return { ok: false, reason: 'error' };
  }
}

async function writeFileHandle(handle, data) {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

function fire(name, detail) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

export function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('Failed to save travel data', err);
    return false;
  }

  if (linkedFileHandle) {
    writeFileHandle(linkedFileHandle, data)
      .then(() => fire('travel-file-written', { name: linkedFileHandle.name }))
      .catch((err) => {
        console.warn('Failed to write back to file', err);
        fire('travel-file-write-failed', {
          message: '写回本地文件失败，已保留在浏览器数据中'
        });
      });
  } else if (!linkHintShown && window.showSaveFilePicker) {
    // 一次性引导提示（每次页面生命周期一次），引导用户关联文件
    linkHintShown = true;
    fire('travel-file-link-hint', {});
  }

  return true;
}

export function resetToSample() {
  clearAllTravelStorage();
  const seeded = cloneSample();
  saveData(seeded);
  return seeded;
}

export function exportJson(data) {
  const payload = { ...data, tags: loadTagRegistry() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `travel-pin-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function parseImport(text) {
  const raw = JSON.parse(text);
  if (Array.isArray(raw?.tags)) {
    saveTagRegistry([...loadTagRegistry(), ...raw.tags]);
  }
  const data = normalizeData(raw);
  // 注册表之外的杂散标签统一归入「旅行」
  foldDataTags(data, loadTagRegistry());
  return data;
}

export function computeStats(data) {
  const places = data.places || [];
  const countries = new Set();
  const continents = new Set();
  const years = new Set();
  let totalDays = 0;

  for (const p of places) {
    if (p.country) countries.add(p.country);
    if (p.continent && p.continent !== '未知') continents.add(p.continent);
    if (p.days != null && p.days > 0) totalDays += p.days;
    for (const y of yearsOfDate(p.date)) years.add(y);
  }

  const yearList = [...years].sort();
  const continentMap = {};
  for (const p of places) {
    const key = p.continent || '未知';
    continentMap[key] = (continentMap[key] || 0) + 1;
  }

  return {
    places: places.length,
    countries: countries.size,
    continents: continents.size,
    journeys: (data.journeys || []).length,
    totalDays,
    years: yearList,
    continentMap,
    tags: collectTags(places, data.journeys || [])
  };
}

function collectTags(places, journeys) {
  const set = new Set();
  for (const p of places) p.tags.forEach((t) => set.add(t));
  for (const j of journeys) j.tags.forEach((t) => set.add(t));
  return [...set].sort();
}

export function getJourneyPath(data, journeyId) {
  const journey = (data.journeys || []).find((j) => j.id === journeyId);
  if (!journey) return [];
  const byId = new Map((data.places || []).map((p) => [p.id, p]));
  return journey.placeIds.map((id) => byId.get(id)).filter(Boolean);
}

export function uniqueCountries(places) {
  const map = new Map();
  for (const p of places) {
    const key = p.country || p.countryCode || p.name;
    if (!map.has(key)) map.set(key, p);
  }
  return [...map.values()];
}
