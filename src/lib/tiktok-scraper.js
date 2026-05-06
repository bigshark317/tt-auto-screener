const fs = require('fs');
const puppeteer = require('puppeteer');
const {
  sleep,
  parseCountText,
  extractTimestampFromVideoId,
  normalizeUsername,
  resolveProjectPath,
  formatAuthorLog,
} = require('./helpers');

const DEFAULTS = {
  headless: false,
  slowMo: 0,
  timeoutMs: 45000,
  scrollPauseMs: 1200,
  searchReadyTimeoutMs: 5000,
  profileApiWaitMs: 5000,
  scrollSettleMs: 1200,
  targetVideoCount: 30,
  excludeRecentHours: 0,
  viewport: {
    width: 1440,
    height: 960,
  },
  extraHttpHeaders: {
    'accept-language': 'en-US,en;q=0.9',
  },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  auth: {
    mode: 'profile',
    userDataDir: '',
    cookieFile: '',
  },
};

const DEFAULT_TIKTOK_LOGIN_CHECK_URL = 'https://www.tiktok.com/foryou';

const MAX_AUDIENCE_DEBUG_LOGS = 120;
const DEFAULT_TIKWM_CONFIG = {
  paidBaseUrl: 'https://api.tikwmapi.com',
  apiKey: '',
  pathMap: {
    '/feed/search': '/search/feed',
  },
};

function getChromeDataDir(userDataDir = '') {
  return userDataDir || resolveProjectPath('.chrome-data');
}

function normalizeAuthConfig(authConfig = {}) {
  return {
    ...DEFAULTS.auth,
    ...(authConfig || {}),
  };
}

function isAnonymousMode(authConfig = {}) {
  return normalizeAuthConfig(authConfig).mode === 'anonymous';
}

function isProfileMode(authConfig = {}) {
  return normalizeAuthConfig(authConfig).mode === 'profile';
}

function hasPersistedProfile(userDataDir) {
  try {
    if (!userDataDir || !fs.existsSync(userDataDir)) return false;
    return fs.readdirSync(userDataDir).some((name) => name && !name.startsWith('.'));
  } catch (error) {
    return false;
  }
}

function normalizeCookie(cookie, fallbackUrl) {
  if (!cookie || typeof cookie !== 'object') return null;
  const normalized = { ...cookie };

  if (!normalized.name || normalized.value === undefined || normalized.value === null) return null;

  normalized.name = String(normalized.name).trim();
  normalized.value = String(normalized.value);
  if (!normalized.name) return null;

  if (!normalized.url && !normalized.domain) {
    normalized.url = fallbackUrl;
  }
  if (!normalized.path) {
    normalized.path = '/';
  }

  return normalized;
}

function normalizeCookies(cookies = [], fallbackUrl = 'https://www.tiktok.com/') {
  if (!Array.isArray(cookies)) return [];
  return cookies
    .map((cookie) => normalizeCookie(cookie, fallbackUrl))
    .filter(Boolean);
}

async function applyCookiesToPage(page, cookies = []) {
  const normalizedCookies = normalizeCookies(cookies);
  if (normalizedCookies.length === 0) return;
  await page.setCookie(...normalizedCookies);
}

function loadCookiesFromFile(cookieFile) {
  if (!cookieFile) return [];
  if (!fs.existsSync(cookieFile)) {
    throw new Error(`Cookie 文件不存在: ${cookieFile}`);
  }

  const raw = fs.readFileSync(cookieFile, 'utf8').trim();
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.cookies)) return parsed.cookies;
  throw new Error(`Cookie 文件格式无效，需为数组或 { cookies: [] }: ${cookieFile}`);
}

async function preparePage(page, options = {}) {
  const merged = { ...DEFAULTS, ...options };
  page.setDefaultTimeout(merged.timeoutMs);
  await page.setUserAgent(merged.userAgent || DEFAULTS.userAgent);
  await page.setExtraHTTPHeaders(merged.extraHttpHeaders || DEFAULTS.extraHttpHeaders);
}

function hasTikTokLoginCookies(cookies = []) {
  const names = new Set((Array.isArray(cookies) ? cookies : []).map((cookie) => cookie?.name).filter(Boolean));
  return ['sessionid', 'sessionid_ss', 'sid_tt', 'uid_tt', 'uid_tt_ss'].some((name) => names.has(name));
}

async function checkTikTokLoginState(page, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || DEFAULTS.timeoutMs;
  const targetUrl = DEFAULT_TIKTOK_LOGIN_CHECK_URL;

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await sleep(1200);
  const cookies = await page.cookies('https://www.tiktok.com/');
  return {
    loggedIn: hasTikTokLoginCookies(cookies),
    cookieNames: cookies.map((cookie) => cookie.name).filter(Boolean),
  };
}

async function ensureTikTokAuth(browser, options = {}) {
  const merged = { ...DEFAULTS, ...options };
  const authConfig = normalizeAuthConfig(merged.auth);
  const profileDir = getChromeDataDir(authConfig.userDataDir);
  const profileExists = hasPersistedProfile(profileDir);
  const result = {
    enabled: !isAnonymousMode(authConfig),
    mode: authConfig.mode || 'profile',
    userDataDir: profileDir,
    profileExists,
    loggedIn: false,
    source: 'none',
    importedCookieCount: 0,
  };

  if (isAnonymousMode(authConfig)) {
    return {
      ...result,
      enabled: false,
      source: 'anonymous',
    };
  }

  const page = await browser.newPage();
  try {
    await preparePage(page, merged);

    const initialState = await checkTikTokLoginState(page, merged);
    if (initialState.loggedIn) {
      return {
        ...result,
        loggedIn: true,
        source: 'profile',
      };
    }

    let shouldImportCookies = false;
    if (isProfileMode(authConfig) && !profileExists) {
      shouldImportCookies = true;
    }

    if (!shouldImportCookies) {
      return result;
    }

    const cookieCandidates = authConfig.cookieFile
      ? loadCookiesFromFile(authConfig.cookieFile)
      : [];
    const normalizedCookies = normalizeCookies(cookieCandidates);

    if (normalizedCookies.length === 0) {
      return result;
    }

    await applyCookiesToPage(page, normalizedCookies);
    await page.goto(DEFAULT_TIKTOK_LOGIN_CHECK_URL, {
      waitUntil: 'domcontentloaded',
      timeout: Number(merged.timeoutMs) || DEFAULTS.timeoutMs,
    });
    await sleep(1500);

    const afterImportState = await checkTikTokLoginState(page, merged);
    return {
      ...result,
      loggedIn: afterImportState.loggedIn,
      source: 'cookie-file',
      importedCookieCount: normalizedCookies.length,
    };
  } finally {
    await page.close();
  }
}

function mergeUserInfo(target, nextInfo) {
  if (!nextInfo) return target;
  return {
    ...target,
    ...Object.fromEntries(Object.entries(nextInfo).filter(([, value]) => value !== undefined && value !== null && value !== '')),
  };
}

function mergeVideoMap(videoMap, video, priority = 1) {
  if (!video || !video.id) return;

  const incoming = {
    id: String(video.id),
    desc: video.desc || '',
    createTime: Number(video.createTime) || 0,
    playCount: Number(video.playCount) || 0,
    diggCount: Number(video.diggCount) || 0,
    commentCount: Number(video.commentCount) || 0,
    shareCount: Number(video.shareCount) || 0,
    collectCount: Number(video.collectCount) || 0,
    _priority: priority,
  };

  const existing = videoMap.get(incoming.id);
  if (!existing) {
    videoMap.set(incoming.id, incoming);
    return;
  }

  if (incoming._priority > existing._priority) {
    if (incoming.playCount > 0) existing.playCount = incoming.playCount;
    if (incoming.diggCount > 0) existing.diggCount = incoming.diggCount;
    if (incoming.commentCount > 0) existing.commentCount = incoming.commentCount;
    if (incoming.shareCount > 0) existing.shareCount = incoming.shareCount;
    if (incoming.collectCount > 0) existing.collectCount = incoming.collectCount;
    existing._priority = incoming._priority;
  } else if (incoming._priority === existing._priority) {
    existing.playCount = Math.max(existing.playCount, incoming.playCount);
    existing.diggCount = Math.max(existing.diggCount, incoming.diggCount);
    existing.commentCount = Math.max(existing.commentCount, incoming.commentCount);
    existing.shareCount = Math.max(existing.shareCount, incoming.shareCount);
    existing.collectCount = Math.max(existing.collectCount, incoming.collectCount);
  }

  if (incoming.createTime > 0) existing.createTime = incoming.createTime;
  if (!existing.desc && incoming.desc) existing.desc = incoming.desc;
}

function parseUserDetailPayload(payload) {
  const userInfo = payload?.userInfo;
  if (!userInfo) return null;
  return {
    uid: userInfo.user?.id,
    uniqueId: userInfo.user?.uniqueId,
    nickname: userInfo.user?.nickname,
    signature: userInfo.user?.signature,
    secUid: userInfo.user?.secUid,
    verified: Boolean(userInfo.user?.verified),
    followerCount: Number(userInfo.stats?.followerCount) || 0,
    followingCount: Number(userInfo.stats?.followingCount) || 0,
    heartCount: Number(userInfo.stats?.heartCount) || 0,
    videoCount: Number(userInfo.stats?.videoCount) || 0,
  };
}

function parseVideoListPayload(payload) {
  const items = payload?.itemList || [];
  return items.map((item) => {
    const stats = item.stats || {};
    return {
      id: String(item.id),
      desc: item.desc || '',
      createTime: Number(item.createTime) || 0,
      playCount: Number(stats.playCount || item.playCount) || 0,
      diggCount: Number(stats.diggCount || item.diggCount) || 0,
      commentCount: Number(stats.commentCount || item.commentCount) || 0,
      shareCount: Number(stats.shareCount || item.shareCount) || 0,
      collectCount: Number(stats.collectCount || item.collectCount) || 0,
    };
  });
}

async function launchBrowser(options = {}) {
  const merged = { ...DEFAULTS, ...options };
  const authConfig = normalizeAuthConfig(merged.auth);
  const launchOptions = {
    headless: merged.headless,
    slowMo: merged.slowMo,
    defaultViewport: merged.viewport || DEFAULTS.viewport,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--lang=en-US',
    ],
  };

  if (!isAnonymousMode(authConfig)) {
    launchOptions.userDataDir = getChromeDataDir(authConfig.userDataDir);
  }

  return puppeteer.launch({
    ...launchOptions,
  });
}

async function createBrowserSession(browser, options = {}) {
  const authConfig = normalizeAuthConfig(options.auth);
  if (!isAnonymousMode(authConfig)) {
    return {
      pageTarget: browser,
      isIsolated: false,
      async close() {},
    };
  }

  let context = null;
  if (typeof browser.createBrowserContext === 'function') {
    context = await browser.createBrowserContext();
  } else if (typeof browser.createIncognitoBrowserContext === 'function') {
    context = await browser.createIncognitoBrowserContext();
  }

  if (!context) {
    return {
      pageTarget: browser,
      isIsolated: false,
      async close() {},
    };
  }

  return {
    pageTarget: context,
    isIsolated: true,
    async close() {
      await context.close();
    },
  };
}

async function createPage(pageTarget, options = {}) {
  const page = await pageTarget.newPage();
  await preparePage(page, options);
  return page;
}

async function openSearchPage(page, searchUrl, options = {}) {
  const merged = { ...DEFAULTS, ...options };
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: merged.timeoutMs });
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('a[href*="/@"]').length > 0,
      { timeout: merged.searchReadyTimeoutMs },
    );
  } catch (error) {}
}

async function extractAuthorsFromCurrentSearchViewport(page) {
  return page.evaluate(() => {
    const results = [];
    const links = Array.from(document.querySelectorAll('a[href*="/@"]'));
    const seen = new Set();

    for (const link of links) {
      const href = link.href || '';
      const match = href.match(/tiktok\.com\/@([^/?]+)/i) || href.match(/\/@([^/?]+)/);
      if (!match) continue;

      const username = match[1];
      if (!username || seen.has(username)) continue;
      seen.add(username);

      const card = link.closest('[data-e2e*="search"], [class*="DivItemContainer"], [class*="video-feed-item"], [class*="SearchItem"], article, div');
      const text = (card?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300);
      const videoLink = card?.querySelector?.('a[href*="/video/"]')?.href || '';

      results.push({
        username,
        profileUrl: `https://www.tiktok.com/@${username}`,
        sourceVideoUrl: videoLink,
        sourceText: text,
      });
    }

    return results;
  });
}

async function scrollSearchResults(page, options = {}) {
  const merged = { ...DEFAULTS, ...options };
  const beforeState = await page.evaluate(() => {
    function describeElement(el) {
      if (!el) return 'window';
      const tag = (el.tagName || 'unknown').toLowerCase();
      const dataE2e = el.getAttribute?.('data-e2e');
      const id = el.id ? `#${el.id}` : '';
      const classes = typeof el.className === 'string'
        ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((name) => `.${name}`).join('')
        : '';
      return `${tag}${id}${classes}${dataE2e ? `[data-e2e=${dataE2e}]` : ''}`;
    }

    function isScrollable(el) {
      if (!el || typeof el.scrollHeight !== 'number' || typeof el.clientHeight !== 'number') return false;
      const style = window.getComputedStyle(el);
      const overflowY = style?.overflowY || '';
      return /(auto|scroll|overlay)/i.test(overflowY) && el.scrollHeight > el.clientHeight + 40;
    }

    function getMetrics(el) {
      if (!el) {
        const root = document.scrollingElement || document.documentElement;
        return {
          scrollTop: root?.scrollTop || window.scrollY || 0,
          scrollHeight: root?.scrollHeight || document.documentElement.scrollHeight || 0,
          clientHeight: window.innerHeight || root?.clientHeight || 0,
        };
      }
      return {
        scrollTop: el.scrollTop || 0,
        scrollHeight: el.scrollHeight || 0,
        clientHeight: el.clientHeight || 0,
      };
    }

    function findScrollableSearchContainer() {
      const authorLinks = Array.from(document.querySelectorAll('a[href*="/@"]')).slice(0, 30);
      const candidates = [];
      const seen = new Set();

      for (const link of authorLinks) {
        let current = link.parentElement;
        let depth = 0;
        while (current && depth < 8) {
          if (!seen.has(current)) {
            seen.add(current);
            candidates.push(current);
          }
          current = current.parentElement;
          depth += 1;
        }
      }

      const broadCandidates = Array.from(document.querySelectorAll('main, section, div[role="main"], div[class*="scroll"], div[class*="Scroll"], div[class*="feed"], div[class*="Feed"]')).slice(0, 80);
      for (const item of broadCandidates) {
        if (!seen.has(item)) {
          seen.add(item);
          candidates.push(item);
        }
      }

      const scrollables = candidates
        .filter((el) => isScrollable(el))
        .map((el) => ({ el, metrics: getMetrics(el) }))
        .sort((a, b) => {
          const scoreA = a.metrics.clientHeight + Math.min(a.metrics.scrollHeight, 50000) / 20;
          const scoreB = b.metrics.clientHeight + Math.min(b.metrics.scrollHeight, 50000) / 20;
          return scoreB - scoreA;
        });

      return scrollables[0]?.el || null;
    }

    const target = findScrollableSearchContainer();
    return {
      targetDescription: describeElement(target),
      authorCount: document.querySelectorAll('a[href*="/@"]').length,
      ...getMetrics(target),
    };
  });

  await page.evaluate(() => {
    function isScrollable(el) {
      if (!el || typeof el.scrollHeight !== 'number' || typeof el.clientHeight !== 'number') return false;
      const style = window.getComputedStyle(el);
      const overflowY = style?.overflowY || '';
      return /(auto|scroll|overlay)/i.test(overflowY) && el.scrollHeight > el.clientHeight + 40;
    }

    function findScrollableSearchContainer() {
      const authorLinks = Array.from(document.querySelectorAll('a[href*="/@"]')).slice(0, 30);
      const candidates = [];
      const seen = new Set();

      for (const link of authorLinks) {
        let current = link.parentElement;
        let depth = 0;
        while (current && depth < 8) {
          if (!seen.has(current)) {
            seen.add(current);
            candidates.push(current);
          }
          current = current.parentElement;
          depth += 1;
        }
      }

      const broadCandidates = Array.from(document.querySelectorAll('main, section, div[role="main"], div[class*="scroll"], div[class*="Scroll"], div[class*="feed"], div[class*="Feed"]')).slice(0, 80);
      for (const item of broadCandidates) {
        if (!seen.has(item)) {
          seen.add(item);
          candidates.push(item);
        }
      }

      const scrollables = candidates
        .filter((el) => isScrollable(el))
        .sort((a, b) => {
          const scoreA = a.clientHeight + Math.min(a.scrollHeight, 50000) / 20;
          const scoreB = b.clientHeight + Math.min(b.scrollHeight, 50000) / 20;
          return scoreB - scoreA;
        });

      return scrollables[0] || null;
    }

    const target = findScrollableSearchContainer();
    const step = Math.max(Math.round(window.innerHeight * 1.4), 600);
    if (target) {
      target.scrollTop += Math.max(Math.round(target.clientHeight * 0.9), step);
      target.dispatchEvent(new Event('scroll', { bubbles: true }));
    } else {
      window.scrollBy({ top: step, behavior: 'instant' });
    }
  });

  await sleep(merged.scrollPauseMs);

  const afterState = await page.evaluate(() => {
    function describeElement(el) {
      if (!el) return 'window';
      const tag = (el.tagName || 'unknown').toLowerCase();
      const dataE2e = el.getAttribute?.('data-e2e');
      const id = el.id ? `#${el.id}` : '';
      const classes = typeof el.className === 'string'
        ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((name) => `.${name}`).join('')
        : '';
      return `${tag}${id}${classes}${dataE2e ? `[data-e2e=${dataE2e}]` : ''}`;
    }

    function isScrollable(el) {
      if (!el || typeof el.scrollHeight !== 'number' || typeof el.clientHeight !== 'number') return false;
      const style = window.getComputedStyle(el);
      const overflowY = style?.overflowY || '';
      return /(auto|scroll|overlay)/i.test(overflowY) && el.scrollHeight > el.clientHeight + 40;
    }

    function getMetrics(el) {
      if (!el) {
        const root = document.scrollingElement || document.documentElement;
        return {
          scrollTop: root?.scrollTop || window.scrollY || 0,
          scrollHeight: root?.scrollHeight || document.documentElement.scrollHeight || 0,
          clientHeight: window.innerHeight || root?.clientHeight || 0,
        };
      }
      return {
        scrollTop: el.scrollTop || 0,
        scrollHeight: el.scrollHeight || 0,
        clientHeight: el.clientHeight || 0,
      };
    }

    function findScrollableSearchContainer() {
      const authorLinks = Array.from(document.querySelectorAll('a[href*="/@"]')).slice(0, 30);
      const candidates = [];
      const seen = new Set();

      for (const link of authorLinks) {
        let current = link.parentElement;
        let depth = 0;
        while (current && depth < 8) {
          if (!seen.has(current)) {
            seen.add(current);
            candidates.push(current);
          }
          current = current.parentElement;
          depth += 1;
        }
      }

      const broadCandidates = Array.from(document.querySelectorAll('main, section, div[role="main"], div[class*="scroll"], div[class*="Scroll"], div[class*="feed"], div[class*="Feed"]')).slice(0, 80);
      for (const item of broadCandidates) {
        if (!seen.has(item)) {
          seen.add(item);
          candidates.push(item);
        }
      }

      const scrollables = candidates
        .filter((el) => isScrollable(el))
        .map((el) => ({ el, metrics: getMetrics(el) }))
        .sort((a, b) => {
          const scoreA = a.metrics.clientHeight + Math.min(a.metrics.scrollHeight, 50000) / 20;
          const scoreB = b.metrics.clientHeight + Math.min(b.metrics.scrollHeight, 50000) / 20;
          return scoreB - scoreA;
        });

      return scrollables[0]?.el || null;
    }

    const target = findScrollableSearchContainer();
    return {
      targetDescription: describeElement(target),
      authorCount: document.querySelectorAll('a[href*="/@"]').length,
      ...getMetrics(target),
    };
  });

  const progressed = afterState.scrollTop > beforeState.scrollTop
    || afterState.scrollHeight > beforeState.scrollHeight
    || afterState.authorCount > beforeState.authorCount;

  return {
    targetDescription: afterState.targetDescription || beforeState.targetDescription,
    previousHeight: beforeState.scrollHeight,
    currentHeight: afterState.scrollHeight,
    previousScrollTop: beforeState.scrollTop,
    currentScrollTop: afterState.scrollTop,
    previousAuthorCount: beforeState.authorCount,
    currentAuthorCount: afterState.authorCount,
    reachedBottom: !progressed,
  };
}

async function collectAuthorsFromSearch(page, searchUrl, options = {}) {
  const merged = { ...DEFAULTS, ...options };
  const targetCount = Number(merged.targetCount) || 30;
  const maxRounds = Number(merged.maxRounds) || 20;
  const authors = new Map();

  await openSearchPage(page, searchUrl, merged);

  for (let round = 0; round < maxRounds; round += 1) {
    const batch = await extractAuthorsFromCurrentSearchViewport(page);

    batch.forEach((item) => {
      if (!authors.has(item.username)) authors.set(item.username, item);
    });

    if (authors.size >= targetCount) break;
    await scrollSearchResults(page, merged);
  }

  return [...authors.values()];
}

async function extractUserFromPage(page) {
  return page.evaluate(() => {
    function parseCount(text) {
      if (!text) return 0;
      const cleaned = String(text).replace(/,/g, '').trim();
      const match = cleaned.match(/([\d.]+)\s*([KkMmBb])?/);
      if (!match) return 0;
      let num = parseFloat(match[1]);
      const unit = (match[2] || '').toUpperCase();
      if (unit === 'K') num *= 1000;
      if (unit === 'M') num *= 1000000;
      if (unit === 'B') num *= 1000000000;
      return Math.round(num);
    }

    let ssrUser = null;
    const ssrEl = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (ssrEl) {
      try {
        const ssr = JSON.parse(ssrEl.textContent || '{}');
        const userInfo = ssr?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
        if (userInfo) {
          ssrUser = {
            uid: userInfo.user?.id,
            uniqueId: userInfo.user?.uniqueId,
            nickname: userInfo.user?.nickname,
            signature: userInfo.user?.signature,
            secUid: userInfo.user?.secUid,
            verified: Boolean(userInfo.user?.verified),
            followerCount: Number(userInfo.stats?.followerCount) || 0,
            followingCount: Number(userInfo.stats?.followingCount) || 0,
            heartCount: Number(userInfo.stats?.heartCount) || 0,
            videoCount: Number(userInfo.stats?.videoCount) || 0,
          };
        }
      } catch (error) {}
    }

    const uniqueId = ssrUser?.uniqueId
      || window.location.pathname.match(/^\/@([^/?]+)/)?.[1]
      || '';

    const nickname = ssrUser?.nickname
      || document.querySelector('[data-e2e="user-title"]')?.textContent?.trim()
      || '';

    const followerText = document.querySelector('[data-e2e="followers-count"]')?.textContent?.trim() || '';

    return {
      ...ssrUser,
      uniqueId,
      nickname,
      followerCount: ssrUser?.followerCount || parseCount(followerText),
    };
  });
}

async function extractVideosFromDom(page) {
  return page.evaluate(() => {
    function parseCount(text) {
      if (!text) return 0;
      const cleaned = String(text).replace(/,/g, '').trim();
      const match = cleaned.match(/([\d.]+)\s*([KkMmBb])?/);
      if (!match) return 0;
      let num = parseFloat(match[1]);
      const unit = (match[2] || '').toUpperCase();
      if (unit === 'K') num *= 1000;
      if (unit === 'M') num *= 1000000;
      if (unit === 'B') num *= 1000000000;
      return Math.round(num);
    }

    function extractTimestamp(videoId) {
      try {
        const id = BigInt(String(videoId));
        const timestamp = Number(id >> 32n);
        if (timestamp > 1546300800 && timestamp < 1893456000) return timestamp;
      } catch (error) {}
      return 0;
    }

    const cards = Array.from(document.querySelectorAll('[data-e2e="user-post-item"]'));
    const fallbackCards = cards.length > 0
      ? cards
      : Array.from(document.querySelectorAll('a[href*="/video/"]')).map((link) => link.closest('[class*="Item"], [class*="Video"], [class*="item"]') || link.parentElement?.parentElement).filter(Boolean);

    const seen = new Set();
    const videos = [];

    for (const card of fallbackCards) {
      const link = card.querySelector('a[href*="/video/"]') || card.closest('a[href*="/video/"]');
      if (!link) continue;
      const match = link.href.match(/\/video\/(\d+)/);
      if (!match) continue;
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);

      let playCount = 0;
      const selectors = [
        '[data-e2e="video-views"]',
        'strong[data-e2e="video-views"]',
        '[class*="video-count"]',
        '[class*="play-count"]',
        '[class*="VideoCount"]',
        '[class*="PlayCount"]',
      ];

      for (const selector of selectors) {
        const el = card.querySelector(selector);
        if (!el) continue;
        playCount = parseCount(el.textContent.trim());
        if (playCount > 0) break;
      }

      if (playCount === 0) {
        const fullText = card.textContent || '';
        const countMatch = fullText.match(/(\d[\d.]*)\s*([KMBkmb])/);
        if (countMatch) playCount = parseCount(countMatch[0]);
      }

      videos.push({
        id,
        desc: '',
        createTime: extractTimestamp(id),
        playCount,
        diggCount: 0,
        commentCount: 0,
        shareCount: 0,
      });
    }

    return videos;
  });
}

async function waitForCondition(check, timeoutMs, intervalMs = 100) {
  const endAt = Date.now() + timeoutMs;
  while (Date.now() < endAt) {
    if (await check()) return true;
    await sleep(intervalMs);
  }
  return Boolean(await check());
}

async function waitForProfileSignals(page, responseState, timeoutMs) {
  return waitForCondition(async () => {
    if (responseState.userInfo?.followerCount > 0) return true;
    if (responseState.apiHits.userDetail > 0) return true;
    if (responseState.apiHits.itemList > 0) return true;
    const hasSsr = await page.evaluate(() => Boolean(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')));
    return hasSsr;
  }, timeoutMs);
}

async function waitForApiQuietWindow(responseState, quietWindowMs, maxWaitMs) {
  const startedAt = Date.now();
  return waitForCondition(() => {
    const idleFor = Date.now() - responseState.lastActivityAt;
    const waitedFor = Date.now() - startedAt;
    return idleFor >= quietWindowMs || waitedFor >= maxWaitMs;
  }, maxWaitMs, 100);
}

function countEligibleVideos(videoMap, excludeRecentHours = 0) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = excludeRecentHours > 0 ? now - excludeRecentHours * 3600 : 0;
  let count = 0;

  for (const video of videoMap.values()) {
    if (!video?.id) continue;
    const createTime = Number(video.createTime) || 0;
    if (cutoff > 0 && createTime > 0 && createTime > cutoff) continue;
    count += 1;
  }

  return count;
}

async function autoScrollProfileForApi(page, responseState, options = {}) {
  const targetVideoCount = Math.max(1, Number(options.targetVideoCount) || 30);
  const settleMs = Number(options.settleMs) || 1200;
  const excludeRecentHours = Number(options.excludeRecentHours) || 0;
  const username = normalizeUsername(options.username);
  let previousHeight = 0;
  let unchangedRounds = 0;
  let previousEligibleCount = countEligibleVideos(responseState.videoMap, excludeRecentHours);
  let previousApiHits = responseState.apiHits.itemList;

  while (true) {
    if (previousEligibleCount >= targetVideoCount) break;

    const beforeHeight = await page.evaluate(() => document.documentElement.scrollHeight);

    await page.evaluate(() => {
      window.scrollBy({ top: window.innerHeight, behavior: 'instant' });
    });

    await waitForCondition(async () => {
      if (responseState.apiHits.itemList > previousApiHits) return true;
      const currentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      return currentHeight > beforeHeight;
    }, settleMs, 120);

    const currentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const currentEligibleCount = countEligibleVideos(responseState.videoMap, excludeRecentHours);
    const currentApiHits = responseState.apiHits.itemList;
    const progressed = currentHeight > previousHeight
      || currentEligibleCount > previousEligibleCount
      || currentApiHits > previousApiHits;

    const line = `主页继续滚动 @${username || '-'} | 目标视频 ${targetVideoCount} | 可用视频 ${previousEligibleCount} -> ${currentEligibleCount} | 高度 ${beforeHeight} -> ${currentHeight}${progressed ? '' : ' | 当前轮无新增内容'}`;
    console.log(username ? formatAuthorLog(username, line) : line);

    if (!progressed) {
      unchangedRounds += 1;
      if (unchangedRounds >= 3) break;
    } else {
      unchangedRounds = 0;
    }

    previousHeight = currentHeight;
    previousEligibleCount = currentEligibleCount;
    previousApiHits = currentApiHits;
  }

  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}

function normalizeTikwmConfig(tikwmConfig = {}) {
  return {
    ...DEFAULT_TIKWM_CONFIG,
    ...(tikwmConfig || {}),
    pathMap: {
      ...DEFAULT_TIKWM_CONFIG.pathMap,
      ...(tikwmConfig?.pathMap || {}),
    },
  };
}

async function tikwmFetch(path, params = {}, options = {}) {
  const tikwmConfig = normalizeTikwmConfig(options.tikwm);
  const queryString = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
  const attempts = [];

  if (!tikwmConfig.paidBaseUrl || !tikwmConfig.apiKey) {
    return { result: null, source: '', attempts };
  }

  try {
    const paidPath = tikwmConfig.pathMap[path] || path;
    const paidUrl = `${tikwmConfig.paidBaseUrl}${paidPath}${queryString ? `?${queryString}` : ''}`;
    const paidResponse = await fetch(paidUrl, {
      headers: {
        'x-tikwmapi-key': tikwmConfig.apiKey,
      },
    });
    if (paidResponse.ok) {
      const result = await paidResponse.json();
      if (Number(result?.code) === 0) {
        attempts.push({ source: 'paid', success: true });
        return { result, source: 'paid', attempts };
      }
      attempts.push({ source: 'paid', success: false, code: Number(result?.code) || -1 });
    } else {
      attempts.push({ source: 'paid', success: false, httpStatus: paidResponse.status });
    }
  } catch (error) {
    attempts.push({ source: 'paid', success: false, errorMessage: error.message || String(error) });
  }

  return { result: null, source: '', attempts };
}

function isValidComment(text, existingTexts) {
  const trimmed = String(text || '').trim();
  if (trimmed.length < 2) return false;

  const withoutEmoji = trimmed.replace(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2700}-\u{27BF}\u{2B50}\u{2B55}\u{231A}-\u{23F3}\u{2934}-\u{2935}\u{25AA}-\u{25FE}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}\s]/gu,
    '',
  );
  if (withoutEmoji.length === 0) return false;
  if (existingTexts.has(trimmed.toLowerCase())) return false;
  return true;
}

async function fetchTikwmVideos(username, audienceConfig = {}) {
  try {
    const tikwmResponse = await tikwmFetch('/user/posts', {
      unique_id: username,
      count: 50,
    }, {
      tikwm: audienceConfig.tikwm,
    });
    const payload = tikwmResponse.result;
    if (!payload) return [];
    const videos = payload?.data?.videos || [];

    return videos.map((video) => ({
      id: String(video.video_id || video.id),
      desc: video.title || video.desc || '',
      createTime: Number(video.create_time || video.createTime) || 0,
      playCount: Number(video.play_count || video.playCount) || 0,
      diggCount: Number(video.digg_count || video.diggCount) || 0,
      commentCount: Number(video.comment_count || video.commentCount) || 0,
      shareCount: Number(video.share_count || video.shareCount) || 0,
      collectCount: 0,
    })).filter((video) => video.id && video.id !== 'undefined');
  } catch (error) {
    return [];
  }
}

function selectAudienceVideos(videos, audienceConfig = {}) {
  const recentVideoCount = Number(audienceConfig.recentVideoCount) || 30;
  const excludeRecentHours = Number(audienceConfig.excludeRecentHours) || 0;
  const now = Math.floor(Date.now() / 1000);
  const cutoff = excludeRecentHours > 0 ? now - excludeRecentHours * 3600 : 0;

  const eligible = (Array.isArray(videos) ? videos : [])
    .filter((video) => video?.id)
    .filter((video) => {
      if (cutoff <= 0) return true;
      return video.createTime === 0 || video.createTime <= cutoff;
    })
    .sort((a, b) => {
      if (a.createTime > 0 && b.createTime > 0) return b.createTime - a.createTime;
      if (a.createTime > 0) return -1;
      if (b.createTime > 0) return 1;
      return 0;
    })
    .slice(0, recentVideoCount)
    .sort((a, b) => (Number(b.commentCount) || 0) - (Number(a.commentCount) || 0));

  return eligible;
}

function summarizeTopCountries(countryCounts, limit = 5) {
  return Object.entries(countryCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([code, count]) => `${code}:${count}`)
    .join(', ');
}

function summarizeCountMap(countMap = {}) {
  return Object.entries(countMap)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${key}:${count}`)
    .join(', ');
}

function summarizeSelectedVideos(videos, limit = 5) {
  return (Array.isArray(videos) ? videos : [])
    .slice(0, limit)
    .map((video) => `${video.id}(评${video.commentCount || 0})`)
    .join(', ');
}

async function fetchAudienceCommentsFromTikwm(username, videos, audienceConfig = {}) {
  const debugEnabled = audienceConfig.debug !== false;
  const debugLogs = [];
  const addDebugLog = (message) => {
    const line = `[受众] @${username} ${message}`;
    if (debugEnabled) console.log(formatAuthorLog(username, line));
    if (debugLogs.length < MAX_AUDIENCE_DEBUG_LOGS) debugLogs.push(line);
  };

  if (!audienceConfig.enabled) {
    return {
      topCountry: '',
      topCountryPercentage: 0,
      sampleCount: 0,
      countryCounts: {},
      videosUsed: 0,
      failureReason: '未启用受众筛选',
      debugLogs,
    };
  }

  const sampleTarget = Number(audienceConfig.sampleTarget) || 200;
  const maxPagesPerVideo = Number(audienceConfig.maxPagesPerVideo) || 3;
  const maxUsersPerVideo = Number(audienceConfig.maxUsersPerVideo) || 80;
  const maxVideos = Number(audienceConfig.maxVideos) || 5;
  const selectedVideos = selectAudienceVideos(videos, audienceConfig);
  const initialVideos = selectedVideos.slice(0, maxVideos);
  const commentUsers = new Map();
  const commentTexts = new Set();
  let videosUsed = 0;
  let requestFailures = 0;
  let nonZeroCodeFailures = 0;
  const httpStatusCounts = {};
  const businessCodeCounts = {};
  let totalPagesFetched = 0;
  let totalCommentsFetched = 0;
  let totalValidRegions = 0;
  let totalMissingRegion = 0;
  let totalMissingUid = 0;
  let totalDuplicates = 0;
  let totalInvalidText = 0;
  const failureExamples = [];

  const addFailureExample = (message) => {
    if (failureExamples.length < 5) failureExamples.push(message);
  };

  addDebugLog(`开始抓取受众样本，候选视频 ${Array.isArray(videos) ? videos.length : 0} 条，排序后 ${selectedVideos.length} 条，首批 ${initialVideos.length} 条，目标样本 ${sampleTarget}`);
  if (initialVideos.length > 0) {
    addDebugLog(`首批视频：${summarizeSelectedVideos(initialVideos)}`);
  }
  if (selectedVideos.length > initialVideos.length) {
    addDebugLog(`后续补抓视频池：${selectedVideos.length - initialVideos.length} 条，首批样本不足时继续抓取`);
  }
  if (selectedVideos.length === 0) {
    addDebugLog('没有可用于抓评论的候选视频');
  }

  for (let videoIndex = 0; videoIndex < selectedVideos.length; videoIndex += 1) {
    const video = selectedVideos[videoIndex];
    if (commentUsers.size >= sampleTarget) break;
    if (videoIndex === initialVideos.length && initialVideos.length > 0 && commentUsers.size < sampleTarget) {
      addDebugLog(`首批 ${initialVideos.length} 条视频样本不足，继续补抓后续 ${selectedVideos.length - initialVideos.length} 条视频`);
    }
    let videoSamples = 0;
    let videoContributed = false;
    let videoCommentsFetched = 0;
    let videoValidRegions = 0;
    let videoMissingRegion = 0;
    let videoMissingUid = 0;
    let videoDuplicates = 0;
    let videoInvalidText = 0;

    for (let page = 0; page < maxPagesPerVideo; page += 1) {
      if (commentUsers.size >= sampleTarget) break;
      if (videoSamples >= maxUsersPerVideo) break;

      try {
        const tikwmResponse = await tikwmFetch('/comment/list', {
          url: `https://www.tiktok.com/@${username}/video/${video.id}`,
          count: 50,
          cursor: page * 50,
        }, {
          tikwm: audienceConfig.tikwm,
        });
        const failedAttempts = tikwmResponse.attempts.filter((item) => !item.success);

        for (const attempt of failedAttempts) {
          if (attempt.httpStatus) {
            requestFailures += 1;
            httpStatusCounts[attempt.httpStatus] = (httpStatusCounts[attempt.httpStatus] || 0) + 1;
            addFailureExample(`视频 ${video.id} 第 ${page + 1} 页付费接口 HTTP ${attempt.httpStatus}`);
          } else if (attempt.code !== undefined) {
            nonZeroCodeFailures += 1;
            businessCodeCounts[attempt.code] = (businessCodeCounts[attempt.code] || 0) + 1;
            addFailureExample(`视频 ${video.id} 第 ${page + 1} 页付费接口 code=${attempt.code}`);
          } else if (attempt.errorMessage) {
            requestFailures += 1;
            httpStatusCounts.EXCEPTION = (httpStatusCounts.EXCEPTION || 0) + 1;
            addFailureExample(`视频 ${video.id} 第 ${page + 1} 页付费接口异常：${attempt.errorMessage}`);
          }
        }

        if (!tikwmResponse.result) {
          break;
        }
        const result = tikwmResponse.result;
        const comments = result.data?.comments || [];
        totalPagesFetched += 1;
        totalCommentsFetched += comments.length;
        videoCommentsFetched += comments.length;
        if (comments.length === 0) break;

        for (const comment of comments) {
          if (commentUsers.size >= sampleTarget) break;
          if (videoSamples >= maxUsersPerVideo) break;

          const uid = String(comment.user?.uid || comment.user?.id || '').trim();
          const region = String(comment.user?.region || '').trim().toUpperCase();
          if (!uid) {
            totalMissingUid += 1;
            videoMissingUid += 1;
            continue;
          }
          if (!region) {
            totalMissingRegion += 1;
            videoMissingRegion += 1;
            continue;
          }
          if (commentUsers.has(uid)) {
            totalDuplicates += 1;
            videoDuplicates += 1;
            continue;
          }
          if (!isValidComment(comment.text || '', commentTexts)) {
            totalInvalidText += 1;
            videoInvalidText += 1;
            continue;
          }

          commentUsers.set(uid, region);
          commentTexts.add(String(comment.text || '').trim().toLowerCase());
          videoSamples += 1;
          videoContributed = true;
          totalValidRegions += 1;
          videoValidRegions += 1;
        }

        if (!result.data?.hasMore) break;
      } catch (error) {
        requestFailures += 1;
        httpStatusCounts.EXCEPTION = (httpStatusCounts.EXCEPTION || 0) + 1;
        addFailureExample(`视频 ${video.id} 第 ${page + 1} 页请求异常：${error.message || String(error)}`);
        break;
      }
    }

    if (videoContributed) videosUsed += 1;
  }

  const countryCounts = {};
  for (const region of commentUsers.values()) {
    countryCounts[region] = (countryCounts[region] || 0) + 1;
  }

  const sortedCountries = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]);
  const topCountry = sortedCountries[0]?.[0] || '';
  const topCountryCount = sortedCountries[0]?.[1] || 0;
  const sampleCount = commentUsers.size;
  const topCountryPercentage = sampleCount > 0 ? Number(((topCountryCount / sampleCount) * 100).toFixed(1)) : 0;
  let failureReason = '';

  if (selectedVideos.length === 0) {
    failureReason = '没有可用于受众分析的视频';
  } else if (sampleCount === 0) {
    if (requestFailures > 0 || nonZeroCodeFailures > 0) {
      const reasonParts = [];
      if (requestFailures > 0) {
        const httpSummary = summarizeCountMap(httpStatusCounts);
        reasonParts.push(httpSummary ? `HTTP失败 ${requestFailures} 次（${httpSummary}）` : `HTTP失败 ${requestFailures} 次`);
      }
      if (nonZeroCodeFailures > 0) {
        const codeSummary = summarizeCountMap(businessCodeCounts);
        reasonParts.push(codeSummary ? `业务失败 ${nonZeroCodeFailures} 次（${codeSummary}）` : `业务失败 ${nonZeroCodeFailures} 次`);
      }
      failureReason = `评论接口失败：${reasonParts.join('，')}`;
    } else if (totalCommentsFetched === 0) {
      failureReason = '评论接口返回为空';
    } else if (totalMissingRegion > 0 && totalValidRegions === 0) {
      failureReason = `评论用户缺少地区字段：${totalMissingRegion} 条`;
    } else {
      failureReason = '未拿到有效受众地区样本';
    }
  }

  addDebugLog(`受众抓取完成：样本 ${sampleCount}，主国家 ${topCountry || '-'}，占比 ${topCountryPercentage}% ，使用视频 ${videosUsed}/${selectedVideos.length}，总评论 ${totalCommentsFetched}，有效地区 ${totalValidRegions}`);
  addDebugLog(`受众摘要：页数 ${totalPagesFetched}，缺少地区 ${totalMissingRegion}，缺少UID ${totalMissingUid}，无效评论 ${totalInvalidText}，重复用户 ${totalDuplicates}`);
  if (sampleCount > 0) {
    addDebugLog(`国家分布 Top5：${summarizeTopCountries(countryCounts)}`);
  }
  if (requestFailures > 0 || nonZeroCodeFailures > 0) {
    const httpSummary = summarizeCountMap(httpStatusCounts);
    const codeSummary = summarizeCountMap(businessCodeCounts);
    addDebugLog(`接口失败摘要：${[
      httpSummary ? `HTTP ${httpSummary}` : '',
      codeSummary ? `业务码 ${codeSummary}` : '',
    ].filter(Boolean).join('，')}`);
  }
  if (failureExamples.length > 0) {
    addDebugLog(`失败样例：${failureExamples.join(' | ')}`);
  }
  if (failureReason) {
    addDebugLog(`失败原因：${failureReason}`);
  }

  return {
    topCountry,
    topCountryPercentage,
    sampleCount,
    countryCounts,
    videosUsed,
    failureReason,
    debugLogs,
    debugStats: {
      selectedVideoCount: selectedVideos.length,
      initialVideoCount: initialVideos.length,
      videosUsed,
      pagesFetched: totalPagesFetched,
      commentsFetched: totalCommentsFetched,
      validRegions: totalValidRegions,
      missingRegion: totalMissingRegion,
      missingUid: totalMissingUid,
      invalidCommentText: totalInvalidText,
      duplicates: totalDuplicates,
      requestFailures,
      nonZeroCodeFailures,
      httpStatusCounts,
      businessCodeCounts,
      failureExamples,
    },
  };
}

async function collectUserProfile(page, input, options = {}) {
  const username = normalizeUsername(input);
  if (!username) throw new Error(`无效用户名: ${input}`);

  const merged = { ...DEFAULTS, ...options };
  const targetUrl = `https://www.tiktok.com/@${username}`;
  const responseState = {
    userInfo: null,
    videoMap: new Map(),
    apiHits: { userDetail: 0, itemList: 0 },
    lastActivityAt: Date.now(),
  };

  const responseHandler = async (response) => {
    const url = response.url();
    if (!response.ok()) return;

    try {
      if (url.includes('/api/user/detail')) {
        const payload = await response.json();
        const parsed = parseUserDetailPayload(payload);
        if (parsed) {
          responseState.userInfo = mergeUserInfo(responseState.userInfo, parsed);
          responseState.apiHits.userDetail += 1;
          responseState.lastActivityAt = Date.now();
        }
      } else if (url.includes('/api/post/item_list')) {
        const payload = await response.json();
        const items = parseVideoListPayload(payload);
        items.forEach((item) => mergeVideoMap(responseState.videoMap, item, 2));
        responseState.apiHits.itemList += 1;
        responseState.lastActivityAt = Date.now();
      }
    } catch (error) {}
  };

  page.on('response', responseHandler);

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: merged.timeoutMs });
    await waitForProfileSignals(page, responseState, merged.profileApiWaitMs);

    const pageUser = await extractUserFromPage(page);
    responseState.userInfo = mergeUserInfo(responseState.userInfo, pageUser);

    if (responseState.videoMap.size === 0) {
      const domInitial = await extractVideosFromDom(page);
      domInitial.forEach((video) => mergeVideoMap(responseState.videoMap, video, 1));
    }

    await autoScrollProfileForApi(page, responseState, {
      username,
      targetVideoCount: merged.targetVideoCount,
      settleMs: merged.scrollSettleMs,
      excludeRecentHours: merged.excludeRecentHours,
    });
    await waitForApiQuietWindow(responseState, Math.min(merged.scrollSettleMs, 800), merged.profileApiWaitMs);

    if (responseState.videoMap.size === 0 || responseState.apiHits.itemList === 0) {
      const domAfterScroll = await extractVideosFromDom(page);
      domAfterScroll.forEach((video) => mergeVideoMap(responseState.videoMap, video, 1));
    }

    if (responseState.videoMap.size === 0) {
      const fallbackVideos = await fetchTikwmVideos(username, merged.audience || {});
      fallbackVideos.forEach((video) => mergeVideoMap(responseState.videoMap, video, 2));
    }

    const videos = [...responseState.videoMap.values()]
      .map((video) => ({
        ...video,
        playCount: video.playCount || parseCountText(video.playCount),
        createTime: video.createTime || extractTimestampFromVideoId(video.id),
      }))
      .filter((video) => video.id);

    const audience = await fetchAudienceCommentsFromTikwm(username, videos, {
      ...(merged.audience || {}),
      excludeRecentHours: merged.audience?.excludeRecentHours ?? 24,
    });

    return {
      username,
      profileUrl: targetUrl,
      userInfo: responseState.userInfo || { uniqueId: username, followerCount: 0 },
      videos,
      audience,
      apiHits: responseState.apiHits,
      pageTitle: await page.title(),
    };
  } finally {
    page.off('response', responseHandler);
  }
}

module.exports = {
  createBrowserSession,
  createPage,
  launchBrowser,
  ensureTikTokAuth,
  collectAuthorsFromSearch,
  extractAuthorsFromCurrentSearchViewport,
  openSearchPage,
  scrollSearchResults,
  collectUserProfile,
  getChromeDataDir,
};
