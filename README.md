# TikTok Auto Screener

把原浏览器插件里的 TikTok 数据获取和大促筛选逻辑抽成独立脚本，使用 `Puppeteer` 从 TikTok 搜索页持续刷视频、提取作者主页、打开主页分析，并导出 Excel。

## 功能

- 自动打开 TikTok 搜索页并持续滚动
- 从搜索结果视频里提取作者主页链接
- 逐个打开作者主页分析
- 支持无限滚动采集，直到手动停止
- 支持断点续跑，自动跳过已处理作者
- 主导出默认只输出合格账号，完整结果继续保留
- 合格账号命中后可实时写入表格，不必等整轮任务结束
- 支持等级制筛选，不同等级可配置不同规则和门槛
- 监听 `/api/user/detail` 和 `/api/post/item_list`
- SSR 和 DOM 双重兜底，尽量补全粉丝数和视频播放量
- 当页面未返回视频列表时，会尝试走 TikWM 公开接口做补充
- 支持启动时主动注入 TikTok cookie
- 复用原插件的大促模式筛选规则
- 导出 `xlsx` 和抓取明细 `json`
- 浏览器尺寸、门槛和最近视频条数都可通过配置文件调整

## 目录

```text
tt-auto-screener/
  config/
    default.config.js
  output/
  src/
    index.js
    rules.js
    lib/
```

## 安装

```bash
cd "/Users/bytedance/Desktop/BB-达人助手正式版 v2.0 2/tt-auto-screener"
npm install
```

## 配置启动

默认配置文件是 [default.config.js](file:///Users/bytedance/Desktop/BB-达人助手正式版%20v2.0%202/tt-auto-screener/config/default.config.js)。

常用可改项：

- `search.url`: 搜索页链接
- `browser.viewport.width` / `browser.viewport.height`: 浏览器尺寸
- `browser.headless`: 是否无头运行
- `browser.auth.mode`: 登录态模式，支持 `profile` 和 `anonymous`
- `browser.auth.userDataDir`: 专用 TikTok 登录态目录
- `browser.auth.cookieFile`: TikTok Cookie 文件路径
- `search.infinite`: 是否无限滚动
- `search.targetCount`: 非无限模式下目标作者数
- `rules.levels`: 等级配置数组
- `rules.levels[*].minFollowers`: 粉丝门槛
- `rules.levels[*].stablePercent`: 该等级使用的稳定播放比例
- `rules.levels[*].stablePlay`: 该等级的稳定播放量门槛
- `rules.levels[*].minPlay`: 最低播放量门槛
- `rules.levels[*].recentVideoCount`: 分析最近多少条视频
- `rules.audience.requiredTopCountry`: 主受众国家必须是哪一个，默认 `US`
- `rules.excludeRecentHours`: 排除最近多少小时内发布的视频

改完后直接启动：

```bash
npm start
```

初始化并保存 TikTok 登录态：

```bash
npm run login
```

## 登录态用法

- 当前项目支持两种模式：
  - `profile`: 优先复用 `browser.auth.userDataDir` 里的本地登录态；如果本地 profile 还不存在，会按配置从 `browser.auth.cookieFile` 导入一次 Cookie 初始化 profile
  - `anonymous`: 使用无痕隔离上下文访问，不复用本地 profile，也不导入任何 Cookie
- `profile` 下，后续新页面直接继承这个 profile，不再每个页面重复注入 Cookie

推荐做法：

1. 首次运行时用可见浏览器完成一次 TikTok 登录，保留 `browser.auth.userDataDir`
2. 后续持续复用这个专用 profile
3. 如果需要从别的浏览器迁移登录态，再准备 `input/tiktok.cookies.json` 作为初始化兜底

`npm run login` 会：

- 强制使用 `profile` 模式
- 打开可见浏览器
- 进入 TikTok 登录页等待你手动登录
- 检测到登录成功后自动倒计时 5 秒退出
- 将状态保存到 `browser.auth.userDataDir`

Cookie 文件支持两种格式：

```json
[
  {
    "name": "sessionid",
    "value": "xxx",
    "domain": ".tiktok.com",
    "path": "/"
  }
]
```

```json
{
  "cookies": [
    {
      "name": "sessionid",
      "value": "xxx",
      "domain": ".tiktok.com",
      "path": "/"
    }
  ]
}
```

## 使用步骤

使用默认配置运行：

```bash
npm start
```

如果要切换另一份配置文件：

```bash
node src/index.js --config=/absolute/path/my.config.js
```

也可以临时覆盖搜索页链接：

```bash
node src/index.js --config=./config/default.config.js --url="https://www.tiktok.com/search/video?q=%23tech&t=1777477567556"
```

无限滚动模式：

```bash
npm start
```

说明：无限模式现在建议直接在配置文件里改 `search.infinite = true`

停止方式：

- 在终端按 `Ctrl + C`
- 脚本会先保存断点，再安全退出
- 下次用同一个 `--url` 重新执行即可续跑，断点信息会从实时 Excel 中自动恢复

可选启动方式：

```bash
node src/index.js --config=./config/default.config.js
node src/index.js --config=/absolute/path/my.config.js
node src/index.js --config=./config/default.config.js --url="https://www.tiktok.com/search/video?q=%23tech&t=1777477567556"
```

## 关键配置项

- `search`:
  - `url`: 搜索页链接
  - `infinite`: 是否无限滚动
  - `parallelAuthors`: 同时并行分析多少个作者主页
  - `targetCount`: 非无限模式下目标发现作者数
  - `searchScrolls`: 非无限模式下最大空转轮数
  - `idleRounds`: 无限模式下连续多少轮无新作者就刷新搜索页
  - `maxProcessed`: 单次最多分析多少个作者
- `browser`:
  - `headless`: 是否无头
  - `timeoutMs`: 页面超时
  - `viewport.width` / `viewport.height`: 浏览器窗口尺寸
  - `userAgent`: 浏览器 UA
  - `auth.mode`: 登录态策略，支持 `profile` 和 `anonymous`
  - `auth.userDataDir`: TikTok 专用 profile 目录
  - `auth.cookieFile`: Cookie 文件路径
- `scroll`:
  - `scrollWaitMs`: 每次滚动后的统一等待时间
  - `apiWaitMs`: 页面打开或滚动后，最多等多久让接口返回或页面就绪
- `rules`:
  - `levels`: 等级数组，顺序就是判定优先级和导出顺序
  - `excludeRecentHours`: 排除最近多少小时内发布的视频
  - `levels[*].minFollowers`: 粉丝门槛
  - `levels[*].stablePercent`: 该等级使用的稳定播放比例，例如 `0.9` 表示 90% 稳定播放
  - `levels[*].stablePlay`: 稳定播放量门槛
  - `levels[*].minPlay`: 最低播放量门槛
  - `levels[*].recentVideoCount`: 分析最近多少条视频
  - 作者主页会按 `levels[*].recentVideoCount` 和 `rules.audience.recentVideoCount` 的最大值自动决定滚动目标；如果视频不足，会继续滚到没有新增内容为止
  - `audience.enabled`: 是否启用受众国家筛选
  - `audience.requiredTopCountry`: 主受众国家必须是哪一个
  - `audience.recentVideoCount`: 受众分析最多使用最近多少条视频作为候选
  - `audience.maxVideos`: 最多抓多少条视频的评论
  - `audience.maxPagesPerVideo`: 每条视频最多抓多少页评论
  - `audience.maxUsersPerVideo`: 每条视频最多计入多少个唯一评论用户
  - `audience.sampleTarget`: 总共希望抓到多少个受众样本
- `export`:
  - `outputDir`: 导出目录
  - `qualifiedOnly`: 是否主导出只保留合格账号

## 输出文件

- `output/tiktok_qualified_live.xlsx`

其中：

- `tiktok_qualified_live.xlsx` 除了实时合格账号外，还会内置断点信息 sheet，便于直接续跑

表格字段包含：

- 用户名 / 昵称 / 主页链接
- 主受众国家 / 主受众国家占比 / 受众样本数 / 受众筛选达标
- 来源搜索页 / 来源视频链接 / 搜索页摘录
- 粉丝量
- 粉丝归属等级 / 当前分析等级 / 最高满足等级 / 命中等级列表
- 选取视频数 / 总抓取视频数
- 稳定播放比例
- 最低播放量
- 第二低 / 第三低播放量
- 稳定播放量
- 各项门槛及是否达标
- 接口命中次数

## 当前筛选规则

默认规则现在以配置优先为主，所有等级都在 `rules.levels` 数组中维护：

- 数组顺序决定等级判定顺序和导出 sheet 顺序
- 取样前会先排除最近 `24` 小时内发布的视频
- 受众国家按评论用户的 `region` 样本统计，国家数量最多的就是主受众国家
- 默认只保留主受众国家为 `US` 的账号
- `top`: 粉丝 `>= 5,000,000`，稳定播放比例 `90%`，稳定播放量 `>= 1,000,000`，最低播放 `>= 500,000`，分析最近 `30` 条视频
- `mid`: 粉丝 `>= 200,000`，稳定播放比例 `90%`，稳定播放量 `>= 200,000`，最低播放 `>= 150,000`，分析最近 `30` 条视频
- `tail`: 粉丝 `>= 5,000`，稳定播放比例 `90%`，稳定播放量 `>= 20,000`，最低播放 `>= 10,000`，分析最近 `20` 条视频

计算方式：

- `最低播放量`: 选中视频播放量升序后的第 1 个
- `稳定播放量`: 按当前等级的 `stablePercent` 计算，例如 `0.9` 时取“90%稳定播放”，`0.8` 时取“80%稳定播放”

导出分类：

- `tiktok_qualified_live.xlsx` 会在运行过程中实时更新合格账号
- `tiktok_qualified_live.xlsx` 里会额外包含断点 sheet，例如 `断点统计`、`断点_已发现`、`断点_已处理`
- 整个 `output` 目录默认只保留这一个结果表，不再额外生成时间戳结果文件和 JSON 明细文件

## 注意

- TikTok 可能因地区、风控、验证码导致接口返回不稳定。
- TikWM 公开接口有时会被 Cloudflare 拦截，兜底能力不保证 100% 可用。
- 如果遇到验证码或页面异常，先使用非 headless 模式排查。
- `browser.auth.userDataDir` 建议使用单独目录，不要直接复用日常 Chrome 默认目录。
- `input/tiktok.cookies.json` 已加入 `.gitignore`，不要把真实 TikTok Cookie 提交到仓库。
- `browser.auth.cookieFile` 只会在 profile 目录不存在时用于首次初始化，不会在每次启动时反复覆盖已有状态。
- 如果你要纯净访问且不带历史 Cookie，直接把 `browser.auth.mode` 改成 `anonymous`。
- 断点续跑要求 `--url` 与实时 Excel 内记录的搜索链接保持一致。
