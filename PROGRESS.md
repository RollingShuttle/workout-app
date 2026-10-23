# PROGRESS.md

## 当前状态

- 2026-10-23：项目初始化。已有 spec（docs/workout-app-spec.md v1.2）、training-plan.json、CLAUDE.md。
- 2026-10-23：Phase 1 第一项完成——空白 PWA 骨架（index.html / manifest.webmanifest / sw.js / app.js / style.css / icons）。本地用 `python -m http.server 8080` 打开（配置在 .claude/launch.json），Service Worker 已能离线打开页面。
- 2026-10-23：Phase 1 第二项完成——首页读 training-plan.json，按 overrides → weeklySchedule 显示今天的安排（schedule.js 纯函数 + app.js 渲染）。验收用 `?date=YYYY-MM-DD` 切换"今天"。

## 下一步

- Phase 1 第三项：训练模式（选动作、完成一组、计数、完成后变灰、撤销）。验收：把推日 5 个动作全部做完，列表全灰，撤销一组后恢复。首页的"开始训练"按钮随这一步一起做。
- 然后：组间秒表；本机保存本次训练（草稿自动保存）。
- 首页 §3.1 还没做的部分（Phase 1 验收不要求，顺序由用户定）：本周 7 天小条、规则提示折叠、"今天打球 / 不打"按钮和本周球次数（Phase 3）。

## 日志（每步追加一行：日期 · 做了什么 · 验收结果 · 下一步）

- 2026-10-23 · git init，首次提交 spec / JSON / CLAUDE.md / PROGRESS.md · — · 骨架
- 2026-10-23 · 空白 PWA 骨架：index.html、manifest（standalone、中文名、192/512 图标）、sw.js（缓存 8 个壳文件，stale-while-revalidate）、app.js（注册 SW 并显示状态）、style.css（深色跟随系统、safe-area）、icons 180/192/512 · 验收通过：内置浏览器 375×812 打开，SW activated 并接管页面，缓存含全部 8 个文件，manifest 返回 application/manifest+json，深/浅色均正确；停掉服务器后刷新，页面从 cache-storage 加载（传输 0 字节），无控制台错误 · 首页读 training-plan.json 显示今天的安排
- 2026-10-23 · 首页今天的安排：schedule.js（resolveDay：overrides 按日期优先，否则 weeklySchedule 按 getDay；模板 enabled=false 时用 fallback；缺模板/缺 plan 显示"安排有误"+原因；formatLoad/formatSetsReps/formatCardio）、app.js（日期+星期、调课/测试日期标签、标题、备注、固定训练日动作清单"动作 · 组数×次数 · 重量"、可选打球日的"今天打球 / 不打做二区"两行、有氧日、休息日；?date= 测试钩子；PWA 从后台恢复跨天时按 visibilitychange/pageshow 重绘）、sw.js v3（缓存 key 去掉 query；training-plan.json 网络优先离线回退；壳文件 stale-while-revalidate + waitUntil；安装和后台更新都绕过 HTTP 缓存）、style.css（浅色模式可读的备注色、标签描边） · 验收通过：10/24 拉日、10/27 可选打球、11/2 拉日；另验 10/23 可选打球(无调课)、10/25 二区 40-45、10/29 拉日+备注、10/31 休息+备注、11/4 腿日(每边/首次做时填/每侧)、11/5 周四上肢B未启用→二区 40 分钟、11/8 周日休息可打球、?date=2026-02-30 忽略；375px 无横向溢出、动作行 ≥69px、深/浅色对比度检查；打桩 Date 到 10/24 后触发 visibilitychange 首页重绘为拉日；缓存无 ?date 重复条目；服务器日志确认每次打开对 training-plan.json 发条件请求(304)；停服务器后刷新全部从 cache-storage 加载、无报错。4 视角审查 + 逐条反证：11 条确认全部已修 · 训练模式

## 已知问题

- SW 更新：壳文件（app.js / schedule.js / style.css / index.html）是 stale-while-revalidate，改了代码要第二次打开才生效，而且"有新版本"提示只在 sw.js 本身变化时出现（比如改 CACHE 名）。所以每次部署都改一下 sw.js 的 CACHE 名最稳妥。training-plan.json 是网络优先，改 overrides 当次打开就生效。
- 本机验收统一用 http://localhost:8080，不要混用 127.0.0.1：两个源各有一套 SW 和缓存，混用会看到旧代码。
- .claude/launch.json 用的是 `python`；Mac 上如果只有 `python3`，需要改 runtimeExecutable。
- 尚未在真机 iPhone 验证"添加到主屏幕"和图标显示，要等部署到 GitHub Pages 后做。
- 数据：cardioTemplates 里 zone2-45 的名字是"二区 40-45 分钟"但 durationMin 是 45，首页正文显示"45 分钟"。想显示 40–45 的话把 durationMin 改成 {"min": 40, "max": 45}（formatCardio 支持区间）。没改，等用户定。
- 首页动作预览多显示了 exercise.notes（规格 3.1 只要求 动作 · 重量 · 组数×次数）。觉得挤可以去掉。

## 以后再说

- 秒表到参考时长的提示音（默认关）
- 有氧记录是否手动填 Apple Watch 平均心率和 Zone3+ 时间
- SW 有新版本时的"立即刷新"按钮
