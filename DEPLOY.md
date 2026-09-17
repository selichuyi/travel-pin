# Travel Pin 部署指南（方案 A：Cloudflare Pages + KV）

目标：**任何人可浏览，只有你能编辑；真实数据永不进公开仓库**。

```
访客 ──► Cloudflare Pages 站点(公开只读) ──► /api/data ──► KV(线上真实数据)
你   ──► 站点锁图标 → 密码 → 24h token ──► /api/save ──► KV
```

仓库里只放代码 + 脱敏示例数据(`data/travel.json` 是明显虚构的演示数据)；
**GitHub 仓库纯粹用于代码开源分享,部署完全走本地 CLI/控制台,与仓库零连接**。
部署相关信息(项目名/绑定/地址)都不进仓库——部署配置被你放在本地的 `wrangler.toml`
(已 .gitignore),真实足迹只存在于 Cloudflare KV。全程成本 0 元。

---

## 0. 前置

```bash
npm install -g wrangler        # 部署 Pages 与配置 KV 用
```

## 1. 真实数据(放哪都行,但别让部署传上去)

真实数据文件(如 `data/travel.real.json`、`data/travel.lcy.json`)放在项目 `data/` 下即可,
已被 .gitignore 覆盖、不会进 git。**但绝不要直接 `wrangler pages deploy .` 整目录部署**——
那会把未跟踪文件(含真实数据)原样公开到 CDN。统一用快照部署脚本:

```bash
./deploy.sh        # 只发布「已提交进 git」的文件,未跟踪的真实数据永远不会被上传
```

`deploy.sh` 内部用 `git archive HEAD` 取已提交快照再上传,所以顺带把 png 等杂物也排除掉了。
种子脚本默认在 `data/` 找真实数据,找不到再找 `~/travel-pin-backup/`。

## 2. GitHub：建公开仓库并推送

1. GitHub → **New repository** → `travel-pin` → **Public** → 不勾选任何初始化文件
2. 本地推送：

```bash
cd <你的项目所在目录,如 /Users/<你>/travel-pin>
git init
git add .
git commit -m "init: travel-pin (code + demo data)"
git branch -M main
git remote add origin https://github.com/<用户名>/travel-pin.git
git push -u origin main
```

推送前检查 `git status` 确认没有 `data/travel.real.json`（已在 .gitignore 里，不会上去）。

## 3. Cloudflare：创建 KV namespace

1. 登录 https://dash.cloudflare.com → **Workers & Pages → KV** → Create namespace
   - 名称建议 `travel-pin-kv` → 记下它的 **namespace ID**
2. 在本地(不入库)建立部署配置 `wrangler.toml`(仓库里的 .gitignore 已忽略它):

```toml
name = "<你的Pages项目名>"        # 即未来的子域名 <项目名>.pages.dev
pages_build_output_dir = "."
compatibility_date = "2024-11-11"

[[kv_namespaces]]
binding = "PIN_KV"
id = "<上一步的 namespace ID>"
```

## 4. Cloudflare：创建 Pages 项目并部署(纯 CLI,不连 GitHub)

```bash
wrangler pages project create travel-pin-<你的项目名> --production-branch main
# 只建一次;之后每次改完代码,用快照部署脚本(只发已提交文件,更安全):
./deploy.sh
# 等价手写命令: git archive HEAD | tar -x -C <临时目录> && wrangler pages deploy <临时目录> --project-name travel-pin-<你的项目名>
```

配置机密(改后需要重新 `wrangler pages deploy` 一次才生效):

```bash
printf '你的编辑密码' | wrangler pages secret put EDIT_PASSWORD --project-name travel-pin-<你的项目名>
printf '%s' "$(openssl rand -base64 48)" | wrangler pages secret put JWT_SECRET --project-name travel-pin-<你的项目名>
```

> ⚠️ 不要用控制台的「Connect to Git」:本项目部署与 GitHub 完全解耦,
> 仓库 push 不会自动部署,也不会让仓库里的任何信息流到 Cloudflare。
> 健康检查:`https://<你的项目名>.pages.dev/api/diag` → `hasKvBinding:true` 且 `kvReadable:true`。
>
> 提示：项目名=免费子域名,想让真实页面地址难被陌生人猜到,就把项目名起得
> 与旅行无关(如 `travel-pin-PLACEHOLDER` 这类)。这只是「地址难猜」,站点本身仍公开可读;
> 真正的访问控制需另加方案。

## 5. 灌入真实数据（一次性）

```bash
node scripts/seed-kv.mjs \
  --api https://<你的项目名>.pages.dev \
  --password '你的编辑密码'
```

脚本自动在 `~/travel-pin-backup`(或 `--file` 指定)里找真实数据 → 登录 → 写入 KV。
完成后刷新站点即可看到真实足迹。

## 6. 验证

**访客视角**：无痕窗口打开站点 → 能看到真实数据,但新增、删除、导入、恢复默认全部不可见。

**属主视角**：正常窗口 → 顶栏**锁图标** → 输密码 → 出现全部编辑入口 → 改一处 →
保存 → 「已保存到线上数据（N 个地点）」→ 无痕窗口刷新可见。

保存时若提示「登录已过期」→ 重新输密码(token 24 小时有效)。

## 7. 本地开发（完全不受影响）

```bash
./start-travel-pin.sh        # 8899 端口,读本地 data/travel.json,始终可编辑
```

---

## 日常维护

- **改代码发布**：`git add/commit` 后运行 `./deploy.sh`(只部署已提交文件)。
- **密码泄露/换密码**：改 Pages 的 `EDIT_PASSWORD` 即可,旧密码立刻失效。
- **更换 JWT_SECRET**：改后所有已签发 token 立即失效,重新登录即可。
- **KV 备份**：真实数据只在 KV。出于安全本方案删掉了远程写文件的入口,给 KV 里的
  `travel` key 定期备份的办法：打开站点 → 导出 JSON(顶栏导出按钮)存本地即可。
- **功能自检**：浏览器打开 `https://<你的项目名>.pages.dev/api/data` 应返回 JSON(你的数据)。

## 安全说明(如实交代边界)

- 前端代码公开,但**密码与密钥只存 Cloudflare 环境变量**;你浏览器里只有 24h 短期 token。
- `/api/authorize` 同一 IP 10 分钟限 10 次,防随手爆破;真正防线是密码强度 + HTTPS。
- 数据公开 = 站点内容公开(与展示目的一致)。若日后要放敏感信息(具体住址等),
  需改为密码门禁整站,届时另做。
- KV 免费额度:读 10 万次/天、写 1000 次/天 —— 个人站点绰绰有余。