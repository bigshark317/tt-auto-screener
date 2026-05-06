const fs = require('fs');
const path = require('path');
const {
  launchBrowser,
  createPage,
  extractAuthorsFromCurrentSearchViewport,
  collectUserProfile,
  openSearchPage,
  scrollSearchResults,
} = require('./lib/tiktok-scraper');
const { analyzeProfile } = require('./lib/analyzer');
const { createQualifiedLiveWriter, exportRows } = require('./lib/exporter');
const { ensureDir } = require('./lib/helpers');
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
  const runDetails = [];

  if (state.searchUrl && state.searchUrl !== config.search.url) {
    throw new Error(`实时表格中的断点搜索链接与当前配置不一致，请继续使用同一个 --url，或先清理旧的实时表格\nlive: ${state.searchUrl}\ncurrent: ${config.search.url}`);
  }

  let stopRequested = false;
  let idleRounds = 0;
  let processedThisRun = 0;
  const processPerDiscoveryRound = 1;

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

  const browserOptions = {
    headless: config.browser.headless,
    slowMo: config.browser.slowMo,
    timeoutMs: config.browser.timeoutMs,
    viewport: config.browser.viewport,
    extraHttpHeaders: config.browser.extraHttpHeaders,
    userAgent: config.browser.userAgent,
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
  const searchPage = await createPage(browser, pageOptions);
  const profilePage = await createPage(browser, pageOptions);
  try {
    await openSearchPage(searchPage, config.search.url, pageOptions);

    while (!stopRequested) {
      const batch = await extractAuthorsFromCurrentSearchViewport(searchPage);
      const newDiscovered = upsertDiscoveredAuthors(state, batch);
      liveWriter.saveCheckpoint(state);

      if (state.discoveredAuthors.length === 0 && !config.search.infinite) {
        throw new Error('未从搜索页提取到作者主页，请检查链接是否可访问，或关闭 headless 重试');
      }

      if (newDiscovered > 0) {
        idleRounds = 0;
        console.log(`本轮新增作者 ${newDiscovered} 个，累计发现 ${state.stats.discovered} 个，已处理 ${state.stats.processed} 个`);
      } else {
        idleRounds += 1;
      }

      let queue = createPendingQueue(state);
      let processedThisRound = 0;
      while (queue.length > 0 && !stopRequested && processedThisRound < processPerDiscoveryRound) {
        if (config.search.maxProcessed > 0 && processedThisRun >= config.search.maxProcessed) {
          stopRequested = true;
          break;
        }

        const author = queue.shift();
        const username = author.username;
        const currentIndex = state.stats.processed + 1;
        console.log(`[${currentIndex}] 开始分析 @${username}`);

        try {
          const profile = await collectUserProfile(profilePage, username, {
            timeoutMs: config.browser.timeoutMs,
            maxScrolls: config.scroll.maxProfileScrolls,
            scrollSettleMs: config.scroll.scrollWaitMs,
            profileApiWaitMs: config.scroll.apiWaitMs,
            audience: {
              ...(config.rules.audience || {}),
              excludeRecentHours: config.rules.excludeRecentHours,
            },
          });
          const { result, row } = analyzeProfile(profile, config.rules);
          row.来源搜索页 = config.search.url;
          row.来源视频链接 = author.sourceVideoUrl || '';
          row.搜索页摘录 = author.sourceText || '';
          runRows.push(row);
          runDetails.push({ ...result, source: author });
          if (row.是否合格 === '合格') {
            state.stats.qualified += 1;
          } else {
            state.stats.failed += 1;
          }
          if (liveWriter.append(row)) {
            console.log(`实时写入合格账号: ${liveWriter.xlsxPath}`);
          }
          const reasonSuffix = result.decisionReason ? ` | 原因 ${result.decisionReason}` : '';
          console.log(`完成 @${username} | 受众 ${row.主受众国家 || '-'} ${row.主受众国家占比} | 粉丝 ${row.粉丝量展示} | 最低播放 ${row.最低播放量展示} | 稳定播放 ${row.稳定播放量展示} | ${row.是否合格}${reasonSuffix}`);
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          console.error(`抓取失败 @${username}: ${message}`);
          runRows.push(buildFailureRow(username, config.search.url, author, message));
          state.stats.failed += 1;
        }

        state.processedUsernames.push(username);
        processedThisRun += 1;
        processedThisRound += 1;
        updateStateStats(state);
        liveWriter.saveCheckpoint(state);
        queue = createPendingQueue(state);
      }

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
      await scrollSearchResults(searchPage, { scrollPauseMs: config.scroll.scrollWaitMs });
    }
  } finally {
    liveWriter.saveCheckpoint(state);
    await searchPage.close();
    await profilePage.close();
    await browser.close();
    process.off('SIGINT', handleSigint);
  }

  const { xlsxPath, fullXlsxPath, qualifiedCount, totalCount } = exportRows(config.export.outputDir, runRows, {
    exportQualifiedOnly: config.export.qualifiedOnly,
    tierOrder,
    tierLabelMap,
  });
  const detailPath = path.join(config.export.outputDir, config.export.detailJsonName);
  fs.writeFileSync(detailPath, JSON.stringify(runDetails, null, 2));

  console.log(`导出完成: ${xlsxPath}`);
  console.log(`完整结果工作簿: ${fullXlsxPath}`);
  console.log(`明细JSON: ${detailPath}`);
  console.log(`实时合格XLSX: ${liveWriter.xlsxPath}`);
  console.log(`搜索页累计候选作者: ${state.stats.discovered}`);
  console.log(`已处理作者: ${state.stats.processed}`);
  console.log(`合格账号: ${qualifiedCount}/${totalCount}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
