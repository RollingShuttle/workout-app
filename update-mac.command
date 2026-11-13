#!/bin/bash
# 双击这个文件 = 把 GitHub 上的最新代码拉到这台 Mac。拉完回 Xcode 按 ⌘R 就是新版。
# 本机在 Xcode 里选的 Team / Bundle ID 会改 project.pbxproj，--autostash 先收起来、拉完再放回去。
# 本机多出来的文件（比如 Xcode 自己生成的 scheme）如果 GitHub 上也有同名的，git 不肯覆盖、整个拉取会失败：
# 先把本机那份挪到 文稿/workout-app-本机旧文件/时间/ 里（不删），再拉。
cd "$(dirname "$0")" || exit 1
echo "正在从 GitHub 拉取最新代码…"
echo
if ! git fetch origin; then
  echo
  echo "❌ 连不上 GitHub。检查网络后再双击一次；还不行把这个窗口截图发给 Claude。"
  exit 1
fi
BACKUP="$HOME/Documents/workout-app-本机旧文件/$(date +%Y%m%d-%H%M%S)"
moved=0
while IFS= read -r -d '' f; do
  if git cat-file -e "origin/main:$f" 2>/dev/null; then
    mkdir -p "$BACKUP/$(dirname "$f")"
    mv "$f" "$BACKUP/$f"
    echo "本机的 $f 和 GitHub 上的同名，先挪开"
    moved=1
  fi
done < <(git ls-files --others --exclude-standard -z)
if [ "$moved" = 1 ]; then
  echo "（本机原来的放在 $BACKUP）"
  echo
fi
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
