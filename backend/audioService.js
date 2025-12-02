const fs = require('fs');
const path = require('path');
const { parseFile } = require('music-metadata');
const config = require('./config');

class AudioService {
    constructor() {
        this.outputBaseDir = config.OUTPUT_BASE_DIR;
    }

    /**
     * 获取最新日期目录
     * @returns {string|null} 最新日期目录的完整路径，如果不存在返回 null
     */
    getLatestDateDir() {
        try {
            const baseDir = this.outputBaseDir;
            if (!fs.existsSync(baseDir)) {
                return null;
            }

            // 遍历年份目录
            const years = fs.readdirSync(baseDir)
                .filter(name => /^\d{4}$/.test(name))
                .sort((a, b) => b.localeCompare(a)); // 降序排列

            if (years.length === 0) return null;

            // 遍历月份目录
            let latestPath = null;
            for (const year of years) {
                const yearPath = path.join(baseDir, year);
                const months = fs.readdirSync(yearPath)
                    .filter(name => /^\d{2}$/.test(name))
                    .sort((a, b) => b.localeCompare(a));

                if (months.length === 0) continue;

                // 遍历日期目录
                for (const month of months) {
                    const monthPath = path.join(yearPath, month);
                    const days = fs.readdirSync(monthPath)
                        .filter(name => /^\d{2}$/.test(name))
                        .sort((a, b) => b.localeCompare(a));

                    if (days.length === 0) continue;

                    // 找到最新日期目录
                    const latestDay = days[0];
                    latestPath = path.join(monthPath, latestDay);
                    return latestPath;
                }
            }

            return latestPath;
        } catch (error) {
            console.error('获取最新日期目录失败:', error);
            return null;
        }
    }

    /**
     * 读取 JSON 文件
     * @param {string} filePath - JSON 文件路径
     * @returns {object|null} 解析后的 JSON 对象，失败返回 null
     */
    readJsonFile(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error(`读取 JSON 文件失败 ${filePath}:`, error);
            return null;
        }
    }

    /**
     * 获取音频文件时长
     * @param {string} audioPath - 音频文件路径
     * @returns {Promise<number>} 音频时长（秒），失败返回 0
     */
    async getAudioDuration(audioPath) {
        try {
            const metadata = await parseFile(audioPath);
            return Math.round(metadata.format.duration || 0);
        } catch (error) {
            console.error(`获取音频时长失败 ${audioPath}:`, error);
            return 0;
        }
    }

    /**
     * 格式化时长为 mm:ss
     * @param {number} seconds - 秒数
     * @returns {string} 格式化后的时长
     */
    formatDuration(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}:${String(secs).padStart(2, '0')}`;
    }

    /**
     * 获取最新生成的播客列表
     * @returns {Promise<Array>} 播客列表数组
     */
    async getLatestPodcasts() {
        try {
            const latestDir = this.getLatestDateDir();
            if (!latestDir) {
                return [];
            }

            // 读取 podcast_titles.json
            const titlesPath = path.join(latestDir, 'podcast_titles.json');
            const titles = this.readJsonFile(titlesPath);
            if (!titles) {
                return [];
            }

            // 扫描所有 mp3 文件
            const files = fs.readdirSync(latestDir)
                .filter(file => file.endsWith('.mp3'));

            if (files.length === 0) {
                return [];
            }

            // 构建播客列表
            const podcasts = [];
            for (const file of files) {
                const arxivId = path.basename(file, '.mp3');
                const audioPath = path.join(latestDir, file);

                // 获取文件的修改时间
                const stats = fs.statSync(audioPath);
                const generatedAt = stats.mtime.toISOString();

                // 获取音频时长
                const durationSeconds = await this.getAudioDuration(audioPath);
                const durationFormatted = this.formatDuration(durationSeconds);

                // 获取标题（如果存在）
                const title = titles[arxivId] || `播客 ${arxivId}`;

                podcasts.push({
                    arxivId,
                    title,
                    audioPath,
                    audioUrl: `/api/audio/${file}`,
                    duration: durationSeconds,
                    durationFormatted,
                    generatedAt
                });
            }

            // 按生成时间降序排列（最新的在前）
            podcasts.sort((a, b) =>
                new Date(b.generatedAt) - new Date(a.generatedAt)
            );

            return podcasts;
        } catch (error) {
            console.error('获取播客列表失败:', error);
            return [];
        }
    }

    /**
     * 根据 arXiv ID 获取音频文件路径
     * @param {string} filename - 音频文件名（例如：2511.11373v1.mp3）
     * @returns {string|null} 音频文件的完整路径，如果不存在返回 null
     */
    getAudioFilePath(filename) {
        try {
            const latestDir = this.getLatestDateDir();
            if (!latestDir) {
                console.error('无法找到最新日期目录');
                return null;
            }

            // 方法1：直接查找文件名（适用于arXiv ID命名的文件）
            let audioPath = path.join(latestDir, filename);
            if (fs.existsSync(audioPath)) {
                console.log('通过直接查找找到音频文件:', audioPath);
                return audioPath;
            }

            // 方法2：从中文文件名映射（适用于早期中文标题命名的文件）
            console.log('直接查找失败，尝试从中文文件名映射...');

            // 获取所有mp3文件
            const mp3Files = fs.readdirSync(latestDir)
                .filter(file => file.endsWith('.mp3'));

            // 提取arXiv ID（去掉.mp3扩展名）
            const arxivId = path.basename(filename, '.mp3');
            console.log('查找arXiv ID:', arxivId);

            // 读取podcast_titles.json来查找对应关系
            const titlesPath = path.join(latestDir, 'podcast_titles.json');
            const titles = this.readJsonFile(titlesPath);

            if (titles && titles[arxivId]) {
                // 查找包含该标题的中文文件
                const targetTitle = titles[arxivId];
                console.log('目标标题:', targetTitle);

                for (const file of mp3Files) {
                    const baseName = path.basename(file, '.mp3');
                    // 检查是否为中文文件名（包含arXiv ID的模式则跳过）
                    if (!/^\d{4}\.\d+v\d+$/.test(baseName) && baseName.includes(targetTitle.substring(0, 10))) {
                        audioPath = path.join(latestDir, file);
                        if (fs.existsSync(audioPath)) {
                            console.log('通过标题映射找到中文音频文件:', audioPath);
                            return audioPath;
                        }
                    }
                }
            }

            // 方法3：模糊匹配（兜底方案）
            console.log('尝试模糊匹配...');
            for (const file of mp3Files) {
                const baseName = path.basename(file, '.mp3');
                if (baseName.includes(arxivId) || arxivId.includes(baseName)) {
                    audioPath = path.join(latestDir, file);
                    if (fs.existsSync(audioPath)) {
                        console.log('通过模糊匹配找到音频文件:', audioPath);
                        return audioPath;
                    }
                }
            }

            console.error('未找到音频文件:', filename, 'arXiv ID:', arxivId);
            return null;
        } catch (error) {
            console.error('获取音频文件路径失败:', error);
            return null;
        }
    }
}

module.exports = new AudioService();
