const {
  launchBrowser,
  createPage,
  ensureTikTokAuth,
} = require('./lib/tiktok-scraper');
const { loadConfig } = require('./lib/config-loader');
const { sleep } = require('./lib/helpers');

function parseArgs(argv) {
  const args = {
    config: '',
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--config=')) args.config = arg.slice('--config='.length);
  }

  return args;
}

function hasTikTokLoginCookies(cookies = []) {
  const names = new Set((Array.isArray(cookies) ? cookies : []).map((cookie) => cookie?.name).filter(Boolean));
  return ['sessionid', 'sessionid_ss', 'sid_tt', 'uid_tt', 'uid_tt_ss'].some((name) => names.has(name));
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig(args.config);
  const authConfig = {
    ...(config.browser.auth || {}),
    mode: 'profile',
  };

  console.log(`配置文件: ${config.__meta.configPath}`);
  console.log(`登录命令模式: profile`);
  console.log(`登录态目录: ${authConfig.userDataDir || '-'}`);
  console.log(`Cookie 文件: ${authConfig.cookieFile || '-'}`);
  console.log('浏览器已启动后，请直接在页面中手动完成 TikTok 登录。');
  console.log('检测到登录成功后会自动倒计时 5 秒退出，状态会保存在登录态目录中。');

  const browserOptions = {
    headless: false,
    slowMo: config.browser.slowMo,
    timeoutMs: config.browser.timeoutMs,
    viewport: config.browser.viewport,
    extraHttpHeaders: config.browser.extraHttpHeaders,
    userAgent: config.browser.userAgent,
    auth: authConfig,
  };
  const pageOptions = {
    timeoutMs: config.browser.timeoutMs,
    viewport: config.browser.viewport,
    extraHttpHeaders: config.browser.extraHttpHeaders,
    userAgent: config.browser.userAgent,
  };

  const browser = await launchBrowser(browserOptions);
  let stopRequested = false;
  const handleSigint = () => {
    if (!stopRequested) {
      stopRequested = true;
      console.log('\n收到停止信号，正在关闭浏览器并保存登录态...');
    }
  };
  process.on('SIGINT', handleSigint);

  try {
    const initialAuthState = await ensureTikTokAuth(browser, browserOptions);
    console.log(
      `初始登录态 | 已登录 ${initialAuthState.loggedIn ? '是' : '否'} | 来源 ${initialAuthState.source || '-'} | 导入 Cookie ${initialAuthState.importedCookieCount || 0}`,
    );

    const page = await createPage(browser, pageOptions);
    await page.bringToFront();
    await page.goto('https://www.tiktok.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: config.browser.timeoutMs,
    });

    let lastLoginState = initialAuthState.loggedIn;
    while (!stopRequested) {
      await sleep(2500);
      const cookies = await page.cookies('https://www.tiktok.com/');
      const loggedIn = hasTikTokLoginCookies(cookies);

      if (loggedIn && !lastLoginState) {
        console.log('检测到 TikTok 已登录，5 秒后自动关闭浏览器并保存登录态...');
        for (let secondsLeft = 5; secondsLeft >= 1; secondsLeft -= 1) {
          if (stopRequested) break;
          console.log(`登录命令将在 ${secondsLeft} 秒后退出...`);
          await sleep(1000);
        }
        stopRequested = true;
        break;
      }
      lastLoginState = loggedIn;
    }

    await page.close();
  } finally {
    await browser.close();
    process.off('SIGINT', handleSigint);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
