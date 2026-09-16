import { respond } from '../_shared.js';

/* GET /api/diag — 健康检查(公开,无敏感信息):绑定与 KV 是否生效。
 * 访客与属主都可访问;用于排查部署问题。 */
export async function onRequestGet(context) {
  const { env } = context;
  let kvWorks = false;
  let errText = null;
  try {
    const raw = await env.PIN_KV?.get('travel', 'json');
    if (raw != null) kvWorks = true;
  } catch (err) {
    errText = String(err && err.message ? err.message : err);
  }
  return respond({
    ok: true,
    hasKvBinding: !!env.PIN_KV,
    kvReadable: kvWorks,
    kvError: errText
  });
}