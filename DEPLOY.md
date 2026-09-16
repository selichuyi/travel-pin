# Travel Pin 部署指南（方案 A：Cloudflare Pages + KV）

目标：**任何人可浏览，只有你能编辑；真实数据永不进公开仓库**。

```
访客 ──► Cloudflare Pages 站点(公开只读) ──► /api/data ──► KV(线上真实数据)
你   ──► 站点锁图标 → 密码 → 24h token ──► /api/save ──► KV
```

仓库里只放代码 + 脱敏示例数据(`data/travel.json` 是明显虚构的演示数据)；
你的真实足迹只存在于 Cloudflare KV —— 由种子脚本初灌、由页面日常增删改。
边看边做，全程约 25 分钟，成本 0 元。

---

## 0. 前置

```bash
npm install -g wrangler        # 部署 Pages 与配置 KV 用
```

## 1. 准备真实数据（只在你本地,不进仓库）

```bash
# 本仓库已把你的真实数据备份在 data/travel.real.json(已被 .gitignore 保护)
# 确认它存在,这就是稍后灌入 KV 的数据源
ls -la data/travel.real.json
```

## 2. GitHub：建公开仓库并推送

1. GitHub → **New repository** → `travel-pin` → **Public** → 不勾选任何初始化文件
2. 本地推送：

```bash
cd /Users/mi/XiaomiMiMoProjects/travel-pin
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
2. 把 ID 填进 `wrangler.toml` 的 `[[kv_namespaces]] / id`（替换 REPLACE_WITH_YOUR_NAMESPACE_ID）
   —— 本项目绑定由 **wrangler.toml 管理**(控制台会提示无法手动添加),部署与 Git 自动构建都读它。

## 4. Cloudflare：创建 Pages 项目并部署

1. 连接 GitHub：**Workers & Pages → Create → Pages → Connect to Git**
   - 账户里选 `selichuyi` → 选择 `travel-pin` 仓库 → Framework preset 选 **None**
   - Build command 留空,Output directory 留空(仓库根目录即站点)
   - 首次 Deploy,得到站点地址 `https://travel-pin.pages.dev`
2. 配置机密：Pages 项目 → **Settings → Variables and Secrets → Secrets**
   - `EDIT_PASSWORD`：你的编辑密码(进编辑模式时输入,选长一点的)
   - `JWT_SECRET`：`openssl rand -base64 48` 生成
   - 或用 CLI:`printf '值' | wrangler pages secret put NAME --project-name travel-pin`
   - ⚠️ 改后需重新部署一次才生效(推一个 commit 或 `wrangler pages deploy`)

> 部署后仓库的每次 push 都会自动触发重新部署。
> 健康检查:`https://travel-pin.pages.dev/api/diag` —— 应显示 `hasKvBinding:true` 且 `kvReadable:true`。

## 5. 灌入真实数据（一次性）

```bash
node scripts/seed-kv.mjs \
  --api https://travel-pin.pages.dev \
  --password '你的编辑密码'
```

脚本读 `data/travel.real.json` → 登录 → 写入 KV。完成后刷新站点即可看到真实足迹。

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

- **密码泄露/换密码**：改 Pages 的 `EDIT_PASSWORD` 即可,旧密码立刻失效。
- **更换 JWT_SECRET**：改后所有已签发 token 立即失效,重新登录即可。
- **KV 备份**：真实数据只在 KV。出于安全本方案删掉了远程写文件的入口,给 KV 里的
  `travel` key 定期备份的办法：打开站点 → 导出 JSON(顶栏导出按钮)存本地即可。
- **功能自检**：浏览器打开 `https://travel-pin.pages.dev/api/data` 应返回 JSON(你的数据)。

## 安全说明(如实交代边界)

- 前端代码公开,但**密码与密钥只存 Cloudflare 环境变量**;你浏览器里只有 24h 短期 token。
- `/api/authorize` 同一 IP 10 分钟限 10 次,防随手爆破;真正防线是密码强度 + HTTPS。
- 数据公开 = 站点内容公开(与展示目的一致)。若日后要放敏感信息(具体住址等),
  需改为密码门禁整站,届时另做。
- KV 免费额度:读 10 万次/天、写 1000 次/天 —— 个人站点绰绰有余。