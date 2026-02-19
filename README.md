# Concept2 Backup

![Concept2 Activity](./data/profile-heatmap.png)

自动备份 Concept2 Logbook 训练数据（TCX），并发布一个基于 `stats.json` 的可视化页面（GitHub Pages）。

## 功能

- 自动/手动下载 Concept2 训练记录
- 按年份保存 TCX：`data/<year>/YYYY_MM_DD_<result_id>.tcx`
- 增量更新统计数据：`data/stats.json`
- 自动生成热力图：`data/profile-heatmap.png`
- 通过 Cloudflare Worker 接收 Concept2 webhook 并触发 GitHub Actions
- 构建并部署 Web 仪表盘到 GitHub Pages

## 架构

```
Concept2 Webhook
  -> Cloudflare Worker
    -> GitHub repository_dispatch (c2_new_activity)
      -> .github/workflows/backup.yml
        -> scripts/*.py 下载/更新数据
        -> web/ 构建并部署 Pages
```

如果不配置 Webhook，也可以手动触发工作流做全量或单条下载。

## 目录结构

```
.
├── data/                       # 训练数据、统计结果、热力图
├── scripts/                    # Python 下载与统计脚本
├── worker/                     # Cloudflare Worker（Webhook 转发）
├── web/                        # React + Vite 前端
└── .github/workflows/          # 自动化工作流
```

## 前置条件

- Python 3.13（配合 `uv`）
- Node.js 22（前端构建与 Worker 工具链）
- Concept2 Access Token（用于 API 调用）

## 一次性配置（GitHub）

在仓库 `Settings -> Secrets and variables -> Actions` 添加：

- `C2_ACCESS_TOKEN`：Concept2 Logbook Access Token

`GITHUB_TOKEN` 由 Actions 自动提供，不需要手工创建。

## 工作流说明

### 1) `backup.yml`（主工作流）

触发方式：

- `repository_dispatch`（由 Worker 触发）
- `workflow_dispatch`（手动触发）

手动触发参数：

- `mode=full`：全量下载历史
- `mode=single` + `result_id`：下载单条训练

执行内容：

- 校验 Token
- 下载数据（全量或单条）
- 生成/更新 `data/stats.json` 与 `data/profile-heatmap.png`
- 提交 `data/` 变更
- 构建 `web/` 并部署到 GitHub Pages

### 2) `download-full-history.yml`

仅用于手动全量下载历史并提交数据（不部署前端）。

## 本地开发

### Python 脚本（`scripts/`）

```bash
cd scripts
export C2_ACCESS_TOKEN="<your_token>"

uv sync
uv run simple_auth.py
uv run download_history.py
uv run download_single.py 12345
uv run update_heatmap.py
```

### 前端（`web/`）

```bash
cd web
pnpm install
pnpm dev
pnpm build
```

前端读取 `./stats.json`。本地调试时需要把仓库根目录的 `data/stats.json` 放到 `web/public/stats.json`。

### Worker（`worker/`）

```bash
cd worker
npm install
wrangler login
wrangler secret put GITHUB_PAT
wrangler secret put WEBHOOK_SECRET
wrangler dev --port 8787
wrangler deploy
```

`GITHUB_PAT` 需要有目标仓库的 Actions/contents 相关权限，以便调用 repository dispatch。
`WEBHOOK_SECRET` 用于校验 webhook 来源。
`WEBHOOK_RATE_LIMIT_MAX_PER_MINUTE` 可选，用于覆盖默认限流阈值（默认每 IP 每分钟 20 次）。

## Webhook 配置

推荐使用 Header 传密钥（长期使用）：

```bash
curl -X POST "https://<worker>.workers.dev/" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: <WEBHOOK_SECRET>" \
  -d '{"type":"result-added","result":{"id":12345}}'
```

也支持 query token（仅临时调试，不建议长期使用）：

- `https://<worker>.workers.dev/?token=<WEBHOOK_SECRET>`
- 风险：URL 容易进入日志、历史记录和截图，导致密钥泄露

当前 Worker 会处理：

- `result-added`
- `result-updated`
- `result-deleted`

并统一触发 `c2_new_activity` 事件，附带 `result_id`。

## 数据产物

- `data/<year>/*.tcx`：原始训练文件
- `data/stats.json`：按天聚合的距离统计
- `data/profile-heatmap.png`：近 365 天热力图

## 常见问题

- 401 鉴权失败：检查 `C2_ACCESS_TOKEN` 是否有效
- webhook 未触发：检查 Worker 日志（`wrangler tail`）、`GITHUB_PAT` 和 `WEBHOOK_SECRET`
- 前端没有数据：确认 `web/public/stats.json` 已注入最新数据（CI 中会自动复制）

## 相关文档

- Concept2 API: https://log.concept2.com/developers/documentation/
- GitHub repository dispatch: https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event
- Cloudflare Workers: https://developers.cloudflare.com/workers/
