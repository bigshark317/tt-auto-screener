const DEFAULT_PROMO_RULES = {
  excludeRecentHours: 24,
  levels: [
    { key: 'top', label: '头部 KOL', stablePercent: 0.9, stablePlay: 1000000, minFollowers: 5000000, minPlay: 500000, recentVideoCount: 30 },
    { key: 'mid', label: '普通 KOL', stablePercent: 0.9, stablePlay: 200000, minFollowers: 200000, minPlay: 150000, recentVideoCount: 30 },
    { key: 'tail', label: '尾部 KOC', stablePercent: 0.9, stablePlay: 20000, minFollowers: 5000, minPlay: 10000, recentVideoCount: 20 },
  ],
};

function getLevels(rules = DEFAULT_PROMO_RULES) {
  return Array.isArray(rules?.levels) ? rules.levels.filter(Boolean) : [];
}

function getLevelByKey(rules, key) {
  return getLevels(rules).find((level) => level.key === key) || null;
}

function getTierLabel(rules, tier) {
  return getLevelByKey(rules, tier)?.label || '未命名档位';
}

function getStablePercent(level) {
  const value = Number(level?.stablePercent);
  if (Number.isFinite(value) && value > 0 && value <= 1) return value;
  return 0.9;
}

function getStablePlayThreshold(level) {
  return Number(level?.stablePlay ?? level?.stablePlay90) || 0;
}

function getTierOrder(rules = DEFAULT_PROMO_RULES) {
  return getLevels(rules).map((level) => level.key);
}

function promoClassifyTier(followerCount, rules = DEFAULT_PROMO_RULES) {
  const count = Number(followerCount) || 0;
  const levels = getLevels(rules);

  for (const level of levels) {
    if (!level?.key) continue;
    if (count >= (level.minFollowers || 0)) {
      return { tier: level.key, tierLabel: level.label || level.key };
    }
  }

  return { tier: null, tierLabel: '未达合作标准' };
}

function sortByRecency(videos) {
  return [...videos].sort((a, b) => {
    if (a.createTime > 0 && b.createTime > 0) return b.createTime - a.createTime;
    if (a.createTime > 0) return -1;
    if (b.createTime > 0) return 1;
    return 0;
  });
}

function excludeRecentVideos(videos, rules = DEFAULT_PROMO_RULES, nowUnix = Math.floor(Date.now() / 1000)) {
  const excludeRecentHours = Number(rules?.excludeRecentHours) || 0;
  if (excludeRecentHours <= 0) return [...videos];
  const cutoff = nowUnix - excludeRecentHours * 3600;
  return videos.filter((video) => video.createTime === 0 || video.createTime <= cutoff);
}

function selectPromoVideos(allVideos, tier, rules = DEFAULT_PROMO_RULES) {
  const videos = Array.isArray(allVideos) ? allVideos : [];
  const level = getLevelByKey(rules, tier);
  if (!level) return [];
  const recentVideoCount = Number(level.recentVideoCount) || 0;
  const recentVideos = sortByRecency(excludeRecentVideos(videos, rules));
  return recentVideoCount > 0 ? recentVideos.slice(0, recentVideoCount) : recentVideos;
}

function checkQualification(tier, followerCount, minPlay, stablePlay90, rules = DEFAULT_PROMO_RULES) {
  const level = getLevelByKey(rules, tier);
  if (!level) return { passed: false, checks: [] };
  const stablePercent = getStablePercent(level);
  const stablePercentLabel = `${Math.round(stablePercent * 100)}%稳定播放`;

  const checks = [
    {
      label: '粉丝量',
      required: level.minFollowers,
      actual: followerCount,
      ok: followerCount >= level.minFollowers,
    },
    {
      label: '稳定播放量',
      displayLabel: stablePercentLabel,
      required: getStablePlayThreshold(level),
      actual: stablePlay90,
      ok: stablePlay90 >= getStablePlayThreshold(level),
    },
    {
      label: '最低播放量',
      required: level.minPlay,
      actual: minPlay,
      ok: minPlay >= level.minPlay,
    },
  ];

  return { passed: checks.every((item) => item.ok), checks };
}

function buildTierMetrics(tier, followerCount, videos, rules = DEFAULT_PROMO_RULES) {
  const tierLabel = getTierLabel(rules, tier);
  const level = getLevelByKey(rules, tier);
  const selectedVideos = selectPromoVideos(videos, tier, rules);
  const playCounts = selectedVideos
    .filter((video) => (video.playCount || 0) > 0)
    .map((video) => video.playCount)
    .sort((a, b) => a - b);

  const minPlay = playCounts.length > 0 ? playCounts[0] : 0;
  const stablePercent = getStablePercent(level);
  const cutIndex = Math.floor(playCounts.length * (1 - stablePercent));
  const stablePlay90 = playCounts.length > cutIndex ? playCounts[cutIndex] : 0;
  const qualification = checkQualification(tier, followerCount, minPlay, stablePlay90, rules);

  return {
    tier,
    tierLabel,
    selectedVideos,
    playCounts,
    minPlay,
    stablePlay90,
    stablePercent,
    stablePercentLabel: `${Math.round(stablePercent * 100)}%稳定播放`,
    play2ndLowest: playCounts.length > 1 ? playCounts[1] : null,
    play3rdLowest: playCounts.length > 2 ? playCounts[2] : null,
    qualification,
  };
}

function calculatePromoMetrics(followerCount, videos, rules = DEFAULT_PROMO_RULES) {
  const profileTier = promoClassifyTier(followerCount, rules);
  const tierOrder = getTierOrder(rules);
  const metricsByTier = {};
  const matchedTierKeys = [];

  for (const tier of tierOrder) {
    const tierMetrics = buildTierMetrics(tier, followerCount, videos, rules);
    metricsByTier[tier] = tierMetrics;
    if (tierMetrics.qualification.passed) matchedTierKeys.push(tier);
  }

  const bestQualifiedTier = matchedTierKeys.length > 0 ? matchedTierKeys[0] : null;
  const activeTier = bestQualifiedTier || profileTier.tier;

  if (!activeTier) {
    return {
      ...profileTier,
      activeTier: null,
      activeTierLabel: '未达合作标准',
      bestQualifiedTier: null,
      bestQualifiedTierLabel: '',
      matchedTierKeys,
      matchedTierLabels: [],
      metricsByTier,
      selectedVideos: [],
      playCounts: [],
      minPlay: 0,
      stablePlay90: 0,
      stablePercent: 0,
      stablePercentLabel: '',
      play2ndLowest: null,
      play3rdLowest: null,
      qualification: { passed: false, checks: [] },
    };
  }

  const activeMetrics = metricsByTier[activeTier];

  return {
    ...profileTier,
    activeTier,
    activeTierLabel: getTierLabel(rules, activeTier),
    bestQualifiedTier,
    bestQualifiedTierLabel: bestQualifiedTier ? getTierLabel(rules, bestQualifiedTier) : '',
    matchedTierKeys,
    matchedTierLabels: matchedTierKeys.map((tier) => getTierLabel(rules, tier)),
    metricsByTier,
    selectedVideos: activeMetrics.selectedVideos,
    playCounts: activeMetrics.playCounts,
    minPlay: activeMetrics.minPlay,
    stablePlay90: activeMetrics.stablePlay90,
    stablePercent: activeMetrics.stablePercent,
    stablePercentLabel: activeMetrics.stablePercentLabel,
    play2ndLowest: activeMetrics.play2ndLowest,
    play3rdLowest: activeMetrics.play3rdLowest,
    qualification: activeMetrics.qualification,
  };
}

module.exports = {
  DEFAULT_PROMO_RULES,
  getLevels,
  getLevelByKey,
  getTierOrder,
  excludeRecentVideos,
  promoClassifyTier,
  selectPromoVideos,
  checkQualification,
  buildTierMetrics,
  calculatePromoMetrics,
};
