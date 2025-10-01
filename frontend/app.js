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

// 设置相关元素
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const workflowSelect = document.getElementById('workflowSelect');
const useDefaultPath = document.getElementById('useDefaultPath');
const customPathGroup = document.getElementById('customPathGroup');
const customPathInput = document.getElementById('customPathInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const cancelBtn = document.getElementById('cancelBtn');

// 全局变量
let selectedFile = null;
let resultFilename = null;
let currentWorkflow = 'PODCAST'; // 默认 workflow
let availableWorkflows = [];
let abortController = null; // 用于取消请求

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

    // 保存到 localStorage
    localStorage.setItem('selectedWorkflow', selectedWorkflow);
    localStorage.setItem('customOutputPath', customPath);
    localStorage.setItem('useDefaultPath', isDefaultPath);

    currentWorkflow = selectedWorkflow;

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
}

// 处理成功
function handleSuccess(data) {
    const { result_file, elapsed_time, total_tokens, no_download } = data;

    resultFilename = result_file;

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

// 检查后端健康状态
fetch('/api/health')
    .then(res => res.json())
    .then(data => {
        console.log('✅ 后端服务正常:', data);
    })
    .catch(err => {
        console.error('❌ 后端服务异常:', err);
    });