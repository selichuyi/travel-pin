/* Pages Functions 共享逻辑。以下划线开头的文件不会被当作路由,仅供 import。 */

const TOKEN_TTL_SECONDS = 24 * 60 * 60;
const MAX_PLACES = 5000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;

export function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export function timingSafeEqual(a, b) {
  const A = String(a || '');
  const B = String(b || '');
  const n = Math.max(A.length, B.length);
  let diff = A.length ^ B.length;
  for (let i = 0; i < n; i++) {
    diff |= (A.charCodeAt(i) || 0) ^ (B.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/* ─── JWT(HS256,无依赖) ─── */

const enc = new TextEncoder();

function b64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacSign(env, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(env.JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(data))
  );
  return b64url(sig);
}

export async function signJWT(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64url(
    enc.encode(
      JSON.stringify({ sub: 'owner', iat: now, exp: now + TOKEN_TTL_SECONDS })
    )
  );
  const sig = await hmacSign(env, `${header}.${payload}`);
  return `${header}.${payload}.${sig}`;
}

export async function verifyJWT(env, token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return false;
    const [header, payload, sig] = parts;
    const expect = await hmacSign(env, `${header}.${payload}`);
    if (expect !== sig) return false;
    const claims = JSON.parse(b64urlDecode(payload));
    if (claims.sub !== 'owner') return false;
    if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

/* ─── payload 校验 ─── */

export function validatePayload(p) {
  if (!p || !Array.isArray(p.places) || !Array.isArray(p.journeys)) {
    return 'payload must contain places/journeys arrays';
  }
  if (p.places.length > MAX_PLACES) return 'too many places';
  for (const x of p.places) {
    if (!x || typeof x !== 'object') return 'invalid place entry';
    if (typeof x.id !== 'string' || !x.id) return 'place.id required';
    if (typeof x.name !== 'string' || !x.name) return 'place.name required';
  }
  for (const j of p.journeys) {
    if (!j || typeof j !== 'object') return 'invalid journey entry';
    if (typeof j.id !== 'string' || !j.id) return 'journey.id required';
    if (j.placeIds != null && !Array.isArray(j.placeIds)) {
      return 'journey.placeIds must be an array';
    }
  }
  return null;
}

/* ─── /authorize 限速(单 isolate 内存,防随手爆破) ─── */

const attempts = new Map(); // ip → {count, windowStart}

export function rateLimited(ip) {
  const now = Date.now();
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) {
      if (now - v.windowStart > RATE_WINDOW_MS) attempts.delete(k);
    }
  }
  const rec = attempts.get(ip);
  if (!rec || now - rec.windowStart > RATE_WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_MAX;
}