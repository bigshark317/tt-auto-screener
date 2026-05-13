# TikTok Auto Screener

这是一个 `Chrome 插件 + 本地 Node 服务` 版 TikTok 达人筛选工具。它不再使用 Puppeteer，也不再打开自动化浏览器登录 TikTok；插件运行在你正常登录的 Chrome 标签页里，本地服务负责把结果和断点写入 Excel。

## 功能

- 在 TikTok 搜索页自动滚动并发现作者主页链接
- 自动打开作者主页并采集昵称、粉丝数、简介邮箱、视频播放量
- 复用当前 Chrome 的 TikTok 登录态，不需要扫码登录自动化浏览器
- 按配置好的粉丝量、最低播放、稳定播放规则筛选账号
- 采集结果和断点自动写入本地 Excel 表格
- 下次启动时自动从 Excel 读取断点续跑
- 支持开始/暂停、重置、恢复默认配置

## 目录

```text
tt-auto-screener/
  manifest.json
  server/
    index.js
    excel-store.js
    analyzer.js
  src/
    background.js
    content.js
    popup/
      popup.html
      popup.css
      popup.js
    shared/
      analyzer.js
      config.js
  output/
    tiktok_qualified_live.xlsx
```

## 启动本地服务

插件要把表格写到本机文件、并在服务端执行受众分析，需要先启动本地 Node 服务：

```bash
cd "/Users/bytedance/Desktop/BB-达人助手正式版 v2.0 2/tt-auto-screener"
npm run server
```

如果要启用 TikWM 评论受众分析，当前服务会默认复用旧插件里的 TikWM 配置：

```text
免费接口: https://www.tikwm.com/api
付费接口: https://api.tikwmapi.com
默认付费 key: 复用旧插件 config.js 中的现有值
```

你也可以在启动前用环境变量覆盖：

```bash
export TT_TIKWM_API_KEY="你的 TikWM key"
export TT_TIKWM_BASE_URL="https://www.tikwm.com/api"
export TT_TIKWM_PAID_BASE_URL="https://api.tikwmapi.com"
npm run server
```

如果你的 TikWM 评论接口路径不同，可以额外配置：

```bash
export TT_TIKWM_COMMENT_ENDPOINT="{baseUrl}/comment/list?url={videoUrl}&count={count}&cursor={cursor}"
```

服务默认监听：

```text
http://127.0.0.1:17321
```

Excel 默认写入：

```text
output/tiktok_qualified_live.xlsx
```

## 安装插件

1. 打开 Chrome，访问 `chrome://extensions/`
2. 打开右上角 `开发者模式`
3. 点击 `加载已解压的扩展程序`
4. 选择本项目目录：

```text
/Users/bytedance/Desktop/BB-达人助手正式版 v2.0 2/tt-auto-screener
```

## 使用方式

1. 用正常 Chrome 登录 TikTok
2. 打开 TikTok 探索页，默认是 `https://www.tiktok.com/explore`
3. 点击浏览器右上角插件图标
4. 填入或确认搜索页链接
5. 确认 popup 里 `本地服务` 显示 `已连接`
6. 在 popup 的 `配置` 区域调整搜索、滚动、受众、等级规则
7. 配置项失焦后会自动保存，直接点击 `开始`
8. 运行中主按钮会变成 `暂停`，需要暂停时再点一次
9. 下次打开插件时会自动从 Excel 读取断点，主按钮显示 `继续`，点击即可接着跑

## 插件配置

原默认配置已经迁移到 popup 的 `配置` 区域：

- `本地服务地址`: 默认 `http://127.0.0.1:17321`
- `搜索页链接`: TikTok 抓取入口 URL，默认 `https://www.tiktok.com/explore`
- `最多处理`: 本次最多分析多少个作者，`0` 表示不限
- `空转停止轮数`: 连续多少轮没有新增后自动停止
- `搜索滚动等待 ms`: 搜索页每次滚动后的等待时间
- `主页滚动等待 ms`: 主页每次滚动后的等待时间
- `采集主页时激活标签`: 是否打开主页时切到前台
- `排除最近小时`: 排除最近发布的视频，避免播放量未稳定
- `启用受众筛选`: 开启后由本地 Node 服务调用 TikWM 评论接口分析
- `要求主受众国家`: 启用受众筛选时使用
- `受众最小样本`: 评论国家样本数低于该值时不通过
- `主受众最低占比 %`: 主受众国家占比低于该值时不通过
- `受众采样视频数`: 从主页视频里取多少个视频做评论采样
- `每视频评论数`: 每个视频最多取多少条评论
- `等级规则`: 每个等级的标识、名称、稳定播放比例、粉丝门槛、稳定播放门槛、最低播放门槛、最近视频数

配置保存位置：

- 输入框失焦、复选框变化后会自动保存到 Chrome 的 `chrome.storage.local`
- 点击 `开始/继续` 时也会自动保存当前表单配置
- 点击 `重置` 只清空任务断点和表格，不会清空配置
- 点击 `恢复默认配置` 才会把配置恢复为内置默认值

## 本地断点和表格

- 本地服务会自动把合格结果、发现列表、待处理队列、已处理名单保存到 Excel
- 插件会保留一份 `chrome.storage.local` 作为服务未启动时的兜底
- 不需要手动导入断点
- popup 里会显示 `本地服务`、`断点来源`、`表格路径`、`表格行数`、`上次保存`
- 点击 `暂停` 只会暂停任务，不会删除本地数据
- 点击 `重置` 会清空浏览器本地断点，并请求本地服务清空 Excel 断点表

Excel 内包含：

- `头部 KOL`: 合格且最高命中 `头部 KOL` 的结果
- `普通 KOL`: 合格且最高命中 `普通 KOL` 的结果
- `小小号`: 合格且最高命中 `小小号` 的结果
- `尾部 KOC`: 合格且最高命中 `尾部 KOC` 的结果
- `断点统计`: 搜索链接、保存时间、计数、配置
- `断点_已发现`: 已发现作者
- `断点_待处理`: 待处理队列
- `断点_已处理`: 已处理用户名
- `断点_日志`: 最近运行日志

结果 sheet 只保存合格账号；失败和不合格账号不会进入结果 sheet，只会通过 `断点_已处理` 防止重复处理。

## 登录态说明

- 插件直接运行在正常 Chrome 中，使用当前浏览器的 TikTok 登录态
- 不需要 `npm run login`
- 不需要 Puppeteer
- 不建议在自动化浏览器里扫码登录 TikTok，容易被拦截
- 如果 TikTok 弹验证码或登录失效，请先在正常 Chrome 里手动处理

## 筛选规则

默认规则在 [config.js](file:///Users/bytedance/Desktop/BB-%E8%BE%BE%E4%BA%BA%E5%8A%A9%E6%89%8B%E6%AD%A3%E5%BC%8F%E7%89%88%20v2.0%202/tt-auto-screener/src/shared/config.js) 里维护，也可以直接在插件 popup 里改：

- `top`: 粉丝 `>= 5,000,000`，90% 稳定播放 `>= 1,000,000`，最低播放 `>= 350,000`
- `mid`: 粉丝 `>= 100,000`，90% 稳定播放 `>= 130,000`，最低播放 `>= 60,000`
- `little`: 粉丝 `>= 100,000`，50% 稳定播放 `>= 80,000`，最低播放 `>= 20,000`
- `tail`: 粉丝 `>= 5,000`，90% 稳定播放 `>= 0`，最低播放 `>= 4,000`

计算方式：

- `最低播放量`: 选中视频播放量升序后的第 1 个
- `稳定播放量`: 按当前等级的 `stablePercent` 计算
- 默认排除最近 `24` 小时内发布的视频
- 受众分析在本地服务执行，插件只负责采集主页和视频基础信息
- 开启受众筛选后，必须配置可用的 TikWM 评论接口，否则账号会因为受众分析失败而不合格

## 开发校验

项目不需要 Puppeteer。可用下面命令做语法检查：

```bash
npm run check
```

## 注意

- 插件版依赖 TikTok 页面 DOM，页面结构变化时可能需要更新选择器
- 插件不会绕过 TikTok 风控、验证码、地区限制
- 长时间自动滚动仍可能触发限流，请控制采集节奏
- 如果 `本地服务` 未连接，插件仍会临时使用浏览器本地存储，但无法写入 Excel
