import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// 雷達成績單：進榜自動記錄，之後用 1H K 線判定先碰到目標或停損。
const store = new Map();
const context = { Date, Math, JSON, Number, String, Set, Map, Object, Array, Promise, setTimeout, clearTimeout,
  localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } };
context.globalThis = context;
runInNewContext(readFileSync(new URL('../src/markets/crypto/radar-report.js', import.meta.url), 'utf8'), context);
const R = context.OXRadarReport;
const HOUR = 3600000, T0 = Date.UTC(2026, 9, 1, 10, 20);
const row = (symbol, extra = {}) => ({ symbol, at: T0, lastPrice: 100, radarSide: { listed: true, score: 70, stop: 95, target: { level: 110 }, elements: { rr: 2 }, pathway: { group: '壓力突破' }, frame: '4H', ...extra } });
const lists = (long = {}, short = {}) => ({ long: { t1: [], t2: [], t3: [], ...long }, short: { t1: [], t2: [], t3: [], ...short } });
const bars = (from, rows) => rows.map(([high, low, close], i) => ({ time: (from + i * HOUR) / 1000, open: close, high, low, close }));

test('a coin is recorded once while it stays listed; its best tier is kept', () => {
  R._reset([]);
  R.record(lists({ t3: [row('AAAUSDT')] }), { now: T0 });
  R.record(lists({ t1: [{ ...row('AAAUSDT'), at: T0 + HOUR }] }), { now: T0 + HOUR });
  const list = R.entries();
  assert.equal(list.length, 1);
  assert.equal(list[0].tier, 't3');
  assert.equal(list[0].bestTier, 't1');
  assert.equal(list[0].price, 100);
  assert.equal(list[0].stop, 95);
  assert.equal(list[0].target, 110);
});

test('a coin coming back after more than 6 hours off the list is a new signal; stale analyses are ignored', () => {
  R._reset([]);
  R.record(lists({ t2: [row('AAAUSDT')] }), { now: T0 });
  R.record(lists({ t2: [{ ...row('AAAUSDT'), at: T0 + 7 * HOUR }] }), { now: T0 + 7 * HOUR });
  assert.equal(R.entries().length, 2);
  R.record(lists({ t2: [{ ...row('BBBUSDT'), at: T0 }] }), { now: T0 + 2 * HOUR });
  assert.equal(R.entries().some(e => e.symbol === 'BBBUSDT'), false, 'an analysis from 2 hours ago (restored snapshot) is not a new signal');
});

test('judging starts on the next 1H bar; target, stop, both-in-one-bar and expiry', () => {
  const entry = { side: 'long', firstAt: T0, price: 100, stop: 95, target: 110 };
  const start = Math.floor(T0 / HOUR) * HOUR;
  // 進榜那一根（10:00）碰到 111 不算；下一根起才判定。
  const win = R.judge(entry, bars(start, [[111, 99, 100], [104, 98, 103], [110.5, 102, 109]]), T0 + 5 * HOUR);
  assert.deepEqual([win.status, Math.round(win.mfe * 1000) / 1000, Math.round(win.mae * 1000) / 1000, win.r], ['target', 0.105, 0.02, 2]);
  const loss = R.judge(entry, bars(start, [[100, 99, 100], [101, 94.5, 95]]), T0 + 5 * HOUR);
  assert.deepEqual([loss.status, loss.r], ['stop', -1]);
  const both = R.judge(entry, bars(start, [[100, 99, 100], [111, 94, 100]]), T0 + 5 * HOUR);
  assert.equal(both.status, 'stop', 'both sides in one bar count as a stop');
  const flat = R.judge(entry, bars(start, Array.from({ length: 200 }, () => [102, 98, 101])), T0 + 8 * 86400000);
  assert.equal(flat.status, 'expired');
  assert.equal(Math.round(flat.ret * 1000) / 1000, 0.01);
  const short = R.judge({ side: 'short', firstAt: T0, price: 100, stop: 105, target: 90 }, bars(start, [[100, 99, 100], [101, 89, 90]]), T0 + 5 * HOUR);
  assert.deepEqual([short.status, short.r], ['target', 2]);
});

test('the summary gives hit rate and expectancy per tier', () => {
  const judged = (tier, status, r) => ({ symbol: tier + status + r, side: 'long', tier, bestTier: tier, firstAt: T0, lastSeen: T0, price: 100, outcome: { status, r, mfe: .05, mae: .02, evaluatedAt: T0 } });
  R._reset([judged('t1', 'target', 2), judged('t1', 'stop', -1), judged('t2', 'stop', -1), judged('t2', 'open', null)]);
  const s = R.summary({ side: 'long', days: 7, now: T0 + HOUR });
  const t1 = s.rows.find(r => r.tier === 't1'), t2 = s.rows.find(r => r.tier === 't2'), all = s.rows.find(r => r.tier === 'all');
  assert.deepEqual([t1.count, t1.judged, t1.wins, t1.stops, t1.hitRate, t1.expectancy], [2, 2, 1, 1, 0.5, 0.5]);
  assert.deepEqual([t2.count, t2.judged, t2.hitRate], [2, 1, 0]);
  assert.equal(all.count, 4);
});

test('evaluate fetches each symbol once and stores outcomes', async () => {
  R._reset([]);
  R.record(lists({ t1: [row('AAAUSDT')], t2: [row('BBBUSDT')] }), { now: T0 });
  const calls = [];
  const start = Math.floor(T0 / HOUR) * HOUR;
  const fetchCandles = async symbol => { calls.push(symbol); return bars(start, [[100, 99, 100], [111, 99, 110]]); };
  const n = await R.evaluate({ now: T0 + 3 * HOUR, fetchCandles });
  assert.equal(n, 2);
  assert.deepEqual([...calls].sort(), ['AAAUSDT', 'BBBUSDT']);
  assert.equal(R.entries().every(e => e.outcome.status === 'target'), true);
});
