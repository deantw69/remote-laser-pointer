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
- 設定存 `userData/settings.json`(自寫 store:`app/src/main/store.ts`,不用 electron-store)
- 校準採「全螢幕拉框」方式(rubber band),依分享端螢幕比例鎖定,Ctrl 可解除
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
- MVP 假設分享者分享「整個螢幕」;單一視窗對位列為後續
- exe 未簽章,SmartScreen 會警告
