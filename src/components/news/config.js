export const MARKET_NAMES = {crypto:'加密',all:'新聞總頁'};
export const CATEGORY_NAMES = {
  "macro": "國際財經數據",
  "conference": "產業會議／活動",
  "holiday": "休市／交易日",
  "exchange": "交易所事件",
  "unlock": "代幣解鎖",
  "network": "主網／協議升級",
  "listing": "上架／下架／維護",
  "governance": "治理投票",
  "airdrop": "空投快照／申領",
  "burn": "銷毀／回購",
  "regulation": "監管／ETF 公告"
};
export const MARKET_CATEGORIES = {
  "crypto": [
    "unlock",
    "network",
    "listing",
    "governance",
    "airdrop",
    "burn",
    "macro",
    "regulation",
    "holiday",
    "exchange",
    "conference"
  ],
  "all": [
    "unlock",
    "network",
    "listing",
    "governance",
    "airdrop",
    "burn",
    "macro",
    "regulation",
    "holiday",
    "exchange",
    "conference"
  ]
};
export const SOURCE_CATALOG = [
  {
    "id": "coindesk",
    "name": "CoinDesk",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "cointelegraph",
    "name": "Cointelegraph",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "cryptoslate",
    "name": "CryptoSlate",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "theblock",
    "name": "The Block",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "odaily",
    "name": "Odaily",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "blocktempo",
    "name": "動區動趨 BlockTempo",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "abmedia",
    "name": "鏈新聞 ABMedia",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "bitget",
    "name": "Bitget 官方公告",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "kraken",
    "name": "Kraken 交易所",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "ethereum",
    "name": "以太坊基金會",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "bitcoin-core",
    "name": "比特幣核心開發團隊",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "aptos",
    "name": "Aptos 基金會",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "aave-governance",
    "name": "Aave／Uniswap／ENS／Arbitrum 治理（Snapshot）",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "fed",
    "name": "美國聯準會",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "bls-cpi",
    "name": "美國勞工統計局・物價",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "bls-jobs",
    "name": "美國勞工統計局・就業",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "nyse-calendar",
    "name": "NYSE・美股休市／提早收盤",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "ethereum-upgrades",
    "name": "以太坊基金會・升級排程",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "bls-calendar",
    "name": "美國勞工統計局・行事曆",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "sec",
    "name": "美國證券交易委員會",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "cftc",
    "name": "美國商品期貨交易委員會",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "fed-calendar",
    "name": "美國聯準會・政策會議排程",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "bea-calendar",
    "name": "美國 BEA・GDP／PCE 排程",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  },
  {
    "id": "foresight-calendar",
    "name": "Foresight News・區塊鏈日曆",
    "markets": [
      "crypto"
    ],
    "status": "not-connected"
  }
];
export const TIME_CHOICES = [['3', '3 小時'], ['24', '24 小時'], ['168', '1 週'], ['720', '30 日']];
export const EVENT_PROVIDERS = {"macro":["bls-calendar","fed-calendar","bea-calendar"],"holiday":["nyse-calendar"],"exchange":["nyse-calendar"],"governance":["aave-governance"],"network":["bitcoin-core","ethereum-upgrades","foresight-calendar"],"unlock":["aptos","foresight-calendar"],"listing":["foresight-calendar"],"airdrop":["foresight-calendar"],"burn":["foresight-calendar"],"regulation":["foresight-calendar"],"conference":["foresight-calendar"]};
export function sourceName(item) { return SOURCE_CATALOG.find(s => s.id === (item.sourceId || item.id))?.name || item.source || item.name || item.sourceId || '來源待確認'; }
