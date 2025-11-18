const { spawn } = require('child_process');
const path = require('path');

/**
 * ArxivEnricher - 从arXiv API补全Excel数据中缺失的论文元数据
 */
class ArxivEnricher {
    constructor(logger, config = {}) {
        this.logger = logger;
        this.enrichedCount = 0;
        this.failedCount = 0;
        this.skippedCount = 0;

        // 配置选项
        this.config = {
            enabled: config.enabled !== false, // 默认启用
            apiDelayMs: config.apiDelayMs || 1000, // API调用间隔
            maxRetries: config.maxRetries || 3, // 最大重试次数
            timeoutMs: config.timeoutMs || 30000, // 超时时间
            pythonExecutable: config.pythonExecutable || 'python',
            condaEnv: config.condaEnv || 'podcast'
        };

        this.projectRoot = path.join(__dirname, '..');
    }

    /**
     * 检查字段是否需要补全
     * @param {Object} item - Excel数据行
     * @returns {Array<string>} 需要补全的字段列表
     */
    getMissingFields(item) {
        const missing = [];

        if (!item.Title || item.Title.trim() === '') missing.push('Title');
        if (!item.Authors || item.Authors.trim() === '') missing.push('Authors');
        if (!item.Abstract || item.Abstract.trim() === '') missing.push('Abstract');
        if (!item.Published_Date || item.Published_Date.trim() === '') missing.push('Published_Date');
        if (!item.Abstract_URL || item.Abstract_URL.trim() === '') missing.push('Abstract_URL');
        if (!item.Primary_Category || item.Primary_Category.trim() === '') missing.push('Primary_Category');
        if (!item.All_Categories || item.All_Categories.trim() === '') missing.push('All_Categories');

        return missing;
    }

    /**
     * 从arXiv API获取论文数据（调用Python脚本）
     * @param {string} arxivId - arXiv ID
     * @returns {Promise<Object>} 论文数据
     */
    async fetchFromArxiv(arxivId) {
        return new Promise((resolve, reject) => {
            const scriptPath = path.join(this.projectRoot, 'scripts', 'fetch_arxiv.py');

            this.logger.info(`正在调用 Python 脚本获取数据: ${arxivId}`);

            // 使用 conda run 调用 Python 脚本
            const process = spawn('conda', [
                'run', '-n', this.config.condaEnv,
                'python', scriptPath,
                '--arxiv-id', arxivId,
                '--verbose'
            ], {
                cwd: this.projectRoot
            });

            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            // 设置超时
            const timeout = setTimeout(() => {
                process.kill();
                reject(new Error(`请求超时 (${this.config.timeoutMs}ms): ${arxivId}`));
            }, this.config.timeoutMs);

            process.on('close', (code) => {
                clearTimeout(timeout);

                if (code === 0) {
                    try {
                        const result = JSON.parse(stdout);
                        this.logger.info(`✓ 成功获取 arXiv 数据: ${arxivId}`);
                        resolve(result);
                    } catch (e) {
                        this.logger.error(`JSON 解析失败: ${e.message}`);
                        this.logger.error(`原始输出: ${stdout}`);
                        reject(new Error(`JSON解析失败: ${e.message}`));
                    }
                } else {
                    this.logger.error(`Python 脚本退出码 ${code}`);
                    this.logger.error(`错误输出: ${stderr}`);
                    reject(new Error(`Python脚本失败 (code ${code}): ${stderr}`));
                }
            });

            process.on('error', (error) => {
                clearTimeout(timeout);
                this.logger.error(`进程启动失败: ${error.message}`);
                reject(new Error(`进程启动失败: ${error.message}`));
            });
        });
    }

    /**
     * 将arXiv数据转换为Excel格式
     * @param {Object} arxivPaper - arXiv API返回的论文对象
     * @returns {Object} 转换后的数据
     */
    transformArxivData(arxivPaper) {
        // 提取作者名字
        const authors = arxivPaper.authors || [];
        const authorNames = authors.map(a => a.name).join(', ');

        // 提取分类
        const categories = arxivPaper.categories || [];
        const allCategories = categories.join(', ');

        return {
            Title: arxivPaper.title || '',
            Authors: authorNames,
            Abstract: arxivPaper.summary || '',
            Published_Date: arxivPaper.published || '',
            Abstract_URL: arxivPaper.id || '',
            Primary_Category: arxivPaper.primary_category || '',
            All_Categories: allCategories,
            // 额外信息（可选）
            _arxiv_pdf_url: arxivPaper.pdf_url || '',
            _arxiv_doi: arxivPaper.doi || ''
        };
    }

    /**
     * 补全单条数据
     * @param {Object} item - Excel数据行
     * @param {number} retryCount - 当前重试次数
     * @returns {Promise<Object>} 补全后的数据
     */
    async enrichItem(item, retryCount = 0) {
        // 检查是否有arXiv ID
        if (!item.ID || item.ID.trim() === '') {
            this.logger.warning(`跳过无ID的数据行: ${item._rowNumber || '未知'}`);
            this.skippedCount++;
            return item;
        }

        const missingFields = this.getMissingFields(item);

        // 如果没有缺失字段，直接返回
        if (missingFields.length === 0) {
            this.logger.info(`数据完整，跳过: ${item.ID}`);
            this.skippedCount++;
            return item;
        }

        this.logger.info(`需要补全字段: [${missingFields.join(', ')}] for ${item.ID}`);

        try {
            // 从arXiv获取数据
            const arxivData = await this.fetchFromArxiv(item.ID);
            const transformedData = this.transformArxivData(arxivData);

            // 仅补全缺失的字段（不覆盖已有数据）
            const enrichedItem = { ...item };
            missingFields.forEach(field => {
                if (transformedData[field]) {
                    enrichedItem[field] = transformedData[field];
                    this.logger.info(`  ✓ 补全字段 ${field}: ${transformedData[field].substring(0, 50)}...`);
                }
            });

            this.logger.info(`✅ 成功补全: ${item.ID} (${missingFields.length} 个字段)`);
            this.enrichedCount++;
            return enrichedItem;

        } catch (error) {
            // 重试逻辑
            if (retryCount < this.config.maxRetries) {
                this.logger.warning(`补全失败，重试 ${retryCount + 1}/${this.config.maxRetries}: ${item.ID}`);
                await new Promise(resolve => setTimeout(resolve, 2000)); // 重试前等待2秒
                return this.enrichItem(item, retryCount + 1);
            }

            this.logger.error(`❌ 补全失败 ${item.ID}: ${error.message}`);
            this.failedCount++;
            // 失败时返回原数据
            return item;
        }
    }

    /**
     * 批量补全数据
     * @param {Array} dataArray - Excel数据数组
     * @param {Function} sendEvent - SSE事件发送函数（可选）
     * @returns {Promise<Array>} 补全后的数据数组
     */
    async enrichData(dataArray, sendEvent = null) {
        // 检查是否启用
        if (!this.config.enabled) {
            this.logger.info('arXiv数据补全已禁用（配置: enabled=false）');
            return dataArray;
        }

        this.logger.info(`开始补全 ${dataArray.length} 条数据...`);
        this.logger.info(`配置: API间隔=${this.config.apiDelayMs}ms, 超时=${this.config.timeoutMs}ms, 最大重试=${this.config.maxRetries}`);

        const enrichedData = [];
        const startTime = Date.now();

        for (let i = 0; i < dataArray.length; i++) {
            const item = dataArray[i];

            // 发送进度事件
            if (sendEvent) {
                sendEvent('progress', {
                    status: 'enriching_data',
                    message: `正在补全数据 (${i + 1}/${dataArray.length}): ${item.ID || '未知'}`,
                    progress: 10 + Math.floor((i / dataArray.length) * 10), // 10-20%进度区间
                    current: i + 1,
                    total: dataArray.length
                });
            }

            // 补全数据
            const enrichedItem = await this.enrichItem(item);
            enrichedData.push(enrichedItem);

            // API速率限制：每次请求间隔
            if (i < dataArray.length - 1) {
                this.logger.info(`等待 ${this.config.apiDelayMs}ms 后继续...`);
                await new Promise(resolve => setTimeout(resolve, this.config.apiDelayMs));
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        this.logger.info(`数据补全完成: 成功 ${this.enrichedCount}, 跳过 ${this.skippedCount}, 失败 ${this.failedCount}, 耗时 ${elapsed}秒`);

        return enrichedData;
    }

    /**
     * 获取补全统计信息
     * @returns {Object} 统计信息
     */
    getStats() {
        return {
            enriched: this.enrichedCount,
            skipped: this.skippedCount,
            failed: this.failedCount,
            total: this.enrichedCount + this.skippedCount + this.failedCount
        };
    }

    /**
     * 重置统计计数器
     */
    resetStats() {
        this.enrichedCount = 0;
        this.failedCount = 0;
        this.skippedCount = 0;
    }
}

module.exports = ArxivEnricher;
