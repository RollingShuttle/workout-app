# PROGRESS.md

## 当前状态

- 2026-10-23：项目初始化。已有 spec（docs/workout-app-spec.md v1.2）、training-plan.json、CLAUDE.md。
- 2026-10-23：Phase 1 第一项完成——空白 PWA 骨架（index.html / manifest.webmanifest / sw.js / app.js / style.css / icons）。本地用 `python -m http.server 8080` 打开（配置在 .claude/launch.json），Service Worker 已能离线打开页面。
- 2026-10-23：Phase 1 第二项完成——首页读 training-plan.json，按 overrides → weeklySchedule 显示今天的安排（schedule.js 纯函数 + app.js 渲染）。验收用 `?date=YYYY-MM-DD` 切换"今天"。
- 2026-10-23：Phase 1 第三项完成——训练模式（workout.js 纯状态逻辑 + train-view.js 渲染 + app.js 的 #train 路由）。训练记录目前只在内存里，刷新即丢，草稿保存是后面的步骤。
- 2026-10-24：Phase 1 第五项完成——训练草稿自动保存到 IndexedDB（db.js），每点一下就写库，关掉再打开能续；加了最小的"结束训练"。首页有别天的未完成训练时显示卡片（继续训练 / 结束并保存）。
- 2026-10-24：Phase 1 第四项完成——组间秒表（训练页顶部固定一条：大号正计时、参考休息时长和动作名、到点变绿、只有"重置"）。Phase 1 的功能项至此全部完成，剩真机验收和部署。

## 下一步

- 部署到 GitHub Pages 并在 iPhone 真机验收 Phase 1 全部项（添加到主屏幕、图标、离线打开、首页日期、训练模式、秒表锁屏 2 分钟、草稿关 App 再开）。部署前把 sw.js 的 CACHE 名再升一级。
- 训练模式补齐（§3.2 次要按钮，Phase 1 验收不要求，顺序由用户定）：换替代动作、跳过这个动作、结束动作（已达 min 组时可用）、结束训练的汇总页。
- 首页 §3.1 还没做的部分（Phase 1 验收不要求，顺序由用户定）：本周 7 天小条、规则提示折叠、"今天打球 / 不打"按钮和本周球次数（Phase 3）。
- Phase 2：每组重量 / 次数输入、上次数据预填、历史列表、动作折线、进阶 / 退阶提示。

## 日志（每步追加一行：日期 · 做了什么 · 验收结果 · 下一步）

- 2026-10-23 · git init，首次提交 spec / JSON / CLAUDE.md / PROGRESS.md · — · 骨架
- 2026-10-23 · 空白 PWA 骨架：index.html、manifest（standalone、中文名、192/512 图标）、sw.js（缓存 8 个壳文件，stale-while-revalidate）、app.js（注册 SW 并显示状态）、style.css（深色跟随系统、safe-area）、icons 180/192/512 · 验收通过：内置浏览器 375×812 打开，SW activated 并接管页面，缓存含全部 8 个文件，manifest 返回 application/manifest+json，深/浅色均正确；停掉服务器后刷新，页面从 cache-storage 加载（传输 0 字节），无控制台错误 · 首页读 training-plan.json 显示今天的安排
- 2026-10-23 · 首页今天的安排：schedule.js（resolveDay：overrides 按日期优先，否则 weeklySchedule 按 getDay；模板 enabled=false 时用 fallback；缺模板/缺 plan 显示"安排有误"+原因；formatLoad/formatSetsReps/formatCardio）、app.js（日期+星期、调课/测试日期标签、标题、备注、固定训练日动作清单"动作 · 组数×次数 · 重量"、可选打球日的"今天打球 / 不打做二区"两行、有氧日、休息日；?date= 测试钩子；PWA 从后台恢复跨天时按 visibilitychange/pageshow 重绘）、sw.js v3（缓存 key 去掉 query；training-plan.json 网络优先离线回退；壳文件 stale-while-revalidate + waitUntil；安装和后台更新都绕过 HTTP 缓存）、style.css（浅色模式可读的备注色、标签描边） · 验收通过：10/24 拉日、10/27 可选打球、11/2 拉日；另验 10/23 可选打球(无调课)、10/25 二区 40-45、10/29 拉日+备注、10/31 休息+备注、11/4 腿日(每边/首次做时填/每侧)、11/5 周四上肢B未启用→二区 40 分钟、11/8 周日休息可打球、?date=2026-02-30 忽略；375px 无横向溢出、动作行 ≥69px、深/浅色对比度检查；打桩 Date 到 10/24 后触发 visibilitychange 首页重绘为拉日；缓存无 ?date 重复条目；服务器日志确认每次打开对 training-plan.json 发条件请求(304)；停服务器后刷新全部从 cache-storage 加载、无报错。4 视角审查 + 逐条反证：11 条确认全部已修 · 训练模式

- 2026-10-23 · 用户决定：zone2-45 模板名改为"二区 45 分钟"（durationMin 45 不变） · 首页 10/25 标题随之变为"二区 45 分钟" · 训练模式

- 2026-10-23 · 用户决定：首页动作清单不显示 exercise.notes，只留 动作 · 重量 · 组数×次数；sw.js CACHE 升 v4 · 10/24 拉日页无备注行 · 训练模式

- 2026-10-23 · 训练模式：workout.js（createSession / selectExercise / completeSet / undoLastSet / addExtraSet / canCancelExtraSet / orderedEntries / summarize，纯函数、不可变更新；每侧动作左→右各一次算一组；目标组数 = sets.max + 再加的组；每组记 setNo / side / weight(计划值) / reps(null，Phase 2 填) / completedAt / restTakenSeconds；session.lastSetCompletedAt 给秒表用）、train-view.js（每行：名称、已完成/目标、重量 · 次数区间 · 每侧；进行中高亮只有一个，展开 完成一组 / 完成左侧 / 完成右侧 大按钮 + 撤销；完成的变灰打勾下沉、点击无反应，只有 撤销最后一组 / 再加一组 两个入口；再加一组 = 目标 +1 回到进行中，那组还没做时撤销 = 取消再加一组；每侧动作撤销按钮写明 撤销左侧/右侧，半组时显示"2/3 · 左侧已做"）、app.js（首页固定训练日有"开始训练"按钮，已有记录时显示"继续训练"；#train 路由；返回前 confirm；训练中已有记录时跨天不换"今天"，回首页再换；SW 注册加 updateViaCache:'none'）、style.css（主按钮 56px、次按钮 44px、完成行灰色文字而非半透明、浅色 #007aff / 深色 #0a84ff）· 验收通过：推日 5 个动作全部做完列表全灰下沉、头部 5/5 · 15 组、点完成行无反应；撤销后坐姿肩推回到进行中 2/3 并上浮，再做完恢复；再加一组 3/4 → 4/4；取消再加一组 3/4 → 3/3；4/4 撤销两次回 3/3；每侧动作 完成左侧→完成右侧→1/3，撤销右侧→"2/3 · 左侧已做"→撤销左侧→2/3；返回取消留在训练页、确认后首页"继续训练"并恢复状态；非力量日 #train 显示提示；真实日期路径打桩 Date 跨午夜：解锁后仍是推日、再点一组仍记在推日、回首页才切到 10/29 拉日；375px 无横向溢出；深/浅色均检查；无控制台错误。四视角审查 + 逐条反证确认 11 条（3 组重复）全部已修。有意超出 §3.2 两处：进行中的动作也有"撤销最后一组"（§4 误触保护，否则误点"完成一组"要等做完才能改）；训练页标题栏显示 完成 x/y 个动作 · n 组。做秒表时页头布局要连这行一起定 · 组间秒表

## 已知问题
- 2026-10-24 · 用户决定两件事：(1) 每侧动作（单臂划船、弓步走）做完两侧再按一次"完成一组"，一次算一组、只有一个计时——与 spec 3.2 第 2 步"perSide 动作按左→右各一次算一组"不同，以用户决定为准，spec 那句以后改；去掉了左右半组逻辑（completedSets = 记录条数，不再记 side，按钮一律"完成一组"，撤销一律"撤销最后一组"）。(2) 秒表显示封顶 99:59（train-view.js CLOCK_CAP_SECONDS）。sw.js v10 · 验收通过：拉日选单臂哑铃划船 → 按钮"完成一组"，按三次 3/3 完成，无"左侧已做"提示；打桩快进 100 分钟 → 显示 99:59 且为绿色；撤销按钮"撤销最后一组"；无控制台错误 · 真机验收 / 部署

- 2026-10-24 · 组间秒表：workout.js（session 加 lastSetExerciseId、restStartedAt；completeSet 三个时间戳一起打；undoLastSet 只在撤掉的是锚定的最后一组时才把秒表退回到剩下的最后一组，撤更早的组不动秒表、手动重置不丢；resetRest 只改 restStartedAt，restTakenSeconds 仍按 lastSetCompletedAt 算；restReferenceSeconds 按上一组动作的 restSeconds，默认 90；时钟回拨时 restTakenSeconds 记 null；finishSession 清 restStartedAt；hydrateSession 给旧版草稿补字段）、train-view.js（sticky 页头里的秒表条：40px 等宽数字 mm:ss、"参考 02:30 · 动作名"、重置按钮；空闲态 --:-- 且重置禁用；updateRestClock 每次只改文字和 class，不重画整页；提示页页头也用 train-topline）、app.js（setTimeout 链对齐到秒表的下一个整秒，不用 setInterval 累加；visibilitychange / pageshow 回前台立刻重算并重启链，pagehide 和离开训练页停掉；提示页不起链；重置按钮 → resetRest → 写草稿）、style.css（页头改纵向、top 用 safe-area、--ready 绿色浅/深两套）、sw.js v9 · 验收通过：空闲态 --:--；做一组后 00:00 开始走；Date 打桩快进 120 秒 + visibilitychange → 02:02；快进 160 秒 → 变绿（参考 02:30）；重置 → 00:00，之后再做一组 restTakenSeconds = 203 秒（按真实上一组算，不受重置影响）；撤销最后一组秒表退回上一组；重置后撤销非最后一组秒表不动、撤销锚定组才回退；训练页内 2.5 秒 3 次 tick、回首页 0 次；刷新后从草稿里的 restStartedAt 接着走（00:09 → 00:10）；注入旧版无 restStartedAt 的草稿 → 秒表显示 00:32；非力量日提示页页头同行且恢复前台不起定时链；375px 无横向溢出；无控制台错误。四视角审查 17 条，反证确认 5 条全部已修 · 真机验收 / 部署


- SW 更新：壳文件（app.js / schedule.js / style.css / index.html 等）是 stale-while-revalidate，改了代码要第二次打开才生效，而且"有新版本"提示只在 sw.js 本身变化时出现（比如改 CACHE 名）。所以每次部署都改一下 sw.js 的 CACHE 名最稳妥。training-plan.json 是网络优先，改 overrides 当次打开就生效。注册时已用 updateViaCache:'none'，检查 sw.js 更新不走 HTTP 缓存。
- 本机验收统一用 http://localhost:8080，不要混用 127.0.0.1：两个源各有一套 SW 和缓存，混用会看到旧代码。另外导航到完全相同的 URL（含 #train）不会重新加载页面，要换个查询参数（如 &r=2）才能强制重载。
- .claude/launch.json 用的是 `python`；Mac 上如果只有 `python3`，需要改 runtimeExecutable。
- 尚未在真机 iPhone 验证"添加到主屏幕"、图标、IndexedDB 持久化、navigator.storage.persist()（桌面测试浏览器里 persisted() 返回 false，iOS 主屏幕 App 一般会给）、秒表锁屏后的表现、sticky 页头在刘海机上的位置。要等部署到 GitHub Pages 后做。
- 训练页一个动作做完下沉时列表会整体上移，iOS Safari 没有滚动锚定，手指位置下面的内容会变。先观察真机感受再决定要不要做滚动补偿。
- 同一浏览器里同时开两个标签页（同源、同一测试/真实模式）会互相覆盖草稿：persistSession 整条 put、启动时只读一次 findDraft，后写的赢。iPhone 主屏幕 App 单实例、和 Safari 存储隔离，碰不到；本机验收只开一个标签页。以后要做可以在页面重新可见时重读 findDraft。
- 测试模式记录：?date= 建的训练带 test:true，和真实记录在同一张 sessions 表里。db.js 只导出 listSessions / findDraft（都按 test 过滤），以后历史列表、导出、备份提醒计数一律从 listSessions 读，不要再加全表读取。
- 保存的记录比 spec 2.3 多 extraSets / activeExerciseId / lastSetCompletedAt / test 四个字段；草稿行的 status 是运行态 pending / active / done，结束训练时才映射成 done / partial / skipped。导出 JSON 时原样导出即可。
- 跨天续练的草稿（昨天做了几组、今天接着做完再结束）用时 = finishedAt − startedAt 仍会跨天；只有"最后一组之后超过 1 小时才点结束"的情况会按最后一组算。做历史页的时长时再决定要不要按活动时段累加。
- 秒表条让 sticky 页头有 153px 高（375×812 上约 19%），小屏（SE）上动作列表可视区域更少。真机看过再决定要不要滚动时收起标题行。
- "结束训练"的用时 = finishedAt − startedAt，startedAt 是点"开始训练"的时刻；在训练页停很久才做第一组会把这段也算进去。

## 以后再说

- 秒表到参考时长的提示音（默认关）
- 有氧记录是否手动填 Apple Watch 平均心率和 Zone3+ 时间
- SW 有新版本时的"立即刷新"按钮
