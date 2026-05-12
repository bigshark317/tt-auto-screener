const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCount(text) {
  const cleaned = String(text || '').replace(/,/g, '').trim();
  const match = cleaned.match(/([\d.]+)\s*([KkMmBb])?/);
  if (!match) return 0;
  let value = Number.parseFloat(match[1]);
  const unit = (match[2] || '').toUpperCase();
  if (unit === 'K') value *= 1000;
  if (unit === 'M') value *= 1000000;
  if (unit === 'B') value *= 1000000000;
  return Math.round(value);
}

function normalizeUsername(input) {
  return String(input || '').replace(/^@/, '').replace(/\/+$/, '').trim();
}

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

function parseAuthorFromHref(href) {
  const match = String(href || '').match(/(?:tiktok\.com)?\/@([^/?#]+)(?:\/video\/(\d+))?/i);
  if (!match) return null;
  return {
    username: normalizeUsername(decodeURIComponent(match[1])),
    videoId: match[2] || '',
  };
}

function findVideoCard(element) {
  const selectors = [
    '[data-e2e*="search"]',
    '[data-e2e*="recommend"]',
    '[data-e2e*="explore"]',
    '[class*="DivItemContainer"]',
    '[class*="video-feed-item"]',
    '[class*="SearchItem"]',
    'article',
  ];
  const matched = element.closest(selectors.join(','));
  if (matched) return matched;

  let current = element.parentElement;
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (current.querySelector?.('a[href*="/video/"]')) return current;
    current = current.parentElement;
  }
  return element;
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
  const videoLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'));

  for (const link of videoLinks) {
    const href = link.href || '';
    const parsed = parseAuthorFromHref(href);
    if (!parsed?.username) continue;
    const card = findVideoCard(link);
    const sourceText = (card?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    pushAuthor(results, seen, {
      username: parsed.username,
      sourceVideoUrl: href,
      sourceText,
    });
  }

  const profileLinks = Array.from(document.querySelectorAll('a[href*="/@"]:not([href*="/video/"])'));
  for (const link of profileLinks) {
    const parsed = parseAuthorFromHref(link.href || '');
    if (!parsed?.username || seen.has(parsed.username)) continue;
    const card = findVideoCard(link);
    const videoLink = card?.querySelector?.('a[href*="/video/"]')?.href || '';
    const videoAuthor = parseAuthorFromHref(videoLink)?.username;
    if (videoAuthor && videoAuthor !== parsed.username) continue;
    const sourceText = (card?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    pushAuthor(results, seen, {
      username: parsed.username,
      sourceVideoUrl: videoLink,
      sourceText,
    });
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

function parseSsrUser() {
  const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
  if (!el) return null;
  try {
    const payload = JSON.parse(el.textContent || '{}');
    const userInfo = payload?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
    if (!userInfo) return null;
    return {
      uid: userInfo.user?.id || '',
      uniqueId: userInfo.user?.uniqueId || '',
      nickname: userInfo.user?.nickname || '',
      signature: userInfo.user?.signature || '',
      secUid: userInfo.user?.secUid || '',
      verified: Boolean(userInfo.user?.verified),
      followerCount: Number(userInfo.stats?.followerCount) || 0,
      followingCount: Number(userInfo.stats?.followingCount) || 0,
      heartCount: Number(userInfo.stats?.heartCount) || 0,
      videoCount: Number(userInfo.stats?.videoCount) || 0,
    };
  } catch (error) {
    return null;
  }
}

function extractUserFromDom(username) {
  const ssrUser = parseSsrUser();
  const followerText = document.querySelector('[data-e2e="followers-count"]')?.textContent || '';
  const nickname = document.querySelector('[data-e2e="user-title"]')?.textContent?.trim() || '';
  const signature = document.querySelector('[data-e2e="user-bio"]')?.textContent?.trim() || '';

  return {
    uniqueId: ssrUser?.uniqueId || username,
    nickname: ssrUser?.nickname || nickname,
    signature: ssrUser?.signature || signature,
    followerCount: ssrUser?.followerCount || parseCount(followerText),
    followingCount: ssrUser?.followingCount || 0,
    heartCount: ssrUser?.heartCount || 0,
    videoCount: ssrUser?.videoCount || 0,
    verified: Boolean(ssrUser?.verified),
  };
}

function extractVideosFromDom() {
  const cards = Array.from(document.querySelectorAll('[data-e2e="user-post-item"], a[href*="/video/"]'));
  const seen = new Set();
  const videos = [];

  for (const item of cards) {
    const card = item.matches?.('a[href*="/video/"]') ? item.parentElement : item;
    const link = item.matches?.('a[href*="/video/"]') ? item : card?.querySelector?.('a[href*="/video/"]');
    const href = link?.href || '';
    const match = href.match(/\/video\/(\d+)/);
    if (!match) continue;
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);

    const text = card?.textContent || link?.textContent || '';
    const viewsEl = card?.querySelector?.('[data-e2e="video-views"], strong[data-e2e="video-views"], [class*="VideoCount"], [class*="video-count"]');
    const playCount = parseCount(viewsEl?.textContent || text);
    videos.push({
      id,
      url: href,
      desc: '',
      createTime: extractTimestampFromVideoId(id),
      playCount,
      diggCount: 0,
      commentCount: 0,
      shareCount: 0,
    });
  }

  return videos;
}

async function collectProfile(options = {}) {
  const username = normalizeUsername(options.username || location.pathname.match(/^\/@([^/?#]+)/)?.[1] || '');
  const targetVideoCount = Math.max(1, Number(options.targetVideoCount) || 30);
  const waitMs = Number(options.waitMs) || 1500;
  let videos = extractVideosFromDom();
  let unchangedRounds = 0;

  while (videos.length < targetVideoCount && unchangedRounds < 3) {
    const beforeCount = videos.length;
    await scrollPage(waitMs);
    videos = extractVideosFromDom();
    unchangedRounds = videos.length > beforeCount ? 0 : unchangedRounds + 1;
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
  await sleep(300);
  const userInfo = extractUserFromDom(username);
  const emails = extractEmails(`${userInfo.signature || ''} ${getPageText()}`);

  return {
    username,
    profileUrl: `https://www.tiktok.com/@${username}`,
    userInfo,
    videos,
    contactEmail: emails[0] || '',
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
