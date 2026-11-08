# iOS 壳（WorkoutShell）

Swift + WKWebView，把仓库根目录的网页原样打进 App。原生只做：本地通知（组间到点、训练日提醒）、App Intents（完成一组 / 重置秒表 / 下一个动作 / 开始训练，可绑轻点背面、动作按钮、Siri）、分享导出 / 文件导入、常亮、震动。方案和协议见 `../docs/ios-app-plan.md`。

## 在 Mac 上第一次跑

1. `git clone`（或 pull）仓库，用 Xcode 打开 `ios/WorkoutShell.xcodeproj`。
2. 左边选 WorkoutShell 工程 → TARGETS → WorkoutShell → **Signing & Capabilities**：Team 选你的开发者账号；Bundle Identifier 改成你自己的（默认 `com.mikeyang.workout`，重复会签不了）。
3. 顶部选真机（iPhone 要开"开发者模式"：设置 → 隐私与安全性 → 开发者模式），⌘R 运行。
4. 第一次装：手机上 设置 → 通用 → VPN 与设备管理 → 信任开发者证书（付费账号用 TestFlight 装的不用这步）。

构建时 `copy-web.sh` 会把根目录的 html / js / css / json / icons 复制进 App 的 `web/`，所以改网页后直接再 ⌘R 就是新版，不用手动拷。

## 以后更新

Finder → 文稿（Documents）→ workout-app → 双击 `update-mac.command`，弹出的窗口显示"拉取完成"后回 Xcode ⌘R。不用 Xcode 的 Integrate → Pull（那个对话框会一直 Loading）。

## 看网页控制台

Debug 构建开了 `isInspectable`：Mac 上 Safari → 开发 → 你的 iPhone → 训练 → 点进去就是网页的控制台。

## 验收（对应 docs/ios-app-plan.md 第 6 节）

- 第 1 步：App 打开就是首页；关掉重开记录还在；深色模式跟随；安全区正确。
- 第 2 步：设置里开常亮，训练页放着不锁屏；完成一组有震动。
- 第 3 步（2026-11-07 做扎实）：设置 → "到参考休息时长时响一声"打开。训练页放着不动，到参考时长手机连震三下 + 铃声（静音键打开也响，音乐会压低一下）；锁屏后到点弹通知带铃声 + 震动（静音键打开只震动）；关掉那项 → 两种情况都只震动不响。撤销后不弹；重置后按新时间弹；到点前记了下一组不弹。
- 第 4 步：设置里开训练日提醒、时间设成两分钟后，到点收到"今天 推日 · …"。
- 第 5 步：快捷指令 App → App 快捷指令 → 训练 → 完成一组；设置 → 辅助功能 → 触控 → 轻点背面 → 轻点两下 → 选它。训练页有进行中动作时敲两下背面记一组并震动。
- 第 7 步：设置 → 导出，分享面板存到"文件"；导入选同一个文件，预览后合并。
- 第 8 步：Product → Archive → Distribute App → TestFlight；App Store Connect 里加两个测试员。
- 第二期第 1 ～ 2 步（自动备份，方案 10.1）：载入计划或练完一次后，文件 App → 我的 iPhone → 训练 里出现 `训练备份.json`，内容是完整备份；首页不再弹"该备份了"；设置 → 清空全部数据 → 第一次打开页多一个"从 App 的自动备份恢复"，点它 → 确认 → 记录和计划回来。

## 文件

- `WorkoutShell/WorkoutShellApp.swift` 入口；`AppDelegate.swift` 通知代理、回前台
- `WebView.swift` WKWebView、JS 对话框、外链；`AppSchemeHandler.swift` `app://local/` 静态文件
- `Bridge.swift` 消息路由、命令队列；`Notifications.swift`；`Intents.swift`；`AppState.swift` 网页同步来的完整训练状态；`NativeHelpers.swift` 震动 / 分享 / 导入；`BackupStore.swift` 自动备份文件；`RestAlert.swift` 前台到点的震动 + 铃声；`rest-alert.wav` / `rest-silent.wav` 通知音
- `copy-web.sh` 构建时复制网页；`Assets.xcassets` 图标

## 不做的

耳机媒体键（iOS 要接管播放才收得到，会停掉正在听的音乐，用户决定不做）。
