const crypto = require('crypto');

/**
 * 验证URL格式
 * @param {string} url - 要验证的URL
 * @returns {boolean} - 是否为有效URL
 */
function validateUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }

    try {
        const urlObj = new URL(url);
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * 解析多行URL输入
 * @param {string} text - 多行URL文本
 * @returns {Array<string>} - 有效的URL数组（已去重）
 */
function parseMultilineUrls(text) {
    if (!text) return [];

    const urls = text.split('\n')
        .map(line => line.trim())
        .filter(line => line && validateUrl(line));

    // 去重
    return [...new Set(urls)];
}

/**
 * 生成URL-hash标识符
 * @param {string} url - 原始URL
 * @returns {string} - URL hash标识符 (格式: url-xxxxxxxxxxxx)
 */
function generateUrlHash(url) {
    const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
    return `url-${hash}`;
}

/**
 * 生成时间戳ID（用于文本输入）
 * @returns {string} - 时间戳ID (格式: text-YYYY-MM-DD-HH-MM-SS)
 */
function generateTextId() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `text-${timestamp}`;
}

/**
 * 从URL中提取简短描述（用于日志显示）
 * @param {string} url - 原始URL
 * @param {number} maxLength - 最大长度（默认50）
 * @returns {string} - 简短URL描述
 */
function getUrlShortDescription(url, maxLength = 50) {
    if (!url) return '';

    try {
        const urlObj = new URL(url);
        const path = urlObj.pathname + urlObj.search;
        const shortPath = path.length > maxLength ? path.substring(0, maxLength - 3) + '...' : path;
        return `${urlObj.hostname}${shortPath}`;
    } catch {
        return url.substring(0, maxLength);
    }
}

/**
 * 验证文本长度
 * @param {string} text - 文本内容
 * @param {number} maxLength - 最大长度
 * @returns {Object} - {valid: boolean, length: number, error?: string}
 */
function validateTextLength(text, maxLength = 100000) {
    if (!text || typeof text !== 'string') {
        return { valid: false, length: 0, error: '文本内容为空' };
    }

    const length = text.length;

    if (length === 0) {
        return { valid: false, length: 0, error: '文本内容为空' };
    }

    if (length > maxLength) {
        return {
            valid: false,
            length,
            error: `文本长度超过限制（${length} > ${maxLength}）`
        };
    }

    return { valid: true, length };
}

module.exports = {
    validateUrl,
    parseMultilineUrls,
    generateUrlHash,
    generateTextId,
    getUrlShortDescription,
    validateTextLength
};
