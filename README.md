# 奇绩信号Alpha Sight播客生成器

🎙️ 基于 Dify Workflow 的智能播客脚本生成和语音合成工具

## 功能特性

### 核心功能
- 📤 **Excel 批量处理** - 拖拽上传 Excel 文件，自动解析论文信息
- 🤖 **AI 脚本生成** - 基于 Dify Workflow，智能生成播客对话脚本
- 🎙️ **语音合成** - 使用 SiliconFlow TTS API，生成高质量音频文件
- 🗄️ **数据库集成** - 自动上传到 Supabase，管理播客元数据和音频URL
- 🔄 **实时进度追踪** - 基于 SSE 的实时状态更新
- 📋 **完整日志记录** - 详细的执行日志和错误追踪

### 高级特性
- 💾 **按日期归档** - 自动组织输出文件（`outputs/YYYY/MM/DD/`）
- 🎯 **多频道支持** - 支持不同播客频道的配置和管理
- 🔁 **批量音频生成** - 从 JSON 数组批量生成多个音频文件
- 📊 **智能去重** - 基于 arXiv ID 的数据去重
- ⬇️ **一键下载** - 下载生成的脚本和音频文件

## 项目结构

```
podcast_script_generate/
├── frontend/                    # 前端文件
│   ├── index.html              # 主页面（拖拽上传UI）
│   ├── style.css               # 样式文件
│   └── app.js                  # 前端逻辑（SSE 处理、进度显示）
├── backend/                    # 后端服务
│   ├── server.js               # Express 服务器（SSE 端点）
│   ├── difyClient.js           # Dify API 客户端
│   ├── supabaseClient.js       # Supabase 数据库客户端
│   ├── excelParser.js          # Excel 文件解析器
│   ├── config.js               # 配置管理
│   ├── logger.js               # 日志系统
│   └── package.json            # Node.js 依赖
├── podcast_generator/          # Python TTS 模块
│   ├── produce_podcast.py      # 音频生成主程序
│   ├── female_base64.txt       # 女声音色参考
│   └── male_base64.txt         # 男声音色参考
├── outputs/                    # 输出目录（按日期组织）
│   └── YYYY/MM/DD/
│       ├── *.json              # 生成的播客脚本（JSON 格式）
│       ├── *.mp3               # 生成的音频文件
│       ├── arxiv_mapping.json  # arXiv ID 映射
│       ├── podcast_titles.json # 播客标题映射
│       ├── audio_generation_result.json  # 音频生成结果
│       └── logs/
│           └── execution_*.log # 执行日志
├── doc/                        # 文档和测试文件
├── .env                        # 环境变量配置（需手动创建）
├── .env.example                # 环境变量示例
├── requirements.txt            # Python 依赖
├── start.bat                   # Windows 快速启动脚本
├── CLAUDE.md                   # Claude Code 项目说明
└── README.md                   # 本文件
```

## 系统要求

### 软件环境
- **Node.js**: >= 18.0.0 (推荐 v22.17.0)
- **Python**: >= 3.8 (推荐 Python 3.13+)
- **npm**: >= 9.0.0

### API 服务
- **Dify API**: 用于 AI 脚本生成
- **SiliconFlow API**: 用于 TTS 语音合成
- **Supabase**: 用于数据存储（可选）

## 快速开始

### 1. 克隆项目

```bash
git clone <repository-url>
cd podcast_script_generate
```

### 2. 安装 Node.js 依赖

```bash
cd backend
npm install
```

### 3. 安装 Python 依赖

```bash
cd ../podcast_generator
pip install -r ../requirements.txt

# 或使用虚拟环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r ../requirements.txt
```

### 4. 配置环境变量

复制 `.env.example` 到 `.env` 并填入配置:

```env
# Dify API 配置
DIFY_BASE_URL="https://api.dify.ai/v1"

# Podcast Workflow
DIFY_PODCAST_WORKFLOW_ID="https://udify.app/workflow/YOUR_WORKFLOW_ID"
DIFY_PODCAST_API_KEY="app-YOUR_API_KEY"

# SiliconFlow TTS 配置
SILICONFLOW_API_KEY="sk-YOUR_API_KEY"
SILICONFLOW_BASE_URL="https://api.siliconflow.cn/v1"

# Supabase 配置（可选）
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"
```

### 5. 启动服务

**方式一：使用 npm 脚本（推荐）**
```bash
cd backend
npm start              # 生产模式
# 或
npm run dev            # 开发模式（自动重启）
```

**方式二：直接运行**
```bash
node backend/server.js
```

**方式三：Windows 快速启动**
```bash
start.bat
```

### 6. 访问应用

打开浏览器访问: **http://127.0.0.1:8000**

## 使用方法

### 基本工作流程

1. **📁 准备 Excel 文件**
   - 包含论文信息（ID, Title, Authors, Abstract等）
   - 支持多行数据批量处理

2. **⬆️ 上传文件**
   - 拖拽或点击上传 `.xlsx` 文件
   - 在设置中选择目标播客频道（可选）

3. **🔄 自动处理流程**
   - ✅ Excel 数据解析和验证
   - ✅ 上传到 Supabase 数据库（去重）
   - ✅ 调用 Dify Workflow 生成播客脚本
   - ✅ 保存 JSON 格式脚本文件
   - ✅ 调用 Python TTS 生成音频文件
   - ✅ 上传音频到 Supabase Storage
   - ✅ 更新数据库 audio_url 字段

4. **📊 查看结果**
   - 实时查看执行进度和日志
   - 查看 Supabase 上传统计
   - 下载生成的脚本和音频文件

### 输出文件说明

执行完成后，在 `outputs/YYYY/MM/DD/` 目录下会生成：

| 文件名 | 说明 | 格式 |
|--------|------|------|
| `论文播客稿-YYYY-MM-DD-HH-MM-SS.json` | 播客脚本（包含 title 和 script 字段） | JSON数组 |
| `{arxiv_id}.mp3` | 生成的音频文件（按论文ID命名） | MP3 |
| `arxiv_mapping.json` | arXiv ID 与 paper 索引的映射关系 | JSON |
| `podcast_titles.json` | arXiv ID 与播客标题的映射关系 | JSON |
| `audio_generation_result.json` | 音频生成结果统计 | JSON |
| `logs/execution_*.log` | 详细执行日志 | 文本 |

### Python TTS 模块使用

单独使用音频生成模块：

```bash
cd podcast_generator

# 从 JSON 文件生成音频
python produce_podcast.py \
  --script ../outputs/2025/10/09/论文播客稿-xxx.json \
  --output-dir ../outputs/2025/10/09 \
  --channel-id 355ed9b9-58d6-4716-a542-cadc13ae8ef4

# 仅检查配置（不生成音频）
python produce_podcast.py \
  --script ../outputs/2025/10/09/论文播客稿-xxx.json \
  --output-dir ../outputs/2025/10/09 \
  --check-only

# 详细日志模式
python produce_podcast.py \
  --script xxx.json \
  --output-dir ./output \
  --verbose
```

## API 接口

### HTTP 端点

| 端点 | 方法 | 说明 | 参数 |
|------|------|------|------|
| `/api/execute` | POST | 上传文件并执行完整工作流（SSE 流） | `file`: Excel 文件<br>`workflow`: Workflow类型<br>`channelId`: 频道ID |
| `/api/download/:filename` | GET | 下载生成的文件 | `filename`: 文件名 |
| `/api/workflows` | GET | 获取可用的 Workflow 列表 | - |
| `/api/settings` | GET/POST | 获取/保存用户设置 | `customOutputDir`: 自定义输出目录 |
| `/api/logs` | GET | 查询历史执行日志 | `page`, `limit`, `status` |
| `/api/health` | GET | 健康检查和配置信息 | - |

### SSE 事件类型

客户端通过 Server-Sent Events 接收实时进度：

| 事件类型 | 说明 | 数据字段 |
|---------|------|---------|
| `progress` | 执行进度更新 | `status`, `message`, `progress` (0-100) |
| `success` | 执行成功 | `result_file`, `elapsed_time`, `audio_files`, `upload_results` |
| `error` | 执行失败 | `message`, `error_type` |

### 进度状态说明

| Status | 说明 | Progress |
|--------|------|----------|
| `parsing_excel` | 解析Excel文件 | 15% |
| `validating_data` | 验证数据 | 20% |
| `uploading_to_supabase` | 上传到Supabase | 25% |
| `supabase_uploaded` | Supabase上传完成 | 30% |
| `uploading` | 上传文件到Dify | 35% |
| `running` | Dify Workflow执行中 | 40-60% |
| `getting_channel_config` | 获取频道配置 | 70% |
| `tts_started` | TTS开始生成 | 75% |
| `tts_generating` | TTS生成中 | 80% |
| `tts_completed` | TTS生成完成 | 85% |
| `audio_uploading` | 音频上传中 | 85-95% |
| `db_updating` | 更新数据库 | 95% |
| `audio_upload_completed` | 音频上传完成 | 98% |
| `succeeded` | 全部完成 | 100% |

## 技术栈

### 后端 (Node.js)
- **Node.js** v22.17.0 - JavaScript 运行时
- **Express** v4.18.2 - Web 服务器框架
- **axios** v1.6.2 - HTTP 客户端（Dify API 调用）
- **multer** v1.4.5 - 文件上传处理
- **@supabase/supabase-js** v2.38.4 - Supabase 客户端
- **xlsx** v0.18.5 - Excel 文件解析
- **dotenv** v16.3.1 - 环境变量管理
- **form-data** v4.0.0 - 多部分表单数据
- **cors** v2.8.5 - 跨域资源共享

### 前端
- **Vanilla JavaScript** - 无框架依赖
- **Server-Sent Events (SSE)** - 实时通信
- **Drag & Drop API** - 文件上传交互
- **Fetch API** - HTTP 请求

### Python TTS 模块
- **Python** 3.13.5 - Python 运行时
- **openai** 2.2.0 - OpenAI SDK（SiliconFlow API）
- **requests** 2.32.3 - HTTP 请求库
- **python-dotenv** 1.1.0 - 环境变量管理

### 第三方服务
- **Dify AI** - AI Workflow 编排平台
- **SiliconFlow** - TTS 语音合成服务
- **Supabase** - PostgreSQL 数据库 + 对象存储

## 核心实现

### 完整数据流

```
1. 用户上传 Excel 文件
   ↓
2. Backend 解析 Excel → 上传到 Supabase 数据库（去重）
   ↓
3. Backend 调用 Dify API 上传文件 → 获取 upload_file_id
   ↓
4. Backend 调用 Dify Workflow (流式)
   ↓
5. Dify 返回 JSON 数组: [{"title": "...", "script": "[S1]..."}, ...]
   ↓
6. Backend 保存为 .json 文件（标准 JSON 格式）
   ↓
7. Backend 调用 Python TTS 模块
   ↓
8. Python 解析 JSON 数组 → 为每个播客生成音频
   ↓
9. 生成多个 MP3 文件: {arxiv_id_1}.mp3, {arxiv_id_2}.mp3, ...
   ↓
10. Backend 上传音频到 Supabase Storage
   ↓
11. Backend 更新数据库 audio_url 字段
   ↓
12. 完成 ✅
```

### Dify Workflow 输入格式

```javascript
{
  inputs: {
    documents: [{
      type: 'document',
      transfer_method: 'local_file',
      upload_file_id: uploadFileId  // 从 uploadFile() 获取
    }]
  },
  response_mode: 'streaming',
  user: userId
}
```

### Dify Workflow 输出格式

Dify Workflow 应返回 **Python 列表格式**（单引号）：

```python
[
  {
    'title': '播客标题1',
    'script': '[S1]对话内容1...[S2]回复内容1...'
  },
  {
    'title': '播客标题2',
    'script': '[S1]对话内容2...[S2]回复内容2...'
  }
]
```

Backend 会自动转换为标准 JSON 格式（双引号）并保存。

### 批量音频生成机制

**关键改进** (2025-10-09)：
- ✅ Backend 保持 JSON 数组格式（不再合并为纯文本）
- ✅ Python 脚本按 JSON 数组解析，每个对象生成一个独立音频
- ✅ 文件命名使用 `arxiv_id.mp3`（从 `arxiv_mapping.json` 匹配）
- ✅ 支持单播客和多播客场景

**Python 解析逻辑**：
```python
# produce_podcast.py:149-208
if isinstance(segments, list):
    for item in segments:
        if isinstance(item, dict):
            title = item.get('title')
            script = item.get('script')
            arxiv_id = item.get('arxiv_id')
            # 生成音频: {arxiv_id}.mp3
```

## 开发说明

### 环境变量配置

| 变量名 | 说明 | 必填 | 默认值 |
|--------|------|------|--------|
| `DIFY_BASE_URL` | Dify API 基础 URL | 是 | `https://api.dify.ai/v1` |
| `DIFY_PODCAST_WORKFLOW_ID` | 播客 Workflow ID | 是 | - |
| `DIFY_PODCAST_API_KEY` | 播客 API Key | 是 | - |
| `SILICONFLOW_API_KEY` | SiliconFlow API Key | 是 | - |
| `SILICONFLOW_BASE_URL` | SiliconFlow API URL | 否 | `https://api.siliconflow.cn/v1` |
| `SUPABASE_URL` | Supabase 项目 URL | 否 | - |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key | 否 | - |
| `SKIP_TTS` | 跳过音频生成（调试用） | 否 | `0` |

### 频道配置

系统支持多个播客频道，每个频道有独立的存储路径：

| 频道名称 | Channel ID | Storage Path |
|---------|-----------|--------------|
| 论文前沿日报 | `355ed9b9-58d6-4716-a542-cadc13ae8ef4` | `daily-papers/` |
| 大厂动态一览 | `216c4396-cf27-425b-be09-e8565cf98dd2` | `tech-news/` |
| 经典论文解读 | `3f1c022b-222a-420a-9126-f96c63144ddc` | `classic-papers/` |

### 日志系统

- **控制台输出**: 带颜色的时间戳日志
- **文件记录**: 自动保存到 `outputs/YYYY/MM/DD/logs/`
- **日志级别**: `INFO`, `ERROR`, `SUCCESS`, `WARNING`

### 开发模式

```bash
# 使用 nodemon 自动重启
npm run dev

# 跳过音频生成（快速调试）
export SKIP_TTS=1  # Linux/Mac
set SKIP_TTS=1     # Windows
npm start
```

### 测试

```bash
# 测试 Python 脚本配置
cd podcast_generator
python produce_podcast.py --script test.json --output-dir ./test --check-only

# 测试 Node.js 服务器
cd backend
node server.js
```

## 常见问题

### Q: 为什么上传后没有反应？
A: 检查以下几点：
1. 浏览器控制台是否有错误
2. 后端日志是否显示 API 调用失败
3. `.env` 文件配置是否正确
4. Dify API Key 是否有效

### Q: 生成的文件在哪里？
A: `outputs/当前年/当前月/当前日/`，例如 `outputs/2025/10/09/`

### Q: 为什么只生成了1个音频文件？
A: 确认以下几点：
1. Dify Workflow 返回的是否为 JSON 数组格式
2. 保存的文件扩展名是否为 `.json`
3. 查看 `audio_generation_result.json` 中的 `files` 数组

### Q: 如何调试 Dify Workflow？
A: 查看以下日志：
1. `outputs/YYYY/MM/DD/logs/` 下的完整日志
2. 浏览器控制台的 SSE 事件流
3. Dify 控制台的 Workflow 执行记录

### Q: Python 脚本报错怎么办？
A: 常见问题：
1. **缺少依赖**: `pip install -r requirements.txt`
2. **API Key 未配置**: 检查 `.env` 文件中的 `SILICONFLOW_API_KEY`
3. **音色参考文件缺失**: 确认 `podcast_generator/female_base64.txt` 和 `male_base64.txt` 存在

### Q: Supabase 上传失败？
A: 检查以下几点：
1. Supabase 项目是否已创建
2. Service Role Key 是否正确
3. Storage bucket `podcast-audios` 是否存在且公开
4. Database 表结构是否正确

### Q: 如何跳过音频生成？
A: 设置环境变量 `SKIP_TTS=1`，用于快速测试脚本生成流程

## 故障排除

### 问题：音频生成卡住
**解决方法**：
1. 检查 SiliconFlow API 配额
2. 查看 Python 进程是否正常运行
3. 检查网络连接

### 问题：数据库重复上传
**解决方法**：
- 系统会自动检测 arXiv ID 去重
- 如需强制重新上传，先在数据库中删除对应记录

### 问题：文件权限错误
**解决方法**：
```bash
# Linux/Mac
chmod -R 755 outputs/
chmod -R 755 podcast_generator/

# Windows
# 确保当前用户对目录有读写权限
```

## 更新日志

### v1.1.0 (2025-10-09)
- ✨ **批量音频生成**: 支持从 JSON 数组生成多个音频文件
- ✨ **文件格式优化**: 播客脚本保存为标准 JSON 格式
- 🐛 **修复**: Python 脚本正确解析 JSON 数组
- 📝 **文档**: 完善 README 和 requirements.txt

### v1.0.0 (2025-10-01)
- 🎉 **初始发布**: 基础功能实现
- 📤 Excel 文件上传
- 🤖 Dify Workflow 集成
- 🎙️ TTS 音频生成
- 🗄️ Supabase 数据库集成

## 贡献

欢迎提交 Issue 和 Pull Request！

## License

MIT License

---

**完整技术文档**: 查看 [CLAUDE.md](./CLAUDE.md) 了解详细的架构说明和开发指南。

**Python 依赖**: 查看 [requirements.txt](./requirements.txt) 了解 Python 模块依赖。
