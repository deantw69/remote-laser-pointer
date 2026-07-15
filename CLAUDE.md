# 遠端雷射筆(remote-laser-pointer)

朋友用 Discord 分享畫面時,觀看者在自己電腦上圈點,標記即時浮現在分享者的實際螢幕上。

## 結構
- `server/`:Node.js ESM + Socket.IO 座標中繼(房間碼配對,只轉發 `pointer`/`meta` 事件,不解析內容)
- `app/`:Electron + TypeScript + electron-vite,單一 app 雙角色(觀看者/分享者)
- 協定:`app/src/shared/protocol.ts`,座標一律 0~1 正規化;`Mark` 型別(勿與 DOM 的 PointerEvent 混淆)

## 指令
- server:`npm start`(port 3000)、`npm run smoke`(需先啟動 server)
- app:`npm run dev` | `npm run build` | `npm run typecheck` | `npm run build:win`(產出 release/)
- 本機雙開測試:`npm run build` 後 `npx electron . --profile=a` 與 `npx electron . --profile=b`(profile 會分開 userData)

## 關鍵決策
- 架構 A(疊在 Discord 上、只傳座標)先行;之後可加 WebRTC B 模式,房間伺服器兼任 signaling
- overlay 視窗:`transparent + frame:false + alwaysOnTop('screen-saver') + setIgnoreMouseEvents(true)`;座標全用 DIP
- F8 全域切換指點模式(Electron globalShortcut 無 keyup 事件,故用切換制,不做「按住即用」)
- 設定存 `userData/settings.json`(自寫 store:`app/src/main/store.ts`,不用 electron-store)
- 校準採「全螢幕拉框」方式(rubber band),依分享端螢幕比例鎖定,Ctrl 可解除
- 系統匣圖示由 `app/scripts/gen-tray-icon.mjs` 產生(純程式產 PNG,不放來源不明二進位)

## 環境備註
- 這台機器 `npm install` 時 Electron 二進位解壓曾失敗(zip 有下載到 cache 但 dist 是空的):
  修法 = 手動 `Expand-Archive` cache 內的 zip 到 `node_modules/electron/dist`,再寫 `path.txt`(內容 `electron.exe`)

## 注意
- 只支援 Windows;獨占全螢幕遊戲蓋不住 overlay
- MVP 假設分享者分享「整個螢幕」;單一視窗對位列為後續
- exe 未簽章,SmartScreen 會警告
