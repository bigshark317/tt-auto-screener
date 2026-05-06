const { calculatePromoMetrics } = require('../rules');
const { formatNumber } = require('./helpers');

function evaluateAudience(profile, rulesConfig) {
  const audienceRules = rulesConfig?.audience || {};
  const requiredTopCountry = String(audienceRules.requiredTopCountry || '').trim().toUpperCase();
  const topCountry = String(profile.audience?.topCountry || '').trim().toUpperCase();
  const sampleCount = Number(profile.audience?.sampleCount) || 0;
  const sourceFailureReason = String(profile.audience?.failureReason || '').trim();

  if (!audienceRules.enabled) {
    return {
      enabled: false,
      requiredTopCountry,
      topCountry,
      sampleCount,
      topCountryPercentage: Number(profile.audience?.topCountryPercentage) || 0,
      passed: true,
      failureReason: '',
    };
  }

  const passed = Boolean(requiredTopCountry) ? topCountry === requiredTopCountry && sampleCount > 0 : sampleCount > 0;
  let failureReason = sourceFailureReason;
  if (!failureReason && sampleCount === 0) {
    failureReason = '没有拿到受众样本';
  } else if (!failureReason && requiredTopCountry && topCountry && topCountry !== requiredTopCountry) {
    failureReason = `主受众国家不是 ${requiredTopCountry}，当前为 ${topCountry}`;
  } else if (!failureReason && requiredTopCountry && !topCountry) {
    failureReason = `未识别到主受众国家，要求为 ${requiredTopCountry}`;
  }

  return {
    enabled: true,
    requiredTopCountry,
    topCountry,
    sampleCount,
    topCountryPercentage: Number(profile.audience?.topCountryPercentage) || 0,
    passed,
    failureReason,
  };
}

function buildRow(result) {
  const followerCount = Number(result.userInfo?.followerCount) || 0;
  const checks = result.metrics.qualification?.checks || [];
  const checkMap = Object.fromEntries(checks.map((item) => [item.label, item]));
  const matchedTierLabels = result.metrics.matchedTierLabels || [];
  const stablePercentDisplay = result.metrics.stablePercent > 0
    ? `${Math.round(result.metrics.stablePercent * 100)}%`
    : '';

  return {
    用户名: result.username,
    邮箱: result.contactEmail || result.userInfo?.email || '',
    昵称: result.userInfo?.nickname || '',
    主页链接: result.profileUrl,
    粉丝量: followerCount,
    粉丝量展示: formatNumber(followerCount),
    主受众国家: result.audienceCheck.topCountry || '',
    主受众国家占比: result.audienceCheck.topCountryPercentage ? `${result.audienceCheck.topCountryPercentage}%` : '0%',
    受众样本数: result.audienceCheck.sampleCount,
    受众筛选达标: result.audienceCheck.passed ? '是' : '否',
    受众失败原因: result.audienceCheck.failureReason || '',
    粉丝归属等级: result.metrics.tierLabel,
    当前分析等级: result.metrics.activeTierLabel,
    最高满足等级: result.metrics.bestQualifiedTierLabel || '',
    命中等级列表: matchedTierLabels.join(' / '),
    是否合格: result.metrics.bestQualifiedTier && result.audienceCheck.passed ? '合格' : '不合格',
    选取视频数: result.metrics.selectedVideos.length,
    总抓取视频数: result.videos.length,
    稳定播放比例: stablePercentDisplay,
    最低播放量: result.metrics.minPlay,
    最低播放量展示: formatNumber(result.metrics.minPlay),
    第二低播放量: result.metrics.play2ndLowest || 0,
    第三低播放量: result.metrics.play3rdLowest || 0,
    稳定播放量: result.metrics.stablePlay90,
    稳定播放量展示: formatNumber(result.metrics.stablePlay90),
    满足等级数: matchedTierLabels.length,
    粉丝门槛: checkMap['粉丝量']?.required || 0,
    稳定播放门槛: checkMap['稳定播放量']?.required || 0,
    最低播放门槛: checkMap['最低播放量']?.required || 0,
    粉丝达标: checkMap['粉丝量']?.ok ? '是' : '否',
    稳定播放达标: checkMap['稳定播放量']?.ok ? '是' : '否',
    最低播放达标: checkMap['最低播放量']?.ok ? '是' : '否',
    接口命中_userDetail: result.apiHits.userDetail,
    接口命中_itemList: result.apiHits.itemList,
    错误信息: '',
  };
}

function formatCheckForLog(check) {
  const label = check?.displayLabel || check?.label || '未知指标';
  const actual = formatNumber(Number(check?.actual) || 0);
  const required = formatNumber(Number(check?.required) || 0);
  return `${label} ${actual}/${required}`;
}

function summarizeTierFailure(metrics) {
  const metricsByTier = Object.values(metrics?.metricsByTier || {}).filter(Boolean);
  if (metricsByTier.length === 0) return '未命中任何等级';

  const normalized = metricsByTier
    .map((item) => ({
      tierLabel: item.tierLabel || item.tier || '未命名等级',
      failedChecks: (item.qualification?.checks || []).filter((check) => !check.ok),
      followerOk: Boolean((item.qualification?.checks || []).find((check) => check.label === '粉丝量')?.ok),
    }))
    .filter((item) => item.failedChecks.length > 0);

  if (normalized.length === 0) return '未命中任何等级';

  const preferred = normalized
    .filter((item) => item.followerOk)
    .sort((a, b) => a.failedChecks.length - b.failedChecks.length)[0]
    || normalized.sort((a, b) => a.failedChecks.length - b.failedChecks.length)[0];

  return `${preferred.tierLabel}未达标：${preferred.failedChecks.map(formatCheckForLog).join('，')}`;
}

function buildDecisionReason(result) {
  const parts = [];

  if (!result.metrics.bestQualifiedTier) {
    parts.push(summarizeTierFailure(result.metrics));
  }
  if (!result.audienceCheck.passed) {
    parts.push(`受众未达标：${result.audienceCheck.failureReason || '未通过受众筛选'}`);
  }

  if (parts.length === 0) {
    return `命中 ${result.metrics.bestQualifiedTierLabel || result.metrics.activeTierLabel || '合格等级'}`;
  }

  return parts.join('；');
}

function analyzeProfile(profile, rulesConfig) {
  const followerCount = Number(profile.userInfo?.followerCount) || 0;
  const metrics = calculatePromoMetrics(followerCount, profile.videos || [], rulesConfig);
  const audienceCheck = evaluateAudience(profile, rulesConfig);
  const result = {
    ...profile,
    metrics,
    audienceCheck,
    decisionReason: '',
  };
  result.decisionReason = buildDecisionReason(result);
  return {
    result,
    row: buildRow(result),
  };
}

module.exports = {
  analyzeProfile,
};
