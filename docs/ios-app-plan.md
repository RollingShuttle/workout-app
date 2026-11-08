# 把训练追踪 PWA 做成 iOS App 的方案（2026-11-02）

目标：保留现在这套网页代码，套一层原生壳，拿到 PWA 做不到的三样东西——**组间休息到点时锁屏也能提醒**、**训练日提醒**、**不碰手机就能"完成一组"**（耳机键 / 轻点背面 / 动作按钮 / Siri）。顺带把屏幕常亮、震动反馈、导出到"文件"做得更稳。

这份文档是给在 MacBook 上开工用的：新会话先读 `CLAUDE.md`、`PROGRESS.md` 和这份文档，按第 6 节的步骤一步一验收。

## 1. 结论

- 用 **Swift + WKWebView 壳**（自己写，不用 Capacitor）。网页部分一行不改地打进 App，原生只写四小块：桥接、通知、App Intents、耳机媒体键。总共几百行 Swift。
- 网页端只加一个很薄的 `native.js`，PWA 版和 App 版共用同一套代码，GitHub Pages 继续能用。
- 分发用 **TestFlight**（需要付费的 Apple Developer Program，99 美元 / 年）。免费账号只能用 Xcode 直装，签名 7 天过期，不适合天天用的 App。
- 耳机键有个硬限制（见 4.3）：iOS 只把耳机键事件给"正在播放"的 App。要收到耳机键，App 得自己播一段静音音轨并接管播放，这会**停掉你正在听的音乐 / 播客**。**用户决定不做耳机键**（2026-11-02），免提控制走 **轻点背面 / 动作按钮 / Siri（App Intents）**；必须有的是组间到点的提示（本地通知带声音）。

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

**B. 耳机媒体键 —— 不做（用户决定）**
- 原因就是上面的硬限制：接管播放会停掉正在听的音乐。以后要做的话：`AVAudioSession` `.playback` + 循环静音 m4a + `MPNowPlayingInfoCenter` / `MPRemoteCommandCenter`（播放暂停 → completeSet，下一曲 → resetRest，上一曲 → nextExercise），Background Modes → Audio，设置里做开关并说明互斥。

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

**第 6 步 · 耳机媒体键** —— 不做（见 4.3 B）。

**第 7 步 · 导出导入走原生**
- `export` 弹分享面板存到"文件"；`import` 文件选择器。
- 验收：导出到 iCloud Drive，删 App 重装后导入，历史和计划完整；PWA 导出的文件在 App 里能导入。

**第 8 步 · TestFlight**
- Archive → 上传 → TestFlight 内部测试加两个 Apple ID。
- 验收：两台手机从 TestFlight 装上，各自首次启动页，数据互不可见。

## 7. 网页端的部分（2026-11-02 已在 Windows 上做完，v0.22.0）

PWA 版不受影响（没有原生时全是空操作）：

1. `native.js`：桥接层；`window.webkit.messageHandlers.native` 存在才发消息；原生回调入口 `window.nativeEvent(detail)`。
2. `app.js`：有原生时不注册 Service Worker；`syncNative()` 在每次 render 后跑——组间通知 `restTimer.set/clear`（按 restStartedAt + 参考秒数，重复不重发）、训练日提醒 `reminders.set`（未来 14 天）、`state` 同步；命令处理 `completeSet`（按预填值记进行中动作的一组，首次做重量没填过则拒绝并 warning 震动）/ `resetRest` / `startTraining` / `nextExercise`；`import.result` → 预览；`foreground` → 重算秒表；常亮走 `keepAwake`，震动 `haptic`，App 版不用 WebAudio 提示音（通知出声）。
3. 设置页：训练日提醒（时间 + 开关，网页版禁用并说明）；"提示音"在 App 版的说明改成"通知带声音"。
4. 导出先问 `native.exportFile`，导入按钮先问 `native.importFile`。

Mac 上要做的只剩 Swift（`Bridge` 按 3.4 的协议、`Notifications`、`Intents`、分享 / 文件选择器）和 Xcode 配置。原生发命令时带 `at`（毫秒时间戳），排队补发的也准。

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

## 10. 第二期（2026-11-07 立项，用户提的三件事）

Mac 上第一次跑通之后用户提了三点：GitHub 账号加进 Xcode、数据"存在 App 里不用再备份"、手表 App（显示接下来的动作和组间时间、能放到表盘）。本节是核实过的事实和方案，实施仍是一步一验收。事实来源：Apple 文档 / WebKit 源码 / 开发者论坛（2026-11-07 查）。

### 10.1 数据：现在已经在 App 里了

- WKWebView 的 IndexedDB 在 App 容器的 `Library/WebKit/WebsiteData/`（不是 Caches），所以**随 iPhone 的 iCloud 备份 / 电脑备份一起备份**，App 升级（同一个 Bundle ID 装新版）不丢，"卸载 App"会连数据一起删，"卸载未使用的 App（Offload）"不删。
- ITP 的"7 天不用就清空"对 WKWebView 也生效，但只清"用户没交互过"的站点；每次点页面都刷新交互时间，正常使用不会被清。磁盘快满时 WebKit 会按 LRU 清，几 MB 的数据不在前列。
- 所以"不在手机文件里备份"是可以的：换手机用 iCloud 恢复即可。唯一会丢的情形是手动删掉 App。
- 方案（两步，第 1 步免费账号就能做，第 2 步要等付费账号）：
  1. **自动存一份到 App 自己的文件夹**：每次结束训练 / 改记录后，网页发 `backup.save { name, json }`，原生写到 `Documents/训练备份.json`；Info.plist 加 `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace`，这个文件就出现在 文件 App → 我的 iPhone → 训练 里（Apple DTS 说明：两个 key 都是 Info.plist 键，不要付费能力）。App 版隐藏 14 天备份提醒；手动"导出"按钮留着。首次启动库是空的而文件在 → 问要不要恢复。
  2. **付费账号通过后换成 iCloud 云盘**：同一个文件改写到 ubiquity 容器（`FileManager.url(forUbiquityContainerIdentifier:)`，Signing & Capabilities 加 iCloud → iCloud Documents），出现在 文件 → iCloud 云盘 → 训练；删 App 重装也能恢复。Apple 能力表：iCloud（Documents / KVS / CloudKit）和推送都只对付费会员开放，免费 Personal Team 不行；KVS 上限 1 MB / 1024 个 key，不够用。
- 不做：CloudKit 同步（spec 说两台手机独立）。

### 10.2 手表 App

**2026-11-07 作废**（用户决定）：Series 8 最高 watchOS 26，Xcode 27 的 Device Hub 只给 watchOS 27 的手表做无线配对，有线经 iPhone 隧道发现手表试了一晚上没成功（Apple 论坛同配置的人也卡在这）。WorkoutWatch target 已撤（revert cc40940），下面的方案只留作记录。组间到点提醒改成把手机本地通知做扎实（4.1）。

**结论**：可行。手表只是"遥控器 + 显示屏"，手机 App 仍是唯一真相；组间到点的提醒不用写手表代码——iOS 本地通知在手机锁屏时自动转到手表（Apple "notification forwarding"：手机亮着解锁给手机，否则手表戴着且解锁给手表，二者只到一处）。

**架构**
- Xcode 里加 watchOS target：工程 → + → watchOS → App → "Watch app for Existing iOS App"（Xcode 14 起单一 target，无 extension）；最低 watchOS 10（Series 4 及以上能装；Xcode 27 只能在 watchOS 10+ 真机调试）。名字不能和 iOS target 相同，叫 `WorkoutWatch`。
- 手机 → 手表：`WCSession.updateApplicationContext`（只保留最新一份，对方没在跑也能发，下次醒来就有）。内容 = 网页的 `native.state` 扩成**完整训练状态**：`{ inTraining, title, activeId, restStartedAt, exercises: [{ id, name, setsTarget, setsDone, weight, reps, restSeconds }] }`（几百字节）。不训练时发 `{ inTraining:false, today: "推日" | "休息" }`。
- 手表 → 手机：`WCSession.sendMessage`。Apple 文档：手表 App 在前台或高优先级后台时调用，**会在后台唤醒手机 App**；对方不可达则报错、不排队。
- 手机后台时网页 JS 是停的，所以**原生自己维护一份影子状态**（AppState 存整个 exercises 列表）：收到手表的"完成一组"→ 影子 setsDone+1、restStartedAt=now、按该动作 restSeconds 重排组间通知、立刻把新状态推回手表；同时命令带时间戳进现有的 CommandQueue，手机回前台网页按原时间戳补记（`handleNativeCommand` 已支持 `at`）。"下一个动作"同理：影子 activeId 切到列表里下一个没做完的。这样手机在口袋里也能全程用手表操作，网页回来后一致。
- 手表界面（SwiftUI，一屏）：大字秒表（`Text(timerInterval:)`，不用定时器）+ 参考时长、进行中动作名 + 第 N/M 组 + 预填重量×次数、下一个动作名、按钮"完成一组""下一个动作"。不训练时显示"今天 推日"+ 动作清单。
- 手表保活：默认不用 HealthKit。让用户把 手表 设置 → 通用 → 返回表盘 → 训练 → 1 小时后，训练中抬腕就是 App。可选项（第 6 步）：训练开始时启动 `HKWorkoutSession`（力量训练），App 在后台持续运行、抬腕回到 App、顺便记进健康 App 带心率；HealthKit 能力免费账号也有，但要 Info.plist `WKBackgroundModes = workout-processing` + 健康权限。
- 表盘（复杂功能 = WidgetKit accessory 小组件，watchOS 9+）：`accessoryRectangular`（动作名 + 秒表）、`accessoryCircular`（秒表环）、`accessoryInline`（"推日 · 下一个 引体向上"）。秒表用 `Text(timerInterval:)` 自己走、不用刷新；数据走 App Group 的 UserDefaults（手表 App 收到状态就写 + `WidgetCenter.reloadAllTimelines()`，表盘上的小组件每天约 75 次刷新额度，手表 App 在前台时刷新不计）。限制：小组件没有按钮，点它打开手表 App；`transferCurrentComplicationUserInfo` 对 WidgetKit 小组件不生效（Apple 工程师 2024），所以表盘只在手表 App 收过数据后更新——用户本来就在手表 App 上点"完成一组"，够用。

**前提**
- 手表型号：watchOS 26 要 Series 6 / SE 2 / Ultra 起；watchOS 27 要 Series 9 / SE 3 / Ultra 2 起；最低部署 watchOS 10 则 Series 4 起能装。
- 调试：手表要和插在 Mac 上的 iPhone 配对，手机和手表都开开发者模式（手表：设置 → 隐私与安全性 → 开发者模式），Mac 通过手机隧道连手表；手表要亮着解锁。
- 免费 Personal Team 能装到真手表（iOS + 手表算一个 App；3 个 App / 设备、7 天过期要重装）；TestFlight 要付费账号，手表 App 随 iOS App 一起上传，测试员在 TestFlight App 的 App 详情页里装手表端（要 watchOS 9+）。

**实施步骤**（每步一验收一提交）
1. 网页端（Windows 上做、浏览器验收）：`native.state` 扩成完整训练状态；`backup.save` 调用点；App 版隐藏备份提醒。 ✅ 2026-11-07（v0.23.0，浏览器验收通过）
2. iOS：`backup.save` 写 Documents + Info.plist 两个 key；首次启动空库 + 有文件 → 恢复提示。验收：文件 App 里看到 训练/训练备份.json；清空全部数据后能恢复（删 App 会连文件一起删，iCloud 云盘容器才解决，见第 2 步）。 ✅ 2026-11-07 写好（BackupStore.swift、Bridge、AppState 递归清理嵌套状态），未编译，Mac 上验收
3. Xcode 加 `WorkoutWatch` target，空页面"训练"，装到真手表。验收：手表上打开有字。
4. WCSession：手机发完整状态，手表显示今天计划 / 进行中动作 / 秒表。验收：手机上记一组，手表 2 秒内变。
5. 手表"完成一组 / 下一个动作"：影子状态 + 队列 + 通知重排。验收：手机锁屏放口袋，手表记两组，到点手表震，手机解锁后网页里两组都在、时间对。
6. 表盘小组件三种尺寸 + App Group。验收：加到表盘，训练中显示动作和秒表，点开 App。
7. （可选）HKWorkoutSession 保活 + 记进健康。
8. TestFlight 带手表 App。
