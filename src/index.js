const {
  createBrowserSession,
  launchBrowser,
  createPage,
  extractAuthorsFromCurrentSearchViewport,
  collectUserProfile,
  ensureTikTokAuth,
  openSearchPage,
  scrollSearchResults,
} = require('./lib/tiktok-scraper');
const { analyzeProfile } = require('./lib/analyzer');
const { createQualifiedLiveWriter } = require('./lib/exporter');
const { ensureDir, formatAuthorLog } = require('./lib/helpers');
const { loadConfig } = require('./lib/config-loader');

function parseArgs(argv) {
  const args = {
    config: '',
    url: '',
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--config=')) args.config = arg.slice('--config='.length);
    else if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
  }

  return args;
}

function buildFailureRow(username, searchUrl, author, message) {
  return {
    用户名: username,
    邮箱: '',
    昵称: '',
    主页链接: `https://www.tiktok.com/@${username}`,
    粉丝量: 0,
    粉丝量展示: '0',
    主受众国家: '',
    主受众国家占比: '0%',
    受众样本数: 0,
    受众筛选达标: '否',
    受众失败原因: message,
    粉丝归属等级: '失败',
    当前分析等级: '失败',
    最高满足等级: '',
    命中等级列表: '',
    是否合格: '失败',
    选取视频数: 0,
    总抓取视频数: 0,
    最低播放量: 0,
    最低播放量展示: '0',
    第二低播放量: 0,
    第三低播放量: 0,
    稳定播放比例: '',
    稳定播放量: 0,
    稳定播放量展示: '0',
    满足等级数: 0,
    粉丝门槛: 0,
    稳定播放门槛: 0,
    最低播放门槛: 0,
    粉丝达标: '否',
    稳定播放达标: '否',
    最低播放达标: '否',
    接口命中_userDetail: 0,
    接口命中_itemList: 0,
    来源搜索页: searchUrl,
    来源视频链接: author?.sourceVideoUrl || '',
    搜索页摘录: author?.sourceText || '',
    错误信息: message,
  };
}

function updateStateStats(state) {
  state.stats.discovered = state.discoveredAuthors.length;
  state.stats.processed = state.processedUsernames.length;
}

function upsertDiscoveredAuthors(state, batch) {
  const map = new Map(state.discoveredAuthors.map((item) => [item.username, item]));
  let newCount = 0;

  for (const author of batch) {
    if (!author?.username) continue;
    if (!map.has(author.username)) newCount += 1;
    map.set(author.username, { ...map.get(author.username), ...author });
  }

  state.discoveredAuthors = [...map.values()];
  updateStateStats(state);
  return newCount;
}

function createPendingQueue(state) {
  const processed = new Set(state.processedUsernames);
  return state.discoveredAuthors.filter((author) => !processed.has(author.username));
}

function getParallelAuthors(config) {
  return Math.max(1, Number(config.search?.parallelAuthors) || 1);
}

function getProfileTargetVideoCount(config) {
  const levelCounts = Array.isArray(config.rules?.levels)
    ? config.rules.levels.map((level) => Number(level?.recentVideoCount) || 0)
    : [];
  const audienceCount = Number(config.rules?.audience?.recentVideoCount) || 0;
  const allCounts = [...levelCounts, audienceCount].filter((count) => count > 0);
  return allCounts.length > 0 ? Math.max(...allCounts) : 30;
}

function formatQueueStatus(state, options = {}) {
  const pendingCount = Math.max(0, Number(options.pendingCount) || 0);
  const inFlightCount = Math.max(0, Number(options.inFlightCount) || 0);
  const newDiscovered = Math.max(0, Number(options.newDiscovered) || 0);
  const extra = [];

  extra.push(`待分析 ${pendingCount}`);
  extra.push(`并行中 ${inFlightCount}`);
  extra.push(`已处理 ${state.stats.processed}`);
  if (newDiscovered > 0) extra.push(`新发现 ${newDiscovered}`);
  extra.push(`累计发现 ${state.stats.discovered}`);

  return extra.join(' | ');
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig(args.config);
  if (args.url) config.search.url = args.url;

  ensureDir(config.export.outputDir);

  if (!config.search.url) {
    throw new Error('请在配置文件中设置 `search.url`，或通过 --url="https://www.tiktok.com/search/video?q=%23tech&t=..." 覆盖');
  }

  const tierOrder = Array.isArray(config.rules.levels) ? config.rules.levels.map((level) => level.key) : [];
  const tierLabelMap = Object.fromEntries(
    (Array.isArray(config.rules.levels) ? config.rules.levels : [])
      .filter((level) => level && level.key)
      .map((level) => [level.key, level.label || level.key]),
  );
  const liveWriter = createQualifiedLiveWriter(config.export.outputDir, {
    searchUrl: config.search.url,
    tierOrder,
    tierLabelMap,
  });
  const state = liveWriter.state;
  updateStateStats(state);
  const runRows = [];

  if (state.searchUrl && state.searchUrl !== config.search.url) {
    throw new Error(`实时表格中的断点搜索链接与当前配置不一致，请继续使用同一个 --url，或先清理旧的实时表格\nlive: ${state.searchUrl}\ncurrent: ${config.search.url}`);
  }

  let stopRequested = false;
  let idleRounds = 0;
  let processedThisRun = 0;

  const handleSigint = () => {
    if (!stopRequested) {
      stopRequested = true;
      console.log('\n收到停止信号，正在保存断点并安全退出...');
    }
  };
  process.on('SIGINT', handleSigint);

  console.log(`配置文件: ${config.__meta.configPath}`);
  console.log(`准备从搜索页采集作者: ${config.search.url}`);
  console.log(`断点已内置在: ${liveWriter.xlsxPath}`);
  console.log(`作者并行分析数: ${getParallelAuthors(config)}`);
  console.log(`作者主页目标视频数: ${getProfileTargetVideoCount(config)}`);
  console.log(`登录态策略: ${config.browser.auth?.mode || 'disabled'}`);
  console.log(`登录态目录: ${config.browser.auth?.userDataDir || '-'}`);
  console.log(`Cookie 文件: ${config.browser.auth?.cookieFile || '-'}`);

  const browserOptions = {
    headless: config.browser.headless,
    slowMo: config.browser.slowMo,
    timeoutMs: config.browser.timeoutMs,
    viewport: config.browser.viewport,
    extraHttpHeaders: config.browser.extraHttpHeaders,
    userAgent: config.browser.userAgent,
    auth: config.browser.auth,
  };
  const pageOptions = {
    timeoutMs: config.browser.timeoutMs,
    viewport: config.browser.viewport,
    extraHttpHeaders: config.browser.extraHttpHeaders,
    userAgent: config.browser.userAgent,
    searchReadyTimeoutMs: config.scroll.apiWaitMs,
    profileApiWaitMs: config.scroll.apiWaitMs,
    scrollSettleMs: config.scroll.scrollWaitMs,
  };

  const browser = await launchBrowser(browserOptions);
  const authState = await ensureTikTokAuth(browser, browserOptions);
  const sourceLabelMap = {
    profile: '复用本地 profile',
    'cookie-file': '导入 Cookie 文件',
    anonymous: '无痕模式',
    none: '未导入登录态',
  };
  console.log(
    `登录态检查 | 已登录 ${authState.loggedIn ? '是' : '否'} | 来源 ${sourceLabelMap[authState.source] || authState.source || '-'} | 导入 Cookie ${authState.importedCookieCount || 0}`,
  );
  const browserSession = await createBrowserSession(browser, browserOptions);
  const searchPage = await createPage(browserSession.pageTarget, pageOptions);
  const parallelAuthors = getParallelAuthors(config);
  const profileTargetVideoCount = getProfileTargetVideoCount(config);
  const profilePages = await Promise.all(
    Array.from({ length: parallelAuthors }, () => createPage(browserSession.pageTarget, pageOptions)),
  );
  try {
    await searchPage.bringToFront();
    await openSearchPage(searchPage, config.search.url, pageOptions);

    while (!stopRequested) {
      let queue = createPendingQueue(state);
      while (queue.length > 0 && !stopRequested) {
        if (config.search.maxProcessed > 0 && processedThisRun >= config.search.maxProcessed) {
          stopRequested = true;
          break;
        }
        const remaining = config.search.maxProcessed > 0
          ? Math.max(0, config.search.maxProcessed - processedThisRun)
          : queue.length;
        const batchSize = Math.min(parallelAuthors, queue.length, remaining);
        const batchAuthors = queue.slice(0, batchSize);
        console.log(
          `开始并行分析 | ${formatQueueStatus(state, {
            pendingCount: Math.max(0, queue.length - batchSize),
            inFlightCount: batchSize,
          })}`,
        );

        batchAuthors.forEach((author, index) => {
          const currentIndex = state.stats.processed + index + 1;
          console.log(formatAuthorLog(author.username, `[${currentIndex}] 开始分析 @${author.username}`));
        });

        const batchResults = await Promise.all(
          batchAuthors.map(async (author, index) => {
            const username = author.username;
            try {
              const profile = await collectUserProfile(profilePages[index], username, {
                timeoutMs: config.browser.timeoutMs,
                scrollSettleMs: config.scroll.scrollWaitMs,
                profileApiWaitMs: config.scroll.apiWaitMs,
                targetVideoCount: profileTargetVideoCount,
                excludeRecentHours: config.rules.excludeRecentHours,
                audience: {
                  ...(config.rules.audience || {}),
                  excludeRecentHours: config.rules.excludeRecentHours,
                },
              });
              const { result, row } = analyzeProfile(profile, config.rules);
              row.来源搜索页 = config.search.url;
              row.来源视频链接 = author.sourceVideoUrl || '';
              row.搜索页摘录 = author.sourceText || '';
              return { ok: true, author, username, result, row };
            } catch (error) {
              const message = error && error.message ? error.message : String(error);
              return { ok: false, author, username, message };
            }
          }),
        );

        for (const item of batchResults) {
          if (item.ok) {
            runRows.push(item.row);
            if (item.row.是否合格 === '合格') {
              state.stats.qualified += 1;
            } else {
              state.stats.failed += 1;
            }
            if (liveWriter.append(item.row)) {
              console.log(`实时写入合格账号: ${liveWriter.xlsxPath}`);
            }
            const reasonSuffix = item.result.decisionReason ? ` | 原因 ${item.result.decisionReason}` : '';
            console.log(formatAuthorLog(item.username, `完成 @${item.username} | 受众 ${item.row.主受众国家 || '-'} ${item.row.主受众国家占比} | 粉丝 ${item.row.粉丝量展示} | 最低播放 ${item.row.最低播放量展示} | 稳定播放 ${item.row.稳定播放量展示} | ${item.row.是否合格}${reasonSuffix}`));
          } else {
            console.error(formatAuthorLog(item.username, `抓取失败 @${item.username}: ${item.message}`));
            runRows.push(buildFailureRow(item.username, config.search.url, item.author, item.message));
            state.stats.failed += 1;
          }

          state.processedUsernames.push(item.username);
          processedThisRun += 1;
        }

        updateStateStats(state);
        liveWriter.saveCheckpoint(state);
        queue = createPendingQueue(state);
      }

      if (stopRequested) break;

      await searchPage.bringToFront();
      const batch = await extractAuthorsFromCurrentSearchViewport(searchPage);
      const newDiscovered = upsertDiscoveredAuthors(state, batch);
      liveWriter.saveCheckpoint(state);

      if (state.discoveredAuthors.length === 0 && !config.search.infinite) {
        throw new Error('未从搜索页提取到作者主页，请检查链接是否可访问，或关闭 headless 重试');
      }

      if (newDiscovered > 0) {
        idleRounds = 0;
        console.log(
          `搜索页提取完成 | ${formatQueueStatus(state, {
            pendingCount: createPendingQueue(state).length,
            inFlightCount: 0,
            newDiscovered,
          })}`,
        );
        continue;
      }

      console.log(
        `搜索页提取完成 | ${formatQueueStatus(state, {
          pendingCount: createPendingQueue(state).length,
          inFlightCount: 0,
          newDiscovered: 0,
        })}`,
      );

      idleRounds += 1;

      if (!config.search.infinite) {
        if (state.stats.discovered >= config.search.targetCount && createPendingQueue(state).length === 0) break;
        if (idleRounds >= config.search.searchScrolls && createPendingQueue(state).length === 0) break;
      } else if (idleRounds >= config.search.idleRounds) {
        console.log(`连续 ${idleRounds} 轮未发现新作者，自动刷新搜索页继续采集...`);
        idleRounds = 0;
        await openSearchPage(searchPage, config.search.url, pageOptions);
        continue;
      }

      if (stopRequested) break;
      await searchPage.bringToFront();
      const scrollResult = await scrollSearchResults(searchPage, { scrollPauseMs: config.scroll.scrollWaitMs });
      console.log(
        `搜索页继续滚动 | ${formatQueueStatus(state, {
          pendingCount: createPendingQueue(state).length,
          inFlightCount: 0,
        })} | 容器 ${scrollResult.targetDescription} | scrollTop ${scrollResult.previousScrollTop} -> ${scrollResult.currentScrollTop} | 高度 ${scrollResult.previousHeight} -> ${scrollResult.currentHeight} | 作者 ${scrollResult.previousAuthorCount} -> ${scrollResult.currentAuthorCount}${scrollResult.reachedBottom ? ' | 当前轮无新增内容' : ''}`,
      );
    }
  } finally {
    liveWriter.saveCheckpoint(state);
    await searchPage.close();
    await Promise.all(profilePages.map((page) => page.close()));
    await browserSession.close();
    await browser.close();
    process.off('SIGINT', handleSigint);
  }

  const qualifiedCount = runRows.filter((row) => row.是否合格 === '合格').length;
  const totalCount = runRows.length;
  console.log(`结果表: ${liveWriter.xlsxPath}`);
  console.log(`搜索页累计候选作者: ${state.stats.discovered}`);
  console.log(`已处理作者: ${state.stats.processed}`);
  console.log(`合格账号: ${qualifiedCount}/${totalCount}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
