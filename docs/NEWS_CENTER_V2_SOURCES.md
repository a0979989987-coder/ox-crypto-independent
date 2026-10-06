# 加密獨立版新聞來源與限制

2026-10-06：已移除台股來源與解析器；以下來源條款、國際總經與加密事件說明保留。下列 2026-10-02 筆數是歷史快照紀錄，非目前即時統計。

查核／快照時間：2026-10-02T03:12:18.549Z（台北 11:12）。現有正式 main 排程為六小時收集，非即時串流；本次預覽使用部署所附快照，不會因 main 排程而更新。新版收集器僅在未來驗收、合併後才進入正式排程。

只保存 RSS 標題、原文連結與發布時間；不抓全文、照片或來源摘要。人工核對的繁中標題以精確 ID、来源與原文綁定，未譯標示待補；沒有自動翻譯服務金鑰。公開可讀 feed 的技術驗證不代表取得全文、商業轉授權或完整歷史資料庫。原文權利保留，未付費或替使用者訂閱。

快照：243 篇已譯／原生繁中、37 篇待譯、200 個累積真實來源事件。篇數是去重／時間篩選前的保存總量，UI 按發布時間、來源、市場及去重結果另算。

| 來源 | 市場 | 本版狀態 | 最近回應篇／件數 | 接入或缺口 |
|---|---|---|---:|---|
| CoinDesk | crypto | ready | 25 | https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml |
| Cointelegraph | crypto | ready | 30 | https://cointelegraph.com/rss |
| Decrypt | crypto | not-connected | — | RSS 回應已實測；官方服務條款限制自動收集，移除文章且不啟用。https://decrypt.co/terms-of-service |
| The Block | crypto | not-connected | — | 尚未完成官方接入方式、可用欄位與授權條件的完整驗證；未啟用，沒有造資料。 |
| PANews | crypto | not-connected | — | 尚未完成官方接入方式、可用欄位與授權條件的完整驗證；未啟用，沒有造資料。 |
| Foresight News | crypto | not-connected | — | 尚未完成官方接入方式、可用欄位與授權條件的完整驗證；未啟用，沒有造資料。 |
| BlockBeats | crypto | not-connected | — | 尚未完成官方接入方式、可用欄位與授權條件的完整驗證；未啟用，沒有造資料。 |
| Odaily | crypto | not-connected | — | 尚未完成官方接入方式、可用欄位與授權條件的完整驗證；未啟用，沒有造資料。 |
| 動區動趨 BlockTempo | crypto | ready | 4 | https://www.blocktempo.com/feed/ |
| 鏈新聞 ABMedia | crypto | ready | 5 | https://abmedia.io/feed |
| Bitget 官方公告 | crypto | not-connected | — | 尚未完成官方接入方式、可用欄位與授權條件的完整驗證；未啟用，沒有造資料。 |
| Binance 官方公告 | crypto | not-connected | — | 尚未完成官方接入方式、可用欄位與授權條件的完整驗證；未啟用，沒有造資料。 |
| Coinbase 官方公告 | crypto | not-connected | — | 尚未完成官方接入方式、可用欄位與授權條件的完整驗證；未啟用，沒有造資料。 |
| Kraken 交易所 | crypto | error | — | 官方 feed 返回 HTTP 200 HTML SiteUnavailable，不是 RSS；保留最後成功快照並顯示更新失敗。 |
| OKX 官方公告 | crypto | not-connected | — | 尚未完成官方接入方式、可用欄位與授權條件的完整驗證；未啟用，沒有造資料。 |
| 以太坊基金會 | crypto | ready | 50 | https://blog.ethereum.org/feed.xml |
| 比特幣核心開發團隊 | crypto | ready | 10 | 官方 GitHub releases Atom。僅正式軟體發布事件，候選版不當作已發生升級；不推定主網硬分叉時間。 |
| Aptos 基金會 | crypto | ready | 1 | 重新核對官方 tokenomics；主網 2022-10-12 與四年週年規則推算日期。標示預估、僅日期、無數量／時秒／完成宣稱。https://aptosnetwork.com/currents/aptos-tokenomics-overview |
| Aave 治理（Snapshot） | crypto | ready | 0 | 官方 aave.eth Snapshot GraphQL 查詢成功但返回 0 筆；只代表本次來源回應，不代表整個加密市場没有治理投票。 |
| 美國聯準會 | us | ready | 15 | https://www.federalreserve.gov/feeds/press_monetary.xml |
| 美國勞工統計局・物價 | us | ready | 12 | https://www.bls.gov/feed/cpi.rss |
| 美國勞工統計局・就業 | us | ready | 12 | https://www.bls.gov/feed/empsit.rss |
| 美國勞工統計局・行事曆 | crypto / tw / us | ready | 53 | 官方公开資料回應已驗證，事件覆蓋依來源範圍。 |
| 歐洲央行 | us | not-connected | — | 尚未完成官方接入方式、可用欄位與授權條件的完整驗證；未啟用，沒有造資料。 |
| 美國證券交易委員會 | us / crypto | ready | 25 | https://www.sec.gov/news/pressreleases.rss |
| 美國商品期貨交易委員會 | us / crypto | ready | 10 | https://www.cftc.gov/RSS/RSSGP/rssgp.xml |

## 官方接口

- BLS：https://www.bls.gov/schedule/news_release/current_year.asp；只解析已核對的發布類別，保留過去月份、America/New_York 夏令時間；前值／預期／實值來源沒有提供。
- CoinDesk 官方 RSS 說明：https://www.coindesk.com/coindesk-news/2021/09/17/coindesk-rss
- Snapshot：https://docs.snapshot.box/tools/graphql-api；Aave 官方治理：https://www.aave.com/docs/ecosystem/governance。

## 待接入事件

- Tokenomist：https://tokenomist.ai/pricing。已查核付費／商用 API 分級；無 API key、方案授權與配額，未購買或宣稱接通。
- 交易所上架／下架／維護、空投快照／申領、排程銷毀／回購、指定監管／ETF 生效日期：尚無已驗證排程供應，保留類別與狀態，不從新聞推定日曆日期。
- RSS 現有文章範圍受每來源保留筆數限制；累積歷史不等於完整 30 日或全網覆蓋。熱詞／提及排行只統計目前快照的市場、時間與來源子集。
