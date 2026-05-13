const { SHARED_CONFIG, isValidComment, detectLanguage } = require('./bb-tt-language');

const DEFAULT_AUDIENCE = {
  enabled: true,
  requiredTopCountry: 'US',
  minSampleCount: 200,
  minTopCountryPercentage: 50,
  sampleVideoCount: 5,
  commentsPerVideo: 50,
  targetSampleSize: 200,
  maxPagesPerVideo: 3,
  maxSamplesPerVideo: 80,
};

const DEFAULT_TIKWM = {
  freeBaseUrl: 'https://www.tikwm.com/api',
  paidBaseUrl: 'https://api.tikwmapi.com',
  apiKey: 'c80f5c0c36383df2f63b2466f2e4ea6c',
  authHeader: 'x-tikwmapi-key',
};

function noop() {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatNumber(value) {
  const num = Number(value) || 0;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

function isCountAtLeast(actual, required) {
  const actualNumber = Number(actual) || 0;
  const requiredNumber = Number(required) || 0;
  if (actualNumber >= requiredNumber) return true;
  return requiredNumber >= 1000 && formatNumber(actualNumber) === formatNumber(requiredNumber);
}

function getLevels(rules) {
  return Array.isArray(rules?.levels) ? rules.levels.filter(Boolean) : [];
}

function getStablePercent(level) {
  const value = Number(level?.stablePercent);
  return value > 0 && value <= 1 ? value : 0.9;
}

function excludeRecentVideos(videos, rules) {
  const excludeRecentHours = Number(rules?.excludeRecentHours) || 0;
  if (excludeRecentHours <= 0) return [...videos];
  const cutoff = Math.floor(Date.now() / 1000) - excludeRecentHours * 3600;
  return videos.filter((video) => !video.createTime || video.createTime <= cutoff);
}

function sortByRecency(videos) {
  return [...videos].sort((a, b) => {
    if (a.createTime && b.createTime) return b.createTime - a.createTime;
    if (a.createTime) return -1;
    if (b.createTime) return 1;
    return 0;
  });
}

function classifyFollowerTier(followerCount, rules) {
  const count = Number(followerCount) || 0;
  for (const level of getLevels(rules)) {
    if (count >= (Number(level.minFollowers) || 0)) {
      return { tier: level.key, tierLabel: level.label || level.key };
    }
  }
  return { tier: null, tierLabel: '未达合作标准' };
}

function buildTierMetrics(level, followerCount, allVideos, rules) {
  const recentVideoCount = Number(level.recentVideoCount) || 0;
  const selectedVideos = sortByRecency(excludeRecentVideos(allVideos, rules))
    .slice(0, recentVideoCount || undefined);
  const playCounts = selectedVideos
    .map((video) => Number(video.playCount) || 0)
    .sort((a, b) => a - b);
  const stablePercent = getStablePercent(level);
  const cutIndex = Math.floor(playCounts.length * (1 - stablePercent));
  const minPlay = playCounts[0] || 0;
  const stablePlay = playCounts.length > cutIndex ? playCounts[cutIndex] : 0;
  const checks = [
    {
      label: '粉丝量',
      required: Number(level.minFollowers) || 0,
      actual: followerCount,
      ok: followerCount >= (Number(level.minFollowers) || 0),
    },
    {
      label: '稳定播放量',
      required: Number(level.stablePlay) || 0,
      actual: stablePlay,
      ok: isCountAtLeast(stablePlay, Number(level.stablePlay) || 0),
    },
    {
      label: '最低播放量',
      required: Number(level.minPlay) || 0,
      actual: minPlay,
      ok: isCountAtLeast(minPlay, Number(level.minPlay) || 0),
    },
  ];

  return {
    tier: level.key,
    tierLabel: level.label || level.key,
    selectedVideos,
    stablePercent,
    minPlay,
    stablePlay,
    play2ndLowest: playCounts[1] || 0,
    play3rdLowest: playCounts[2] || 0,
    passed: checks.every((item) => item.ok),
    checks,
  };
}

function summarizeFailure(bestMetrics, levels) {
  const target = bestMetrics || levels[0];
  const failedChecks = (target?.checks || []).filter((check) => !check.ok);
  if (failedChecks.length === 0) return '未命中任何等级';
  return failedChecks
    .map((check) => `${check.label} ${formatNumber(check.actual)}/${formatNumber(check.required)}`)
    .join('，');
}

function formatCheck(check) {
  return `${check.ok ? '✓' : '×'}${check.label} ${formatNumber(check.actual)}/${formatNumber(check.required)}`;
}

function logTierDetails(username, tierMetrics, log = noop) {
  for (const metrics of tierMetrics) {
    const details = metrics.checks.map(formatCheck).join(' | ');
    log(`等级明细 | @${username} | ${metrics.tierLabel} | ${metrics.passed ? '通过' : '未通过'} | 选取视频 ${metrics.selectedVideos.length} | ${details}`);
  }
}

function normalizeCountry(value) {
  return String(value || '').trim().toUpperCase();
}

function findFirstString(value, keys) {
  if (!value || typeof value !== 'object') return '';
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key];
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      const found = findFirstString(nested, keys);
      if (found) return found;
    }
  }
  return '';
}

function getCommentCountry(comment) {
  return normalizeCountry(findFirstString(comment, [
    'region',
    'region_code',
    'country',
    'country_code',
    'location',
  ]));
}

function getCommentUserId(comment) {
  const user = comment?.user || comment?.author || comment?.userInfo || comment?.user_info || {};
  return String(user.uid || user.id || user.user_id || user.userId || '').trim();
}

function extractComments(payload) {
  const candidates = [
    payload?.data?.comments,
    payload?.data?.comment_list,
    payload?.data?.comments_list,
    payload?.comments,
    payload?.comment_list,
  ];
  for (const item of candidates) {
    if (Array.isArray(item)) return item;
  }
  return [];
}

function buildCommentUrl(baseUrl, endpointTemplate, videoId, username, count, cursor) {
  const videoUrl = `https://www.tiktok.com/@${username || '_'}/video/${videoId}`;
  if (endpointTemplate) {
    return endpointTemplate
      .replace(/\{baseUrl\}/g, baseUrl.replace(/\/+$/, ''))
      .replace(/\{videoId\}/g, encodeURIComponent(videoId))
      .replace(/\{videoUrl\}/g, encodeURIComponent(videoUrl))
      .replace(/\{count\}/g, encodeURIComponent(count))
      .replace(/\{cursor\}/g, encodeURIComponent(cursor));
  }
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/comment/list`);
  url.searchParams.set('url', videoUrl);
  url.searchParams.set('count', String(count));
  url.searchParams.set('cursor', String(cursor));
  return url.toString();
}

async function fetchTikwmJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function requestTikwmCommentPage(videoId, username, count, cursor, audienceRules) {
  const freeBaseUrl = process.env.TT_TIKWM_BASE_URL || audienceRules.baseUrl || DEFAULT_TIKWM.freeBaseUrl;
  const paidBaseUrl = process.env.TT_TIKWM_PAID_BASE_URL || audienceRules.paidBaseUrl || DEFAULT_TIKWM.paidBaseUrl;
  const endpointTemplate = process.env.TT_TIKWM_COMMENT_ENDPOINT || audienceRules.commentEndpoint || '';
  const apiKey = process.env.TT_TIKWM_API_KEY || audienceRules.apiKey || DEFAULT_TIKWM.apiKey;
  const authHeader = process.env.TT_TIKWM_AUTH_HEADER || audienceRules.authHeader || DEFAULT_TIKWM.authHeader;
  const freeUrl = buildCommentUrl(freeBaseUrl, endpointTemplate, videoId, username, count, cursor);
  const paidUrl = buildCommentUrl(paidBaseUrl, '', videoId, username, count, cursor);

  try {
    const { response, payload } = await fetchTikwmJson(freeUrl);
    if (response.ok && !(payload?.code < 0)) {
      return payload;
    }
  } catch (error) {
  }

  if (!apiKey) {
    throw new Error('TikWM 评论接口失败: 免费接口不可用，且未配置付费 API key');
  }

  try {
    const { response, payload } = await fetchTikwmJson(paidUrl, {
      headers: { [authHeader]: apiKey },
    });
    const message = payload?.msg || payload?.message || '';
    if (response.ok && !(payload?.code < 0)) {
      return payload;
    }
    throw new Error(message || `paid API HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`TikWM 评论接口失败: ${error?.message || String(error)}`);
  }
}

function sortAudienceVideos(videos) {
  return [...videos].sort((a, b) => {
    const commentDelta = (Number(b?.commentCount) || 0) - (Number(a?.commentCount) || 0);
    if (commentDelta !== 0) return commentDelta;
    return (Number(b?.createTime) || 0) - (Number(a?.createTime) || 0);
  });
}

function selectAudienceVideos(profile) {
  const followerCount = Number(profile?.userInfo?.followerCount) || 0;
  const videoRules = followerCount >= 200000
    ? { recentCount: 30, excludeWithin24h: true }
    : { recentCount: 20, excludeWithin24h: true, sevenDayThreshold: 21 };
  const allVideos = Array.isArray(profile?.videos) ? profile.videos : [];
  const now = Math.floor(Date.now() / 1000);

  let eligible = allVideos.filter((video) => Number(video?.playCount) > 0 || Number(video?._statsPriority || 0) >= 2);
  if (eligible.length === 0) eligible = allVideos;

  if (videoRules.excludeWithin24h) {
    const oneDayAgo = now - 24 * 3600;
    const filtered = eligible.filter((video) => video.createTime === 0 || video.createTime <= oneDayAgo);
    if (filtered.length > 0) eligible = filtered;
  }

  if (videoRules.sevenDayThreshold) {
    const sevenDaysAgo = now - 7 * 24 * 3600;
    const withTime = eligible.filter((video) => Number(video.createTime) > 0);
    const last7days = withTime.filter((video) => Number(video.createTime) >= sevenDaysAgo);
    if (last7days.length >= videoRules.sevenDayThreshold) return last7days;
  }

  return [...eligible].sort((a, b) => {
    if (a.createTime > 0 && b.createTime > 0) return b.createTime - a.createTime;
    if (a.createTime > 0) return -1;
    if (b.createTime > 0) return 1;
    return 0;
  }).slice(0, videoRules.recentCount);
}

async function collectAudienceSamplesForVideo(video, username, audienceRules, sampleUsers, sampleTexts, commentLangTexts) {
  const videoId = video?.id;
  if (!videoId) return 0;

  const targetSampleSize = Math.max(1, Number(audienceRules.targetSampleSize) || DEFAULT_AUDIENCE.targetSampleSize);
  const pageSize = Math.min(50, Math.max(1, Number(audienceRules.commentsPerVideo) || DEFAULT_AUDIENCE.commentsPerVideo));
  const maxPages = Math.max(1, Number(audienceRules.maxPagesPerVideo) || DEFAULT_AUDIENCE.maxPagesPerVideo);
  const maxSamplesPerVideo = Math.max(1, Number(audienceRules.maxSamplesPerVideo) || DEFAULT_AUDIENCE.maxSamplesPerVideo);
  let addedForVideo = 0;

  for (let page = 0; page < maxPages; page += 1) {
    if (sampleUsers.size >= targetSampleSize || addedForVideo >= maxSamplesPerVideo) break;

    const cursor = page * pageSize;
    const payload = await requestTikwmCommentPage(videoId, username, pageSize, cursor, audienceRules);
    const pageComments = extractComments(payload);

    if (pageComments.length === 0) break;

    for (const comment of pageComments) {
      if (sampleUsers.size >= targetSampleSize || addedForVideo >= maxSamplesPerVideo) break;

      const uid = getCommentUserId(comment);
      const country = getCommentCountry(comment);
      const text = String(comment?.text || '');

      if (!uid || !country) continue;
      if (sampleUsers.has(uid)) continue;
      if (!isValidComment(text, sampleTexts)) continue;

      sampleUsers.set(uid, country);
      sampleTexts.add(text.trim().toLowerCase());
      if (commentLangTexts.length < targetSampleSize && text.trim().length >= 3) {
        commentLangTexts.push(text.trim());
      }
      addedForVideo += 1;
    }

    if (pageComments.length < pageSize || payload?.data?.hasMore === false) break;
    if (page + 1 < maxPages && sampleUsers.size < targetSampleSize && addedForVideo < maxSamplesPerVideo) {
      await sleep(1200);
    }
  }
  return addedForVideo;
}

async function evaluateAudience(profile, rules, log = noop) {
  const audienceRules = {
    ...DEFAULT_AUDIENCE,
    ...(rules?.audience || {}),
    enabled: true,
  };
  if (!audienceRules.enabled) {
    log(`受众分析跳过 | @${profile.username} | 未启用受众筛选`);
    return {
      passed: true,
      topCountry: '',
      topCountryPercentage: 0,
      sampleCount: 0,
      failureReason: '',
    };
  }

  const requiredCountry = normalizeCountry(audienceRules.requiredTopCountry || 'US');
  const targetSampleSize = Math.max(1, Number(audienceRules.targetSampleSize) || DEFAULT_AUDIENCE.targetSampleSize);
  const recentVideos = selectAudienceVideos(profile);
  const videos = sortAudienceVideos(recentVideos);
  if (videos.length === 0) {
    log(`受众分析失败 | @${profile.username} | 无可分析视频`);
    return {
      passed: false,
      topCountry: '',
      topCountryPercentage: 0,
      sampleCount: 0,
      videosAnalyzed: 0,
      uniqueCountries: 0,
      confidence: '不足',
      regions: [],
      language: '',
      languageDetail: {
        distribution: {},
        regionInferred: [],
        eldDetected: {},
        agreement: '不足',
        sampleCount: 0,
        method: '',
      },
      failureReason: '无可分析视频',
    };
  }

  const firstBatchSize = Math.max(1, Number(audienceRules.sampleVideoCount) || DEFAULT_AUDIENCE.sampleVideoCount);
  const firstBatch = videos.slice(0, firstBatchSize);
  const remainingBatch = videos.slice(firstBatch.length);
  log(`受众分析开始 | @${profile.username} | 可用视频 ${videos.length} | 首批 ${firstBatch.length} | 目标国家 ${requiredCountry} | 目标样本 ${targetSampleSize}`);

  const sampleUsers = new Map();
  const sampleTexts = new Set();
  const commentLangTexts = [];
  const errors = [];

  async function collectBatch(batchVideos) {
    await Promise.allSettled(batchVideos.map(async (video) => {
      if (sampleUsers.size >= targetSampleSize) return;
      try {
        await collectAudienceSamplesForVideo(
          video,
          profile.username,
          audienceRules,
          sampleUsers,
          sampleTexts,
          commentLangTexts,
        );
      } catch (error) {
        log(`评论采样失败 | video ${video?.id || '-'} | ${error?.message || String(error)}`);
        errors.push(`${video?.id || '-'}: ${error?.message || String(error)}`);
      }
    }));
  }

  await collectBatch(firstBatch);
  if (sampleUsers.size < targetSampleSize && remainingBatch.length > 0) {
    log(`受众分析补样本 | @${profile.username} | 首批后样本 ${sampleUsers.size} | 继续视频 ${remainingBatch.length}`);
    await collectBatch(remainingBatch);
  }

  const countryCounts = new Map();
  for (const country of sampleUsers.values()) {
    countryCounts.set(country, (countryCounts.get(country) || 0) + 1);
  }

  const sampleCount = sampleUsers.size;
  const regionCountsObject = Object.fromEntries(countryCounts.entries());
  const profileTexts = [];
  if (profile.userInfo?.signature) profileTexts.push(profile.userInfo.signature);
  for (const video of videos.slice(0, 20)) {
    if (video?.desc) profileTexts.push(video.desc);
  }
  const languageDetail = detectLanguage(profileTexts, commentLangTexts, regionCountsObject, sampleCount);
  const regions = [...countryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({
      code,
      count,
      percentage: sampleCount > 0 ? Number(((count / sampleCount) * 100).toFixed(1)) : 0,
      name: SHARED_CONFIG.countryNames[code] || code,
    }));
  const [topCountry = '', topCount = 0] = [...countryCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0] || [];
  const topCountryPercentage = sampleCount > 0 ? Math.round((topCount / sampleCount) * 100) : 0;
  const confidence = sampleCount >= 500 ? '高' : sampleCount >= 200 ? '中' : sampleCount >= 50 ? '低' : '不足';
  const minSampleCount = Math.max(0, Number(audienceRules.minSampleCount) || 0);
  const minTopCountryPercentage = Math.max(0, Number(audienceRules.minTopCountryPercentage) || 0);
  log(`受众分析结果 | @${profile.username} | 主国家 ${topCountry || '未知'} | 占比 ${topCountryPercentage}% | 样本 ${sampleCount}`);

  if (sampleCount < minSampleCount) {
    return {
      passed: false,
      topCountry,
      topCountryPercentage,
      sampleCount,
      videosAnalyzed: videos.length,
      uniqueCountries: regions.length,
      confidence,
      regions,
      language: languageDetail.language,
      languageDetail,
      failureReason: `受众样本不足 ${sampleCount}/${minSampleCount}${errors.length ? `；${errors[0]}` : ''}`,
    };
  }
  if (topCountry !== requiredCountry) {
    return {
      passed: false,
      topCountry,
      topCountryPercentage,
      sampleCount,
      videosAnalyzed: videos.length,
      uniqueCountries: regions.length,
      confidence,
      regions,
      language: languageDetail.language,
      languageDetail,
      failureReason: `主受众国家 ${topCountry || '未知'} 不等于 ${requiredCountry}`,
    };
  }
  if (topCountryPercentage < minTopCountryPercentage) {
    return {
      passed: false,
      topCountry,
      topCountryPercentage,
      sampleCount,
      videosAnalyzed: videos.length,
      uniqueCountries: regions.length,
      confidence,
      regions,
      language: languageDetail.language,
      languageDetail,
      failureReason: `主受众占比 ${topCountryPercentage}% 低于 ${minTopCountryPercentage}%`,
    };
  }

  return {
    passed: true,
    topCountry,
    topCountryPercentage,
    sampleCount,
    videosAnalyzed: videos.length,
    uniqueCountries: regions.length,
    confidence,
    regions,
    language: languageDetail.language,
    languageDetail,
    failureReason: '',
  };
}

async function analyzeProfile(profile, rules, options = {}) {
  const log = options.log || noop;
  const followerCount = Number(profile.userInfo?.followerCount) || 0;
  const videos = Array.isArray(profile.videos) ? profile.videos : [];
  log(`开始分析 | @${profile.username} | 粉丝 ${formatNumber(followerCount)} | 视频 ${videos.length}`);
  const followerTier = classifyFollowerTier(followerCount, rules);
  const tierMetrics = getLevels(rules).map((level) => buildTierMetrics(level, followerCount, videos, rules));
  const bestQualified = tierMetrics.find((item) => item.passed) || null;
  const activeMetrics = bestQualified || tierMetrics.find((item) => item.tier === followerTier.tier) || tierMetrics[0] || null;
  const audienceCheck = await evaluateAudience(profile, rules, log);
  const isQualified = Boolean(bestQualified && audienceCheck.passed);
  log(`分析完成 | @${profile.username} | ${isQualified ? '合格' : '不合格'} | 等级 ${bestQualified?.tierLabel || activeMetrics?.tierLabel || '-'} | 原因 ${isQualified ? `命中 ${bestQualified.tierLabel}` : audienceCheck.passed ? summarizeFailure(activeMetrics, tierMetrics) : audienceCheck.failureReason}`);
  if (!isQualified) logTierDetails(profile.username, tierMetrics, log);

  return {
    result: {
      ...profile,
      metrics: activeMetrics,
      bestQualified,
      audienceCheck,
      detectedLanguage: audienceCheck.language || '',
      languageDetail: audienceCheck.languageDetail || null,
      audienceAnalysis: {
        totalSamples: audienceCheck.sampleCount || 0,
        videosAnalyzed: audienceCheck.videosAnalyzed || 0,
        uniqueRegions: audienceCheck.uniqueCountries || 0,
        regions: audienceCheck.regions || [],
        confidence: audienceCheck.confidence || '不足',
        analyzing: false,
      },
      decisionReason: isQualified
        ? `命中 ${bestQualified.tierLabel}`
        : audienceCheck.passed ? summarizeFailure(activeMetrics, tierMetrics) : audienceCheck.failureReason,
    },
    row: {
      用户名: profile.username,
      邮箱: profile.contactEmail || '',
      昵称: profile.userInfo?.nickname || '',
      主页链接: profile.profileUrl,
      粉丝量: followerCount,
      粉丝量展示: formatNumber(followerCount),
      主受众国家: audienceCheck.topCountry,
      主受众国家占比: audienceCheck.topCountryPercentage ? `${audienceCheck.topCountryPercentage}%` : '0%',
      受众样本数: audienceCheck.sampleCount,
      受众筛选达标: audienceCheck.passed ? '是' : '否',
      受众失败原因: audienceCheck.failureReason,
      粉丝归属等级: followerTier.tierLabel,
      当前分析等级: activeMetrics?.tierLabel || '',
      最高满足等级: bestQualified?.tierLabel || '',
      命中等级列表: tierMetrics.filter((item) => item.passed).map((item) => item.tierLabel).join(' / '),
      是否合格: isQualified ? '合格' : '不合格',
      选取视频数: activeMetrics?.selectedVideos.length || 0,
      总抓取视频数: videos.length,
      稳定播放比例: activeMetrics ? `${Math.round(activeMetrics.stablePercent * 100)}%` : '',
      最低播放量: activeMetrics?.minPlay || 0,
      最低播放量展示: formatNumber(activeMetrics?.minPlay || 0),
      第二低播放量: activeMetrics?.play2ndLowest || 0,
      第三低播放量: activeMetrics?.play3rdLowest || 0,
      稳定播放量: activeMetrics?.stablePlay || 0,
      稳定播放量展示: formatNumber(activeMetrics?.stablePlay || 0),
      满足等级数: tierMetrics.filter((item) => item.passed).length,
      来源搜索页: profile.sourceSearchUrl || '',
      来源视频链接: profile.sourceVideoUrl || '',
      搜索页摘录: profile.sourceText || '',
      错误信息: '',
    },
  };
}

module.exports = {
  analyzeProfile,
};
