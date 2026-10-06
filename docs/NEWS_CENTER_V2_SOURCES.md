# 加密獨立版新聞來源與限制

2026-10-06 更新：快照 2026-10-06T08:49:45.788Z。保存 385 篇中文新聞、0 篇待譯、369 筆事件；2026 年 10 月共 23 筆。數量是保存總量，畫面另套用時間、來源、重要性與去重篩選。

收集排程維持每六小時，只保存公開標題、發布時間與原始連結；不轉載文章全文、照片或第三方摘要。繁中標題按精確 ID、來源與原文保存，治理提案另按精確原文保存中文標題。既有人工翻譯优先；沒有翻譯 API 金鑰，未新增付費服務。

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
