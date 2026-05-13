import { DEFAULT_CONFIG, mergeConfig } from '../shared/config.js';

const SETTINGS_KEY = 'tt_auto_screener_settings_v3';
let currentConfig = DEFAULT_CONFIG;
let configRendered = false;
let autoSaveTimer = null;

const elements = {
  searchUrl: document.getElementById('searchUrl'),
  concurrentProfiles: document.getElementById('concurrentProfiles'),
  serverBaseUrl: document.getElementById('serverBaseUrl'),
  scrollWaitMs: document.getElementById('scrollWaitMs'),
  profileWaitMs: document.getElementById('profileWaitMs'),
  profileTabActive: document.getElementById('profileTabActive'),
  audienceEnabled: document.getElementById('audienceEnabled'),
  excludeRecentHours: document.getElementById('excludeRecentHours'),
  requiredTopCountry: document.getElementById('requiredTopCountry'),
  minSampleCount: document.getElementById('minSampleCount'),
  minTopCountryPercentage: document.getElementById('minTopCountryPercentage'),
  sampleVideoCount: document.getElementById('sampleVideoCount'),
  commentsPerVideo: document.getElementById('commentsPerVideo'),
  levels: document.getElementById('levels'),
  resetConfigBtn: document.getElementById('resetConfigBtn'),
  primaryActionBtn: document.getElementById('primaryActionBtn'),
  resetBtn: document.getElementById('resetBtn'),
  running: document.getElementById('running'),
  discovered: document.getElementById('discovered'),
  queued: document.getElementById('queued'),
  processed: document.getElementById('processed'),
  qualified: document.getElementById('qualified'),
  checkpointStatus: document.getElementById('checkpointStatus'),
  rowCount: document.getElementById('rowCount'),
  lastSavedAt: document.getElementById('lastSavedAt'),
  serverStatus: document.getElementById('serverStatus'),
  checkpointSource: document.getElementById('checkpointSource'),
  workbookPath: document.getElementById('workbookPath'),
  logs: document.getElementById('logs'),
};

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, payload });
}

function assertOk(response, action) {
  if (response?.ok) return response;
  throw new Error(response?.error || `${action}失败`);
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

async function loadStoredConfig(fallbackConfig = DEFAULT_CONFIG) {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  currentConfig = mergeConfig(DEFAULT_CONFIG, stored[SETTINGS_KEY] || fallbackConfig || {});
  return currentConfig;
}

async function saveStoredConfig(config) {
  currentConfig = mergeConfig(DEFAULT_CONFIG, config);
  await chrome.storage.local.set({ [SETTINGS_KEY]: currentConfig });
}

function numberValue(element, fallback = 0) {
  const value = Number(element.value);
  return Number.isFinite(value) ? value : fallback;
}

function renderLevels(levels) {
  elements.levels.innerHTML = '';
  for (const level of levels) {
    const card = document.createElement('div');
    card.className = 'level-card';
    card.dataset.key = level.key;
    card.innerHTML = `
      <div class="level-title">${level.label || level.key}</div>
      <div class="level-grid">
        <label class="field"><span>标识</span><input data-field="key" type="text"></label>
        <label class="field"><span>名称</span><input data-field="label" type="text"></label>
        <label class="field"><span>稳定比例</span><input data-field="stablePercent" type="number" min="0" max="1" step="0.01"></label>
        <label class="field"><span>粉丝门槛</span><input data-field="minFollowers" type="number" min="0"></label>
        <label class="field"><span>稳定播放门槛</span><input data-field="stablePlay" type="number" min="0"></label>
        <label class="field"><span>最低播放门槛</span><input data-field="minPlay" type="number" min="0"></label>
        <label class="field"><span>最近视频数</span><input data-field="recentVideoCount" type="number" min="1"></label>
      </div>
    `;
    for (const input of card.querySelectorAll('input')) {
      const field = input.dataset.field;
      input.value = level[field] ?? '';
    }
    elements.levels.appendChild(card);
  }
}

function renderConfigForm(config) {
  elements.searchUrl.value = config.search.url || DEFAULT_CONFIG.search.url;
  elements.concurrentProfiles.value = config.search.concurrentProfiles || DEFAULT_CONFIG.search.concurrentProfiles;
  elements.profileTabActive.checked = Boolean(config.search.profileTabActive);
  elements.serverBaseUrl.value = config.server.baseUrl || DEFAULT_CONFIG.server.baseUrl;
  elements.scrollWaitMs.value = config.scroll.scrollWaitMs || 1200;
  elements.profileWaitMs.value = config.scroll.profileWaitMs || 1500;
  elements.excludeRecentHours.value = config.rules.excludeRecentHours || 0;
  elements.audienceEnabled.checked = Boolean(config.rules.audience?.enabled);
  elements.requiredTopCountry.value = config.rules.audience?.requiredTopCountry || '';
  elements.minSampleCount.value = config.rules.audience?.minSampleCount ?? 20;
  elements.minTopCountryPercentage.value = config.rules.audience?.minTopCountryPercentage ?? 50;
  elements.sampleVideoCount.value = config.rules.audience?.sampleVideoCount ?? 3;
  elements.commentsPerVideo.value = config.rules.audience?.commentsPerVideo ?? 50;
  renderLevels(config.rules.levels || []);
  configRendered = true;
}

function readLevelsFromForm() {
  return Array.from(elements.levels.querySelectorAll('.level-card')).map((card) => {
    const get = (field) => card.querySelector(`[data-field="${field}"]`)?.value ?? '';
    return {
      key: get('key').trim(),
      label: get('label').trim(),
      stablePercent: Number(get('stablePercent')) || 0,
      minFollowers: Number(get('minFollowers')) || 0,
      stablePlay: Number(get('stablePlay')) || 0,
      minPlay: Number(get('minPlay')) || 0,
      recentVideoCount: Number(get('recentVideoCount')) || 1,
    };
  }).filter((level) => level.key);
}

function updateView(state) {
  const config = currentConfig || mergeConfig(DEFAULT_CONFIG, state?.config || {});
  const hasCheckpoint = Boolean(
    state?.discovered?.length
    || state?.queue?.length
    || state?.processed?.length
    || state?.rows?.length,
  );
  if (!configRendered) renderConfigForm(config);

  elements.running.textContent = state?.running ? '运行中' : '已停止';
  elements.discovered.textContent = state?.stats?.discovered || 0;
  elements.queued.textContent = state?.stats?.queued || 0;
  elements.processed.textContent = state?.stats?.processed || 0;
  elements.qualified.textContent = state?.stats?.qualified || 0;
  elements.checkpointStatus.textContent = hasCheckpoint ? '已保存' : '无';
  elements.rowCount.textContent = state?.rows?.length || 0;
  elements.lastSavedAt.textContent = state?.lastSavedAt
    ? new Date(state.lastSavedAt).toLocaleString()
    : '-';
  elements.serverStatus.textContent = state?.server?.connected
    ? '已连接'
    : `未连接${state?.server?.error ? `: ${state.server.error}` : ''}`;
  elements.checkpointSource.textContent = state?.checkpointSource === 'excel'
    ? 'Excel 表格'
    : state?.checkpointSource === 'chrome-storage'
      ? '浏览器本地'
      : '-';
  elements.workbookPath.textContent = state?.workbookPath || '-';
  elements.primaryActionBtn.textContent = state?.running
    ? '暂停'
    : hasCheckpoint ? '继续' : '开始';
  elements.logs.textContent = (state?.logs || []).join('\n');
}

async function refresh() {
  const response = await send('GET_STATE');
  if (response?.ok) {
    if (!configRendered) await loadStoredConfig(response.state?.config);
    updateView(response.state);
  }
}

function buildConfigFromForm() {
  return mergeConfig(DEFAULT_CONFIG, {
    server: {
      baseUrl: elements.serverBaseUrl.value.trim() || DEFAULT_CONFIG.server.baseUrl,
    },
    search: {
      url: elements.searchUrl.value.trim() || DEFAULT_CONFIG.search.url,
      maxProcessed: DEFAULT_CONFIG.search.maxProcessed,
      idleRounds: DEFAULT_CONFIG.search.idleRounds,
      concurrentProfiles: Math.max(1, Math.min(5, numberValue(
        elements.concurrentProfiles,
        DEFAULT_CONFIG.search.concurrentProfiles,
      ))),
      profileTabActive: elements.profileTabActive.checked,
    },
    scroll: {
      scrollWaitMs: Math.max(100, numberValue(elements.scrollWaitMs, 1200)),
      profileWaitMs: Math.max(100, numberValue(elements.profileWaitMs, 1500)),
    },
    rules: {
      excludeRecentHours: Math.max(0, numberValue(elements.excludeRecentHours, 24)),
      audience: {
        enabled: elements.audienceEnabled.checked,
        requiredTopCountry: elements.requiredTopCountry.value.trim().toUpperCase(),
        minSampleCount: Math.max(0, numberValue(elements.minSampleCount, 20)),
        minTopCountryPercentage: Math.max(0, numberValue(elements.minTopCountryPercentage, 50)),
        sampleVideoCount: Math.max(1, numberValue(elements.sampleVideoCount, 3)),
        commentsPerVideo: Math.max(1, numberValue(elements.commentsPerVideo, 50)),
      },
      levels: readLevelsFromForm(),
    },
  });
}

async function autoSaveConfig() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    try {
      await saveStoredConfig(buildConfigFromForm());
    } catch (error) {
      console.warn('自动保存配置失败', error);
    }
  }, 150);
}

function bindAutoSave() {
  const fields = [
    elements.searchUrl,
    elements.concurrentProfiles,
    elements.serverBaseUrl,
    elements.scrollWaitMs,
    elements.profileWaitMs,
    elements.excludeRecentHours,
    elements.requiredTopCountry,
    elements.minSampleCount,
    elements.minTopCountryPercentage,
    elements.sampleVideoCount,
    elements.commentsPerVideo,
  ];

  for (const field of fields) {
    field.addEventListener('blur', autoSaveConfig);
  }

  elements.profileTabActive.addEventListener('change', autoSaveConfig);
  elements.audienceEnabled.addEventListener('change', autoSaveConfig);
  elements.levels.addEventListener('blur', (event) => {
    if (event.target?.matches?.('input')) autoSaveConfig();
  }, true);
}

elements.primaryActionBtn.addEventListener('click', async () => {
  try {
    const currentState = assertOk(await send('GET_STATE'), '获取状态').state;
    if (currentState?.running) {
      const response = assertOk(await send('STOP'), '暂停任务');
      updateView(response.state);
      return;
    }

    const config = buildConfigFromForm();
    await saveStoredConfig(config);
    const response = assertOk(await send('START', {
      searchUrl: config.search.url,
      config,
    }), '启动任务');
    updateView(response.state);
  } catch (error) {
    alert(error?.message || String(error));
  }
});

elements.resetConfigBtn.addEventListener('click', async () => {
  if (!confirm('确定恢复默认配置吗？不会清空任务断点。')) return;
  const config = cloneConfig(DEFAULT_CONFIG);
  await saveStoredConfig(config);
  renderConfigForm(config);
});

elements.resetBtn.addEventListener('click', async () => {
  if (!confirm('确定清空当前队列和结果吗？')) return;
  try {
    const response = assertOk(await send('RESET'), '重置任务');
    updateView(response.state);
  } catch (error) {
    alert(error?.message || String(error));
  }
});

bindAutoSave();
refresh();
setInterval(refresh, 1500);
