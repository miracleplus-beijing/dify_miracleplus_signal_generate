# Podcast Script Generator

🎙️ 基于 Dify Workflow 的播客脚本生成工具

## 功能特性

- 📤 拖拽上传 Excel 文件
- 🔄 实时显示执行进度
- 📋 详细的执行日志
- 💾 自动保存结果到本地 (按日期组织)
- ⬇️ 一键下载生成的 Markdown 文件

## 项目结构

```
podcast_script_generate/
├── frontend/           # 前端文件
│   ├── index.html     # 主页面
│   ├── style.css      # 样式
│   └── app.js         # 前端逻辑
├── backend/           # 后端文件
│   ├── main.py        # FastAPI 主程序
│   ├── dify_client.py # Dify API 客户端
│   ├── config.py      # 配置管理
│   ├── logger.py      # 日志模块
│   └── requirements.txt
├── outputs/           # 输出目录 (年/月/日)
│   └── 2025/09/30/
│       ├── result_*.md
│       └── logs/
└── .env              # 环境变量配置
```

## 快速开始

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 配置环境变量

确保 `.env` 文件包含以下配置:

```env
DIFY_API_KEY=app-xxx
DIFY_BASE_URL=https://api.dify.ai/v1
```

### 3. 启动服务

**Windows:**
```bash
node backend/server.js
```

**或使用启动脚本:**
```bash
start.bat
```

### 4. 访问应用

打开浏览器访问: http://127.0.0.1:8000

## 使用方法

1. 拖拽或选择 Excel 文件 (.xlsx)
2. 系统自动上传并执行 workflow
3. 实时查看执行进度和日志
4. 执行完成后下载结果 (.md)

## API 接口

- `POST /api/execute` - 上传文件并执行 workflow (SSE)
- `GET /api/download/{filename}` - 下载结果文件
- `GET /api/logs` - 查询 workflow 日志
- `GET /api/health` - 健康检查

## 输出文件

- 结果文件: `outputs/年/月/日/result_HHMMSS.md`
- 日志文件: `outputs/年/月/日/logs/execution_HHMMSS.log`

## 技术栈

**后端:**
- Node.js + Express
- axios (HTTP 客户端)
- multer (文件上传)
- dotenv (环境变量)

**前端:**
- 原生 HTML/CSS/JavaScript
- Server-Sent Events (SSE)

## License

MIT