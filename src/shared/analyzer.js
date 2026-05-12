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
    .filter((count) => count > 0)
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

function evaluateAudience(rules) {
  const audienceRules = rules?.audience || {};
  if (!audienceRules.enabled) {
    return {
      passed: true,
      topCountry: '',
      topCountryPercentage: 0,
      sampleCount: 0,
      failureReason: '',
    };
  }
  return {
    passed: false,
    topCountry: '',
    topCountryPercentage: 0,
    sampleCount: 0,
    failureReason: '插件版未启用评论受众分析',
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

export function getProfileTargetVideoCount(config) {
  const counts = getLevels(config?.rules)
    .map((level) => Number(level.recentVideoCount) || 0)
    .filter((count) => count > 0);
  return counts.length ? Math.max(...counts) : 30;
}

export function analyzeProfile(profile, rules) {
  const followerCount = Number(profile.userInfo?.followerCount) || 0;
  const videos = Array.isArray(profile.videos) ? profile.videos : [];
  const followerTier = classifyFollowerTier(followerCount, rules);
  const tierMetrics = getLevels(rules).map((level) => buildTierMetrics(level, followerCount, videos, rules));
  const bestQualified = tierMetrics.find((item) => item.passed) || null;
  const activeMetrics = bestQualified || tierMetrics.find((item) => item.tier === followerTier.tier) || tierMetrics[0] || null;
  const audienceCheck = evaluateAudience(rules);
  const isQualified = Boolean(bestQualified && audienceCheck.passed);

  return {
    result: {
      ...profile,
      metrics: activeMetrics,
      bestQualified,
      audienceCheck,
      decisionReason: isQualified
        ? `命中 ${bestQualified.tierLabel}`
        : summarizeFailure(activeMetrics, tierMetrics),
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
