#!/bin/bash
# 双击这个文件 = 把 GitHub 上的最新代码拉到这台 Mac。拉完回 Xcode 按 ⌘R 就是新版。
# 本机在 Xcode 里选的 Team / Bundle ID 会改 project.pbxproj，--autostash 先收起来、拉完再放回去。
cd "$(dirname "$0")" || exit 1
echo "正在从 GitHub 拉取最新代码…"
echo
if git pull --ff-only --autostash; then
  echo
  echo "✅ 拉取完成。回 Xcode 按 ⌘R 运行。"
else
  echo
  echo "❌ 拉取失败。把这个窗口截图发给 Claude。"
fi
echo
echo "—— 本机签名设置（Claude 要的话把下面几行发给它）——"
grep -E "DEVELOPMENT_TEAM|PRODUCT_BUNDLE_IDENTIFIER" ios/WorkoutShell.xcodeproj/project.pbxproj | sort -u
echo
echo "可以关掉这个窗口了。"
