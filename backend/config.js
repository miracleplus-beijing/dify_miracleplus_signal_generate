require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const path = require('path');
const fs = require('fs');

class Config {
    constructor() {
        // Dify API 基础配置
        this.DIFY_BASE_URL = process.env.DIFY_BASE_URL || 'https://api.dify.ai/v1';

        // 多 Workflow 配置
        this.WORKFLOWS = {
            PODCAST: {
                name: 'Podcast Script Generator',
                apiKey: process.env.DIFY_PODCAST_API_KEY || '',
                workflowId: process.env.DIFY_PODCAST_WORKFLOW_ID || '',
                needsDownload: true // 是否需要下载文件
            },
            CHEESE_DAILY: {
                name: 'Cheese Daily',
                apiKey: process.env.DIFY_CHEESE_DAYLY_API_KEY || '',
                workflowId: process.env.DIFY_CHEESE_DAYLY_WORKFLOW_ID || '',
                needsDownload: false // 不需要下载文件
            }
        };

        // 固定用户ID
        this.DEFAULT_USER_ID = 'podcast_generator_user';

        // 输出目录配置
        this.OUTPUT_BASE_DIR = path.resolve(__dirname, '../outputs');
        this.customOutputDir = null; // 用户自定义输出目录

        // 服务器配置
        this.HOST = '127.0.0.1';
        this.PORT = 8000;

        // Dify批量处理配置
        this.DIFY_BATCH_MODE = process.env.DIFY_BATCH_MODE || 'batch'; // batch: 批量数组 | sequential: 串行
        this.DIFY_BATCH_INPUT_VARIABLE = process.env.DIFY_BATCH_INPUT_VARIABLE || 'arxiv_urls';
        this.DIFY_SINGLE_INPUT_VARIABLE = process.env.DIFY_SINGLE_INPUT_VARIABLE || 'arxiv_url';
        this.DIFY_BATCH_OUTPUT_VARIABLE = process.env.DIFY_BATCH_OUTPUT_VARIABLE || 'results'; // Dify返回的数组变量名

        // Dify URL/文本输入变量配置
        this.DIFY_URL_INPUT_VARIABLE = process.env.DIFY_URL_INPUT_VARIABLE || 'url';
        this.DIFY_ARTICLE_INPUT_VARIABLE = process.env.DIFY_ARTICLE_INPUT_VARIABLE || 'article';

        // 单条模式重试配置
        this.SEQUENTIAL_MODE_RETRY_ATTEMPTS = parseInt(process.env.SEQUENTIAL_RETRY_ATTEMPTS || '3');
        this.SEQUENTIAL_MODE_RETRY_DELAY_MS = parseInt(process.env.SEQUENTIAL_RETRY_DELAY_MS || '5000');

        // arXiv补全配置
        this.ARXIV_ENRICH_ENABLED = process.env.ARXIV_ENRICH_ENABLED !== 'false';
        this.ARXIV_API_DELAY_MS = parseInt(process.env.ARXIV_API_DELAY_MS || '1000');
        this.ARXIV_MAX_RETRIES = parseInt(process.env.ARXIV_MAX_RETRIES || '3');
        this.ARXIV_TIMEOUT_MS = parseInt(process.env.ARXIV_TIMEOUT_MS || '30000');

        // 音频生成配置
        this.SKIP_TTS = process.env.SKIP_TTS === '1';
        this.PODCAST_PYTHON = process.env.PODCAST_PYTHON || 'python';

        // 日志配置
        this.LOG_LEVEL = process.env.LOG_LEVEL || 'info';
        this.VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === 'true';

        // Supabase配置
        this.SUPABASE_URL = process.env.SUPABASE_URL || '';
        this.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_API_KEY || '';

        // 配置验证
        this.validateConfig();
    }

    /**
     * 获取所有可用的 workflow
     * @returns {Array} workflow 列表
     */
    getAvailableWorkflows() {
        return Object.keys(this.WORKFLOWS).map(key => ({
            id: key,
            name: this.WORKFLOWS[key].name,
            needsDownload: this.WORKFLOWS[key].needsDownload
        }));
    }

    /**
     * 根据 ID 获取 workflow 配置
     * @param {string} workflowId - workflow ID
     * @returns {object|null} workflow 配置
     */
    getWorkflowConfig(workflowId) {
        return this.WORKFLOWS[workflowId] || null;
    }

    /**
     * 设置自定义输出目录
     * @param {string} dirPath - 自定义输出目录路径
     */
    setCustomOutputDir(dirPath) {
        if (dirPath && fs.existsSync(dirPath)) {
            this.customOutputDir = dirPath;
        }
    }

    /**
     * 获取当前日期的输出目录
     * @returns {string} 输出目录路径
     */
    getOutputDir() {
        // 优先使用自定义输出目录
        const baseDir = this.customOutputDir || this.OUTPUT_BASE_DIR;

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');

        const datePath = path.join(String(year), month, day);
        const outputDir = path.join(baseDir, datePath);
        const logsDir = path.join(outputDir, 'logs');

        // 确保目录存在
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        return outputDir;
    }

    /**
     * 获取日志目录
     * @returns {string} 日志目录路径
     */
    getLogsDir() {
        return path.join(this.getOutputDir(), 'logs');
    }

    /**
     * 验证必需配置项
     */
    validateConfig() {
        const errors = [];
        const warnings = [];

        // 验证Dify配置
        if (!this.WORKFLOWS.PODCAST.apiKey) {
            errors.push('❌ 缺少 DIFY_PODCAST_API_KEY');
        }

        // 验证Supabase配置
        if (!this.SUPABASE_SERVICE_KEY) {
            warnings.push('⚠️  未配置 SUPABASE_SERVICE_ROLE_API_KEY（Supabase功能将不可用）');
        }

        // 验证重试配置范围
        if (this.SEQUENTIAL_MODE_RETRY_ATTEMPTS < 1 || this.SEQUENTIAL_MODE_RETRY_ATTEMPTS > 10) {
            warnings.push('⚠️  SEQUENTIAL_RETRY_ATTEMPTS 建议范围: 1-10');
        }

        // 输出验证结果
        if (errors.length > 0 || warnings.length > 0) {
            console.log('\n========== 配置验证 ==========');

            if (errors.length > 0) {
                errors.forEach(err => console.error(err));
            }

            if (warnings.length > 0) {
                warnings.forEach(warn => console.warn(warn));
            }

            console.log('参考 .env.example 完善配置\n');

            // 如果是关键配置缺失，终止程序
            if (errors.length > 0) {
                process.exit(1);
            }
        } else {
            console.log('✅ 配置验证通过');
        }
    }

    /**
     * 获取完整配置摘要（用于调试）
     */
    getConfigSummary() {
        return {
            dify: {
                baseUrl: this.DIFY_BASE_URL,
                batchMode: this.DIFY_BATCH_MODE,
                workflows: Object.keys(this.WORKFLOWS)
            },
            processing: {
                sequentialRetries: this.SEQUENTIAL_MODE_RETRY_ATTEMPTS,
                retryDelay: this.SEQUENTIAL_MODE_RETRY_DELAY_MS
            },
            arxiv: {
                enabled: this.ARXIV_ENRICH_ENABLED,
                apiDelay: this.ARXIV_API_DELAY_MS,
                maxRetries: this.ARXIV_MAX_RETRIES
            },
            tts: {
                skipTTS: this.SKIP_TTS,
                pythonPath: this.PODCAST_PYTHON
            },
            server: {
                host: this.HOST,
                port: this.PORT
            }
        };
    }
}

module.exports = new Config();