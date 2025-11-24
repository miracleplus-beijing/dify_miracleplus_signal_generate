const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

class SupabaseClient {
    constructor() {
        // 使用MCP工具获取的Supabase配置
        this.supabaseUrl = "https://gxvfcafgnhzjiauukssj.supabase.co";

        // 使用Service Role Key来绕过RLS限制
        this.supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_API_KEY;

        if (!this.supabaseServiceKey) {
            throw new Error('SUPABASE_SERVICE_ROLE_API_KEY 未在环境变量中配置');
        }

        // 使用Service Role Key创建客户端，绕过RLS
        this.supabase = createClient(this.supabaseUrl, this.supabaseServiceKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        });

        // 默认配置 - 使用数据库中存在的第一个用户作为系统用户
        this.defaultUserId = '9f191bd5-4885-4c56-8fac-845514383d8c'; // 使用数据库中存在的用户
        this.defaultChannelId = null; // 将在运行时创建或获取
    }

    /**
     * 解析Excel数据并上传到Supabase
     * @param {Object} excelData - Excel数据对象
     * @param {string} fileName - 原始文件名
     * @param {string} channelId - 选择的频道ID
     * @param {Object} logger - 日志记录器
     * @param {Object} audioUrlMap - 音频URL映射 {arxiv_id: audio_url}（可选）
     * @param {Object} titleMap - 播客标题映射 {arxiv_id: podcast_title}（可选）
     * @returns {Promise<Object>} 上传结果
     */
    async processExcelData(excelData, fileName, channelId, logger, audioUrlMap = {}, titleMap = {}) {
        try {
            logger.info('开始处理Excel数据并上传到Supabase...');
            logger.info(`Excel数据包含 ${excelData.length} 条记录`);

            const results = {
                success: 0,
                failed: 0,
                errors: [],
                podcastIds: [],
                skipped: 0
            };

            // 获取频道信息
            logger.info('正在获取频道信息...');
            const { data: channelData, error: channelError } = await this.supabase
                .from('channels')
                .select('id, name, cover_url')
                .eq('id', channelId)
                .single();

            if (channelError || !channelData) {
                throw new Error(`获取频道信息失败: ${channelError?.message || '频道不存在'}`);
            }

            logger.info(`使用频道: ${channelData.name} (ID: ${channelData.id})`);

            // 逐行处理Excel数据
            for (let i = 0; i < excelData.length; i++) {
                const row = excelData[i];
                const rowNum = i + 1;

                try {
                    logger.info(`处理第 ${rowNum} 行数据: ${row.Title || '未知标题'}`);

                    // 验证必需字段
                    if (!row.ID) {
                        logger.warning(`第 ${rowNum} 行缺少ID，跳过`);
                        results.skipped++;
                        continue;
                    }

                    if (!row.Title) {
                        logger.warning(`第 ${rowNum} 行缺少标题，跳过`);
                        results.skipped++;
                        continue;
                    }

                    // 检查是否已存在相同的arXiv ID
                    logger.info(`检查arXiv ID: ${row.ID}`);
                    const existingPodcast = await this.checkExistingPodcast(row.ID);
                    if (existingPodcast) {
                        logger.info(`发现已存在的播客: ${row.ID} - ${existingPodcast.title}，将更新数据`);
                        // 可以选择更新现有记录或跳过，这里选择更新
                        // TODO: 实现更新逻辑
                        // 暂时继续处理，会在插入时因唯一约束而失败
                    }

                    // 准备播客数据
                    logger.info(`准备播客数据: ${row.Title}`);
                    const podcastData = this.preparePodcastData(row, channelData, audioUrlMap, titleMap);
                    logger.info(`播客数据准备完成: ${JSON.stringify({
                        title: podcastData.title,
                        arxiv_id: podcastData.arxiv_id,
                        authors_count: podcastData.authors?.length || 0,
                        has_audio: !!podcastData.audio_url
                    }, null, 2)}`);

                    // 插入播客数据
                    logger.info(`正在插入播客数据...`);
                    const { data: podcast, error } = await this.supabase
                        .from('podcasts')
                        .insert(podcastData)
                        .select()
                        .single();

                    if (error) {
                        logger.error(`数据库插入错误详情: ${JSON.stringify(error, null, 2)}`);
                        throw new Error(`插入播客失败: ${error.message} (代码: ${error.code})`);
                    }

                    if (!podcast) {
                        throw new Error('插入成功但没有返回数据');
                    }

                    results.success++;
                    results.podcastIds.push(podcast.id);
                    logger.info(`✅ 成功创建播客: ${podcast.title} (ID: ${podcast.id})`);

                } catch (error) {
                    results.failed++;
                    const errorInfo = {
                        row: rowNum,
                        title: row.Title || '未知标题',
                        arxiv_id: row.ID || '无ID',
                        error: error.message,
                        stack: error.stack
                    };
                    results.errors.push(errorInfo);
                    logger.error(`❌ 处理第 ${rowNum} 行失败: ${error.message}`);
                    logger.error(`错误详情: ${JSON.stringify(errorInfo, null, 2)}`);
                }
            }

            logger.info(`📊 Excel数据处理完成: 成功 ${results.success} 条, 失败 ${results.failed} 条, 跳过 ${results.skipped} 条`);

            if (results.skipped > 0 && results.success === 0 && results.failed === 0) {
                logger.info(`ℹ️ 所有数据均已存在于数据库中，无需重复上传`);
            }

            if (results.errors.length > 0) {
                logger.error(`错误摘要: ${results.errors.length} 个错误`);
                results.errors.forEach((error, index) => {
                    logger.error(`  ${index + 1}. 第${error.row}行 (${error.title}): ${error.error}`);
                });
            }

            return results;

        } catch (error) {
            logger.error(`处理Excel数据失败: ${error.message}`);
            logger.error(`错误堆栈: ${error.stack}`);
            throw error;
        }
    }

    /**
     * 准备播客数据
     * @param {Object} row - Excel行数据
     * @param {Object} channelData - 频道数据对象
     * @returns {Object} 播客数据对象
     */
    preparePodcastData(row, channelData, audioUrlMap = {}, titleMap = {}) {
        // 解析作者信息
        const authors = this.parseAuthors(row.Authors, row.Matched_Authors);

        // 解析发布日期
        let publishDate = null;
        if (row.Published_Date) {
            try {
                const date = new Date(row.Published_Date);
                if (!isNaN(date.getTime())) {
                    publishDate = date.toISOString().split('T')[0];
                }
            } catch (error) {
                console.warn(`日期解析失败: ${row.Published_Date}`);
            }
        }

        // 🆕 解析更新日期
        let updatedDate = null;
        if (row.Updated_Date) {
            try {
                const date = new Date(row.Updated_Date);
                if (!isNaN(date.getTime())) {
                    updatedDate = date.toISOString().split('T')[0];
                }
            } catch (error) {
                console.warn(`更新日期解析失败: ${row.Updated_Date}`);
            }
        }

        // 获取arXiv ID
        const arxivId = row.ID || '';

        // 准备数据，确保所有必填字段都有值
        const podcastData = {
            title: titleMap[arxivId] || row.Title || '无标题', // 优先使用播客标题
            description: row.Abstract || '暂无描述',
            channel_id: channelData.id,
            cover_url: channelData.cover_url,
            audio_url: audioUrlMap[arxivId] || '', // 使用音频URL映射
            paper_url: row.Abstract_URL || '',
            project_url: row.Project_URL || '',
            paper_title: row.Title || '无标题',
            authors: authors,
            institution: row.research_entities || '',
            publish_date: publishDate,
            arxiv_id: arxivId,
            primary_category: row.Primary_Category || '',
            all_categories: row.All_Categories || '',
            doi: row.DOI || '',

            // 🆕 完整字段
            updated_date: updatedDate,
            pdf_url: row.PDF_URL || '',
            comment: row.Comment || '',
            journal_ref: row.Journal_Ref || '',
            entry_id: row.Entry_ID || '',

            status: 'published',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        // 清理空值字段
        Object.keys(podcastData).forEach(key => {
            if (podcastData[key] === null || podcastData[key] === undefined || podcastData[key] === '') {
                delete podcastData[key];
            }
        });

        return podcastData;
    }

    /**
     * 解析作者信息
     * @param {string} authors - 作者字符串
     * @param {string} matchedAuthors - 匹配的作者字符串
     * @returns {Array} 作者数组
     */
    parseAuthors(authors, matchedAuthors) {
        if (!authors) return [];

        // 分割作者字符串
        const authorList = authors.split(',').map(author => author.trim()).filter(author => author);
        const matchedList = matchedAuthors ? matchedAuthors.split(',').map(author => author.trim()).filter(author => author) : [];

        return authorList.map(author => ({
            name: author,
            is_matched: matchedList.includes(author)
        }));
    }

    /**
     * 检查是否已存在相同的播客
     * @param {string} arxivId - arXiv ID
     * @returns {Promise<Object|null>} 已存在的播客或null
     */
    async checkExistingPodcast(arxivId) {
        if (!arxivId) return null;

        const { data, error } = await this.supabase
            .from('podcasts')
            .select('id, title')
            .eq('arxiv_id', arxivId)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = 未找到记录
            throw new Error(`检查播客存在性失败: ${error.message}`);
        }

        return data;
    }

    /**
     * 获取或创建默认频道
     * @param {Object} logger - 日志记录器
     * @returns {Promise<string>} 频道ID
     */
    async getOrCreateDefaultChannel(logger) {
        try {
            logger.info('开始获取或创建默认频道...');

            // 首先检查是否存在默认频道
            logger.info('检查是否已存在Excel导入播客频道...');
            const { data: existingChannel, error: checkError } = await this.supabase
                .from('channels')
                .select('id, name, description')
                .eq('name', 'Excel导入播客')
                .single();

            if (checkError && checkError.code !== 'PGRST116') {
                logger.error(`检查频道存在性失败: ${checkError.message}`);
                throw new Error(`检查频道存在性失败: ${checkError.message}`);
            }

            if (existingChannel) {
                logger.info(`找到已存在的频道: ${existingChannel.name} (ID: ${existingChannel.id})`);
                return existingChannel.id;
            }

            logger.info('未找到现有频道，创建新频道...');

            // 创建新频道
            const channelData = {
                name: 'Excel导入播客',
                description: '通过Excel文件导入的播客内容',
                creator_id: this.defaultUserId,
                category: '学术研究',
                is_official: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            logger.info(`创建频道数据: ${JSON.stringify(channelData, null, 2)}`);

            const { data: newChannel, error: insertError } = await this.supabase
                .from('channels')
                .insert(channelData)
                .select('id, name')
                .single();

            if (insertError) {
                logger.error(`创建频道数据库错误: ${JSON.stringify(insertError, null, 2)}`);
                throw new Error(`创建频道失败: ${insertError.message} (代码: ${insertError.code})`);
            }

            if (!newChannel) {
                throw new Error('频道创建成功但没有返回数据');
            }

            logger.info(`✅ 成功创建默认频道: ${newChannel.name} (ID: ${newChannel.id})`);
            return newChannel.id;

        } catch (error) {
            logger.error(`获取或创建默认频道失败: ${error.message}`);
            logger.error(`错误堆栈: ${error.stack}`);

            // 作为最后的回退，尝试获取第一个可用的频道
            try {
                logger.info('尝试获取第一个可用频道作为回退方案...');
                const { data: fallbackChannel } = await this.supabase
                    .from('channels')
                    .select('id')
                    .limit(1)
                    .single();

                if (fallbackChannel) {
                    logger.warning(`使用回退频道: ${fallbackChannel.id}`);
                    return fallbackChannel.id;
                }
            } catch (fallbackError) {
                logger.error(`回退方案也失败: ${fallbackError.message}`);
            }

            throw new Error(`无法获取或创建频道: ${error.message}`);
        }
    }

    /**
     * 批量更新播客状态
     * @param {Array} podcastIds - 播客ID数组
     * @param {string} status - 状态
     * @returns {Promise<Object>} 更新结果
     */
    async updatePodcastStatus(podcastIds, status) {
        const { data, error } = await this.supabase
            .from('podcasts')
            .update({
                status: status,
                updated_at: new Date().toISOString()
            })
            .in('id', podcastIds)
            .select();

        if (error) {
            throw new Error(`批量更新播客状态失败: ${error.message}`);
        }

        return { success: true, count: data.length };
    }

    /**
     * 获取播客统计信息
     * @returns {Promise<Object>} 统计信息
     */
    async getPodcastStats() {
        const { count: totalCount, error: totalError } = await this.supabase
            .from('podcasts')
            .select('*', { count: 'exact', head: true });

        const { count: todayCount, error: todayError} = await this.supabase
            .from('podcasts')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', new Date().toISOString().split('T')[0]);

        if (totalError || todayError) {
            throw new Error(`获取统计信息失败: ${totalError?.message || todayError?.message}`);
        }

        return {
            total: totalCount,
            today: todayCount
        };
    }

    /**
     * 获取频道存储配置
     * @param {string} channelId - 频道ID
     * @param {Object} logger - 日志记录器
     * @returns {Promise<Object>} 频道存储配置
     */
    async getChannelStorageConfig(channelId, logger) {
        try {
            logger.info(`获取频道存储配置: ${channelId}`);

            const { data: channel, error } = await this.supabase
                .from('channels')
                .select('id, name, storage_path, naming_prefix, file_format')
                .eq('id', channelId)
                .single();

            if (error || !channel) {
                throw new Error(`获取频道配置失败: ${error?.message || '频道不存在'}`);
            }

            logger.info(`频道原始配置: ${JSON.stringify(channel, null, 2)}`);

            // 从storage_path提取基础路径(去除日期部分)
            let basePath = channel.storage_path || 'channels/default';

            // 如果storage_path包含日期格式(YYYY/MM/DD),提取基础路径
            const datePattern = /\/\d{4}\/\d{2}\/\d{2}$/;
            if (datePattern.test(basePath)) {
                basePath = basePath.replace(datePattern, '');
                logger.info(`提取基础路径: ${basePath}`);
            }

            // 生成当前日期路径
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const datePath = `${year}/${month}/${day}`;

            // 组合最终存储路径
            const storagePath = `${basePath}/${datePath}`;

            logger.info(`生成的存储路径: ${storagePath}`);

            return {
                channelId: channel.id,
                channelName: channel.name,
                storagePath: storagePath,
                namingPrefix: channel.naming_prefix || '',
                fileFormat: channel.file_format || 'mp3'
            };

        } catch (error) {
            logger.error(`获取频道配置失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 批量更新播客的audio_url字段
     * @param {Array} updates - 更新列表 [{arxiv_id: '...', audio_url: '...', duration: 123}, ...]
     * @param {Object} logger - 日志记录器
     * @returns {Promise<Object>} 更新结果
     */
    async updatePodcastAudioUrls(updates, logger) {
        try {
            logger.info(`开始批量更新 ${updates.length} 条播客的音频URL...`);

            const results = {
                success: 0,
                failed: 0,
                errors: []
            };

            for (const update of updates) {
                const { arxiv_id, audio_url, duration } = update;

                if (!arxiv_id || !audio_url) {
                    logger.warning(`跳过无效更新: arxiv_id=${arxiv_id}, audio_url=${audio_url}`);
                    continue;
                }

                try {
                    const updateData = {
                        audio_url: audio_url,
                        updated_at: new Date().toISOString()
                    };

                    if (duration) {
                        updateData.duration = duration;
                    }

                    const { data, error } = await this.supabase
                        .from('podcasts')
                        .update(updateData)
                        .eq('arxiv_id', arxiv_id)
                        .select();

                    if (error) {
                        throw new Error(error.message);
                    }

                    if (data && data.length > 0) {
                        results.success++;
                        logger.info(`✓ 更新成功: ${arxiv_id} -> ${audio_url}`);
                    } else {
                        results.failed++;
                        results.errors.push({
                            arxiv_id: arxiv_id,
                            error: '未找到匹配的记录'
                        });
                        logger.warning(`✗ 未找到记录: ${arxiv_id}`);
                    }

                } catch (error) {
                    results.failed++;
                    results.errors.push({
                        arxiv_id: arxiv_id,
                        error: error.message
                    });
                    logger.error(`✗ 更新失败 ${arxiv_id}: ${error.message}`);
                }
            }

            logger.info(`批量更新完成: 成功 ${results.success} 条, 失败 ${results.failed} 条`);

            return results;

        } catch (error) {
            logger.error(`批量更新音频URL失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 批量更新播客标题
     * @param {Object} titleMapping - 标题映射 {arxiv_id: 'podcast_title', ...}
     * @param {Object} logger - 日志记录器
     * @returns {Promise<Object>} 更新结果
     */
    async updatePodcastTitles(titleMapping, logger) {
        try {
            const arxivIds = Object.keys(titleMapping);
            logger.info(`开始批量更新 ${arxivIds.length} 条播客标题...`);

            const results = {
                success: 0,
                failed: 0,
                errors: []
            };

            for (const arxivId of arxivIds) {
                const podcastTitle = titleMapping[arxivId];

                if (!arxivId || !podcastTitle) {
                    logger.warning(`跳过无效更新: arxiv_id=${arxivId}, title=${podcastTitle}`);
                    continue;
                }

                try {
                    const { data, error } = await this.supabase
                        .from('podcasts')
                        .update({
                            title: podcastTitle,
                            updated_at: new Date().toISOString()
                        })
                        .eq('arxiv_id', arxivId)
                        .select();

                    if (error) {
                        throw new Error(error.message);
                    }

                    if (data && data.length > 0) {
                        results.success++;
                        logger.info(`✓ 标题更新成功: ${arxivId} -> ${podcastTitle.substring(0, 50)}...`);
                    } else {
                        results.failed++;
                        results.errors.push({
                            arxiv_id: arxivId,
                            error: '未找到匹配的记录'
                        });
                        logger.warning(`✗ 未找到记录: ${arxivId}`);
                    }

                } catch (error) {
                    results.failed++;
                    results.errors.push({
                        arxiv_id: arxivId,
                        error: error.message
                    });
                    logger.error(`✗ 标题更新失败 ${arxivId}: ${error.message}`);
                }
            }

            logger.info(`批量标题更新完成: 成功 ${results.success} 条, 失败 ${results.failed} 条`);

            return results;

        } catch (error) {
            logger.error(`批量更新标题失败: ${error.message}`);
            throw error;
        }
    }
}

module.exports = SupabaseClient;