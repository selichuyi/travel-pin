/* 本地验证 Pages Functions(无需真实 Cloudflare)。
 * 运行:node functions/test-local.mjs
 * 用内存 Map 模拟 KV,直接调用每个端点的 onRequest 处理器。 */

import { onRequestGet as dataGet } from './api/data.js';
import { onRequestPost as authorizePost } from './api/authorize.js';
import { onRequestPost as savePost } from './api/save.js';

const store = new Map();
const PIN_KV = {
  get: async (k, type) => (type === 'json' ? store.get(k) ?? null : store.get(k) ?? null),
  put: async (k, v) => {
    store.set(k, v);
  }
};
const ENV = {
  PIN_KV,
  EDIT_PASSWORD: 'test-pass-123',
  JWT_SECRET: 'unit-test-secret-abcdef0123456789'
};

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) {
    pass += 1;
    console.log('  ok  ' + name);
  } else {
    fail += 1;
    console.log('FAIL  ' + name);
  }
}

async function call(handler, path, { method = 'GET', body, headers } = {}) {
  const req = new Request('https://fake.site' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  return handler({ request: req, env: ENV });
}

const HEADERS = { 'x-forwarded-for': '203.0.113.9' };

/* /api/data:KV 为空 → 空数据 */
{
  const r = await dataGet({ request: new Request('https://fake.site/api/data'), env: ENV });
  ok('data empty → 200', r.status === 200);
  const j = await r.json();
  ok('data empty → places []', Array.isArray(j.places) && j.places.length === 0);
}

/* /api/authorize */
{
  const r = await call(authorizePost, '/api/authorize', {
    method: 'POST',
    headers: HEADERS,
    body: { password: 'nope' }
  });
  ok('wrong password → 401', r.status === 401);
}

let token = '';
{
  const r = await call(authorizePost, '/api/authorize', {
    method: 'POST',
    headers: HEADERS,
    body: { password: ENV.EDIT_PASSWORD }
  });
  const j = await r.json();
  ok('right password → 200', r.status === 200);
  token = j.token || '';
  ok('token is 3-part JWT', token.split('.').length === 3);
}

/* /api/save 鉴权 */
{
  const r1 = await call(savePost, '/api/save', {
    method: 'POST',
    headers: HEADERS,
    body: { places: [], journeys: [] }
  });
  ok('save without token → 401', r1.status === 401);

  const r2 = await call(savePost, '/api/save', {
    method: 'POST',
    headers: { ...HEADERS, Authorization: 'Bearer garbage' },
    body: { places: [], journeys: [] }
  });
  ok('save with fake token → 401', r2.status === 401);

  const r3 = await call(savePost, '/api/save', {
    method: 'POST',
    headers: { ...HEADERS, Authorization: 'Bearer ' + token },
    body: { places: 'nope', journeys: [] }
  });
  ok('save invalid payload → 400', r3.status === 400);
}

/* /api/save 成功 → KV 更新 → /api/data 可读回 */
const sample = {
  places: [
    {
      id: 'p-test',
      name: '测试地',
      nameEn: 'Test',
      country: '中国',
      continent: '亚洲',
      lat: 1.23,
      lng: 4.56,
      date: '2031-01-01'
    }
  ],
  journeys: [{ id: 'j-test', name: '测试旅程', placeIds: ['p-test'] }],
  tags: ['旅行']
};
{
  const r = await call(savePost, '/api/save', {
    method: 'POST',
    headers: { ...HEADERS, Authorization: 'Bearer ' + token },
    body: sample
  });
  const j = await r.json();
  ok('save valid → 200', r.status === 200);
  ok('save reports 1 place', j.places === 1);
  ok('KV got written', store.has('travel'));

  const r2 = await dataGet({ request: new Request('https://fake.site/api/data'), env: ENV });
  const back = await r2.json();
  ok('data reflects saved payload', back.places[0].id === 'p-test');
  ok('data keeps tags', back.tags[0] === '旅行');
}

/* 限速:同一 IP 连续 11 次错误密码 → 429 */
{
  let got429 = false;
  for (let i = 0; i < 12; i++) {
    const r = await call(authorizePost, '/api/authorize', {
      method: 'POST',
      headers: HEADERS,
      body: { password: 'wrong-' + i }
    });
    if (r.status === 429) got429 = true;
  }
  ok('repeated wrong passwords eventually 429', got429);
}

console.log('');
if (fail === 0) {
  console.log('PASS: ' + pass + '/' + pass);
  process.exit(0);
} else {
  console.log('FAIL: ' + fail + ' assertion(s) failed');
  process.exit(1);
}