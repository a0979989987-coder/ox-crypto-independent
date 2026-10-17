# 加密獨立版新聞來源與限制

## 2026-10-16 更新：即時新聞、翻譯、摘要與原文連結

**為什麼很多新聞沒翻譯**：快照收集在 GitHub Actions 執行，用的免費翻譯端點對 GitHub 的機房 IP 回 429（2026-10-15 21:32Z 那次：嘗試 3 則、成功 0、154 則延後）。之前畫面在沒有翻譯時把標題換成「中文翻譯準備中」，最新的新聞因此大多看不到標題。

**現在的做法**（三層，任何一層失敗都不影響其他層）：
1. 快照收集：英文與簡中分開批次送出（同一請求混語言時自動偵測只會譯其中一種），每次最多 20 則；主要端點回 429 後改用備援端點，整次收集不再重試被擋的端點；被擋的標題算「延後」，下次再譯。
2. 即時新聞 `/api/v1/news/latest`（Vercel 函式，`server/news/latest.js`）：讀取 Odaily、The Block、CryptoSlate、鏈新聞、動區、CoinDesk、Cointelegraph 與 Bitget 公告最近 36 小時，套用與快照完全相同的來源規則（`server/news/feeds.js`），並嘗試翻譯；CDN 快取 3 分鐘（全部來源失敗時只快取 30 秒）。新聞頁開著時每 3 分鐘取一次、每 15 分鐘重讀快照；讀者正在看某篇、開著選單或已往下捲時，不直接改畫面，改顯示「有 N 則新消息・點此更新」。
3. 瀏覽器補譯：畫面上還沒有中文的標題與摘要，由讀者的瀏覽器批次翻譯（每次最多 3 個請求；被拒後暫停 10 分鐘），結果記在這台裝置（最多 900 則，原文改了就不沿用）。只送公開標題與來源摘要，不送任何帳號資料。
沒有翻譯時直接顯示原文標題並標「原文」，不再顯示佔位字。機器翻譯都標「機器翻譯・原文保留供核對」，可展開看原文標題與原文摘要。

**摘要**：來自來源自己的 RSS 描述（不是全文、不是 AI 生成）：取第一段文字，去掉圖片、連結、電子報推廣、「這篇文章最早發佈於」等版尾，依句號切到約 100 個中文字或 220 個英文字元；來源自己截斷的（`[…]`）保留「…」。CoinDesk 部分文章沒有描述，就不顯示摘要。列表標題下顯示兩行摘要，展開看完整摘要與原文摘要。

**原文連結**：每則新聞右上角「原文 ↗」，一點就在新分頁開原文（同時標為已讀），不必先展開。

**Foresight 行事曆**：快照收集從 2026-10-06 起被 Foresight 回 403，鏈上事件（解鎖、上架、主網升級）停在那天。Foresight 的公開 ICS 允許瀏覽器直接讀取，新聞頁每 10 分鐘直接讀一次，今天以後的排程以最新一份為準（撤回或延期的不會殘留），今天以前保留快照記錄的歷史。

**實測（2026-10-16，使用者電腦上的瀏覽器）**：線上快照 154 則待譯標題，以新批次方式 9 個請求、2.5 秒全部翻成繁中；Foresight ICS 讀到 12 筆今天以後的事件，1 個請求全部翻成繁中；Odaily、動區的真實 RSS 描述摘要結果正確。

**未實測**：Vercel 函式在正式環境能否讀到各新聞來源、翻譯端點是否也擋 Vercel 的 IP（擋了也只是由瀏覽器補譯）；鏈新聞與 CFTC 對 GitHub 機房回 403 的情況沒有改變（鏈新聞改由即時新聞補上）。

**通知（之後）**：即時新聞每則有固定 ID、`publishedAt` 與來源，之後的通知可以直接比對新出現的 ID；這次沒有做通知本身。


2026-10-06 更新：快照 2026-10-06T08:49:45.788Z。保存 385 篇中文新聞、0 篇待譯、369 筆事件；2026 年 10 月共 23 筆。數量是保存總量，畫面另套用時間、來源、重要性與去重篩選。

收集排程維持每六小時，只保存公開標題、發布時間、原始連結，以及來源自己在 RSS 提供的短摘要（描述的第一段，約 100 個中文字／220 個英文字元內，見下方 2026-10-16 更新）；不轉載文章全文、照片或第三方摘要。繁中標題按精確 ID、來源與原文保存，治理提案另按精確原文保存中文標題。既有人工翻譯优先；沒有翻譯 API 金鑰，未新增付費服務。

本輪補接 Bitget 官方公告、Odaily 公開 RSS；補接聯準會 FOMC、BEA GDP／PCE 官方排程與 Foresight News 公開區塊鏈日曆。Bitget 公告發布時間只用於新聞，不推定維護、上架或解鎖生效時間。Foresight 為媒體彙整，與官方確認分開標示，午夜占位僅作日期；日期矛盾、季度占位、已延期或未逐一核對的法律生效項目均不收錄。

| 來源 ID | 實測狀態 | 本次回應篇／件數 | 公開接口 |
|---|---|---:|---|
| odaily | ready | 10 | https://rss.odaily.news/rss/newsflash |
| theblock | ready | 19 | https://www.theblock.co/rss.xml |
| cryptoslate | ready | 10 | https://cryptoslate.com/feed/ |
| abmedia | ready | 0 | https://abmedia.io/feed |
| blocktempo | ready | 2 | https://www.blocktempo.com/feed/ |
| coindesk | ready | 25 | https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml |
| cointelegraph | ready | 30 | https://cointelegraph.com/rss |
| fed | ready | 15 | https://www.federalreserve.gov/feeds/press_monetary.xml |
| bls-cpi | ready | 12 | https://www.bls.gov/feed/cpi.rss |
| bls-jobs | ready | 12 | https://www.bls.gov/feed/empsit.rss |
| sec | ready | 1 | https://www.sec.gov/news/pressreleases.rss |
| ethereum | ready | 50 | https://blog.ethereum.org/en/feed.xml |
| kraken | ready | 10 | https://blog.kraken.com/feed |
| cftc | ready | 2 | https://www.cftc.gov/RSS/RSSGP/rssgp.xml |
| bitcoin-core | ready | 10 | https://github.com/bitcoin/bitcoin/releases.atom |
| bitget | ready | 9 | https://api.bitget.com/api/v2/public/annoucements?language=zh_CN |
| fed-calendar | ready | 48 | https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm |
| bea-calendar | ready | 9 | https://www.bea.gov/news/schedule |
| foresight-calendar | ready | 19 | https://api.foresightnews.pro/v1/calendar.ics |
| nyse-calendar | ready | 34 | https://www.nyse.com/trade/hours-calendars |
| ethereum-upgrades | ready | 1 | https://blog.ethereum.org/2026/09/17/glamsterdam-testnet-announcement |
| aptos | ready | 1 | https://aptosnetwork.com/currents/aptos-tokenomics-overview |
| bls-calendar | ready | 53 | https://www.bls.gov/schedule/news_release/current_year.asp |
| aave-governance | ready | 200 | https://hub.snapshot.org/graphql |

來源選單只呈現已接入的新聞源或仍有保存文章的來源；事件排程供應者不混入新聞來源篩選。成功返回零筆與連線失敗仍分開記錄，來源回應有限，不代表全網或完整 30 日資料庫。

移除的未接入選項：Decrypt、PANews、BlockBeats、Binance、Coinbase、OKX、未接入的 Foresight 新聞、歐洲央行。Decrypt 公開 RSS 可讀，但未取得自動收集所需許可，不啟用；PANews RSS 本輪返回 522；BlockBeats 公開文件所列接口返回 Missing API key。其餘未驗證到本輪可使用的公開 feed，不顯示可選入口，不宣稱已接入。

第三方原文、來源權利及限制保留：

- Decrypt 條款：https://decrypt.co/terms-of-service（未啟用）。
- CoinDesk 官方 RSS：https://www.coindesk.com/coindesk-news/2021/09/17/coindesk-rss
- Odaily 發布者 RSS 文件：https://github.com/ODAILY/RSS
- Bitget 公告接口文件：https://www.bitget.com/docs/catalog/classic-common-notice/classic-common-notice
- Foresight 公開日曆入口：https://foresightnews.pro/article/detail/4
- BlockBeats 文件：https://www.theblockbeats.info/apiDoc（要求 API key，未啟用）。
- PANews RSS 設定：https://www.panewslab.com/zh-hant/rss（本輪 feed 不可用）。
- Snapshot GraphQL：https://docs.snapshot.box/tools/graphql-api；Aave 官方治理：https://www.aave.com/docs/ecosystem/governance。
- Tokenomist：https://tokenomist.ai/pricing（需金鑰與授權，未購買或接入）。

FOMC 會議日只按官方日曆列日期；尚未正式公布的會議紀要日期依官方三週規則標成推估，無虛構公布時刻。BEA 精確時刻按 America/New_York 夏令時間轉換。事件覆蓋標示仍是部分來源，未把日曆空白解讀為無事件。

本輪翻譯端點實測 429；停止此輪連續請求，未完成項目不標為翻譯完成。已收錄存量由精確綁定的核對翻譯補齊；日後若服務不可用，保留待譯狀態與原始來源，前端主內容不直接顯示英文待譯標題。
