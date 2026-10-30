// The crypto 對比 log: at every 4H close, the coins the pattern board lists as
// confirmed upward breakouts on the 4H chart, and how they closed afterwards
// against BTC. The 4H counterpart of the Taiwan daily log (scripts/tw-breakouts.mjs).
//   points  — one per recorded boundary `at` (Unix seconds; the close of the breakout
//             candle). Picks never change once recorded; later runs only append closes.
//   c[k]    — close of the k-th 4H candle after the breakout candle (c[0] = breakout candle)
//   pts     — the pattern as the board draws it: [candle open time, price]
//   btc     — BTCUSDT close at each boundary of the kept points, for the same spans
//   history — per-point summary, kept after the detail points are dropped; byTier and
//             byPattern hold totals that add up across points (n, s, w per period) for
//             the 型態 tab's 長期勝率. Older entries without them are simply not counted.
// Classification is the board's own code (prepareCandles → classifyPrepared →
// rankPatternMatches), run on exactly the candles that had closed at `at`.
import { parseCandles } from '../src/markets/crypto/patterns/source.js';
import { prepareCandles, classifyPrepared, rankPatternMatches } from '../src/markets/crypto/patterns/matcher.js';
import { TIMEFRAMES, candleBoundary, patternById } from '../src/markets/crypto/patterns/catalog.js';

export const FRAME = '4H', STEP = TIMEFRAMES[FRAME], KEEP_DETAIL = 42, PERIODS = [1, 6, 18], CATCH_UP = 6, BTC = 'BTCUSDT';
// The board asks Bitget for the latest 200 candles and drops the one still forming.
export const BOARD_CANDLES = 199;
export const METHOD = '突破 K 收盤 → 之後第 1／6／18 根 4 小時 K 收盤；BTC 為同期漲跌；未含手續費、資金費率與滑價；觀察池與成交額分級依執行當下 24H 成交額，延遲補記的時點可能與當時略有出入';
const MAX_PATH_POINTS = 12;

export const boundaryOf = ms => candleBoundary(ms, FRAME);

// Boundaries this run records, oldest first: every 4H close after the newest record,
// at most the last `limit`. The first run starts now — nothing is backfilled.
export function pendingBoundaries(log, latest, limit = CATCH_UP) {
  const last = log?.points?.at(-1)?.at;
  if (!Number.isFinite(last)) return [latest];
  const out = [];
  for (let at = latest; at > last && out.length < limit; at -= STEP) out.unshift(at);
  return out;
}

// The board's request for the newest boundary; an already passed boundary also needs
// the candles that had closed by it (history endTime = that close).
export function seriesPaths(symbol, pending) {
  const query = `symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&granularity=${FRAME}&limit=200`;
  const paths = { recent: `/api/v2/mix/market/candles?${query}`, history: null };
  if (pending.length > 1) paths.history = `/api/v2/mix/market/history-candles?${query}&endTime=${pending[0] * 1000}`;
  return paths;
}

// The 4H candles the board had at boundary `at`: the newest 199 that had closed by then,
// validated by the board's own parser. A candle opening at `at` or later never counts.
export function candlesAt(rows, at) {
  const byTime = new Map();
  for (const row of rows || []) {
    const time = Number(row?.[0]);
    if (Number.isFinite(time) && time < at * 1000) byTime.set(time, row);
  }
  const closed = [...byTime].sort((a, b) => a[0] - b[0]).slice(-BOARD_CANDLES).map(([, row]) => row);
  return parseCandles(closed, FRAME, at * 1000).slice(-200);
}

// The board's worker: one classification per symbol/timeframe.
export const classifyCandles = candles => classifyPrepared(prepareCandles(candles));

const sig = v => Number(v.toPrecision(6));
// Path patterns carry every close of their window; keep the ends, the lowest and highest
// close and then the closes farthest from the simplified line.
function simplify(points, max = MAX_PATH_POINTS) {
  const ys = points.map(p => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), tolerance = (hi - lo) * .005;
  const keep = [...new Set([0, ys.indexOf(lo), ys.indexOf(hi), points.length - 1])].sort((a, b) => a - b);
  while (keep.length < max) {
    let best = -1, worst = tolerance;
    for (let s = 0; s < keep.length - 1; s++) {
      const [a, b] = [keep[s], keep[s + 1]], [ta, ya] = points[a], [tb, yb] = points[b];
      for (let i = a + 1; i < b; i++) {
        const off = Math.abs(points[i][1] - (ya + (yb - ya) * (points[i][0] - ta) / (tb - ta)));
        if (off > worst) { worst = off; best = i; }
      }
    }
    if (best < 0) break;
    keep.push(best); keep.sort((x, y) => x - y);
  }
  return keep.map(i => points[i]);
}
function patternPoints(match, candles) {
  const points = (match.points || []).filter(q => candles[q.x] && Number.isFinite(q.y)).map(q => [candles[q.x].time, q.y]);
  return (points.length > MAX_PATH_POINTS ? simplify(points) : points).map(([time, y]) => [time, sig(y)]);
}

// One pick per coin: its best confirmed upward breakout, ranked and tiered exactly as
// the board ranks a card (crypto 24H turnover grade, then tier and similarity).
// entries: [{ symbol, turnover, candles, matches }] for one boundary.
export function breakoutPicks(entries) {
  const found = [];
  for (const e of entries) {
    const entry = { key: e.symbol + ':' + FRAME, data: { symbol: e.symbol, frame: FRAME, source: 'Bitget', turnover: e.turnover, candles: e.candles } };
    for (const [id, match] of Object.entries(e.matches || {}))
      if (match?.side === 'LONG' && /確認突破/.test(match.stage || '')) found.push({ entry, match: { ...match, id } });
  }
  return rankPatternMatches(found).map(({ entry, match }) => {
    const candles = entry.data.candles;
    return { s: entry.data.symbol, p: match.id, t: match.tier, st: match.stage, pts: patternPoints(match, candles), c: [candles.at(-1).close] };
  }).sort((a, b) => a.t - b.t || a.s.localeCompare(b.s));
}

// One boundary of the scan. coins: [{ symbol, turnover, rows }], rows null when the
// request failed. `stale` counts series that lack the candle closing at `at`.
export function scanPoint(at, coins, { pool = coins.length, classify = classifyCandles } = {}) {
  const entries = [];
  let failed = 0, stale = 0;
  for (const coin of coins) {
    if (!coin.rows) { failed++; continue; }
    const candles = candlesAt(coin.rows, at);
    if (candles.length < 35) {
      const before = coin.rows.map(r => Number(r[0])).filter(t => t < at * 1000);
      if (before.length && Math.max(...before) < (at - STEP) * 1000) stale++;
      continue;
    }
    entries.push({ symbol: coin.symbol, turnover: coin.turnover, candles, matches: classify(candles) });
  }
  return { point: { at, pool, scanned: entries.length, picks: breakoutPicks(entries) }, failed, stale };
}

// closeOf(symbol, t): close of the candle that closed at boundary t, from candles that
// had closed by `latest` (a forming candle never supplies a close).
export function closeIndex(rowsBySymbol, latest) {
  const closes = new Map();
  for (const [symbol, rows] of rowsBySymbol) {
    const map = new Map();
    for (const row of rows || []) {
      const end = Number(row?.[0]) / 1000 + STEP, close = Number(row?.[4]);
      if (Number.isFinite(end) && end <= latest && close > 0) map.set(end, close);
    }
    closes.set(symbol, map);
  }
  return (symbol, t) => closes.get(symbol)?.get(t);
}

// Appends the closes that have become available; recorded closes are never changed.
export function fillCloses(point, closeOf, latest) {
  for (const pick of point.picks) {
    const c = Array.isArray(pick.c) ? pick.c : (pick.c = []);
    for (let k = c.length; k <= PERIODS.at(-1); k++) {
      const t = point.at + k * STEP, v = t <= latest ? closeOf(pick.s, t) : undefined;
      if (!Number.isFinite(v)) break;
      c.push(v);
    }
  }
  return point;
}

const mean = list => list.reduce((s, v) => s + v, 0) / list.length;
const round = v => Math.round(v * 100) / 100;
// Average return, share of rising picks and BTC over the same span.
export function periodStats(picks, k, btcFrom, btcTo) {
  const r = picks.filter(p => Number.isFinite(p.c?.[k]) && p.c[0] > 0).map(p => (p.c[k] / p.c[0] - 1) * 100);
  if (!r.length) return null;
  return { n: r.length, avg: round(mean(r)), win: Math.round(r.filter(v => v > 0).length / r.length * 100),
    btc: btcFrom > 0 && btcTo > 0 ? round((btcTo / btcFrom - 1) * 100) : null };
}
// Totals that add up across records for the long-run 勝率: per period k, the number
// of picks with a close (n), their summed return in % (s) and how many rose (w).
export function periodTotals(picks) {
  return Object.fromEntries(PERIODS.flatMap(k => {
    const r = picks.filter(p => Number.isFinite(p.c?.[k]) && p.c[0] > 0).map(p => (p.c[k] / p.c[0] - 1) * 100);
    return r.length ? [['n' + k, r.length], ['s' + k, round(r.reduce((s, v) => s + v, 0))], ['w' + k, r.filter(v => v > 0).length]] : [];
  }));
}
export function pointSummary(point, btc) {
  const out = { at: point.at, n: point.picks.length };
  for (const k of PERIODS) out['k' + k] = periodStats(point.picks, k, btc[point.at], btc[point.at + k * STEP]);
  out.tiers = Object.fromEntries([1, 2, 3].map(t => [t, point.picks.filter(p => p.t === t)]).filter(([, list]) => list.length)
    .map(([t, list]) => [t, { n: list.length, ...Object.fromEntries(PERIODS.map(k => ['k' + k, periodStats(list, k)?.avg ?? null])) }]));
  // byTier / byPattern: the same picks' totals, kept in the history after the point
  // leaves the detail, so 長期勝率 covers every recorded close. Present once a close is in.
  const byTier = Object.fromEntries([1, 2, 3].map(t => [t, periodTotals(point.picks.filter(p => p.t === t))]).filter(([, v]) => v['n' + PERIODS[0]]));
  const byPattern = Object.fromEntries([...new Set(point.picks.map(p => p.p))].map(id => [id, periodTotals(point.picks.filter(p => p.p === id))]).filter(([, v]) => v['n' + PERIODS[0]]));
  if (Object.keys(byTier).length) out.byTier = byTier;
  if (Object.keys(byPattern).length) out.byPattern = byPattern;
  return out;
}

// Appends the new boundaries and fills closes. Returns null when nothing is newer than
// the log: an old or repeated run never rewrites what is already recorded.
export function updateLog(log, { points = [], closeOf, now = new Date().toISOString() }) {
  const recorded = structuredClone(log?.points || []), last = recorded.at(-1)?.at ?? -Infinity;
  const fresh = points.filter(p => p.at > last).sort((a, b) => a.at - b.at)
    .filter((p, i, list) => !i || p.at > list[i - 1].at).map(p => structuredClone(p));
  if (!fresh.length) return null;
  const all = [...recorded, ...fresh], latest = all.at(-1).at, btc = { ...(log?.btc || {}) };
  for (const point of all) fillCloses(point, closeOf, latest);
  for (let t = all[0].at; t <= latest; t += STEP) {
    const v = Number.isFinite(btc[t]) ? btc[t] : closeOf(BTC, t);
    if (Number.isFinite(v)) btc[t] = v;
  }
  const history = new Map((log?.history || []).map(h => [h.at, h]));
  for (const point of all) history.set(point.at, pointSummary(point, btc));
  const kept = all.slice(-KEEP_DETAIL), first = kept[0].at;
  return { version: 1, updatedAt: now, frame: FRAME, step: STEP, periods: PERIODS, at: latest, method: METHOD,
    btc: Object.fromEntries(Object.entries(btc).filter(([t]) => Number(t) >= first).sort((a, b) => a[0] - b[0])),
    points: kept, history: [...history.values()].sort((a, b) => a.at - b.at) };
}
