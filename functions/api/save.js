import { respond, verifyJWT, validatePayload } from '../_shared.js';

/* POST /api/save — 属主保存:验 token → 校验 payload → 写入 KV。
 * 真实的线上数据只存在于 KV,公开仓库里永远没有。 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !(await verifyJWT(env, token))) {
    return respond({ ok: false, error: 'unauthorized' }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond({ ok: false, error: 'invalid json' }, 400);
  }
  const invalid = validatePayload(payload);
  if (invalid) return respond({ ok: false, error: invalid }, 400);

  const clean = { places: payload.places, journeys: payload.journeys };
  if (Array.isArray(payload.tags)) clean.tags = payload.tags;

  await env.PIN_KV.put('travel', JSON.stringify(clean));
  return respond({ ok: true, places: clean.places.length });
}