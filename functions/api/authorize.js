import { respond, timingSafeEqual, rateLimited, signJWT } from '../_shared.js';

/* POST /api/authorize — 属主登录:密码换 24h token。限速防爆破。 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('x-forwarded-for') ||
    'unknown'
  )
    .split(',')[0]
    .trim();
  if (rateLimited(ip)) {
    return respond({ ok: false, error: 'too many attempts' }, 429);
  }

  let password = '';
  try {
    const body = await request.json();
    if (typeof body.password === 'string') password = body.password;
  } catch {
    /* 非 JSON 或缺失 → 按空密码处理 */
  }

  if (!env.EDIT_PASSWORD || !timingSafeEqual(password, env.EDIT_PASSWORD)) {
    return respond({ ok: false, error: 'invalid password' }, 401);
  }
  const token = await signJWT(env);
  return respond({ ok: true, token });
}