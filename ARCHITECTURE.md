# Concept2 Backup 架构

本项目将 Concept2 Logbook 训练备份为 `data/<year>/YYYY_MM_DD_<result_id>.tcx`，维护 `data/stats.json` 和热力图，并用 GitHub Pages 发布仪表盘。即时 Webhook 与每日核对共用 [`.github/workflows/backup.yml`](.github/workflows/backup.yml)，但触发来源和去重方式不同。

## 组件与凭据

| 组件 | 职责 | 使用的凭据 |
| --- | --- | --- |
| Concept2 开发者应用 | 对已授权的 Logbook 用户发送新增、更新、删除训练事件 | 在应用配置中保存含 `WEBHOOK_SECRET` 的完整 Webhook URL |
| Cloudflare Worker（`worker/src/webhook.js`） | 认证并校验请求，将事件转发至本仓库的 GitHub repository dispatch | Worker Secrets：`WEBHOOK_SECRET`、`GITHUB_PAT`；`worker/wrangler.toml` 中的两个限速绑定 |
| GitHub Actions（`backup.yml`） | 校验、下载、更新统计、提交数据、构建并部署 Pages | Actions Secret：`C2_ACCESS_TOKEN`；工作流自带的 `GITHUB_TOKEN` 用于仓库操作 |
| Python（`scripts/`） | 访问 Concept2 API、下载 TCX、维护统计和热力图 | 仅在需要访问 Concept2 API 的步骤中使用 `C2_ACCESS_TOKEN` |
| `web/` | 从 `stats.json` 构建仪表盘 | 无 Concept2 或 Worker 密钥 |

这些凭据不能互换。`C2_ACCESS_TOKEN` 有效只证明备份脚本能读 API；它不会自动授权任何开发者应用接收 Webhook。`GITHUB_PAT` 只给 Worker 向当前代码指定的仓库发送 repository dispatch；细粒度 PAT 需该仓库 **Contents: write**，传统 PAT 需 `repo` scope。[GitHub 权限说明](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)

## 即时 Webhook 流程

1. 在 Concept2 开发者门户为目标 OAuth 应用保存完整的 HTTPS 地址：

   ```text
   https://<your-worker-host>/webhook/<WEBHOOK_SECRET>
   ```

   `WEBHOOK_SECRET` 应由至少 32 字节密码学随机数编码为 base64url；32 字节得到 43 个字符。将同一值保存为 Worker Secret。Worker 只接受该精确路径的 POST；根地址无法接收事件。不要把真实地址或密钥写进仓库、日志、Issue 或截图。

2. 训练所属 Logbook 账户必须授权**配置上述 URL 的同一个应用**。在 `Edit Profile → Applications → Clients` 核对；如缺失，使用该应用的 OAuth Link 完成授权。Concept2 只向获授权应用投递相关用户的事件。[Concept2 Webhook 文档](https://log.concept2.com/developers/documentation/#webhooks)
3. Concept2 官方文档展示 JSON `data` 包络；[历史生产投递的修复记录](https://github.com/AEliu/concept2-backup/commit/6e85ed23ef956715014f1663a445b928e4361929)证明它也曾发送顶层事件对象。Worker 仅接受这两种明确格式：新增/更新的 `type` 为 `result-added`/`result-updated`，ID 在 `result.id`；删除为 `result-deleted`，ID 在 `result_id`。有包络时这些字段位于 `data` 内，无包络时位于顶层。Worker 限制请求体为 64 KiB，验证事件类型和正整数 ID，对等价事件对象生成相同的 SHA-256 `event_digest`。
4. Worker 对有效请求进行限速后，向 `AEliu/concept2-backup` 发送 `c2_new_activity` repository dispatch，`client_payload` 包含 `result_id`、`event_type` 和 `event_digest`。Worker 返回 200 表示 GitHub 接受了转发请求；最终备份结果仍要查看 Actions。
5. `backup.yml` 的预检对有效且未完成的 digest 运行备份。成功完成备份及 Pages 部署后上传一天保留的完成标记。相同 digest 在标记有效期内再次到达时跳过；标记过期后仍依赖下载与统计逻辑的幂等性。

Worker 使用两个 Cloudflare 限速绑定：总体约每 60 秒 10 次、同一事件 digest 约每 60 秒 1 次。计数按 Cloudflare 地点近似执行，并非全局严格去重。配置缺失时请求失败关闭。详见 [`worker/README.md`](worker/README.md)。

## 备份与数据完整性

`backup.yml` 支持以下入口：

| 入口 | 行为 |
| --- | --- |
| `repository_dispatch` | 对新增/更新 ID 下载单条训练；删除事件记录 tombstone，不访问 Concept2 API |
| 手动 `mode=single` + `result_id` | 重新下载一条训练 |
| 手动 `mode=day` + `workout_date` | 严格核对指定 `YYYY-MM-DD` 日期的全部训练，只补缺失项 |
| 手动 `mode=full` | 分页核对完整历史 |
| 每日 `schedule` | 计划在北京时间 03:15 运行，按**实际执行时**的北京时间核对前一天；GitHub 调度可能延迟 |

按日期核对先验证全部分页元数据及唯一训练 ID，再下载对应日期的缺失项；元数据不完整、重复 ID 或跨日期同 ID 冲突会失败关闭，避免错误删除或覆盖。更新路径使用待处理日志和原子写入来支持中断后的恢复；统计逻辑保留已有的人工调整值，不应通过全量重算原始 TCX 抹掉这些调整。损坏或无法解析的已处理 TCX 会阻止推断旧贡献。删除事件保留审计记录，不会仅凭 Webhook 擅自抹除历史数据。

仓库数据提交经过分支级串行和非强制推送。Pages 构建读取最新 `data/stats.json`。数据提交上的 `[skip ci]` 避免重复触发普通 CI。

## 排查即时投递

把一条**真实 Concept2 新增或更新**与 Worker 的 POST 和 GitHub Actions 的 `repository_dispatch` 运行按时间对应。直接请求 GitHub repository dispatch 只验证 GitHub 及工作流；每日 `schedule` 补回训练也不证明即时 Webhook 生效。

| 观察 | 优先检查 |
| --- | --- |
| Worker 没有对应 POST | 开发者应用保存的域名与完整路径；训练账户是否授权同一个应用 |
| POST 返回 401 | URL 路径与 Worker `WEBHOOK_SECRET` 是否一致 |
| POST 返回 400/413 | 两种受限事件格式的字段与请求体大小；核对脱敏后的结构，不记录原始训练内容 |
| POST 返回 429 或 503 `Delivery deferred` | Worker 限速；等待重试，不将其计作成功 |
| POST 返回 503 `Service unavailable` | Worker Secrets 或两个限速绑定 |
| POST 返回 503 `Dispatch unavailable` | Worker `GITHUB_PAT` 的目标仓库与权限、GitHub API 或网络 |
| POST 返回 200，但备份未完成 | 对应的 GitHub Actions 运行、预检、备份与 Pages 作业 |

`wrangler tail` 的原始事件可能包含完整的、带密钥的请求 URL。排查时只共享脱敏后的时间、HTTP 状态、`X-Request-Id` 和错误短语。若工作流的 Concept2 API 校验报 401，再检查 GitHub Actions 中的 `C2_ACCESS_TOKEN`；它与 Worker 的 401 是两条不同路径。

## 运行与变更

本地脚本使用 `uv`（`scripts/uv.lock`），前端使用 `pnpm`。Worker 的单元测试在 `worker/` 内运行 `npm ci`、`npm test`。生产部署需要先核对 Worker Secrets、限速 namespace ID、Concept2 应用 URL 与授权，再按变更流程执行 `wrangler deploy`。Durable Object 迁移不能通过 `wrangler versions upload` 应用；当前 Worker 配置不使用 Durable Object。

历史数据和人工统计调整均应按仓库审查流程保护。变更运行代码时先建 Issue、使用独立分支和 PR，并通过测试及复审后再考虑合并或部署。
