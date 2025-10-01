const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const config = require('./config');
const DifyClient = require('./difyClient');
const Logger = require('./logger');

const app = express();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// 配置文件上传
const upload = multer({
    dest: config.getOutputDir(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// ==================== 路由 ====================

// 根路径 - 返回前端页面
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// 上传并执行 workflow (SSE)
app.post('/api/execute', upload.single('file'), async (req, res) => {
    const logger = new Logger();
    let tempFilePath = null;
    let workflowRunId = null;

    try {
        // 设置 SSE 响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // 监听客户端断开连接
        req.on('close', () => {
            if (!res.writableEnded) {
                logger.warning('客户端断开连接，执行已取消');
                // 清理临时文件
                if (tempFilePath && fs.existsSync(tempFilePath)) {
                    try {
                        fs.unlinkSync(tempFilePath);
                        logger.info(`临时文件已删除: ${tempFilePath}`);
                    } catch (e) {
                        logger.warning(`删除临时文件失败: ${e.message}`);
                    }
                }
            }
        });

        // 辅助函数：发送 SSE 事件
        const sendEvent = (event, data) => {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        // 1. 验证文件
        if (!req.file) {
            sendEvent('error', { message: '未接收到文件' });
            res.end();
            return;
        }

        if (!req.file.originalname.endsWith('.xlsx')) {
            sendEvent('error', { message: '只支持 .xlsx 格式文件' });
            res.end();
            return;
        }

        // 获取 workflow 类型（从请求体中）
        const workflowType = req.body.workflow || 'PODCAST';
        const workflowConfig = config.getWorkflowConfig(workflowType);

        if (!workflowConfig) {
            sendEvent('error', { message: `无效的 workflow 类型: ${workflowType}` });
            res.end();
            return;
        }

        tempFilePath = req.file.path;
        const fileName = req.file.originalname;
        const fileSize = (req.file.size / 1024).toFixed(2);

        logger.info(`收到文件: ${fileName} (${fileSize} KB)`);
        logger.info(`使用 Workflow: ${workflowConfig.name} (${workflowType})`);
        sendEvent('progress', {
            status: 'uploading',
            message: '正在上传文件...',
            progress: 10
        });

        // 2. 上传到 Dify
        const difyClient = new DifyClient(logger, workflowType);
        const uploadFileId = await difyClient.uploadFile(tempFilePath, fileName);

        if (!uploadFileId) {
            sendEvent('error', { message: '文件上传到 Dify 失败' });
            res.end();
            return;
        }

        sendEvent('progress', {
            status: 'running',
            message: '文件上传成功，开始执行 workflow...',
            progress: 30,
            upload_file_id: uploadFileId
        });

        // 3. 执行 workflow (流式)
        const response = await difyClient.runWorkflowStreaming(uploadFileId, 'documents');

        let buffer = '';

        response.data.on('data', async (chunk) => {
            buffer += chunk.toString();

            // 处理完整的事件
            const events = buffer.split('\n\n');
            buffer = events.pop(); // 保留不完整的事件

            for (const eventStr of events) {
                if (!eventStr.trim()) continue;

                try {
                    const lines = eventStr.split('\n');
                    let eventType = 'message';
                    let eventData = '';

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            eventType = line.substring(7).trim();
                        } else if (line.startsWith('data: ')) {
                            eventData = line.substring(6).trim();
                        }
                    }

                    if (!eventData) continue;

                    const data = JSON.parse(eventData);

                    // 处理不同的事件类型
                    if (data.event === 'workflow_started') {
                        workflowRunId = data.workflow_run_id;
                        logger.info(`Workflow 开始执行, run_id: ${workflowRunId}`);
                        sendEvent('progress', {
                            status: 'running',
                            message: 'Workflow 开始执行',
                            progress: 40,
                            workflow_run_id: workflowRunId
                        });

                    } else if (data.event === 'node_started') {
                        const nodeTitle = data.data?.title || '未知节点';
                        logger.info(`节点开始: ${nodeTitle}`);
                        sendEvent('progress', {
                            status: 'running',
                            message: `正在执行: ${nodeTitle}`,
                            progress: 50
                        });

                    } else if (data.event === 'node_finished') {
                        const nodeTitle = data.data?.title || '未知节点';
                        logger.info(`节点完成: ${nodeTitle}`);
                        sendEvent('progress', {
                            status: 'running',
                            message: `完成: ${nodeTitle}`,
                            progress: 60
                        });

                    } else if (data.event === 'workflow_finished') {
                        const status = data.data?.status;
                        const elapsedTime = data.data?.elapsed_time || 0;
                        const totalTokens = data.data?.total_tokens || 0;

                        if (status === 'succeeded') {
                            logger.info(`Workflow 执行成功! 耗时: ${elapsedTime.toFixed(2)}秒, Tokens: ${totalTokens}`);

                            // 4. 根据 workflow 类型决定是否下载文件
                            if (workflowConfig.needsDownload) {
                                // 需要下载文件
                                const files = data.data?.outputs?.files;
                                if (!files || files.length === 0) {
                                    logger.error('未找到输出文件');
                                    sendEvent('error', { message: '未找到输出文件' });
                                    res.end();
                                    return;
                                }

                                const fileInfo = files[0];
                                const fileUrl = fileInfo.url;
                                const fileName = fileInfo.filename;

                                logger.info(`开始下载文件: ${fileName}`);
                                logger.info(`文件 URL: ${fileUrl}`);

                                try {
                                    // 下载文件
                                    const axios = require('axios');
                                    const fileResponse = await axios.get(fileUrl, {
                                        timeout: 60000,
                                        responseType: 'text',  // 强制以文本格式接收
                                        transformResponse: [(data) => data]  // 禁用自动 JSON 解析
                                    });

                                    // 确保内容是字符串
                                    let fileContent = fileResponse.data;
                                    if (Array.isArray(fileContent)) {
                                        fileContent = fileContent.join('');
                                    } else if (typeof fileContent !== 'string') {
                                        fileContent = String(fileContent);
                                    }

                                    // 保存文件
                                    const resultPath = path.join(config.getOutputDir(), fileName);
                                    fs.writeFileSync(resultPath, fileContent, 'utf8');
                                    logger.info(`结果保存至: ${resultPath}`);

                                    sendEvent('success', {
                                        status: 'succeeded',
                                        message: '执行成功!',
                                        progress: 100,
                                        result_file: fileName,
                                        elapsed_time: elapsedTime,
                                        total_tokens: totalTokens
                                    });

                                } catch (downloadError) {
                                    logger.error(`文件下载失败: ${downloadError.message}`);
                                    sendEvent('error', { message: `文件下载失败: ${downloadError.message}` });
                                    res.end();
                                    return;
                                }
                            } else {
                                // 不需要下载文件（如 CHEESE_DAILY）
                                logger.info('Workflow 执行完成，无需下载文件');
                                sendEvent('success', {
                                    status: 'succeeded',
                                    message: '执行成功!',
                                    progress: 100,
                                    elapsed_time: elapsedTime,
                                    total_tokens: totalTokens,
                                    no_download: true
                                });
                            }

                        } else {
                            const error = data.data?.error || '未知错误';
                            logger.error(`Workflow 执行失败: ${error}`);
                            sendEvent('error', {
                                status: 'failed',
                                message: `执行失败: ${error}`
                            });
                        }
                    }

                } catch (e) {
                    console.error('解析事件失败:', e);
                }
            }
        });

        response.data.on('end', () => {
            res.end();
        });

        response.data.on('error', (error) => {
            logger.error(`流式响应错误: ${error.message}`);
            sendEvent('error', { message: error.message });
            res.end();
        });

    } catch (error) {
        logger.error(`系统异常: ${error.message}`);
        res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
        res.end();

    } finally {
        // 清理临时文件
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
                logger.info(`临时文件已删除: ${tempFilePath}`);
            } catch (e) {
                logger.warning(`删除临时文件失败: ${e.message}`);
            }
        }
    }
});

// 下载结果文件
app.get('/api/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(config.getOutputDir(), filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '文件不存在' });
    }

    res.download(filePath, filename);
});

// 获取可用的 workflows
app.get('/api/workflows', (req, res) => {
    const workflows = config.getAvailableWorkflows();
    res.json({ workflows });
});

// 获取当前设置
app.get('/api/settings', (req, res) => {
    res.json({
        customOutputDir: config.customOutputDir,
        defaultOutputDir: config.OUTPUT_BASE_DIR
    });
});

// 保存设置
app.post('/api/settings', express.json(), (req, res) => {
    const { customOutputDir } = req.body;

    if (customOutputDir) {
        config.setCustomOutputDir(customOutputDir);
        res.json({ success: true, message: '设置已保存', customOutputDir: config.customOutputDir });
    } else {
        res.status(400).json({ success: false, message: '无效的设置参数' });
    }
});

// 查询 workflow 日志
app.get('/api/logs', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status || null;

    const difyClient = new DifyClient();
    const logs = await difyClient.getWorkflowLogs(page, limit, status);

    if (logs) {
        res.json(logs);
    } else {
        res.status(500).json({ error: '查询日志失败' });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        config: {
            dify_base_url: config.DIFY_BASE_URL,
            output_dir: config.getOutputDir()
        }
    });
});

// ==================== 启动服务器 ====================

app.listen(config.PORT, config.HOST, () => {
    console.log('========================================');
    console.log('  🎙️ Podcast Script Generator');
    console.log('========================================');
    console.log(`📡 服务地址: http://${config.HOST}:${config.PORT}`);
    console.log(`📁 输出目录: ${config.getOutputDir()}`);
    console.log(`🔑 Dify API: ${config.DIFY_BASE_URL}`);
    console.log('========================================');
});