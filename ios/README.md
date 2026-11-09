# iOS 壳（WorkoutShell）

Swift + WKWebView，把仓库根目录的网页原样打进 App。原生只做：本地通知（组间到点、训练日提醒）、App Intents（完成一组 / 重置秒表 / 下一个动作 / 开始训练，可绑轻点背面、动作按钮、Siri）、分享导出 / 文件导入、常亮、震动。方案和协议见 `../docs/ios-app-plan.md`。

## 在 Mac 上第一次跑

1. `git clone`（或 pull）仓库，用 Xcode 打开 `ios/WorkoutShell.xcodeproj`。
2. 左边选 WorkoutShell 工程 → TARGETS → WorkoutShell → **Signing & Capabilities**：Team 已写在工程里（4RLD77Y492），Bundle Identifier 是 `com.mikeyang.workout`；换了账号才需要改。
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
- 第 8 步：按下面"TestFlight 发布"做一遍；两台手机都从 TestFlight 装上，各自首次启动页，数据互不可见。
- 第二期第 1 ～ 2 步（自动备份，方案 10.1）：载入计划或练完一次后，文件 App → 我的 iPhone → 训练 里出现 `训练备份.json`，内容是完整备份；首页不再弹"该备份了"；设置 → 清空全部数据 → 第一次打开页多一个"从 App 的自动备份恢复"，点它 → 确认 → 记录和计划回来。

## TestFlight 发布（付费账号；内部测试不用过审，构建 90 天有效）

只做一次的准备：
1. 网页 https://appstoreconnect.apple.com 用付费的 Apple ID 登录 → **我的 App** → 左上角 **+** → **新建 App**：平台 iOS；名称随便起一个（要全球唯一，被占了就加个后缀，比如"训练清单 JY"）；主要语言 简体中文；套装 ID 选 `com.mikeyang.workout`（没有的话先在 Xcode 用付费 Team 跑一次真机，Xcode 会自动注册）；SKU 填 `workout`；用户访问权限 完全访问 → 创建。
2. 加太太当测试员：App Store Connect 首页 → **用户和访问** → **+** → 填她的名字和 Apple ID 邮箱，职能勾 **开发者**，App 勾这一个 → 邀请。她邮箱里点接受。
3. 她的手机装 **TestFlight** App（App Store 搜）。

每次发新版本：
1. 双击 `update-mac.command` 拉最新代码。
2. Xcode 顶部设备选 **Any iOS Device (arm64)**（设备列表最上面）。
3. 菜单 **Product → Archive**，等打包完弹出 Organizer 窗口。
4. 选中最新那条 → 右边 **Distribute App** → 选 **TestFlight Internal Only** → Distribute。**Build 号必须比上一次上传的高**，同一个号传第二次会被 App Store Connect 拒掉：Distribute 中间"Manage Version and Build Number"那个勾留着，它会自动把 Build 号 +1；不想靠这个勾，就在工程里把 CURRENT_PROJECT_VERSION 改成更大的数再 Archive。等它上传完显示 Uploaded。
5. 回 App Store Connect → 我的 App → 这个 App → 顶部 **TestFlight** 标签。几分钟后构建出现，状态从"正在处理"变成可用。出口合规那一问（"缺少合规证明"）已经在工程里答掉了（pbxproj 的 `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO`，App 不自己做加密），不会再出现，不用点。
6. 第一次：左边 **内部测试** → **+** 建一个组（比如"家人"）→ 勾上自己和太太 → 打开"自动分发"。以后每个新构建会自动推给这个组。
7. 手机上 TestFlight App 里出现"训练"→ 安装。TestFlight 装的会直接覆盖原来 Xcode 装的（同一个 Team、同一个套装 ID），记录不丢。以后有新版本 TestFlight 会提醒更新。

注意：第一次用 TestFlight 覆盖前，稳妥起见先在 App 里 设置 → 导出 存一份；万一 TestFlight 报"无法安装"，是因为旧的是别的 Team 签的，删掉旧 App（会连数据一起删）再装，然后用 设置 → 导入 恢复。

装上 TestFlight 的版本之后，Xcode 用数据线装的那份的有效期（免费账号 7 天、付费账号 1 年，到期就打不开）就不相干了：TestFlight 装的只看构建自己的 90 天，而且下面的 Xcode Cloud 每周出一个新构建，等于永远不到期。第二台手机也不用开"开发者模式"——那只是 Xcode 直接装才要的，TestFlight 装不要。

### Xcode Cloud（可选，自动构建）

上面"每次发新版本"每次都得坐到 Mac 前面点一遍。开了 Xcode Cloud，每次 `git push origin main` 都在 Apple 的云上打包、签名、上传，半小时左右两台手机的 TestFlight 里就有新版本，Mac 不用开机。开发者会员已经包含每月 25 小时的云构建时间，这个工程一次几分钟，用不完。

只做一次（第一个工作流只能在 Xcode 里建，建好以后 App Store Connect 网页上也能改）：
1. 先把上面"只做一次的准备"做完——App Store Connect 里得有这个 App；工程已经是 Automatic 签名，Xcode Cloud 要求这个。Scheme 也已经是共享的（`ios/WorkoutShell.xcodeproj/xcshareddata/xcschemes/` 在仓库里），Xcode Cloud 只认共享的 scheme；万一 Xcode 里显示它没共享，Product → Scheme → Manage Schemes… 勾上 Shared，再把那个文件夹提交进仓库。
2. Xcode 打开工程 → 菜单 **Product → Xcode Cloud → Create Workflow…** → Next，照着走：
   - 源代码管理：选 GitHub，按提示授权 Xcode Cloud 访问 `RollingShuttle/workout-app`（会跳到 GitHub 装一个 Xcode Cloud App，只勾这一个仓库就行）。
   - **Start Conditions**（开始条件）：留着默认的 **Branch Changes**（main 分支有改动），再加一条 **On a Schedule for a Branch**：分支 main，每周一次（星期几、几点随便）。
   - **Archive - iOS**：Deployment Preparation 选 **TestFlight (Internal Testing Only)**。
   - **Post-Actions**（后置操作）：加 **TestFlight Internal Testing**，勾上面建的内部测试组（"家人"）。
   - Build 号不用管：Xcode Cloud 自己给每次构建一个递增的号，不会和上一次撞。
3. 保存，它会马上跑第一次；进度在 Xcode 的 Report navigator → Cloud 标签，或 App Store Connect → 这个 App → **Xcode Cloud** 标签里看。

之后：
- 改完代码 `git push origin main`（在 Windows 上 push 也一样），云上编完上传，TestFlight 处理完自动推给组里两台手机，手机上 TestFlight 提示更新，全程不碰 Mac。
- 每周那次定时构建就算代码没变也会出一个新构建，TestFlight 的 90 天有效期于是永远走不完，手机上的 App 不会过期。
- 这个工程没有任何第三方依赖（网页文件是 `copy-web.sh` 在构建阶段复制进 bundle 的），所以不需要 `ci_scripts/`，云上用默认环境直接能编。

## 文件

- `WorkoutShell/WorkoutShellApp.swift` 入口；`AppDelegate.swift` 通知代理、回前台
- `WebView.swift` WKWebView、JS 对话框、外链；`AppSchemeHandler.swift` `app://local/` 静态文件
- `Bridge.swift` 消息路由、命令队列；`Notifications.swift`；`Intents.swift`；`AppState.swift` 网页同步来的完整训练状态；`NativeHelpers.swift` 震动 / 分享 / 导入；`BackupStore.swift` 自动备份文件；`RestAlert.swift` 前台到点的震动 + 铃声；`rest-alert.wav` / `rest-silent.wav` 通知音
- `copy-web.sh` 构建时复制网页；`Assets.xcassets` 图标；`PrivacyInfo.xcprivacy` 隐私清单（备份读文件修改时间、UserDefaults 都在 Apple 的"需要说明理由"名单上，没有它每次上传 TestFlight 都会收到 ITMS-91053 邮件）

## 不做的

耳机媒体键（iOS 要接管播放才收得到，会停掉正在听的音乐，用户决定不做）。
