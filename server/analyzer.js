const DEFAULT_AUDIENCE = {
  enabled: false,
  requiredTopCountry: 'US',
  minSampleCount: 20,
  minTopCountryPercentage: 50,
  sampleVideoCount: 3,
  commentsPerVideo: 50,
};

function noop() {}

function formatNumber(value) {
  const num = Number(value) || 0;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
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
      ok: stablePlay >= (Number(level.stablePlay) || 0),
    },
    {
      label: '最低播放量',
      required: Number(level.minPlay) || 0,
      actual: minPlay,
      ok: minPlay >= (Number(level.minPlay) || 0),
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

function buildCommentUrl(baseUrl, endpointTemplate, videoId, count) {
  if (endpointTemplate) {
    return endpointTemplate
      .replace(/\{baseUrl\}/g, baseUrl.replace(/\/+$/, ''))
      .replace(/\{videoId\}/g, encodeURIComponent(videoId))
      .replace(/\{count\}/g, encodeURIComponent(count));
  }
  const url = new URL('/api/comment/list', baseUrl);
  url.searchParams.set('video_id', videoId);
  url.searchParams.set('count', String(count));
  url.searchParams.set('cursor', '0');
  return url.toString();
}

async function fetchTikwmComments(videoId, audienceRules, log = noop) {
  const baseUrl = process.env.TT_TIKWM_BASE_URL || audienceRules.baseUrl || 'https://api.tikwmapi.com';
  const endpointTemplate = process.env.TT_TIKWM_COMMENT_ENDPOINT || audienceRules.commentEndpoint || '';
  const apiKey = process.env.TT_TIKWM_API_KEY || audienceRules.apiKey || '';
  const authHeader = process.env.TT_TIKWM_AUTH_HEADER || audienceRules.authHeader || 'x-api-key';
  const count = Math.max(1, Number(audienceRules.commentsPerVideo) || DEFAULT_AUDIENCE.commentsPerVideo);
  const url = buildCommentUrl(baseUrl, endpointTemplate, videoId, count);
  const headers = apiKey ? { [authHeader]: apiKey } : {};
  log(`评论采样请求 | video ${videoId} | count ${count}`);
  const response = await fetch(url, { headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.code < 0) {
    throw new Error(payload?.msg || payload?.message || `TikWM 评论接口失败: ${response.status}`);
  }
  const comments = extractComments(payload);
  log(`评论采样完成 | video ${videoId} | 评论 ${comments.length}`);
  return comments;
}

async function evaluateAudience(profile, rules, log = noop) {
  const audienceRules = {
    ...DEFAULT_AUDIENCE,
    ...(rules?.audience || {}),
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
  const videos = Array.isArray(profile.videos) ? profile.videos : [];
  const selectedVideos = videos
    .map((video) => video?.id)
    .filter(Boolean)
    .slice(0, Math.max(1, Number(audienceRules.sampleVideoCount) || DEFAULT_AUDIENCE.sampleVideoCount));
  if (selectedVideos.length === 0) {
    log(`受众分析失败 | @${profile.username} | 无可分析视频`);
    return {
      passed: false,
      topCountry: '',
      topCountryPercentage: 0,
      sampleCount: 0,
      failureReason: '无可分析视频',
    };
  }

  log(`受众分析开始 | @${profile.username} | 视频 ${selectedVideos.length} | 目标国家 ${requiredCountry}`);
  const countryCounts = new Map();
  let sampleCount = 0;
  const errors = [];

  for (const videoId of selectedVideos) {
    try {
      const comments = await fetchTikwmComments(videoId, audienceRules, log);
      for (const comment of comments) {
        const country = getCommentCountry(comment);
        if (!country) continue;
        countryCounts.set(country, (countryCounts.get(country) || 0) + 1);
        sampleCount += 1;
      }
    } catch (error) {
      log(`评论采样失败 | video ${videoId} | ${error?.message || String(error)}`);
      errors.push(`${videoId}: ${error?.message || String(error)}`);
    }
  }

  const [topCountry = '', topCount = 0] = [...countryCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0] || [];
  const topCountryPercentage = sampleCount > 0 ? Math.round((topCount / sampleCount) * 100) : 0;
  const minSampleCount = Math.max(0, Number(audienceRules.minSampleCount) || 0);
  const minTopCountryPercentage = Math.max(0, Number(audienceRules.minTopCountryPercentage) || 0);
  log(`受众分析结果 | @${profile.username} | 主国家 ${topCountry || '未知'} | 占比 ${topCountryPercentage}% | 样本 ${sampleCount}`);

  if (sampleCount < minSampleCount) {
    return {
      passed: false,
      topCountry,
      topCountryPercentage,
      sampleCount,
      failureReason: `受众样本不足 ${sampleCount}/${minSampleCount}${errors.length ? `；${errors[0]}` : ''}`,
    };
  }
  if (topCountry !== requiredCountry) {
    return {
      passed: false,
      topCountry,
      topCountryPercentage,
      sampleCount,
      failureReason: `主受众国家 ${topCountry || '未知'} 不等于 ${requiredCountry}`,
    };
  }
  if (topCountryPercentage < minTopCountryPercentage) {
    return {
      passed: false,
      topCountry,
      topCountryPercentage,
      sampleCount,
      failureReason: `主受众占比 ${topCountryPercentage}% 低于 ${minTopCountryPercentage}%`,
    };
  }

  return {
    passed: true,
    topCountry,
    topCountryPercentage,
    sampleCount,
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

  return {
    result: {
      ...profile,
      metrics: activeMetrics,
      bestQualified,
      audienceCheck,
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
