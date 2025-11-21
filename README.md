# Concept2 Backup

Automatically backup your Concept2 rowing workouts to GitHub with TCX files.

自动将您的 Concept2 划船训练数据以 TCX 文件形式备份到 GitHub。

## Features | 功能特性

- 🔄 **Automated Backups** - Every new workout is automatically saved
- 🗂️ **Organized Storage** - Files organized by year: `data/{Year}/`
- 📁 **Standard Format** - Exports as TCX files for compatibility with fitness apps
- ☁️ **Cloud Integration** - Webhook-driven via Cloudflare Workers
- 🤖 **GitHub Actions** - Fully automated CI/CD pipeline
- 🖥️ **Manual Backup** - Download complete history anytime
- 🆔 **Deduplication** - Won't re-download existing activities

- 🔄 **自动备份** - 每次新的训练都会自动保存
- 🗂️ **有序存储** - 按年份组织文件：`data/{Year}/`
- 📁 **标准格式** - 导出为 TCX 文件，兼容健身应用
- ☁️ **云集成** - 通过 Cloudflare Workers 的 Webhook 驱动
- 🤖 **GitHub Actions** - 完全自动化的 CI/CD 流水线
- 🖥️ **手动备份** - 随时下载完整历史记录
- 🆔 **去重功能** - 不会重复下载已存在的活动

## Project Structure | 项目结构

```
concept2-backup/
├── scripts/                          # Python scripts
│   ├── auth.py                       # OAuth2 authentication
│   ├── download_history.py           # Download all activities
│   ├── download_single.py            # Download single activity
│   └── pyproject.toml                # PDM configuration
├── worker/                           # Cloudflare Worker
│   ├── src/
│   │   └── index.js                  # Webhook handler
│   ├── wrangler.toml                 # Worker configuration
│   └── package.json                  # Node.js dependencies
├── .github/
│   └── workflows/
│       └── backup.yml                # GitHub Actions workflow
└── data/                             # TCX files (created at runtime)
    ├── 2024/
    └── 2025/
```

## Quick Start | 快速开始

### 1. Get Concept2 API Credentials | 获取 Concept2 API 凭证

```bash
cd scripts
pdm run python auth.py
```

Follow the prompts to get your tokens. Save these values - you'll need them for GitHub secrets.

按照提示获取您的令牌。保存这些值 - 您需要将它们添加到 GitHub secrets 中。

### 2. Run Manual Backup | 运行手动备份

```bash
# Set environment variables
export C2_CLIENT_ID="your_client_id"
export C2_CLIENT_SECRET="your_client_secret"
export C2_REFRESH_TOKEN="your_refresh_token"

# Download full history
pdm run python download_history.py
```

### 3. Download Single Activity | 下载单个活动

```bash
pdm run python download_single.py 12345
```

## Setup Automation | 设置自动化

### GitHub Secrets | GitHub 密钥

Add these secrets to your repository (Settings → Secrets and variables → Actions):

在您的仓库中添加这些密钥（Settings → Secrets and variables → Actions）：

| Secret | Description |
|--------|-------------|
| `C2_CLIENT_ID` | Concept2 API Client ID |
| `C2_CLIENT_SECRET` | Concept2 API Client Secret |
| `C2_REFRESH_TOKEN` | Concept2 API Refresh Token |

### Deploy Cloudflare Worker | 部署 Cloudflare Worker

```bash
cd worker

# Set your GitHub Personal Access Token
wrangler secret put GITHUB_PAT

# Deploy the worker
wrangler deploy
```

### Configure Concept2 Webhook | 配置 Concept2 Webhook

1. Deploy the worker and get your worker URL
2. Go to https://log.concept2.com/developers/
3. Add webhook URL: `https://your-worker.your-subdomain.workers.dev`

1. 部署 worker 并获取您的 worker URL
2. 访问 https://log.concept2.com/developers/
3. 添加 webhook URL：`https://your-worker.your-subdomain.workers.dev`

## How It Works | 工作原理

### Automated Flow (New Activity) | 自动流程（新活动）

```
Concept2 Workout Completed
    ↓
Concept2 Webhook Triggered
    ↓
Cloudflare Worker (c2-webhook-handler)
    ↓
GitHub Repository Dispatch (event: c2_new_activity)
    ↓
GitHub Actions Workflow (.github/workflows/backup.yml)
    ↓
scripts/download_single.py (specific result_id)
    ↓
Commit & Push to data/{Year}/
```

### Manual Flow (Full Backup) | 手动流程（完整备份）

```
GitHub Actions → Manual Trigger
    ↓
GitHub Actions Workflow (.github/workflows/backup.yml)
    ↓
scripts/download_history.py (all activities)
    ↓
Commit & Push to data/{Year}/
```

## GitHub Actions Workflows | GitHub Actions 工作流

### Manual Trigger | 手动触发

Go to Actions tab → "Backup Concept2 Activities" → Run workflow

访问 Actions 选项卡 → "Backup Concept2 Activities" → 运行工作流

### Webhook Trigger | Webhook 触发

Automatically triggered when you complete a workout (if webhook is configured)

完成训练时自动触发（如果已配置 webhook）

## Development | 开发

### Local Development | 本地开发

**Cloudflare Worker:**
```bash
cd worker
wrangler dev --port 8787
```

Test with:
```bash
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{"result_id": 12345}'
```

### Dependencies | 依赖

**Python:**
```bash
cd scripts
pdm install
```

**Node.js:**
```bash
cd worker
npm install
```

## Configuration Files | 配置文件

### worker/wrangler.toml
```toml
name = "c2-webhook-handler"
main = "src/index.js"
compatibility_date = "2025-11-21"
```

### .github/workflows/backup.yml

- Trigger: `workflow_dispatch` or `repository_dispatch`
- Python: 3.13
- Dependencies: requests
- Secrets: C2_CLIENT_ID, C2_CLIENT_SECRET, C2_REFRESH_TOKEN

## File Naming | 文件命名

TCX files are saved as:
```
data/{Year}/{Date}_{ResultID}.tcx

Example:
data/2024/2024_11_21_12345.tcx
```

## API Documentation | API 文档

- Concept2 Logbook API: https://log.concept2.com/developers/documentation/
- GitHub Repository Dispatch: https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event
- Cloudflare Workers: https://developers.cloudflare.com/workers/

## Troubleshooting | 故障排除

### Worker Returns "GITHUB_PAT not set" | 返回 "GITHUB_PAT not set"

Set the secret: `wrangler secret put GITHUB_PAT`

设置密钥：`wrangler secret put GITHUB_PAT`

### Workflow Fails with Authentication Error | 工作流因认证错误失败

Check your GitHub secrets (C2_CLIENT_ID, C2_CLIENT_SECRET, C2_REFRESH_TOKEN)

检查您的 GitHub secrets（C2_CLIENT_ID, C2_CLIENT_SECRET, C2_REFRESH_TOKEN）

### Duplicate Files | 重复文件

The scripts check for existing files before downloading

脚本在下载前会检查文件是否已存在

## Contributing | 贡献

Feel free to submit issues and enhancement requests!

欢迎提交问题和改进请求！

## License | 许可证

MIT

## Support | 支持

- Concept2 API Docs: https://log.concept2.com/developers/
- GitHub Actions Docs: https://docs.github.com/en/actions
- Cloudflare Workers Docs: https://developers.cloudflare.com/workers/

---

**Concept2** is a trademark of Concept2, Inc. This project is not affiliated with or endorsed by Concept2.

**Concept2** 是 Concept2, Inc. 的商标。本项目与 Concept2 无关联，也未获得其认可。
