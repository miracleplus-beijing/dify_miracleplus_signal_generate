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

const app = express();
const projectRoot = path.join(__dirname, '..');

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
                    progress: 15
                });

                // 解析Excel文件
                excelData = await excelParser.parseExcelFile(tempFilePath, logger);

                if (excelData.length === 0) {
                    throw new Error('Excel文件中没有有效数据');
                }

                sendEvent('progress', {
                    status: 'validating_data',
                    message: `正在验证数据 (${excelData.length} 条记录)...`,
                    progress: 20
                });

                // 验证数据
                const validationResults = excelParser.validateData(excelData, logger);

                if (validationResults.valid.length === 0) {
                    throw new Error('Excel数据验证失败：没有有效的数据行');
                }

                sendEvent('progress', {
                    status: 'uploading_to_supabase',
                    message: '正在上传到Supabase数据库...',
                    progress: 25
                });

                // 上传到Supabase
                supabaseResults = await supabaseClient.processExcelData(validationResults.valid, fileName, channelId, logger);

                sendEvent('progress', {
                    status: 'supabase_uploaded',
                    message: `Supabase上传完成: 成功 ${supabaseResults.success} 条, 失败 ${supabaseResults.failed} 条`,
                    progress: 30,
                    supabase_results: supabaseResults
                });

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

        sendEvent('progress', {
            status: 'uploading',
            message: '正在上传文件到Dify...',
            progress: 35
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
            message: '文件上传到Dify成功，开始执行 workflow...',
            progress: 40,
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

                                    // 🔧 改进：保持JSON格式，只转换单引号为双引号
                                    let podcastTitles = {}; // 保存标题映射
                                    let finalFileName = fileName;

                                    try {
                                        // 将Python字典格式转为标准JSON（单引号→双引号）
                                        const jsonStr = fileContent.replace(/'/g, '"');
                                        const parsed = JSON.parse(jsonStr);

                                        if (Array.isArray(parsed)) {
                                            logger.info(`检测到JSON数组格式，包含 ${parsed.length} 个播客段落`);

                                            // 提取标题映射（用于后续更新数据库）
                                            parsed.forEach((item, index) => {
                                                if (typeof item === 'object' && item.title) {
                                                    if (excelData && excelData[index] && excelData[index].ID) {
                                                        podcastTitles[excelData[index].ID] = item.title;
                                                        logger.info(`映射标题: ${excelData[index].ID} -> ${item.title.substring(0, 50)}...`);
                                                    }
                                                }
                                            });

                                            // ✅ 保持JSON格式，转换为标准JSON字符串
                                            fileContent = JSON.stringify(parsed, null, 2);

                                            // 使用.json扩展名
                                            finalFileName = fileName.replace('.md', '.json');
                                            logger.info(`✓ 保持JSON数组格式（${parsed.length} 个播客段落），使用文件名: ${finalFileName}`);
                                        }
                                    } catch (e) {
                                        logger.info('使用原始文本格式（非JSON数组）');
                                    }

                                    // 保存文件
                                    const resultPath = path.join(config.getOutputDir(), finalFileName);
                                    fs.writeFileSync(resultPath, fileContent, 'utf8');
                                    logger.info(`结果保存至: ${resultPath}`);

                                    // 保存arXiv ID映射文件（如果有Excel数据）
                                    if (excelData && excelData.length > 0) {
                                        const arxivMappingPath = path.join(config.getOutputDir(), 'arxiv_mapping.json');
                                        const arxivMapping = {};

                                        excelData.forEach((row, index) => {
                                            if (row.ID) {
                                                // 使用索引作为key，因为我们不知道Dify如何组织输出
                                                arxivMapping[`paper_${index}`] = row.ID;
                                                // 也添加标题作为key（去除特殊字符）
                                                if (row.Title) {
                                                    const cleanTitle = row.Title.replace(/[^\w\s\u4e00-\u9fa5]/g, '_').substring(0, 50);
                                                    arxivMapping[cleanTitle] = row.ID;
                                                }
                                            }
                                        });

                                        fs.writeFileSync(arxivMappingPath, JSON.stringify(arxivMapping, null, 2), 'utf8');
                                        logger.info(`arXiv ID映射文件已保存: ${arxivMappingPath}`);

                                        // 🔧 新增：保存播客标题映射文件
                                        if (Object.keys(podcastTitles).length > 0) {
                                            const podcastTitleMappingPath = path.join(config.getOutputDir(), 'podcast_titles.json');
                                            fs.writeFileSync(podcastTitleMappingPath, JSON.stringify(podcastTitles, null, 2), 'utf8');
                                            logger.info(`播客标题映射已保存: ${podcastTitleMappingPath} (${Object.keys(podcastTitles).length} 条记录)`);
                                        }
                                    }

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
                                            message: `音频生成失败: ${ttsError.message}`,
                                            result_file: fileName
                                        });
                                        res.end();
                                        return;
                                    }
                                    sendEvent('success', {
                                        status: 'succeeded',
                                        message: '执行成功!',
                                        progress: 100,
                                        result_file: fileName,
                                        elapsed_time: elapsedTime,
                                        total_tokens: totalTokens,
                                        supabase_results: supabaseResults, // 添加Supabase结果
                                        audio_files: audioFiles,
                                        upload_results: uploadResults // 添加上传结果
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
                                    no_download: true,
                                    supabase_results: supabaseResults, // 添加Supabase结果
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


