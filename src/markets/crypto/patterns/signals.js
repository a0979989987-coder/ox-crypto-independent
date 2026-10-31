// 指標信號 and 量能放大 for the board's 篩選, read on each card's own candles (the
// timeframe the card shows, 4H／1H…). The indicators are the 盤面 chart's own
// (src/components/chart/indicators.js, window.OXChartIndicators) with the
// parameters the user set there. Only closed candles count: a forming 1W candle
// has neither its final volume nor its final close. A cross counts when it happened
// on one of the last three bars.
export const SIGNALS = Object.freeze([
  ['kd-cross', 'KD 黃金交叉'], ['kd-low', 'KD 低檔 <20'],
  ['macd-cross', 'MACD 黃金交叉'], ['macd-zero', 'MACD 上穿零軸'],
  ['rsi-low', 'RSI 超賣 <30'], ['rsi-high', 'RSI 強勢 >70'],
  ['ma-up', '站上中均線'], ['ma-bull', '均線多頭排列'],
  ['bb-up', '突破布林上軌'], ['bb-low', '觸及布林下軌'],
  ['cci-up', 'CCI 上穿 −100'], ['cci-high', 'CCI 強勢 >100']
].map(Object.freeze));
export const SIGNAL_IDS = Object.freeze(SIGNALS.map(([id]) => id));
// 量能放大 presets: the latest candle's volume ÷ the average of the five before it.
export const RATIO_PRESETS = Object.freeze([1.5, 2, 3]);
const RECENT = 3, MIN_BARS = 30;

const closedOnly = candles => (Array.isArray(candles) ? candles : []).filter(c => c && !c.provisional);
// True when a crossed above b on one of the last RECENT bars.
export function crossedUp(a, b, recent = RECENT) {
  for (let i = Math.max(1, a.length - recent); i < a.length; i++)
    if ([a[i], b[i], a[i - 1], b[i - 1]].every(Number.isFinite) && a[i - 1] <= b[i - 1] && a[i] > b[i]) return true;
  return false;
}

// lib: { sma, kd, rsi, macd, bollinger, cci, paramsOf(id) } — window.OXChartIndicators on the page.
export function signalsOf(candles, lib = globalThis.OXChartIndicators) {
  const bars = closedOnly(candles), out = new Set();
  if (!lib || bars.length < MIN_BARS) return out;
  const params = id => lib.paramsOf?.(id) || lib.INDICATORS?.[id]?.params.map(([, value]) => value) || [];
  const closes = bars.map(c => c.close), last = closes.length - 1;
  const k = lib.kd(bars, ...params('kd'));
  if (crossedUp(k.map(v => v?.k ?? null), k.map(v => v?.d ?? null))) out.add('kd-cross');
  if (k[last] && k[last].k < 20) out.add('kd-low');
  const m = lib.macd(closes, ...params('macd'));
  if (crossedUp(m.map(v => v?.dif ?? null), m.map(v => v?.macd ?? null))) out.add('macd-cross');
  if (crossedUp(m.map(v => v?.dif ?? null), m.map(() => 0))) out.add('macd-zero');
  // RSI reads its short period (6 by default), as the chart's first line.
  const r = lib.rsi(closes, params('rsi')[0]);
  if (Number.isFinite(r[last]) && r[last] < 30) out.add('rsi-low');
  if (Number.isFinite(r[last]) && r[last] > 70) out.add('rsi-high');
  const [short, mid, long] = params('ma').map(n => lib.sma(closes, n)[last]);
  if (Number.isFinite(mid) && closes[last] > mid) out.add('ma-up');
  if ([short, mid, long].every(Number.isFinite) && short > mid && mid > long) out.add('ma-bull');
  const b = lib.bollinger(closes, ...params('bb'))[last];
  if (b && closes[last] > b.up) out.add('bb-up');
  if (b && bars[last].low <= b.low) out.add('bb-low');
  if (typeof lib.cci === 'function' && (!lib.INDICATORS || lib.INDICATORS.cci)) {
    const c = lib.cci(bars, params('cci')[0]);
    if (crossedUp(c, c.map(() => -100))) out.add('cci-up');
    if (Number.isFinite(c[last]) && c[last] > 100) out.add('cci-high');
  }
  return out;
}

// 量能放大: the newest closed candle's USDT volume ÷ the average of the five closed
// candles before it; null without six closed candles or with no volume before.
export function volumeRatio(candles) {
  const bars = closedOnly(candles).slice(-6);
  if (bars.length < 6) return null;
  const amount = c => Number.isFinite(c.quoteVolume) ? c.quoteVolume : c.volume;
  const prior = bars.slice(0, 5).map(amount), latest = amount(bars[5]);
  if (!prior.every(Number.isFinite) || !Number.isFinite(latest)) return null;
  const avg = prior.reduce((s, v) => s + v, 0) / 5;
  return avg > 0 ? latest / avg : null;
}

// Per-series memo: one card's candles are read again for every redraw of the list.
const memo = new Map();
export function seriesFacts(key, candles, lib = globalThis.OXChartIndicators) {
  const bars = closedOnly(candles), tail = bars.at(-1);
  const settings = lib?.paramsOf ? Object.keys(lib.INDICATORS || {}).map(id => lib.paramsOf(id)?.join(',')).join('|') : '';
  const id = `${key}:${bars.length}:${tail?.time}:${tail?.close}:${settings}`;
  let facts = memo.get(id);
  if (!facts) {
    let signals = null;
    facts = { ratio: volumeRatio(bars), get signals() { return signals ??= signalsOf(bars, lib); } };
    memo.set(id, facts);
    if (memo.size > 2400) memo.delete(memo.keys().next().value);
  }
  return facts;
}

// Every checked 指標信號 must hold (AND), and the volume multiple must be reached.
export function passesSeriesFilter(filter, facts) {
  if (filter?.ratio > 0 && !(facts?.ratio >= filter.ratio)) return false;
  if (filter?.signals?.length) { const have = facts?.signals; if (!have || !filter.signals.every(id => have.has(id))) return false; }
  return true;
}
