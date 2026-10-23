# PROGRESS.md

## 当前状态

- 2026-10-23：项目初始化。已有 spec（docs/workout-app-spec.md v1.2）、training-plan.json、CLAUDE.md。
- 2026-10-23：Phase 1 第一项完成——空白 PWA 骨架（index.html / manifest.webmanifest / sw.js / app.js / style.css / icons）。本地用 `python -m http.server 8080` 打开（配置在 .claude/launch.json），Service Worker 已能离线打开页面。

## 下一步

- Phase 1 第二项：读取 training-plan.json，首页按星期和 overrides 显示今天的安排。验收：把日期改到 10/24、10/27、11/2，分别显示拉日 / 可选打球 / 拉日。
- 然后：训练模式（选动作、完成一组、计数、完成后变灰、撤销）。

## 日志（每步追加一行：日期 · 做了什么 · 验收结果 · 下一步）

- 2026-10-23 · git init，首次提交 spec / JSON / CLAUDE.md / PROGRESS.md · — · 骨架
- 2026-10-23 · 空白 PWA 骨架：index.html、manifest（standalone、中文名、192/512 图标）、sw.js（缓存 8 个壳文件，stale-while-revalidate）、app.js（注册 SW 并显示状态）、style.css（深色跟随系统、safe-area）、icons 180/192/512 · 验收通过：内置浏览器 375×812 打开，SW activated 并接管页面，缓存含全部 8 个文件，manifest 返回 application/manifest+json，深/浅色均正确；停掉服务器后刷新，页面从 cache-storage 加载（传输 0 字节），无控制台错误 · 首页读 training-plan.json 显示今天的安排

## 已知问题

- SW 用 stale-while-revalidate：部署新版本后，第一次打开仍是旧代码，第二次打开才生效（app.js 会提示"有新版本"）。以后可加"立即刷新"按钮。
- .claude/launch.json 用的是 `python`；Mac 上如果只有 `python3`，需要改 runtimeExecutable。
- 尚未在真机 iPhone 验证"添加到主屏幕"和图标显示，要等部署到 GitHub Pages 后做。

## 以后再说

- 秒表到参考时长的提示音（默认关）
- 有氧记录是否手动填 Apple Watch 平均心率和 Zone3+ 时间
