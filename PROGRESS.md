# PROGRESS.md

## 当前状态

- 2026-10-23：项目初始化。已有 spec（docs/workout-app-spec.md v1.2）、training-plan.json、CLAUDE.md。
- 2026-10-23：Phase 1 第一项完成——空白 PWA 骨架（index.html / manifest.webmanifest / sw.js / app.js / style.css / icons）。本地用 `python -m http.server 8080` 打开（配置在 .claude/launch.json），Service Worker 已能离线打开页面。
- 2026-10-23：Phase 1 第二项完成——首页读 training-plan.json，按 overrides → weeklySchedule 显示今天的安排（schedule.js 纯函数 + app.js 渲染）。验收用 `?date=YYYY-MM-DD` 切换"今天"。
- 2026-10-23：Phase 1 第三项完成——训练模式（workout.js 纯状态逻辑 + train-view.js 渲染 + app.js 的 #train 路由）。训练记录目前只在内存里，刷新即丢，草稿保存是后面的步骤。

## 下一步

- **【中断于 2026-10-23，未验收】草稿自动保存（IndexedDB）代码已写完但还没在浏览器里跑过**：db.js（新，IndexedDB 封装：sessions / settings 两张表，findDraft 按 test 标记区分测试模式草稿）、workout.js 加 finishSession（status 映射成 done/partial/skipped）、train-view.js 加"结束训练"按钮、app.js（启动时 findDraft 恢复草稿；每次 update 后 persistSession：有记录 put / 没记录 delete；有不是今天的草稿时首页显示"有未完成的训练"卡片并隐藏"开始训练"，训练页显示草稿本身；finishTraining 确认后填 finishedAt 保存；requestPersistentStorage）、sw.js v7 加 db.js。新会话第一件事：起服务器，用 `?date=2026-10-28&r=N#train` 做两组 → 换 r 重载 → 记录还在；撤到 0 组 → 草稿被删；换 `?date=2026-10-29` → 首页出现未完成卡片 → 继续 → 结束训练 → 保存且首页恢复正常；真实日期 `/?r=N` 看不到测试草稿；无控制台错误。通过后再做审查、改 PROGRESS 日志、提交。

- Phase 1 第四项：组间秒表（完成一组后从 0 正计时，到 restSeconds 变色，只有"重置"按钮；基于 lastSetCompletedAt 时间戳，visibilitychange 时重算）。验收：完成一组后锁屏 2 分钟再解锁显示约 02:00；切 App 再回来数值正确；刷新后继续（这一条要等草稿保存）。实现提示：重置按钮要用单独的 restStartedAt，不要改 lastSetCompletedAt，否则下一组的 restTakenSeconds 会错。
- Phase 1 第五项：本机保存本次训练（IndexedDB 草稿自动保存，关掉再打开能续）。实现提示：恢复草稿要按草稿自己的 date/templateId 找模板并显示"继续训练"，不要按今天的日期匹配，否则跨午夜的草稿永远找不到；保存时把 pending/active/done 映射成 spec 2.3 的 done/partial/skipped。
- 训练模式补齐（§3.2 次要按钮，Phase 1 验收不要求，顺序由用户定）：换替代动作、跳过这个动作、结束动作（已达 min 组时可用）、结束训练汇总。
- 首页 §3.1 还没做的部分（Phase 1 验收不要求，顺序由用户定）：本周 7 天小条、规则提示折叠、"今天打球 / 不打"按钮和本周球次数（Phase 3）。

## 日志（每步追加一行：日期 · 做了什么 · 验收结果 · 下一步）

- 2026-10-23 · git init，首次提交 spec / JSON / CLAUDE.md / PROGRESS.md · — · 骨架
- 2026-10-23 · 空白 PWA 骨架：index.html、manifest（standalone、中文名、192/512 图标）、sw.js（缓存 8 个壳文件，stale-while-revalidate）、app.js（注册 SW 并显示状态）、style.css（深色跟随系统、safe-area）、icons 180/192/512 · 验收通过：内置浏览器 375×812 打开，SW activated 并接管页面，缓存含全部 8 个文件，manifest 返回 application/manifest+json，深/浅色均正确；停掉服务器后刷新，页面从 cache-storage 加载（传输 0 字节），无控制台错误 · 首页读 training-plan.json 显示今天的安排
- 2026-10-23 · 首页今天的安排：schedule.js（resolveDay：overrides 按日期优先，否则 weeklySchedule 按 getDay；模板 enabled=false 时用 fallback；缺模板/缺 plan 显示"安排有误"+原因；formatLoad/formatSetsReps/formatCardio）、app.js（日期+星期、调课/测试日期标签、标题、备注、固定训练日动作清单"动作 · 组数×次数 · 重量"、可选打球日的"今天打球 / 不打做二区"两行、有氧日、休息日；?date= 测试钩子；PWA 从后台恢复跨天时按 visibilitychange/pageshow 重绘）、sw.js v3（缓存 key 去掉 query；training-plan.json 网络优先离线回退；壳文件 stale-while-revalidate + waitUntil；安装和后台更新都绕过 HTTP 缓存）、style.css（浅色模式可读的备注色、标签描边） · 验收通过：10/24 拉日、10/27 可选打球、11/2 拉日；另验 10/23 可选打球(无调课)、10/25 二区 40-45、10/29 拉日+备注、10/31 休息+备注、11/4 腿日(每边/首次做时填/每侧)、11/5 周四上肢B未启用→二区 40 分钟、11/8 周日休息可打球、?date=2026-02-30 忽略；375px 无横向溢出、动作行 ≥69px、深/浅色对比度检查；打桩 Date 到 10/24 后触发 visibilitychange 首页重绘为拉日；缓存无 ?date 重复条目；服务器日志确认每次打开对 training-plan.json 发条件请求(304)；停服务器后刷新全部从 cache-storage 加载、无报错。4 视角审查 + 逐条反证：11 条确认全部已修 · 训练模式

- 2026-10-23 · 用户决定：zone2-45 模板名改为"二区 45 分钟"（durationMin 45 不变） · 首页 10/25 标题随之变为"二区 45 分钟" · 训练模式

- 2026-10-23 · 用户决定：首页动作清单不显示 exercise.notes，只留 动作 · 重量 · 组数×次数；sw.js CACHE 升 v4 · 10/24 拉日页无备注行 · 训练模式

- 2026-10-23 · 训练模式：workout.js（createSession / selectExercise / completeSet / undoLastSet / addExtraSet / canCancelExtraSet / orderedEntries / summarize，纯函数、不可变更新；每侧动作左→右各一次算一组；目标组数 = sets.max + 再加的组；每组记 setNo / side / weight(计划值) / reps(null，Phase 2 填) / completedAt / restTakenSeconds；session.lastSetCompletedAt 给秒表用）、train-view.js（每行：名称、已完成/目标、重量 · 次数区间 · 每侧；进行中高亮只有一个，展开 完成一组 / 完成左侧 / 完成右侧 大按钮 + 撤销；完成的变灰打勾下沉、点击无反应，只有 撤销最后一组 / 再加一组 两个入口；再加一组 = 目标 +1 回到进行中，那组还没做时撤销 = 取消再加一组；每侧动作撤销按钮写明 撤销左侧/右侧，半组时显示"2/3 · 左侧已做"）、app.js（首页固定训练日有"开始训练"按钮，已有记录时显示"继续训练"；#train 路由；返回前 confirm；训练中已有记录时跨天不换"今天"，回首页再换；SW 注册加 updateViaCache:'none'）、style.css（主按钮 56px、次按钮 44px、完成行灰色文字而非半透明、浅色 #007aff / 深色 #0a84ff）· 验收通过：推日 5 个动作全部做完列表全灰下沉、头部 5/5 · 15 组、点完成行无反应；撤销后坐姿肩推回到进行中 2/3 并上浮，再做完恢复；再加一组 3/4 → 4/4；取消再加一组 3/4 → 3/3；4/4 撤销两次回 3/3；每侧动作 完成左侧→完成右侧→1/3，撤销右侧→"2/3 · 左侧已做"→撤销左侧→2/3；返回取消留在训练页、确认后首页"继续训练"并恢复状态；非力量日 #train 显示提示；真实日期路径打桩 Date 跨午夜：解锁后仍是推日、再点一组仍记在推日、回首页才切到 10/29 拉日；375px 无横向溢出；深/浅色均检查；无控制台错误。四视角审查 + 逐条反证确认 11 条（3 组重复）全部已修。有意超出 §3.2 两处：进行中的动作也有"撤销最后一组"（§4 误触保护，否则误点"完成一组"要等做完才能改）；训练页标题栏显示 完成 x/y 个动作 · n 组。做秒表时页头布局要连这行一起定 · 组间秒表

## 已知问题

- 训练记录只在内存里：刷新页面或 App 被杀掉就没了，要等"本机保存草稿"那一步。跨午夜后回首页，昨天的训练不会显示"继续训练"（session 留在内存里但到不了），草稿保存那一步按草稿自己的日期处理。
- 训练页一个动作做完下沉时列表会整体上移，iOS Safari 没有滚动锚定，手指位置下面的内容会变。先观察真机感受再决定要不要做滚动补偿。
- ?date= 测试模式下建的训练用的是真实时钟的时间戳，和真实训练分不开；草稿保存那一步要么不保存测试模式的训练，要么打标记。

- SW 更新：壳文件（app.js / schedule.js / style.css / index.html 等）是 stale-while-revalidate，改了代码要第二次打开才生效，而且"有新版本"提示只在 sw.js 本身变化时出现（比如改 CACHE 名）。所以每次部署都改一下 sw.js 的 CACHE 名最稳妥。training-plan.json 是网络优先，改 overrides 当次打开就生效。注册时已用 updateViaCache:'none'，检查 sw.js 更新不走 HTTP 缓存。
- 本机验收统一用 http://localhost:8080，不要混用 127.0.0.1：两个源各有一套 SW 和缓存，混用会看到旧代码。另外导航到完全相同的 URL（含 #train）不会重新加载页面，要换个查询参数（如 &r=2）才能强制重载。
- .claude/launch.json 用的是 `python`；Mac 上如果只有 `python3`，需要改 runtimeExecutable。
- 尚未在真机 iPhone 验证"添加到主屏幕"和图标显示，要等部署到 GitHub Pages 后做。

## 以后再说

- 秒表到参考时长的提示音（默认关）
- 有氧记录是否手动填 Apple Watch 平均心率和 Zone3+ 时间
- SW 有新版本时的"立即刷新"按钮
