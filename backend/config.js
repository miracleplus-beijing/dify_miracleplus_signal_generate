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
}

module.exports = new Config();