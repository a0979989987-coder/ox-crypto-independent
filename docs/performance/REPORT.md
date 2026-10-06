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
| 390 | 畫板 | -3/105 → -4/0 | 96/85 → 0/86 | 287 → 342 | 304 → 567 |
| 390 | 泡泡圖 | 0/131 → 6/40 | —/— → —/— | 217 → 305 | 0 → 0 |
| 390 | 熱力圖 | 0/60 → 10/61 | 0/85 → 0/85 | 625 → 767 | 0 → 0 |
| 390 | 板塊輪動 | 0/125 → 0/0 | —/— → —/— | 182 → 187 | 0 → 0 |
| 390 | 主動買賣 | 0/62 → 0/0 | 0/84 → 0/85 | 765 → 999 | 0 → 0 |
| 1440 | 畫板 | -2/123 → -4/0 | 88/84 → 74/86 | 324 → 240 | 324 → 392 |
| 1440 | 泡泡圖 | 0/112 → 7/30 | —/— → —/— | 240 → 236 | 0 → 0 |
| 1440 | 熱力圖 | 0/84 → 6/38 | 0/85 → 0/86 | 689 → 745 | 0 → 0 |
| 1440 | 板塊輪動 | 0/69 → 0/0 | —/— → —/— | 147 → 201 | 0 → 0 |
| 1440 | 主動買賣 | 0/58 → 0/0 | 0/84 → 0/84 | 924 → 935 | 0 → 0 |

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
- 原始 extraction manifest 不被改寫；15 個已修改檔以獨立 reviewed digest ledger 精確驗證，其他原始檔仍比對原 SHA-256。
- 29 組完全相同 K 線的完整分類、58 次手繪查詢及 classify 開關後 worker 最終結果全數一致，見 [filter-parity.json](filter-parity.json)。
- 桌面 1440 與手機 390：六工具、深淺色、新聞／行事曆／媒體／Google與Email入口通過；沒有頁面 JS 例外或台股請求。
- 狀態保留、超過保留上限後恢復、快速換工具／幣種／週期、合成背景恢復及離線／上線訊號通過。工具列 320／375／390／430／600／1363 寬度不溢出且指示器對齊。
- CSS 持續 503 顯示可用重試、模組失敗最多 2 次後人工重試、worker 啟動失敗走備援、350 ms API 延遲加首次 429 後恢復通過。核心 transport 單測另覆蓋持續 429、卡住的 response body、部分訂閱者取消／逾時。
- 公開功能直接入口在政策立即回覆／延遲 700 ms 的 8 組桌面手機案例通過；帳號、Email/Google callback、UID、後台、登出競態及共用 RPC 相容性由既有單測驗證。沒有用真實帳號寄信或執行完整 Google／Email 登入、後台寫入、Bitget UID 提交。
- 未測到：首頁／強弱對比／新聞／媒體的獨立效能基準（已做功能回歸）、各工具獨立新分頁冷啟動、實體 iPhone／Safari、真實交易所全市場長時間掃描、真實 429 或大型市場容量下的裝置總記憶體、完全斷網期間長時間切后台。350 ms 延遲測試不是頻寬限制／CPU throttling。
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
- 新增 `scripts/compare-performance-results.mjs`
- 新增 `scripts/performance-fixtures.mjs`
- 新增 `scripts/performance-regression.mjs`
- 新增 `src/generated/tool-analytics.js`
- 新增 `src/generated/tool-bubbles.js`
- 新增 `src/generated/tool-patterns.js`
- 新增 `tests/performance-retention.test.mjs`
- 新增 `docs/performance/`：本報告、原始量測、篩選比對及合成測試截圖。
