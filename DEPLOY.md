# Travel Pin 部署指南（Cloudflare Pages + KV，纯本地 CLI）

目标：**任何人可浏览，只有部署者能编辑；真实数据不进公开仓库**。

```
访客 ──► Cloudflare Pages 站点(公开只读) ──► /api/data ──► KV(线上真实数据)
部署者 ─► 站点锁图标 → 密码 → 24h token ──► /api/save ──► KV
```

本仓库只含代码 + 脱敏示例数据；部署的一切(项目名/绑定/地址)都留在你本地与
Cloudflare 控制台，与 GitHub 仓库零连接。全程成本 0 元。

> 约定：下文 `<项目名>` 指你的 Pages 项目名(它决定免费子域名 `<项目名>.pages.dev`，
> 建议起成与旅行无关的随机串)。文中所有 `<…>` 占位符请按你的实际值替换，**不要**把
> 真实值写回本仓库的任何文件。

---

## 0. 前置

```bash
npm install -g wrangler          # 需要 Node.js
wrangler login                   # 浏览器授权你的 Cloudflare 账号
```

## 1. 建公开仓库(GitHub)

1. GitHub → New repository → 填仓库名 → **Public** → 不勾选任何初始化文件
2. 本地初始化并推送：

```bash
cd <你的项目目录>
git init
git add .
git commit -m "init: travel-pin (code + demo data)"
git branch -M main
git remote add origin git@github.com:<用户名>/<仓库名>.git
git push -u origin main
```

## 2. 建 KV namespace(Cloudflare 控制台)

1. dash.cloudflare.com → Workers & Pages → KV → **Create namespace**(如 `travel-pin-kv`)
2. 记下它的 **namespace ID**

## 3. 建本地部署配置 wrangler.toml(不入库)

在项目根目录创建 `wrangler.toml`，**并把它加进 `.gitignore`**(它含真实项目名/namespace ID)：

```toml
name = "<你的Pages项目名>"
pages_build_output_dir = "."
compatibility_date = "2024-11-11"

[[kv_namespaces]]
binding = "PIN_KV"
id = "<上一步的 namespace ID>"
```

## 4. 建 Pages 项目并部署(纯 CLI，不连 GitHub)

```bash
wrangler pages project create <你的Pages项目名> --production-branch main   # 只建一次
wrangler pages deploy . --project-name <你的Pages项目名>                     # 首次部署
```

> 不要用控制台的 "Connect to Git"：那样仓库与部署绑定，违背「仓库只做开源」的隔离目标。

配置机密(改后需重新部署才生效)：

```bash
printf '你的编辑密码' | wrangler pages secret put EDIT_PASSWORD --project-name <你的Pages项目名>
printf '%s' "$(openssl rand -base64 48)" | wrangler pages secret put JWT_SECRET --project-name <你的Pages项目名>
```

## 5. 灌入真实数据(一次性)

把真实数据文件放在 `data/` 下即可(已被 .gitignore 覆盖，不会进 git)，
命名随意，如 `data/travel.real.json`；再运行：

```bash
node scripts/seed-kv.mjs --api https://<你的Pages项目名>.pages.dev --password '你的编辑密码'
```

脚本自动在 `data/` 或 `~/travel-pin-backup/` 里找真实数据 → 登录 → 写入 KV。

## 6. 日常发布代码

**不要**直接 `wrangler pages deploy .`：它会把目录里所有文件(含未跟踪的真实数据)
原样公开到 CDN。请用「快照部署」——只发布已提交进 git 的文件：

```bash
git add/commit 之后运行:
STAGE=$(mktemp -d) && git archive HEAD | tar -x -C "$STAGE" \
  && wrangler pages deploy "$STAGE" --project-name <你的Pages项目名> && rm -rf "$STAGE"
```

想省事就把上面这条固化成你本地自用的 `deploy.sh`(同样加进 .gitignore，**勿入仓库**)：
项目名从本地 wrangler.toml 的 `name` 读取，不需要写死在脚本里。

## 7. 验证

- 健康检查：`https://<你的Pages项目名>.pages.dev/api/diag` → `hasKvBinding:true` 且 `kvReadable:true`
- **访客视角**：无痕窗口打开 → 能看数据，但新增/删除/导入/导出/保存全部不显示
- **属主视角**：顶栏锁图标 → 输密码 → 出现全部编辑入口 → 改一处 → 保存
  → 「已保存到线上数据（N 个地点）」→ 无痕窗口刷新可见
- 保存提示「登录已过期」→ 重新输密码(token 24 小时有效)

## 8. 本地开发(不受影响)

```bash
./start-travel-pin.sh        # 8899 端口，读本地 data/travel.json，始终可编辑
```

---

## 日常维护

- **改代码发布**：`git add/commit` 后跑本地 `deploy.sh`(快照部署)
- **换密码**：控制台改 `EDIT_PASSWORD` 或 `printf 新密码 | wrangler pages secret put EDIT_PASSWORD
  --project-name <项目名>`，**再部署一次**生效;已签发 token 最长 24h 内仍有效
- **想立刻踢掉所有登录**：换 `JWT_SECRET`(同上流程),所有 token 立废
- **备份**：访客或属主都能用顶栏「导出 JSON」;或 Chrome/Edge 编辑模式「关联数据文件」
  自动写回本地文件。KV 是线上唯一副本,无历史版本。
- **功能自检**：打开 `https://<你的Pages项目名>.pages.dev/api/data` 应返回 JSON

## 安全边界(如实)

- 前端代码公开，密码/密钥只存 Cloudflare 密文；浏览器里只有 24h 短期 token
- `/api/authorize` 同 IP 10 分钟限 10 次，防随手爆破;真正防线是密码强度 + HTTPS
- 「项目名难猜」只是降低被随手访问的概率,站点本身公开可读;若要限制访问
  (仅特定人可见),需另配 Cloudflare Access / 加访问门禁
- KV 免费额度:读 10 万次/天、写 1000 次/天,个人站绰绰有余