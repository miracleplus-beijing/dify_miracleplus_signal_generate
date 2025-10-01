# Podcast Script Generator

🎙️ 基于 Dify Workflow 的播客脚本生成工具

## 功能特性

- 📤 拖拽上传 Excel 文件
- 🔄 实时显示执行进度（基于 SSE）
- 📋 详细的执行日志记录
- 💾 按日期自动归档输出文件
- ⬇️ 一键下载生成的 Markdown 脚本

## 项目结构

```
podcast_script_generate/
├── frontend/              # 前端文件
│   ├── index.html        # 主页面
│   ├── style.css         # 样式文件
│   └── app.js            # 前端逻辑（拖拽上传、SSE 处理）
├── backend/              # 后端文件
│   ├── server.js         # Express 服务器（SSE 端点）
│   ├── difyClient.js     # Dify API 客户端
│   ├── config.js         # 配置管理（动态输出目录）
│   ├── logger.js         # 日志系统
│   └── package.json      # 依赖配置
├── outputs/              # 输出目录（按日期组织）
│   └── YYYY/MM/DD/
│       ├── result_HHMMSS.md        # 生成的脚本
│       └── logs/
│           └── execution_HHMMSS.log # 执行日志
├── doc/                  # 文档和测试文件
├── .env                  # 环境变量配置
├── start.bat             # Windows 快速启动脚本
├── CLAUDE.md             # Claude Code 项目说明
└── README.md             # 本文件
```

## 快速开始

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 配置环境变量

在项目根目录创建 `.env` 文件:

```env
DIFY_API_KEY=app-your-api-key-here
DIFY_BASE_URL=https://api.dify.ai/v1
```

### 3. 启动服务

**方式一：使用 npm 脚本**
```bash
npm start              # 生产模式
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

### 4. 访问应用

打开浏览器访问: **http://127.0.0.1:8000**

## 使用方法

1. 📁 拖拽或点击上传 `.xlsx` 文件
2. ⚙️ 系统自动上传文件到 Dify 并执行 workflow
3. 👀 实时查看工作流执行进度和节点状态
4. ✅ 执行完成后下载生成的 Markdown 脚本

## API 接口

| 端点 | 方法 | 说明 | 参数 |
|------|------|------|------|
| `/api/execute` | POST | 上传文件并执行 workflow（返回 SSE 流） | `file`: Excel 文件 |
| `/api/download/:filename` | GET | 下载生成的 Markdown 文件 | `filename`: 文件名 |
| `/api/logs` | GET | 查询历史执行日志 | `page`, `limit`, `status` |
| `/api/health` | GET | 健康检查和配置信息 | - |

### SSE 事件类型

客户端通过 Server-Sent Events 接收实时进度：

- `progress`: 工作流节点执行进度
- `success`: 执行成功，返回文件名
- `error`: 执行失败，返回错误信息

## 技术栈

**后端**
- **Node.js** + **Express** - Web 服务器
- **axios** - HTTP 客户端（Dify API 调用）
- **multer** - 文件上传处理
- **dotenv** - 环境变量管理
- **form-data** - 多部分表单数据

**前端**
- **Vanilla JavaScript** - 无框架依赖
- **Server-Sent Events (SSE)** - 实时通信
- **拖拽 API** - 文件上传交互

## 核心实现

### 数据流

1. 用户上传 `.xlsx` 文件 → 前端（drag & drop 或 file picker）
2. 前端 `POST /api/execute` → 后端 Express 服务器
3. 后端调用 `DifyClient.uploadFile()` → Dify API 返回 `upload_file_id`
4. 后端调用 `DifyClient.runWorkflowStreaming()` → Dify 开始流式返回事件
5. Dify 事件流（`workflow_started`, `node_started`, `text_chunk`, `workflow_finished`）
6. 后端解析并转发自定义 SSE 事件 → 前端实时更新 UI
7. 后端组装 `text_chunk` 并保存到 `outputs/YYYY/MM/DD/result_HHMMSS.md`

### Dify Workflow 输入格式

```javascript
{
  inputs: {
    [fileVariableName]: [{
      type: 'document',
      transfer_method: 'local_file',
      upload_file_id: uploadFileId  // 从 uploadFile() 获取
    }]
  },
  response_mode: 'streaming',
  user: userId
}
```

### 输出文件组织

- **按日期分层**: `outputs/2025/10/01/`
- **结果文件**: `result_142530.md`（时分秒时间戳）
- **日志文件**: `logs/execution_142530.log`
- **自动创建**: 目录不存在时自动创建

## 开发说明

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DIFY_API_KEY` | Dify API 密钥（必填） | - |
| `DIFY_BASE_URL` | Dify API 基础 URL | `https://api.dify.ai/v1` |

### 日志系统

- **控制台输出**: 带颜色的时间戳日志
- **文件记录**: 自动保存到 `outputs/YYYY/MM/DD/logs/`
- **日志级别**: `INFO`, `ERROR`, `SUCCESS`

### 开发模式

```bash
npm run dev  # 使用 nodemon 自动重启
```

## 常见问题

**Q: 为什么上传后没有反应？**
A: 检查浏览器控制台和后端日志，确认 `DIFY_API_KEY` 配置正确。

**Q: 生成的文件在哪里？**
A: `outputs/当前年/当前月/当前日/result_时分秒.md`

**Q: 如何调试 Dify workflow？**
A: 查看 `outputs/YYYY/MM/DD/logs/` 下的日志文件，包含完整的事件流。

## License

MIT

---

**项目文档**: 查看 `CLAUDE.md` 了解完整的架构说明和开发指南。
