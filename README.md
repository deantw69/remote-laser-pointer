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
- 雙方安裝**同一個 app**,選角色即連:分享者開房(房名=電腦名、自帶密碼),觀看者從線上清單點房加入,免帳號。
- 支援 **Windows** 與 **macOS**。
- **自動更新**:Windows 版開 app 會自動檢查新版,有更新先問你要不要下載、下載完再問要不要重啟套用;macOS 版(未簽章)偵測到新版時會開 GitHub Release 下載頁讓你手動更新。首頁角色選擇畫面會顯示目前版本號,也有「檢查更新」按鈕可手動查。

## 專案結構

| 路徑 | 說明 |
|---|---|
| `server/` | Node.js(ESM)+ Socket.IO 座標中繼伺服器(以房名配對、密碼驗證、線上房清單) |
| `app/` | Electron + TypeScript + electron-vite 桌面 app(單一 app 雙角色) |
| `app/src/shared/protocol.ts` | 雙端共用協定(座標一律 0~1 正規化) |
| `render.yaml` | Render 一鍵部署設定 |

## 使用教學

### 事前準備(一次性)
1. 中繼伺服器已部署於 `https://remote-laser-pointer-relay.onrender.com`,**app 已內建此預設網址,免設定**;自架時才需要在 app 內改網址(見下方「部署」)。
2. 雙方各安裝 `RemoteLaserPointer`(Windows exe / macOS dmg 都在 `app/release/`)。
   - 未做程式碼簽章:Windows 會被 SmartScreen 警告(點「其他資訊 → 仍要執行」);macOS 首次開啟被 Gatekeeper 擋時,對著 app 圖示按右鍵→「打開」。

### 每次使用
**朋友(分享者=開房方)**
1. 開 app → 點「我是分享者」(伺服器網址已內建,可在「進階設定」改)。
2. 選擇要被標記的螢幕(通常是主螢幕)。
3. (選用)**標記範圍**:預設「整個螢幕」。若只分享某個視窗/區域,按「校準標記範圍」框出該區域在螢幕上的位置(可看到目前範圍再微調),讓對方的標記精準落在那塊;比例會自動同步給對方。隨時可「重設為整個螢幕」。
4. 房名預設為你的電腦名、密碼系統自動產生(皆可自訂,🎲 可重產,固定不變);按「開房」,把**房名 + 密碼**給對方一次即可。
5. 之後掛著即可;關閉視窗會縮到系統匣。分享整個螢幕時 Discord 照常分享**整個螢幕**。

**你(觀看者=加入方)**
1. 開 app → 點「我是觀看者」→「線上房間」清單會即時列出正在開的房,點朋友的房、輸入密碼即加入(連過的房會記住密碼,下次直接進)。
2. 把 Discord 開到看得到朋友畫面,按「校準對位」,框出影片的**實際影像範圍**
   (會自動鎖定成朋友螢幕的長寬比;按住 Ctrl 可自由框選)。會顯示上次校準範圍供**微調**——拖框內移動、拖八個把手縮放、空白處可重新拉框,按 **Enter/確定** 生效、**Esc/取消** 放棄。校準結果會記住,下次可直接用。
   - 分享者若有設「自訂標記範圍」(例如只分享某視窗),你這邊要框在**影片中對應的同一塊內容**,兩邊才會對齊。
3. 按 **F8**(macOS 為 **⌘⇧L**)進入指點模式:
   - **點一下** = 擴散圈圈
   - **按住拖曳** = 手繪畫線(停留 3 秒後淡出)
   - **移動滑鼠** = 即時雷射光點
   - **Esc / F8(macOS ⌘⇧L)** = 結束指點,滑鼠恢復正常操作

## 部署中繼伺服器

### Render(免費)
1. 把 repo 推上 GitHub,到 [Render](https://render.com) 選 **New → Blueprint**,指向本 repo(讀取 `render.yaml`)。
2. 完成後取得網址填入 app。
3. 免費方案閒置會休眠,首次連線需等數十秒冷啟動。
4. GitHub repo 已授權給 Render App,push 到 `main` 會**自動部署**(Auto-Deploy: On Commit)。

### 其他主機
```bash
cd server && npm install --omit=dev && npm start   # PORT 環境變數可改埠,預設 3000
```

## 開發與執行

中繼伺服器已部署在 Render(見上方「部署」),**開發時不必自架**,直接跑 app 即可。

```bash
cd app
npm install                                  # 首次安裝依賴
npm run dev                                  # 開發模式(HMR),自動開 Electron 視窗
npm run typecheck                            # 型別檢查
npm run build                                # 只編譯,產出 out/
```

### 本機雙開自測(一台電腦模擬雙方,先 npm run build)

```bash
cd app
npx electron . --profile=a                   # 視窗 A 當分享者(開房,把房名+密碼給 B)
npx electron . --profile=b                   # 視窗 B 當觀看者(從清單點 A 的房、輸密碼加入)
```

`--profile` 會分開 userData,兩窗互不干擾。

### 打包

```bash
cd app
npm run build:win                            # Windows:NSIS 安裝檔 + portable exe → release/
npm run build:mac                            # macOS:dmg + zip → release/(未簽章,identity: null)
```

- Windows exe 未簽章 → SmartScreen 警告,點「其他資訊 → 仍要執行」。
- macOS dmg 未簽章 → 首次開啟被 Gatekeeper 擋,對 app 圖示按右鍵 →「打開」。

### 發布新版本(給開發者,讓使用者自動更新)

更新來源為本 repo 的 **GitHub Releases**(public,使用者端免 token)。發布步驟:

1. 升 `app/package.json` 的 `version`(例如 `0.2.0` → `0.3.0`)——**版本沒升,使用者不會收到更新**。
2. 設環境變數 `GH_TOKEN` 為具此 repo 權限的 GitHub Personal Access Token。
3. 打包並上傳:

   ```bash
   cd app
   npm run release:win                        # Windows:建/更新對應 tag 的 Release,上傳安裝檔 + latest.yml
   npm run release:mac                        # macOS:上傳 dmg/zip + latest-mac.yml
   ```

4. 使用者下次開 app(或按「檢查更新」)即會收到。

- 不想用 `GH_TOKEN` 時的手動備選:`npm run build:win` 後,用 `gh release create v<版本> release/*.exe release/latest.yml` 手動建立 Release 並上傳(**務必含 `latest.yml`**,autoUpdater 靠它判斷版本)。
- macOS 未簽章,electron-updater 無法在 mac 全自動安裝,故 mac 只做「偵測到新版 → 開下載頁」;要 mac 也全自動需先做 Apple 簽章與公證。

### 自架中繼伺服器(選用)

```bash
cd server && npm install && npm start        # http://localhost:3000
npm run smoke                                # 中繼邏輯 smoke test(需先啟動 server)
```

自架後在 app 首頁把伺服器網址改成你的位址。

### 疑難排解

- **`Error: Electron uninstall` / `Electron failed to install correctly`**:`npm install` 時 Electron 二進位解壓不完整(dist 過小、缺 `path.txt`)。修法:用下載快取裡的完整 zip 手動解壓——
  - macOS:`unzip -q ~/Library/Caches/electron/*/electron-v<版本>-darwin-*.zip -d node_modules/electron/dist`,再 `printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt`
  - Windows:`Expand-Archive` 快取 zip 到 `node_modules/electron/dist`,再寫 `path.txt`(內容 `electron.exe`)
  - 驗證:`node -e "console.log(require('electron'))"` 應印出執行檔路徑

## 已知限制

- **獨占全螢幕**遊戲蓋不住 overlay;無邊框視窗化(borderless)沒問題。
- 分享整個螢幕免設定即可用;分享單一視窗時,分享者用「校準標記範圍」把範圍框在該視窗位置即可對位(視窗移動後需重新校準,自動追蹤列為後續)。
- 校準準度取決於手動框選,長寬比鎖定可輔助;Discord 影片視窗大小改變後需重新校準。
- Render 免費方案有冷啟動延遲。
- 切換鍵為全域快捷鍵(Windows F8、macOS ⌘⇧L),app 開著時其他程式的同一鍵會被吃掉。

## 後續規劃(B 模式)

`app/src/shared/protocol.ts` 的事件協定與房間伺服器已預留擴充空間:
之後可加入 WebRTC 模式 —— 分享者端直接串流畫面到觀看者瀏覽器(免校準、座標 100% 精準,
畫質可超過 Discord 免費版 720p 上限),房間伺服器兼任 signaling。
