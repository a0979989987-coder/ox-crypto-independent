import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Charts already seen (or fetched by the radar scan) paint at once and refresh
// in place; only unseen charts show the skeleton.
const source = readFileSync(new URL('../src/components/chart/workspace.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('function chartErrorClock('), source.indexOf('async function loadMoreHistoricalCandles()'));

function harness({ peek = null, load }) {
  const overlay = { dataset: {}, innerHTML: '', classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } } };
  const rendered = [], fetched = [];
  const series = { setData() {}, update() {} };
  const state = { activeMarket: 'crypto', symbol: 'SOLUSDT', period: '1H', candleData: [], chartPriceScope: '', abortCtrl: null, chartLiveFeed: null,
    candleSeries: series, volumeSeries: series,
    chart: { priceScale: () => ({ applyOptions() {} }), timeScale: () => ({ getVisibleLogicalRange: () => ({ from: 0, to: 10 }) }) } };
  const context = {
    state, AbortController, setTimeout, clearTimeout, Event: class { constructor(type) { this.type = type; } },
    periods: { '1H': 3600, '4H': 14400, '15m': 900, '1D': 86400 },
    window: { matchMedia: () => ({ matches: true }) },
    document: { getElementById: id => id === 'chart-loading' ? overlay : null, querySelector: () => null, dispatchEvent() {}, hidden: false },
    BitgetAPI: { peekCandles: () => peek, fetchCandles: async (...args) => { fetched.push(args); return []; } },
    clearKeyLevelPriceLines() {}, updatePriceTimer() {}, updateQuickStats() {},
    updateCryptoLiveSeries(_s, _v, previous, incoming) { const map = new Map(previous.map(c => [c.time, c])); for (const c of incoming) map.set(c.time, c); return [...map.values()].sort((a, b) => a.time - b.time); },
    startChartLiveCandles() { const feed = { load }; state.chartLiveFeed = feed; return feed; },
    renderChartData(data, fit) { rendered.push({ times: data.map(c => c.time), fit }); state.chartPriceScope = `${state.symbol}:${state.period}`; }
  };
  context.globalThis = context;
  const api = runInNewContext(`${block}\n({loadSymbolCandles})`, context);
  return { ...api, state, overlay, rendered, fetched };
}
const bars = (...times) => times.map(time => ({ time, open: 1, high: 2, low: 1, close: 2, volume: 1 }));

test('a chart the radar scan already fetched paints before the network answers, then refreshes in place', async () => {
  let release;
  const h = harness({ peek: { candles: bars(1, 2, 3), serverTime: Date.now() }, load: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.loadSymbolCandles(true);
  assert.equal(h.rendered.length, 1, 'cached candles are painted synchronously');
  assert.equal(h.rendered[0].times.join(), '1,2,3');
  assert.equal(h.overlay.dataset.mode, 'refresh', 'only the thin refresh bar shows, no skeleton');
  release(bars(2, 3, 4));
  await pending;
  assert.equal(h.state.candleData.map(c => c.time).join(), '1,2,3,4', 'newer bars are merged in, older ones kept');
  assert.equal(h.rendered.at(-1).fit, false, 'the refresh does not refit the chart');
  assert.equal(h.overlay.classList.contains('show'), false);
});

test('an unseen chart shows the skeleton until its candles arrive', async () => {
  const h = harness({ load: async () => bars(5, 6) });
  const pending = h.loadSymbolCandles(true);
  assert.equal(h.rendered.length, 0);
  assert.equal(h.overlay.dataset.mode, 'empty');
  assert.match(h.overlay.innerHTML, /chart-skeleton/);
  assert.match(h.overlay.innerHTML, /SOL · 1H K 線載入中/);
  assert.doesNotMatch(h.overlay.innerHTML, /0\/1/, 'no request counter');
  await pending;
  assert.equal(h.rendered.length, 1);
  assert.equal(h.rendered[0].fit, true);
});

test('returning to a chart viewed moments ago is instant, without a network wait', async () => {
  let next = async () => bars(5, 6);
  const h = harness({ load: () => next() });
  await h.loadSymbolCandles(true);
  h.state.period = '4H';
  next = async () => bars(7, 8);
  await h.loadSymbolCandles(true);
  h.state.period = '1H';
  next = () => new Promise(() => {}); // the network never answers
  void h.loadSymbolCandles(true);
  assert.equal(h.rendered.at(-1).times.join(), '5,6', 'the 1H chart came back from memory at once');
  assert.equal(h.overlay.dataset.mode, 'refresh');
});
