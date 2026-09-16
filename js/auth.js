/* Travel Pin — 读写分离:公开站点只读,登录(或本地开发)后可编辑。
 *
 * 数据与代码完全分离:
 *   - 代码/示例数据:公开仓库(GitHub / Cloudflare Pages 同源部署)
 *   - 线上真实数据:只存在 Cloudflare KV 中,经 Pages Functions 读写
 *   - 本地开发(serve.py):视为可信环境,始终可编辑
 *
 * 接口全部同源(方案 A,无需跨域,CORS 都省了):
 *   POST /api/authorize   密码 → 24h token(仅线上存在;本地不调用)
 *   POST /api/save        带 Bearer token(线上)/ 免鉴权(本地 serve.py)
 *   GET  /api/data        线上读 KV(访客读取;本地走 data/travel.json)
 *
 * 前端永不含密码和长期密钥:都只在登录时由你输入、浏览器临时持有。
 */

const TOKEN_KEY = 'travel-pin:token';

export function isLocalDev() {
  return ['localhost', '127.0.0.1'].includes(location.hostname);
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function isEditMode() {
  if (isLocalDev()) return true;
  return !!getToken();
}

/** 线上专用:密码 → 短期 token。 */
export async function apiAuthorize(password) {
  const res = await fetch('/api/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(out.error || `HTTP ${res.status}`);
    err.code = res.status;
    throw err;
  }
  return out.token;
}

