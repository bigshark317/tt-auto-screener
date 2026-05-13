const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const apiVideoCache = new Map();
const apiAuthorCache = new Map();
const apiProfileVideos = new Map();
const apiProfileAuthors = new Map();

function injectApiInterceptor() {
  if (document.documentElement.dataset.ttAutoScreenerInjected) return;
  document.documentElement.dataset.ttAutoScreenerInjected = '1';
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/page-interceptor.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

injectApiInterceptor();

function parseCount(text) {
  const cleaned = String(text || '')
    .replace(/[\s\u00a0]+/g, '')
    .replace(/,/g, '')
    .trim();
  const match = cleaned.match(/([\d.]+)\s*([KkMmBb]|万|億|亿|千)?/);
  if (!match) return 0;
  let value = Number.parseFloat(match[1]);
  const unit = (match[2] || '').toUpperCase();
  if (unit === 'K') value *= 1000;
  if (unit === 'M') value *= 1000000;
  if (unit === 'B') value *= 1000000000;
  if (match[2] === '千') value *= 1000;
  if (match[2] === '万') value *= 10000;
  if (match[2] === '億' || match[2] === '亿') value *= 100000000;
  return Math.round(value);
}

function normalizeUsername(input) {
  return String(input || '').replace(/^@/, '').replace(/\/+$/, '').trim();
}

function numberFrom(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseCount(value);
  return 0;
}

function getNested(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null) return object[key];
  }
  return undefined;
}

function isDiscoveryApiUrl(url) {
  const value = String(url || '');
  return /\/api\/explore\/item_list\/?/i.test(value);
}

function isProfileApiUrl(url) {
  const value = String(url || '');
  return /\/api\/post\/item_list\/?/i.test(value);
}

function normalizeApiVideo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw.item || raw.aweme_info || raw.awemeInfo || (raw.id || raw.author || raw.stats ? raw : raw.video) || raw;
  const author = item.author || item.authorInfo || item.author_info || item.user || {};
  const username = normalizeUsername(getNested(author, ['uniqueId', 'unique_id', 'nickname']) || '');
  const id = String(getNested(item, ['id', 'aweme_id', 'item_id', 'videoId']) || '');
  if (!id || !username) return null;

  const stats = item.stats || item.statistics || item.statsV2 || {};
  const statsV2 = item.statsV2 || {};
  const authorStats = item.authorStats || item.author_stats || item.authorStatsV2 || {};
  const authorStatsV2 = item.authorStatsV2 || {};
  const playCount = numberFrom(getNested(stats, ['playCount', 'play_count', 'playCountStr', 'play_count_str'])
    ?? getNested(statsV2, ['playCount', 'play_count', 'playCountStr', 'play_count_str'])
    ?? getNested(item, ['playCount', 'play_count']));
  const createTime = Number(getNested(item, ['createTime', 'create_time'])) || extractTimestampFromVideoId(id);

  return {
    id,
    username,
    url: `https://www.tiktok.com/@${username}/video/${id}`,
    desc: item.desc || item.description || '',
    createTime,
    playCount,
    author: {
      username,
      nickname: author.nickname || author.nickName || '',
      signature: author.signature || author.bio || '',
      followerCount: numberFrom(getNested(authorStatsV2, ['followerCount', 'follower_count'])
        ?? getNested(authorStats, ['followerCount', 'follower_count'])
        ?? getNested(author, ['followerCount', 'follower_count'])),
      videoCount: numberFrom(getNested(authorStatsV2, ['videoCount', 'video_count'])
        ?? getNested(authorStats, ['videoCount', 'video_count'])
        ?? getNested(author, ['videoCount', 'video_count'])),
    },
  };
}

function collectApiItems(value, output = []) {
  if (!value || output.length > 500) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectApiItems(item, output);
    return output;
  }
  if (typeof value !== 'object') return output;

  const normalized = normalizeApiVideo(value);
  if (normalized) output.push(normalized);

  for (const key of ['itemList', 'item_list', 'items', 'aweme_list', 'data', 'list']) {
    const nested = value[key];
    if (nested && nested !== value) collectApiItems(nested, output);
  }
  return output;
}

function cacheApiPayload(payload, sourceUrl = '') {
  const items = collectApiItems(payload);
  const canDiscoverAuthor = isDiscoveryApiUrl(sourceUrl);
  const canCollectProfile = isProfileApiUrl(sourceUrl);
  for (const item of items) {
    apiVideoCache.set(item.id, item);
    if (canDiscoverAuthor) {
      apiAuthorCache.set(item.username, {
        username: item.username,
        profileUrl: `https://www.tiktok.com/@${item.username}`,
        sourceVideoUrl: item.url,
        sourceText: item.desc || '',
      });
    }
    if (canCollectProfile) {
      apiProfileAuthors.set(item.username, {
        uniqueId: item.author.username,
        nickname: item.author.nickname,
        signature: item.author.signature,
        followerCount: item.author.followerCount,
        videoCount: item.author.videoCount,
      });

      const videos = apiProfileVideos.get(item.username) || new Map();
      videos.set(item.id, {
        id: item.id,
        url: item.url,
        desc: item.desc,
        createTime: item.createTime,
        playCount: item.playCount,
      });
      apiProfileVideos.set(item.username, videos);
    }
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== 'TT_AUTO_SCREENER_PAGE' || event.data?.type !== 'API_RESPONSE') return;
  cacheApiPayload(event.data.payload, event.data.url);
});

function extractTimestampFromVideoId(videoId) {
  try {
    const id = BigInt(String(videoId));
    const timestamp = Number(id >> 32n);
    if (timestamp > 1546300800 && timestamp < 1893456000) return timestamp;
  } catch (error) {}
  return 0;
}

function extractEmails(text) {
  const matches = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return matches ? [...new Set(matches.map((item) => item.toLowerCase()))] : [];
}

function getPageText(limit = 8000) {
  return (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, limit);
}

function pushAuthor(results, seen, data) {
  if (!data.username || seen.has(data.username)) return;
  seen.add(data.username);
  results.push({
    username: data.username,
    profileUrl: `https://www.tiktok.com/@${data.username}`,
    sourceVideoUrl: data.sourceVideoUrl || '',
    sourceText: data.sourceText || '',
  });
}

function extractAuthorsFromPage() {
  const results = [];
  const seen = new Set();
  for (const author of apiAuthorCache.values()) {
    pushAuthor(results, seen, author);
  }
  return results;
}

function findScrollableContainer() {
  const candidates = [
    document.scrollingElement,
    ...Array.from(document.querySelectorAll('main, section, div[role="main"], div[class*="scroll"], div[class*="Scroll"], div[class*="feed"], div[class*="Feed"]')),
  ].filter(Boolean);

  return candidates
    .filter((el) => el.scrollHeight > el.clientHeight + 40)
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || document.scrollingElement;
}

async function scrollPage(waitMs = 1200) {
  const target = findScrollableContainer();
  const before = {
    scrollTop: target?.scrollTop || window.scrollY || 0,
    scrollHeight: target?.scrollHeight || document.documentElement.scrollHeight,
    authorCount: extractAuthorsFromPage().length,
  };

  if (target && target !== document.scrollingElement) {
    target.scrollTop += Math.max(target.clientHeight * 0.9, window.innerHeight);
    target.dispatchEvent(new Event('scroll', { bubbles: true }));
  } else {
    window.scrollBy({ top: Math.max(window.innerHeight * 1.2, 700), behavior: 'instant' });
  }

  await sleep(waitMs);
  const after = {
    scrollTop: target?.scrollTop || window.scrollY || 0,
    scrollHeight: target?.scrollHeight || document.documentElement.scrollHeight,
    authorCount: extractAuthorsFromPage().length,
  };

  return {
    ...after,
    progressed: after.scrollTop > before.scrollTop
      || after.scrollHeight > before.scrollHeight
      || after.authorCount > before.authorCount,
  };
}

function getCurrentScrollResult(authorCount) {
  const target = findScrollableContainer();
  return {
    scrollTop: target?.scrollTop || window.scrollY || 0,
    scrollHeight: target?.scrollHeight || document.documentElement.scrollHeight,
    authorCount,
    progressed: false,
  };
}

function extractVideosFromApi(username) {
  return [...(apiProfileVideos.get(username)?.values() || [])]
    .sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
}

function getApiUserInfo(username) {
  const apiUserInfo = apiProfileAuthors.get(username) || {};
  return {
    uniqueId: apiUserInfo.uniqueId || username,
    nickname: apiUserInfo.nickname || '',
    signature: apiUserInfo.signature || '',
    followerCount: apiUserInfo.followerCount || 0,
    videoCount: apiUserInfo.videoCount || 0,
  };
}

function extractEmailFromApiSignature(username) {
  const apiSignature = apiProfileAuthors.get(username)?.signature || '';
  return extractEmails(apiSignature)[0] || '';
}

function hasProfileErrorState() {
  const text = getPageText(30000);
  return /出错了|很抱歉|请稍后重试|Something went wrong|Try again|Please try again/i.test(text);
}

function hasPrivateAccountState() {
  const text = getPageText(30000);
  return /这是私密账号|这是私密帐号|私密账号|私密帐号|Private account|This account is private/i.test(text);
}

function clickElement(element) {
  element.scrollIntoView?.({ block: 'center', inline: 'center' });
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    element.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
  }
}

function clickInlineRefreshButton() {
  const buttons = Array.from(document.querySelectorAll('button, [role="button"], div, span'));
  const refreshButton = buttons.find((button) => {
    const text = (button.textContent || '').replace(/\s+/g, '');
    return /^(刷新|重试|Refresh|Tryagain)$/i.test(text);
  });
  if (!refreshButton) return false;
  clickElement(refreshButton);
  return true;
}

async function waitForInitialVideos(username, timeoutMs = 15000, maxInlineRefreshAttempts = 2) {
  const startedAt = Date.now();
  let videos = extractVideosFromApi(username);
  let inlineRefreshAttempts = 0;
  let errorDetected = hasProfileErrorState();
  let privateDetected = hasPrivateAccountState();

  while (videos.length === 0 && !privateDetected && Date.now() - startedAt < timeoutMs) {
    if (hasProfileErrorState()) {
      errorDetected = true;
      if (inlineRefreshAttempts < maxInlineRefreshAttempts && clickInlineRefreshButton()) {
        inlineRefreshAttempts += 1;
        await sleep(2000);
      }
    }
    await sleep(500);
    privateDetected = hasPrivateAccountState();
    videos = extractVideosFromApi(username);
  }

  return {
    videos,
    timedOut: videos.length === 0,
    errorDetected,
    privateDetected,
    inlineRefreshAttempts,
  };
}

async function collectProfile(options = {}) {
  const username = normalizeUsername(options.username || location.pathname.match(/^\/@([^/?#]+)/)?.[1] || '');
  const targetVideoCount = Math.max(1, Number(options.targetVideoCount) || 30);
  const waitMs = Number(options.waitMs) || 1500;
  const initial = await waitForInitialVideos(
    username,
    Number(options.initialVideoTimeoutMs) || 15000,
    Number(options.maxInlineRefreshAttempts) || 2,
  );
  let videos = extractVideosFromApi(username);
  if (videos.length === 0) videos = initial.videos;
  let unchangedRounds = 0;

  while (!initial.privateDetected && videos.length < targetVideoCount && unchangedRounds < 3) {
    const beforeCount = videos.length;
    await scrollPage(waitMs);
    const apiVideos = extractVideosFromApi(username);
    videos = apiVideos.length > videos.length ? apiVideos : videos;
    unchangedRounds = videos.length > beforeCount ? 0 : unchangedRounds + 1;
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
  await sleep(300);
  const userInfo = getApiUserInfo(username);
  const contactEmail = extractEmailFromApiSignature(username);

  return {
    username,
    profileUrl: `https://www.tiktok.com/@${username}`,
    userInfo,
    videos,
    contactEmail,
    loadState: {
      initialVideoTimedOut: initial.timedOut,
      profileErrorDetected: initial.errorDetected,
      privateAccountDetected: initial.privateDetected,
      inlineRefreshAttempts: initial.inlineRefreshAttempts,
    },
    audience: {
      topCountry: '',
      topCountryPercentage: 0,
      sampleCount: 0,
      failureReason: '插件版未抓取评论受众',
    },
    apiHits: {
      userDetail: userInfo.followerCount > 0 ? 1 : 0,
      itemList: videos.length > 0 ? 1 : 0,
    },
    pageTitle: document.title,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'TT_SCAN_SEARCH') {
      const authors = extractAuthorsFromPage();
      const scrollResult = message.scroll === false
        ? getCurrentScrollResult(authors.length)
        : await scrollPage(message.waitMs);
      sendResponse({ ok: true, authors, scrollResult, url: location.href });
      return;
    }

    if (message?.type === 'TT_COLLECT_PROFILE') {
      const profile = await collectProfile(message.options || {});
      sendResponse({ ok: true, profile });
      return;
    }

    if (message?.type === 'TT_PING') {
      sendResponse({ ok: true, url: location.href });
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: error?.message || String(error) });
  });
  return true;
});
