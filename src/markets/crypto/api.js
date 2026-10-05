const ASSET_CLASS = Object.freeze({
  CRYPTO: "crypto",
  STOCK: "stock",
  ETF: "etf",
  COMMODITY: "commodity",
  INDEX: "index",
  OTHER: "other"
});

// Centralized fallback only. Official Bitget instrument metadata is preferred whenever available.
const NON_CRYPTO_UNDERLYINGS = Object.freeze({
  stock: new Set([
    "AAPL","TSLA","NVDA","META","MSFT","INTC","COIN","PLTR","NFLX","BABA","AMZN","GOOG","GOOGL","AMD","MSTR","HOOD","MARA","RIOT","SMCI","AVGO","ORCL","CRM","MU","TSM","QCOM","ARM","RDDT","UBER","NIO","JD","PDD","SHOP","PYPL","DIS","BA","JPM","GS","BAC","WMT","COST","KO","MCD","SBUX","XOM","CVX","LLY","UNH","JNJ","HPQ"
  ]),
  etf: new Set([
    "SPY","QQQ","IWM","DIA","SOXL","SOXS","TQQQ","SQQQ","ARKK","GLD","SLV","USO","BITO","IBIT","ETHA"
  ]),
  commodity: new Set([
    "XAU","XAG","XPT","XPD","GOLD","SILVER","WTI","BRENT","USOIL","UKOIL","NATGAS","NG","COPPER"
  ]),
  index: new Set([
    "SPX","SP500","NDX","NASDAQ","NAS100","DJI","DOW","VIX","DXY","US100","US30","US500","HK50","GER40","JPN225"
  ])
});

// Asset-backed crypto tokens remain crypto contracts even if their economics reference metals.
const CRYPTO_TOKEN_EXCEPTIONS = new Set(["PAXG","XAUT","DGX"]);
const CRYPTO_TICKER_COLLISIONS = new Set(["CVX","SPX"]);
const FX_UNDERLYINGS = new Set(["EURUSD","USDJPY","GBPUSD","AUDUSD","NZDUSD","USDCAD","USDCHF","EURJPY","GBPJPY"]);

function normalizeUnderlyingSymbol(contract = {}) {
  const raw = String(contract.baseCoin || contract.baseAsset || contract.underlying || contract.symbol || "").toUpperCase().trim();
  return raw.replace(/USDT$|USDC$/i, "").replace(/[^A-Z0-9._-]/g, "");
}

function classifyInstrument(contract = {}) {
  const base = normalizeUnderlyingSymbol(contract);
  if (CRYPTO_TOKEN_EXCEPTIONS.has(base)) return ASSET_CLASS.CRYPTO;
  // A generic/mislabelled crypto type cannot override a verified stock or FX
  // underlying. Known token collisions still defer to official asset metadata.
  if(FX_UNDERLYINGS.has(base))return ASSET_CLASS.OTHER;
  if(!CRYPTO_TICKER_COLLISIONS.has(base)){
    for(const cls of [ASSET_CLASS.STOCK,ASSET_CLASS.ETF,ASSET_CLASS.COMMODITY,ASSET_CLASS.INDEX]){
      if(NON_CRYPTO_UNDERLYINGS[cls]?.has(base))return cls;
    }
  }
  const rwa=String(contract.isRwa || '').toUpperCase()==='YES';

  // Bitget v3 instrument metadata exposes crypto / metal / stock / commodity symbol types.
  const type = String(contract.assetSymbolType || contract.instrumentSymbolType || contract.v3SymbolType || contract.symbolTypeV3 || "").toLowerCase();
  if (type === "crypto" && !rwa) return ASSET_CLASS.CRYPTO;
  if (type === "stock") return NON_CRYPTO_UNDERLYINGS.etf.has(base) ? ASSET_CLASS.ETF : ASSET_CLASS.STOCK;
  if (type === "metal" || type === "commodity") return ASSET_CLASS.COMMODITY;
  if (type === "index") return ASSET_CLASS.INDEX;
  if (type === "etf") return ASSET_CLASS.ETF;

  // Future-proof metadata hints if Bitget extends the schema.
  const metadataHint = [contract.assetClass, contract.assetType, contract.underlyingType, contract.category, contract.instrumentType]
    .filter(Boolean).join(" ").toLowerCase();
  if (/\betf\b/.test(metadataHint)) return ASSET_CLASS.ETF;
  if (/\b(index|indices)\b/.test(metadataHint)) return ASSET_CLASS.INDEX;
  if (/\b(stock|equity|share)\b/.test(metadataHint)) return ASSET_CLASS.STOCK;
  if (/\b(metal|commodity)\b/.test(metadataHint)) return ASSET_CLASS.COMMODITY;
  if (/\bcrypto(currency)?\b/.test(metadataHint) && !rwa) return ASSET_CLASS.CRYPTO;

  // A v2 perpetual explicitly marked non-RWA is a crypto contract even when
  // its token ticker also names an equity (for example CVX). The official v3
  // asset type above still wins when the same ticker really is a stock.
  const nonRwa=String(contract.isRwa || '').toUpperCase() === 'NO' &&
      contract.symbolType === 'perpetual' && contract.quoteCoin === 'USDT';
  if (nonRwa && CRYPTO_TICKER_COLLISIONS.has(base)) return ASSET_CLASS.CRYPTO;

  for (const cls of [ASSET_CLASS.STOCK, ASSET_CLASS.ETF, ASSET_CLASS.COMMODITY, ASSET_CLASS.INDEX]) {
    if (NON_CRYPTO_UNDERLYINGS[cls]?.has(base)) return cls;
  }

  // New RWA listings must never fall through into crypto just because they
  // are absent from the fallback list or the v3 metadata request failed.
  if (String(contract.isRwa || '').toUpperCase() === 'YES') return ASSET_CLASS.OTHER;
  if (nonRwa) return ASSET_CLASS.CRYPTO;

  // v2 contract endpoint is crypto-heavy and does not expose a reliable asset class for every listing.
  // If v3 metadata is unavailable, default to crypto after centralized non-crypto fallbacks above.
  return ASSET_CLASS.CRYPTO;
}

function isCryptoInstrument(contract) {
  return classifyInstrument(contract) === ASSET_CLASS.CRYPTO;
}

function isCryptoSymbolAllowed(symbol) {
  const known = state.instrumentCatalog?.get(symbol) || state.contracts?.get(symbol);
  if (known) return isCryptoInstrument(known);
  return isCryptoInstrument({ symbol, baseCoin: String(symbol || "").replace(/USDT$|USDC$/i, "") });
}

const cryptoCandleObservations=new Map();
// Include body decoding in the deadline, including Safari versions without
// AbortSignal.timeout. A stalled request must not hold the scanner forever.
async function fetchBitgetJSON(url, timeoutMs=30000,options={}) {
  return globalThis.OXPublicFeed.json(url,{timeoutMs,...options});
}
const BitgetAPI = {
  peekCandles(symbol,frame,now=Date.now()) {
    const observation=cryptoCandleObservations.get(symbol+':'+frame);
    return observation&&now-observation.serverTime<=300000?observation:null;
  },
  async fetchTickers() {
    const json = await fetchBitgetJSON(`${CONFIG.apiBase}/tickers?productType=${CONFIG.productType}`);
    if (json.code !== "00000" || !Array.isArray(json.data)) throw new Error("Ticker 格式錯誤");
    return json.data;
  },

  async fetchContracts() {
    const json = await fetchBitgetJSON(`${CONFIG.apiBase}/contracts?productType=${CONFIG.productType}`);
    if (json.code !== "00000" || !Array.isArray(json.data)) throw Error('合約資料未取得');
    return json.data.filter(x => x.symbolStatus === "normal" && x.symbolType === "perpetual" && x.quoteCoin === "USDT");
  },

  async fetchInstrumentMetadata() {
    try {
      const json = await fetchBitgetJSON(`https://api.bitget.com/api/v3/market/instruments?category=${CONFIG.productType}`);
      if (json.code !== "00000" || !Array.isArray(json.data)) return [];
      return json.data;
    } catch (e) {
      return [];
    }
  },

  async fetchCandles(symbol, granularity, limit = 100, endTime = null, options = {}) {
    // Older pages use Bitget's history endpoint; recent candles only cover a short window.
    const endpoint = endTime ? "history-candles" : "candles";
    let url = `${CONFIG.apiBase}/${endpoint}?symbol=${encodeURIComponent(symbol)}&productType=${CONFIG.productType}&granularity=${granularity}&limit=${Math.min(200, limit)}`;
    if (endTime) url += `&endTime=${endTime}`;
    const json = await fetchBitgetJSON(url,30000,{owner:"chart",priority:100,...options});
    if (json.code !== "00000" || !Array.isArray(json.data)) throw Error("K 線資料格式錯誤");
    
    // 使用 ES6 陣列解構，百分之百避免任何下標被誤刪
    const candles=json.data.map(d => {
      const [rawTime, rawOpen, rawHigh, rawLow, rawClose, rawVol, rawQuoteVol] = d;
      return {
        time: Math.floor(num(rawTime) / 1000),
        open: num(rawOpen),
        high: num(rawHigh),
        low: num(rawLow),
        close: num(rawClose),
        volume: rawVol == null || rawVol === '' ? null : Number(rawVol),
        quoteVolume: rawQuoteVol == null || rawQuoteVol === '' ? null : Number(rawQuoteVol)
      };
    }).filter(c => Number.isFinite(c.open) && Number.isFinite(c.close) && c.open > 0 && c.close > 0)
      .sort((a, b) => a.time - b.time);
    if(!endTime&&candles.length){
      cryptoCandleObservations.set(symbol+':'+granularity,{symbol,frame:granularity,candles,serverTime:Number(json.requestTime)||Date.now()});
      if(cryptoCandleObservations.size>1200)cryptoCandleObservations.delete(cryptoCandleObservations.keys().next().value);
    }
    return candles;
  }
};
