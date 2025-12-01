const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const config = require('./config');
const Logger = require('./logger');

class DifyClient {
    constructor(logger = null, workflowType = 'PODCAST') {
        this.baseUrl = config.DIFY_BASE_URL;
        this.workflowType = workflowType;

        // 根据 workflow 类型获取对应的配置
        const workflowConfig = config.getWorkflowConfig(workflowType);
        if (!workflowConfig) {
            throw new Error(`Invalid workflow type: ${workflowType}`);
        }

        this.apiKey = workflowConfig.apiKey;
        this.needsDownload = workflowConfig.needsDownload;
        this.userId = config.DEFAULT_USER_ID;
        this.logger = logger || new Logger();

        // 设置请求头
        this.headers = {
            'Authorization': `Bearer ${this.apiKey}`,
        };
    }

    /**
     * 上传文件到 Dify
     * @param {string} filePath - 文件路径
     * @param {string} fileName - 文件名
     * @returns {Promise<string|null>} - 返回 upload_file_id 或 null
     */
    async uploadFile(filePath, fileName) {
        const url = `${this.baseUrl}/files/upload`;

        try {
            this.logger.info(`开始上传文件: ${fileName}`);

            const formData = new FormData();
            formData.append('file', fs.createReadStream(filePath), {
                filename: fileName,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            formData.append('user', this.userId);

            const response = await axios.post(url, formData, {
                headers: {
                    ...this.headers,
                    ...formData.getHeaders()
                },
                timeout: 120000
            });

            if (response.status === 200 || response.status === 201) {
                const uploadFileId = response.data.id;
                this.logger.info(`文件上传成功, upload_file_id: ${uploadFileId}`);
                this.logger.info(`文件上传详情: ${JSON.stringify(response.data, null, 2)}`);
                return uploadFileId;
            } else {
                this.logger.error(`文件上传失败: ${response.status}`);
                return null;
            }

        } catch (error) {
            this.logger.error(`文件上传异常: ${error.message}`);
            return null;
        }
    }

    /**
     * 执行 workflow (流式返回)
     * @param {string} uploadFileId - 上传的文件ID
     * @param {string} fileVariableName - workflow 中的文件变量名
     * @param {boolean} isArray - 文件变量是否为数组类型（默认 false）
     * @returns {Promise<object>} - 返回 axios response stream
     */
    async runWorkflowStreaming(uploadFileId, fileVariableName = 'file', isArray = false) {
        const url = `${this.baseUrl}/workflows/run`;

        const fileValue = {
            type: 'document',
            transfer_method: 'local_file',
            upload_file_id: uploadFileId
        };

        const payload = {
            inputs: {
                [fileVariableName]: isArray ? [fileValue] : fileValue
            },
            response_mode: 'streaming',
            user: this.userId
        };

        this.logger.info(`开始执行 workflow, 文件变量: ${fileVariableName}`);
        this.logger.info(`请求 URL: ${url}`);
        this.logger.info(`请求 Payload: ${JSON.stringify(payload, null, 2)}`);

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/json'
                },
                responseType: 'stream',
                timeout: 600000
            });

            return response;

        } catch (error) {
            this.logger.error(`Workflow 执行异常: ${error.message}`);

            // 打印详细错误信息
            if (error.response) {
                this.logger.error(`响应状态码: ${error.response.status}`);
                this.logger.error(`响应头: ${JSON.stringify(error.response.headers, null, 2)}`);

                // 如果响应体是流，尝试读取
                if (error.response.data) {
                    let errorData = '';
                    try {
                        if (typeof error.response.data === 'object' && error.response.data.on) {
                            // 流式数据
                            error.response.data.on('data', chunk => {
                                errorData += chunk.toString();
                            });
                            error.response.data.on('end', () => {
                                this.logger.error(`响应体: ${errorData}`);
                            });
                        } else {
                            // 普通对象
                            this.logger.error(`响应体: ${JSON.stringify(error.response.data, null, 2)}`);
                        }
                    } catch (e) {
                        this.logger.error(`无法解析响应体: ${e.message}`);
                    }
                }
            } else if (error.request) {
                this.logger.error(`无响应，请求已发送`);
            }

            throw error;
        }
    }

    /**
     * 查询 workflow 日志
     * @param {number} page - 页码
     * @param {number} limit - 每页数量
     * @param {string} status - 执行状态过滤
     * @returns {Promise<object|null>} - 返回日志数据或 null
     */
    async getWorkflowLogs(page = 1, limit = 20, status = null) {
        const url = `${this.baseUrl}/workflows/logs`;

        const params = { page, limit };
        if (status) {
            params.status = status;
        }

        try {
            const response = await axios.get(url, {
                headers: this.headers,
                params,
                timeout: 30000
            });

            if (response.status === 200) {
                return response.data;
            } else {
                this.logger.error(`查询日志失败: ${response.status}`);
                return null;
            }

        } catch (error) {
            this.logger.error(`查询日志异常: ${error.message}`);
            return null;
        }
    }

    /**
     * 批量模式：发送arXiv URL数组
     * @param {Array} arxivUrls - arXiv链接数组
     * @returns {Promise<object>} - 返回流式响应
     */
    async runWorkflowBatch(arxivUrls) {
        const url = `${this.baseUrl}/workflows/run`;

        const payload = {
            inputs: {
                [config.DIFY_BATCH_INPUT_VARIABLE]: arxivUrls
            },
            response_mode: 'streaming',
            user: this.userId
        };

        this.logger.info(`[Batch] 批量执行Workflow: ${arxivUrls.length} 个链接`);
        this.logger.info(`[Batch] 输入变量: ${config.DIFY_BATCH_INPUT_VARIABLE}`);

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/json'
                },
                responseType: 'stream',
                timeout: 1800000 // 30分钟超时（批量处理时间更长）
            });

            return response;
        } catch (error) {
            this.logger.error(`[Batch] Workflow执行失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 单个模式：发送单个arXiv URL
     * @param {string} arxivUrl - 单个arXiv链接
     * @returns {Promise<object>} - 返回流式响应
     */
    async runWorkflowSingle(arxivUrl) {
        const url = `${this.baseUrl}/workflows/run`;

        const payload = {
            inputs: {
                [config.DIFY_SINGLE_INPUT_VARIABLE]: arxivUrl
            },
            response_mode: 'streaming',
            user: this.userId
        };

        this.logger.info(`[Single] 单个执行Workflow: ${arxivUrl}`);

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/json'
                },
                responseType: 'stream',
                timeout: 600000 // 10分钟超时
            });

            return response;
        } catch (error) {
            this.logger.error(`[Single] Workflow执行失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * URL模式：发送单个URL到Dify
     * @param {string} url - 单个URL
     * @returns {Promise<object>} - 返回流式响应
     */
    async runWorkflowWithUrl(url) {
        const apiUrl = `${this.baseUrl}/workflows/run`;

        const payload = {
            inputs: {
                [config.DIFY_URL_INPUT_VARIABLE]: url
            },
            response_mode: 'streaming',
            user: this.userId
        };

        this.logger.info(`[URL] 单个执行Workflow: ${url}`);

        try {
            const response = await axios.post(apiUrl, payload, {
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/json'
                },
                responseType: 'stream',
                timeout: 600000 // 10分钟超时
            });

            return response;
        } catch (error) {
            this.logger.error(`[URL] Workflow执行失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 文本模式：发送文章内容到Dify
     * @param {string} article - 文章文本内容
     * @returns {Promise<object>} - 返回流式响应
     */
    async runWorkflowWithArticle(article) {
        const apiUrl = `${this.baseUrl}/workflows/run`;

        const payload = {
            inputs: {
                [config.DIFY_ARTICLE_INPUT_VARIABLE]: article
            },
            response_mode: 'streaming',
            user: this.userId
        };

        this.logger.info(`[Article] 执行Workflow，文本长度: ${article.length} 字符`);

        try {
            const response = await axios.post(apiUrl, payload, {
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/json'
                },
                responseType: 'stream',
                timeout: 600000 // 10分钟超时
            });

            return response;
        } catch (error) {
            this.logger.error(`[Article] Workflow执行失败: ${error.message}`);
            throw error;
        }
    }
}

module.exports = DifyClient;