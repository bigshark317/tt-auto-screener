export const DEFAULT_CONFIG = {
  server: {
    baseUrl: 'http://127.0.0.1:17321',
  },
  search: {
    url: 'https://www.tiktok.com/explore',
    idleRounds: 20,
    maxProcessed: 0,
    concurrentProfiles: 2,
    profileTabActive: false,
  },
  scroll: {
    scrollWaitMs: 1200,
    profileWaitMs: 1500,
  },
  rules: {
    excludeRecentHours: 24,
    audience: {
      enabled: false,
      requiredTopCountry: 'US',
      minSampleCount: 20,
      minTopCountryPercentage: 50,
      sampleVideoCount: 3,
      commentsPerVideo: 50,
    },
    levels: [
      {
        key: 'top',
        label: '头部 KOL',
        stablePercent: 0.9,
        minFollowers: 5000000,
        stablePlay: 1000000,
        minPlay: 350000,
        recentVideoCount: 30,
      },
      {
        key: 'mid',
        label: '普通 KOL',
        stablePercent: 0.9,
        minFollowers: 100000,
        stablePlay: 130000,
        minPlay: 60000,
        recentVideoCount: 30,
      },
      {
        key: 'little',
        label: '小小号',
        stablePercent: 0.5,
        minFollowers: 100000,
        stablePlay: 80000,
        minPlay: 20000,
        recentVideoCount: 20,
      },
      {
        key: 'tail',
        label: '尾部 KOC',
        stablePercent: 0.9,
        minFollowers: 5000,
        stablePlay: 0,
        minPlay: 4000,
        recentVideoCount: 20,
      },
    ],
  },
};

export function mergeConfig(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && base?.[key]
      && typeof base[key] === 'object'
      && !Array.isArray(base[key])
    ) {
      output[key] = mergeConfig(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}
