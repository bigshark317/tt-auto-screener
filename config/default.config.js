module.exports = {
  search: {
    // TikTok 搜索页地址，脚本会从这里持续滚动并提取作者主页。
    url: 'https://www.tiktok.com/search/video?q=%23tech&t=1777477567556',
    // 是否开启持续采集模式；true 时会边滚动边发现作者、边进入主页分析，直到你手动停止。
    infinite: true,
    // 非持续模式下，目标发现多少个候选作者后停止继续采集。
    targetCount: 30,
    // 非持续模式下，连续多少轮没拿到足够新作者后结束搜索采集。
    searchScrolls: 20,
    // 持续采集模式下，连续多少轮没有新作者时，自动刷新搜索页继续采集。
    idleRounds: 30,
    // 本次运行最多分析多少个作者；0 表示不限制。
    maxProcessed: 0,
  },
  browser: {
    // 是否无头运行；false 会打开可见浏览器窗口，便于观察页面状态。
    headless: false,
    // Puppeteer 每步操作的额外慢速延迟，调试时可适当调大。
    slowMo: 0,
    // 页面打开、等待接口、执行选择器等操作的超时时间，单位毫秒。
    timeoutMs: 45000,
    viewport: {
      // 浏览器视口宽度，影响页面布局和可见内容密度。
      width: 1440,
      // 浏览器视口高度，影响单屏能展示多少搜索结果和视频卡片。
      height: 960,
    },
    extraHttpHeaders: {
      // 请求头语言设置，尽量让页面结构和文案保持稳定。
      'accept-language': 'en-US,en;q=0.9',
    },
    // 浏览器 UA，部分页面结构和风控表现会受 UA 影响。
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  scroll: {
    // 作者主页最多滚动多少次；滚得越多，抓到的视频通常越多，但速度也会更慢。
    maxProfileScrolls: 5,
    // 每次滚动后的统一等待时间，单位毫秒；同时用于搜索页和主页的懒加载缓冲。
    scrollWaitMs: 1200,
    // 页面刚打开或滚动后，最多等多久让接口返回或页面就绪，单位毫秒。
    apiWaitMs: 5000,
  },
  export: {
    // 导出目录；xlsx 和详细 json 会写到这里，断点信息也会内置在实时 Excel 里。
    outputDir: '../output',
    // 主导出是否只保留满足等级条件的账号；false 时会把全部结果作为主导出。
    qualifiedOnly: true,
    // 详细 JSON 明细文件名，保存完整分析结果，便于后续排查和二次处理。
    detailJsonName: 'last_run_details.json',
  },
  rules: {
    // 排除最近多少小时内发布的视频；这些视频通常播放量还不稳定，不参与等级计算。
    excludeRecentHours: 24,
    audience: {
      // 是否启用受众国家筛选；true 时会抓取评论用户地区并统计主受众国家。
      enabled: true,
      // 要求主受众国家必须是哪一个；填写 US 表示只保留受众国家中美国占比最高的用户。
      requiredTopCountry: 'US',
      // 受众分析最多取最近多少条视频作为候选评论来源。
      recentVideoCount: 30,
      // 会优先按评论数排序，只抓前多少条视频的评论。
      maxVideos: 5,
      // 每条视频最多抓几页评论。
      maxPagesPerVideo: 3,
      // 每条视频最多计入多少个唯一评论用户样本。
      maxUsersPerVideo: 80,
      // 受众分析总共希望拿到多少个唯一用户地区样本。
      sampleTarget: 200,
      tikwm: {
        // TikWM 付费接口地址；当前脚本只走这条链路。
        paidBaseUrl: 'https://api.tikwmapi.com',
        // TikWM 付费接口 key；这里默认对齐根目录插件配置。
        apiKey: 'c80f5c0c36383df2f63b2466f2e4ea6c',
        // 接口路径映射；当 TikWM 路径和原始调用路径不一致时在这里转换。
        pathMap: {
          '/feed/search': '/search/feed',
        },
      },
    },
    // 等级配置数组；顺序就是等级优先级，也决定导出时各等级 sheet 的顺序。
    levels: [
      {
        // 等级唯一标识，用于程序内部识别。
        key: 'top',
        // 等级名称，会显示在表格和 Excel sheet 中。
        label: '头部 KOL',
        // 稳定播放计算比例；0.9 表示按“90%稳定播放”口径计算，0.8 表示按“80%稳定播放”口径计算。
        stablePercent: 0.9,
        // 粉丝量门槛；达到这个值才可能命中该等级。
        minFollowers: 5000000,
        // 稳定播放量门槛；和当前等级的 stablePercent 搭配使用。
        stablePlay: 1000000,
        // 最低播放量门槛；达到这个值才算满足该等级底线要求。
        minPlay: 350000,
        // 分析最近多少条视频；脚本会按发布时间倒序取最近 N 条来计算。
        recentVideoCount: 30,
      },
      {
        // 等级唯一标识，用于程序内部识别。
        key: 'mid',
        // 等级名称，会显示在表格和 Excel sheet 中。
        label: '普通 KOL',
        // 稳定播放计算比例；0.9 表示按“90%稳定播放”口径计算，0.8 表示按“80%稳定播放”口径计算。
        stablePercent: 0.9,
        // 粉丝量门槛；达到这个值才可能命中该等级。
        minFollowers: 100000,
        // 稳定播放量门槛；和当前等级的 stablePercent 搭配使用。
        stablePlay: 130000,
        // 最低播放量门槛；达到这个值才算满足该等级底线要求。
        minPlay: 60000,
        // 分析最近多少条视频；脚本会按发布时间倒序取最近 N 条来计算。
        recentVideoCount: 30,
      },
      {
         // 等级唯一标识，用于程序内部识别。
        key: 'little',
        // 等级名称，会显示在表格和 Excel sheet 中。
        label: '小小号',
        // 稳定播放计算比例；0.9 表示按“90%稳定播放”口径计算，0.8 表示按“80%稳定播放”口径计算。
        stablePercent: 0.5,
        // 粉丝量门槛；达到这个值才可能命中该等级。
        minFollowers: 100000,
        // 稳定播放量门槛；和当前等级的 stablePercent 搭配使用。
        stablePlay: 80000,
        // 最低播放量门槛；达到这个值才算满足该等级底线要求。
        minPlay: 20000,
        // 分析最近多少条视频；脚本会按发布时间倒序取最近 N 条来计算。
        recentVideoCount: 20,
      },
      {
        // 等级唯一标识，用于程序内部识别。
        key: 'tail',
        // 等级名称，会显示在表格和 Excel sheet 中。
        label: '尾部 KOC',
        // 稳定播放计算比例；0.9 表示按“90%稳定播放”口径计算，0.8 表示按“80%稳定播放”口径计算。
        stablePercent: 0.9,
        // 粉丝量门槛；达到这个值才可能命中该等级。
        minFollowers: 5000,
        // 稳定播放量门槛；和当前等级的 stablePercent 搭配使用。
        stablePlay: 0,
        // 最低播放量门槛；达到这个值才算满足该等级底线要求。
        minPlay: 4000,
        // 分析最近多少条视频；脚本会按发布时间倒序取最近 N 条来计算。
        recentVideoCount: 20,
      },
    ],
  },
};
