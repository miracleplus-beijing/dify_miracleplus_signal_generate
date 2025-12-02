// DOM 元素
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');
const progressMessage = document.getElementById('progressMessage');
const logsContent = document.getElementById('logsContent');
const resultSection = document.getElementById('resultSection');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');

// 按钮
const clearLogsBtn = document.getElementById('clearLogsBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const retryBtn = document.getElementById('retryBtn');
const openFolderBtn = document.getElementById('openFolderBtn');

// 播客相关元素
const podcastList = document.getElementById('podcastList');
const refreshPodcastsBtn = document.getElementById('refreshPodcastsBtn');

// 播客稿查看模态框元素
const scriptModal = document.getElementById('scriptModal');
const scriptTitle = document.getElementById('scriptTitle');
const scriptContent = document.getElementById('scriptContent');
const scriptId = document.getElementById('scriptId');
const scriptType = document.getElementById('scriptType');
const copyScriptBtn = document.getElementById('copyScriptBtn');
const playAudioBtn = document.getElementById('playAudioBtn');
const closeScriptBtn = document.getElementById('closeScriptBtn');
const closeScriptFooterBtn = document.getElementById('closeScriptFooterBtn');

// 设置相关元素
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const workflowSelect = document.getElementById('workflowSelect');
const channelSelect = document.getElementById('channelSelect');
const processingModeSelect = document.getElementById('processingModeSelect');
const useDefaultPath = document.getElementById('useDefaultPath');
const customPathGroup = document.getElementById('customPathGroup');
const customPathInput = document.getElementById('customPathInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const cancelBtn = document.getElementById('cancelBtn');

// 新增：输入模式相关元素
const modeTabs = document.querySelectorAll('.mode-tab');
const excelSection = document.getElementById('excelSection');
const urlSection = document.getElementById('urlSection');
const articleSection = document.getElementById('articleSection');
const modeDescription = document.getElementById('modeDescription');

const urlInput = document.getElementById('urlInput');
const urlCount = document.getElementById('urlCount');
const submitUrlBtn = document.getElementById('submitUrlBtn');

const articleInput = document.getElementById('articleInput');
const charCount = document.getElementById('charCount');
const submitArticleBtn = document.getElementById('submitArticleBtn');

// 全局变量
let selectedFile = null;
let resultFilename = null;
let currentWorkflow = 'PODCAST'; // 默认 workflow
let currentProcessingMode = 'batch'; // 默认批量模式
let availableWorkflows = [];
let abortController = null; // 用于取消请求
let currentInputMode = 'excel'; // 当前输入模式: 'excel' | 'url' | 'article'
let outputDirectory = null; // 输出目录路径

// 标题映射
const WORKFLOW_TITLES = {
    'PODCAST': {
        title: '🎙️ Podcast Script Generator',
        subtitle: '拖拽 Excel 文件生成播客脚本'
    },
    'CHEESE_DAILY': {
        title: '🧀 Cheese Daily',
        subtitle: '拖拽 Excel 文件生成每日内容'
    }
};

// ==================== 播客播放器类 ====================

class PodcastPlayer {
    constructor() {
        this.currentAudio = null;
        this.currentPodcast = null;
        this.isPlaying = false;
    }

    /**
     * 播放/暂停播客
     * @param {Object} podcast - 播客对象
     * @param {HTMLElement} playButton - 播放按钮元素
     * @param {HTMLElement} progressBar - 进度条元素
     * @param {HTMLElement} progressTime - 时间显示元素
     */
    async togglePlay(podcast, playButton, progressBar, progressTime) {
        // 如果点击的是当前正在播放的播客
        if (this.currentPodcast && this.currentPodcast.arxivId === podcast.arxivId) {
            if (this.isPlaying) {
                this.pause();
                playButton.innerHTML = this.getPlayIcon();
                playButton.classList.remove('playing');
            } else {
                await this.play();
                playButton.innerHTML = this.getPauseIcon();
                playButton.classList.add('playing');
            }
            return;
        }

        // 如果有其他播客在播放，先停止
        if (this.currentAudio) {
            this.stop();
        }

        // 开始播放新的播客
        this.currentPodcast = podcast;

        // 确保音频URL正确编码
        let audioUrl = podcast.audioUrl;
        if (audioUrl && !audioUrl.includes('/api/audio/')) {
            // 如果不是API路径，直接使用
            this.currentAudio = new Audio(audioUrl);
        } else {
            // API路径需要确保文件名正确编码
            const urlParts = audioUrl.split('/api/audio/');
            if (urlParts.length === 2) {
                const filename = urlParts[1];
                const encodedFilename = encodeURIComponent(filename);
                audioUrl = `/api/audio/${encodedFilename}`;
                console.log('编码音频URL:', audioUrl);
            }
            this.currentAudio = new Audio(audioUrl);
        }

        this.setupAudioEvents(playButton, progressBar, progressTime);
        await this.play();

        playButton.innerHTML = this.getPauseIcon();
        playButton.classList.add('playing');
    }

    /**
     * 播放音频
     */
    async play() {
        if (!this.currentAudio) return;

        try {
            await this.currentAudio.play();
            this.isPlaying = true;
        } catch (error) {
            console.error('播放失败:', error);
            console.error('音频URL:', this.currentPodcast?.audioUrl);
            console.error('音频元素状态:', {
                src: this.currentAudio.src,
                readyState: this.currentAudio.readyState,
                networkState: this.currentAudio.networkState,
                error: this.currentAudio.error
            });

            // 提供更详细的错误信息
            let errorMessage = error.message;
            if (this.currentAudio.error) {
                switch (this.currentAudio.error.code) {
                    case this.currentAudio.error.MEDIA_ERR_ABORTED:
                        errorMessage = '音频加载被中断';
                        break;
                    case this.currentAudio.error.MEDIA_ERR_NETWORK:
                        errorMessage = '网络错误，无法加载音频文件';
                        break;
                    case this.currentAudio.error.MEDIA_ERR_DECODE:
                        errorMessage = '音频文件解码失败';
                        break;
                    case this.currentAudio.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorMessage = '不支持的音频格式或文件不存在';
                        break;
                    default:
                        errorMessage = `音频播放错误 (${this.currentAudio.error.code}): ${this.currentAudio.error.message}`;
                }
            }

            showToast('播放失败: ' + errorMessage, 'error');
        }
    }

    /**
     * 暂停音频
     */
    pause() {
        if (!this.currentAudio) return;

        this.currentAudio.pause();
        this.isPlaying = false;
    }

    /**
     * 停止音频并重置
     */
    stop() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }

        this.currentPodcast = null;
        this.isPlaying = false;

        // 重置所有按钮状态
        document.querySelectorAll('.podcast-btn.play-btn').forEach(btn => {
            btn.innerHTML = this.getPlayIcon();
            btn.classList.remove('playing');
        });

        // 重置所有进度条
        document.querySelectorAll('.podcast-progress-time').forEach(time => {
            time.textContent = '0:00'; 
        });

        // 重置所有时间显示
        document.querySelectorAll('.podcast-progress-time').forEach(time => {
            time.textContent = '0:00 / 0:00';
        });

        // 移除所有卡片的播放状态
        document.querySelectorAll('.podcast-card').forEach(card => {
            card.classList.remove('playing');
        });
    }

    /**
     * 设置音频事件监听器
     */
    setupAudioEvents(playButton, progressBar, progressTime) {
        // 加载开始事件
        this.currentAudio.addEventListener('loadstart', () => {
            console.log('开始加载音频:', this.currentPodcast?.audioUrl);
        });

        // 可以播放事件
        this.currentAudio.addEventListener('canplay', () => {
            console.log('音频可以播放');
        });

        // 加载完成事件
        this.currentAudio.addEventListener('loadeddata', () => {
            console.log('音频数据加载完成，时长:', this.currentAudio.duration);
        });

        // 更新进度条
        this.currentAudio.addEventListener('timeupdate', () => {
            if (this.currentAudio.duration) {
                const progress = (this.currentAudio.currentTime / this.currentAudio.duration) * 100;
                progressBar.style.width = progress + '%';
                progressTime.textContent = `${this.formatTime(this.currentAudio.currentTime)} / ${this.formatTime(this.currentAudio.duration)}`;
            }
        });

        // 播放结束
        this.currentAudio.addEventListener('ended', () => {
            this.stop();
        });

        // 错误处理 - 增强版
        this.currentAudio.addEventListener('error', (e) => {
            console.error('音频元素错误事件:', e);
            console.error('音频错误详情:', this.currentAudio.error);
            console.error('音频URL:', this.currentPodcast?.audioUrl);

            let errorMessage = '音频播放失败';
            if (this.currentAudio.error) {
                switch (this.currentAudio.error.code) {
                    case this.currentAudio.error.MEDIA_ERR_ABORTED:
                        errorMessage = '音频加载被中断';
                        break;
                    case this.currentAudio.error.MEDIA_ERR_NETWORK:
                        errorMessage = '网络错误，无法加载音频文件';
                        break;
                    case this.currentAudio.error.MEDIA_ERR_DECODE:
                        errorMessage = '音频文件解码失败';
                        break;
                    case this.currentAudio.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorMessage = '不支持的音频格式或文件不存在';
                        break;
                    default:
                        errorMessage = `音频错误 (${this.currentAudio.error.code}): ${this.currentAudio.error.message}`;
                }
            }

            showToast(errorMessage, 'error');
            this.stop();
        });
    }

    /**
     * 格式化时间
     * @param {number} seconds - 秒数
     * @returns {string} 格式化后的时间
     */
    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * 获取播放图标
     */
    getPlayIcon() {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>`;
    }

    /**
     * 获取暂停图标
     */
    getPauseIcon() {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
        </svg>`;
    }

    /**
     * 下载播客
     * @param {Object} podcast - 播客对象
     */
    download(podcast) {
        const link = document.createElement('a');
        link.href = podcast.audioUrl;
        link.download = `${podcast.arxivId}.mp3`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// 创建全局播客播放器实例
const podcastPlayer = new PodcastPlayer();

// ==================== 初始化 ====================

console.log('🎙️ Podcast Script Generator 已加载');

// 加载设置
loadSettings();

// 加载可用 workflows
loadWorkflows();

// 检查后端健康状态
fetch('/api/health')
    .then(res => res.json())
    .then(data => {
        console.log('✅ 后端服务正常:', data);
    })
    .catch(err => {
        console.error('❌ 后端服务异常:', err);
    });

// ==================== 设置功能 ====================

// 更新页面标题
function updatePageTitle(workflowId) {
    const config = WORKFLOW_TITLES[workflowId];
    if (config) {
        document.querySelector('header h1').textContent = config.title;
        document.querySelector('header p').textContent = config.subtitle;
        document.title = config.title;
    }
}

// 加载设置
function loadSettings() {
    // 从 localStorage 加载设置
    const savedWorkflow = localStorage.getItem('selectedWorkflow');
    const savedPath = localStorage.getItem('customOutputPath');
    const useDefault = localStorage.getItem('useDefaultPath');
    const savedMode = localStorage.getItem('processingMode');

    if (savedWorkflow) {
        currentWorkflow = savedWorkflow;
    }

    if (savedPath) {
        customPathInput.value = savedPath;
    }

    // 恢复复选框状态
    if (useDefault === 'false') {
        useDefaultPath.checked = false;
        customPathGroup.classList.remove('hidden');
    }

    // 恢复处理模式
    if (savedMode) {
        currentProcessingMode = savedMode;
        if (processingModeSelect) {
            processingModeSelect.value = savedMode;
        }
    }

    // 更新页面标题
    updatePageTitle(currentWorkflow);
}

// 加载可用 workflows
async function loadWorkflows() {
    try {
        const response = await fetch('/api/workflows');
        const data = await response.json();
        availableWorkflows = data.workflows;

        // 填充下拉框
        workflowSelect.innerHTML = '';
        availableWorkflows.forEach(wf => {
            const option = document.createElement('option');
            option.value = wf.id;
            option.textContent = wf.name;
            if (wf.id === currentWorkflow) {
                option.selected = true;
            }
            workflowSelect.appendChild(option);
        });

    } catch (error) {
        console.error('加载 workflows 失败:', error);
        workflowSelect.innerHTML = '<option value="">加载失败</option>';
    }
}

// 打开设置面板
settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
});

// 关闭设置面板
closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

// 点击模态框背景关闭
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.add('hidden');
    }
});

// 监听 workflow 选择变化，更新标题
workflowSelect.addEventListener('change', (e) => {
    updatePageTitle(e.target.value);
});

// 监听默认路径复选框
useDefaultPath.addEventListener('change', (e) => {
    if (e.target.checked) {
        customPathGroup.classList.add('hidden');
        customPathInput.value = '';
    } else {
        customPathGroup.classList.remove('hidden');
    }
});

// 保存设置
saveSettingsBtn.addEventListener('click', async () => {
    const selectedWorkflow = workflowSelect.value;
    const customPath = customPathInput.value.trim();
    const isDefaultPath = useDefaultPath.checked;
    const selectedMode = processingModeSelect.value;

    // 保存到 localStorage
    localStorage.setItem('selectedWorkflow', selectedWorkflow);
    localStorage.setItem('customOutputPath', customPath);
    localStorage.setItem('useDefaultPath', isDefaultPath);
    localStorage.setItem('processingMode', selectedMode);

    currentWorkflow = selectedWorkflow;
    currentProcessingMode = selectedMode;

    // 如果有自定义路径且未使用默认路径，发送到后端
    if (customPath && !isDefaultPath) {
        try {
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customOutputDir: customPath })
            });
        } catch (error) {
            console.error('保存设置到后端失败:', error);
        }
    }

    showToast('✓ 设置已保存', 'success');
    settingsModal.classList.add('hidden');
});

// ==================== 输入模式切换 ====================

const MODE_DESCRIPTIONS = {
    excel: '拖拽Excel文件生成播客脚本（完整流程：脚本 + 音频 + 数据库）',
    url: '输入文章URL生成播客脚本（生成脚本 + 音频，暂不上传数据库）',
    article: '直接粘贴文章内容生成播客脚本（生成脚本 + 音频，暂不上传数据库）'
};

// Tab点击事件
modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const mode = tab.dataset.mode;
        switchInputMode(mode);
    });
});

function switchInputMode(mode) {
    currentInputMode = mode;

    // 更新Tab样式
    modeTabs.forEach(tab => {
        if (tab.dataset.mode === mode) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // 切换显示区域
    excelSection.classList.toggle('hidden', mode !== 'excel');
    urlSection.classList.toggle('hidden', mode !== 'url');
    articleSection.classList.toggle('hidden', mode !== 'article');

    // 更新描述
    modeDescription.textContent = MODE_DESCRIPTIONS[mode];

    // 重置界面
    resetUI();
}

// URL输入统计
urlInput.addEventListener('input', () => {
    const urls = parseUrls(urlInput.value);
    urlCount.textContent = `${urls.length} 个URL`;
    submitUrlBtn.disabled = urls.length === 0;
});

// 文本输入统计
articleInput.addEventListener('input', () => {
    const length = articleInput.value.length;
    const maxLength = 100000;
    charCount.textContent = `${length.toLocaleString()} / ${maxLength.toLocaleString()} 字符`;

    if (length > maxLength) {
        charCount.style.color = 'var(--error-color)';
        submitArticleBtn.disabled = true;
    } else {
        charCount.style.color = 'var(--text-secondary)';
        submitArticleBtn.disabled = length === 0;
    }
});

// 解析URL列表
function parseUrls(text) {
    return text.split('\n')
        .map(line => line.trim())
        .filter(line => line && (line.startsWith('http://') || line.startsWith('https://')));
}

// URL提交按钮
submitUrlBtn.addEventListener('click', () => {
    const urls = parseUrls(urlInput.value);
    if (urls.length === 0) {
        showError('请输入至少一个有效的URL');
        return;
    }
    executeWorkflowWithUrls(urls);
});

// 文本提交按钮
submitArticleBtn.addEventListener('click', () => {
    const article = articleInput.value.trim();
    if (!article) {
        showError('请输入文章内容');
        return;
    }
    if (article.length > 100000) {
        showError('文章内容超过100,000字符限制');
        return;
    }
    executeWorkflowWithArticle(article);
});

// ==================== 文件上传处理 ====================

// 点击上传区域触发文件选择
dropZone.addEventListener('click', () => {
    fileInput.click();
});

// 阻止默认拖拽行为
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

// 拖拽高亮效果
['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
        dropZone.classList.add('dragover');
    }, false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
        dropZone.classList.remove('dragover');
    }, false);
});

// 处理文件拖拽
dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFileSelect(files[0]);
    }
});

// 处理文件选择
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
    }
});

// 处理选中的文件
function handleFileSelect(file) {
    // 验证文件格式
    if (!file.name.endsWith('.xlsx')) {
        showError('只支持 .xlsx 格式的 Excel 文件');
        return;
    }

    selectedFile = file;

    // 显示文件信息
    const fileName = fileInfo.querySelector('.file-name');
    const fileSize = fileInfo.querySelector('.file-size');

    fileName.textContent = `📄 ${file.name}`;
    fileSize.textContent = `大小: ${(file.size / 1024).toFixed(2)} KB`;

    fileInfo.classList.remove('hidden');

    // 自动开始执行
    setTimeout(() => {
        executeWorkflow();
    }, 500);
}

// ==================== 执行 Workflow ====================

async function executeWorkflow() {
    if (!selectedFile) {
        showError('请先选择文件');
        return;
    }

    // 重置界面
    resetUI();

    // 显示进度区域
    progressSection.classList.remove('hidden');

    // 创建 AbortController
    abortController = new AbortController();

    // 创建 FormData
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('workflow', currentWorkflow); // 添加 workflow 参数
    formData.append('channelId', channelSelect.value); // 添加频道ID参数
    formData.append('processingMode', currentProcessingMode); // 添加处理模式参数

    try {
        // 发起请求 (SSE)
        const response = await fetch('/api/execute', {
            method: 'POST',
            body: formData,
            signal: abortController.signal // 添加取消信号
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // 处理 SSE 流
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // 处理完整的事件
            const events = buffer.split('\n\n');
            buffer = events.pop(); // 保留不完整的事件

            for (const eventStr of events) {
                if (!eventStr.trim()) continue;

                try {
                    // 解析 SSE 事件
                    const lines = eventStr.split('\n');
                    let eventType = 'message';
                    let eventData = '';

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            eventType = line.substring(7).trim();
                        } else if (line.startsWith('data: ')) {
                            eventData = line.substring(6).trim();
                        }
                    }

                    if (eventData) {
                        const data = JSON.parse(eventData);
                        handleSSEEvent(eventType, data);
                    }
                } catch (e) {
                    console.error('解析事件失败:', e, eventStr);
                }
            }
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            addLog('⚠️ 用户取消执行', 'error');
            showError('执行已取消');
        } else {
            console.error('执行失败:', error);
            showError(`执行失败: ${error.message}`);
        }
    } finally {
        abortController = null;
    }
}

// URL模式执行
async function executeWorkflowWithUrls(urls) {
    resetUI();
    progressSection.classList.remove('hidden');
    abortController = new AbortController();

    const formData = new FormData();
    formData.append('inputType', 'url');
    formData.append('urls', urls.join('\n'));
    formData.append('workflow', currentWorkflow);
    formData.append('channelId', channelSelect.value);
    formData.append('processingMode', currentProcessingMode);

    try {
        const response = await fetch('/api/execute', {
            method: 'POST',
            body: formData,
            signal: abortController.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // 处理SSE流
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop();

            for (const eventStr of events) {
                if (!eventStr.trim()) continue;

                try {
                    const lines = eventStr.split('\n');
                    let eventType = 'message';
                    let eventData = '';

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            eventType = line.substring(7).trim();
                        } else if (line.startsWith('data: ')) {
                            eventData = line.substring(6).trim();
                        }
                    }

                    if (eventData) {
                        const data = JSON.parse(eventData);
                        handleSSEEvent(eventType, data);
                    }
                } catch (e) {
                    console.error('解析事件失败:', e, eventStr);
                }
            }
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            addLog('⚠️ 用户取消执行', 'error');
            showError('执行已取消');
        } else {
            console.error('执行失败:', error);
            showError(`执行失败: ${error.message}`);
        }
    } finally {
        abortController = null;
    }
}

// 文本模式执行
async function executeWorkflowWithArticle(article) {
    resetUI();
    progressSection.classList.remove('hidden');
    abortController = new AbortController();

    const formData = new FormData();
    formData.append('inputType', 'article');
    formData.append('article', article);
    formData.append('workflow', currentWorkflow);
    formData.append('channelId', channelSelect.value);
    formData.append('processingMode', currentProcessingMode);

    try {
        const response = await fetch('/api/execute', {
            method: 'POST',
            body: formData,
            signal: abortController.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // 处理SSE流
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop();

            for (const eventStr of events) {
                if (!eventStr.trim()) continue;

                try {
                    const lines = eventStr.split('\n');
                    let eventType = 'message';
                    let eventData = '';

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            eventType = line.substring(7).trim();
                        } else if (line.startsWith('data: ')) {
                            eventData = line.substring(6).trim();
                        }
                    }

                    if (eventData) {
                        const data = JSON.parse(eventData);
                        handleSSEEvent(eventType, data);
                    }
                } catch (e) {
                    console.error('解析事件失败:', e, eventStr);
                }
            }
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            addLog('⚠️ 用户取消执行', 'error');
            showError('执行已取消');
        } else {
            console.error('执行失败:', error);
            showError(`执行失败: ${error.message}`);
        }
    } finally {
        abortController = null;
    }
}

// ==================== SSE 事件处理 ====================

function handleSSEEvent(eventType, data) {
    console.log('SSE Event:', eventType, data);

    switch (eventType) {
        case 'progress':
            handleProgress(data);
            break;

        case 'success':
            handleSuccess(data);
            break;

        case 'error':
            handleError(data);
            break;

        default:
            console.log('未知事件类型:', eventType, data);
    }
}

// 处理进度更新
function handleProgress(data) {
    const { status, message, progress } = data;

    // 更新进度条
    if (progress !== undefined) {
        updateProgress(progress);
    }

    // 更新状态消息
    if (message) {
        progressMessage.textContent = message;
        addLog(message, 'info');
    }

    // 特殊状态处理
    if (status === 'parsing_excel') {
        addLog('📊 正在解析Excel文件内容...', 'info');
    } else if (status === 'enriching_data') {
        addLog('🔍 正在从arXiv补全论文数据...', 'info');
    } else if (status === 'validating_data') {
        addLog('✅ 正在验证数据完整性...', 'info');
        // 显示arXiv补全统计
        if (data.enrich_stats) {
            const { enriched, skipped, failed, total } = data.enrich_stats;
            if (total > 0) {
                if (enriched > 0) {
                    addLog(`📝 arXiv数据补全: 成功 ${enriched} 条, 跳过 ${skipped} 条, 失败 ${failed} 条`, 'success');
                } else if (skipped === total) {
                    addLog(`ℹ️ 所有数据已完整，无需补全（共 ${total} 条）`, 'info');
                } else if (failed > 0) {
                    addLog(`⚠️ arXiv数据补全: 失败 ${failed} 条, 跳过 ${skipped} 条`, 'warning');
                }
            }
        }
    } else if (status === 'extracting_arxiv') {
        addLog('🔗 正在提取arXiv链接...', 'info');
    } else if (status === 'dify_batch_processing') {
        addLog('📦 使用批量模式调用Dify...', 'info');
    } else if (status === 'dify_sequential_processing') {
        addLog('📝 使用串行模式调用Dify...', 'info');
    } else if (status === 'dify_batch_start') {
        addLog(`🚀 ${message}`, 'info');
    } else if (status === 'processing_arxiv') {
        addLog(`📄 ${message}`, 'info');
    } else if (status === 'dify_processing') {
        addLog(`🤖 ${message}`, 'info');
    } else if (status === 'saving_scripts') {
        addLog('💾 正在保存播客脚本...', 'info');
    } else if (status === 'tts_start') {
        addLog('🎙️ 开始生成音频...', 'info');
    } else if (status === 'uploading_to_supabase') {
        addLog('🗄️ 正在上传完整数据到数据库...', 'info');
    } else if (status === 'supabase_uploaded') {
        if (data.supabase_results) {
            const { success, failed, skipped } = data.supabase_results;

            // 根据不同情况显示不同的提示信息
            if (skipped > 0 && success === 0 && failed === 0) {
                // 所有数据都被跳过的情况
                addLog(`ℹ️ 所有数据均已存在于数据库中，无需重复上传（跳过 ${skipped} 条）`, 'info');
            } else if (success > 0 && failed === 0) {
                // 全部成功的情况
                addLog(`🎉 Supabase数据库上传完成！成功: ${success} 条, 失败: ${failed} 条`, 'success');
            } else if (failed > 0) {
                // 有失败的情况
                addLog(`⚠️ Supabase数据库上传完成！成功: ${success} 条, 失败: ${failed} 条`, 'warning');
            } else {
                // 其他情况
                addLog(`📊 Supabase数据库上传完成！成功: ${success} 条, 失败: ${failed} 条`, 'info');
            }
        }
    } else if (status === 'getting_channel_config') {
        addLog('⚙️ 正在获取频道配置...', 'info');
    } else if (status === 'tts_started') {
        addLog('🎙️ 开始生成播客音频...', 'info');
    } else if (status === 'tts_generating') {
        addLog(`🔊 ${message}`, 'info');
    } else if (status === 'tts_completed') {
        addLog('✅ 音频生成完成!', 'success');
    } else if (status === 'audio_uploading') {
        addLog(`📤 ${message}`, 'info');
    } else if (status === 'db_updating') {
        addLog(`💾 ${message}`, 'info');
    } else if (status === 'audio_upload_completed') {
        addLog('🎉 音频上传和数据库更新完成!', 'success');
        if (data.upload_results) {
            const uploadStats = data.upload_results;
            addLog(`📊 上传统计: 成功 ${uploadStats.success || 0} 个, 失败 ${uploadStats.failed || 0} 个`, 'success');
        }
        // 自动刷新播客列表
        refreshPodcastListAfterGeneration();
    } else if (status === 'processing_single_item') {
        const current = data.current || 0;
        const total = data.total || 0;
        addLog(`📝 [${current}/${total}] ${message}`, 'info');
    } else if (status === 'single_item_success') {
        const current = data.current || 0;
        const total = data.total || 0;
        addLog(`✅ [${current}/${total}] ${message}`, 'success');
    } else if (status === 'single_item_failed') {
        const current = data.current || 0;
        const total = data.total || 0;
        const retryInfo = data.retry_count ? ` (重试${data.retry_count}/${data.max_retries})` : '';
        addLog(`❌ [${current}/${total}] ${message}${retryInfo}`, 'error');
    } else if (status === 'single_item_retrying') {
        const current = data.current || 0;
        const total = data.total || 0;
        addLog(`🔄 [${current}/${total}] 正在重试...`, 'info');
    } else if (status === 'sequential_mode_start') {
        addLog('🔄 单条模式已启动，将逐个处理并实时上传...', 'info');
    }
}

// 处理成功
function handleSuccess(data) {
    const { result_file, processing_stats, supabase_results, skip_supabase, output_dir } = data;

    resultFilename = result_file;
    outputDirectory = output_dir; // 保存输出目录

    // 显示处理统计
    if (processing_stats) {
        const { total, success, failed } = processing_stats;
        if (failed > 0) {
            addLog(`⚠️ 处理统计: 总计 ${total} 篇, 成功 ${success} 篇, 失败 ${failed} 篇`, 'warning');
        } else {
            addLog(`✅ 处理统计: 总计 ${total} 篇, 全部成功`, 'success');
        }
    }

    // 如果跳过Supabase上传（URL/文本模式）
    if (skip_supabase) {
        addLog('ℹ️ 本次执行未上传到数据库（URL/文本模式）', 'info');
        document.getElementById('supabaseResultRow').style.display = 'none';
    } else if (supabase_results) {
        // 如果有Supabase结果，显示相关信息
        const { success, failed, errors, skipped } = supabase_results;

        // 根据不同情况显示不同的提示信息
        if (skipped > 0 && success === 0 && failed === 0) {
            // 所有数据都被跳过的情况
            addLog(`ℹ️ 数据库状态: 跳过 ${skipped} 条记录（已存在）`, 'info');

            // 在结果区域显示数据库状态
            const supabaseResultRow = document.getElementById('supabaseResultRow');
            const supabaseResult = document.getElementById('supabaseResult');
            if (supabaseResultRow && supabaseResult) {
                supabaseResultRow.style.display = 'block';
                supabaseResult.textContent = `跳过 ${skipped} 条记录（数据已存在）`;
                supabaseResult.style.color = '#666';
            }
        } else if (success > 0 && failed === 0) {
            // 全部成功的情况
            addLog(`📊 Supabase数据库: 成功 ${success} 条, 失败 ${failed} 条`, 'success');

            // 在结果区域显示数据库状态
            const supabaseResultRow = document.getElementById('supabaseResultRow');
            const supabaseResult = document.getElementById('supabaseResult');
            if (supabaseResultRow && supabaseResult) {
                supabaseResultRow.style.display = 'block';
                supabaseResult.textContent = `成功上传 ${success} 条记录`;
                supabaseResult.style.color = '#28a745';
            }
        } else if (failed > 0) {
            // 有失败的情况
            addLog(`📊 Supabase数据库: 成功 ${success} 条, 失败 ${failed} 条`, 'warning');

            // 在结果区域显示数据库状态
            const supabaseResultRow = document.getElementById('supabaseResultRow');
            const supabaseResult = document.getElementById('supabaseResult');
            if (supabaseResultRow && supabaseResult) {
                supabaseResultRow.style.display = 'block';
                supabaseResult.textContent = `成功 ${success} 条, 失败 ${failed} 条`;
                supabaseResult.style.color = '#dc3545';
            }
        } else {
            // 其他情况
            addLog(`📊 Supabase数据库: 成功 ${success} 条, 失败 ${failed} 条`, 'info');
        }

        if (errors && errors.length > 0) {
            addLog(`⚠️ 数据库上传错误: ${errors.length} 条记录`, 'warning');
            errors.forEach(error => {
                addLog(`  - 第${error.row}行 (${error.title}): ${error.error}`, 'warning');
            });
        }
    }

    // 更新进度
    updateProgress(100);
    addLog('✅ 执行成功!', 'success');

    // 隐藏进度区域
    setTimeout(() => {
        progressSection.classList.add('hidden');

        // 显示结果区域
        if (no_download) {
            // 不需要下载文件的情况
            document.getElementById('resultFileRow').style.display = 'none';
            document.getElementById('downloadBtn').style.display = 'none';
        } else {
            document.getElementById('resultFileRow').style.display = 'block';
            document.getElementById('downloadBtn').style.display = 'flex';
            document.getElementById('resultFilename').textContent = result_file;
        }

        document.getElementById('elapsedTime').textContent = elapsed_time?.toFixed(2) || 'N/A';
        document.getElementById('totalTokens').textContent = total_tokens || 'N/A';
        resultSection.classList.remove('hidden');
    }, 1000);
}

// 处理错误
function handleError(data) {
    const { message } = data;
    showError(message || '未知错误');
}

// ==================== UI 更新函数 ====================

function updateProgress(percent) {
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
}

function addLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${timestamp}] ${message}`;

    logsContent.appendChild(logEntry);

    // 自动滚动到底部
    logsContent.scrollTop = logsContent.scrollHeight;
}

function showError(message) {
    errorMessage.textContent = message;
    progressSection.classList.add('hidden');
    resultSection.classList.add('hidden');
    errorSection.classList.remove('hidden');

    addLog(`❌ ${message}`, 'error');
}

function resetUI() {
    // 隐藏所有结果区域
    resultSection.classList.add('hidden');
    errorSection.classList.add('hidden');

    // 重置进度
    updateProgress(0);
    progressMessage.textContent = '准备中...';

    // 清空日志
    logsContent.innerHTML = '';
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;

    // 3秒后自动消失
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// ==================== 播客稿查看功能 ====================

/**
 * 显示播客稿模态框
 */
async function showScriptModal(arxivId) {
    try {
        scriptModal.classList.remove('hidden');
        scriptTitle.textContent = '加载中...';
        scriptContent.innerHTML = '<div class="loading-placeholder">正在加载稿件内容...</div>';
        scriptId.textContent = '加载中...';
        scriptType.textContent = '加载中...';

        // 获取播客稿列表
        const response = await fetch('/api/podcast/scripts');
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || '获取播客稿列表失败');
        }

        // 查找匹配的播客稿
        const script = data.scripts.find(s => s.arxiv_id === arxivId);

        if (!script) {
            scriptTitle.textContent = '未找到稿件';
            scriptContent.innerHTML = '<div class="error-placeholder">未找到对应的播客稿件，可能还未生成或已被删除</div>';
            scriptId.textContent = arxivId;
            scriptType.textContent = '未知';
            playAudioBtn.style.display = 'none';
            return;
        }

        // 显示播客稿内容
        scriptTitle.textContent = script.title;
        scriptId.textContent = script.arxiv_id;

        // 格式化来源类型
        const typeMap = {
            'excel': 'Excel文件',
            'url': 'URL链接',
            'article': '文本内容'
        };
        scriptType.textContent = typeMap[script.source_type] || '未知';

        // 格式化稿件内容，高亮[S1]等标记
        const formattedContent = formatScriptContent(script.script);
        scriptContent.innerHTML = `<div class="script-text">${formattedContent}</div>`;

        // 检查是否有对应的音频文件
        playAudioBtn.style.display = 'block';
        playAudioBtn.onclick = () => {
            scriptModal.classList.add('hidden');
            // 播放对应的音频
            const podcastCard = document.querySelector(`[data-arxiv-id="${arxivId}"] .play-btn`);
            if (podcastCard) {
                podcastCard.click();
            }
        };

        playAudioBtn.dataset.arxivId = arxivId;

    } catch (error) {
        console.error('加载播客稿失败:', error);
        scriptTitle.textContent = '加载失败';
        scriptContent.innerHTML = `<div class="error-placeholder">加载播客稿失败: ${error.message}</div>`;
        scriptId.textContent = arxivId;
        scriptType.textContent = '错误';
        playAudioBtn.style.display = 'none';
    }
}

/**
 * 格式化播客稿内容
 * @param {string} content - 原始内容
 * @returns {string} 格式化后的HTML
 */
function formatScriptContent(content) {
    if (!content) return '<div class="empty-placeholder">稿件内容为空</div>';

    // 替换换行为<br>
    let formatted = content.replace(/\n/g, '<br>');

    // 高亮说话人标记 [S1], [S2] 等
    formatted = formatted.replace(/\[S(\d+)\]/g, '<span class="speaker-tag">[S$1]</span>');

    // 高亮其他标记
    formatted = formatted.replace(/\[[^\]]+\]/g, '<span class="tag">$&</span>');

    return formatted;
}

/**
 * 关闭播客稿模态框
 */
function closeScriptModal() {
    scriptModal.classList.add('hidden');
    // 清理内容
    scriptTitle.textContent = '加载中...';
    scriptContent.innerHTML = '<div class="loading-placeholder">正在加载稿件内容...</div>';
    scriptId.textContent = '加载中...';
    scriptType.textContent = '加载中...';
    playAudioBtn.style.display = 'none';
}

/**
 * 复制播客稿内容
 */
async function copyScriptContent() {
    try {
        const textContent = scriptContent.textContent;
        if (!textContent || textContent.includes('加载中') || textContent.includes('未找到')) {
            showToast('没有可复制的稿件内容', 'error');
            return;
        }

        await navigator.clipboard.writeText(textContent);
        showToast('✅ 稿件内容已复制到剪贴板', 'success');
    } catch (error) {
        console.error('复制失败:', error);
        showToast('❌ 复制失败，请手动选择复制', 'error');
    }
}

// 绑定播客稿查看相关事件
function setupScriptModalEvents() {
    // 关闭按钮事件
    closeScriptBtn.addEventListener('click', closeScriptModal);
    closeScriptFooterBtn.addEventListener('click', closeScriptModal);

    // 点击模态框背景关闭
    scriptModal.addEventListener('click', (e) => {
        if (e.target === scriptModal) {
            closeScriptModal();
        }
    });

    // 复制按钮事件
    copyScriptBtn.addEventListener('click', copyScriptContent);

    // ESC键关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !scriptModal.classList.contains('hidden')) {
            closeScriptModal();
        }
    });
}

// ==================== 播客相关功能 ====================

/**
 * 获取播客列表
 */
async function fetchPodcasts() {
    try {
        podcastList.innerHTML = '<div class="podcast-loading">正在加载播客列表...</div>';

        const response = await fetch('/api/podcasts/latest');
        const data = await response.json();

        if (data.success && data.podcasts) {
            renderPodcastList(data.podcasts);
        } else {
            renderEmptyState();
        }
    } catch (error) {
        console.error('获取播客列表失败:', error);
        renderEmptyState();
        showToast('获取播客列表失败', 'error');
    }
}

/**
 * 渲染播客列表
 * @param {Array} podcasts - 播客数组
 */
function renderPodcastList(podcasts) {
    if (podcasts.length === 0) {
        renderEmptyState();
        return;
    }

    podcastList.innerHTML = podcasts.map(podcast => createPodcastCard(podcast)).join('');
}

/**
 * 创建播客卡片 HTML
 * @param {Object} podcast - 播客对象
 * @returns {string} HTML 字符串
 */
function createPodcastCard(podcast) {
    return `
        <div class="podcast-card" data-arxiv-id="${podcast.arxivId}">
            <div class="podcast-header-info">
                <div class="podcast-icon-wrapper">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 18V5l12-2v13"></path>
                        <circle cx="6" cy="18" r="3"></circle>
                        <circle cx="18" cy="16" r="3"></circle>
                    </svg>
                </div>
                <div class="podcast-title-info">
                    <div class="podcast-title" title="${podcast.title}">${podcast.title}</div>
                    <div class="podcast-meta">
                        <span class="podcast-arxiv-id">${podcast.arxivId}</span>
                        <span>•</span>
                        <span>${podcast.durationFormatted}</span>
                    </div>
                </div>
            </div>

            <div class="podcast-progress-container">
                <div class="podcast-progress">
                    <div class="podcast-progress-bar" style="width: 0%"></div>
                </div>
                <div class="podcast-progress-time">0:00</div>
            </div>

            <div class="podcast-footer">
                <div class="podcast-actions">
                    <button class="podcast-btn play-btn" data-podcast='${JSON.stringify(podcast)}' title="播放音频">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                        <span>播放</span>
                    </button>

                    <button class="podcast-btn script-btn" data-arxiv-id="${podcast.arxivId}" title="查看稿件">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        <span>文稿</span>
                    </button>

                    <button class="podcast-btn download-btn" data-podcast='${JSON.stringify(podcast)}' title="下载音频">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * 渲染空状态
 */
function renderEmptyState() {
    podcastList.innerHTML = `
        <div class="podcast-empty">
            <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M9 18V5l12-2v13M9 18l-7 2V7l7-2v13zm0 0l6-2"/>
                <circle cx="6" cy="18" r="2"/>
                <circle cx="18" cy="16" r="2"/>
            </svg>
            <p>暂无播客</p>
            <p class="empty-hint">上传文件生成播客后会显示在这里</p>
        </div>
    `;
}

/**
 * 设置播客卡片事件监听器
 */
function setupPodcardEventListeners() {
    // 播放按钮事件委托
    podcastList.addEventListener('click', (e) => {
        const playBtn = e.target.closest('.play-btn');
        const downloadBtn = e.target.closest('.download-btn');
        const scriptBtn = e.target.closest('.script-btn');

        if (playBtn) {
            const podcast = JSON.parse(playBtn.dataset.podcast);
            const card = playBtn.closest('.podcast-card');
            const progressBar = card.querySelector('.podcast-progress-bar');
            const progressTime = card.querySelector('.podcast-progress-time');

            podcastPlayer.togglePlay(podcast, playBtn, progressBar, progressTime);

            // 更新卡片状态
            document.querySelectorAll('.podcast-card').forEach(c => c.classList.remove('playing'));
            if (podcastPlayer.isPlaying) {
                card.classList.add('playing');
            }
        }

        if (downloadBtn) {
            const podcast = JSON.parse(downloadBtn.dataset.podcast);
            podcastPlayer.download(podcast);
        }

        if (scriptBtn) {
            const arxivId = scriptBtn.dataset.arxivId;
            showScriptModal(arxivId);
        }
    });
}

// 刷新按钮事件
refreshPodcastsBtn.addEventListener('click', () => {
    fetchPodcasts();
    showToast('正在刷新播客列表', 'info');
});

// 音频生成完成后自动刷新播客列表
function refreshPodcastListAfterGeneration() {
    setTimeout(() => {
        fetchPodcasts();
        addLog('🎧 正在刷新播客列表...', 'info');
    }, 2000); // 等待2秒确保文件已保存
}

// ==================== 按钮事件 ====================

// 清空日志
clearLogsBtn.addEventListener('click', () => {
    logsContent.innerHTML = '';
});

// 下载结果
downloadBtn.addEventListener('click', () => {
    if (resultFilename) {
        window.location.href = `/api/download/${resultFilename}`;
        addLog(`📥 开始下载: ${resultFilename}`, 'info');
    }
});

// 打开文件夹
openFolderBtn.addEventListener('click', async () => {
    if (!outputDirectory) {
        showToast('无法获取输出目录', 'error');
        return;
    }

    try {
        const response = await fetch('/api/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: outputDirectory })
        });

        const data = await response.json();

        if (data.success) {
            showToast('文件夹已打开', 'success');
            addLog(`📂 打开文件夹: ${outputDirectory}`, 'info');
        } else {
            showToast('打开文件夹失败', 'error');
        }
    } catch (error) {
        console.error('打开文件夹失败:', error);
        showToast('打开文件夹失败', 'error');
    }
});

// 重置/重新上传
resetBtn.addEventListener('click', () => {
    location.reload();
});

// 重试
retryBtn.addEventListener('click', () => {
    if (selectedFile) {
        executeWorkflow();
    } else {
        location.reload();
    }
});

// 取消执行
cancelBtn.addEventListener('click', () => {
    if (abortController) {
        abortController.abort();
        addLog('正在取消执行...', 'info');
    }
});

// ==================== 初始化 ====================

console.log('🎙️ Podcast Script Generator 已加载');

// 初始化播客功能
setupPodcardEventListeners();
setupScriptModalEvents(); // 初始化播客稿查看功能
fetchPodcasts(); // 页面加载时获取播客列表

// 检查后端健康状态
fetch('/api/health')
    .then(res => res.json())
    .then(data => {
        console.log('✅ 后端服务正常:', data);
    })
    .catch(err => {
        console.error('❌ 后端服务异常:', err);
    });