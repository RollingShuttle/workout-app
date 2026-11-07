#!/bin/sh
# Xcode 的 "Copy web files" Build Phase：把仓库根目录的网页文件复制进 App bundle 的 web/ 目录。
# 网页只有一份（仓库根目录），这里不维护第二份。sw.js 不复制（App 壳里不注册 Service Worker）。
set -e
SRC="$SRCROOT/.."
DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/web"

rm -rf "$DEST"
mkdir -p "$DEST/icons"

for f in index.html style.css manifest.webmanifest training-plan.json; do
  cp "$SRC/$f" "$DEST/"
done

for f in "$SRC"/*.js; do
  case "$(basename "$f")" in
    sw.js) ;;
    *) cp "$f" "$DEST/" ;;
  esac
done

cp "$SRC"/icons/*.png "$DEST/icons/"

echo "web files copied to $DEST"
ls "$DEST"
