import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/components/chart/workspace.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('function chartErrorClock('), source.indexOf('async function loadMoreHistoricalCandles()'));

function element(tag = 'div') {
  const listeners = {};
  const node = {
    tagName: tag.toUpperCase(), id: '', className: '', hidden: false, disabled: false, dataset: {}, children: [], attributes: {},
    _text: '',
    get textContent() { return this.children.length ? this.children.map(c => c.textContent).join(' ') : this._text; },
    set textContent(value) { this._text = String(value); this.children = []; },
    set innerHTML(value) { this._text = String(value); this.children = []; },
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    append(...nodes) { for (const child of nodes) { child.parent = this; this.children.push(child); registry(child); } },
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    click() { for (const fn of listeners.click || []) fn({}); },
    querySelector(selector) { return find(this, n => selector.startsWith('.') ? n.className === selector.slice(1) : n.tagName === selector.toUpperCase()); }
  };
  return node;
}
const ids = new Map();
function registry(node) { if (node.id) ids.set(node.id, node); }
function find(root, predicate) { for (const child of root.children) { if (predicate(child)) return child; const nested = find(child, predicate); if (nested) return nested; } return null; }

function harness({ load }) {
  ids.clear();
  const chart = element(); chart.id = 'chart'; ids.set('chart', chart);
  const overlay = element(); overlay.id = 'chart-loading'; ids.set('chart-loading', overlay);
  const rendered = [];
  const state = { activeMarket: 'crypto', symbol: 'BTCUSDT', period: '1H', candleData: [], chartPriceScope: '', abortCtrl: null, chartLiveFeed: null };
  const series = { setData() {} };
  Object.assign(state, { candleSeries: series, volumeSeries: series, chart: { priceScale: () => ({ applyOptions() {} }) } });
  const context = {
    state, AbortController, Event: class { constructor(type) { this.type = type; } },
    window: { matchMedia: () => ({ matches: true }), OXLoading: null },
    document: {
      getElementById: id => ids.get(id) || null,
      createElement: tag => element(tag),
      querySelector: () => null,
      dispatchEvent() {}
    },
    clearKeyLevelPriceLines() {},
    startChartLiveCandles() { const feed = { load }; state.chartLiveFeed = feed; return feed; },
    renderChartData(data) { rendered.push(data); state.chartPriceScope = `${state.symbol}:${state.period}`; }
  };
  const api = runInNewContext(`${block}\n({loadSymbolCandles, showChartLoadError, clearChartLoadError})`, context);
  return { ...api, state, chart, rendered, error: () => ids.get('chart-load-error') };
}

test('a failed first K-line load shows a visible retry state instead of an empty chart', async () => {
  let calls = 0;
  const h = harness({ load: async () => { calls++; if (calls === 1) throw new Error('HTTP 503'); return [{ time: 1, close: 2 }]; } });
  await h.loadSymbolCandles(true);
  const error = h.error();
  assert.ok(error, 'error state is mounted in the chart region');
  assert.equal(error.hidden, false);
  assert.equal(error.dataset.mode, 'empty');
  assert.equal(error.attributes.role, 'alert');
  assert.match(error.textContent, /BTC 1H K 線載入失敗/);
  assert.match(error.textContent, /HTTP 503/);
  const retry = error.querySelector('.chart-load-error-retry');
  assert.equal(retry.textContent, '重試');
  retry.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 2, 'retry reloads the same chart');
  assert.equal(h.error().hidden, true, 'successful retry clears the error');
  assert.equal(h.rendered.length, 1);
});

test('refresh failure keeps the old chart but marks it stale with the failure time', async () => {
  let fail = false;
  const h = harness({ load: async () => { if (fail) throw new Error('timeout'); return [{ time: 1, close: 2 }]; } });
  await h.loadSymbolCandles(true);
  const previous = h.state.candleData;
  fail = true;
  await h.loadSymbolCandles(true);
  assert.equal(h.state.candleData, previous, 'old candles are retained');
  const error = h.error();
  assert.equal(error.dataset.mode, 'stale');
  assert.match(error.textContent, /資料可能過期・更新失敗 \d{2}:\d{2}/);
  assert.match(error.textContent, /timeout/);
});

test('cancelled or superseded requests never paint an error', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const h = harness({ load: async () => { throw abort; } });
  await h.loadSymbolCandles(true);
  assert.equal(h.error(), undefined);
  const h2 = harness({ load: async () => { h2.state.symbol = 'ETHUSDT'; throw new Error('late'); } });
  await h2.loadSymbolCandles(true);
  assert.equal(h2.error(), undefined, 'a response for a chart the user left is ignored');
});

test('failure time uses local hh:mm', () => {
  const h = harness({ load: async () => [] });
  const host = h.showChartLoadError(new Error('x'), { stale: true, at: new Date(2026, 9, 15, 9, 5) });
  assert.match(host.textContent, /更新失敗 09:05/);
  h.clearChartLoadError();
  assert.equal(host.hidden, true);
});
