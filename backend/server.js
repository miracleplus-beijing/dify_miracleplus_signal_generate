const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { spawn } = require('child_process');

const config = require('./config');
const DifyClient = require('./difyClient');
const Logger = require('./logger');
const SupabaseClient = require('./supabaseClient');
const ExcelParser = require('./excelParser');
const ArxivEnricher = require('./arxivEnricher');

const app = express();
const projectRoot = path.join(__dirname, '..');

/**
 * 处理批量arXiv链接（批量模式）
 */
async function processBatchArxiv(arxivLinks, difyClient, logger, sendEvent) {
    try {
        const arxivUrls = arxivLinks.map(link => link.arxiv_url);

        logger.info(`[Batch] 开始批量处理: ${arxivUrls.length} 个链接`);
        sendEvent('progress', {
            status: 'dify_batch_start',
            message: `正在批量调用Dify处理 ${arxivUrls.length} 个论文...`,
            progress: 20
        });

        const response = await difyClient.runWorkflowBatch(arxivUrls);

        // 解析批量响应
        let buffer = '';
        const results = [];

        return new Promise((resolve, reject) => {
            response.data.on('data', (chunk) => {
                buffer += chunk.toString();

                const events = buffer.split('\n\n');
                buffer = events.pop();

                for (const eventStr of events) {
                    if (!eventStr.trim()) continue;

                    try {
                        const lines = eventStr.split('\n');
                        let eventData = '';

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                eventData = line.substring(6).trim();
                            }
                        }

                        if (eventData) {
                            const data = JSON.parse(eventData);

                            // 处理节点进度
                            if (data.event === 'node_started') {
                                sendEvent('progress', {
                                    status: 'dify_processing',
                                    message: `Dify正在处理: ${data.data?.title || ''}`,
                                    progress: 30
                                });
                            }

                            // 提取最终结果
                            if (data.event === 'workflow_finished' && data.data?.status === 'succeeded') {
                                const outputs = data.data.outputs || {};

                                // 获取Dify返回的结果数组
                                const batchResults = outputs[config.DIFY_BATCH_OUTPUT_VARIABLE] || outputs.results || outputs.podcasts || [];

                                if (Array.isArray(batchResults)) {
                                    logger.info(`[Batch] 收到 ${batchResults.length} 个结果`);

                                    batchResults.forEach((item, idx) => {
                                        const arxivId = item.arxiv_id || arxivLinks[idx]?.arxiv_id || '';
                                        results.push({
                                            success: true,
                                            arxiv_id: arxivId,
                                            arxiv_url: arxivLinks[idx]?.arxiv_url || '',
                                            podcast_title: item.podcast_title || '',
                                            podcast_script: item.podcast_script || '',
                                            metadata: arxivLinks[idx]?.metadata || {},
                                            error: null
                                        });
                                    });
                                } else {
                                    logger.error('[Batch] Dify返回格式不是数组');
                                    reject(new Error('Dify返回格式错误'));
                                }
                            }
                        }
                    } catch (e) {
                        logger.error(`[Batch] 解析响应失败: ${e.message}`);
                    }
                }
            });

            response.data.on('end', () => {
                if (results.length > 0) {
                    logger.info(`[Batch] ✓ 批量处理完成: ${results.length} 个结果`);
                    resolve(results);
                } else {
                    reject(new Error('批量处理未返回有效结果'));
                }
            });

            response.data.on('error', (error) => {
                reject(error);
            });
        });

    } catch (error) {
        logger.error(`[Batch] 批量处理失败: ${error.message}`);
        throw error;
    }
}

/**
 * 处理单个arXiv链接（串行模式）
 */
async function processSingleArxiv(arxivUrl, arxivId, metadata, difyClient, logger) {
    try {
        logger.info(`[Single] 开始处理: ${arxivId}`);

        const response = await difyClient.runWorkflowSingle(arxivUrl);

        // 解析单个响应
        let buffer = '';
        let finalResult = null;

        return new Promise((resolve, reject) => {
            response.data.on('data', (chunk) => {
                buffer += chunk.toString();

                const events = buffer.split('\n\n');
                buffer = events.pop();

                for (const eventStr of events) {
                    if (!eventStr.trim()) continue;

                    try {
                        const lines = eventStr.split('\n');
                        let eventData = '';

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                eventData = line.substring(6).trim();
                            }
                        }

                        if (eventData) {
                            const data = JSON.parse(eventData);

                            if (data.event === 'workflow_finished' && data.data?.status === 'succeeded') {
                                const outputs = data.data.outputs || {};
                                finalResult = {
                                    podcast_title: outputs.podcast_title || '',
                                    podcast_script: outputs.podcast_script || ''
                                };
                            }
                        }
                    } catch (e) {
                        logger.error(`[Single] 解析响应失败: ${e.message}`);
                    }
                }
            });

            response.data.on('end', () => {
                if (finalResult) {
                    logger.info(`[Single] ✓ 完成: ${arxivId}`);
                    resolve({
                        success: true,
                        arxiv_id: arxivId,
                        arxiv_url: arxivUrl,
                        podcast_title: finalResult.podcast_title,
                        podcast_script: finalResult.podcast_script,
                        metadata: metadata,
                        error: null
                    });
                } else {
                    reject(new Error(`未获取到有效结果: ${arxivId}`));
                }
            });

            response.data.on('error', (error) => {
                reject(error);
            });
        });

    } catch (error) {
        logger.error(`[Single] ✗ 失败: ${arxivId} - ${error.message}`);
        return {
            success: false,
            arxiv_id: arxivId,
            arxiv_url: arxivUrl,
            podcast_title: '',
            podcast_script: '',
            metadata: metadata,
            error: error.message
        };
    }
}

/**
 * 上传音频文件到Supabase Storage并更新数据库
 * @param {Array} files - 文件列表 [{local_path, arxiv_id, channel_id}]
 * @param {Object} channelConfig - 频道配置 {storagePath, namingPrefix}
 * @param {Object} supabaseClient - Supabase客户端
 * @param {Object} logger - 日志记录器
 * @param {Function} sendEvent - SSE事件发送函数
 * @returns {Promise<Object>} 上传结果
 */
async function uploadAudioFiles(files, channelConfig, supabaseClient, logger, sendEvent) {
    const results = {
        success: 0,
        failed: 0,
        errors: [],
        urls: []
    };

    logger.info(`开始上传 ${files.length} 个音频文件到Supabase Storage...`);

    for (let i = 0; i < files.length; i++) {
        const fileInfo = files[i];
        const { local_path, arxiv_id } = fileInfo;

        try {
            // 读取文件
            if (!fs.existsSync(local_path)) {
                throw new Error(`文件不存在: ${local_path}`);
            }

            const fileData = fs.readFileSync(local_path);
            const storagePath = `${channelConfig.storagePath}/${arxiv_id}.mp3`;

            logger.info(`上传文件 [${i + 1}/${files.length}]: ${storagePath}`);
            sendEvent('progress', {
                status: 'audio_uploading',
                message: `正在上传音频 (${i + 1}/${files.length}): ${arxiv_id}.mp3`,
                progress: 85 + Math.floor((i / files.length) * 10)
            });

            // 上传到Supabase Storage
            const { data, error } = await supabaseClient.supabase.storage
                .from('podcast-audios')
                .upload(storagePath, fileData, {
                    contentType: 'audio/mpeg',
                    upsert: true
                });

            if (error) {
                throw new Error(`Storage上传失败: ${error.message}`);
            }

            // 获取public URL
            const { data: urlData } = supabaseClient.supabase.storage
                .from('podcast-audios')
                .getPublicUrl(storagePath);

            const publicUrl = urlData.publicUrl;
            logger.info(`✓ 上传成功: ${storagePath} -> ${publicUrl}`);

            results.urls.push({ arxiv_id, url: publicUrl });
            results.success++;

        } catch (error) {
            results.failed++;
            results.errors.push({
                arxiv_id,
                error: error.message
            });
            logger.error(`✗ 上传失败 ${arxiv_id}: ${error.message}`);
        }
    }

    // 更新数据库audio_url字段
    if (results.urls.length > 0) {
        sendEvent('progress', {
            status: 'db_updating',
            message: '正在更新数据库...',
            progress: 95
        });

        const updates = results.urls.map(item => ({
            arxiv_id: item.arxiv_id,
            audio_url: item.url
        }));

        try {
            const dbResults = await supabaseClient.updatePodcastAudioUrls(updates, logger);
            results.dbUpdates = dbResults;
            logger.info(`数据库更新完成: 成功 ${dbResults.success} 条, 失败 ${dbResults.failed} 条`);
        } catch (dbError) {
            logger.error(`数据库更新失败: ${dbError.message}`);
            results.dbUpdateError = dbError.message;
        }
    }

    logger.info(`音频上传完成: 成功 ${results.success}/${files.length}, 失败 ${results.failed}`);
    return results;
}

/**
 * 运行播客TTS生成和上传
 * @param {string} scriptPath - 脚本文件路径
 * @param {string} channelId - 频道ID
 * @param {Object} logger - 日志记录器
 * @param {Function} sendEvent - SSE事件发送函数
 * @returns {Promise<Object>} 返回音频文件信息和上传结果
 */
async function runPodcastTTS(scriptPath, channelId, logger, sendEvent) {
    if (process.env.SKIP_TTS === '1') {
        logger.info('跳过音频生成（SKIP_TTS=1）');
        sendEvent('progress', {
            status: 'tts_skipped',
            message: '已根据配置跳过音频生成',
            progress: 90
        });
        return { audioFiles: [], skipped: true };
    }

    try {
        // 获取频道存储配置
        const supabaseClient = new SupabaseClient();
        sendEvent('progress', {
            status: 'getting_channel_config',
            message: '正在获取频道配置...',
            progress: 70
        });

        const channelConfig = await supabaseClient.getChannelStorageConfig(channelId, logger);
        logger.info(`频道配置: ${JSON.stringify(channelConfig)}`);

        // 准备Python命令参数
        const pythonExecutable = process.env.PODCAST_PYTHON || process.env.PYTHON || 'python';
        const ttsScriptPath = path.join(projectRoot, 'podcast_generator', 'produce_podcast.py');

        if (!fs.existsSync(ttsScriptPath)) {
            throw new Error(`未找到音频生成脚本: ${ttsScriptPath}`);
        }

        const outputDir = path.dirname(scriptPath);
        const args = [
            ttsScriptPath,
            '--script',
            scriptPath,
            '--output-dir',
            outputDir,
            '--channel-id',
            channelId
        ];

        logger.info(`启动播客音频生成: ${pythonExecutable} ${args.join(' ')}`);
        sendEvent('progress', {
            status: 'tts_started',
            message: '正在生成播客音频...',
            progress: 75,
            script_file: path.basename(scriptPath)
        });

        // 执行Python脚本
        return new Promise((resolve, reject) => {
            const child = spawn(pythonExecutable, args, {
                cwd: projectRoot,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8'
                }
            });

            const audioFiles = [];
            let uploadResults = null;
            const stdoutBuffer = { value: '' };
            const stderrBuffer = { value: '' };

            const flushBuffer = (buffer, handler) => {
                const lines = buffer.value.split(/\r?\n/);
                buffer.value = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed) {
                        handler(trimmed);
                    }
                }
            };

            const handleStdoutLine = (line) => {
                logger.info(`[TTS] ${line}`);

                // 解析音频生成进度
                if (line.includes('[Audio]')) {
                    sendEvent('progress', {
                        status: 'tts_generating',
                        message: line,
                        progress: 80
                    });
                }

                // 解析音频文件输出
                const audioMatch = line.match(/输出文件[:：]\s*(.+\.mp3)$/);
                if (audioMatch) {
                    const filePath = audioMatch[1].trim();
                    audioFiles.push(filePath);
                }

                // 解析生成完成
                if (line.includes('[Stats] 生成完成统计')) {
                    sendEvent('progress', {
                        status: 'tts_completed',
                        message: '音频生成完成，准备上传...',
                        progress: 85
                    });
                }

                // 解析上传进度
                if (line.includes('[Upload]') || line.includes('[Batch]')) {
                    sendEvent('progress', {
                        status: 'audio_uploading',
                        message: line,
                        progress: 90
                    });
                }

                // 解析数据库更新
                if (line.includes('[Database]') || line.includes('[DB]')) {
                    sendEvent('progress', {
                        status: 'db_updating',
                        message: line,
                        progress: 95
                    });
                }
            };

            const handleStderrLine = (line) => {
                logger.error(`[TTS][stderr] ${line}`);
            };

            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');

            child.stdout.on('data', (chunk) => {
                stdoutBuffer.value += chunk;
                flushBuffer(stdoutBuffer, handleStdoutLine);
            });

            child.stderr.on('data', (chunk) => {
                stderrBuffer.value += chunk;
                flushBuffer(stderrBuffer, handleStderrLine);
            });

            child.on('error', (error) => {
                logger.error(`音频生成进程启动失败: ${error.message}`);
                reject(error);
            });

            child.on('close', async (code) => {
                flushBuffer(stdoutBuffer, handleStdoutLine);
                flushBuffer(stderrBuffer, handleStderrLine);

                if (code === 0) {
                    // 读取生成结果JSON
                    const resultFile = path.join(outputDir, 'audio_generation_result.json');
                    try {
                        if (fs.existsSync(resultFile)) {
                            const resultData = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
                            logger.info(`音频生成完成: ${JSON.stringify(resultData, null, 2)}`);

                            // Backend负责上传音频文件
                            if (resultData.files && resultData.files.length > 0) {
                                sendEvent('progress', {
                                    status: 'audio_uploading',
                                    message: '开始上传音频到Supabase Storage...',
                                    progress: 85
                                });

                                try {
                                    uploadResults = await uploadAudioFiles(
                                        resultData.files,
                                        channelConfig,
                                        supabaseClient,
                                        logger,
                                        sendEvent
                                    );

                                    sendEvent('progress', {
                                        status: 'audio_upload_completed',
                                        message: '音频上传和数据库更新完成',
                                        progress: 98,
                                        upload_results: uploadResults
                                    });

                                    // 🔧 新增：更新播客标题到数据库
                                    const titleMappingPath = path.join(outputDir, 'podcast_titles.json');
                                    if (fs.existsSync(titleMappingPath)) {
                                        try {
                                            sendEvent('progress', {
                                                status: 'updating_titles',
                                                message: '正在更新播客标题到数据库...',
                                                progress: 99
                                            });

                                            const titleMapping = JSON.parse(fs.readFileSync(titleMappingPath, 'utf8'));
                                            const titleUpdateResults = await supabaseClient.updatePodcastTitles(titleMapping, logger);

                                            logger.info(`播客标题更新完成: 成功 ${titleUpdateResults.success} 条, 失败 ${titleUpdateResults.failed} 条`);

                                            // 将结果添加到uploadResults中
                                            uploadResults.titleUpdates = titleUpdateResults;

                                        } catch (titleError) {
                                            logger.error(`更新播客标题失败: ${titleError.message}`);
                                            uploadResults.titleUpdateError = titleError.message;
                                        }
                                    }

                                } catch (uploadError) {
                                    logger.error(`音频上传失败: ${uploadError.message}`);
                                    // 即使上传失败也不影响音频生成成功的结果
                                    uploadResults = { success: 0, failed: resultData.files.length, error: uploadError.message };
                                }
                            }
                        }
                    } catch (e) {
                        logger.warning(`读取结果文件失败: ${e.message}`);
                    }

                    resolve({
                        audioFiles,
                        uploadResults,
                        skipped: false
                    });
                } else {
                    const error = new Error(`音频生成进程退出码 ${code}`);
                    logger.error(error.message);
                    reject(error);
                }
            });
        });

    } catch (error) {
        logger.error(`TTS执行失败: ${error.message}`);
        throw error;
    }
}

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
    const supabaseClient = new SupabaseClient();
    const excelParser = new ExcelParser();
    let tempFilePath = null;
    let workflowRunId = null;
    let excelData = null;
    let supabaseResults = null;
    let enrichedData = null;
    let validationResults = null;
    let arxivLinks = [];

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

        // 获取 workflow 类型和频道ID（从请求体中）
        const workflowType = req.body.workflow || 'PODCAST';
        const channelId = req.body.channelId || '355ed9b9-58d6-4716-a542-cadc13ae8ef4'; // 默认使用论文前沿日报
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

        // 新增：解析Excel文件并上传到Supabase
        if (workflowType === 'PODCAST') {
            try {
                sendEvent('progress', {
                    status: 'parsing_excel',
                    message: '正在解析Excel文件...',
                    progress: 5
                });

                // 解析Excel文件
                excelData = await excelParser.parseExcelFile(tempFilePath, logger);

                if (excelData.length === 0) {
                    throw new Error('Excel文件中没有有效数据');
                }

                // 🆕 补全arXiv数据
                sendEvent('progress', {
                    status: 'enriching_data',
                    message: '正在从arXiv补全论文数据...',
                    progress: 10
                });

                const arxivEnricher = new ArxivEnricher(logger, {
                    enabled: process.env.ARXIV_ENRICH_ENABLED !== 'false',
                    apiDelayMs: parseInt(process.env.ARXIV_API_DELAY_MS || '1000'),
                    maxRetries: parseInt(process.env.ARXIV_MAX_RETRIES || '3'),
                    timeoutMs: parseInt(process.env.ARXIV_TIMEOUT_MS || '30000')
                });

                enrichedData = await arxivEnricher.enrichData(excelData, sendEvent);

                // 记录补全统计
                const enrichStats = arxivEnricher.getStats();
                logger.info(`arXiv数据补全统计: ${JSON.stringify(enrichStats)}`);

                sendEvent('progress', {
                    status: 'validating_data',
                    message: `正在验证数据 (${enrichedData.length} 条记录)...`,
                    progress: 20,
                    enrich_stats: enrichStats
                });

                // 验证数据（使用补全后的数据）
                validationResults = excelParser.validateData(enrichedData, logger);

                if (validationResults.valid.length === 0) {
                    throw new Error('Excel数据验证失败：没有有效的数据行');
                }

                sendEvent('progress', {
                    status: 'uploading_to_supabase',
                    message: '正在上传到Supabase数据库...',
                    progress: 25,
                    enrich_stats: enrichStats
                });

                // 📝 提取arXiv链接列表（新增）
                sendEvent('progress', {
                    status: 'extracting_arxiv',
                    message: '正在提取arXiv链接...',
                    progress: 25
                });

                arxivLinks = excelParser.extractArxivLinks(enrichedData);
                logger.info(`提取到 ${arxivLinks.length} 个arXiv链接`);

                if (arxivLinks.length === 0) {
                    throw new Error('未找到有效的arXiv链接');
                }

            } catch (excelError) {
                logger.error(`Excel处理失败: ${excelError.message}`);
                sendEvent('error', {
                    message: `Excel处理失败: ${excelError.message}`,
                    error_type: 'excel_processing'
                });
                res.end();
                return;
            }
        }

        // 🚀 调用Dify处理arXiv链接（新流程）
        const difyClient = new DifyClient(logger, workflowType);
        let podcastResults = [];

        if (config.DIFY_BATCH_MODE === 'batch') {
            // ========== 批量模式 ==========
            sendEvent('progress', {
                status: 'dify_batch_processing',
                message: `使用批量模式处理 ${arxivLinks.length} 个论文...`,
                progress: 30
            });

            podcastResults = await processBatchArxiv(arxivLinks, difyClient, logger, sendEvent);

        } else {
            // ========== 串行模式 ==========
            sendEvent('progress', {
                status: 'dify_sequential_processing',
                message: `使用串行模式处理 ${arxivLinks.length} 个论文...`,
                progress: 30
            });

            for (let i = 0; i < arxivLinks.length; i++) {
                const link = arxivLinks[i];
                const progressPercent = 30 + Math.floor((i / arxivLinks.length) * 25); // 30-55%

                sendEvent('progress', {
                    status: 'processing_arxiv',
                    message: `正在处理 [${i + 1}/${arxivLinks.length}]: ${link.arxiv_id}`,
                    progress: progressPercent
                });

                const result = await processSingleArxiv(
                    link.arxiv_url,
                    link.arxiv_id,
                    link.metadata,
                    difyClient,
                    logger
                );

                podcastResults.push(result);
            }
        }

        // 统计处理结果
        const successCount = podcastResults.filter(r => r.success).length;
        const failedCount = podcastResults.filter(r => !r.success).length;

        logger.info(`Dify处理完成: 成功 ${successCount}, 失败 ${failedCount}`);

        if (successCount === 0) {
            throw new Error('所有论文处理失败');
        }

        // 💾 保存播客脚本为JSON
        sendEvent('progress', {
            status: 'saving_scripts',
            message: '正在保存播客脚本...',
            progress: 55
        });

        const formattedResults = podcastResults
            .filter(r => r.success)
            .map(r => ({
                title: r.podcast_title,
                script: r.podcast_script,
                arxiv_id: r.arxiv_id
            }));

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const resultFilename = `论文播客稿-${timestamp}.json`;
        const resultPath = path.join(config.getOutputDir(), resultFilename);

        fs.writeFileSync(resultPath, JSON.stringify(formattedResults, null, 2), 'utf8');
        logger.info(`播客脚本已保存: ${resultPath}`);

        // 保存映射文件
        const arxivMapping = {};
        const titleMapping = {};

        podcastResults.forEach((result, idx) => {
            if (result.success) {
                arxivMapping[`paper_${idx}`] = result.arxiv_id;
                titleMapping[result.arxiv_id] = result.podcast_title;
            }
        });

        const mappingPath = path.join(config.getOutputDir(), 'arxiv_mapping.json');
        fs.writeFileSync(mappingPath, JSON.stringify(arxivMapping, null, 2), 'utf8');

        const titleMappingPath = path.join(config.getOutputDir(), 'podcast_titles.json');
        fs.writeFileSync(titleMappingPath, JSON.stringify(titleMapping, null, 2), 'utf8');

        // 🎙️ 生成音频（调用现有TTS模块）
        sendEvent('progress', {
            status: 'tts_start',
            message: '开始生成音频...',
            progress: 60
        });

        let audioFiles = [];
        let uploadResults = null;

        try {
            const ttsResult = await runPodcastTTS(resultPath, channelId, logger, sendEvent);
            audioFiles = Array.isArray(ttsResult?.audioFiles) ? ttsResult.audioFiles : [];
            uploadResults = ttsResult?.uploadResults || null;
        } catch (ttsError) {
            logger.error(`音频生成失败: ${ttsError.message}`);
            sendEvent('error', {
                status: 'tts_failed',
                message: `音频生成失败: ${ttsError.message}`
            });
            res.end();
            return;
        }

        // 🗄️ 【最后一步】上传完整数据到Supabase
        sendEvent('progress', {
            status: 'uploading_to_supabase',
            message: '正在上传完整数据到数据库...',
            progress: 95
        });

        // 构造音频URL映射
        const audioUrlMap = {};
        if (uploadResults && uploadResults.urls) {
            uploadResults.urls.forEach(item => {
                audioUrlMap[item.arxiv_id] = item.url;
            });
        }

        // 上传到Supabase（包含audio_url）
        supabaseResults = await supabaseClient.processExcelData(
            validationResults.valid,
            fileName,
            channelId,
            logger,
            audioUrlMap,  // 音频URL映射
            titleMapping  // 播客标题映射
        );

        sendEvent('progress', {
            status: 'supabase_uploaded',
            message: `数据库上传完成: 成功 ${supabaseResults.success} 条`,
            progress: 98,
            supabase_results: supabaseResults
        });

        // ✅ 返回成功结果
        sendEvent('success', {
            status: 'succeeded',
            message: '执行成功!',
            progress: 100,
            result_file: resultFilename,
            processing_stats: {
                total: arxivLinks.length,
                success: successCount,
                failed: failedCount
            },
            supabase_results: supabaseResults,
            audio_files: audioFiles,
            upload_results: uploadResults
        });

        res.end();

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


