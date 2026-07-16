#!/usr/bin/env bash
# 由 build/icon.png 產生 macOS build/icon.icns(需先跑 gen-app-icon.mjs)。
# 使用 macOS 內建 sips / iconutil,不引入外部依賴。
set -euo pipefail
cd "$(dirname "$0")/../build"

rm -rf icon.iconset
mkdir icon.iconset
gen() { sips -z "$1" "$1" icon.png --out "icon.iconset/$2" >/dev/null; }
gen 16   icon_16x16.png
gen 32   icon_16x16@2x.png
gen 32   icon_32x32.png
gen 64   icon_32x32@2x.png
gen 128  icon_128x128.png
gen 256  icon_128x128@2x.png
gen 256  icon_256x256.png
gen 512  icon_256x256@2x.png
gen 512  icon_512x512.png
gen 1024 icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns
rm -rf icon.iconset
echo "wrote $(pwd)/icon.icns"
