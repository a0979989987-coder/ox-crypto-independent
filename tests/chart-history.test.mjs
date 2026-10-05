import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('older candles use the history endpoint with an older cursor', async () => {
  const source=readFileSync(new URL('../src/core/public-feed.js',import.meta.url),'utf8')+readFileSync(new URL('../src/markets/crypto/api.js', import.meta.url), 'utf8');
  let requested;
  const api = runInNewContext(`${source}\nBitgetAPI`, {
    URL,AbortController,DOMException,setTimeout,clearTimeout,
    CONFIG: { apiBase: 'https://api.bitget.com/api/v2/mix/market', productType: 'USDT-FUTURES' },
    num: Number,
    fetch: async url => { requested = new URL(url); return {ok:true,status:200, json: async () => ({ code: '00000', data: [['100000', '1', '2', '1', '2', '3', '4']] }) }; }
  });
  await api.fetchCandles('BTCUSDT', '1D', 200, 100000);
  assert.equal(requested.pathname, '/api/v2/mix/market/history-candles');
  assert.equal(requested.searchParams.get('endTime'), '100000');
  await api.fetchCandles('BTCUSDT', '1D', 160);
  assert.equal(requested.pathname, '/api/v2/mix/market/candles');
});

test('prepending history preserves the candles in view', async () => {
  const source = readFileSync(new URL('../src/components/chart/workspace.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('async function loadMoreHistoricalCandles()'), source.indexOf('\nfunction renderChartData('));
  const seen = [];
  const chart = { timeScale: () => ({ getVisibleLogicalRange: () => ({ from: 20, to: 70 }) }) };
  const state = {
    symbol: 'BTCUSDT', period: '1D', oldestCandleTime: 300,
    candleData: [{ time: 300 }, { time: 400 }], hasMoreHistory: true, isLoadingOlder: false, chart
  };
  const load = runInNewContext(`${fn}\nloadMoreHistoricalCandles`, {
    state, periods: { '1D': 100 },
    BitgetAPI: { fetchCandles: async (_symbol, _period, _limit, endTime) => {
      assert.equal(endTime, 200000);
      return [{ time: 100 }, { time: 200 }];
    } },
    document: { getElementById: () => ({ classList: { add() {}, remove() {} } }) },
    renderChartData: (data, fit, visible) => seen.push({ data, fit, visible })
  });
  await load();
  assert.equal(state.oldestCandleTime, 100);
  assert.deepEqual(Array.from(seen[0].data, x => x.time), [100, 200, 300, 400]);
  assert.deepEqual({ ...seen[0].visible }, { from: 22, to: 72 });
  assert.equal(seen[0].fit, false);
});
