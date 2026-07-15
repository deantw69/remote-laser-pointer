# 遠端雷射筆(Remote Laser Pointer)

朋友用 Discord 分享畫面時,你在自己電腦上對著影像**點擊 / 拖曳 / 移動滑鼠**,
紅色圈圈、手繪線條、雷射光點就會**即時浮現在朋友的實際螢幕上**,不用再口頭形容「點哪裡」。

```
你(觀看者)                          朋友(分享者)
┌──────────────────┐                ┌──────────────────┐
│ Electron app      │   Socket.IO   │ Electron app      │
│ ・校準框對準       │──座標(0~1)──▶│ ・全螢幕透明       │
│   Discord 影片區  │    中繼伺服器   │   點擊穿透 overlay │
│ ・F8 進入指點模式  │                │ ・畫圈/雷射/線     │
└──────────────────┘                └──────────────────┘
```

- 影像與語音仍走 Discord,本工具**只傳座標**,頻寬極小、延遲低。
- 雙方安裝**同一個 exe**,開啟後選角色、輸入 6 碼房號即連,免帳號。
- 目前僅支援 **Windows**。

## 專案結構

| 路徑 | 說明 |
|---|---|
| `server/` | Node.js(ESM)+ Socket.IO 座標中繼伺服器(房間碼配對) |
| `app/` | Electron + TypeScript + electron-vite 桌面 app(單一 app 雙角色) |
| `app/src/shared/protocol.ts` | 雙端共用協定(座標一律 0~1 正規化) |
| `render.yaml` | Render 一鍵部署設定 |

## 使用教學

### 事前準備(一次性)
1. 部署中繼伺服器(見下方「部署」),取得網址,例如 `https://xxx.onrender.com`。
2. 雙方各安裝 `RemoteLaserPointer`(exe 在 `app/release/`)。
   - 未做程式碼簽章,SmartScreen 會警告:點「其他資訊 → 仍要執行」。

### 每次使用
**朋友(分享者)**
1. 開 app → 填伺服器網址 → 點「我是分享者」。
2. 選擇要被標記的螢幕(通常是主螢幕)。
3. 輸入你給的房號按「加入」(或由他建立房間把房號給你)。
4. 之後掛著即可;關閉視窗會縮到系統匣。Discord 照常分享**整個螢幕**。

**你(觀看者)**
1. 開 app → 填伺服器網址 → 點「我是觀看者」→ 建立房間,把房號給朋友。
2. 把 Discord 開到看得到朋友畫面,按「校準對位」,框出影片的**實際影像範圍**
   (會自動鎖定成朋友螢幕的長寬比;按住 Ctrl 可自由框選)。校準結果會記住,下次可直接用。
3. 按 **F8** 進入指點模式:
   - **點一下** = 擴散圈圈
   - **按住拖曳** = 手繪畫線(停留 3 秒後淡出)
   - **移動滑鼠** = 即時雷射光點
   - **Esc / F8** = 結束指點,滑鼠恢復正常操作

## 部署中繼伺服器

### Render(免費)
1. 把 repo 推上 GitHub,到 [Render](https://render.com) 選 **New → Blueprint**,指向本 repo(讀取 `render.yaml`)。
2. 完成後取得網址填入 app。
3. 免費方案閒置會休眠,首次連線需等數十秒冷啟動。

### 其他主機
```bash
cd server && npm install --omit=dev && npm start   # PORT 環境變數可改埠,預設 3000
```

## 開發

```bash
# 中繼伺服器
cd server && npm install && npm start        # http://localhost:3000
npm run smoke                                # 中繼邏輯 smoke test(需先啟動 server)

# App
cd app && npm install
npm run dev                                  # 開發模式(HMR)
npm run typecheck
npm run build                                # 產出 out/
npm run build:win                            # 打包 NSIS 安裝檔 + portable exe → release/

# 本機雙開自測(先 npm run build)
npx electron . --profile=a                   # 視窗 A 當觀看者
npx electron . --profile=b                   # 視窗 B 當分享者
```

## 已知限制

- **獨占全螢幕**遊戲蓋不住 overlay;無邊框視窗化(borderless)沒問題。
- 朋友需分享「**整個螢幕**」;分享單一視窗的對位(需追蹤視窗位置)列為後續功能。
- 校準準度取決於手動框選,長寬比鎖定可輔助;Discord 影片視窗大小改變後需重新校準。
- Render 免費方案有冷啟動延遲。
- F8 為全域快捷鍵,app 開著時其他程式的 F8 會被吃掉。

## 後續規劃(B 模式)

`app/src/shared/protocol.ts` 的事件協定與房間伺服器已預留擴充空間:
之後可加入 WebRTC 模式 —— 分享者端直接串流畫面到觀看者瀏覽器(免校準、座標 100% 精準,
畫質可超過 Discord 免費版 720p 上限),房間伺服器兼任 signaling。
