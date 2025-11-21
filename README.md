# Concept2 Backup

自动将您的 Concept2 划船训练数据以 TCX 文件形式备份到 GitHub。

## 功能特性

- 🔄 **自动备份** - 每次新的训练都会自动保存
- 🗂️ **有序存储** - 按年份组织文件：`data/{Year}/`
- 📁 **标准格式** - 导出为 TCX 文件，兼容健身应用
- ☁️ **云集成** - 通过 Cloudflare Workers 的 Webhook 驱动
- 🤖 **GitHub Actions** - 完全自动化的 CI/CD 流水线
- 🖥️ **手动备份** - 随时下载完整历史记录
- 🆔 **去重功能** - 不会重复下载已存在的活动

## 项目结构

```
concept2-backup/
├── scripts/                          # Python 脚本
│   ├── auth.py                       # OAuth2 认证
│   ├── download_history.py           # 下载所有活动
│   ├── download_single.py            # 下载单个活动
│   └── pyproject.toml                # PDM 配置
├── worker/                           # Cloudflare Worker
│   ├── src/
│   │   └── index.js                  # Webhook 处理器
│   ├── wrangler.toml                 # Worker 配置
│   └── package.json                  # Node.js 依赖
├── .github/
│   └── workflows/
│       └── backup.yml                # GitHub Actions 工作流
└── data/                             # TCX 文件（运行时创建）
    ├── 2024/
    └── 2025/
```

## 快速开始

### 1. 获取 Concept2 API 凭证

```bash
cd scripts
pdm run python auth.py
```

按照提示获取您的令牌。保存这些值 - 您需要将它们添加到 GitHub secrets 中。

### 2. 运行手动备份

```bash
# 设置环境变量
export C2_CLIENT_ID="your_client_id"
export C2_CLIENT_SECRET="your_client_secret"
export C2_REFRESH_TOKEN="your_refresh_token"

# 下载完整历史
pdm run python download_history.py
```

### 3. 下载单个活动

```bash
pdm run python download_single.py 12345
```

## 设置自动化

### GitHub Secrets

在您的仓库中添加这些密钥（Settings → Secrets and variables → Actions）：

| 密钥 | 说明 |
|--------|-------------|
| `C2_CLIENT_ID` | Concept2 API Client ID |
| `C2_CLIENT_SECRET` | Concept2 API Client Secret |
| `C2_REFRESH_TOKEN` | Concept2 API Refresh Token |

### 在 Cloudflare 部署 Worker

#### 方法 1：通过 GitHub 存储库（推荐）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 导航到 **Workers & Pages**
3. 点击 **Create application**
4. 选择 **Import GitHub repository**
5. 授权 Cloudflare 访问您的 GitHub 账户
6. 选择此存储库（AEliu/concept2-backup）
7. 构建设置：
   - Build command: `(empty)`
   - Build output directory: `(empty)`
8. 部署后，设置环境变量：
   - 转到 **Settings** → **Environment variables**
   - 添加 `GITHUB_PAT`: 您的 GitHub Personal Access Token
9. 获取 Worker 的 URL（例如：`https://c2-webhook-handler.your-name.workers.dev`）

#### 方法 2：使用 Wrangler CLI

```bash
cd worker

# 登录 Cloudflare
wrangler login

# 设置您的 GitHub Personal Access Token
wrangler secret put GITHUB_PAT

# 部署 worker
wrangler deploy
```

### 配置 Concept2 Webhook

1. 部署 worker 并获取您的 worker URL
2. 访问 https://log.concept2.com/developers/
3. 添加 webhook URL：`https://your-worker.your-subdomain.workers.dev`

## 工作原理

### 自动流程（新活动）

```
Concept2 训练完成
    ↓
Concept2 Webhook 触发
    ↓
Cloudflare Worker (c2-webhook-handler)
    ↓
GitHub Repository Dispatch (event: c2_new_activity)
    ↓
GitHub Actions 工作流 (.github/workflows/backup.yml)
    ↓
scripts/download_single.py (特定 result_id)
    ↓
提交并推送到 data/{Year}/
```

### 手动流程（完整备份）

```
GitHub Actions → 手动触发
    ↓
GitHub Actions 工作流 (.github/workflows/backup.yml)
    ↓
scripts/download_history.py (所有活动)
    ↓
提交并推送到 data/{Year}/
```

## GitHub Actions 工作流

### 手动触发

访问 Actions 选项卡 → "Backup Concept2 Activities" → 运行工作流

### Webhook 触发

完成训练时自动触发（如果已配置 webhook）

## 开发

### 本地开发

**Cloudflare Worker:**
```bash
cd worker
wrangler dev --port 8787
```

测试：
```bash
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{"result_id": 12345}'
```

### 依赖

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

## 配置文件

### worker/wrangler.toml
```toml
name = "c2-webhook-handler"
main = "src/index.js"
compatibility_date = "2025-11-21"
```

### .github/workflows/backup.yml

- 触发器: `workflow_dispatch` 或 `repository_dispatch`
- Python: 3.13
- 依赖: requests
- 密钥: C2_CLIENT_ID, C2_CLIENT_SECRET, C2_REFRESH_TOKEN

## 文件命名

TCX 文件保存为：
```
data/{Year}/{Date}_{ResultID}.tcx

示例：
data/2024/2024_11_21_12345.tcx
```

## API 文档

- Concept2 Logbook API: https://log.concept2.com/developers/documentation/
- GitHub Repository Dispatch: https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event
- Cloudflare Workers: https://developers.cloudflare.com/workers/

## 故障排除

### Worker 返回 "GITHUB_PAT not set"

设置密钥：`wrangler secret put GITHUB_PAT` 或在 Cloudflare Dashboard 中设置环境变量

### 工作流因认证错误失败

检查您的 GitHub secrets（C2_CLIENT_ID, C2_CLIENT_SECRET, C2_REFRESH_TOKEN）

### 重复文件

脚本在下载前会检查文件是否已存在

## 贡献

欢迎提交问题和改进请求！

## 许可证

MIT

## 支持

- Concept2 API 文档: https://log.concept2.com/developers/
- GitHub Actions 文档: https://docs.github.com/en/actions
- Cloudflare Workers 文档: https://developers.cloudflare.com/workers/

---

**Concept2** 是 Concept2, Inc. 的商标。本项目与 Concept2 无关联，也未获得其认可。

---

# Concept2 Backup

Automatically backup your Concept2 rowing workouts to GitHub with TCX files.

## Features

- 🔄 **Automated Backups** - Every new workout is automatically saved
- 🗂️ **Organized Storage** - Files organized by year: `data/{Year}/`
- 📁 **Standard Format** - Exports as TCX files for compatibility with fitness apps
- ☁️ **Cloud Integration** - Webhook-driven via Cloudflare Workers
- 🤖 **GitHub Actions** - Fully automated CI/CD pipeline
- 🖥️ **Manual Backup** - Download complete history anytime
- 🆔 **Deduplication** - Won't re-download existing activities

## Project Structure

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

## Quick Start

### 1. Get Concept2 API Credentials

```bash
cd scripts
pdm run python auth.py
```

Follow the prompts to get your tokens. Save these values - you'll need them for GitHub secrets.

### 2. Run Manual Backup

```bash
# Set environment variables
export C2_CLIENT_ID="your_client_id"
export C2_CLIENT_SECRET="your_client_secret"
export C2_REFRESH_TOKEN="your_refresh_token"

# Download full history
pdm run python download_history.py
```

### 3. Download Single Activity

```bash
pdm run python download_single.py 12345
```

## Setup Automation

### GitHub Secrets

Add these secrets to your repository (Settings → Secrets and variables → Actions):

| Secret | Description |
|--------|-------------|
| `C2_CLIENT_ID` | Concept2 API Client ID |
| `C2_CLIENT_SECRET` | Concept2 API Client Secret |
| `C2_REFRESH_TOKEN` | Concept2 API Refresh Token |

### Deploy Worker on Cloudflare

#### Method 1: Via GitHub Repository (Recommended)

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages**
3. Click **Create application**
4. Select **Import GitHub repository**
5. Authorize Cloudflare to access your GitHub account
6. Select this repository (AEliu/concept2-backup)
7. Build settings:
   - Build command: `(empty)`
   - Build output directory: `(empty)`
8. After deployment, set environment variables:
   - Go to **Settings** → **Environment variables**
   - Add `GITHUB_PAT`: Your GitHub Personal Access Token
9. Get your Worker URL (e.g., `https://c2-webhook-handler.your-name.workers.dev`)

#### Method 2: Using Wrangler CLI

```bash
cd worker

# Login to Cloudflare
wrangler login

# Set your GitHub Personal Access Token
wrangler secret put GITHUB_PAT

# Deploy the worker
wrangler deploy
```

### Configure Concept2 Webhook

1. Deploy the worker and get your worker URL
2. Go to https://log.concept2.com/developers/
3. Add webhook URL: `https://your-worker.your-subdomain.workers.dev`

## How It Works

### Automated Flow (New Activity)

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

### Manual Flow (Full Backup)

```
GitHub Actions → Manual Trigger
    ↓
GitHub Actions Workflow (.github/workflows/backup.yml)
    ↓
scripts/download_history.py (all activities)
    ↓
Commit & Push to data/{Year}/
```

## GitHub Actions Workflows

### Manual Trigger

Go to Actions tab → "Backup Concept2 Activities" → Run workflow

### Webhook Trigger

Automatically triggered when you complete a workout (if webhook is configured)

## Development

### Local Development

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

### Dependencies

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

## Configuration Files

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

## File Naming

TCX files are saved as:
```
data/{Year}/{Date}_{ResultID}.tcx

Example:
data/2024/2024_11_21_12345.tcx
```

## API Documentation

- Concept2 Logbook API: https://log.concept2.com/developers/documentation/
- GitHub Repository Dispatch: https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event
- Cloudflare Workers: https://developers.cloudflare.com/workers/

## Troubleshooting

### Worker Returns "GITHUB_PAT not set"

Set the secret: `wrangler secret put GITHUB_PAT` or set environment variable in Cloudflare Dashboard

### Workflow Fails with Authentication Error

Check your GitHub secrets (C2_CLIENT_ID, C2_CLIENT_SECRET, C2_REFRESH_TOKEN)

### Duplicate Files

The scripts check for existing files before downloading

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT

## Support

- Concept2 API Docs: https://log.concept2.com/developers/
- GitHub Actions Docs: https://docs.github.com/en/actions
- Cloudflare Workers Docs: https://developers.cloudflare.com/workers/

---

**Concept2** is a trademark of Concept2, Inc. This project is not affiliated with or endorsed by Concept2.
