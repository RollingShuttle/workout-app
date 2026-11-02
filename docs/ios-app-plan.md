# 把训练追踪 PWA 做成 iOS App 的方案（2026-11-02）

目标：保留现在这套网页代码，套一层原生壳，拿到 PWA 做不到的三样东西——**组间休息到点时锁屏也能提醒**、**训练日提醒**、**不碰手机就能"完成一组"**（耳机键 / 轻点背面 / 动作按钮 / Siri）。顺带把屏幕常亮、震动反馈、导出到"文件"做得更稳。

这份文档是给在 MacBook 上开工用的：新会话先读 `CLAUDE.md`、`PROGRESS.md` 和这份文档，按第 6 节的步骤一步一验收。

## 1. 结论

- 用 **Swift + WKWebView 壳**（自己写，不用 Capacitor）。网页部分一行不改地打进 App，原生只写四小块：桥接、通知、App Intents、耳机媒体键。总共几百行 Swift。
- 网页端只加一个很薄的 `native.js`，PWA 版和 App 版共用同一套代码，GitHub Pages 继续能用。
- 分发用 **TestFlight**（需要付费的 Apple Developer Program，99 美元 / 年）。免费账号只能用 Xcode 直装，签名 7 天过期，不适合天天用的 App。
- 耳机键有个硬限制（见 4.3）：iOS 只把耳机键事件给"正在播放"的 App。要收到耳机键，App 得自己播一段静音音轨并接管播放，这会**停掉你正在听的音乐 / 播客**。所以免提控制的主方案是 **轻点背面 / 动作按钮 / Siri（App Intents）**，耳机键做成设置里的开关，想用再开。

## 2. 方案对比

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| 继续 PWA | 不变 | 零成本 | 没通知、没耳机键、没 Siri、常亮只在前台 |
| **Swift WKWebView 壳（选这个）** | Xcode 工程里一个 WKWebView 加载打包进去的网页，Swift 写桥接和原生功能 | 依赖最少、网页代码复用 100%、原生部分小而可控、不需要 Node | 要会一点 Swift（我来写）、要 Mac + Xcode |
| Capacitor 壳 | 用 Capacitor 工具链生成 iOS 工程，插件提供通知等 | 现成插件多 | 引入 Node / npm 构建链，耳机键仍要自己写插件，和"依赖越少越好"冲突 |
| SwiftUI 原生重写 | 全部重做 | 最"原生" | 几周工作量，现有逻辑全要重写一遍，没必要 |

## 3. 架构

### 3.1 仓库结构

```
workout-app/
  index.html, app.js, ...        ← 网页部分不动（PWA 照常部署到 GitHub Pages）
  native.js                      ← 新：网页和原生的桥接层（PWA 里也加载，没原生时全是空操作）
  ios/
    WorkoutShell.xcodeproj
    WorkoutShell/
      App.swift                  ← 入口，AppDelegate / 通知代理
      WebView.swift              ← WKWebView + 自定义 scheme 加载 + 消息处理
      Bridge.swift               ← JS ↔ Swift 的消息路由
      Notifications.swift        ← 本地通知
      RemoteControl.swift        ← 耳机媒体键（静音音轨 + MPRemoteCommandCenter）
      Intents.swift              ← App Intents（完成一组 / 重置秒表 / 开始训练）
      Info.plist, Assets
    copy-web.sh                  ← Build Phase：把仓库根目录的网页文件复制进 App bundle 的 web/
```

- 网页文件在构建时复制进 App（Run Script Build Phase），不要手动维护第二份。
- `sw.js` 在 App 里不注册（WKWebView 不需要离线缓存，文件本来就在本地）；`native.js` 里判断。

### 3.2 网页怎么加载

- 不用 `file://`（WKWebView 下 IndexedDB / 持久化不可靠），用 **WKURLSchemeHandler** 自定义 `app://local/`，把 bundle 里的 `web/` 目录当静态服务器。这样 origin 固定，IndexedDB 一直在，`WKWebsiteDataStore.default()` 持久化。
- `WKWebViewConfiguration`：`allowsInlineMediaPlayback = true`，`mediaTypesRequiringUserActionForPlayback = []`（静音音轨要能自动播）。
- 外链（GitHub 仓库之类）用 `SFSafariViewController` 打开，别在壳里导航走。

### 3.3 数据

- 和 PWA 一样全在 IndexedDB 里（WKWebView 的那份）。**App 和主屏幕 PWA 是两套存储**，换过去时用现有的"导出 JSON → 导入"搬一次，之后只用 App。
- 导出：原生用 `UIActivityViewController` 弹分享面板（比 `navigator.share` 稳），能存到"文件" / iCloud Drive。导入：`UIDocumentPickerViewController`，选中后把文件内容传回网页，走现有 `parseBackup`。
- 备份建议：App 版也保留每 14 天提醒；以后可加"自动备份到 iCloud Drive 的 App 文件夹"（原生写文件，网页不用改）。

### 3.4 桥接协议（JS ↔ Swift）

网页 → 原生：`window.webkit.messageHandlers.native.postMessage({ type, ...payload })`。
原生 → 网页：`webView.evaluateJavaScript("window.nativeEvent(" + json + ")")`，`native.js` 里把它转成 `window.dispatchEvent(new CustomEvent('native', { detail }))`。

网页发给原生的消息：

| type | 字段 | 作用 |
| --- | --- | --- |
| `ready` | | 网页加载完，原生回 `hello`（带版本、能力列表） |
| `restTimer.set` | `at`（毫秒时间戳）, `title`, `body` | 在 `at` 那一刻发本地通知（组间休息到点）；重复调用先取消旧的 |
| `restTimer.clear` | | 取消组间通知 |
| `reminders.set` | `items: [{ id, weekday, hour, minute, title, body }]` | 训练日提醒（按星期重复） |
| `reminders.clear` | | |
| `keepAwake` | `on` | 屏幕常亮（`UIApplication.shared.isIdleTimerDisabled`） |
| `haptic` | `kind`: `light` / `success` / `warning` | 震动反馈 |
| `remote.enable` | `on` | 开关耳机键接管（见 4.3） |
| `export` | `name`, `json` | 弹分享面板 |
| `import` | | 弹文件选择器，选完原生发 `import.result` |
| `state` | `inTraining`, `activeExercise`, `restRunning` | 网页把当前状态同步给原生，App Intents 和锁屏"正在播放"卡用 |

原生发给网页的事件（`detail.type`）：

| type | 字段 | 作用 |
| --- | --- | --- |
| `hello` | `version`, `caps` | 能力列表：`notifications`, `remote`, `intents`… |
| `command` | `name`: `completeSet` / `resetRest` / `startTraining` / `nextExercise` | 来自耳机键、轻点背面、动作按钮、Siri |
| `notification.permission` | `granted` | |
| `import.result` | `name`, `text` | |
| `foreground` | | App 回到前台（网页里重算秒表，和现在的 visibilitychange 一样） |

`native.js` 暴露给 app.js 的接口（PWA 里没有原生时都是空函数、`caps` 为空）：

```js
export const native = {
  available: false,
  caps: new Set(),
  restTimer: { set(at, title, body) {}, clear() {} },
  reminders: { set(items) {}, clear() {} },
  keepAwake(on) {},
  haptic(kind) {},
  remote(on) {},
  exportFile(name, json) {},   // 返回 true 表示原生接管了，网页不再走 navigator.share
  importFile() {},             // 返回 true 表示原生接管了
  state(s) {},
  onCommand(fn) {},            // 注册 completeSet 等命令的处理
};
```

## 4. 功能设计

### 4.1 组间休息到点提醒（最有价值的一项）

- 网页在"完成一组"时已经有 `restStartedAt` 和参考休息秒数：调用 `native.restTimer.set(restStartedAt + reference * 1000, '休息到了', '斜上卧推 · 参考 02:30')`。撤销 / 重置 / 再完成一组 / 结束训练时 `clear` 再 `set`。
- 原生用 `UNUserNotificationCenter` 的 `UNTimeIntervalNotificationTrigger`，带声音（`UNNotificationSound.default`）和震动（通知自带）。App 在前台时通知也要显示（`willPresent` 返回 `.banner, .sound`），这样不用再做 WebAudio 提示音，设置里的"提示音"开关在 App 版就控制这条通知有没有声音。
- 锁屏时通知出来，点它回到 App，网页收到 `foreground` 重算秒表。
- 权限：第一次点"完成一组"时申请（在手势里），不要在启动时申请。

### 4.2 训练日提醒

- 设置页加"训练提醒"：时间（如 18:30）、开关。网页按计划算出未来 14 天哪天是训练日（力量 / 有氧 / 打球），每次打开 App 和每次改计划时重新 `reminders.set`。
- 原生用 `UNCalendarNotificationTrigger`（按具体日期，不用按星期重复，因为有调课和轮流）。一次最多排 64 条，14 天够用。
- 内容："今天 拉日 · 正手 · 引体向上 · 坐姿正手宽距划船 …"（网页拼好传过去）。

### 4.3 不碰手机就能"完成一组"

**硬限制**：iOS 的耳机键（AirPods 捏一下 / 线控）走 `MPRemoteCommandCenter`，只发给当前"正在播放"的 App。App 要想收到，必须把 `AVAudioSession` 设成 `.playback`（不混音）并且真的在播放音频。我们播一段循环的静音音轨就能接管，但这会停掉 Spotify / 播客。没有绕过的办法；用 `.mixWithOthers` 就收不到键。

所以做两套，默认 A：

**A. App Intents（推荐，不影响听歌）**
- 定义三个 `AppIntent`：`完成一组`、`重置秒表`、`开始今天的训练`。App 在后台也能被触发（`openAppWhenRun = false` 的 intent 可以不拉起界面；但我们的逻辑在网页里，所以 intent 收到后：如果 WKWebView 活着就 `evaluateJavaScript` 发 `command`，网页照常处理并写库；如果 App 被系统杀了，intent 把命令存到 `UserDefaults` 队列，下次网页 `ready` 时补发——"完成一组"补发时用当时的时间戳，秒表才准）。
- 触发方式（用户在系统里设一次）：
  - **轻点背面**：设置 → 辅助功能 → 触控 → 轻点背面 → 轻点两下 → 选快捷指令"完成一组"。练的时候手机在口袋里敲两下就记一组，不用看屏幕。
  - **动作按钮**（iPhone 15 Pro 及以后）：设置 → 动作按钮 → 快捷指令 → 完成一组。
  - **Siri**："嘿 Siri，完成一组"。
  - Apple Watch 的快捷指令 App 也能点。
- 反馈：命令执行后 `haptic('success')` 震一下，锁屏通知"第 2 组已记，休息开始"（可选，设置里开）。

**B. 耳机媒体键（可选，开关在设置里）**
- 打开后：`AVAudioSession` 设 `.playback`，`AVAudioPlayer` 循环播放 bundle 里的 1 秒静音 m4a，`MPNowPlayingInfoCenter` 显示"训练中 · 斜上卧推 第 2 组"（锁屏和控制中心能看到），注册 `MPRemoteCommandCenter`：
  - 播放 / 暂停（捏一下）→ `completeSet`
  - 下一曲（捏两下）→ `resetRest`
  - 上一曲（捏三下）→ `nextExercise`（切到下一个待做动作，网页需要加这个小功能）
- 关掉或结束训练时停播、释放音频会话，把播放权还给别的 App。
- 要加 Background Modes → Audio，否则锁屏后静音播放会被停掉。
- 设置页说明写清楚："开着的时候不能同时听歌"。

### 4.4 其他原生小功能

- 屏幕常亮：`isIdleTimerDisabled`，比 Wake Lock 稳；设置里的开关直接映射。
- 震动：完成一组轻震、到参考时长（前台时）一次 success 震、规则冲突 warning 震。
- 导出 / 导入：见 3.3。
- 深色模式跟随系统：网页已经是 `prefers-color-scheme`，WKWebView 自动跟随。
- 状态栏 / 安全区：`viewport-fit=cover` 已有，壳里把 WKWebView 铺满并关掉自动 inset 调整（`scrollView.contentInsetAdjustmentBehavior = .never`），网页用 `env(safe-area-inset-*)` 自己留边。

## 5. 账号、分发、设备

- **Apple Developer Program**（付费）：TestFlight 分发给你和太太两台手机，构建 90 天有效，到期前再传一个。不需要上架 App Store，也就不用过审。
- 免费 Apple ID：只能 Xcode 直装，7 天就要重签，还限 3 个 App，先别用。
- Mac：Xcode 16 或更新（macOS 14.5+）。装 Claude Code 和 git。
- iPhone：iOS 17+（App Intents 和轻点背面都要）。开发者模式打开（设置 → 隐私与安全性 → 开发者模式）。
- Bundle ID 用你自己的反域名，如 `com.<你的名字>.workout`。两台手机用同一个 TestFlight 构建，数据各自独立（和 spec 一致）。

## 6. 实施步骤（在 MacBook 上，一步一验收，每步提交）

每一步做完都按 CLAUDE.md 的规矩：验收、`git commit`、PROGRESS.md 追加一行。新会话开头说"按 docs/ios-app-plan.md 做第 N 步"。

**第 0 步 · 环境**
- 克隆仓库，装 Xcode，登录开发者账号，手机连上并信任。
- 验收：Xcode 新建一个空 iOS App 能装到手机上运行。

**第 1 步 · 壳能跑网页**
- `ios/` 下建工程 WorkoutShell（SwiftUI App 生命周期，iOS 17 起）。
- `copy-web.sh` 把根目录的 html / js / css / json / icons / manifest 复制进 bundle 的 `web/`（排除 `docs/`、`tools/`、`.git`、`sw.js`）。
- `WebView.swift`：WKURLSchemeHandler 服务 `app://local/…`，按扩展名给 MIME；WKWebView 加载 `app://local/index.html`。
- `native.js`：只做检测和空实现；`app.js` 的 SW 注册在 `native.available` 时跳过。
- 验收：手机上 App 打开就是首页；关掉重开记录还在（IndexedDB 持久）；深色模式跟随；安全区正确；横向无溢出。

**第 2 步 · 桥接 + 常亮 + 震动**
- `Bridge.swift` 收 `postMessage`，分发；`hello` 回能力。
- `keepAwake`、`haptic` 接上设置页和"完成一组"。
- 验收：设置里开常亮，训练页放着 2 分钟不锁屏；完成一组有震动；PWA 版（Safari）不报错。

**第 3 步 · 组间通知**
- `Notifications.swift`：权限申请、`restTimer.set/clear`、前台也显示。
- 网页：`completeSet` / `undo` / `resetRest` / 结束训练 / 放弃 时调用。
- 验收：完成一组后锁屏，到参考时长锁屏弹通知带声音；撤销后不弹；重置后按新时间弹；结束训练后不弹。

**第 4 步 · 训练日提醒**
- 设置页加时间和开关；网页算 14 天；原生 `reminders.set`。
- 验收：把时间设成 2 分钟后，到点收到"今天 推日 · …"；休息日不提醒；改计划后内容跟着变。

**第 5 步 · App Intents + 轻点背面**
- `Intents.swift` 三个 intent + `AppShortcutsProvider`（让它们出现在快捷指令 App 和 Siri 里）。
- 命令队列：App 没活着时存 `UserDefaults`，`ready` 后补发（带时间戳）。
- 网页：`command` 事件处理；`nextExercise` 小功能。
- 验收：轻点背面两下，训练页的进行中动作多一组、秒表归零、震一下；锁屏状态下敲两下也记上（回到前台看到）；"嘿 Siri 完成一组"同样；没有进行中动作时不记并提示。

**第 6 步 · 耳机媒体键（可选）**
- `RemoteControl.swift`：静音音轨、Now Playing 信息、三个命令；设置页开关和说明；Background Modes → Audio。
- 验收：开着时 AirPods 捏一下记一组、捏两下重置；锁屏显示"训练中 · 动作名"；关掉后 Spotify 能正常播放并拿回耳机键。

**第 7 步 · 导出导入走原生**
- `export` 弹分享面板存到"文件"；`import` 文件选择器。
- 验收：导出到 iCloud Drive，删 App 重装后导入，历史和计划完整；PWA 导出的文件在 App 里能导入。

**第 8 步 · TestFlight**
- Archive → 上传 → TestFlight 内部测试加两个 Apple ID。
- 验收：两台手机从 TestFlight 装上，各自首次启动页，数据互不可见。

## 7. 网页端可以先在 Windows 上做的部分

这些不依赖 Mac，可以现在就做，PWA 版不受影响：

1. `native.js` 骨架 + `app.js` 接入（SW 注册跳过、`onCommand` 处理 `completeSet` / `resetRest` / `startTraining` / `nextExercise`、`state` 同步）。
2. 组间通知的调用点（`restTimer.set/clear`）——PWA 里是空操作。
3. 设置页：训练提醒时间 + 开关、耳机键开关（原生不在时显示"App 版才有"并禁用）。
4. "下一个动作"命令：把进行中动作切到下一个待做动作。
5. 导出 / 导入先问 `native.exportFile / importFile`，返回 false 再走现在的 `navigator.share` / `<input type=file>`。

做完这些，Mac 上的工作就只剩 Swift 那几百行和 Xcode 配置。

## 8. 风险与注意

- WKWebView 里的 IndexedDB 偶尔有和 Safari 一样的"open 不回调"问题，现有的 3 秒超时兜底保留。
- 本地通知最多排 64 条，组间 1 条 + 训练日 14 条远够。
- 通知时间按排的时间戳走，和秒表一样不依赖后台 JS，所以 App 被杀也准。
- App Intents 在 App 被杀时拿不到网页状态，所以"完成一组"是否有进行中动作只能补发后由网页判断；补发失败（没有进行中动作）要通知一下用户。
- 耳机键方案 B 和听歌互斥，这是 iOS 的规则，文档和设置页都要写明。
- 升级：网页改了要重新 Archive 上传 TestFlight，手机上 TestFlight 会提示更新。想省事可以让壳在有网时从 GitHub Pages 拉最新网页文件缓存到本地（第二阶段再说）。
- 两台手机各一份数据、不同步，和 spec 一致；太太的手机装 App 后同样先选内置或空白计划。

## 9. 开工前的准备清单

- [ ] Apple Developer Program 通过（收到邮件后在 Xcode → Settings → Accounts 登录）
- [ ] MacBook 装好 Xcode（App Store），打开过一次让它装完组件
- [ ] MacBook 装 git 和 Claude Code，`git clone` 仓库
- [ ] iPhone 开开发者模式，数据线
- [ ] 想好 Bundle ID 和 App 名（主屏幕显示的名字，如"训练"）
- [ ] 一个 1 秒静音的 m4a（第 6 步用，到时我用 `afconvert` 生成）
- [ ] PWA 里先导出一份 JSON 备份，App 装好后导入
