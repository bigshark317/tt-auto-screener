import { DEFAULT_CONFIG, mergeConfig } from './shared/config.js';
import { getProfileTargetVideoCount } from './shared/analyzer.js';

const STORAGE_KEY = 'tt_auto_screener_state_v3';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let state = createInitialState();
let runToken = 0;
let activeProfileChain = Promise.resolve();

class LocalServiceDisconnectedError extends Error {
  constructor(error) {
    super(`本地服务未连接，已自动暂停: ${error?.message || String(error)}`);
    this.name = 'LocalServiceDisconnectedError';
  }
}

function createInitialState() {
  return {
    running: false,
    searchTabId: null,
    searchUrl: DEFAULT_CONFIG.search.url,
    config: DEFAULT_CONFIG,
    lastSavedAt: '',
    checkpointSource: 'none',
    workbookPath: '',
    server: {
      baseUrl: DEFAULT_CONFIG.server.baseUrl,
      connected: false,
      error: '',
      lastCheckedAt: '',
    },
    discovered: [],
    queue: [],
    processed: [],
    rows: [],
    logs: [],
    stats: {
      discovered: 0,
      queued: 0,
      processed: 0,
      qualified: 0,
      failed: 0,
    },
  };
}

function log(message) {
  const line = `${new Date().toLocaleTimeString()} ${message}`;
  state.logs = [line, ...state.logs].slice(0, 80);
  console.log(line);
}

function saveStateLocally() {
  state.lastSavedAt = new Date().toISOString();
  return chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function isLocalServiceDisconnectedError(error) {
  return error?.name === 'LocalServiceDisconnectedError';
}

async function pauseForServerDisconnect(error) {
  if (!state.running) return;
  state.running = false;
  runToken += 1;
  updateStats();
  log(`本地服务未连接，已自动暂停: ${error?.message || String(error)}`);
  await saveStateLocally();
}

function persist() {
  state.lastSavedAt = new Date().toISOString();
  return chrome.storage.local
    .set({ [STORAGE_KEY]: state })
    .then(() => syncStateToServer());
}

async function restore() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY]) {
    state = mergeConfig(createInitialState(), stored[STORAGE_KEY]);
    state.running = false;
    state.checkpointSource = 'chrome-storage';
  }
  await restoreFromServer();
}

function updateStats() {
  state.stats.discovered = state.discovered.length;
  state.stats.queued = state.queue.length;
  state.stats.processed = state.processed.length;
  state.stats.qualified = state.rows.filter((row) => row.是否合格 === '合格').length;
  state.stats.failed = Math.max(0, state.stats.processed - state.stats.qualified);
}

function hasCheckpoint() {
  return state.discovered.length > 0
    || state.queue.length > 0
    || state.processed.length > 0
    || state.rows.length > 0;
}

function getServerBaseUrl() {
  return state.config?.server?.baseUrl || DEFAULT_CONFIG.server.baseUrl;
}

async function requestServer(path, options = {}) {
  const baseUrl = getServerBaseUrl().replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `本地服务请求失败: ${response.status}`);
  }
  return data;
}

function setServerStatus({ connected, error = '', workbookPath = '' }) {
  state.server = {
    baseUrl: getServerBaseUrl(),
    connected,
    error,
    lastCheckedAt: new Date().toISOString(),
  };
  if (workbookPath) state.workbookPath = workbookPath;
}

async function restoreFromServer() {
  try {
    const data = await requestServer(`/state?searchUrl=${encodeURIComponent(state.searchUrl || '')}`);
    const serverState = data.state || {};
    if (
      (serverState.rows || []).length > 0
      || (serverState.discovered || []).length > 0
      || (serverState.queue || []).length > 0
      || (serverState.processed || []).length > 0
    ) {
      state = mergeConfig(createInitialState(), {
        ...serverState,
        config: mergeConfig(DEFAULT_CONFIG, serverState.config || state.config || {}),
      });
      state.running = false;
      state.checkpointSource = 'excel';
    }
    setServerStatus({ connected: true, workbookPath: data.workbookPath });
  } catch (error) {
    setServerStatus({ connected: false, error: error?.message || String(error) });
    await pauseForServerDisconnect(error);
  }
}

async function syncStateToServer() {
  try {
    const data = await requestServer('/state', {
      method: 'POST',
      body: JSON.stringify({ state }),
    });
    setServerStatus({ connected: true, workbookPath: data.workbookPath });
  } catch (error) {
    setServerStatus({ connected: false, error: error?.message || String(error) });
  }
}

async function checkServerHealth() {
  try {
    const data = await requestServer('/health');
    setServerStatus({ connected: true, workbookPath: data.workbookPath });
  } catch (error) {
    setServerStatus({ connected: false, error: error?.message || String(error) });
    await pauseForServerDisconnect(error);
  }
}

async function analyzeProfileWithServer(profile) {
  try {
    const data = await requestServer('/analyze-profile', {
      method: 'POST',
      body: JSON.stringify({
        profile,
        rules: state.config.rules,
      }),
    });
    setServerStatus({ connected: true, workbookPath: data.workbookPath || state.workbookPath });
    return data.analysis;
  } catch (error) {
    setServerStatus({ connected: false, error: error?.message || String(error) });
    await pauseForServerDisconnect(error);
    throw new LocalServiceDisconnectedError(error);
  }
}

function tabsQuery(queryInfo) {
  return chrome.tabs.query(queryInfo);
}

function tabsCreate(createProperties) {
  return chrome.tabs.create(createProperties);
}

function tabsUpdate(tabId, updateProperties) {
  return chrome.tabs.update(tabId, updateProperties);
}

function tabsGet(tabId) {
  return chrome.tabs.get(tabId);
}

function tabsReload(tabId) {
  return chrome.tabs.reload(tabId);
}

function tabsRemove(tabId) {
  return chrome.tabs.remove(tabId).catch(() => {});
}

function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`等待页面加载超时: tab ${tabId}`));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function waitForTabCompleteWithRefresh(tabId, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 45000;
  const refreshAfterMs = Number(options.refreshAfterMs) || 3000;
  const refreshMessage = options.refreshMessage || '';

  return new Promise((resolve, reject) => {
    let settled = false;
    let refreshed = false;
    let timer = null;
    let refreshTimer = null;

    function cleanup() {
      clearTimeout(timer);
      clearTimeout(refreshTimer);
      chrome.tabs.onUpdated.removeListener(listener);
    }

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    }

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') {
        finish(resolve, { refreshed });
      }
    }

    async function refreshIfStuck() {
      try {
        const tab = await tabsGet(tabId);
        if (settled) return;
        if (tab?.status === 'complete') {
          finish(resolve, { refreshed });
          return;
        }

        refreshed = true;
        if (refreshMessage) log(refreshMessage);
        await tabsReload(tabId);
      } catch (error) {
        finish(reject, error);
      }
    }

    timer = setTimeout(() => {
      finish(reject, new Error(`等待页面加载超时: tab ${tabId}`));
    }, timeoutMs);

    refreshTimer = setTimeout(refreshIfStuck, refreshAfterMs);
    chrome.tabs.onUpdated.addListener(listener);

    tabsGet(tabId)
      .then((tab) => {
        if (tab?.status === 'complete') finish(resolve, { refreshed });
      })
      .catch((error) => finish(reject, error));
  });
}

async function sendToTab(tabId, message, retries = 8) {
  let lastError = null;
  for (let index = 0; index < retries; index += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      if (index === 0) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['src/content.js'],
          });
        } catch (injectError) {
          lastError = injectError;
        }
      }
      await sleep(500);
    }
  }
  throw lastError || new Error(`无法连接页面脚本: tab ${tabId}`);
}

async function ensureSearchTab(searchUrl) {
  const targetUrl = searchUrl || DEFAULT_CONFIG.search.url;

  if (state.searchTabId) {
    try {
      const tab = await tabsGet(state.searchTabId);
      if (tab?.url === targetUrl) {
        await tabsUpdate(state.searchTabId, { active: true });
        return state.searchTabId;
      }
      await tabsUpdate(state.searchTabId, { url: targetUrl, active: true });
      await waitForTabComplete(state.searchTabId);
      return state.searchTabId;
    } catch (error) {
      state.searchTabId = null;
    }
  }

  const [activeTab] = await tabsQuery({ active: true, currentWindow: true });
  if (activeTab?.id && activeTab.url?.includes('tiktok.com')) {
    state.searchTabId = activeTab.id;
    if (activeTab.url !== targetUrl) {
      await tabsUpdate(activeTab.id, { url: targetUrl, active: true });
      await waitForTabComplete(state.searchTabId);
    }
  } else {
    const tab = await tabsCreate({ url: targetUrl, active: true });
    state.searchTabId = tab.id;
    await waitForTabComplete(state.searchTabId);
  }
  return state.searchTabId;
}

function enqueueAuthors(authors, sourceSearchUrl) {
  const discoveredMap = new Map(state.discovered.map((item) => [item.username, item]));
  const queueMap = new Map(state.queue.map((item) => [item.username, item]));
  const processed = new Set(state.processed);
  let newCount = 0;

  for (const author of authors || []) {
    if (!author?.username || !author.sourceVideoUrl) continue;
    const next = {
      ...discoveredMap.get(author.username),
      ...author,
      sourceSearchUrl,
    };
    if (!discoveredMap.has(author.username)) newCount += 1;
    discoveredMap.set(author.username, next);
    if (!processed.has(author.username)) {
      queueMap.set(author.username, {
        ...queueMap.get(author.username),
        ...next,
      });
    }
  }

  state.discovered = [...discoveredMap.values()];
  state.queue = [...queueMap.values()];
  updateStats();
  return newCount;
}

function removeAuthorsWithoutSourceVideo() {
  const beforeQueue = state.queue.length;
  const beforeDiscovered = state.discovered.length;
  state.queue = state.queue.filter((author) => author?.sourceVideoUrl);
  state.discovered = state.discovered.filter((author) => author?.sourceVideoUrl);
  const removed = (beforeQueue - state.queue.length) + (beforeDiscovered - state.discovered.length);
  if (removed > 0) log(`已清理无来源视频的候选账号 ${removed} 条`);
  updateStats();
}

async function scanSearchPage(options = {}) {
  const shouldScroll = options.scroll !== false;
  const tabId = await ensureSearchTab(state.searchUrl);
  const response = await sendToTab(tabId, {
    type: 'TT_SCAN_SEARCH',
    scroll: shouldScroll,
    waitMs: state.config.scroll.scrollWaitMs,
  });
  if (!response?.ok) throw new Error(response?.error || '搜索页扫描失败');
  const newCount = enqueueAuthors(response.authors, response.url || state.searchUrl);
  log(`搜索页扫描完成 | ${shouldScroll ? '已滚动' : '未滚动'} | 新发现 ${newCount} | 队列 ${state.queue.length} | 累计 ${state.discovered.length}`);
  await persist();
  return {
    newCount,
    progressed: Boolean(response.scrollResult?.progressed),
  };
}

function getConcurrentProfileLimit(maxProcessed) {
  const configured = Number(state.config.search.concurrentProfiles)
    || DEFAULT_CONFIG.search.concurrentProfiles;
  const bounded = Math.max(1, Math.min(5, Math.floor(configured)));
  if (maxProcessed > 0) return Math.min(bounded, Math.max(0, maxProcessed - state.processed.length));
  return bounded;
}

function takeNextAuthors(limit) {
  const authors = [];
  while (authors.length < limit && state.queue.length > 0) {
    const author = state.queue.shift();
    if (!author || state.processed.includes(author.username)) continue;
    authors.push(author);
  }
  updateStats();
  return authors;
}

function withActiveProfileTab(task) {
  const run = () => task();
  const result = activeProfileChain.then(run, run);
  activeProfileChain = result.catch(() => {});
  return result;
}

async function collectProfileFromTab(tabId, author, profileTargetVideoCount) {
  const response = await sendToTab(tabId, {
    type: 'TT_COLLECT_PROFILE',
    options: {
      username: author.username,
      targetVideoCount: profileTargetVideoCount,
      waitMs: state.config.scroll.profileWaitMs,
      initialVideoTimeoutMs: 15000,
      maxInlineRefreshAttempts: 3,
    },
  });
  if (!response?.ok) throw new Error(response?.error || '主页采集失败');
  return {
    ...response.profile,
    sourceSearchUrl: author.sourceSearchUrl || state.searchUrl,
    sourceVideoUrl: author.sourceVideoUrl || '',
    sourceText: author.sourceText || '',
  };
}

async function loadAndCollectActiveProfile(tabId, author) {
  return withActiveProfileTab(async () => {
    await tabsUpdate(tabId, { active: true });
    await waitForTabCompleteWithRefresh(tabId, {
      refreshAfterMs: 3000,
      refreshMessage: `@${author.username} 主页加载超过 3 秒，自动刷新一次`,
    });
    await tabsUpdate(tabId, { active: true });
    await sleep(800);

    const profileTargetVideoCount = getProfileTargetVideoCount(state.config);
    let profile = await collectProfileFromTab(tabId, author, profileTargetVideoCount);
    if (profile.loadState?.privateAccountDetected) return profile;
    for (let retry = 1; retry <= 3 && (profile.videos || []).length === 0; retry += 1) {
      const inlineRefreshes = Number(profile.loadState?.inlineRefreshAttempts) || 0;
      const reason = profile.loadState?.profileErrorDetected
        ? `检测到页内错误${inlineRefreshes ? `，已点刷新 ${inlineRefreshes} 次` : ''}`
        : '主页视频未加载';
      log(`@${author.username} ${reason}，浏览器刷新重试 ${retry}/3`);
      await tabsReload(tabId);
      await waitForTabCompleteWithRefresh(tabId, {
        refreshAfterMs: 3000,
        refreshMessage: `@${author.username} 主页重试 ${retry}/3 加载超过 3 秒，自动刷新一次`,
      });
      await tabsUpdate(tabId, { active: true });
      await sleep(800);
      profile = await collectProfileFromTab(tabId, author, profileTargetVideoCount);
      if (profile.loadState?.privateAccountDetected) return profile;
    }
    if ((profile.videos || []).length === 0) throw new Error('主页视频仍未加载');
    return profile;
  });
}

async function collectAuthor(author) {
  const tab = await tabsCreate({
    url: author.profileUrl,
    active: false,
  });
  try {
    const profile = await loadAndCollectActiveProfile(tab.id, author);
    if (profile.loadState?.privateAccountDetected) {
      state.processed.push(author.username);
      updateStats();
      log(`跳过 @${author.username} | 私密账号`);
      return;
    }
    const { result, row } = await analyzeProfileWithServer(profile);
    if (row.是否合格 === '合格') state.rows.push(row);
    state.processed.push(author.username);
    updateStats();
    log(`完成 @${author.username} | ${row.是否合格} | 粉丝 ${row.粉丝量展示} | 视频 ${row.总抓取视频数} | ${result.decisionReason}`);
  } catch (error) {
    if (isLocalServiceDisconnectedError(error)) {
      state.queue.unshift(author);
      updateStats();
      log(`已暂停并保留 @${author.username}: ${error.message}`);
    } else {
      state.processed.push(author.username);
      updateStats();
      log(`失败 @${author.username}: ${error?.message || String(error)}`);
    }
  } finally {
    await tabsRemove(tab.id);
    if (state.server.connected) await persist();
    else await saveStateLocally();
  }
}

async function runLoop(token) {
  let idleRounds = 0;
  let scannedInitialViewport = false;
  log('采集任务已启动');

  while (state.running && token === runToken) {
    const maxProcessed = Number(state.config.search.maxProcessed) || 0;
    if (maxProcessed > 0 && state.processed.length >= maxProcessed) {
      log(`达到本次最大处理数 ${maxProcessed}，自动停止`);
      state.running = false;
      break;
    }

    if (state.queue.length === 0) {
      const scanResult = await scanSearchPage({ scroll: scannedInitialViewport });
      scannedInitialViewport = true;
      idleRounds = scanResult.newCount > 0 || scanResult.progressed ? 0 : idleRounds + 1;
      if (idleRounds >= (Number(state.config.search.idleRounds) || 20)) {
        log(`连续 ${idleRounds} 轮无新增，自动停止`);
        state.running = false;
        break;
      }
      continue;
    }

    const authors = takeNextAuthors(getConcurrentProfileLimit(maxProcessed));
    if (authors.length === 0) continue;
    await Promise.all(authors.map((author) => collectAuthor(author)));
  }

  state.running = false;
  updateStats();
  log('采集任务已停止');
  await persist();
}

async function start(payload = {}) {
  await restore();
  const nextConfig = mergeConfig(DEFAULT_CONFIG, payload.config || {});
  const requestedUrl = payload.searchUrl || nextConfig.search.url || DEFAULT_CONFIG.search.url;
  state.config = nextConfig;
  state.server.baseUrl = getServerBaseUrl();
  await checkServerHealth();
  if (!state.server.connected) {
    log(`本地服务未连接，任务未启动: ${state.server.error}`);
    await saveStateLocally();
    return;
  }
  if (hasCheckpoint()) {
    state.searchUrl = state.searchUrl || requestedUrl;
    state.config.search.url = state.searchUrl;
    removeAuthorsWithoutSourceVideo();
    log(`检测到本地断点，继续上次任务 | 搜索页 ${state.searchUrl} | 队列 ${state.queue.length} | 已处理 ${state.processed.length} | 表格 ${state.rows.length}`);
  } else {
    state.searchUrl = requestedUrl;
    log(`创建新任务 | 搜索页 ${state.searchUrl}`);
  }
  state.running = true;
  updateStats();
  await persist();
  runToken += 1;
  runLoop(runToken).catch(async (error) => {
    log(`任务异常停止: ${error?.message || String(error)}`);
    state.running = false;
    await persist();
  });
}

async function stop() {
  state.running = false;
  runToken += 1;
  await persist();
}

async function reset() {
  state = createInitialState();
  runToken += 1;
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  try {
    const data = await requestServer('/reset', {
      method: 'POST',
      body: JSON.stringify({ searchUrl: state.searchUrl }),
    });
    setServerStatus({ connected: true, workbookPath: data.workbookPath });
  } catch (error) {
    setServerStatus({ connected: false, error: error?.message || String(error) });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'START') await start(message.payload || {});
    else if (message?.type === 'STOP') await stop();
    else if (message?.type === 'RESET') await reset();
    else if (message?.type === 'GET_STATE') await checkServerHealth();
    sendResponse({ ok: true, state });
  })().catch((error) => {
    sendResponse({ ok: false, error: error?.message || String(error), state });
  });
  return true;
});

restore();
