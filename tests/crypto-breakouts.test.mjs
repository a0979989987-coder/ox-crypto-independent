import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CLASSIC_VERSION } from '../src/core/classic.js';
import { rankPatternMatches, sortMatches } from '../src/markets/crypto/patterns/matcher.js';
import { BOARD_CANDLES, CATCH_UP, KEEP_DETAIL, STEP, breakoutPicks, candlesAt, classifyCandles, closeIndex, pendingBoundaries, scanPoint, seriesPaths, updateLog } from '../scripts/crypto-breakouts.mjs';

const L = 1793174400; // 2026-10-28 08:00 UTC, a 4H boundary
const bar = (time, close, extra = {}) => ({ time, open: close, high: close * 1.01, low: close * .99, close, volume: 100, quoteVolume: close * 100, ...extra });
const candles = Array.from({ length: 40 }, (_, i) => bar(L - (40 - i) * STEP, 10 + i / 10));
const signal = (tier, qualityScore) => ({ version: CLASSIC_VERSION, eligible: true, side: 'LONG', tier, qualityScore, phase: 'breakout', stage: '已收 K 確認突破', priority: 1 });
const match = (extra = {}) => ({ side: 'LONG', stage: '已收 K 確認突破', tier: 1, similarity: 80, points: [{ x: 0, y: 10 }, { x: 39, y: 10 }], classicSignal: signal('T1', 90), ...extra });
const coin = (symbol, turnover, matches) => ({ symbol, turnover, candles, matches });

test('one confirmed upward breakout per coin, tiered by the board\'s crypto turnover grade', () => {
  const picks = breakoutPicks([
    coin('AAAUSDT', 5e7, { w: match(), 'horizontal-resistance': match({ similarity: 95 }), m: match({ side: 'SHORT', similarity: 99 }) }),
    coin('BBBUSDT', 1e6, { 'gartley-bull': match({ similarity: 75 }) }),         // T1 capped at 79 → T2
    coin('CCCUSDT', 1e5, { cup: match() }),                                       // unknown-size money → T3
    coin('DDDUSDT', 5e7, { w: match({ stage: '帶量逼近 · 尚未突破' }), triangle: match({ stage: '型態形成 · 尚待量價確認', tier: 3 }), m: match({ side: 'SHORT' }) }),
    coin('EEEUSDT', 5e7, { 'horizontal-resistance': match({ tier: 3, similarity: 99, classicSignal: signal('T3', 65) }), w: match({ tier: 2, similarity: 70, classicSignal: signal('T2', 77) }) }),
  ]);
  assert.deepEqual(picks.map(p => [p.s, p.p, p.t]), [['AAAUSDT', 'horizontal-resistance', 1], ['BBBUSDT', 'gartley-bull', 2], ['EEEUSDT', 'w', 2], ['CCCUSDT', 'cup', 3]]);
  assert.equal(picks[0].st, '已收 K 確認突破');
  assert.deepEqual(picks[0].pts, [[candles[0].time, 10], [candles[39].time, 10]]);
  assert.deepEqual(picks[0].c, [candles.at(-1).close]);
});

test('path patterns keep their turning points, not every close', () => {
  const closes = candles.map((c, i) => 10 + ((i - 20) / 10) ** 2);
  const [pick] = breakoutPicks([coin('UUUUSDT', 5e7, { 'round-bottom': match({ points: closes.map((y, x) => ({ x, y })) }) })]);
  assert.ok(pick.pts.length <= 12 && pick.pts.length >= 3);
  assert.deepEqual(pick.pts[0], [candles[0].time, 14]);
  assert.deepEqual(pick.pts.at(-1), [candles[39].time, 13.61]);
  assert.ok(pick.pts.some(([time, y]) => time === candles[20].time && y === 10), 'the bottom survives');
});

// Bitget rows: [open ms, open, high, low, close, volume, quote volume] as strings.
const row = (time, close) => [String(time * 1000), String(close), String(close * 1.01), String(close * .99), String(close), '100', String(close * 100)];
const series = (from, to, price = t => 100 + ((t / STEP) % 17)) => { const out = []; for (let t = from; t <= to; t += STEP) out.push(row(t, price(t))); return out; };

test('a late run sees exactly the candles that had closed at the boundary', () => {
  // On time: the board's limit-200 request at L, 199 closed candles plus the one forming at L.
  const onTime = [...series(L - 199 * STEP, L - STEP), row(L, 999)];
  // Late: history candles that run past L, including candles opened at and after it.
  const late = series(L - 230 * STEP, L + 9 * STEP);
  const a = candlesAt(onTime, L), b = candlesAt(late, L);
  assert.equal(a.length, BOARD_CANDLES);
  assert.deepEqual(a, b);
  assert.equal(b.at(-1).time, L - STEP);
  assert.ok(b.every(c => c.time < L && !c.provisional));
  assert.equal(candlesAt(late, L + STEP).at(-1).time, L);
  // Only the newest uninterrupted run counts, as on the board; a missing close is never invented.
  const gap = late.filter(r => Number(r[0]) !== (L - 50 * STEP) * 1000);
  assert.equal(candlesAt(gap, L)[0].time, L - 49 * STEP);
  assert.deepEqual(candlesAt(series(L - 100 * STEP, L - 3 * STEP), L), []);
});

test('catch-up covers the missed closes, at most the last six, and never backfills a first run', () => {
  assert.deepEqual(pendingBoundaries(null, L), [L]);
  assert.deepEqual(pendingBoundaries({ points: [{ at: L }] }, L), []);
  assert.deepEqual(pendingBoundaries({ points: [{ at: L + STEP }] }, L), []);
  assert.deepEqual(pendingBoundaries({ points: [{ at: L - 3 * STEP }] }, L), [L - 2 * STEP, L - STEP, L]);
  assert.deepEqual(pendingBoundaries({ points: [{ at: L - 20 * STEP }] }, L), Array.from({ length: CATCH_UP }, (_, i) => L - (CATCH_UP - 1 - i) * STEP));
  assert.deepEqual(seriesPaths('BTCUSDT', [L]), { recent: '/api/v2/mix/market/candles?symbol=BTCUSDT&productType=USDT-FUTURES&granularity=4H&limit=200', history: null });
  assert.equal(seriesPaths('BTCUSDT', [L - 2 * STEP, L - STEP, L]).history,
    `/api/v2/mix/market/history-candles?symbol=BTCUSDT&productType=USDT-FUTURES&granularity=4H&limit=200&endTime=${(L - 2 * STEP) * 1000}`);

  // One run records three closes from the same rows; each sees only its own closed candles.
  const pending = [L - 2 * STEP, L - STEP, L], recent = [...series(L - 199 * STEP, L - STEP), row(L, 999)];
  const history = series(L - 202 * STEP, L - 3 * STEP), rows = [...history, ...recent], seen = [];
  const classify = list => { seen.push([list.length, list.at(-1).time]); return {}; };
  const coins = [{ symbol: 'AAAUSDT', turnover: 5e7, rows }, { symbol: 'BADUSDT', turnover: 5e7, rows: null },
    { symbol: 'OLDUSDT', turnover: 5e7, rows: series(L - 100 * STEP, L - 9 * STEP) }, { symbol: 'NEWUSDT', turnover: 5e7, rows: series(L - 10 * STEP, L - STEP) }];
  const scans = pending.map(at => scanPoint(at, coins, { classify }));
  assert.deepEqual(seen, pending.map(at => [BOARD_CANDLES, at - STEP]));
  assert.deepEqual(scans.map(s => [s.point.at, s.point.pool, s.point.scanned, s.failed, s.stale]), pending.map(at => [at, 4, 1, 1, 1]));
  // The board's limit-200 request at L equals the candles rebuilt from history for L.
  assert.deepEqual(candlesAt(recent, L), candlesAt(rows, L));
});

const pick = (s, t, c) => ({ s, p: 'w', t, st: '已收 K 確認突破', pts: [], c });
const point = (at, picks = []) => ({ at, pool: 3, scanned: 3, picks });

test('recorded picks are never rewritten; later runs only append closes', () => {
  const first = { A: 10, B: 20, BTCUSDT: 100 }, closeA = (s, t) => t === L ? first[s] : undefined;
  let log = updateLog(null, { points: [point(L, [pick('A', 1, [10])])], closeOf: closeA, now: 'x' });
  assert.deepEqual(log.points[0].picks[0].c, [10]);
  const before = structuredClone(log);
  // A later run disagrees about everything already recorded and re-scans L with other picks.
  const later = (s, t) => ({ A: 50, B: 60, BTCUSDT: 500 })[s] + (t - L) / STEP;
  const next = updateLog(log, { points: [point(L, [pick('B', 3, [99])]), point(L + STEP, [pick('B', 2, [20])])], closeOf: later, now: 'y' });
  assert.deepEqual(log, before, 'the input log is not mutated');
  assert.deepEqual(next.points.map(p => [p.at, p.picks.map(x => [x.s, x.t])]), [[L, [['A', 1]]], [L + STEP, [['B', 2]]]]);
  assert.deepEqual(next.points[0].picks[0].c, [10, 51]);
  assert.deepEqual(next.points[1].picks[0].c, [20]);
  assert.equal(next.btc[L], 100);
  assert.equal(next.btc[L + STEP], 501);
  // A repeated or older run finds nothing newer and leaves the log alone.
  assert.equal(updateLog(next, { points: [point(L + STEP, [])], closeOf: later }), null);
  assert.equal(updateLog(next, { points: [point(L, [])], closeOf: later }), null);
  assert.equal(updateLog(next, { points: [], closeOf: later }), null);
});

test('closes after 1, 6 and 18 4H candles, summarised against BTC', () => {
  const path = { A: k => 10 * (1 + k / 100), B: k => 20 * (1 - k / 200), BTCUSDT: k => 100 + k };
  const closeOf = (s, t) => path[s]?.((t - L) / STEP);
  let log = updateLog(null, { points: [point(L, [pick('A', 1), pick('B', 2)])], closeOf, now: 'x' });
  assert.deepEqual(log.points[0].picks.map(p => p.c), [[10], [20]]);
  assert.deepEqual(log.history[0], { at: L, n: 2, k1: null, k6: null, k18: null, tiers: { 1: { n: 1, k1: null, k6: null, k18: null }, 2: { n: 1, k1: null, k6: null, k18: null } } });
  log = updateLog(log, { points: [point(L + 6 * STEP)], closeOf, now: 'x' });
  const [h] = log.history;
  assert.deepEqual(h.k1, { n: 2, avg: .25, win: 50, btc: 1 });        // A +1%, B −0.5%; BTC 100 → 101
  assert.deepEqual(h.k6, { n: 2, avg: 1.5, win: 50, btc: 6 });        // A +6%, B −3%
  assert.equal(h.k18, null);
  log = updateLog(log, { points: [point(L + 18 * STEP)], closeOf, now: 'x' });
  assert.equal(log.points[0].picks[0].c.length, 19);
  assert.deepEqual(log.history[0].k18, { n: 2, avg: 4.5, win: 50, btc: 18 });
  assert.deepEqual(log.history[0].tiers, { 1: { n: 1, k1: 1, k6: 6, k18: 18 }, 2: { n: 1, k1: -.5, k6: -3, k18: -9 } });
  assert.equal(log.history[1].n, 0);
  assert.equal(log.history[1].k1, null);
});

test('a missing close ends the series instead of skipping a candle', () => {
  const closeOf = (s, t) => (t - L) / STEP === 3 && s === 'A' ? undefined : 10 + (t - L) / STEP;
  const log = updateLog(null, { points: [point(L, [pick('A', 1), pick('B', 1)])], closeOf, now: 'x' });
  const next = updateLog(log, { points: [point(L + 8 * STEP)], closeOf, now: 'x' });
  assert.deepEqual(next.points[0].picks[0].c, [10, 11, 12]);
  assert.equal(next.points[0].picks[1].c.length, 9);
  assert.equal(next.history[0].k6.n, 1);
  // closeIndex never takes a close from a candle still forming at the newest boundary.
  const closes = closeIndex(new Map([['A', [row(L - STEP, 7), row(L, 8)]]]), L);
  assert.equal(closes('A', L), 7);
  assert.equal(closes('A', L + STEP), undefined);
});

test('old points leave the detail but stay in the history', () => {
  const total = KEEP_DETAIL + 3, closeOf = (s, t) => s === 'BTCUSDT' ? 100 + (t - L) / STEP : 10;
  let log = null;
  for (let i = 0; i < total; i++) log = updateLog(log, { points: [point(L + i * STEP, [pick('A', 1)])], closeOf, now: 'x' });
  assert.equal(log.points.length, KEEP_DETAIL);
  assert.equal(log.history.length, total);
  assert.equal(log.points[0].at, L + 3 * STEP);
  assert.equal(log.at, L + (total - 1) * STEP);
  assert.ok(Object.keys(log.btc).every(t => Number(t) >= L + 3 * STEP));
  assert.equal(Object.keys(log.btc).length, KEEP_DETAIL);
  assert.deepEqual(log.history[0].k18, { n: 1, avg: 0, win: 0, btc: 18 });
  assert.deepEqual(log.points[0].picks[0].c.length, 19);
  assert.deepEqual(log.points.at(-1).picks[0].c, [10]);
});

// Real Bitget 4H responses from the test fixtures, replayed at earlier closes.
const fixtureCoins = new Map();
for (const name of readdirSync(new URL('./fixtures/', import.meta.url)).filter(f => f.startsWith('crypto-'))) {
  const json = JSON.parse(readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
  const turnover = new Map((json.tickers?.data || []).map(t => [t.symbol, Number(t.usdtVolume)]));
  for (const [symbol, responses] of Object.entries(json.responses?.['4H'] ? { [json.symbol]: json.responses } : json.responses || {}))
    if (responses['4H'] && !fixtureCoins.has(symbol)) fixtureCoins.set(symbol, { rows: responses['4H'].data, time: Number(responses['4H'].requestTime), turnover: turnover.get(symbol) ?? 5e6 });
}

test('real candles: each pick is the coin\'s best card on the board, unchanged by a late run', () => {
  let found = 0;
  for (const [symbol, { rows, time, turnover }] of fixtureCoins) {
    const newest = Math.floor(time / 1000 / STEP) * STEP, future = series(newest, newest + 4 * STEP, () => 1);
    for (let k = 0; k <= 48; k += 3) {
      const at = newest - k * STEP, list = candlesAt(rows, at);
      if (list.length < 35) break;
      assert.deepEqual(candlesAt([...rows, ...future], at), list);
      const matches = classifyCandles(list), [p] = breakoutPicks([{ symbol, turnover, candles: list, matches }]);
      const entry = { key: symbol + ':4H', data: { symbol, frame: '4H', source: 'Bitget', turnover, candles: list }, matches };
      // The board's pattern view: every confirmed upward breakout card of this coin, best first.
      const cards = sortMatches(Object.entries(matches).filter(([, m]) => m.side === 'LONG' && /確認突破/.test(m.stage))
        .flatMap(([id, m]) => rankPatternMatches([{ entry, match: { ...m, id } }]).map(r => ({ id, tier: r.match.tier, similarity: r.similarity }))
          .map(r => ({ ...r, displayTier: r.tier }))));
      if (!cards.length) { assert.equal(p, undefined); continue; }
      found++;
      assert.equal(p.p, cards[0].id);
      assert.equal(p.t, cards[0].tier);
      assert.match(p.st, /確認突破/);
      assert.deepEqual(p.c, [list.at(-1).close]);
      assert.ok(p.pts.length >= 2 && p.pts.every(([t]) => list.some(c => c.time === t)));
    }
  }
  assert.ok(found > 0, 'the fixtures contain confirmed breakouts');
});
