const fs = require('fs');
const path = require('path');
const config = require('./config');

class Logger {
    constructor(workflowRunId = null) {
        this.workflowRunId = workflowRunId;
        this.logs = [];
        this.logFile = null;

        // 如果提供了 workflowRunId，创建日志文件
        if (workflowRunId) {
            const timestamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
            const logsDir = config.getLogsDir();
            this.logFile = path.join(logsDir, `execution_${timestamp}.log`);
        }
    }

    /**
     * 记录日志
     * @param {string} message - 日志消息
     * @param {string} level - 日志级别 (INFO/WARNING/ERROR)
     */
    log(message, level = 'INFO') {
        const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
        const logEntry = `[${timestamp}] [${level}] ${message}`;

        // 保存到内存
        this.logs.push(logEntry);

        // 打印到控制台
        console.log(logEntry);

        // 写入文件
        if (this.logFile) {
            fs.appendFileSync(this.logFile, logEntry + '\n', 'utf8');
        }
    }

    info(message) {
        this.log(message, 'INFO');
    }

    warning(message) {
        this.log(message, 'WARNING');
    }

    error(message) {
        this.log(message, 'ERROR');
    }

    getLogs() {
        return this.logs;
    }

    getLogFilePath() {
        return this.logFile;
    }
}

module.exports = Logger;