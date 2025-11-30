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

                            // 🔍 增强日志：记录所有事件类型
                            logger.info(`[Single] 收到事件: ${data.event}, arxiv_id: ${arxivId}`);

                            if (data.event === 'workflow_finished') {
                                logger.info(`[Single] Workflow完成状态: ${data.data?.status}`);
                                logger.info(`[Single] 完整输出: ${JSON.stringify(data.data?.outputs || {}, null, 2)}`);

                                if (data.data?.status === 'succeeded') {
                                    const outputs = data.data.outputs || {};

                                    // 🔍 记录输出字段
                                    logger.info(`[Single] 检测到的输出字段: ${Object.keys(outputs).join(', ')}`);

                                    finalResult = {
                                        podcast_title: outputs.podcast_title || '',
                                        podcast_script: outputs.podcast_script || ''
                                    };

                                    logger.info(`[Single] 解析结果 - title: ${finalResult.podcast_title ? '有' : '无'}, script: ${finalResult.podcast_script ? '有' : '无'}`);
                                } else if (data.data?.status === 'failed') {
                                    logger.error(`[Single] Workflow失败: ${JSON.stringify(data.data.error || {})}`);
                                }
                            }
                        }
                    } catch (e) {
                        logger.error(`[Single] 解析响应失败: ${e.message}`);
                        logger.error(`[Single] 问题数据: ${eventStr.substring(0, 200)}`);
                    }
                }
            });

            response.data.on('end', () => {
                if (finalResult && (finalResult.podcast_title || finalResult.podcast_script)) {
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
                    const errorMsg = finalResult
                        ? `Dify返回结果为空 (title: ${!!finalResult.podcast_title}, script: ${!!finalResult.podcast_script})`
                        : `Dify未返回workflow_finished事件或状态非succeeded`;

                    logger.error(`[Single] ✗ 无效结果: ${arxivId} - ${errorMsg}`);
                    reject(new Error(`未获取到有效结果: ${arxivId} - ${errorMsg}`));
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
 * 🆕 生成单个音频文件
 */
async function generateSingleAudio(script, title, arxivId, logger) {
    try {
        if (config.SKIP_TTS) {
            logger.info('跳过音频生成（SKIP_TTS=true）');
            return null;
        }

        const outputDir = config.getOutputDir();
        const tempScriptFile = path.join(outputDir, `temp_${arxivId}.json`);

        // 写入临时脚本文件
        fs.writeFileSync(tempScriptFile, JSON.stringify([{
            title: title,
            script: script,
            arxiv_id: arxivId
        }], null, 2), 'utf8');

        const pythonExecutable = config.PODCAST_PYTHON;
        const ttsScriptPath = path.join(projectRoot, 'podcast_generator', 'produce_podcast.py');

        const args = [
            ttsScriptPath,
            '--script', tempScriptFile,
            '--output-dir', outputDir,
            '--single-mode'
        ];

        logger.info(`启动TTS: ${pythonExecutable} ${args.join(' ')}`);

        return new Promise((resolve, reject) => {
            const child = spawn(pythonExecutable, args, {
                cwd: projectRoot,
                env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
            });

            let audioFilePath = null;

            child.stdout.on('data', (chunk) => {
                const output = chunk.toString();
                logger.info(`[TTS] ${output}`);

                // 修复：兼容Python输出格式（包含前导空格）
                // 原输出: "     输出文件: 2511.10222v1.mp3"
                const match = output.match(/输出文件[:：]\s*(.+\.mp3)\s*$/m);
                if (match) {
                    audioFilePath = match[1].trim();
                    logger.info(`[TTS] ✓ 解析到音频文件路径: ${audioFilePath}`);
                }
            });

            child.stderr.on('data', (chunk) => {
                logger.error(`[TTS][stderr] ${chunk.toString()}`);
            });

            child.on('close', (code) => {
                // 清理临时文件
                try {
                    if (fs.existsSync(tempScriptFile)) {
                        fs.unlinkSync(tempScriptFile);
                        logger.info(`[TTS] 临时脚本文件已删除: ${tempScriptFile}`);
                    }
                } catch (e) {
                    logger.warning(`清理临时文件失败: ${e.message}`);
                }

                logger.info(`[TTS] Python进程结束，退出码: ${code}`);
                logger.info(`[TTS] 解析到的音频文件路径: ${audioFilePath || '未解析到路径'}`);

                if (code === 0 && audioFilePath) {
                    // 验证文件是否真的存在
                    if (fs.existsSync(audioFilePath)) {
                        logger.info(`[TTS] ✓ 音频文件验证成功: ${audioFilePath}`);
                        resolve(audioFilePath);
                    } else {
                        logger.error(`[TTS] ✗ 音频文件不存在: ${audioFilePath}`);
                        // 尝试备用方案：直接构造路径
                        const fallbackPath = path.join(outputDir, `${arxivId}.mp3`);
                        logger.info(`[TTS] 尝试备用路径: ${fallbackPath}`);
                        if (fs.existsSync(fallbackPath)) {
                            logger.info(`[TTS] ✓ 备用路径验证成功: ${fallbackPath}`);
                            resolve(fallbackPath);
                        } else {
                            reject(new Error(`音频文件未找到: ${audioFilePath}`));
                        }
                    }
                } else if (code === 0 && !audioFilePath) {
                    // 退出码正常但未解析到路径，尝试直接构造
                    const fallbackPath = path.join(outputDir, `${arxivId}.mp3`);
                    logger.warning(`[TTS] 未从输出解析到路径，尝试直接构造: ${fallbackPath}`);
                    if (fs.existsSync(fallbackPath)) {
                        logger.info(`[TTS] ✓ 备用路径验证成功: ${fallbackPath}`);
                        resolve(fallbackPath);
                    } else {
                        reject(new Error(`音频生成成功但未找到文件: ${fallbackPath}`));
                    }
                } else {
                    reject(new Error(`音频生成失败，退出码: ${code}`));
                }
            });

            child.on('error', (err) => {
                logger.error(`TTS进程启动失败: ${err.message}`);
                reject(err);
            });
        });

    } catch (error) {
        logger.error(`生成单个音频失败: ${error.message}`);
        return null;
    }
}

/**
 * 🆕 单条模式：逐条处理并即时上传到Supabase
 */
async function processSequentialWithUpload(
    arxivLinks,
    excelData,
    channelId,
    difyClient,
    supabaseClient,
    logger,
    sendEvent
) {
    const results = {
        success: 0,
        failed: 0,
        totalItems: arxivLinks.length,
        details: []
    };

    const maxRetries = config.SEQUENTIAL_MODE_RETRY_ATTEMPTS;
    const retryDelay = config.SEQUENTIAL_MODE_RETRY_DELAY_MS;

    // 获取频道信息（一次性查询）
    const { data: channelData, error: channelError } = await supabaseClient.supabase
        .from('channels')
        .select('id, name, cover_url')
        .eq('id', channelId)
        .single();

    if (channelError || !channelData) {
        throw new Error(`获取频道信息失败: ${channelError?.message || '频道不存在'}`);
    }

    // 获取频道存储配置（用于音频上传）
    const channelConfig = await supabaseClient.getChannelStorageConfig(channelId, logger);

    for (let i = 0; i < arxivLinks.length; i++) {
        const link = arxivLinks[i];
        const itemNum = i + 1;
        const progressBase = 30 + Math.floor((i / arxivLinks.length) * 60); // 30-90%

        logger.info(`\n========== 处理第 ${itemNum}/${arxivLinks.length} 条: ${link.arxiv_id} ==========`);

        let retryCount = 0;
        let success = false;
        let itemResult = null;

        // 🔁 重试循环
        while (retryCount <= maxRetries && !success) {
            try {
                // Step 1: 调用Dify生成播客脚本
                sendEvent('progress', {
                    status: 'processing_single_item',
                    message: `调用Dify生成脚本: ${link.arxiv_id}`,
                    progress: progressBase,
                    current: itemNum,
                    total: arxivLinks.length,
                    retry_count: retryCount
                });

                const difyResult = await processSingleArxiv(
                    link.arxiv_url,
                    link.arxiv_id,
                    link.metadata,
                    difyClient,
                    logger
                );

                if (!difyResult.success) {
                    throw new Error(`Dify处理失败: ${difyResult.error}`);
                }

                // Step 2: 生成单个音频
                let audioUrl = '';
                if (!config.SKIP_TTS) {
                    sendEvent('progress', {
                        status: 'processing_single_item',
                        message: `生成音频: ${link.arxiv_id}`,
                        progress: progressBase + 1,
                        current: itemNum,
                        total: arxivLinks.length
                    });

                    const audioPath = await generateSingleAudio(
                        difyResult.podcast_script,
                        difyResult.podcast_title,
                        link.arxiv_id,
                        logger
                    );

                    if (audioPath && fs.existsSync(audioPath)) {
                        // Step 3: 上传音频到Supabase Storage
                        const uploadResult = await uploadAudioFiles(
                            [{ local_path: audioPath, arxiv_id: link.arxiv_id }],
                            channelConfig,
                            supabaseClient,
                            logger,
                            sendEvent,
                            true  // skipDatabaseCheck = true (sequential模式)
                        );

                        if (uploadResult.urls && uploadResult.urls.length > 0) {
                            audioUrl = uploadResult.urls[0].url;
                            logger.info(`[Sequential] 音频上传并验证成功: ${audioUrl}`);
                        } else {
                            throw new Error(`音频上传失败：未获得有效的URL`);
                        }
                    }
                }

                // Step 4: 立即上传到Supabase数据库
                const rowData = excelData.find(row => row.ID === link.arxiv_id);
                if (rowData) {
                    const podcastData = supabaseClient.preparePodcastData(
                        rowData,
                        channelData,
                        { [link.arxiv_id]: audioUrl },
                        { [link.arxiv_id]: difyResult.podcast_title }
                    );

                    const { data: podcast, error } = await supabaseClient.supabase
                        .from('podcasts')
                        .insert(podcastData)
                        .select()
                        .single();

                    if (error) {
                        throw new Error(`数据库插入失败: ${error.message}`);
                    }

                    logger.info(`✅ [${itemNum}/${arxivLinks.length}] 成功上传到数据库: ${link.arxiv_id}`);
                }

                // 成功标记
                success = true;
                results.success++;
                itemResult = { success: true, arxiv_id: link.arxiv_id };

                sendEvent('progress', {
                    status: 'single_item_success',
                    message: `完成: ${link.arxiv_id}`,
                    progress: progressBase + 2,
                    current: itemNum,
                    total: arxivLinks.length
                });

            } catch (error) {
                retryCount++;
                logger.error(`❌ [${itemNum}/${arxivLinks.length}] 处理失败 (第${retryCount}次): ${error.message}`);

                if (retryCount <= maxRetries) {
                    sendEvent('progress', {
                        status: 'single_item_retrying',
                        message: `第${retryCount}次重试: ${link.arxiv_id}`,
                        progress: progressBase,
                        current: itemNum,
                        total: arxivLinks.length,
                        retry_count: retryCount,
                        max_retries: maxRetries
                    });

                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    // 最终失败
                    results.failed++;
                    itemResult = { success: false, arxiv_id: link.arxiv_id, error: error.message };

                    sendEvent('progress', {
                        status: 'single_item_failed',
                        message: `最终失败: ${link.arxiv_id}`,
                        progress: progressBase + 2,
                        current: itemNum,
                        total: arxivLinks.length,
                        retry_count: retryCount,
                        max_retries: maxRetries
                    });
                }
            }
        }

        results.details.push(itemResult);
    }

    logger.info(`\n========== 单条模式处理完成 ==========`);
    logger.info(`总计: ${results.totalItems}, 成功: ${results.success}, 失败: ${results.failed}`);

    return results;
}

// ==================== 音频上传验证函数 ====================

/**
 * 验证Storage中的文件是否存在
 */
async function verifyStorageFile(storagePath, supabaseClient, logger) {
    try {
        const pathParts = storagePath.split('/');
        const fileName = pathParts.pop();
        const dirPath = pathParts.join('/');

        logger.info(`[Verify] 检查Storage文件: ${storagePath}`);

        const { data: files, error } = await supabaseClient.supabase.storage
            .from('podcast-audios')
            .list(dirPath, {
                search: fileName
            });

        if (error) {
            logger.error(`[Verify] Storage列表查询失败: ${error.message}`);
            return { success: false, reason: `Storage query error: ${error.message}` };
        }

        if (!files || files.length === 0) {
            logger.error(`[Verify] 文件不存在: ${storagePath}`);
            return { success: false, reason: 'File not found in storage' };
        }

        const file = files.find(f => f.name === fileName);
        if (!file) {
            logger.error(`[Verify] 文件名不匹配: ${fileName}`);
            return { success: false, reason: 'File name mismatch' };
        }

        if (!file.metadata || file.metadata.size === 0) {
            logger.error(`[Verify] 文件大小为0`);
            return { success: false, reason: 'File size is zero' };
        }

        logger.info(`[Verify] ✓ Storage文件验证通过 (大小: ${file.metadata.size} bytes)`);
        return { success: true, fileSize: file.metadata.size };
    } catch (error) {
        logger.error(`[Verify] Storage验证异常: ${error.message}`);
        return { success: false, reason: error.message };
    }
}

/**
 * 验证数据库中的记录是否正确
 */
async function verifyDatabaseRecord(arxivId, expectedAudioUrl, supabaseClient, logger, skipIfNotFound = false) {
    try {
        logger.info(`[Verify] 检查数据库记录: ${arxivId}`);

        const { data, error } = await supabaseClient.supabase
            .from('podcasts')
            .select('arxiv_id, audio_url, status')
            .eq('arxiv_id', arxivId);

        if (error) {
            logger.error(`[Verify] 数据库查询失败: ${error.message}`);
            return { success: false, reason: `Database query error: ${error.message}` };
        }

        // 如果没有记录
        if (!data || data.length === 0) {
            if (skipIfNotFound) {
                logger.info(`[Verify] 数据库记录不存在（跳过验证，sequential模式）`);
                return { success: true, skipped: true, reason: 'Record not found but skipped in sequential mode' };
            } else {
                logger.error(`[Verify] 记录不存在: ${arxivId}`);
                return { success: false, reason: 'Record not found in database' };
            }
        }

        // 如果有多条记录，使用最新的一条
        const record = data.length === 1 ? data[0] : data.sort((a, b) =>
            new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)
        )[0];

        if (data.length > 1) {
            logger.warning(`[Verify] 发现 ${data.length} 条重复记录，使用最新的一条: ${record.id}`);
        }

        if (!record.audio_url || record.audio_url === '') {
            if (skipIfNotFound) {
                logger.info(`[Verify] audio_url为空（跳过验证，sequential模式）`);
                return { success: true, skipped: true, reason: 'audio_url empty but skipped in sequential mode' };
            } else {
                logger.error(`[Verify] audio_url为空: ${arxivId}`);
                return { success: false, reason: 'audio_url is empty' };
            }
        }

        if (expectedAudioUrl && record.audio_url !== expectedAudioUrl) {
            logger.error(`[Verify] audio_url不匹配: 期望=${expectedAudioUrl}, 实际=${record.audio_url}`);
            return {
                success: false,
                reason: 'audio_url mismatch',
                expected: expectedAudioUrl,
                actual: record.audio_url
            };
        }

        logger.info(`[Verify] ✓ 数据库记录验证通过`);
        return { success: true, record: record };
    } catch (error) {
        logger.error(`[Verify] 数据库验证异常: ${error.message}`);
        return { success: false, reason: error.message };
    }
}

/**
 * 验证音频文件是否可访问
 */
async function verifyAudioAccessibility(audioUrl, logger) {
    try {
        logger.info(`[Verify] 检查文件可访问性: ${audioUrl}`);

        const axios = require('axios');
        const response = await axios.head(audioUrl, {
            timeout: 10000,
            validateStatus: function (status) {
                return status === 200;
            }
        });

        if (response.status !== 200) {
            logger.error(`[Verify] HTTP状态码异常: ${response.status}`);
            return { success: false, reason: `HTTP status ${response.status}` };
        }

        const contentType = response.headers['content-type'];
        if (!contentType || !contentType.includes('audio')) {
            logger.error(`[Verify] Content-Type异常: ${contentType}`);
            return { success: false, reason: `Invalid content-type: ${contentType}` };
        }

        const contentLength = parseInt(response.headers['content-length'] || '0');
        if (contentLength === 0) {
            logger.error(`[Verify] Content-Length为0`);
            return { success: false, reason: 'Content-Length is zero' };
        }

        logger.info(`[Verify] ✓ 文件可访问性验证通过 (大小: ${contentLength} bytes)`);
        return { success: true, size: contentLength };
    } catch (error) {
        logger.error(`[Verify] 可访问性验证异常: ${error.message}`);
        return { success: false, reason: error.message };
    }
}

/**
 * 完整的音频上传验证流程
 * @param {boolean} skipDatabaseCheck - 是否跳过数据库检查（sequential模式下为true）
 */
async function verifyAudioUpload(arxivId, audioUrl, storagePath, supabaseClient, logger, skipDatabaseCheck = false) {
    logger.info(`[Verify] ========== 开始验证: ${arxivId} ==========`);

    const results = {
        success: true,
        checks: {},
        arxivId: arxivId
    };

    // Check 1: Storage文件存在性
    logger.info(`[Verify] [1/4] Storage文件存在性验证`);
    const storageCheck = await verifyStorageFile(storagePath, supabaseClient, logger);
    results.checks.storage = storageCheck;
    if (!storageCheck.success) {
        results.success = false;
        logger.error(`[Verify] ✗ 验证失败: Storage检查未通过`);
        return results;
    }

    // Check 2: 数据库记录完整性（sequential模式下跳过）
    if (skipDatabaseCheck) {
        logger.info(`[Verify] [2/4] 数据库记录完整性验证（跳过，sequential模式）`);
        results.checks.database = { success: true, skipped: true };
    } else {
        logger.info(`[Verify] [2/4] 数据库记录完整性验证`);
        const dbCheck = await verifyDatabaseRecord(arxivId, audioUrl, supabaseClient, logger, false);
        results.checks.database = dbCheck;
        if (!dbCheck.success) {
            results.success = false;
            logger.error(`[Verify] ✗ 验证失败: 数据库检查未通过`);
            return results;
        }
    }

    // Check 3: 音频文件可访问性（sequential模式下跳过，因为URL可能还没更新到数据库）
    if (skipDatabaseCheck) {
        logger.info(`[Verify] [3/4] 音频文件可访问性验证（跳过，sequential模式）`);
        results.checks.accessibility = { success: true, skipped: true };
    } else {
        logger.info(`[Verify] [3/4] 音频文件可访问性验证`);
        const accessCheck = await verifyAudioAccessibility(audioUrl, logger);
        results.checks.accessibility = accessCheck;
        if (!accessCheck.success) {
            results.success = false;
            logger.error(`[Verify] ✗ 验证失败: 可访问性检查未通过`);
            return results;
        }
    }

    // Check 4: 数据一致性
    logger.info(`[Verify] [4/4] 数据一致性验证`);
    const urlArxivId = audioUrl.match(/([^\/]+)\.mp3$/)?.[1];
    if (urlArxivId !== arxivId) {
        results.success = false;
        results.checks.consistency = {
            success: false,
            reason: 'arxiv_id mismatch in URL',
            expected: arxivId,
            actual: urlArxivId
        };
        logger.error(`[Verify] ✗ 验证失败: arxiv_id不一致 (期望=${arxivId}, URL中=${urlArxivId})`);
        return results;
    }
    results.checks.consistency = { success: true };
    logger.info(`[Verify] ✓ 数据一致性验证通过`);

    logger.info(`[Verify] ✅ 所有验证通过: ${arxivId}`);
    return results;
}

/**
 * 回滚音频上传（删除Storage文件，清空数据库audio_url）
 */
async function rollbackAudioUpload(storagePath, arxivId, supabaseClient, logger) {
    logger.warning(`[Rollback] ========== 开始回滚: ${arxivId} ==========`);

    const rollbackResults = {
        storageDeleted: false,
        databaseUpdated: false,
        errors: []
    };

    try {
        // 1. 删除Storage文件
        logger.info(`[Rollback] 删除Storage文件: ${storagePath}`);
        const { error: storageError } = await supabaseClient.supabase.storage
            .from('podcast-audios')
            .remove([storagePath]);

        if (storageError) {
            logger.error(`[Rollback] Storage删除失败: ${storageError.message}`);
            rollbackResults.errors.push(`Storage deletion failed: ${storageError.message}`);
        } else {
            rollbackResults.storageDeleted = true;
            logger.info(`[Rollback] ✓ Storage文件已删除`);
        }

        // 2. 清空数据库audio_url字段（标记为draft状态）
        logger.info(`[Rollback] 更新数据库记录: ${arxivId}`);

        // 先检查记录是否存在
        const { data: existingRecords } = await supabaseClient.supabase
            .from('podcasts')
            .select('id')
            .eq('arxiv_id', arxivId);

        if (existingRecords && existingRecords.length > 0) {
            const { error: dbError } = await supabaseClient.supabase
                .from('podcasts')
                .update({
                    audio_url: '',
                    status: 'draft',
                    updated_at: new Date().toISOString()
                })
                .eq('arxiv_id', arxivId);

            if (dbError) {
                logger.error(`[Rollback] 数据库更新失败: ${dbError.message}`);
                rollbackResults.errors.push(`Database update failed: ${dbError.message}`);
            } else {
                rollbackResults.databaseUpdated = true;
                logger.info(`[Rollback] ✓ 数据库记录已标记为draft`);
            }
        } else {
            logger.info(`[Rollback] 数据库记录不存在，跳过更新（sequential模式正常情况）`);
            rollbackResults.databaseUpdated = true; // 标记为成功，因为这在sequential模式下是正常的
        }

        const success = rollbackResults.storageDeleted || rollbackResults.databaseUpdated;
        if (success) {
            logger.info(`[Rollback] ✅ 回滚完成: ${arxivId}`);
        } else {
            logger.error(`[Rollback] ❌ 回滚失败: ${arxivId}`);
        }

        return { success, ...rollbackResults };
    } catch (error) {
        logger.error(`[Rollback] 回滚异常: ${error.message}`);
        rollbackResults.errors.push(`Exception: ${error.message}`);
        return { success: false, ...rollbackResults };
    }
}

// ==================== 音频上传函数 ====================

/**
 * 上传音频文件到Supabase Storage并更新数据库
 * @param {Array} files - 文件列表 [{local_path, arxiv_id, channel_id}]
 * @param {Object} channelConfig - 频道配置 {storagePath, namingPrefix}
 * @param {Object} supabaseClient - Supabase客户端
 * @param {Object} logger - 日志记录器
 * @param {Function} sendEvent - SSE事件发送函数
 * @param {boolean} skipDatabaseCheck - 是否跳过数据库验证（sequential模式下为true）
 * @returns {Promise<Object>} 上传结果
 */
async function uploadAudioFiles(files, channelConfig, supabaseClient, logger, sendEvent, skipDatabaseCheck = false) {
    logger.info('========== uploadAudioFiles 开始 ==========');
    logger.info(`[Config] channelId: ${channelConfig.channelId}`);
    logger.info(`[Config] storagePath: ${channelConfig.storagePath}`);
    logger.info(`[Config] namingPrefix: ${channelConfig.namingPrefix}`);
    logger.info(`[Config] fileFormat: ${channelConfig.fileFormat}`);
    logger.info(`[Config] skipDatabaseCheck: ${skipDatabaseCheck}`);
    logger.info(`[Files] 准备上传 ${files.length} 个文件`);

    // 记录每个文件的详细信息
    files.forEach((file, idx) => {
        logger.info(`[File ${idx + 1}/${files.length}] arxiv_id: ${file.arxiv_id}`);
        logger.info(`[File ${idx + 1}/${files.length}] local_path: ${file.local_path}`);
        const fileExists = fs.existsSync(file.local_path);
        logger.info(`[File ${idx + 1}/${files.length}] exists: ${fileExists}`);
        if (fileExists) {
            const stats = fs.statSync(file.local_path);
            logger.info(`[File ${idx + 1}/${files.length}] size: ${stats.size} bytes (${(stats.size / 1024).toFixed(2)} KB)`);
        } else {
            logger.error(`[File ${idx + 1}/${files.length}] ✗ 文件不存在！`);
        }
    });

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
            logger.info(`[Upload] Bucket: podcast-audios`);
            logger.info(`[Upload] ContentType: audio/mpeg`);
            logger.info(`[Upload] File size: ${fileData.length} bytes`);

            sendEvent('progress', {
                status: 'audio_uploading',
                message: `正在上传音频 (${i + 1}/${files.length}): ${arxiv_id}.mp3`,
                progress: 85 + Math.floor((i / files.length) * 10)
            });

            // 上传到Supabase Storage
            logger.info(`[Upload] 开始上传到Storage...`);
            const { data, error } = await supabaseClient.supabase.storage
                .from('podcast-audios')
                .upload(storagePath, fileData, {
                    contentType: 'audio/mpeg',
                    upsert: true
                });

            if (error) {
                logger.error(`[Upload] ✗ Storage上传失败: ${error.message}`);
                logger.error(`[Upload] Error code: ${error.statusCode || 'N/A'}`);
                logger.error(`[Upload] Error详情: ${JSON.stringify(error, null, 2)}`);
                throw new Error(`Storage上传失败: ${error.message}`);
            }

            logger.info(`[Upload] ✓ Storage上传成功: ${data.path}`);

            // 获取public URL
            const { data: urlData } = supabaseClient.supabase.storage
                .from('podcast-audios')
                .getPublicUrl(storagePath);

            const publicUrl = urlData.publicUrl;
            logger.info(`✓ 上传成功: ${storagePath} -> ${publicUrl}`);

            // 🔍 验证上传结果
            logger.info(`[Verify] 开始验证上传结果: ${arxiv_id}`);
            sendEvent('progress', {
                status: 'verifying_upload',
                message: `正在验证上传 (${i + 1}/${files.length}): ${arxiv_id}`,
                progress: 85 + Math.floor((i / files.length) * 10)
            });

            const verification = await verifyAudioUpload(arxiv_id, publicUrl, storagePath, supabaseClient, logger, skipDatabaseCheck);

            if (!verification.success) {
                // 验证失败 - 执行回滚
                logger.error(`[Verify] ✗ 验证失败，执行回滚: ${arxiv_id}`);
                logger.error(`[Verify] 失败原因: ${JSON.stringify(verification.checks, null, 2)}`);

                sendEvent('progress', {
                    status: 'upload_verification_failed',
                    message: `验证失败，正在回滚: ${arxiv_id}`,
                    progress: 85 + Math.floor((i / files.length) * 10)
                });

                const rollbackResult = await rollbackAudioUpload(storagePath, arxiv_id, supabaseClient, logger);

                throw new Error(`Upload verification failed for ${arxiv_id}: ${JSON.stringify(verification.checks)}`);
            }

            logger.info(`[Verify] ✅ 验证通过，上传确认成功: ${arxiv_id}`);
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
    logger.info('========== uploadAudioFiles 完成 ==========');
    if (results.errors.length > 0) {
        logger.error(`[Errors] 上传失败的文件: ${JSON.stringify(results.errors, null, 2)}`);
    }
    if (results.urls.length > 0) {
        logger.info(`[URLs] 成功上传的URL数量: ${results.urls.length}`);
    }

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
    logger.info('========== runPodcastTTS 开始 ==========');
    logger.info(`[TTS] scriptPath: ${scriptPath}`);
    logger.info(`[TTS] channelId: ${channelId}`);
    logger.info(`[TTS] SKIP_TTS: ${process.env.SKIP_TTS}`);
    logger.info(`[TTS] Script file exists: ${fs.existsSync(scriptPath)}`);

    if (process.env.SKIP_TTS === '1') {
        logger.info('[TTS] 跳过音频生成（SKIP_TTS=1）');
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
        logger.info('[TTS] 正在获取频道配置...');
        sendEvent('progress', {
            status: 'getting_channel_config',
            message: '正在获取频道配置...',
            progress: 70
        });

        const channelConfig = await supabaseClient.getChannelStorageConfig(channelId, logger);
        logger.info(`[TTS] 频道配置获取成功: ${JSON.stringify(channelConfig, null, 2)}`);

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

        logger.info('[TTS] ========== Python进程启动 ==========');
        logger.info(`[TTS] Python: ${pythonExecutable}`);
        logger.info(`[TTS] Script: ${ttsScriptPath}`);
        logger.info(`[TTS] 完整命令: ${pythonExecutable} ${args.join(' ')}`);
        logger.info(`[TTS] 工作目录: ${projectRoot}`);

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

                    logger.info('[TTS] ========== Python进程正常结束 ==========');
                    resolve({
                        audioFiles,
                        uploadResults,
                        skipped: false
                    });
                } else {
                    const error = new Error(`音频生成进程退出码 ${code}`);
                    logger.error('[TTS] ========== Python进程异常退出 ==========');
                    logger.error(`[TTS] 退出码: ${code}`);
                    reject(error);
                }
            });
        });

    } catch (error) {
        logger.error('[TTS] ========== TTS执行失败 ==========');
        logger.error(`[TTS] 错误类型: ${error.constructor.name}`);
        logger.error(`[TTS] 错误消息: ${error.message}`);
        logger.error(`[TTS] 错误堆栈:\n${error.stack}`);
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
    // 创建带有workflowRunId的Logger，确保日志被保存到文件
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const workflowRunId = `exec_${timestamp}`;
    const logger = new Logger(workflowRunId);

    const supabaseClient = new SupabaseClient();
    const excelParser = new ExcelParser();
    let tempFilePath = null;
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
        const processingMode = req.body.processingMode || 'batch'; // 🆕 接收处理模式
        const workflowConfig = config.getWorkflowConfig(workflowType);

        if (!workflowConfig) {
            sendEvent('error', { message: `无效的 workflow 类型: ${workflowType}` });
            res.end();
            return;
        }

        logger.info(`使用处理模式: ${processingMode}`);

        tempFilePath = req.file.path;
        const fileName = req.file.originalname;
        const fileSize = (req.file.size / 1024).toFixed(2);

        logger.info(`========== 开始执行 (Run ID: ${workflowRunId}) ==========`);
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

        // 🚀 调用Dify处理arXiv链接（根据模式选择处理方式）
        const difyClient = new DifyClient(logger, workflowType);
        let podcastResults = [];
        let audioUploadResults = null;

        if (processingMode === 'sequential') {
            // ========== 🆕 单条模式：逐条处理+即时上传 ==========
            sendEvent('progress', {
                status: 'sequential_mode_start',
                message: `启用单条模式，将逐个处理 ${arxivLinks.length} 个论文...`,
                progress: 30
            });

            const sequentialResults = await processSequentialWithUpload(
                arxivLinks,
                enrichedData,
                channelId,
                difyClient,
                supabaseClient,
                logger,
                sendEvent
            );

            // 单条模式已完成所有上传，直接返回结果
            sendEvent('success', {
                status: 'succeeded',
                message: '执行成功！',
                progress: 100,
                processing_stats: {
                    total: sequentialResults.totalItems,
                    success: sequentialResults.success,
                    failed: sequentialResults.failed
                },
                supabase_results: {
                    success: sequentialResults.success,
                    failed: sequentialResults.failed,
                    errors: sequentialResults.details.filter(d => !d.success)
                }
            });

            res.end();
            return; // 🚨 单条模式提前结束，不执行后续批量逻辑

        } else {
            // ========== 批量模式（保持原有逻辑） ==========
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

// 🆕 查询最近的Dify workflow执行日志
app.get('/api/dify/logs/recent', async (req, res) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const logger = new Logger(`dify_logs_${timestamp}`);
    const workflowType = req.query.workflow || 'PODCAST';
    const limit = parseInt(req.query.limit) || 5;

    try {
        logger.info(`查询最近的Dify执行日志: workflow=${workflowType}, limit=${limit}`);

        const difyClient = new DifyClient(logger, workflowType);
        const logs = await difyClient.getWorkflowLogs(1, limit, null);

        if (logs) {
            logger.info(`成功获取 ${logs.data?.length || 0} 条日志`);
            res.json({
                success: true,
                logs: logs.data || [],
                total: logs.total || 0,
                page: logs.page || 1,
                limit: logs.limit || limit
            });
        } else {
            logger.warning('Dify日志查询返回null');
            res.status(404).json({
                success: false,
                message: 'Dify日志查询失败'
            });
        }

    } catch (error) {
        logger.error(`Dify日志查询异常: ${error.message}`);
        logger.error(`错误堆栈: ${error.stack}`);
        res.status(500).json({
            success: false,
            message: error.message,
            error: error.stack
        });
    }
});

// 🆕 查询特定执行ID的Dify日志详情
app.get('/api/dify/logs/:workflow_run_id', async (req, res) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const logger = new Logger(`dify_log_detail_${timestamp}`);
    const workflowRunId = req.params.workflow_run_id;

    try {
        logger.info(`查询Dify执行日志详情: ${workflowRunId}`);

        // 注意: Dify API可能需要额外的端点来获取单个执行的详细日志
        // 这里使用logs API并过滤结果
        const difyClient = new DifyClient(logger, 'PODCAST');
        const logs = await difyClient.getWorkflowLogs(1, 50, null);

        if (logs && logs.data) {
            const targetLog = logs.data.find(log => log.workflow_run_id === workflowRunId);
            if (targetLog) {
                logger.info(`找到目标日志: ${workflowRunId}`);
                res.json({
                    success: true,
                    log: targetLog
                });
            } else {
                logger.warning(`未找到日志: ${workflowRunId}`);
                res.status(404).json({
                    success: false,
                    message: '未找到指定的执行日志'
                });
            }
        } else {
            res.status(404).json({
                success: false,
                message: 'Dify日志查询失败'
            });
        }

    } catch (error) {
        logger.error(`Dify日志详情查询异常: ${error.message}`);
        logger.error(`错误堆栈: ${error.stack}`);
        res.status(500).json({
            success: false,
            message: error.message,
            error: error.stack
        });
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


