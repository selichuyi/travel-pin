# Travel Pin · 点亮足迹

记录并点亮你的旅行足迹：2D/3D 地图展示、旅程连线、多段日期、标签统计，纯前端构建
（MapLibre GL + globe.gl），无构建步骤，本地打开即可运行。

## 运行

```bash
./start-travel-pin.sh          # 或: python3 serve.py 8899
```

浏览器打开 <http://127.0.0.1:8899/>。数据读写走 `data/travel.json`，另有
`POST /api/save` 接口(见 `serve.py`)；编辑能力默认可用(本地开发视为可信环境)。

## 部署

公开站点 + 属主在线编辑的完整方案见 [DEPLOY.md](DEPLOY.md)：

- 静态站点与接口托管在 Cloudflare Pages(Functions 提供 `/api/data`、`/api/authorize`、`/api/save`)
- 真实数据存放在 Cloudflare KV，仓库中只有脱敏示例数据
- 访客只读；属主输入密码换取 24h token 后可在页面直接编辑，改动实时发布

## 数据与隐私

本公开仓库中的 `data/travel.json` 与内联种子数据均为**虚构示例**，不含任何真实足迹。
部署者自己的真实数据保存在自己的 Cloudflare KV 中(初始灌入见 `scripts/seed-kv.mjs`)，
不会出现在公开仓库里。