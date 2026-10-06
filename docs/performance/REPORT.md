# 加密獨立版清理與效能驗收

範圍：僅 `a0979989987-coder/ox-crypto-independent`。基準為最新遠端 main `bf244e2d8ebef7e875ddeee8444f108bf40a10af`；開始時工作目錄乾淨，另建唯讀基準 checkout。沒有更改原站、台股站、共用 Supabase 資料表／權限、金鑰或 OAuth 設定。本次只交付分支預覽，不更新正式網域。

## 實作結果

- Shell 與畫板／泡泡／分析工具拆成獨立 bundle；建置直接檢查 shell 的依賴圖，禁止再靜態帶入各工具。畫板仍於目前畫面完成初始工作後低優先预熱；沿用原預熱器與共用行情排程。
- 同一 URL（含完整參數／範圍）合併進行中行情請求；每位訂閱者單獨取消、逾時。報價／K 線短快取 1 秒、合約 metadata 60 秒；保留圖表優先及 4 個總併發、預留圖表容量。429 全 host 冷卻，最多再試一次，不變成空資料成功。
- 畫板前台／預熱不再先執行一遍 classic，改由既有 worker 完成分類，worker 失敗使用既有備援。首批分類結果持續顯示。熱力圖／主動買賣可在全部更新前顯示有效部分結果，明確標示進度。原雷達配額、級別、量能、完整型態目錄及最終 universe 不變。
- 切換工具保留實例；手機最多 2 個、桌面最多 3 個，閒置 120 秒後淘汰（30 秒檢查）。釋放實例後保留輕量操作狀態。隱藏時停止動畫／掃描／更新，回來依新鮮度補更新。樣式共用快取避免再次掛載造成第二次 link 下載。
- Worker 展開幾何 LRU 64 組、可視卡片圖表最多 32 個；缺少幾何時以該批原 K 線重建，搜尋範圍不減。行情回應快取 240 筆、來源 K 線快取 1,200 組、分類記憶體 1,000 組、IndexedDB 清理後最多 1,500 組／24 小時。
- 工具圖表的父層 abort 事件解除註冊，避免每次渲染累積閉包；舊任務不能掛載到新工具。自選幣種與板塊按帳號隔離，登出／換帳號清除掛載中的私人 UI 快取。原 guest 自選保持在原本本機 key，沒有不明歸屬資料自動複製到新帳號。

## 台股清理與保留項目

續作核查補移除三份工具淺色 CSS 的 `.tw-radar-root` 分支；保留同一 `:is()` 的加密選擇器與原 specificity。這是無引用樣式整理，沒有以其行數作效能收益。冷啟動數據於這項 45 bytes 的 CSS 清理之前取得，沒有重標成清理後的量測。

- 移除證交所／櫃買除權息、配息、假日及法說會解析器；清掉台股財經 feed registry、未使用雷達 adapter、泡泡及 K 線小圖的台股特例。共用工具列先獨立命名，再刪除台股雷達、卡片、風險等 CSS。
- 移除已指向不存在台股資料的專用／舊雙市場測試腳本；保留仍在驗證 Crypto 隔離的負向測試。排程只保留加密新聞與國際總經工作，刪除 workflow 對已刪台股檔的觸發引用。
- 保留聯準會、BLS、NYSE 交易時段、加密治理／網路事件；只移除其台股 market 標籤，事件 ID、數值、時間戳與來源不重造。
- 後端 `FEATURE_CATALOG` 仍有 18 個 ID，因共用 RPC 以完整 catalog 驗證資料；前端仍是 11 個功能。這些舊 ID 僅作權限資料相容，沒有台股路由、行情下載或運算。未被任何路由引用的 `TW_API_FEATURES`／gate 已刪。
- `Asia/Taipei`、`zh-TW` 是使用者時區／語系，保留。移除其他站本機資料的 migration 不擴大；負向測試裡的 `tw` 也是刻意保留。來源標示、token logo LICENSE 與第三方 vendor 註記保留。

## 測量條件與解讀

Chromium 138.0.7204.0；390×900、1440×900。固定 8 幣 fixture，REST 每次 80 ms，真實 bundled LightweightCharts；HTTP 快取由 Playwright route 關閉，應用內快取啟用。不是實際交易所全市場基準，不是實體 iPhone／Safari 驗證。每個條件一輪，毫秒差异包含測試機與自動點擊的抖動，不應當作 SLA。

首次資料載入時仍可呈現帶來源時間戳的既有快照；表中的「有效結果」特別等待新行情，沒有以舊快照充作加速。輪動首次在熱力圖之後開啟，因此可復用已更新的觀察池。主動買賣的每秒限速與完整掃描仍保留。

下載量為 ResourceTiming encodedBodySize（fixture API 提供 Timing-Allow-Origin），計數是觀測窗內**完成**的資源，含其他仍進行中的背景工作；不是只屬於當前工具的 API 呼叫。頁面已提高 ResourceTiming buffer，避免尾段被截斷。原始逐筆下載／queue／worker round-trip 記錄見 [before.json](before.json)、[after.json](after.json)。

## 首次開啟：修改前 → 修改後

| 尺寸 | 工具 | 首個有效結果 ms | 完整掃描 ms | 完成資源數 | 下載 KiB | GC 後主頁 JS heap MiB |
|---|---|---:|---:|---:|---:|---:|
| 390 | 雷達 | 2674 → 2728 | 4613 → 4654 | 145 → 146 | 1905.7 → 1754.0 | 5.20 → 5.62 |
| 390 | 畫板 | 506 → 403 | 510 → 413 | 6 → 2 | 81.8 → 42.9 | 5.40 → 6.32 |
| 390 | 泡泡圖 | 181 → 239 | — → — | 14 → 11 | 47.1 → 67.0 | 6.35 → 6.77 |
| 390 | 熱力圖 | 2117 → 467 | 2122 → 2195 | 16 → 13 | 1592.8 → 1581.4 | 7.64 → 8.81 |
| 390 | 板塊輪動 | 162 → 136 | 164 → 150 | 3 → 0 | 42.4 → 0.0 | 8.64 → 8.90 |
| 390 | 主動買賣 | 8758 → 311 | 8768 → 8640 | 16 → 13 | 74.0 → 62.2 | 7.69 → 9.14 |
| 1440 | 雷達 | 2690 → 2675 | 4604 → 4607 | 145 → 146 | 1905.7 → 1754.0 | 5.22 → 5.63 |
| 1440 | 畫板 | 536 → 410 | 540 → 413 | 6 → 2 | 81.8 → 42.9 | 6.06 → 6.34 |
| 1440 | 泡泡圖 | 181 → 202 | — → — | 14 → 11 | 47.1 → 67.0 | 6.38 → 6.77 |
| 1440 | 熱力圖 | 2145 → 481 | 2150 → 2218 | 16 → 13 | 1592.8 → 1581.4 | 7.43 → 8.87 |
| 1440 | 板塊輪動 | 111 → 167 | 123 → 169 | 3 → 0 | 42.4 → 0.0 | 7.62 → 8.99 |
| 1440 | 主動買賣 | 8740 → 306 | 8750 → 8597 | 16 → 13 | 74.0 → 62.2 | 7.70 → 8.97 |

泡泡圖按當下完整 tickers 建圖，沒有獨立「全市場分類完成」階段，因此完整掃描欄為 —。雷達時間大致持平；保留實例有記憶體成本，主頁 JS heap 未普遍下降。GC 後 heap 不含 worker／GPU／瀏覽器程序，不能當作裝置總記憶體。

## 補充：各工具獨立冷啟動（修改前 → 修改後）

2026-10-06 補測：每個工具使用全新瀏覽器 context，清空儲存與應用快取；計時從首頁導航開始，包含 shell 下載與仍並行的雷達工作。工具入口使用實際工具列，所以 strength 的預設畫板仍可能短暫初始化。沒有先打開熱力圖來讓輪動受益。前後兩個測試程序在同一機器並行執行，各條件一輪；CPU／排程抖動不能解讀為穩定百分比收益。相同 8 幣、80 ms REST、真實圖表與模擬 WebSocket，沒有交易所連線。

「有效」等待新 REST 行情；「首次畫面」可能是明示來源時間的既有快照，保留在原始 JSON，未當作新行情速度。資源數、下載量及 heap 為從導航至完整掃描的整頁數據，含共用背景工作；泡泡圖取首次 tickers 建圖時間。

| 尺寸 | 工具 | 首個有效結果 ms | 完整掃描 ms | 行情完成請求數 | 下載 KiB | 主頁 heap MiB |
|---|---|---:|---:|---:|---:|---:|
| 390 | 雷達 | 2941 → 2755 | 4824 → 4687 | 31 → 31 | 1905.7 → 1754.0 | 5.18 → 5.60 |
| 390 | 畫板 | 1968 → 1597 | 4278 → 3893 | 25 → 23 | 1939.4 → 1709.1 | 5.23 → 5.32 |
| 390 | 泡泡圖 | 1629 → 932 | — → — | 9 → 6 | 1764.9 → 1591.1 | 4.91 → 4.79 |
| 390 | 熱力圖 | 3068 → 1177 | 3075 → 2898 | 16 → 15 | 3307.8 → 3105.1 | 6.62 → 6.57 |
| 390 | 板塊輪動 | 3089 → 2152 | 3095 → 2888 | 16 → 15 | 3307.8 → 3105.1 | 6.60 → 6.53 |
| 390 | 主動買賣 | 9754 → 1215 | 9766 → 9510 | 18 → 16 | 3131.0 → 1676.8 | 6.71 → 4.77 |
| 1440 | 雷達 | 2768 → 2639 | 4647 → 4561 | 31 → 31 | 1905.7 → 1754.0 | 5.20 → 5.61 |
| 1440 | 畫板 | 1583 → 1617 | 3885 → 3407 | 25 → 23 | 1939.4 → 1709.1 | 5.27 → 5.31 |
| 1440 | 泡泡圖 | 1667 → 1010 | — → — | 9 → 6 | 1764.9 → 1591.1 | 4.92 → 4.81 |
| 1440 | 熱力圖 | 3013 → 1181 | 3019 → 2912 | 16 → 15 | 3307.8 → 3105.1 | 6.62 → 6.57 |
| 1440 | 板塊輪動 | 2992 → 2266 | 2999 → 2999 | 16 → 15 | 3307.8 → 3105.1 | 6.60 → 6.62 |
| 1440 | 主動買賣 | 9801 → 1152 | 9809 → 9448 | 18 → 16 | 3131.0 → 1676.8 | 6.74 → 4.79 |

原始資產 JS/CSS 下載時間、每筆行情請求 duration、主頁工作耗時與首次画面時間見 [cold-before.json](cold-before.json)、[cold-after.json](cold-after.json)。這輪未另外量得 worker 純 CPU 或行情排隊分解；不能把 ResourceTiming 的 duration 視為所有等候時間。24 個案例（前後各 12 個）均無頁面 JS 例外。

### 線上預覽驗收狀態

2026-10-06 重新確認：實作提交 `f0300c8d0fb24b04d59e758d642d6d0e5ef33a36` 的 Vercel 預覽為 READY；預覽存取 API 在讀取 deployment aliases／protection bypass 時仍回傳 403 forbidden。沒有改動存取保護、登入或正式網域。線上瀏覽器驗收尚未通過，需要 Vercel 連線授權涵蓋 `ox-lab` 團隊及 `ox-crypto-independent` 專案，且連線帳號具有該部署存取權。這是連線權限錯誤，不是建置失敗。

## 切回保留中的工具

| 尺寸 | 工具 | 可見結果 ms（前→後） | 完成資源數（前→後） | 下載 KiB（前→後） |
|---|---|---:|---:|---:|
| 390 | 畫板 | 147 → 125 | 4 → 0 | 46.9 → 0.0 |
| 390 | 泡泡圖 | 173 → 108 | 12 → 1 | 31.0 → 8.9 |
| 390 | 熱力圖 | 110 → 140 | 3 → 0 | 42.4 → 0.0 |
| 390 | 板塊輪動 | 103 → 129 | 3 → 0 | 42.4 → 0.0 |
| 390 | 主動買賣 | 84 → 112 | 3 → 0 | 42.4 → 0.0 |
| 1440 | 畫板 | 154 → 83 | 3 → 1 | 38.0 → 8.9 |
| 1440 | 泡泡圖 | 227 → 99 | 12 → 0 | 31.0 → 0.0 |
| 1440 | 熱力圖 | 75 → 53 | 3 → 0 | 42.4 → 0.0 |
| 1440 | 板塊輪動 | 113 → 84 | 3 → 0 | 42.4 → 0.0 |
| 1440 | 主動買賣 | 113 → 64 | 3 → 0 | 42.4 → 0.0 |

「retained-return」是在工具與原強弱對比之間往返；「evicted-return」是遍歷所有五個工具後返回，會觸發手機／桌面保留上限。兩者不可混為一談。後者逐筆數據保留在 JSON，畫板與工具狀態以回歸測試驗證。零／少量新增下载並不停止新鮮度更新。

## 等待時間分解（首次工具，修改前 → 修改後）

下載耗時為 JS/CSS resource duration 加總，請求可並行，不能直接相加當作總等待時間。主頁執行是 CDP TaskDuration 差值，包含渲染／其他主頁工作，不是純篩選 CPU。Worker 欄為主執行緒送出至收到結果的累計時間，包含排程與傳輸；尚未量得 worker 的純 CPU。Queue 與 JSON 下載欄是樣本中位數，去重命中的訂閱者可沒有獨立 network 樣本。

| 尺寸 | 工具 | JS / CSS 累計 ms（前→後） | 行情 queue / JSON 中位 ms（前→後） | 主頁工作 ms（前→後） | worker 往返 ms（前→後） |
|---|---|---:|---:|---:|---:|
| 390 | 畫板 | —/105 → —/0 | 96/85 → 0/86 | 287 → 342 | 304 → 567 |
| 390 | 泡泡圖 | 0/131 → 6/40 | —/— → —/— | 217 → 305 | 0 → 0 |
| 390 | 熱力圖 | 0/60 → 10/61 | 0/85 → 0/85 | 625 → 767 | 0 → 0 |
| 390 | 板塊輪動 | 0/125 → 0/0 | —/— → —/— | 182 → 187 | 0 → 0 |
| 390 | 主動買賣 | 0/62 → 0/0 | 0/84 → 0/85 | 765 → 999 | 0 → 0 |
| 1440 | 畫板 | —/123 → —/0 | 88/84 → 74/86 | 324 → 240 | 324 → 392 |
| 1440 | 泡泡圖 | 0/112 → 7/30 | —/— → —/— | 240 → 236 | 0 → 0 |
| 1440 | 熱力圖 | 0/84 → 6/38 | 0/85 → 0/86 | 689 → 745 | 0 → 0 |
| 1440 | 板塊輪動 | 0/69 → 0/0 | —/— → —/— | 147 → 201 | 0 → 0 |
| 1440 | 主動買賣 | 0/58 → 0/0 | 0/84 → 0/84 | 924 → 935 | 0 → 0 |

JS 欄的 — 表示原始 ResourceTiming 出現負 duration 的異常樣本，不能作為有效下載耗時；原始 JSON 保留以供核查。

## Bundle 與樣式

| 資產 | 基準 bytes / gzip bytes | 修改後 bytes / gzip bytes |
|---|---:|---:|
| `src/generated/runtime.js` | 199,117 / 69,317 | 22,761 / 8,161 |
| `src/generated/tool-patterns.js` | 0 / 0 | 98,083 / 35,376 |
| `src/generated/tool-bubbles.js` | 0 / 0 | 40,910 / 15,609 |
| `src/generated/tool-analytics.js` | 0 / 0 | 64,428 / 22,755 |
| `src/generated/pattern-worker.js` | 42,135 / 14,818 | 42,367 / 14,931 |
| `src/styles/components/tools-rail.css` | 21,318 / 5,212 | 3,157 / 1,062 |
| `src/styles/components/tools-rail-light.css` | 13,397 / 2,226 | 4,654 / 1,124 |

工具拆開後，所有工具都使用時的總 JS 可能增加，因每個工具採完整 bundle 避免失敗子模組污染。收益是首屏按需下載、晚載入與共用下載快取，不以總檔案數减少作為成效。

## 驗證結果與限制

- 基準：340/340 既有測試、四種桌面／手機尺寸深淺色介面組合通過。
- 修改後：344/344 測試通過（刪除 2 項台股解析測試，新增 6 項去重、取消、快取、拆包、worker 淘汰與帳號隔離案例）。建置、100 個本機入口資產／171 個唯一 HTML ID 檢查通過。
- 原始 extraction manifest 不被改寫；19 個已修改檔以獨立 reviewed digest ledger 精確驗證，其他原始檔仍比對原 SHA-256。
- 29 組完全相同 K 線的完整分類、58 次手繪查詢及 classify 開關後 worker 最終結果全數一致，見 [filter-parity.json](filter-parity.json)。
- 桌面 1440 與手機 390：六工具、深淺色、新聞／行事曆／媒體／Google與Email入口通過；沒有頁面 JS 例外或台股請求。
- 狀態保留、超過保留上限後恢復、快速換工具／幣種／週期、合成背景恢復及離線／上線訊號通過。工具列 320／375／390／430／600／1363 寬度不溢出且指示器對齊。
- CSS 持續 503 顯示可用重試、模組失敗最多 2 次後人工重試、worker 啟動失敗走備援、350 ms API 延遲加首次 429 後恢復通過。核心 transport 單測另覆蓋持續 429、卡住的 response body、部分訂閱者取消／逾時。
- 公開功能直接入口在政策立即回覆／延遲 700 ms 的 8 組桌面手機案例通過；帳號、Email/Google callback、UID、後台、登出競態及共用 RPC 相容性由既有單測驗證。沒有用真實帳號寄信或執行完整 Google／Email 登入、後台寫入、Bitget UID 提交。
- 未測到：首頁／強弱對比／新聞／媒體的獨立效能基準（已做功能回歸）、實體 iPhone／Safari、真實交易所全市場長時間掃描、真實 429 或大型市場容量下的裝置總記憶體、完全斷網期間長時間切后台。350 ms 延遲測試不是頻寬限制／CPU throttling。
- 螢幕截圖環境缺繁中文字型（文字可能呈現方框）；不能視作繁中字型或實機視覺驗收通過。截圖僅供佈局參考。

## 重現與回復

```sh
npm ci
npm run build:tools
npm run check
npm run verify:extraction
npm test
npx playwright install chromium
npm run test:e2e
npm run test:performance
npm run benchmark:tools
node scripts/benchmark-cold-tools.mjs
# 比較基準：將 OX_BASELINE_ROOT 指向 bf244e2 的隔離 checkout
OX_BASELINE_ROOT=/path/to/baseline node scripts/compare-performance-results.mjs
```

自訂 Chromium 可設 `OX_TEST_BROWSER`。基準 benchmark 使用 `OX_BENCH_ROOT=/path/to/baseline` 與另一個 `OX_BENCH_OUT`，兩版都由相同 harness／fixture 執行。

目前正式 main／production 沒有變更，不需正式回滾。驗收前可直接關閉分支／PR。未來若合併，使用 GitHub Revert 該 PR 或部署回基準 `bf244e2`；不 force-push、不回復共用資料庫。舊 guest watchlist key 未刪，只有本次新增的帳號隔離 key，回退程式不會遺失原始 guest 清單。

## 修改／刪除清單

- 修改 `.github/workflows/update-news.yml`
- 修改 `.github/workflows/verify-independent.yml`
- 修改 `data/macro-results.json`
- 修改 `docs/NEWS_CENTER_V2_PROGRESS.md`
- 修改 `docs/NEWS_CENTER_V2_SOURCES.md`
- 修改 `index.html`
- 修改 `package.json`
- 修改 `scripts/build-toolkit.mjs`
- 修改 `scripts/collect-macro-results.mjs`
- 修改 `scripts/collect-news.mjs`
- 修改 `scripts/direct-entry-startup-ui-check.mjs`
- 修改 `scripts/e2e-check.cjs`
- 修改 `scripts/independent-ui-check.mjs`
- 刪除 `scripts/news-conferences.mjs`
- 修改 `scripts/news-entry-market-ui-check.mjs`
- 刪除 `scripts/news-finance-sources.mjs`
- 修改 `scripts/news-official-calendar.mjs`
- 修改 `scripts/news-production-smoke.cjs`
- 修改 `scripts/news-providers.mjs`
- 修改 `scripts/test-champagne-palette.cjs`
- 刪除 `scripts/test-etf-loading.cjs`
- 刪除 `scripts/test-light-theme.cjs`
- 修改 `scripts/test-loading-heatmap.cjs`
- 刪除 `scripts/test-market-board-navigation.cjs`
- 刪除 `scripts/test-market-ui-audit.cjs`
- 修改 `scripts/test-mobile-tools-rail.cjs`
- 刪除 `scripts/test-news-v2.cjs`
- 刪除 `scripts/test-resume-progress.cjs`
- 刪除 `scripts/test-timeframe-tiers.cjs`
- 刪除 `scripts/test-tool-readiness.cjs`
- 修改 `scripts/verify-crypto-preservation.mjs`
- 修改 `server/account/feature-access.js`
- 修改 `server/account/feature-catalog.js`
- 修改 `src/app/app.js`
- 修改 `src/app/module-boot.js`
- 修改 `src/components/account/store.js`
- 修改 `src/components/load-tool-module.js`
- 修改 `src/components/loading-state.js`
- 刪除 `src/components/radar/market-workspace.js`
- 修改 `src/components/strength/tools-rail.js`
- 修改 `src/components/style-ready.js`
- 修改 `src/components/style-resource.js`
- 修改 `src/components/tool-load-error.js`
- 修改 `src/core/public-feed.js`
- 修改 `src/generated/pattern-worker.js`
- 修改 `src/generated/runtime.js`
- 修改 `src/markets/crypto/analytics/entry.js`
- 修改 `src/markets/crypto/analytics/flow-chart.js`
- 修改 `src/markets/crypto/analytics/flow-source.js`
- 修改 `src/markets/crypto/analytics/flow-view.js`
- 修改 `src/markets/crypto/analytics/market-live.js`
- 修改 `src/markets/crypto/analytics/tools-charts.js`
- 修改 `src/markets/crypto/bubbles/view.js`
- 修改 `src/markets/crypto/bubbles/bubbles-light.css`
- 修改 `src/markets/crypto/analytics/flow-light.css`
- 修改 `src/markets/crypto/patterns/patterns-light.css`
- 修改 `src/markets/crypto/patterns/charts.js`
- 修改 `src/markets/crypto/patterns/index-cache.js`
- 修改 `src/markets/crypto/patterns/source.js`
- 修改 `src/markets/crypto/patterns/view.js`
- 修改 `src/markets/crypto/patterns/worker.js`
- 修改 `src/styles/components/chart-drawings.css`
- 修改 `src/styles/components/news-center.css`
- 修改 `src/styles/components/radar-polish.css`
- 修改 `src/styles/components/tools-rail-light.css`
- 修改 `src/styles/components/tools-rail.css`
- 修改 `src/styles/themes/editorial-terminal.css`
- 修改 `src/styles/themes/light-compat.css`
- 修改 `src/styles/themes/light-platinum.css`
- 修改 `src/styles/themes/light-tool-roles.css`
- 修改 `tests/load-tool-module.test.mjs`
- 修改 `tests/news-v2.test.mjs`
- 修改 `tests/public-feed.test.mjs`
- 新增 `docs/performance-reviewed-changes.json`
- 新增 `scripts/benchmark-tools.mjs`
- 新增 `scripts/benchmark-cold-tools.mjs`
- 新增 `scripts/compare-performance-results.mjs`
- 新增 `scripts/performance-fixtures.mjs`
- 新增 `scripts/performance-regression.mjs`
- 新增 `src/generated/tool-analytics.js`
- 新增 `src/generated/tool-bubbles.js`
- 新增 `src/generated/tool-patterns.js`
- 新增 `tests/performance-retention.test.mjs`
- 新增 `docs/performance/`：本報告、原始量測、篩選比對及合成測試截圖。

## 預覽權限設定載入修復（續作）

使用者手機已進入預覽，但 OX 顯示「功能設定暫時無法確認」。查核 Vercel env metadata：全部帳號設定原僅 production target，preview 未配備公開政策連線；原 handler 在讀取政策前要求完整登入設定。正式站權限 API 實際回覆 crypto.radar 為 public，並非後台重新鎖定。

修復：feature-access GET 獨立初始化不含 session/PKCE 的公開 client，只要求既有 OX_SUPABASE_URL／OX_SUPABASE_PUBLISHABLE_KEY。這兩個 env 的 target 擴展到本專案 preview，值保持原樣；其餘 secret/origin／Bitget env 仍 production-only。沒有變更其他專案、資料庫政策、OAuth 或登入密鑰。政策仍即時讀 RPC，保留 18 IDs、原 mode/version，拒絕不完整政策；API 無快取且 POST 405。預覽登入本身仍未配置，需登入的功能繼續阻擋，不偽裝帳號驗收通過。

新增 tests/preview-feature-policy.test.mjs：未配置登入仍能讀真實 catalog、login 模式不被解鎖、只初始化一次 policy client、不傳 session/cookie、未配置／RPC 錯誤／缺少 ID 仍 503、POST 405；原登入回歸亦通過。此修復在冷啟動量測之後，沒有重標為新的效能基準。

環境回復：僅將本專案上述兩個 env target 還原為 production；不改值，其餘環境／共用資料不動。程式回復可 revert 該預覽修復提交。

續作驗證：346/346 完整單測通過、build/check 與 19 個 reviewed hashes 檢查通過。用本專案既有公開 DB 連線，在沒有 session secret/origin 的真實 handler 上執行 catalog GET，實際回覆 200 / ok=true / 18 個功能，crypto.radar=public。這是實際 Supabase 公開 RPC 的唯讀查詢；未寫入後台設定。Vercel SSO 的工具存取 403 仍獨立存在，因此不能宣稱已以自動化瀏覽器完成受保護預覽驗收。

## 真實政策 + 瀏覽器續驗（2026-10-06）

最新實作提交 1ecc13d 的完整 GitHub CI 已通過（build/check/extraction、346 單測、介面、狀態及故障回歸）：https://github.com/a0979989987-coder/ox-crypto-independent/actions/runs/37411980937 。

新增 scripts/verify-live-preview-policy.mjs 與 [live-policy-browser.json](live-policy-browser.json)。手機390與桌面1440均以未配置登入的實際 handler 讀取真實公開Supabase catalog：200、18功能、雷達public；前端 OXFeatures.ready=true、沒有功能阻擋，雷達與畫板／泡泡／熱力圖／輪動／主動買賣全部可進入，頁面 JS 例外零。沒有傳 production session secret 或 origin，沒有執行政策寫入。

此輪僅政策來自實際後台；行情是8幣fixture、WebSocket為模擬。本機 assets／handler 與 Playwright 路由串接，不是受保護 Vercel 預覽的實際 HTTP 瀏覽器驗收。第一次公開政策讀取7030ms，第二個新瀏覽器 context 為196ms（同一Node程序的HTTP連線可能復用），不能當作裝置冷啟動或正式API SLA。首次政策等待仍是真正依賴，不以永久快取或預設公開绕過；既有10秒前端逾時及人工重試保留。

重現：只提供既有 OX_SUPABASE_URL／OX_SUPABASE_PUBLISHABLE_KEY，設定 OX_VERIFY_LIVE_POLICY=1、可選 OX_TEST_BROWSER，再執行 node scripts/verify-live-preview-policy.mjs。不需登入密鑰。此測試有明確 live opt-in，不讓一般CI自動讀真實資料。

## 即時跳價修復（2026-10-06，續作）

使用者回報畫板／雷達的幣種數字變慢。原雷達 ticker HTTP cadence 是 15 秒；保留畫板後，卡片漲跌及成交額仍綁定 scanUniverse 的行情快照，而分類新鮮度允許不重新掃描，導致數字停留。這些數字不應依靠重新分類才能更新。

新增 src/markets/crypto/live-quotes.js：一條 Bitget 公開 ticker WebSocket，共用訂閱、最多100個可見/目前幣種與240筆快取，500ms合併訂閱變更，RAF只送出有變更的幣種。更新畫板漲跌／成交額、雷達漲跌／價格／成交額與基準／目前價格。分類、OX分數、排名、K線歷史與完整掃描集合不被報價推送改寫；主圖OHLC仍使用原CryptoLiveCandles，不拿ticker編造K線。

離開工具／背景／功能權限遮罩時停止不必要訂閱；共享訂閱解除不會取消其他消費者。過期或亂序資料、已結束socket的訊息不可覆蓋新資料。報價新鮮度15秒；沿用原行情HTTP供應快照回退，不增加HTTP輪詢排程。斷線最多5次連續失敗重試，online／可見恢復可重試，不無限重整。需要登入的功能依既有前端及後端政策，未修改帳號授權或資料庫設定。

scripts/verify-live-quotes.mjs（npm run test:quotes）在390與1440瀏覽器注入固定ticker訊息，畫板29ms、雷達31ms顯示更新，分级與OX不變、額外K線請求0、JS例外0，見live-quotes-browser.json。這是推送收到後的模擬UI延遲，不是Bitget網路延遲或實體iPhone驗收；原版同條件推送顯示延遲未量測，15秒為程式設定值。沒有將此輪冒充完整冷啟動的重測。

獨立Node WebSocket唯讀探測：12秒內收到12筆BTCUSDT ticker，觀察到達間隔93–121ms（連線時間包含在12秒）；所有筆價格相同，不能由此宣稱真實價格每幾百毫秒變動或已在線上預覽驗收。測試不需要金鑰。自動測試另涵蓋共用socket、離開隔離、乱序REST／push、隱藏恢復、有限重試、快取上限、合併訂閱、只更新受影響訂閱及權限遮罩。

Vercel重查：專案metadata與deployment aliases已可讀；deployment events仍403，錯誤明示缺少ox-lab scope授權。未關閉SSO或修改其他站點。受保護預覽的真實browser／帳號流程仍待驗收，正式站維持原部署。

回復方式：revert 本次即時跳價修復提交，移除新增ticker script及其展示掛接，回復原HTTP cadence／卡片快照；其他效能清理及預覽政策修復可保持。回復不涉及共享DB或環境金鑰。

本次最終驗證：355/355單測、build/check、71來源檔案／21 reviewed hashes、390/1440深淺色介面及完整performance故障／切換回歸通過。新ticker script原始5194 bytes（未壓縮）；本輪新增串流的下載與記憶體前後量測尚未重跑，不沿用舊冷啟動数字宣稱此版更快。

### CI 跳價測試的請求歸因修正

ea14f8f 的 GitHub CI（run 37413722494）已通過355單測、建置／來源檢查、介面及performance回歸，但 test:quotes 把更新瞬間恰好開始的1個K線網路請求判為報價造成，因而失敗。原測試只比較所有request的时间窗，無法區分早已排隊的背景工作。

修正只涉及測試／報告：改在共用行情排程入口記錄由ticker接收／渲染呼叫鏈發出的K線請求，另記錄同期背景網路請求。保留「報價不可觸發K線下載」斷言；新增正向驗證，真的從報價訂閱發出一次K線请求，確認此断言的記錄器能識別，避免只移除檢查。未取消、延遲或關閉真正的背景掃描，也未放寬篩選／授權。390與1440本機重跑通過；最新原始數字在live-quotes-browser.json。本修正不變更網站功能碼，遠端完整CI須以最新提交結果為準。

使用者手機已實際打開本專案預覽的Vercel Logs並看到200記錄；同時連接器runtime/build兩種日誌API仍403。這確認手機登入與連接器授權的結果不同，不能把手機看得到當作連接器已修好。
