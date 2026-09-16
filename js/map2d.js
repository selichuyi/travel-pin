/* 2D map — MapLibre GL, local vendor lib + offline world outline */

import { lookupCityGazetteer } from './data.js?v=86';

let map = null;
let mapReady = false;
let selectHandler = null;
let pulseTimer = null;
let glowPhase = 0;
let lastRefresh = null;
let usingFallback = false;

const GEOJSON_EMPTY = {
  type: 'FeatureCollection',
  features: []
};

const WORLD_DATA = './vendor/world-110m.geojson';
const CITY_FILES = [
  './vendor/cities/japan-cities.geojson',
  './vendor/cities/us-cities.geojson'
];

/** Loaded city polygons keyed by name / nameEn (lowercased). */
let cityIndex = null;
let cityLoadPromise = null;

const COUNTRY_ALIASES = {
  日本: 'Japan',
  美国: 'United States of America',
  USA: 'United States of America',
  中国: 'China',
  法国: 'France',
  英国: 'United Kingdom',
  意大利: 'Italy',
  韩国: 'South Korea',
  泰国: 'Thailand',
  澳大利亚: 'Australia',
  加拿大: 'Canada',
  新加坡: 'Singapore',
  柬埔寨: 'Cambodia',
  老挝: 'Laos',
  缅甸: 'Myanmar',
  越南: 'Vietnam',
  马来西亚: 'Malaysia',
  印度尼西亚: 'Indonesia',
  菲律宾: 'Philippines',
  印度: 'India',
  瑞士: 'Switzerland',
  德国: 'Germany',
  西班牙: 'Spain',
  葡萄牙: 'Portugal',
  希腊: 'Greece',
  土耳其: 'Turkey',
  俄罗斯: 'Russia',
  巴西: 'Brazil',
  墨西哥: 'Mexico',
  埃及: 'Egypt',
  南非: 'South Africa',
  梵蒂冈: 'Vatican City'
};

async function loadCityIndex() {
  if (cityIndex) return cityIndex;
  if (cityLoadPromise) return cityLoadPromise;
  cityLoadPromise = (async () => {
    const index = new Map();
    for (const url of CITY_FILES) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const gj = await res.json();
        for (const f of gj.features || []) {
          const p = f.properties || {};
          const keys = [p.name, p.nameEn].filter(Boolean);
          for (const k of keys) {
            index.set(String(k).toLowerCase(), f);
          }
          // extra aliases
          if (p.name === '静冈') {
            index.set('静冈（富士山）', f);
            index.set('shizuoka / mt. fuji', f);
          }
          if (p.name === '宇治') {
            index.set('宇治/奈良', f);
            index.set('uji / nara', f);
          }
        }
      } catch (err) {
        console.warn('city file failed', url, err);
      }
    }
    cityIndex = index;
    return index;
  })();
  return cityLoadPromise;
}

function matchCityFeature(place) {
  if (!cityIndex || !place || place.level === 'country') return null;
  const keys = [place.name, place.nameEn].filter(Boolean);
  for (const k of keys) {
    const hit = cityIndex.get(String(k).toLowerCase());
    if (hit) return hit;
  }
  // try stripping parenthetical
  const bare = String(place.name || '').replace(/[（(].*?[）)]/g, '').trim();
  if (bare) {
    const hit = cityIndex.get(bare.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

const GEOCODE_CACHE_KEY = 'travel-pin:geocode-cache';

function loadGeocodeCache() {
  try {
    return JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveGeocodeCacheEntry(name, entry) {
  if (!name || !entry) return;
  try {
    const cache = loadGeocodeCache();
    cache[String(name).trim().toLowerCase()] = entry;
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

function readGeocodeCache(name) {
  if (!name) return null;
  const cache = loadGeocodeCache();
  return cache[String(name).trim().toLowerCase()] || null;
}

function lookupGazetteer(name, nameEn) {
  const cached = readGeocodeCache(name) || readGeocodeCache(nameEn);
  if (cached && cached.lat != null && cached.lng != null) return cached;
  return lookupCityGazetteer(name, nameEn);
}

/**
 * 清理与内置坐标表冲突的联网地理缓存：同名条目若偏差 >1.5°
 * （如「江西」曾被远程匹配到黑龙江），内置表优先，缓存作废。
 */
function pruneGeocodeCache() {
  try {
    const cache = loadGeocodeCache();
    let changed = false;
    for (const [key, entry] of Object.entries(cache)) {
      const gaz = lookupCityGazetteer(key);
      if (
        gaz &&
        entry &&
        (Math.abs(entry.lat - gaz.lat) > 1.5 ||
          Math.abs(entry.lng - gaz.lng) > 1.5)
      ) {
        delete cache[key];
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
    }
  } catch {
    /* ignore */
  }
}

/** Representative pins (capitals / major cities) — better than polygon bbox for multi-part countries. */
const COUNTRY_PIN_COORDS = {
  Japan: [139.6917, 35.6895],
  China: [116.4074, 39.9042],
  'South Korea': [126.978, 37.5665],
  'United States of America': [-98.5795, 39.8283],
  'United States': [-98.5795, 39.8283],
  Canada: [-106.3468, 56.1304],
  Mexico: [-102.5528, 23.6345],
  Malaysia: [101.6869, 3.139],
  Singapore: [103.8198, 1.3521],
  Thailand: [100.5018, 13.7563],
  Vietnam: [105.8342, 21.0278],
  Indonesia: [106.8456, -6.2088],
  Philippines: [120.9842, 14.5995],
  India: [77.209, 28.6139],
  Australia: [149.13, -35.2809],
  'New Zealand': [174.7633, -41.2865],
  France: [2.3522, 48.8566],
  Germany: [13.405, 52.52],
  Italy: [12.4964, 41.9028],
  'Vatican City': [12.4534, 41.9029],
  Spain: [-3.7038, 40.4168],
  Portugal: [-9.1393, 38.7223],
  'United Kingdom': [-0.1278, 51.5074],
  Netherlands: [4.9041, 52.3676],
  Belgium: [4.3517, 50.8503],
  Switzerland: [7.4474, 46.948],
  Austria: [16.3738, 48.2082],
  Greece: [23.7275, 37.9838],
  Turkey: [32.8597, 39.9334],
  Russia: [37.6173, 55.7558],
  Poland: [21.0122, 52.2297],
  Sweden: [18.0686, 59.3293],
  Norway: [10.7522, 59.9139],
  Denmark: [12.5683, 55.6761],
  Finland: [24.9384, 60.1699],
  Iceland: [-21.9426, 64.1466],
  Ireland: [-6.2603, 53.3498],
  Egypt: [31.2357, 30.0444],
  'South Africa': [28.0473, -26.2041],
  Morocco: [-6.8498, 33.9716],
  Kenya: [36.8219, -1.2921],
  Nigeria: [3.3792, 9.0765],
  Brazil: [-47.8825, -15.7942],
  Argentina: [-58.3816, -34.6037],
  Chile: [-70.6693, -33.4489],
  Peru: [-77.0428, -12.0464],
  Colombia: [-74.0721, 4.711],
  'United Arab Emirates': [54.3773, 24.4539],
  Israel: [35.2137, 31.7683],
  'Saudi Arabia': [46.7153, 24.7136]
};

const COUNTRY_ZH_TO_EN_PIN = {
  日本: 'Japan',
  中国: 'China',
  美国: 'United States of America',
  马来西亚: 'Malaysia',
  新加坡: 'Singapore',
  泰国: 'Thailand',
  越南: 'Vietnam',
  印度尼西亚: 'Indonesia',
  菲律宾: 'Philippines',
  韩国: 'South Korea',
  印度: 'India',
  澳大利亚: 'Australia',
  新西兰: 'New Zealand',
  法国: 'France',
  德国: 'Germany',
  意大利: 'Italy',
  西班牙: 'Spain',
  英国: 'United Kingdom',
  加拿大: 'Canada',
  墨西哥: 'Mexico',
  巴西: 'Brazil',
  阿根廷: 'Argentina',
  埃及: 'Egypt',
  南非: 'South Africa',
  阿联酋: 'United Arab Emirates',
  土耳其: 'Turkey',
  俄罗斯: 'Russia'
};

function pinForCountryName(name) {
  if (!name) return null;
  const en = COUNTRY_ZH_TO_EN_PIN[name] || name;
  const hit = COUNTRY_PIN_COORDS[en] || COUNTRY_PIN_COORDS[name];
  if (!hit) return null;
  return { lng: hit[0], lat: hit[1] };
}

function ringBBox(ring) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pt of ring) {
    const x = pt[0];
    const y = pt[1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    area: Math.max(0, maxX - minX) * Math.max(0, maxY - minY),
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2
  };
}

function centroidOfGeometry(geometry) {
  if (!geometry) return null;

  const collectRings = (coords, out) => {
    // Polygon coordinates: [ring, ...]; MultiPolygon: [[ring,...], ...]
    if (!coords || !coords.length) return;
    if (typeof coords[0][0] === 'number') {
      out.push(coords);
      return;
    }
    if (typeof coords[0][0][0] === 'number') {
      // polygon rings
      for (const r of coords) out.push(r);
      return;
    }
    for (const poly of coords) {
      for (const r of poly) out.push(r);
    }
  };

  const rings = [];
  collectRings(geometry.coordinates, rings);
  if (!rings.length) return null;

  // Prefer the largest outer ring (handles Malaysia peninsular vs Borneo)
  let best = null;
  for (const r of rings) {
    if (!r || r.length < 3) continue;
    const bb = ringBBox(r);
    if (!best || bb.area > best.area) best = bb;
  }
  if (!best) return null;
  return { lng: best.cx, lat: best.cy };
}

/**
 * Resolve missing lat/lng / country from built-in city & country data.
 * Returns patch fields, or null if nothing matched.
 */
export async function geocodePlace({ name, nameEn, level = 'city', country } = {}) {
  await Promise.all([loadCityIndex(), loadWorldIndex()]);
  const patch = { matched: null };

  // 1) Precise gazetteer / cache (Seoul, Incheon, Bangkok, ...)
  const gaz = lookupGazetteer(name, nameEn);
  if (gaz && level !== 'country') {
    patch.lat = gaz.lat;
    patch.lng = gaz.lng;
    patch.country = gaz.country;
    patch.continent =
      gaz.continent && gaz.continent !== '未知'
        ? gaz.continent
        : continentOfName(gaz.nameEn, gaz.country);
    patch.nameEn = gaz.nameEn;
    patch.cityName = gaz.cityName || gaz.nameEn || name;
    patch.matched = 'city';
    saveGeocodeCacheEntry(name, gaz);
    if (nameEn) saveGeocodeCacheEntry(nameEn, gaz);
    return patch;
  }

  // 2) Built-in city polygons (JP/US)
  const cityHit = matchCityFeature({ name, nameEn, level: 'city' });
  if (cityHit) {
    const c = centroidOfGeometry(cityHit.geometry);
    if (c) {
      patch.lat = c.lat;
      patch.lng = c.lng;
    }
    const p = cityHit.properties || {};
    if (p.nameEn) patch.nameEn = p.nameEn;
    if (p.country) patch.country = p.country;
    if (p.name) patch.cityName = p.name;
    if (p.country === '日本') patch.continent = '亚洲';
    if (p.country === '美国') patch.continent = '北美洲';
    patch.matched = 'city';
    if (patch.lat != null) {
      saveGeocodeCacheEntry(name, {
        lat: patch.lat,
        lng: patch.lng,
        country: patch.country,
        continent: patch.continent,
        nameEn: patch.nameEn,
        cityName: patch.cityName
      });
    }
    return patch;
  }

  // 3) Country pin — only when the name IS a country (not an unknown city)
  const looksLikeCountry =
    !!COUNTRY_ALIASES[name] ||
    !!COUNTRY_ALIASES[country] ||
    !!COUNTRY_ZH_TO_EN_PIN[name] ||
    !!lookupCityGazetteer(name) ||
    (level === 'country' && !gaz);

  if (looksLikeCountry) {
    const countryEn =
      COUNTRY_ALIASES[country] ||
      COUNTRY_ALIASES[name] ||
      nameEn ||
      country ||
      name;
    const pin =
      pinForCountryName(country) ||
      pinForCountryName(name) ||
      pinForCountryName(countryEn);
    if (pin) {
      patch.lat = pin.lat;
      patch.lng = pin.lng;
      const zh = COUNTRY_EN_TO_ZH[countryEn] || country || name;
      if (!patch.country) patch.country = COUNTRY_EN_TO_ZH[countryEn] || zh || name;
      patch.continent = continentOfCountry(
        COUNTRY_ZH_TO_EN_PIN[patch.country] || countryEn || name
      );
      if (!nameEn) patch.nameEn = COUNTRY_ZH_TO_EN_PIN[name] || countryEn || name;
      patch.matched = 'country';
      return patch;
    }
  }

  // 4) Remote lookup when local tables miss — Photon first (fast, CORS-enabled,
  //    reachable in networks where Nominatim is blocked), then Nominatim.
  //    Tries raw / parentheses-stripped / comma-split segments, ranks
  //    place-type results, caches hits, throttles misses.
  const remote = await remoteGeocode(name, country);
  if (remote) {
    patch.lat = remote.lat;
    patch.lng = remote.lng;
    patch.country = remote.country || country || '';
    patch.continent = remote.continent || '未知';
    patch.nameEn = remote.nameEn || '';
    patch.cityName = remote.cityName || name;
    patch.matched = 'remote';
    return patch;
  }

  return null;
}

/* ─── Remote geocode (Photon → Nominatim) ─── */

const GEOCODE_MISS_KEY = 'travel-pin:geocode-miss';
const GEOCODE_MISS_TTL_MS = 15 * 60 * 1000;

function loadGeocodeMiss() {
  try {
    return JSON.parse(localStorage.getItem(GEOCODE_MISS_KEY) || '{}');
  } catch {
    return {};
  }
}

function isGeocodeMissCached(name) {
  const hit = loadGeocodeMiss()[String(name || '').trim().toLowerCase()];
  return !!hit && Date.now() - hit.ts < GEOCODE_MISS_TTL_MS;
}

function saveGeocodeMiss(name) {
  const cache = loadGeocodeMiss();
  cache[String(name || '').trim().toLowerCase()] = { ts: Date.now() };
  try {
    localStorage.setItem(GEOCODE_MISS_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

/** Raw name → parentheses-stripped → comma/slash-split segments. */
function geocodeQueryVariants(name) {
  const out = [];
  const seen = new Set();
  const bare = (s) => String(s || '').replace(/[（(].*?[）)]/g, '').trim();
  const push = (s) => {
    s = String(s || '').trim();
    const k = s.toLowerCase();
    if (s.length >= 2 && !seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  };
  push(name);
  push(bare(name));
  for (const seg of String(name || '').split(/[/、，,;；]/)) push(seg);
  return out;
}

async function fetchGeocode(url, ms = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' }
    });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const ISO2_ZH = {
  cn: '中国',
  jp: '日本',
  us: '美国',
  gb: '英国',
  kr: '韩国',
  tw: '中国',
  hk: '中国',
  mo: '中国',
  th: '泰国',
  vn: '越南',
  my: '马来西亚',
  sg: '新加坡',
  id: '印度尼西亚',
  ph: '菲律宾',
  in: '印度',
  fr: '法国',
  de: '德国',
  it: '意大利',
  es: '西班牙',
  pt: '葡萄牙',
  nl: '荷兰',
  be: '比利时',
  ch: '瑞士',
  at: '奥地利',
  gr: '希腊',
  tr: '土耳其',
  ru: '俄罗斯',
  au: '澳大利亚',
  nz: '新西兰',
  ca: '加拿大',
  mx: '墨西哥',
  br: '巴西',
  ar: '阿根廷',
  cl: '智利',
  pe: '秘鲁',
  eg: '埃及',
  za: '南非',
  ma: '摩洛哥',
  ke: '肯尼亚',
  ng: '尼日利亚',
  ae: '阿联酋',
  il: '以色列',
  sa: '沙特阿拉伯',
  qa: '卡塔尔',
  se: '瑞典',
  no: '挪威',
  fi: '芬兰',
  dk: '丹麦',
  is: '冰岛',
  ie: '爱尔兰',
  pl: '波兰',
  cz: '捷克',
  hu: '匈牙利',
  ro: '罗马尼亚',
  bg: '保加利亚',
  hr: '克罗地亚'
};

const COUNTRY_ZH_TO_EN = (() => {
  const m = { ...COUNTRY_ZH_TO_EN_PIN };
  for (const [zh, en] of Object.entries(COUNTRY_ALIASES)) m[zh] = en;
  return m;
})();

const COUNTRY_EN_TO_ZH_REV = (() => {
  const m = {};
  for (const [zh, en] of Object.entries(COUNTRY_ZH_TO_EN)) {
    if (en) m[en] = zh;
  }
  return m;
})();

function countryZhOf(en, code) {
  return (
    COUNTRY_EN_TO_ZH_REV[en] || ISO2_ZH[String(code || '').toLowerCase()] || ''
  );
}

function continentOfName(en, zh) {
  const guess = COUNTRY_ZH_TO_EN[zh] || en;
  const c = continentOfCountry(zh);
  if (c && c !== '未知') return c;
  const c2 = continentOfCountry(guess);
  if (c2 && c2 !== '未知') return c2;
  return '未知';
}

const PHOTON_PLACE_TYPES = new Set([
  'city',
  'town',
  'village',
  'hamlet',
  'locality',
  'county',
  'municipality',
  'suburb',
  'neighbourhood',
  'borough',
  'state',
  'country',
  'island'
]);

function photonNameExact(query, name) {
  const norm = (s) =>
    String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[市县区镇]$/, '');
  const a = norm(query);
  const b = norm(name);
  return !!a && !!b && (a === b);
}

function photonNameMatches(query, name) {
  const norm = (s) =>
    String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[市县区镇]$/, '');
  const q = norm(query);
  const n = norm(name);
  return !!q && !!n && (n === q || n.includes(q) || q.includes(n));
}

/**
 * Rank Photon hits: place-type results dominate; exact name match outranks
 * substring hits (e.g. 东京) so "东京陵街道" never beats "东京" descendant hits.
 * Non-place features (restaurants, stations, …) are only acceptable on exact name.
 */
function pickPhotonFeature(feats, query) {
  let best = null;
  let bestScore = -1;
  for (const f of feats || []) {
    const p = f.properties || {};
    const t = String(p.type || '').toLowerCase();
    const isPlace = PHOTON_PLACE_TYPES.has(t);
    let s = isPlace ? 30 : 0;
    if (!s && t) s = 3;
    if (p.extent) s += 1;
    if (photonNameExact(query, p.name)) s += 20;
    else if (photonNameMatches(query, p.name)) s += 8;
    if (s > bestScore) {
      bestScore = s;
      best = f;
    }
  }
  if (!best) return null;
  const p = best.properties || {};
  const t = String(p.type || '').toLowerCase();
  if (!PHOTON_PLACE_TYPES.has(t) && !photonNameExact(query, p.name)) {
    return null;
  }
  return best;
}

async function photonGeocode(query) {
  const url =
    'https://photon.komoot.io/api/?limit=8&q=' + encodeURIComponent(query);
  const res = await fetchGeocode(url);
  if (!res) return null;
  const data = await res.json().catch(() => null);
  const feats = data && Array.isArray(data.features) ? data.features : [];
  const hit = pickPhotonFeature(feats, query);
  if (!hit) return null;
  const g = hit.geometry ? hit.geometry.coordinates : null;
  if (!g || g.length < 2) return null;
  const lat = Number(g[1]);
  const lng = Number(g[0]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const p = hit.properties || {};
  const name = String(p.name || query).replace(/市$/, '') || query;
  return {
    lat,
    lng,
    nameEn: name,
    cityName: p.city || name,
    countryEn: p.country || '',
    countryCode: p.countrycode || '',
    query
  };
}

async function nominatimGeocode(query, extra = '') {
  const q = extra ? `${query}, ${extra}` : query;
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' +
    encodeURIComponent(q);
  const res = await fetchGeocode(url, 3000);
  if (!res) return null;
  const list = await res.json().catch(() => null);
  const hit = Array.isArray(list) ? list[0] : null;
  if (!hit || hit.lat == null || hit.lon == null) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const addr = hit.address || {};
  const display = String(hit.display_name || '');
  const parts = display.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    lat,
    lng,
    nameEn: addr.name || parts[0] || '',
    cityName: addr.county || addr.city || query,
    countryEn: addr.country || '',
    countryCode: addr.country_code || '',
    query
  };
}

async function remoteGeocode(name, extra = '') {
  const variants = geocodeQueryVariants(name);
  if (!variants.length) return null;
  const deadline = Date.now() + 6000;

  for (const provider of [photonGeocode, nominatimGeocode]) {
    for (const v of variants) {
      if (Date.now() > deadline || isGeocodeMissCached(v)) continue;
      const hit =
        provider === photonGeocode
          ? await photonGeocode(v)
          : await nominatimGeocode(v, extra);
      if (!hit) continue;
      const country = countryZhOf(hit.countryEn, hit.countryCode);
      const entry = {
        lat: hit.lat,
        lng: hit.lng,
        nameEn: hit.nameEn || '',
        cityName: hit.cityName || name,
        country,
        continent: continentOfName(hit.countryEn, country)
      };
      saveGeocodeCacheEntry(v, entry);
      return entry;
    }
  }

  for (const v of variants) saveGeocodeMiss(v);
  return null;
}

function offlineStyle(theme) {
  const dark = theme !== 'light';
  return {
    version: 8,
    name: 'travel-pin-offline',
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      world: {
        type: 'geojson',
        data: WORLD_DATA
      },
      chinaProvinces: {
        type: 'geojson',
        data: './vendor/china-provinces.geojson'
      },
      usStates: {
        type: 'geojson',
        data: './vendor/us-states.geojson'
      }
    },
    layers: [
      {
        id: 'bg',
        type: 'background',
        paint: {
          'background-color': dark ? '#0b0d10' : '#d9e8f3'
        }
      },
      {
        id: 'countries-fill',
        type: 'fill',
        source: 'world',
        paint: {
          'fill-color': dark ? '#12151a' : '#f4f9fc',
          'fill-opacity': 1
        }
      },
      {
        id: 'countries-line',
        type: 'line',
        source: 'world',
        paint: {
          'line-color': dark ? 'rgba(242,241,237,0.10)' : 'rgba(22,50,74,0.12)',
          'line-width': 0.6
        }
      },
      {
        id: 'china-province-line',
        type: 'line',
        source: 'chinaProvinces',
        paint: {
          'line-color': dark ? 'rgba(242,241,237,0.14)' : 'rgba(22,50,74,0.16)',
          'line-width': 0.5
        }
      },
      {
        id: 'us-state-line',
        type: 'line',
        source: 'usStates',
        paint: {
          'line-color': dark ? 'rgba(242,241,237,0.14)' : 'rgba(22,50,74,0.16)',
          'line-width': 0.5
        }
      }
    ]
  };
}

function markReady() {
  if (mapReady) return;
  mapReady = true;
  window.__travelMapReady = true;
  document.getElementById('map2d-loading')?.classList.add('is-hidden');
  document.dispatchEvent(new CustomEvent('map2d-ready'));
}

export function initMap2D(container, handlers = {}) {
  selectHandler = handlers.onSelect || null;
  pruneGeocodeCache();

  if (typeof maplibregl === 'undefined') {
    failLoad(container, '地图引擎未加载（maplibregl 缺失）');
    return null;
  }

  const theme = document.documentElement.getAttribute('data-theme') || 'dark';

  try {
    map = new maplibregl.Map({
      container,
      style: offlineStyle(theme),
      center: [20, 28],
      zoom: 1.5,
      minZoom: 1,
      maxZoom: 12,
      attributionControl: true,
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: 0
    });
  } catch (err) {
    console.error('Map init failed', err);
    failLoad(container, '地图初始化失败');
    return null;
  }

  map.addControl(
    new maplibregl.NavigationControl({ showCompass: false }),
    'bottom-right'
  );

  map.on('load', () => {
    ensureLayers();
    markReady();
    startPulse();
    Promise.all([loadCityIndex(), loadWorldIndex()]).then(() => {
      if (lastRefresh) refreshMap2D(lastRefresh.data, lastRefresh.options);
    });
  });

  // Faster ready path — vector style can finish before full 'load'
  map.on('style.load', () => {
    if (mapReady) return;
    try {
      ensureLayers();
    } catch (err) {
      console.warn('ensureLayers on style.load', err);
    }
    markReady();
    startPulse();
    setTimeout(() => {
      if (lastRefresh) refreshMap2D(lastRefresh.data, lastRefresh.options);
    }, 80);
  });

  map.on('error', (e) => {
    console.warn('maplibre error', e?.error || e);
  });

  // Safety: hide loader even if tiles/sources stall
  setTimeout(() => {
    if (map && !mapReady) {
      try {
        ensureLayers();
      } catch {
        /* ignore */
      }
      markReady();
      if (lastRefresh) refreshMap2D(lastRefresh.data, lastRefresh.options);
    }
  }, 1200);

  map.on('click', (e) => {
    const feat = pickPlaceFeature(e);
    if (feat?.properties?.id) {
      selectHandler?.(feat.properties);
      return;
    }
    // Japan cities sit very close — fall back to nearest pin before "add place"
    const near = pickNearestPlace(e, 56);
    if (near) {
      selectHandler?.({
        id: near.id,
        name: near.name,
        country: near.country,
        journeyId: near.journeyId || '',
        date: near.date || '',
        days: near.days != null && near.days > 0 ? near.days : null
      });
    }
  });

  map.on('mousemove', (e) => {
    const pid =
      pickPlaceFeature(e)?.properties?.id ||
      pickNearestPlace(e, 24)?.id ||
      null;
    map.getCanvas().style.cursor = pid ? 'pointer' : '';
    showHoverLabel(pid);
  });

  map.getCanvas().addEventListener('mouseleave', () => showHoverLabel(null));

  map.on('zoomend', onMapZoomForLabels);
  map.on('moveend', onMapZoomForLabels);

  window.addEventListener('travel-theme', (e) => {
    if (!map) return;
    const next = e.detail.theme === 'light' ? 'light' : 'dark';
    // Update paint in place — full setStyle drops overlay layers and can
    // leave pins missing if style.load does not re-fire reliably.
    switchThemePaint(next);
    document.dispatchEvent(new CustomEvent('map2d-style-ready'));
  });

  return {
    refresh: refreshMap2D,
    flyTo,
    resize: () => map?.resize(),
    destroy: () => {
      stopPulse();
      map?.remove();
      map = null;
      mapReady = false;
    }
  };
}

function failLoad(container, message) {
  const el = document.getElementById('map2d-loading');
  if (el) {
    el.textContent = message;
    el.classList.remove('is-hidden');
    el.style.opacity = '1';
  }
  container.dataset.error = message;
}

const COUNTRY_EN_TO_ZH = {
  Japan: '日本',
  China: '中国',
  'South Korea': '韩国',
  'North Korea': '朝鲜',
  'United States of America': '美国',
  'United States': '美国',
  Canada: '加拿大',
  Mexico: '墨西哥',
  Brazil: '巴西',
  Argentina: '阿根廷',
  Chile: '智利',
  Peru: '秘鲁',
  France: '法国',
  Germany: '德国',
  Italy: '意大利',
  'Vatican City': '梵蒂冈',
  Spain: '西班牙',
  Portugal: '葡萄牙',
  'United Kingdom': '英国',
  Netherlands: '荷兰',
  Belgium: '比利时',
  Switzerland: '瑞士',
  Austria: '奥地利',
  Greece: '希腊',
  Turkey: '土耳其',
  Russia: '俄罗斯',
  Thailand: '泰国',
  Vietnam: '越南',
  Malaysia: '马来西亚',
  Singapore: '新加坡',
  Indonesia: '印度尼西亚',
  Philippines: '菲律宾',
  India: '印度',
  Australia: '澳大利亚',
  'New Zealand': '新西兰',
  Egypt: '埃及',
  'South Africa': '南非',
  Morocco: '摩洛哥',
  Kenya: '肯尼亚',
  'United Arab Emirates': '阿联酋',
  Israel: '以色列',
  Iceland: '冰岛',
  Norway: '挪威',
  Sweden: '瑞典',
  Finland: '芬兰',
  Denmark: '丹麦',
  Poland: '波兰',
  'Czech Republic': '捷克',
  Hungary: '匈牙利',
  Ireland: '爱尔兰',
  Ukraine: '乌克兰'
};

const CONTINENT_COUNTRIES = {
  亚洲: [
    'Japan','China','South Korea','North Korea','Thailand','Vietnam','Malaysia',
    'Singapore','Indonesia','Philippines','India','Taiwan','Mongolia','Nepal',
    'Cambodia','Laos','Myanmar','Bangladesh','Pakistan','Sri Lanka','Kazakhstan',
    'Uzbekistan','Iran','Iraq','Saudi Arabia','Yemen','Oman','United Arab Emirates',
    'Qatar','Kuwait','Jordan','Israel','Lebanon','Syria','Afghanistan','Turkmenistan'
  ],
  欧洲: [
    'France','Germany','Italy','Spain','Portugal','United Kingdom','Netherlands',
    'Belgium','Switzerland','Austria','Greece','Turkey','Russia','Poland',
    'Czech Republic','Hungary','Ireland','Ukraine','Norway','Sweden','Finland',
    'Denmark','Iceland','Romania','Bulgaria','Croatia','Serbia','Slovakia',
    'Slovenia','Estonia','Latvia','Lithuania','Belarus','Moldova','Albania',
    'North Macedonia','Bosnia and Herzegovina','Montenegro','Luxembourg',
    'Malta','Cyprus','Andorra','Monaco','Liechtenstein','San Marino','Kosovo'
  ],
  北美洲: [
    'United States of America','United States','Canada','Mexico','Cuba',
    'Jamaica','Haiti','Dominican Republic','Guatemala','Honduras','Nicaragua',
    'Costa Rica','Panama','Belize','El Salvador','Bahamas','Puerto Rico'
  ],
  南美洲: [
    'Brazil','Argentina','Chile','Peru','Colombia','Venezuela','Ecuador',
    'Bolivia','Paraguay','Uruguay','Guyana','Suriname','Falkland Is.'
  ],
  非洲: [
    'Egypt','South Africa','Morocco','Kenya','Nigeria','Ethiopia','Ghana',
    'Tanzania','Uganda','Algeria','Tunisia','Libya','Sudan','Senegal','Ivory Coast',
    'Cameroon','Angola','Mozambique','Zimbabwe','Zambia','Namibia','Botswana',
    'Madagascar','Rwanda','Burundi','Somalia','Eritrea','Chad','Mali','Niger'
  ],
  大洋洲: [
    'Australia','New Zealand','Fiji','Papua New Guinea','Solomon Is.','Vanuatu',
    'Samoa','Tonga','Kiribati','Micronesia','Palau','Marshall Is.','Nauru','Tuvalu'
  ]
};

function continentOfCountry(en) {
  for (const [cont, list] of Object.entries(CONTINENT_COUNTRIES)) {
    if (list.includes(en)) return cont;
  }
  // rough ISO-style fallback via worldIndex aliases not available; default
  return '未知';
}

function pickPlaceFeature(e) {
  if (!mapReady || !map) return null;
  const candidates = [
    'places-hit',
    'places-core',
    'places-city',
    'places-mid',
    'places-rim'
  ];
  const layers = candidates.filter((id) => {
    try {
      return !!map.getLayer(id);
    } catch {
      return false;
    }
  });
  if (!layers.length) return null;
  try {
    const feats = map.queryRenderedFeatures(e.point, { layers });
    if (!feats.length) return null;
    // Prefer actual place pins over city footprint fills
    const pins = feats.filter(
      (f) =>
        f.properties?.id &&
        typeof f.layer?.id === 'string' &&
        f.layer.id.startsWith('places-')
    );
    if (pins.length === 1) return pins[0];
    if (pins.length > 1) {
      // Choose the pin whose coordinates are closest to the click
      let best = pins[0];
      let bestD = Infinity;
      for (const f of pins) {
        const c = f.geometry?.coordinates;
        if (!c || !Number.isFinite(c[0])) continue;
        let pt;
        try {
          pt = map.project(c);
        } catch {
          continue;
        }
        const d = Math.hypot(pt.x - e.point.x, pt.y - e.point.y);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      return best;
    }
    const withId = feats.find((f) => f.properties?.id);
    return withId || feats[0];
  } catch {
    return null;
  }
}

function pickNearestPlace(e, maxPx = 48) {
  if (!map) return null;
  const places =
    lastRefresh?.options?.places ||
    lastRefresh?.data?.places ||
    [];
  let best = null;
  let bestDist = maxPx;
  for (const p of places) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.lat === 0 && p.lng === 0) continue;
    let pt;
    try {
      pt = map.project([p.lng, p.lat]);
    } catch {
      continue;
    }
    const d = Math.hypot(pt.x - e.point.x, pt.y - e.point.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function ensureLayers() {
  if (!map) return;
  const c = themeColors();

  if (!map.getSource('journeys')) {
    map.addSource('journeys', { type: 'geojson', data: GEOJSON_EMPTY });
  }
  if (!map.getSource('places')) {
    map.addSource('places', { type: 'geojson', data: GEOJSON_EMPTY });
  }
  if (!map.getSource('places-glow')) {
    map.addSource('places-glow', { type: 'geojson', data: GEOJSON_EMPTY });
  }
  if (!map.getSource('country-heat')) {
    map.addSource('country-heat', { type: 'geojson', data: GEOJSON_EMPTY });
  }

  // Drop outline highlight layers if they exist from older builds
  for (const id of [
    'country-visited',
    'country-visited-line',
    'cities-glow',
    'cities-fill',
    'cities-line',
    'place-labels'
  ]) {
    try {
      if (map.getLayer(id)) map.removeLayer(id);
    } catch {
      /* ignore */
    }
  }
  for (const src of ['city-hl', 'country-hl']) {
    try {
      if (map.getSource(src)) map.removeSource(src);
    } catch {
      /* ignore */
    }
  }

  if (!map.getLayer('journey-arcs')) {
    map.addLayer({
      id: 'journey-arcs',
      type: 'line',
      source: 'journeys',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': c.accent,
        'line-width': 1.4,
        'line-opacity': 0.72,
        'line-blur': 0.4
      }
    });
  }

  // 每国点亮数热力填充——插在国界线之下，颜色随 count 加深
  if (!map.getLayer('country-heat-fill')) {
    map.addLayer(
      {
        id: 'country-heat-fill',
        type: 'fill',
        source: 'country-heat',
        paint: { 'fill-color': heatPaint(c.heat || c.accent) }
      },
      'countries-line'
    );
  }

  // 1) Outer city bloom — large soft gold, reads as the illuminated urban footprint
  if (!map.getLayer('places-city')) {
    map.addLayer({
      id: 'places-city',
      type: 'circle',
      source: 'places-glow',
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          ['case', ['boolean', ['feature-state', 'selected'], false], 13.5, 9],
          4,
          ['case', ['boolean', ['feature-state', 'selected'], false], 27, 18],
          8,
          ['case', ['boolean', ['feature-state', 'selected'], false], 42, 28.5],
          11,
          ['case', ['boolean', ['feature-state', 'selected'], false], 54, 39]
        ],
        'circle-color': c.accent,
        'circle-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          0.2,
          4,
          0.28,
          8,
          0.34
        ],
        'circle-blur': 1.35
      }
    });
  }

  // 2) Mid bloom — tighter halo inside the city footprint
  if (!map.getLayer('places-mid')) {
    map.addLayer({
      id: 'places-mid',
      type: 'circle',
      source: 'places-glow',
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          ['case', ['boolean', ['feature-state', 'selected'], false], 6.8, 4.5],
          4,
          ['case', ['boolean', ['feature-state', 'selected'], false], 12, 8.3],
          8,
          ['case', ['boolean', ['feature-state', 'selected'], false], 18, 12.8],
          11,
          ['case', ['boolean', ['feature-state', 'selected'], false], 22.5, 16.5]
        ],
        'circle-color': c.accent,
        'circle-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          0.35,
          8,
          0.42
        ],
        'circle-blur': 0.65
      }
    });
  }

  // 3) Thin gold rim around the core — defines the "point"
  if (!map.getLayer('places-rim')) {
    map.addLayer({
      id: 'places-rim',
      type: 'circle',
      source: 'places',
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          ['case', ['boolean', ['feature-state', 'selected'], false], 3.6, 2.5],
          5,
          ['case', ['boolean', ['feature-state', 'selected'], false], 5.6, 3.9],
          10,
          ['case', ['boolean', ['feature-state', 'selected'], false], 7, 4.9]
        ],
        'circle-color': c.coreStroke,
        'circle-opacity': 0.95,
        'circle-blur': 0.15
      }
    });
  }

  // 4) Dark city center — the deeper point inside the lit shape
  if (!map.getLayer('places-core')) {
    map.addLayer({
      id: 'places-core',
      type: 'circle',
      source: 'places',
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          ['case', ['boolean', ['feature-state', 'selected'], false], 2.4, 1.5],
          5,
          ['case', ['boolean', ['feature-state', 'selected'], false], 3.5, 2.4],
          10,
          ['case', ['boolean', ['feature-state', 'selected'], false], 4.6, 3.1]
        ],
        'circle-color': c.core,
        'circle-opacity': 0.92,
        'circle-stroke-width': 0
      }
    });
  }

  if (!map.getLayer('places-hit')) {
    map.addLayer({
      id: 'places-hit',
      type: 'circle',
      source: 'places',
      paint: {
        // Large invisible hit target — critical for clustered Japan cities
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          18,
          5,
          28,
          9,
          36,
          12,
          44
        ],
        // Nearly transparent: fully 0 can be skipped by hit-tests in some builds
        'circle-color': 'rgba(0,0,0,0.01)',
        'circle-opacity': 0.01
      }
    });
  }

  // CJK city names need system fonts — MapLibre glyph PBFs here lack CJK.
  // Labels are drawn as HTML markers instead of a symbol layer.
  if (map.getLayer('place-labels')) {
    try {
      map.removeLayer('place-labels');
    } catch {
      /* ignore */
    }
  }
}

function getCss(varName) {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  if (raw) return raw;
  // Fallbacks if CSS variables are not resolved yet
  const fallback = {
    '--accent': '#c8a96a',
    '--bg': '#0b0d10',
    '--text-secondary': '#a8aeb8'
  };
  return fallback[varName] || '#c8a96a';
}

/* ─── 国家点亮热力填充 ─── */

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 按点亮数分级的 fill-color 表达式，色相沿用主题 accent，透明度随计数加深。 */
function heatPaint(accentHex) {
  const [r, g, b] = hexRgb(accentHex) || [200, 169, 106];
  const stops = [
    [1, 0.1],
    [2, 0.17],
    [3, 0.25],
    [5, 0.35],
    [8, 0.48]
  ];
  const expr = ['interpolate', ['linear'], ['get', 'count']];
  for (const [count, alpha] of stops) {
    expr.push(count, `rgba(${r},${g},${b},${Math.min(0.62, alpha)})`);
  }
  return expr;
}

function heatFeatureFor(p) {
  const cands = [COUNTRY_ZH_TO_EN[p.country], p.countryEn, p.nameEn];
  for (const c of cands) {
    if (!c) continue;
    const f = worldIndex.get(String(c).toLowerCase());
    if (f) return f;
  }
  return null;
}

function buildCountryHeatGeoJSON(places) {
  const features = [];
  if (!worldIndex) return { type: 'FeatureCollection', features };
  const counts = new Map();
  for (const p of places || []) {
    const f = heatFeatureFor(p);
    if (!f) continue;
    const next = (counts.get(f) || 0) + 1;
    counts.set(f, next);
    // 台湾是中国的一部分：点亮中国时台湾一并计入
    const fName = String(
      f.properties?.name || f.properties?.NAME || ''
    ).toLowerCase();
    if (fName === 'china') {
      const tw = worldIndex.get('taiwan');
      if (tw) counts.set(tw, next);
    }
  }
  for (const [f, count] of counts) {
    features.push({
      type: 'Feature',
      properties: { count },
      geometry: f.geometry
    });
  }
  return { type: 'FeatureCollection', features };
}

function themeColors() {
  const light =
    (document.documentElement.getAttribute('data-theme') || 'dark') === 'light';
  return {
    light,
    bg: light ? '#d9e8f3' : '#0b0d10',
    land: light ? '#f4f9fc' : '#12151a',
    border: light ? 'rgba(22,50,74,0.12)' : 'rgba(242,241,237,0.10)',
    accent: light ? '#a67c3d' : '#c8a96a',
    // 点亮国家填充：日间与夜间同为金色（蓝色底 + 金点缀）
    heat: light ? '#a67c3d' : '#c8a96a',
    // City core: deep ink / dark gold so it reads against the bloom
    core: light ? '#3d2a14' : '#120e08',
    coreStroke: light ? '#a67c3d' : '#e8d4a8',
    label: light ? '#5a7389' : '#a8aeb8'
  };
}

function applyThemePaint() {
  if (!map) return;
  const c = themeColors();
  const set = (layer, prop, value) => {
    try {
      if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value);
    } catch {
      /* layer missing */
    }
  };
  set('bg', 'background-color', c.bg);
  set('countries-fill', 'fill-color', c.land);
  set('countries-line', 'line-color', c.border);
  set(
    'china-province-line',
    'line-color',
    c.light ? 'rgba(22,50,74,0.16)' : 'rgba(242,241,237,0.14)'
  );
  set(
    'us-state-line',
    'line-color',
    c.light ? 'rgba(22,50,74,0.16)' : 'rgba(242,241,237,0.14)'
  );
  set('country-heat-fill', 'fill-color', heatPaint(c.heat || c.accent));
  set('journey-arcs', 'line-color', c.accent);
  set('places-city', 'circle-color', c.accent);
  set('places-mid', 'circle-color', c.accent);
  set('places-rim', 'circle-color', c.coreStroke);
  set('places-core', 'circle-color', c.core);
}

function switchThemePaint(theme) {
  if (!map) return;
  const c =
    theme === 'light'
      ? {
          bg: '#d9e8f3',
          land: '#f4f9fc',
          border: 'rgba(22,50,74,0.12)',
          accent: '#a67c3d',
          heat: '#a67c3d',
          core: '#3d2a14',
          coreStroke: '#a67c3d',
          label: '#5a7389'
        }
      : {
          bg: '#0b0d10',
          land: '#12151a',
          border: 'rgba(242,241,237,0.10)',
          accent: '#c8a96a',
          heat: '#c8a96a',
          core: '#120e08',
          coreStroke: '#e8d4a8',
          label: '#a8aeb8'
        };

  const set = (layer, prop, value) => {
    try {
      if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value);
    } catch {
      /* ignore */
    }
  };

  set('bg', 'background-color', c.bg);
  set('countries-fill', 'fill-color', c.land);
  set('countries-line', 'line-color', c.border);
  set(
    'china-province-line',
    'line-color',
    theme === 'light' ? 'rgba(22,50,74,0.16)' : 'rgba(242,241,237,0.14)'
  );
  set(
    'us-state-line',
    'line-color',
    theme === 'light' ? 'rgba(22,50,74,0.16)' : 'rgba(242,241,237,0.14)'
  );
  set('country-heat-fill', 'fill-color', heatPaint(c.heat || c.accent));
  set('journey-arcs', 'line-color', c.accent);
  set('places-city', 'circle-color', c.accent);
  set('places-mid', 'circle-color', c.accent);
  set('places-rim', 'circle-color', c.coreStroke);
  set('places-core', 'circle-color', c.core);

  try {
    ensureLayers();
  } catch (err) {
    console.warn('ensureLayers after theme', err);
  }
  if (lastRefresh) {
    refreshMap2D(lastRefresh.data, lastRefresh.options);
  }
}

function buildPlacesGeoJSON(places) {
  return {
    type: 'FeatureCollection',
    features: places.map((p) => ({
      type: 'Feature',
      id: p.id,
      properties: {
        id: p.id,
        name: p.name,
        country: p.country,
        continent: p.continent,
        date: p.date || '',
        days: p.days || 1,
        journeyId: p.journeyId || '',
        tags: (p.tags || []).join(' · ')
      },
      geometry: {
        type: 'Point',
        coordinates: [p.lng, p.lat]
      }
    }))
  };
}

function buildJourneysGeoJSON(data) {
  const features = [];
  for (const j of data.journeys || []) {
    const byId = new Map((data.places || []).map((p) => [p.id, p]));
    const path = j.placeIds.map((id) => byId.get(id)).filter(Boolean);
    for (let i = 0; i < path.length - 1; i++) {
      features.push({
        type: 'Feature',
        properties: {
          journeyId: j.id,
          name: j.name
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [path[i].lng, path[i].lat],
            [path[i + 1].lng, path[i + 1].lat]
          ]
        }
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

let worldIndex = null;
let worldLoadPromise = null;

async function loadWorldIndex() {
  if (worldIndex) return worldIndex;
  if (worldLoadPromise) return worldLoadPromise;
  worldLoadPromise = (async () => {
    try {
      const res = await fetch(WORLD_DATA);
      const gj = await res.json();
      const mapIdx = new Map();
      for (const f of gj.features || []) {
        const name = f.properties?.name || f.properties?.NAME || '';
        const iso = f.properties?.iso_a2 || f.properties?.ISO_A2 || '';
        if (name) mapIdx.set(String(name).toLowerCase(), f);
        if (iso && iso !== '-99') mapIdx.set(String(iso).toLowerCase(), f);
      }
      worldIndex = mapIdx;
    } catch (err) {
      console.warn('world index failed', err);
      worldIndex = new Map();
    }
    return worldIndex;
  })();
  return worldLoadPromise;
}

let labelMarkers = [];
let labeledPlaces = [];
let labelEls = new Map();

function clearLabelMarkers() {
  for (const m of labelMarkers) {
    try {
      m.remove();
    } catch {
      /* ignore */
    }
  }
  labelMarkers = [];
  labelEls.clear();
}

/** 只亮起悬停针脚对应的地名标签，其余保持隐藏。 */
function showHoverLabel(id) {
  for (const [pid, el] of labelEls) {
    el.classList.toggle('is-hovered', pid === id);
  }
}

function updateLabelMarkers(places, selectedId = null) {
  if (!map) return;
  clearLabelMarkers();
  labeledPlaces = places || [];

  for (const p of places || []) {
    if (!p || !p.name) continue;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    // skip (0,0) placeholders
    if (p.lat === 0 && p.lng === 0) continue;

    const el = document.createElement('div');
    el.className =
      'place-label' + (p.id === selectedId ? ' is-selected' : '');
    // 视觉内容放内层：maplibre 会给外层写内联 opacity:1，CSS 显隐只能作用在内层
    const inner = document.createElement('div');
    inner.className = 'place-label-inner';
    inner.textContent = p.name;
    el.appendChild(inner);

    const marker = new maplibregl.Marker({
      element: el,
      anchor: 'bottom',
      offset: [0, -10]
    })
      .setLngLat([p.lng, p.lat])
      .addTo(map);
    labelMarkers.push(marker);
    if (p.id) labelEls.set(p.id, el);
  }
  window.__travelLabelCount = labelMarkers.length;
}

function onMapZoomForLabels() {
  if (!lastRefresh) return;
  const places =
    lastRefresh.options.places || lastRefresh.data.places || [];
  const selectedId = lastRefresh.options.selectedId || null;
  const pinPlaces = places.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
  );
  updateLabelMarkers(pinPlaces, selectedId);
}

export function refreshMap2D(data, options = {}) {
  if (!map || !mapReady) return;
  lastRefresh = { data, options };
  const places = options.places || data.places || [];
  const journeys =
    options.journeys !== undefined ? options.journeys : data.journeys;
  const selectedId = options.selectedId || null;

  ensureLayers();

  // Simple pins only — every place with coords gets a glowing pin
  // (no city/country outline fills).
  const pinPlaces = places.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
  );

  const placeFc = buildPlacesGeoJSON(pinPlaces);
  const journeyFc = buildJourneysGeoJSON({
    ...data,
    places,
    journeys: journeys || []
  });
  const heatFc = buildCountryHeatGeoJSON(pinPlaces);

  map.getSource('places')?.setData(placeFc);
  map.getSource('places-glow')?.setData(placeFc);
  map.getSource('journeys')?.setData(journeyFc);
  map.getSource('country-heat')?.setData(heatFc);

  updateLabelMarkers(pinPlaces, selectedId);
  window.__travelRefresh = {
    pin: pinPlaces.length,
    ready: mapReady,
    zoom: map ? map.getZoom() : null,
    names: pinPlaces.map((p) => p.name).slice(0, 8)
  };
  window.__travelHeat = heatFc.features.map((f) => ({
    count: f.properties.count
  }));

  for (const p of pinPlaces) {
    try {
      map.setFeatureState(
        { source: 'places', id: p.id },
        { selected: p.id === selectedId }
      );
      map.setFeatureState(
        { source: 'places-glow', id: p.id },
        { selected: p.id === selectedId }
      );
    } catch {
      /* feature may not be loaded yet */
    }
  }

  if (options.fit && places.length) {
    const bounds = new maplibregl.LngLatBounds();
    for (const p of places) {
      if (p.lat || p.lng) bounds.extend([p.lng, p.lat]);
    }
    map.fitBounds(bounds, {
      padding: { top: 60, bottom: 80, left: 60, right: 60 },
      maxZoom: 5,
      duration: 900
    });
  }

  applyThemePaint();
}

function startPulse() {
  stopPulse();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;

  pulseTimer = setInterval(() => {
    glowPhase = (glowPhase + 0.06) % (Math.PI * 2);
    if (!map || !mapReady || !map.getLayer('places-city')) return;
    const t = (Math.sin(glowPhase) + 1) / 2; // 0..1
    try {
      // City bloom breathes
      map.setPaintProperty('places-city', 'circle-opacity', [
        'interpolate',
        ['linear'],
        ['zoom'],
        1,
        0.16 + t * 0.08,
        4,
        0.22 + t * 0.1,
        8,
        0.28 + t * 0.1
      ]);
      map.setPaintProperty('places-city', 'circle-radius', [
        'interpolate',
        ['linear'],
        ['zoom'],
        1,
        ['case', ['boolean', ['feature-state', 'selected'], false], 12 + t * 3, 8.3 + t * 1.5],
        4,
        ['case', ['boolean', ['feature-state', 'selected'], false], 24 + t * 6, 16.5 + t * 3],
        8,
        ['case', ['boolean', ['feature-state', 'selected'], false], 37.5 + t * 9, 25.5 + t * 6],
        11,
        ['case', ['boolean', ['feature-state', 'selected'], false], 49.5 + t * 9, 36 + t * 6]
      ]);
      // Mid halo soft pulse
      map.setPaintProperty('places-mid', 'circle-opacity', [
        'interpolate',
        ['linear'],
        ['zoom'],
        1,
        0.28 + t * 0.12,
        8,
        0.34 + t * 0.12
      ]);
    } catch {
      /* style not ready */
    }
  }, 90);
}

function stopPulse() {
  if (pulseTimer) {
    clearInterval(pulseTimer);
    pulseTimer = null;
  }
}

export function flyTo(lng, lat, zoom = null) {
  if (!map) return;
  if (zoom != null && Number.isFinite(zoom)) {
    map.flyTo({ center: [lng, lat], zoom, duration: 1000 });
  } else {
    // 未指定 zoom：仅平移居中，保持当前缩放级别
    map.easeTo({ center: [lng, lat], duration: 800 });
  }
}

export function isMap2DReady() {
  return mapReady;
}
