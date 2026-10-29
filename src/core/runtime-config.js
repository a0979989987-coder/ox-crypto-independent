"use strict";

const CONFIG = {
  apiBase: "https://api.bitget.com/api/v2/mix/market",
  productType: "USDT-FUTURES",
  
  liquidity: {
    minUsdtVolume24h: 3000000,
  },

  queueBatchSize: 10,
  batchIntervalMs: 2500,
  tickerRefreshMs: 15000
};

const state = {
  symbol: "BTCUSDT",
  period: "1D",
  currentTab: "all",
  directionFilter: "long",
  activeView: "radar",
  activeMarket: "crypto",
  
  tickers: [],
  contracts: new Map(),
  instrumentCatalog: new Map(),
  assetClassCounts: { crypto: 0, stock: 0, etf: 0, commodity: 0, index: 0, other: 0 },
  btcTicker: null,
  ethTicker: null,
  
  scanQueue: [],
  scanIndex: 0,
  analyzedCache: new Map(),
  isQueueRunning: false,
  
  tierMap: { t1: [], t2: [], t3: [], surge: [], gainers: [], losers: [] },
  tierMapBySide: { long: { t1: [], t2: [], t3: [] }, short: { t1: [], t2: [], t3: [] } },

  chart: null,
  candleSeries: null,
  volumeSeries: null,
  candleData: [],
  isLoadingOlder: false,
  hasMoreHistory: true,
  oldestCandleTime: 0,
  abortCtrl: null,
  keyHighLine: null,
  keyLowLine: null,
  secondaryKeyHighLine: null,
  secondaryKeyLowLine: null,
  currentLevels: { high: 0, low: 0, sourcePeriod: "4H", highTime: 0, lowTime: 0 },
  secondaryLevels: null,
  keyLevelsVisible: false,
  audioCtx: null
};

// 每次新載入預設關閉「前高前低」視覺；計算與提醒仍照常執行。
state.keyLevelsVisible = false;
try { localStorage.setItem("ox-chart-key-levels-visible", "0"); } catch (e) {}

try {
  const savedTier = localStorage.getItem("ox-scanner-tier-filter");
  const savedDirection = localStorage.getItem("ox-scanner-direction-filter");
  if (["all","t1","t2","t3","surge","watch"].includes(savedTier)) state.currentTab = savedTier;
  // A new visit always opens at the combined bullish Radar list.
  state.currentTab = "all";
  state.directionFilter = "long";
  localStorage.setItem("ox-scanner-tier-filter", "all");
  localStorage.setItem("ox-scanner-direction-filter", "long");
} catch (e) { state.directionFilter = "long"; }

function syncDirectionalBadges() {
  const sideMap = state.tierMapBySide?.[state.directionFilter] || { t1:[], t2:[], t3:[] };
  const turnoverCount = Math.min(15, state.tickers.filter(t => Number.isFinite(num(t.usdtVolume)) && num(t.usdtVolume) > 0).length);
  const values = { t1:sideMap.t1?.length || 0, t2:sideMap.t2?.length || 0, t3:sideMap.t3?.length || 0, surge:turnoverCount };
  Object.entries(values).forEach(([k,v]) => { const el=document.getElementById(`badge-${k}`); if(el) el.textContent=v; });
}

function syncScannerFilterUI() {
  document.querySelectorAll(".tab-btn[data-tab]").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === state.currentTab || (btn.classList.contains("radar-combined-tab") && ["all", "t1", "t2", "t3"].includes(state.currentTab))));
  const radarTab = document.querySelector(".radar-combined-tab");
  if (radarTab) {
    const tier = ["t1", "t2", "t3"].includes(state.currentTab) ? state.currentTab.toUpperCase() : "全部";
    radarTab.setAttribute("aria-label", `雷達：${tier}；單擊、快速雙擊圖示或長按兩秒選擇分級，右下角切換`);
    radarTab.title = `雷達：${tier}`;
    const label = radarTab.querySelector(".radar-tier-current");
    if (label) label.textContent = tier === "全部" ? "" : tier;
  }
  document.querySelectorAll("[data-radar-tier]").forEach(button => {
    button.setAttribute("aria-checked", String(button.dataset.radarTier === state.currentTab));
  });
  /* STEP 4.5 REGRESSION FIX START */
  document.getElementById("view-radar")?.classList.toggle("ox-filter-short", state.directionFilter === "short");
  /* STEP 4.5 REGRESSION FIX END */
  const toggle = document.getElementById("direction-toggle");
  if (toggle) {
    const isLong = state.directionFilter === "long";
    toggle.classList.toggle("is-long", isLong);
    toggle.classList.toggle("is-short", !isLong);
    toggle.setAttribute("aria-pressed", isLong ? "false" : "true");
    toggle.setAttribute("aria-label", isLong ? "目前多頭，點擊切換空頭" : "目前空頭，點擊切換多頭");
    toggle.title = isLong ? "目前：多頭模式；點擊切換空頭" : "目前：空頭模式；點擊切換多頭";
    const icon = toggle.querySelector(".direction-toggle-icon");
    const text = toggle.querySelector(".direction-toggle-text");
    if (icon) icon.textContent = isLong ? "↑" : "↓";
    if (text) text.textContent = isLong ? "多" : "空";
  }
  syncDirectionalBadges();
}

function persistScannerFilters() {
  try {
    localStorage.setItem("ox-scanner-tier-filter", state.currentTab);
    localStorage.setItem("ox-scanner-direction-filter", state.directionFilter);
  } catch (e) {}
  document.dispatchEvent(new CustomEvent("ox:filterchange", { detail: { tier: state.currentTab, direction: state.directionFilter } }));
}

function setScannerTierFilter(tab) {
  if (!["all","t1","t2","t3","surge","watch"].includes(tab)) return;
  state.currentTab = tab;
  persistScannerFilters();
  syncScannerFilterUI();
  renderCurrentTab();
}

function setScannerDirectionFilter(direction) {
  if (!["long","short"].includes(direction)) return;
  state.directionFilter = direction;
  persistScannerFilters();
  syncScannerFilterUI();
  renderCurrentTab();
}

function toggleScannerDirection() {
  setScannerDirectionFilter(state.directionFilter === "long" ? "short" : "long");
}

function passesDirectionFilter(side) {
  return String(side || "").toLowerCase() === state.directionFilter;
}

const periods = {
  "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
  "1H": 3600, "2H": 7200, "4H": 14400, "6H": 21600, "8H": 28800,
  "12H": 43200, "1D": 86400, "3D": 259200, "1W": 604800, "1M": 2592000
};

// Legacy calculation coercion: existing scoring code relies on missing → 0.
// Display code and new calculations must use toNumberOrNull instead.
const num = v => Number(v) || 0;
// Missing, blank, boolean or non-finite input is null, never a silent 0.
const toNumberOrNull = v => {
  if (v == null || typeof v === "boolean" || (typeof v === "string" && !v.trim())) return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};
const MISSING_VALUE_TEXT = "—";
// Shared HTML escaping for classic scripts that build markup from market data.
const escapeHtml = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtUsd = v => {
  const x = toNumberOrNull(v);
  return x === null ? MISSING_VALUE_TEXT : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(x);
};
const fmtCryptoVolume = v => {
  const value = toNumberOrNull(v);
  if (value === null) return MISSING_VALUE_TEXT;
  const format = (amount, digits = 2) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: digits }).format(amount);
  return value >= 1e8 ? `${format(value / 1e8)}億` : value >= 1e6 ? `${format(value / 1e4, 0)}萬` : value >= 1e4 ? `${format(value / 1e4, 1)}萬` : format(value);
};
// Turnover with its unit; a missing value is only "—", never "— USDT".
const fmtCryptoVolumeUSDT = v => {
  const text = fmtCryptoVolume(v);
  return text === MISSING_VALUE_TEXT ? text : `${text} USDT`;
};
const fmtPrice = v => {
  const x = toNumberOrNull(v);
  if (x === null || x === 0) return MISSING_VALUE_TEXT;
  const d = x >= 1000 ? 2 : x >= 1 ? 4 : x >= 0.01 ? 6 : 8;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(x);
};
// Engine reasons carry raw reference prices (calculations are untouched);
// show them with the same magnitude-based precision as quotes.
const fmtSignalReason = text => String(text ?? "").replace(/(歷史價格參考|近期轉折(?:，等待收 K)?) · (-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)(?![\d.])/g,
  (match, label, value) => `${label} · ${fmtPrice(value)}`);
const fmtPct = v => {
  const x = toNumberOrNull(v);
  return x === null ? MISSING_VALUE_TEXT : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
};


const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const benchmarkSymbols = new Set(["BTCUSDT", "ETHUSDT"]);

/* ===== BTC vs ALT Relative Strength 2.0 =====
   Relative leadership is intentionally separated from absolute market direction.
   All weights live here so future tuning never gets scattered through UI code. */
