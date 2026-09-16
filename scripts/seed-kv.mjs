/* 把本地真实数据初灌进 Cloudflare KV(仅属主一人执行,数据不出你的部署)。
 *
 * 用法:
 *   node scripts/seed-kv.mjs --api https://<你的项目名>.pages.dev \
 *     --password '你的编辑密码' [--file data/travel.real.json]
 *
 * 流程:读文件 → POST /api/authorize 换 token → POST /api/save 写入 KV。
 * 之后站点上的日常增删改直接走页面,无需再用本脚本。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const api = arg('--api');
const password = arg('--password');
const file = arg('--file') || join(rootDir, 'data', 'travel.real.json');

if (!api || !password) {
  console.error(
    '用法: node scripts/seed-kv.mjs --api <站点地址> --password <编辑密码> [--file 数据文件]'
  );
  process.exit(2);
}

let data;
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`读取数据文件失败(${file}): ${err.message}`);
  process.exit(1);
}
if (!Array.isArray(data.places) || !Array.isArray(data.journeys)) {
  console.error('数据文件缺少 places/journeys 数组');
  process.exit(1);
}
console.log(
  `将向 ${api} 灌入 ${data.places.length} 个地点 / ${data.journeys.length} 个旅程`
);

const base = String(api).replace(/\/+$/, '');

const authRes = await fetch(`${base}/api/authorize`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password })
});
const auth = await authRes.json().catch(() => ({}));
if (!authRes.ok || !auth.token) {
  console.error(`登录失败(${authRes.status}): ${auth.error || '未知错误'}`);
  process.exit(1);
}

const saveRes = await fetch(`${base}/api/save`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.token}`
  },
  body: JSON.stringify(data)
});
const out = await saveRes.json().catch(() => ({}));
if (!saveRes.ok) {
  console.error(`写入失败(${saveRes.status}): ${out.error || '未知错误'}`);
  process.exit(1);
}
console.log(`完成:已写入 ${out.places} 个地点。刷新站点即可看到真实数据。`);