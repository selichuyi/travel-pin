import { respond } from '../_shared.js';

/* GET /api/data — 公开读:返回 KV 里的线上真实数据。
 * KV 为空(未灌数据)时返回空数组,前端会回退到仓库里的脱敏示例。 */
export async function onRequestGet(context) {
  const { env } = context;
  let data = { places: [], journeys: [] };
  try {
    const raw = await env.PIN_KV.get('travel', 'json');
    if (raw) data = JSON.parse(raw);
  } catch {
    /* 损坏时返回空,下一轮保存会整体覆盖 */
  }
  return respond(data);
}