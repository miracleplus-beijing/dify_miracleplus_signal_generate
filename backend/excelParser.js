const XLSX = require('xlsx');

class ExcelParser {
    /**
     * 解析Excel文件
     * @param {string} filePath - Excel文件路径
     * @param {Object} logger - 日志记录器
     * @returns {Promise<Array>} 解析后的数据数组
     */
    async parseExcelFile(filePath, logger) {
        try {
            logger.info(`开始解析Excel文件: ${filePath}`);

            // 读取Excel文件
            const workbook = XLSX.readFile(filePath);

            // 获取第一个工作表
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            if (!worksheet) {
                throw new Error('Excel文件中没有找到工作表');
            }

            logger.info(`使用工作表: ${firstSheetName}`);

            // 将工作表转换为JSON数据
            const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                defval: '', // 空值默认为空字符串
                raw: false, // 转换为字符串，避免日期格式问题
                header: 1 // 使用第一行作为表头
            });

            if (jsonData.length === 0) {
                throw new Error('Excel文件中没有数据');
            }

            logger.info(`Excel文件包含 ${jsonData.length} 行数据`);

            // 验证必要的列是否存在
            const requiredColumns = ['ID', 'Title', 'Authors', 'Abstract', 'Published_Date'];
            const missingColumns = this.validateColumns(jsonData[0], requiredColumns);

            if (missingColumns.length > 0) {
                logger.warning(`Excel文件缺少列: ${missingColumns.join(', ')}`);
            }

            // 转换数据格式
            const parsedData = this.transformData(jsonData);

            logger.info(`成功解析 ${parsedData.length} 条有效数据`);
            return parsedData;

        } catch (error) {
            logger.error(`解析Excel文件失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 验证Excel列是否齐全
     * @param {Object} headers - 表头对象
     * @param {Array} requiredColumns - 必需的列名数组
     * @returns {Array} 缺失的列名数组
     */
    validateColumns(headers, requiredColumns) {
        const headerKeys = Object.keys(headers);
        return requiredColumns.filter(col => !headerKeys.includes(col));
    }

    /**
     * 转换数据格式
     * @param {Array} rawData - 原始数据数组
     * @returns {Array} 转换后的数据数组
     */
    transformData(rawData) {
        if (rawData.length <= 1) {
            return [];
        }

        const headers = rawData[0];
        const dataRows = rawData.slice(1);

        return dataRows.map((row, index) => {
            const item = {};

            // 将每行数据转换为对象
            headers.forEach((header, colIndex) => {
                if (header) { // 只处理有表头的列
                    item[header] = row[colIndex] || '';
                }
            });

            // 添加行号信息（用于错误追踪）
            item._rowNumber = index + 2; // Excel行号从1开始，加上表头行

            return item;
        }).filter(item => {
            // 过滤掉空行（至少要有ID或Title）
            return item.ID || item.Title;
        });
    }

    /**
     * 验证数据完整性
     * @param {Array} data - 数据数组
     * @param {Object} logger - 日志记录器
     * @returns {Object} 验证结果
     */
    validateData(data, logger) {
        const validationResults = {
            valid: [],
            invalid: [],
            warnings: []
        };

        data.forEach((item, index) => {
            const errors = [];
            const warnings = [];

            // 必需字段验证
            if (!item.ID || item.ID.trim() === '') {
                errors.push('缺少ID字段');
            }

            if (!item.Title || item.Title.trim() === '') {
                errors.push('缺少Title字段');
            }

            if (!item.Authors || item.Authors.trim() === '') {
                warnings.push('缺少Authors字段');
            }

            if (!item.Abstract || item.Abstract.trim() === '') {
                warnings.push('缺少Abstract字段');
            }

            // 日期格式验证
            if (item.Published_Date) {
                const date = new Date(item.Published_Date);
                if (isNaN(date.getTime())) {
                    warnings.push(`Published_Date格式无效: ${item.Published_Date}`);
                }
            }

            // URL格式验证
            if (item.Abstract_URL) {
                try {
                    new URL(item.Abstract_URL);
                } catch {
                    warnings.push(`Abstract_URL格式无效: ${item.Abstract_URL}`);
                }
            }

            if (item.Project_URL) {
                try {
                    new URL(item.Project_URL);
                } catch {
                    warnings.push(`Project_URL格式无效: ${item.Project_URL}`);
                }
            }

            // 分类验证
            if (!item.Primary_Category || item.Primary_Category.trim() === '') {
                warnings.push('缺少Primary_Category字段');
            }

            if (errors.length > 0) {
                validationResults.invalid.push({
                    row: item._rowNumber,
                    id: item.ID,
                    title: item.Title,
                    errors: errors,
                    warnings: warnings
                });

                logger.error(`第 ${item._rowNumber} 行数据验证失败: ${errors.join(', ')}`);
            } else {
                validationResults.valid.push(item);

                if (warnings.length > 0) {
                    validationResults.warnings.push({
                        row: item._rowNumber,
                        id: item.ID,
                        title: item.Title,
                        warnings: warnings
                    });

                    logger.warning(`第 ${item._rowNumber} 行数据有警告: ${warnings.join(', ')}`);
                }
            }
        });

        return validationResults;
    }

    /**
     * 获取数据摘要信息
     * @param {Array} data - 数据数组
     * @returns {Object} 摘要信息
     */
    getDataSummary(data) {
        const summary = {
            totalCount: data.length,
            categories: {},
            dateRange: {
                earliest: null,
                latest: null
            },
            hasMissingFields: {
                authors: 0,
                abstract: 0,
                url: 0
            }
        };

        data.forEach(item => {
            // 分类统计
            if (item.Primary_Category) {
                summary.categories[item.Primary_Category] = (summary.categories[item.Primary_Category] || 0) + 1;
            }

            // 日期范围
            if (item.Published_Date) {
                const date = new Date(item.Published_Date);
                if (!isNaN(date.getTime())) {
                    if (!summary.dateRange.earliest || date < new Date(summary.dateRange.earliest)) {
                        summary.dateRange.earliest = date.toISOString().split('T')[0];
                    }
                    if (!summary.dateRange.latest || date > new Date(summary.dateRange.latest)) {
                        summary.dateRange.latest = date.toISOString().split('T')[0];
                    }
                }
            }

            // 缺失字段统计
            if (!item.Authors || item.Authors.trim() === '') {
                summary.hasMissingFields.authors++;
            }
            if (!item.Abstract || item.Abstract.trim() === '') {
                summary.hasMissingFields.abstract++;
            }
            if (!item.Abstract_URL || item.Abstract_URL.trim() === '') {
                summary.hasMissingFields.url++;
            }
        });

        return summary;
    }

    /**
     * 导出处理结果报告
     * @param {Object} results - 处理结果
     * @param {string} outputPath - 输出路径
     * @param {Object} logger - 日志记录器
     */
    async exportReport(results, outputPath, logger) {
        try {
            const report = {
                processedAt: new Date().toISOString(),
                summary: {
                    total: results.total || 0,
                    successful: results.successful || 0,
                    failed: results.failed || 0,
                    skipped: results.skipped || 0
                },
                details: {
                    successful: results.successfulItems || [],
                    failed: results.failedItems || [],
                    skipped: results.skippedItems || []
                },
                errors: results.errors || []
            };

            const fs = require('fs');
            fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

            logger.info(`处理报告已导出到: ${outputPath}`);
        } catch (error) {
            logger.error(`导出报告失败: ${error.message}`);
        }
    }
}

module.exports = ExcelParser;