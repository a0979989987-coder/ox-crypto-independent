const BTC_ALT_STRENGTH_CONFIG = Object.freeze({
  momentumWeights: { h1: 0.20, h4: 0.35, h24: 0.45 },
  scoreWeights: {
    absolute: 0.25,
    relativeMomentum: 0.30,
    breadth: 0.20,
    capitalConcentration: 0.15,
    participation: 0.10
  },
  liquidityFloor: CONFIG.liquidity.minUsdtVolume24h,
  leadershipSpread: 7,
  volumeShareScalePerPctPoint: 12,
  snapshotStorageKey: "ox-btc-alt-volume-share-snapshots",
  snapshotMinIntervalMs: 60_000,
  snapshotKeepMs: 4.5 * 60 * 60 * 1000
});

const median = values => {
  const a = values.map(Number).filter(Number.isFinite).sort((x,y)=>x-y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
};

function candleReturn(candles, barsBack) {
  if (!Array.isArray(candles) || candles.length < barsBack + 1) return 0;
  const last = num(candles[candles.length - 1]?.close);
  const prev = num(candles[candles.length - 1 - barsBack]?.close);
  return prev > 0 ? last / prev - 1 : 0;
}

function loadStrengthSnapshots() {
  try {
    const raw = JSON.parse(localStorage.getItem(BTC_ALT_STRENGTH_CONFIG.snapshotStorageKey) || "[]");
    return Array.isArray(raw) ? raw.filter(x => x && Number.isFinite(x.t) && Number.isFinite(x.share)) : [];
  } catch { return []; }
}
function saveStrengthSnapshots(rows) {
  try { localStorage.setItem(BTC_ALT_STRENGTH_CONFIG.snapshotStorageKey, JSON.stringify(rows)); } catch (e) {}
}
function captureStrengthSnapshot() {
  if (!state.btcTicker || !state.tickers?.length) return;
  const total = state.tickers.reduce((sum,t)=>sum+Math.max(0,num(t.usdtVolume)),0);
  const btcVol = Math.max(0,num(state.btcTicker.usdtVolume));
  if (!(total > 0 && btcVol > 0)) return;
  const now = Date.now();
  const share = btcVol / total * 100;
  let rows = loadStrengthSnapshots().filter(x => now - x.t <= BTC_ALT_STRENGTH_CONFIG.snapshotKeepMs);
  if (!rows.length || now - rows[rows.length-1].t >= BTC_ALT_STRENGTH_CONFIG.snapshotMinIntervalMs) {
    rows.push({ t: now, share });
    saveStrengthSnapshots(rows.slice(-300));
  }
}
function nearestSnapshotDelta(minutes) {
  const rows = loadStrengthSnapshots();
  if (!rows.length || !state.btcTicker || !state.tickers?.length) return null;
  const total = state.tickers.reduce((sum,t)=>sum+Math.max(0,num(t.usdtVolume)),0);
  const current = total > 0 ? Math.max(0,num(state.btcTicker.usdtVolume)) / total * 100 : 0;
  const target = Date.now() - minutes * 60_000;
  let best = null, distance = Infinity;
  for (const row of rows) {
    const d = Math.abs(row.t - target);
    if (d < distance) { distance = d; best = row; }
  }
  // Do not pretend we have a historical comparison if the nearest point is too far away.
  if (!best || distance > Math.max(3*60_000, minutes * 60_000 * .45)) return null;
  return current - best.share;
}

// 關鍵位顯示規則：1m / 5m / 15m 同時顯示 4H + 1D；1H / 4H / 1D / 1W 各顯示自身週期。
