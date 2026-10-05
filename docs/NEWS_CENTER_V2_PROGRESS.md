# OX 新聞中心 2.0 施工紀錄

## 基線與隔離
- 核對時間：2026-10-02（台北）。遠端 main：`dc011fc6220b890552910ebf93e133814005ad66`。
- 交接 SHA `480add8` 已有更新，未退版。
- 工作分支：`feature/news-center-v2-20261002`。獨立 worktree，其他三個現有 checkout 無未提交修改，未更動其他工作分支。
- 現有 main 已包含畫板掃描／介面修正及 Bitget UID 入口，不重新合併舊新聞分支。
- 沒有 AGENTS.md。README／ARCHITECTURE／CURRENT_STATE 已讀，舊市場占位描述不作為刪除新版功能的依據。
- 施工範圍：news 元件與資料轉接、news CSS、新聞入口、雷達底部市場快捷選单、收集器與隔離工作流、驗收測試。
- 不改雷達策略、評分、量能、圖表、OXLIVE、帳號。

## 基線驗證
- `npm test`：372 通過，0 失敗。
- `npm run check`：通過（95 資產／172 ID）。
- 既有 `npm run test:e2e`：失敗 `long: strict T1 capacity or exclusion failed`，在產品修改前執行；progressive radar 通過。不得以新聞修改宣稱修好此問題。
- Chromium 使用既有 Chrome Headless Shell；尚未完成 Safari／iPhone 實機驗證。
- 參考站 finoinvestbot.com/genie-calendar 無法透過檢索讀取；未使用其內部接口。

## 已完成的實作
- 原新聞總頁、加密／台股的原新聞 host 原地使用同一 workspace；只保留行事曆／關鍵新聞，沿用既有指標分段 rail。
- 每市場獨立 session 分頁／月份／篩選／捲動狀態，舊 localStorage 已讀／隱藏／來源追蹤保留。
- 新聞入口桌面 hover／點擊／鍵盤選單；手機延遲單擊、快速双擊、480ms 長按，移動／cancel 取消。事件只作用於原入口，沒有第六顆底部鈕。
- 底部雷達市場選單縮為加密／台股、等寬居中，觸控索引跟隨兩個選項；全站 us 市場保留。
- 浮層多選：時間聯集、來源全部／無選取、事件、三等重要性、查詢／熱詞／排行；未接入來源不可選。白光漸變與 reduced-motion。
- 日曆完整週列，純日期不補午夜；國際發布換算台北並保留来源時區／DST。日期開清單，短事件可直接開詳情，返回／前進／reload 嵌套。
- 手機可視高度量測，保留 OXLIVE 與原 dock；正常 375／390／430 直式五週及六週完整，橫式／放大字體允許捲動。
- 高密度新聞、真實來源／發布時間、翻譯狀態／原文／次級閱讀偏好；去重標題資產提及、熱詞分詞／同義資產，註明來源子集而非全網。
- 快照保留成功資料，來源單獨失敗、待譯、零筆、過期、未接入分開；舊市場慢回應不覆蓋目前市場，新快照先提示，未接受前保留閱讀位置。
- 收集器沿用 schemaVersion 1，維持 news 繁中與既有 OXLIVE／US 消費端；新增 pendingNews／assetCatalog／eventCoverage。沒有 key 到前端／日誌。
- 未更換前端框架／行情供應；保留原 CSS 中首頁／圖表／觸控依賴，新增樣式只作用於 oxn workspace／layer。

## 真實資料與未完成項目
參見 [NEWS_CENTER_V2_SOURCES.md](NEWS_CENTER_V2_SOURCES.md)，逐來源列出實測數量／狀態／接口／限制。
- 已實測的加密媒體：CoinDesk、Cointelegraph、BlockTempo、ABMedia。台股：科技新報與證交所公開 RSS；不是所有指定平台皆已接通。
- 事件：TWSE／TPEx 除權息資料、交易日曆、官方 DOCX 法說月表、BLS、Bitcoin Core 正式版本發布、官方 Aptos 規則的純日期預估。
- Aave 官方治理查詢成功返回 0，並不填入示例。
- Decrypt 官方条款限制自動收集，已停用、移除本次擷取；Kraken 返回 HTML 不是 RSS，顯示更新失敗。
- 法說九月更新版公告是 PDF，本版只解析 DOCX；歷史累積记录與已解析月表不代表完整覆蓋。
- 現金發放／填息／殖利率歷史樣本、Tokenomist API key／授權、其他未驗證的媒體与排程接口、繁中全文摘要／自動翻譯服務，仍未完成。所有缺口有明示，没有假數值／時間／新聞。

## 驗收與畫面
- `npm test`：390 通過、0 失敗（原 372＋18 新測試）。
- `npm run check`：通過（96 資產／171 唯一 ID）。
- `npm run test:news-v2` Chromium：通過；詳見 [qa-chromium.json](qa/news-v2/qa-chromium.json)，五尺寸、五／六週、嵌套返回／前進／reload、手勢、各市場狀態、多選、慢回應／空／503、來源失敗、更新保留閱讀、橫式／reduced motion。
- 原 `npm run test:e2e`：与施工前相同 `long: strict T1 capacity or exclusion failed`，progressive radar 通過；未改 T1 策略或放寬檢查。後续整站檢查因該失敗未抵達，不宣稱全面綠燈。
- WebKit 已下載，啟動因缺 GTK／GStreamer 等系統 library 阻擋；安裝依賴受環境檔案權限阻擋，因此沒有 WebKit 通過結果。沒有 iPhone 實機驗證。
- 本地 QA 使用真實 data/news.json，部分錯誤情境明確隔離於 route fixture。圖表 vendor 是實際官方 JS bytes，帳號 config 为明確未配置 guest；未把 fixture 寫入快照。
- [實際截图與測試紀錄](qa/news-v2/)：桌面／手機行事曆、關鍵新聞、兩市場詳情、多選、桌面／手機入口、兩市場雷達選單與小手機六週。
- 截圖已逐張檢視；面板等動畫穩定才拍，無透明遮罩殘留／橫向溢出；既有雷達卡片、OXLIVE 視覺不因本輪修改。

## 預覽與正式隔離（發布前紀錄）
- 實作已提交並發布到 `feature/news-center-v2-20261002`。完整功能提交：`8be78440e533accf9f03f3653d934afd9af6b480`；後續驗證提交只補交付紀錄、實際部署畫面與快照說明文字。
- Vercel 回報 Preview 成功（GitHub deployment `6800524088`，不是正式發布）；實際回傳網址：https://ox-crypto-screener-mfwommay1-ox-lab.vercel.app/ 。瀏覽器已從原入口實際核對加密新聞、台股新聞、新聞總頁、多選、詳情返回與重新整理，附 [部署核對紀錄](qa/news-v2/deployed-preview.json)。
- 原生 HTTP 未登入請求轉向 Vercel 登入保護；既有瀏覽器可開啟實際產品，未變更部署保護／帳號權限。預覽可能要求具有 OX Lab 存取權的 Vercel 帳號登入，不能宣稱匿名公開可用。
- [預覽 CI](https://github.com/a0979989987-coder/ox-crypto-screener/actions/runs/36959885962) 成功；只收集、測試、檢查與保存 artifact，不寫入 main。
- 本預覽使用部署所附 2026-10-02 11:12（台北）成功快照；不可把正式 main 的六小時排程當成本預覽每六小時自動更新的證明。新的正式收集器需未來驗收、合併後才啟用。
- 交付時再次核對遠端 main，仍為 `dc011fc6220b890552910ebf93e133814005ad66`。Vercel 最新正式 deployment `6799752473` 也仍指向該 SHA，與本輪開始時相同；兩項證據分開查核。
- 六小時 production workflow 添加 main-ref guard；預覽 workflow contents:read，仅驗證與 artifact，不 commit／push／deploy main，也沒有排程。
- 本輪沒有合併、推 main、觸發寫 main 的資料流程或授權正式發布。
- 遠端 main 與 Vercel 部署分開查核，不以 branch SHA 直接推定正式站版本。預覽驗收後才由使用者決定是否合併發布。

## 後續驗收缺口
- 部分候選來源／事件供應尚未接入，原因逐項列在來源文件；不得視為完整 20 平台覆蓋。現金發放日、填息、估值／流通比例、自動繁中摘要、精確代幣解鎖時間無完整可靠供應，保持缺值／待補。
- RSS 為來源有限文章子集，不能宣稱完整 30 日新聞或全網排行；未接入分類保留明示状态。
- Safari／WebKit 系統依賴阻擋與既有 T1 E2E 失敗仍待處理；會員／Bitget 外部驗證及 iPhone 實機未執行。本輪沒有修改上述功能來製造通過。

## 正式發布授權與發布版本
- 使用者於 2026-10-02 11:35（台北）明確要求「直接上架正式版不用給我預覽」，取代上述先預覽、再驗收的發布限制；上節記錄保留為發布前歷史。
- 發布前再次核對 main，仍為 `dc011fc6220b890552910ebf93e133814005ad66`。採用已提交、390 項單元測試／建置檢查／五尺寸 Chromium 與實際部署 UI 驗證的 `d67cff0075e8d1786528104030e7a9e3b4e1f1a2` 程式樹；不使用中斷工作區中未提交的額外版面草稿。
- 以不強制的 fast-forward 整合功能分支到 main，保留既有提交與其他功能；不刪測試或變更 T1／T2／T3 策略。若 main 在更新前已有新提交，必須重新整合，不能強推。
- Vercel 正式部署結果與正式頁核對記錄將在成功後補齊；結果未取得前不宣稱已上線。來源限制與既有 E2E／WebKit 缺口仍適用。

## 正式發布結果
- 已依最新授權發布正式 main；產品程式為已驗證的 `d67cff0075e8d1786528104030e7a9e3b4e1f1a2`，後續提交補授權、正式驗證流程與證據，不改產品邏輯。
- 正式公開網址：https://ox-crypto-screener.vercel.app/ 。GitHub Actions 已驗證該公開網址送出本輪提交的新聞 JS／CSS 完整 bytes，而非僅以 main SHA 判定部署。
- 本次正式瀏覽器核對提交：`569c819d6d25e62a5b13099fb408e63dcfaa31cb`。Vercel deployment `6800867058`，環境 **Production**、狀態 success；回傳 immutable URL：https://ox-crypto-screener-8xy94voti-ox-lab.vercel.app 。
- [正式 Chromium 驗收](https://github.com/a0979989987-coder/ox-crypto-screener/actions/runs/36961994481) 成功：五個指定尺寸、真實新聞／事件、加密／台股／總頁、多選、詳情關閉、總頁重新整理；沒有新聞 fixture，0 pageerror，0 橫向溢出。完整 [report](qa/news-v2/production-report.json)。發布前另已通過五／六週、手勢／hover／鍵盤／歷史／慢回應等測試。
- 正式站截圖：桌面行事曆與手機關鍵新聞 JPEG 已在本文件同目錄下保存並逐張檢視；25 張正式 PNG 保存在本次 workflow artifact（14 日），其他指定詳情／多選／入口／雷達場景的發布前實際圖片已檢視並保存在 repo。
- 正式快照：2026-10-02 11:12（台北），243 篇已譯／原生繁中、200 個累積來源事件（含明示預估排程）；6 小時正式收集器現在随 main 版本啟用，未擅自加頻率或購買服務。手動重抓是讀取最後成功部署快照，非即時串流。
- 工作區／互動瀏覽器執行服務中斷，故最後正式核對改由只讀的 GitHub Actions Chromium 執行；沒有更改帳號、權限或資料。額外手機兩行短標題草稿出現文字裁切，未提交到 main，保留已通過圖像驗證的緊湊單行版。
- 390 項單元測試及建置檢查通過；原有 T1 E2E 失敗、WebKit 系統依賴缺口與 iPhone 實機未驗證仍如上記錄。來源／授權／翻譯／現金發放日等未完成項目仍見來源文件，不因正式發布改寫為完成。
