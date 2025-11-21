# Concept2 Backup - Architecture Documentation

## 系统架构概述

```
┌─────────────────────────────────────────────────────────────────┐
│                        Concept2 Logbook                          │
│                    (用户完成训练触发 Webhook)                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Webhook (包含 result_id)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                            │
│              (worker/src/index.js - Webhook 处理器)              │
│                                                                 │
│  功能：                                                         │
│  - 接收 Concept2 webhook                                        │
│  - 解析 result_id                                               │
│  - 调用 GitHub Repository Dispatch API                          │
│  - 错误处理和日志                                                │
│                                                                 │
│  配置：                                                         │
│  - Environment: GITHUB_PAT (GitHub Personal Access Token)       │
│  - URL: https://c2-webhook-handler.your-name.workers.dev        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP POST
                           │ GitHub Repository Dispatch API
                           │ Event: c2_new_activity
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Repository                             │
│                                                                 │
│  接收 Repository Dispatch 事件                                  │
│  触发 GitHub Actions Workflow                                   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              GitHub Actions Workflow                            │
│         (.github/workflows/backup.yml)                          │
│                                                                 │
│  触发方式：                                                     │
│  - repository_dispatch (自动，来自 Worker)                      │
│  - workflow_dispatch (手动，带参数)                            │
│                                                                 │
│  步骤：                                                         │
│  1. Checkout code                                               │
│  2. Setup Python 3.13                                           │
│  3. Install PDM                                                 │
│  4. Install dependencies (cd scripts && pdm install)            │
│  5. Set environment (C2_ACCESS_TOKEN)                           │
│  6. Validate authentication (simple_auth.py)                    │
│  7. Download activities                                         │
│     - Single: download_single.py <result_id>                    │
│     - Full: download_history.py                                 │
│  8. Check for changes                                           │
│  9. Configure git (C2-Bot)                                      │
│  10. Commit and push (git add data/ && git commit && git push)  │
│  11. Generate summary                                           │
│                                                                 │
│  Secrets:                                                       │
│  - C2_ACCESS_TOKEN (Concept2 个人 Access Token)                 │
│  - GITHUB_TOKEN (自动提供)                                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Python Scripts (scripts/)                           │
│                                                                 │
│  simple_auth.py                                                 │
│  - 使用 Access Token 认证                                        │
│  - 验证 Token 有效性                                            │
│  - Bearer Token: Authorization: Bearer <token>                  │
│                                                                 │
│  download_single.py <result_id>                                 │
│  - 下载单个训练的 TCX 文件                                      │
│  - 保存到: data/{Year}/{Date}_{ID}.tcx                         │
│  - 检查文件是否已存在                                           │
│                                                                 │
│  download_history.py                                            │
│  - 分页获取所有训练记录                                         │
│  - 批量下载 TCX 文件                                           │
│  - 按年份组织文件                                               │
│  - 智能跳过已下载的文件                                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Git Repository (data/)                              │
│                                                                 │
│  目录结构：                                                     │
│  data/                                                          │
│  ├── 2024/                                                      │
│  │   ├── 2024_01_15_12345.tcx                                  │
│  │   ├── 2024_02_20_12346.tcx                                  │
│  │   └── ...                                                    │
│  ├── 2025/                                                      │
│  │   ├── 2025_01_01_12347.tcx                                  │
│  │   └── ...                                                    │
│  └── ...                                                        │
│                                                                 │
│  命名规则：{Date}_{ResultID}.tcx                               │
│  - Date: YYYY_MM_DD (从 API 获取)                              │
│  - ResultID: Concept2 训练 ID (唯一标识)                       │
└─────────────────────────────────────────────────────────────────┘
```

## 数据流详细说明

### 场景 1: 完成一次新训练 (自动化流程)

```
1. 用户在 Concept2 划船机上完成训练
   ↓
2. Concept2 Logbook 生成训练记录，分配 result_id: 12345
   ↓
3. Concept2 向配置的 Webhook URL 发送 POST 请求
   POST https://c2-webhook-handler.your-name.workers.dev
   Body: {"result_id": 12345}
   ↓
4. Cloudflare Worker 接收到请求
   - 验证请求格式
   - 提取 result_id
   - 准备 GitHub API 调用
   ↓
5. Worker 调用 GitHub Repository Dispatch API
   POST https://api.github.com/repos/owner/repo/dispatches
   Headers: Authorization: token ${GITHUB_PAT}
   Body: {"event_type": "c2_new_activity", "client_payload": {"result_id": 12345}}
   ↓
6. GitHub 接收到 Repository Dispatch 事件
   - 触发 Actions Workflow
   - 传递 client_payload
   ↓
7. GitHub Actions 工作流启动
   - 检出仓库代码
   - 配置 Python 环境
   - 安装依赖 (pdm install)
   - 设置 C2_ACCESS_TOKEN
   ↓
8. 工作流运行 download_single.py 12345
   - 向 Concept2 API 请求训练详情
   - GET /api/users/me/results/12345
   - Headers: Authorization: Bearer ${C2_ACCESS_TOKEN}
   - 获取训练日期: 2025-01-15
   ↓
9. 下载 TCX 文件
   - GET /api/users/me/results/12345/export/tcx
   - 保存字节流到变量
   ↓
10. 保存文件到磁盘
    - 确定年份: 2025
    - 创建目录: data/2025/ (如果不存在)
    - 生成文件名: 2025_01_15_12345.tcx
    - 写入文件: data/2025/2025_01_15_12345.tcx
    ↓
11. 检查 Git 状态
    - git status 显示新增文件
    - 设置 has_changes=true
    ↓
12. 配置 Git 用户信息
    - git config user.name "C2-Bot"
    - git config user.email "c2-bot@users.noreply.github.com"
    ↓
13. 提交文件
    - git add data/2025/2025_01_15_12345.tcx
    - git commit -m "Add activity 12345

      🤖 Automated backup of Concept2 activity

      Co-authored-by: C2-Bot <c2-bot@users.noreply.github.com>"
    ↓
14. 推送到 GitHub
    - git push origin main
    - 文件出现在 GitHub 仓库中

总计时间: 约 30-60 秒 (取决于网络)
```

### 场景 2: 手动下载完整历史

```
1. 用户进入 GitHub Actions 选项卡
   ↓
2. 点击 "Run workflow" 按钮
   - 选择 mode: full
   - 无需 result_id
   ↓
3. 工作流触发 workflow_dispatch 事件
   ↓
4. GitHub Actions 运行 backup.yml
   - 所有步骤与场景 1 相同 (步骤 1-7)
   ↓
5. 运行 download_history.py (无参数)
   - GET /api/users/me/results?page=1&per_page=100
   - 解析 pagination.meta.total_pages
   ↓
6. 循环获取所有页面
   - page = 1, 2, 3, ...
   - 每次请求: GET /api/users/me/results?page=N&per_page=100
   - 合并所有结果到数组
   - 添加延迟: sleep 0.5 秒 (尊重 API)
   ↓
7. 遍历所有训练记录
   对每个 result:
   - 检查文件是否已存在: data/{Year}/{Date}_{ID}.tcx
   - 如果存在: 跳过 (打印 "Skipping...")
   - 如果不存在:
     * 下载 TCX
     * 保存文件
     * 打印 "Downloaded and saved"
     * sleep 0.5 秒
   ↓
8. 收集所有新下载的文件
   ↓
9. 提交并推送 (批量提交)
   - git add data/
   - git commit -m "Update activity history"
   - git push

总计时间: 取决于训练数量 (50 条记录约 2-3 分钟)
```

### 场景 3: 手动下载单个活动

```
1. 用户进入 GitHub Actions 选项卡
   ↓
2. 点击 "Run workflow" 按钮
   - 选择 mode: single
   - 输入 result_id: 67890
   ↓
3. 工作流触发 workflow_dispatch 事件
   ↓
4. GitHub Actions 运行 backup.yml
   - 步骤 1-7 相同
   ↓
5. 运行 download_single.py 67890
   ↓
6-14. 同场景 1 (单个文件下载流程)

总计时间: 约 30-60 秒
```

## 认证和安全性

### Access Token 认证 (当前)

流程：
```
1. 用户从 Concept2 账户设置获取 Access Token
   ↓
2. 添加到 GitHub Secrets: C2_ACCESS_TOKEN=your_token
   ↓
3. GitHub Actions 运行时:
   echo "C2_ACCESS_TOKEN=${C2_ACCESS_TOKEN}" >> $GITHUB_ENV
   ↓
4. Python 脚本读取环境变量
   access_token = os.environ.get('C2_ACCESS_TOKEN')
   ↓
5. API 请求时添加 Header
   headers = {'Authorization': f'Bearer {access_token}', ...}
   ↓
6. 请求示例:
   requests.get('https://log.concept2.com/api/users/me',
                headers=headers)
```

安全性考虑：
- Token 存储在 GitHub Secrets (加密)
- 不传送给 Cloudflare Worker
- 只在 GitHub Actions 中使用
- Token 长期有效，无需刷新

## Workers OAuth 登录流 (TODO)

未来的登录体验：

```
┌─────────────────────────────────────────┐
│  用户在 GitHub README 中找到 Worker URL  │
└──────────────────┬──────────────────────┘
                   │ 点击链接
                   ▼
┌─────────────────────────────────────────┐
│  Cloudflare Worker 登录页面              │
│  - 简单的 HTML/CSS/JS                   │
│  - 按钮: "连接 Concept2 账户"           │
└──────────────────┬──────────────────────┘
                   │ 重定向到 Concept2 OAuth
                   ▼
┌─────────────────────────────────────────┐
│  Concept2 授权页面                      │
│  - 用户登录                             │
│  - 批准应用访问                         │
└──────────────────┬──────────────────────┘
                   │ 重定向回 Worker (callback)
                   │ 返回: Access Token
                   ▼
┌─────────────────────────────────────────┐
│  Worker 显示 Token 页面                 │
│  - 显示 Access Token                    │
│  - 一键复制按钮                         │
│  - 说明: 添加到 GitHub Secrets          │
└─────────────────────────────────────────┘

用户体验：类似 "使用 Concept2 登录"
安全性：Token 只由用户 handle，不存储在 Worker
架构：消除 OAuth2 复杂性
```

## 性能优化

### 当前实现

优化措施：
1. **请求延迟**: sleep 0.5 秒 (尊重 Concept2 API)
2. **去重**: 检查文件存在，避免重复下载
3. **分页**: 每页 100 条记录 (API 支持的最大值)
4. **Git 优化**: fetch-depth: 0 确保完整历史
5. **依赖缓存**: pdm install 在每次运行时安装

### 可能的改进

1. **Workers KV**: 缓存训练元数据，减少 API 调用
2. **增量备份**: 记录上次备份时间，只获取新记录
3. **并行下载**: 同时下载多个 TCX 文件 (需测试 API 限制)
4. **Git LFS**: 如果文件太多，考虑使用 Git Large File Storage

## 错误处理

### GitHub Actions 错误处理

```yaml
# Validation step
- name: Validate Concept2 Access Token
  run: |
    cd scripts
    pdm run python simple_auth.py
  # 如果失败，工作流会停止

# Download with error handling
python download_single.py $RESULT_ID
# Script uses requests.raise_for_status() to catch HTTP errors

# Conditional steps
if: steps.check_changes.outputs.has_changes == 'true'
# Only commit if there are new files
```

### Python 脚本错误处理

```python
try:
    response = requests.get(url, headers=headers)
    response.raise_for_status()  # Raises HTTPError for bad status
except requests.exceptions.HTTPError as e:
    if e.response.status_code == 401:
        print("Authentication failed. Check your C2_ACCESS_TOKEN.")
    elif e.response.status_code == 404:
        print(f"Activity {result_id} not found.")
    sys.exit(1)
except Exception as e:
    print(f"Unexpected error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
```

### Workers 错误处理

```javascript
// worker/src/index.js
async function handleWebhook(request) {
  try {
    const payload = await request.json();
    if (!payload.result_id) {
      return new Response('Missing result_id', { status: 400 });
    }

    // Call GitHub API
    const response = await fetch(githubUrl, {
      method: 'POST',
      headers: {
        'Authorization': `token ${GITHUB_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event_type: 'c2_new_activity',
        client_payload: { result_id: payload.result_id }
      })
    });

    if (!response.ok) {
      console.error('GitHub API error:', response.status);
      return new Response('GitHub API error', { status: 500 });
    }

    return new Response('Success', { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
```

## 监控和调试

### GitHub Actions 监控

- **Actions 选项卡**: 查看所有工作流运行
- **日志**: 每个步骤的详细输出
- **总结**: GitHub Step Summary (Markdown 报告)

### Workers 监控

```bash
# 实时日志
cd worker
wrangler tail

# 查看请求和响应
# 调试错误
```

### Python 脚本调试

```bash
# 测试认证
cd scripts
export C2_ACCESS_TOKEN="your_token"
pdm run python simple_auth.py

# 详细输出
export PYTHONVERBOSE=1
pdm run python download_history.py
```

## API 限制和配额

### Concept2 API

- 未明确说明速率限制
- 最佳实践: 每次请求延迟 0.5 秒
- 使用分页: per_page=100
- 个人访问令牌有使用限制吗？

### GitHub API

- Repository Dispatch: 无明确限制
- GitHub Actions: 免费额度内有限制
  - 公共仓库: 免费
  - 私有仓库: 每月 2000 分钟 (免费账户)

### Workers

- 每日请求次数限制 (免费账户)
- 10 万次请求/天 (免费)
- 足够个人使用

## 成本分析

免费方案：
- GitHub (公共仓库): $0
- GitHub Actions (公共仓库): $0
- Cloudflare Workers (免费账户): $0
- Concept2 API: $0

总成本: **$0/月**

## 备份和恢复

### 备份策略

- Git 仓库自动备份到 GitHub 服务器
- 分布式存储 (GitHub 全局 CDN)
- 版本历史记录所有更改
- 可回滚到任何历史版本

### 恢复流程

```bash
# 克隆仓库到本地 (包含所有 TCX 文件)
git clone https://github.com/your-username/concept2-backup.git

# 或下载 ZIP 归档
git archive --format zip --output backup.zip main

# 导入到其他健身应用
# Strava, Garmin, TrainingPeaks 等支持 TCX 格式
```

## 安全清单

- [ ] GitHub Secrets 设置 C2_ACCESS_TOKEN
- [ ] GitHub Secrets 不存储其他敏感信息
- [ ] Workers 设置 GITHUB_PAT
- [ ] Concept2 Access Token 保密
- [ ] GitHub 仓库设置为私有 (可选)
- [ ] 定期更新依赖 (无漏洞)
- [ ] 审查 GitHub Actions 权限

## 扩展性和未来改进

### 高优先级

1. **Workers 登录页面** (TODO Phase 1)
   - 简化 Token 获取流程
   - 更好的用户体验

2. **数据统计仪表板**
   - Workers Pages + KV
   - 显示训练统计图表
   - 年/月/周总结

3. **邮件通知**
   - 新训练备份成功
   - 失败通知

### 中优先级

4. **Strava/Garmin 同步**
   - 自动上传到 Strava
   - 自动上传到 Garmin Connect

5. **多格式支持**
   - 导出 GPX, FIT, CSV
   - 更好兼容性

6. **数据分析**
   - 训练趋势分析
   - PB (个人最佳) 追踪
   - 距离/卡路里统计

### 低优先级

7. **多用户支持**
   - 支持多个 Concept2 账户
   - 独立目录存储

8. **移动应用**
   - 查看 TCX 文件
   - 简单统计

9. **社交功能**
   - 分享到社交媒体
   - 与朋友比较

## 技术栈总结

| 组件 | 技术 | 用途 |
|------|------|------|
| API 客户端 | Python, requests | 下载 TCX 文件 |
| 认证 | Bearer Token (Access Token) | 访问 Concept2 API |
| Webhook 处理 | Cloudflare Workers, JavaScript | 接收 webhooks |
| 自动化 | GitHub Actions, YAML | 自动下载和提交 |
| 包管理 | PDM, pyproject.toml | Python 依赖管理 |
| 存储 | Git (GitHub) | 存储 TCX 文件 |
| 开发工具 | wrangler | Workers 部署 |

## 部署清单

### 初始设置

- [ ] Fork 此仓库
- [ ] 获取 Concept2 Access Token
- [ ] 设置 GitHub Secret: C2_ACCESS_TOKEN
- [ ] 配置 GitHub PAT (Personal Access Token)
- [ ] 部署 Workers (设置 GITHUB_PAT)
- [ ] 获取 Worker URL
- [ ] 配置 Concept2 Webhook URL
- [ ] 测试完整流程

### 维护

- [ ] 监控 GitHub Actions 运行
- [ ] 检查 Workers 日志
- [ ] 更新依赖
- [ ] 备份 Git 仓库
- [ ] 检查存储空间

## 常见问题解答 (FAQ)

**Q: 为什么使用 Access Token 而不是 OAuth2?**
A: 更简单，Token 长期有效，适合个人备份场景，减少复杂性。

**Q: Workers 的作用是什么?**
A: 接收 Concept2 webhook，触发 GitHub Actions。Concept2 不能直接调用 GitHub API。

**Q: 可以备份其他人的训练吗?**
A: 不可以。Access Token 只能访问你自己的数据。Concept2 API 限制。

**Q: TCX 文件可以被其他应用使用吗?**
A: 可以。TCX 是标准格式，支持 Strava, Garmin, TrainingPeaks 等。

**Q: 如果 webhook 失败了怎么办?**
A: 手动触发 GitHub Actions: 选择 "Download full history"，会获取所有缺失的记录。

**Q: 需要付费吗?**
A: 不需要。使用免费 GitHub (公共仓库) + 免费 Cloudflare Workers。

---

**文档版本**: v2.0.0
**最后更新**: 2025-11-21
**作者**: Concept2 Backup 团队
