#!/bin/bash
# 双击这个文件 = 把 GitHub 上的最新代码拉到这台 Mac。拉完回 Xcode 按 ⌘R 就是新版。
# 规则：GitHub 上的为准，本机的东西挪进 文稿/workout-app-本机旧文件/时间/ 里（不删）：
#   1. Xcode 工程（ios/WorkoutShell.xcodeproj）本机被 Xcode 改过 → 改动存成补丁，工程换回仓库里的那份
#      （Team ID、Bundle ID 等需要的设置都已经写进仓库；本机改动和新版合并会冲突，Xcode 就打不开工程）
#   2. 本机多出来、GitHub 上也有同名的文件（比如 Xcode 自己生成的 scheme）→ 本机那份挪走
#   3. 上次合并没合完、留着冲突的文件 → 换回仓库里的那份
# 其余本机改动用 --autostash 收起来、拉完放回去；放回时冲突的，同样换回仓库里的那份（改动留在 git stash 里）。
cd "$(dirname "$0")" || exit 1
PROJ="ios/WorkoutShell.xcodeproj"
BACKUP="$HOME/Documents/workout-app-本机旧文件/$(date +%Y%m%d-%H%M%S)"
note_backup() { mkdir -p "$BACKUP"; }

echo "正在从 GitHub 拉取最新代码…"
echo
if ! git fetch origin; then
  echo
  echo "❌ 连不上 GitHub。检查网络后再双击一次；还不行把这个窗口截图发给 Claude。"
  exit 1
fi

# 3. 上次留下的冲突
conflicted=$(git diff --name-only --diff-filter=U)
if [ -n "$conflicted" ]; then
  note_backup
  echo "$conflicted" | while IFS= read -r f; do
    [ -f "$f" ] && mkdir -p "$BACKUP/$(dirname "$f")" && cp "$f" "$BACKUP/$f"
    git checkout HEAD -- "$f"
    echo "上次没合完的 $f 换回仓库里的那份"
  done
fi

# 1. Xcode 工程的本机改动
if ! git diff --quiet HEAD -- "$PROJ"; then
  note_backup
  git diff HEAD -- "$PROJ" > "$BACKUP/Xcode工程本机改动.patch"
  git checkout HEAD -- "$PROJ"
  echo "Xcode 在本机改过工程文件，改动存成补丁，工程换回仓库里的那份"
fi

# 2. 本机多出来、GitHub 上也有的同名文件
while IFS= read -r -d '' f; do
  if git cat-file -e "origin/main:$f" 2>/dev/null; then
    mkdir -p "$BACKUP/$(dirname "$f")"
    mv "$f" "$BACKUP/$f"
    echo "本机的 $f 和 GitHub 上的同名，先挪开"
  fi
done < <(git ls-files --others --exclude-standard -z)

[ -d "$BACKUP" ] && echo "（本机原来的放在 $BACKUP）" && echo

ok=1
git pull --ff-only --autostash || ok=0

# 放回本机改动时冲突的文件：换回仓库里的那份（改动还在 git stash 里）
conflicted=$(git diff --name-only --diff-filter=U)
if [ -n "$conflicted" ]; then
  echo "$conflicted" | while IFS= read -r f; do
    git checkout HEAD -- "$f"
    echo "本机改动和新版冲突的 $f 换回仓库里的那份（本机改动留在 git stash 里）"
  done
fi
if grep -qE '^(<<<<<<<|>>>>>>>)' "$PROJ/project.pbxproj"; then
  git checkout HEAD -- "$PROJ"
  echo "工程文件里有冲突标记，换回仓库里的那份"
fi

echo
if [ "$ok" = 1 ]; then
  echo "✅ 拉取完成。回 Xcode 打开 WorkoutShell，按 ⌘R 运行。"
else
  echo "❌ 拉取失败。把这个窗口截图发给 Claude。"
fi
echo
echo "—— 本机签名设置（Claude 要的话把下面几行发给它）——"
grep -E "DEVELOPMENT_TEAM|PRODUCT_BUNDLE_IDENTIFIER" "$PROJ/project.pbxproj" | sort -u
echo
echo "可以关掉这个窗口了。"
