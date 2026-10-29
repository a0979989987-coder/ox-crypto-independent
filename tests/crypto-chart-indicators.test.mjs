import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// indicators.js is a classic chart script; load it the way the page does, without a DOM.
const source = readFileSync(new URL('../src/components/chart/indicators.js', import.meta.url), 'utf8');
function load(stored = null) {
  const items = new Map(stored === null ? [] : [['ox-crypto:chart-indicators-v1', stored]]);
  const localStorage = { getItem: key => items.has(key) ? items.get(key) : null, setItem: (key, value) => items.set(key, String(value)) };
  const window = { localStorage, addEventListener() {} };
  // Same realm as the assertions, so arrays compare with deepStrictEqual.
  new Function('window', 'globalThis', source)(window, window);
  return { api: window.OXChartIndicators, items };
}
const { api } = load();
const { sma, ema, bollinger, kd, rsi, macd, INDICATORS } = api;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('moving average and EMA start once enough bars exist', () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const e = ema([1, 2, 3, 4, 5], 3);
  assert.deepEqual(e.slice(0, 2), [null, null]);
  close(e[2], 2); close(e[3], 3); close(e[4], 4);
  // Leading blanks (MACD's DIF) are skipped before the seed average.
  const blanks = ema([null, null, 1, 2, 3, 4], 3);
  assert.deepEqual(blanks.slice(0, 4), [null, null, null, null]);
  close(blanks[4], 2); close(blanks[5], 3);
});

test('Bollinger bands are the mean plus and minus k population standard deviations', () => {
  const b = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2).at(-1);
  close(b.mid, 5); close(b.up, 9); close(b.low, 1);
  assert.equal(bollinger([1, 2], 3, 2)[1], null);
});

test('Taiwan KD smooths RSV with 1/3 weights starting from 50', () => {
  const bars = [[10, 8, 9], [11, 9, 10], [12, 10, 11], [13, 11, 12]].map(([high, low, close]) => ({ high, low, close }));
  const r = kd(bars, 3, 3, 3);
  assert.equal(r[1], null);
  close(r[2].k, (2 * 50 + 75) / 3); close(r[2].d, (2 * 50 + r[2].k) / 3);
  close(r[3].k, (2 * r[2].k + 75) / 3); close(r[3].d, (2 * r[2].d + r[3].k) / 3);
  const flat = Array.from({ length: 12 }, () => ({ high: 10, low: 10, close: 10 }));
  const f = kd(flat, 9, 3, 3).at(-1); close(f.k, 50); close(f.d, 50);
});

test('Wilder RSI: hand-checked values, 100 on a steady rise, blank before n changes', () => {
  const r = rsi([1, 2, 1, 2], 2);
  assert.deepEqual(r.slice(0, 2), [null, null]);
  close(r[2], 50); close(r[3], 75);
  assert.equal(rsi([1, 2, 3, 4, 5, 6, 7, 8], 6).at(-1), 100);
  assert.equal(rsi([1, 2, 3], 6).at(-1), null);
});

test('MACD is zero for a constant price, positive in a steady rise, and OSC = DIF − MACD', () => {
  const flat = macd(Array(60).fill(50), 12, 26, 9).at(-1);
  close(flat.dif, 0); close(flat.osc, 0);
  const series = macd(Array.from({ length: 60 }, (_, i) => 50 + i + Math.sin(i)), 12, 26, 9);
  const rising = series.at(-1);
  assert.ok(rising.dif > 0 && rising.macd > 0);
  for (const point of series.filter(Boolean)) close(point.osc, point.dif - point.macd);
  // DIF needs 26 bars, its signal 9 more.
  assert.equal(series.findIndex(Boolean), 25 + 8);
});

test('the chart offers 均線, 布林, KD, RSI and MACD with the Taiwan default parameters', () => {
  assert.deepEqual(Object.keys(INDICATORS), ['ma', 'bb', 'kd', 'rsi', 'macd']);
  assert.deepEqual(INDICATORS.ma.params.map(p => p[1]), [5, 20, 60]);
  assert.deepEqual(INDICATORS.bb.params.map(p => p[1]), [20, 2]);
  assert.deepEqual(INDICATORS.kd.params.map(p => p[1]), [9, 3, 3]);
  assert.deepEqual(INDICATORS.rsi.params.map(p => p[1]), [6, 14]);
  assert.deepEqual(INDICATORS.macd.params.map(p => p[1]), [12, 26, 9]);
});

test('settings persist under one clearly named key; get/set keep only valid custom parameters', () => {
  const { api, items } = load();
  assert.equal(api.STORAGE_KEY, 'ox-crypto:chart-indicators-v1');
  assert.deepEqual(api.get(), { v: 1, on: { ma: false, bb: false, kd: false, rsi: false, macd: false }, params: {} });
  api.set({ on: { kd: true, macd: true }, params: { kd: [14, 3, 3], bb: [20, 2.5] } });
  const stored = JSON.parse(items.get(api.STORAGE_KEY));
  assert.deepEqual(stored.on, { ma: false, bb: false, kd: true, rsi: false, macd: true });
  assert.deepEqual(stored.params, { kd: [14, 3, 3], bb: [20, 2.5] });
  assert.deepEqual(api.paramsOf('kd'), [14, 3, 3]);
  assert.deepEqual(api.paramsOf('rsi'), [6, 14]);
  // Defaults are not stored; null resets; invalid lists are ignored.
  api.set({ params: { kd: null, macd: [12, 26, 9], rsi: [0, 14], ma: [5.5, 20, 60] } });
  assert.deepEqual(api.get().params, { bb: [20, 2.5] });
  assert.equal(api.get().on.kd, true);
});

test('stored settings are normalized when read: unknown ids, wrong lengths and bad numbers drop out', () => {
  const raw = JSON.stringify({ v: 1, on: { ma: true, rsi: 'yes', vwap: true }, params: { ma: [10, 30], macd: [8, 21, 5], bb: [20, 11], kd: [9, 3, 3] } });
  const { api } = load(raw);
  assert.deepEqual(api.get(), { v: 1, on: { ma: true, bb: false, kd: false, rsi: false, macd: false }, params: { macd: [8, 21, 5] } });
  assert.deepEqual(load('not json').api.get().on.ma, false);
});
