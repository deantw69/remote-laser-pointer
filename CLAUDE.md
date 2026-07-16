# 遠端雷射筆(remote-laser-pointer)

朋友用 Discord 分享畫面時,觀看者在自己電腦上圈點,標記即時浮現在分享者的實際螢幕上。

## 結構
- `server/`:Node.js ESM + Socket.IO 座標中繼(房間碼配對,只轉發 `pointer`/`meta` 事件,不解析內容)
- `app/`:Electron + TypeScript + electron-vite,單一 app 雙角色(觀看者/分享者)
- 協定:`app/src/shared/protocol.ts`,座標一律 0~1 正規化;`Mark` 型別(勿與 DOM 的 PointerEvent 混淆)

## 指令
- server:`npm start`(port 3000)、`npm run smoke`(需先啟動 server)
- app:`npm run dev` | `npm run build` | `npm run typecheck` | `npm run build:win` | `npm run build:mac`(皆產出 release/)
- 本機雙開測試:`npm run build` 後 `npx electron . --profile=a` 與 `npx electron . --profile=b`(profile 會分開 userData)

## 關鍵決策
- 架構 A(疊在 Discord 上、只傳座標)先行;之後可加 WebRTC B 模式,房間伺服器兼任 signaling
- overlay 視窗:`transparent + frame:false + alwaysOnTop('screen-saver') + setIgnoreMouseEvents(true)`;座標全用 DIP。macOS 另需 `setVisibleOnAllWorkspaces(true, {visibleOnFullScreen:true})` 才能浮在其他 app 全螢幕與所有 Space 之上(統一由 main 的 `pinOverlayOnTop()` 處理,套用於 overlay/pointer/calibrate 三窗)
- 全域切換指點模式(Electron globalShortcut 無 keyup 事件,故用切換制,不做「按住即用」);Windows=F8,macOS=Cmd+Shift+L(F8 在 mac 預設是媒體鍵)。切換鍵定義在 main 的 `TOGGLE_HOTKEY`,顯示標籤在 preload 的 `hotkeyLabel`,兩者須一致
- 設定存 `userData/settings.json`(自寫 store:`app/src/main/store.ts`,不用 electron-store);校準結果 viewer 存 `calRect`、sharer 存 `sharerRect`
- 校準(`openCalibration('viewer'|'sharer')` 統一開窗):全螢幕遮罩,進場帶入「前次範圍」顯示為可編輯框——拖框內移動、8 把手縮放、空白處重拉;改為 **Enter/確定** 才送 `calibrate:done {rect, full}`、Esc/取消放棄(不再放開滑鼠即定案)。viewer 依 `sharerAspect` 鎖比例(Ctrl 解除)、開游標所在螢幕;sharer 自由框(不鎖比例)、開選定螢幕、可按「整個螢幕」清為 null
- 分享者「標記範圍」:overlay 與 `sendMeta` 比例改用 `sharerBounds()`(`sharerRect ?? d.bounds`);`sharerRect=null`=整個螢幕;換螢幕自動重置(區域是相對舊螢幕的絕對座標)。雙方要對到同一塊內容才對齊(單視窗分享靠此對位)
- Windows 工作列遮住 overlay 底部:成因是會 focus 的視窗(校準/指點)取得焦點時工作列被彈到最上層;`pinOverlayOnTop` 對 win32 掛 `focus` 事件,每次取得焦點重新 `setAlwaysOnTop('screen-saver')+moveTop()` 壓回底層(sharer overlay `focusable:false` 不受影響)
- 系統匣圖示由 `app/scripts/gen-tray-icon.mjs` 產生;app 圖示由 `app/scripts/gen-app-icon.mjs`(產 `build/icon.png`)+ `app/scripts/gen-icns.sh`(sips/iconutil 轉 `build/icon.icns`)產生,`npm run icon` 一鍵重生(皆純程式產生,不放來源不明二進位)

## 部署
- Relay 已部署 Render free:`https://remote-laser-pointer-relay.onrender.com`(Blueprint 名稱 remote-laser-pointer)
- Render GitHub App 已授權此 repo,push 到 main 會自動部署(Auto-Deploy: On Commit;2026-07-16 已實測)
- app 預設 serverUrl 即上述網址(`app/src/main/store.ts` 的 DEFAULTS)

## 環境備註
- `npm install` 時 Electron 二進位解壓曾失敗(zip 有下載到 cache 但 dist 不完整/為空):症狀是 `dev` 報 `Error: Electron uninstall`。修法 = 用 cache 內完整的 zip 手動解壓到 `node_modules/electron/dist`,再寫 `path.txt`:
  - Windows:`Expand-Archive` cache zip → dist,`path.txt` 內容 `electron.exe`
  - macOS:`unzip ~/Library/Caches/electron/*/electron-v<版本>-darwin-*.zip -d node_modules/electron/dist`,`path.txt` 內容 `Electron.app/Contents/MacOS/Electron`
  - 驗證:`node -e "console.log(require('electron'))"` 應印出執行檔路徑(README「疑難排解」有同步說明)

## 注意
- 支援 Windows 與 macOS;獨占全螢幕遊戲蓋不住 overlay
- macOS 打包用 `build:mac`(dmg+zip),electron-builder 設 `identity: null` 跳過簽章(未簽章,Gatekeeper 會擋,右鍵→打開);系統匣圖示在 mac 以 template image 呈現;app 圖示為 `build/icon.icns`(產生方式見上「關鍵決策」),electron-builder 由 `mac.icon` 指定
- 預設分享「整個螢幕」;單一視窗可由分享者「校準標記範圍」框在該視窗位置對位(視窗移動需重校,自動追蹤列為後續)
- exe 未簽章,SmartScreen 會警告
