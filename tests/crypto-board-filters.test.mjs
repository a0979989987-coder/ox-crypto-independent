import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMEFRAMES } from '../src/markets/crypto/patterns/catalog.js';
import { BOARD_FILTER_KEY, TURNOVER_PRESETS, turnoverText, normalizeBoardFilter, readBoardFilter, writeBoardFilter, activeFilterCount, poolFilterCount, seriesFilterCount, boardSectors, passesBoardFilter } from '../src/markets/crypto/patterns/filters.js';
import { browsePatternEntries } from '../src/markets/crypto/patterns/matcher.js';
import { mixPatterns } from '../src/markets/crypto/patterns/view.js';
import { fetchUniverse } from '../src/markets/crypto/patterns/source.js';

const memory = () => { const items = new Map(); return { items, getItem: k => items.has(k) ? items.get(k) : null, setItem: (k, v) => items.set(k, String(v)) }; };

test('board 篩選 defaults keep the 4H + 1H frames and no volume or sector condition', () => {
  assert.deepEqual(normalizeBoardFilter(null, TIMEFRAMES), { frames: ['4H', '1H'], limit: 0, turnover: 0, sectors: [], ratio: 0, signals: [] });
  assert.deepEqual(normalizeBoardFilter({ frames: ['1H', '1D', 'bogus', '1H'], limit: 81, turnover: -5, sectors: ['ai', 'nope', 'ai', 'meme'] }, TIMEFRAMES),
    { frames: ['1D', '1H'], limit: 0, turnover: 0, sectors: ['ai', 'meme'], ratio: 0, signals: [] });
  assert.equal(normalizeBoardFilter({ limit: 160, turnover: 10000000.4 }).turnover, 10000000);
  assert.equal(activeFilterCount({ turnover: 1e6, sectors: [] }), 1);
  assert.equal(activeFilterCount({ turnover: 1e6, sectors: ['ai'] }), 2);
});

test('the filter is remembered under one named key and read back normalized', () => {
  const storage = memory();
  assert.equal(BOARD_FILTER_KEY, 'ox-crypto:board-filter-v1');
  writeBoardFilter({ frames: ['1H', '4H'], limit: 80, turnover: 1e7, sectors: ['rwa', 'x'] }, TIMEFRAMES, storage);
  assert.deepEqual(JSON.parse(storage.items.get(BOARD_FILTER_KEY)), { v: 1, frames: ['4H', '1H'], limit: 80, turnover: 1e7, sectors: ['rwa'], ratio: 0, signals: [] });
  assert.deepEqual(readBoardFilter(TIMEFRAMES, storage), { frames: ['4H', '1H'], limit: 80, turnover: 1e7, sectors: ['rwa'], ratio: 0, signals: [] });
  storage.setItem(BOARD_FILTER_KEY, '{broken');
  assert.deepEqual(readBoardFilter(TIMEFRAMES, storage).frames, ['4H', '1H']);
});

test('24H 成交額 tiers read as 萬 / 億 USDT', () => {
  assert.deepEqual(TURNOVER_PRESETS.map(turnoverText), ['100萬', '1000萬', '1億']);
  assert.equal(turnoverText(5e6), '500萬');
  assert.equal(turnoverText(2.5e8), '2.5億');
  assert.equal(turnoverText(0), '不限');
});

test('turnover and sectors combine with AND, several sectors with OR', () => {
  const coin = { turnover: 2e7, sectors: ['ai', 'depin'] };
  assert.equal(passesBoardFilter({ turnover: 0, sectors: [] }, coin), true);
  assert.equal(passesBoardFilter({ turnover: 1e7, sectors: [] }, coin), true);
  assert.equal(passesBoardFilter({ turnover: 1e8, sectors: [] }, coin), false);
  assert.equal(passesBoardFilter({ turnover: 0, sectors: ['meme', 'ai'] }, coin), true);
  assert.equal(passesBoardFilter({ turnover: 1e8, sectors: ['ai'] }, coin), false);
  assert.equal(passesBoardFilter({ turnover: 0, sectors: ['meme'] }, coin), false);
  assert.equal(passesBoardFilter({ turnover: 0, sectors: ['ai'] }, { turnover: 2e7, sectors: null }), false);
});

test('板塊 use the verified sector catalog: multiplier contracts, no ambiguous tickers, pool counts', () => {
  const contract = (symbol, baseCoin) => ({ symbol, baseCoin, quoteCoin: 'USDT', symbolType: 'crypto', type: 'perpetual', status: 'online' });
  const instruments = [contract('BTCUSDT', 'BTC'), contract('PEPEUSDT', 'PEPE'), contract('1000BONKUSDT', '1000BONK'), contract('CATUSDT', 'CAT'), contract('FETUSDT', 'FET'), contract('XUSDT', 'Y')];
  const tickers = instruments.map(i => ({ symbol: i.symbol, usdtVolume: '1000000' }));
  assert.equal(boardSectors({ tickers }), null);
  const info = boardSectors({ tickers: tickers.filter(t => t.symbol !== 'FETUSDT'), allTickers: tickers, instruments });
  assert.ok(info.bySymbol.get('1000BONKUSDT').includes('meme'));
  assert.ok(info.bySymbol.get('PEPEUSDT').includes('meme'));
  assert.ok(info.bySymbol.get('BTCUSDT').includes('pow'));
  assert.equal(info.bySymbol.has('CATUSDT'), false, 'ambiguous tickers are never attributed');
  const meme = info.groups.find(g => g.id === 'meme');
  assert.equal(meme.name, 'Meme'); assert.equal(meme.count, 2);
  assert.ok(info.bySymbol.get('FETUSDT')?.includes('ai'));
  assert.equal(info.groups.find(g => g.id === 'ai'), undefined, 'counts only cover the scanned pool');
  assert.deepEqual(info.groups.map(g => g.count), [...info.groups.map(g => g.count)].sort((a, b) => b - a));
});

test('the scan universe carries the minimal instrument rows the sector filter needs', async () => {
  const now = Date.now(), oldFetch = globalThis.fetch;
  const contracts = [{ symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT', symbolType: 'crypto', type: 'perpetual', status: 'online', makerFeeRate: '0.0002' },
    { symbol: 'AAPLUSDT', baseCoin: 'AAPL', quoteCoin: 'USDT', symbolType: 'stock', type: 'perpetual', status: 'online' }];
  const quotes = [{ symbol: 'BTCUSDT', lastPr: '80000', change24h: '0.01', usdtVolume: '2000000000' }, { symbol: 'AAPLUSDT', lastPr: '200', change24h: '0', usdtVolume: '100' }];
  try {
    globalThis.fetch = async input => ({ ok: true, json: async () => ({ code: '00000', requestTime: now, data: String(input).includes('instruments') ? contracts : quotes }) });
    const universe = await fetchUniverse(new AbortController().signal, 80);
    assert.deepEqual(universe.instruments, [{ symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT', symbolType: 'crypto', type: 'perpetual', status: 'online' }]);
    assert.deepEqual(universe.tickers.map(t => t.symbol), ['BTCUSDT']);
  } finally { globalThis.fetch = oldFetch; }
});

test('default board: a named shape comes before a plain level line in the same tier', () => {
  const signal = { eligible: false, observationEligible: false, qualityScore: 40 };
  const match = (tier, similarity, label) => ({ tier, similarity, label, stage: '觀察', classicSignal: signal });
  const entry = (symbol, matches) => ({ key: symbol + ':4H', data: { symbol, frame: '4H', source: 'TEST', turnover: 1, candles: Array(60).fill({}), classic: {} }, matches });
  const rows = browsePatternEntries([
    entry('LINE', { 'horizontal-resistance': match(2, 99, '水平阻力') }),
    entry('SHAPE', { 'horizontal-resistance': match(2, 99, '水平阻力'), w: match(2, 80, 'W 底・雙底'), 'gartley-bull': match(3, 95, '加特利 Gartley・多') }),
    entry('HARMONIC', { 'trend-up': match(3, 90, '上升趨勢線'), 'gartley-bull': match(3, 85, '加特利 Gartley・多') }),
    entry('OLD', { 'retired-pattern': match(1, 99, '舊型態'), 'horizontal-support': match(3, 70, '水平支撐') })
  ]);
  const bySymbol = Object.fromEntries(rows.map(r => [r.symbol, r.match]));
  assert.equal(bySymbol.LINE.id, 'horizontal-resistance');
  assert.equal(bySymbol.SHAPE.id, 'w', 'W outranks a line in the same tier');
  assert.equal(bySymbol.HARMONIC.id, 'gartley-bull', 'harmonic patterns stay on the board');
  assert.equal(bySymbol.OLD.id, 'horizontal-support', 'patterns missing from the catalog are ignored');
});

test('default board takes turns between patterns inside each tier', () => {
  const row = (symbol, tier, id) => ({ symbol, displayTier: tier, match: { id, label: id } });
  const sorted = [row('A', 1, 'w'), row('B', 1, 'w'), row('C', 1, 'line'), row('D', 2, 'm'), row('E', 2, 'm'), row('F', 2, 'flag'), row('G', 2, 'm')];
  assert.deepEqual(mixPatterns(sorted).map(r => r.symbol), ['A', 'C', 'B', 'D', 'F', 'E', 'G']);
  assert.deepEqual(mixPatterns([]), []);
});

// ---- 量能放大, 指標信號 and the default board's order ----
import { readFileSync } from 'node:fs';
import { SIGNALS, SIGNAL_IDS, RATIO_PRESETS, crossedUp, signalsOf, volumeRatio, seriesFacts, passesSeriesFilter } from '../src/markets/crypto/patterns/signals.js';
import { shapeRank } from '../src/markets/crypto/patterns/view.js';
// The 盤面 chart's indicator script, loaded the way the page loads it.
function chartIndicators(stored = null) {
  const items = new Map(stored === null ? [] : [['ox-crypto:chart-indicators-v1', stored]]);
  const window = { localStorage: { getItem: k => items.has(k) ? items.get(k) : null, setItem: (k, v) => items.set(k, String(v)) }, addEventListener() {} };
  new Function('window', 'globalThis', readFileSync(new URL('../src/components/chart/indicators.js', import.meta.url), 'utf8'))(window, window);
  return window.OXChartIndicators;
}
const lib = chartIndicators();
const H = 3600, bars = closes => closes.map((close, i) => ({ time: 1793174400 + i * H, open: closes[i - 1] ?? close, high: Math.max(close, closes[i - 1] ?? close) * 1.002, low: Math.min(close, closes[i - 1] ?? close) * .998, close, volume: 100, quoteVolume: 100 * close }));

test('量能放大 and 指標信號 are remembered with the board filter and counted apart from the pool conditions', () => {
  const storage = memory();
  const value = writeBoardFilter({ frames: ['4H'], ratio: 2.04, signals: ['macd-cross', 'nope', 'kd-low', 'kd-low'] }, TIMEFRAMES, storage);
  assert.equal(value.ratio, 2);
  assert.deepEqual(value.signals, ['kd-low', 'macd-cross'], 'known signals only, in the list order');
  assert.deepEqual(readBoardFilter(TIMEFRAMES, storage), { frames: ['4H'], limit: 0, turnover: 0, sectors: [], ratio: 2, signals: ['kd-low', 'macd-cross'] });
  assert.equal(normalizeBoardFilter({ ratio: -1 }).ratio, 0);
  assert.equal(normalizeBoardFilter({ ratio: 999 }).ratio, 100);
  assert.equal(normalizeBoardFilter({ ratio: '1.55' }).ratio, 1.6);
  const both = { turnover: 1e6, sectors: ['ai'], ratio: 1.5, signals: ['kd-low'] };
  assert.deepEqual([activeFilterCount(both), poolFilterCount(both), seriesFilterCount(both)], [4, 2, 2]);
  assert.deepEqual(RATIO_PRESETS, [1.5, 2, 3]);
  assert.deepEqual(SIGNALS.map(([, name]) => name), ['KD 黃金交叉', 'KD 低檔 <20', 'MACD 黃金交叉', 'MACD 上穿零軸', 'RSI 超賣 <30', 'RSI 強勢 >70', '站上中均線', '均線多頭排列', '突破布林上軌', '觸及布林下軌', 'CCI 上穿 −100', 'CCI 強勢 >100']);
  assert.equal(SIGNAL_IDS.length, 12);
});

test('量能放大: the newest closed candle against the average of the five before it', () => {
  const list = bars([10, 10, 10, 10, 10, 10, 10]).map((c, i) => ({ ...c, quoteVolume: i === 6 ? 300 : 100 }));
  assert.equal(volumeRatio(list), 3);
  // A forming candle (a 1W card) never counts: its volume is not final.
  assert.equal(volumeRatio([...list, { ...list[6], time: list[6].time + H, quoteVolume: 5000, provisional: true }]), 3);
  assert.equal(volumeRatio(list.slice(-5)), null, 'needs six closed candles');
  assert.equal(volumeRatio(list.map(c => ({ ...c, quoteVolume: 0 }))), null);
  assert.equal(passesSeriesFilter({ ratio: 2, signals: [] }, { ratio: 3 }), true);
  assert.equal(passesSeriesFilter({ ratio: 3.5, signals: [] }, { ratio: 3 }), false);
  assert.equal(passesSeriesFilter({ ratio: 2, signals: [] }, { ratio: null }), false);
});

test('指標信號 read the card\'s own candles with the 盤面 chart\'s indicators and parameters', () => {
  assert.equal(crossedUp([1, 1, 3], [2, 2, 2]), true);
  assert.equal(crossedUp([3, 1, 1, 1, 1], [2, 2, 2, 2, 2]), false, 'only the last three bars count');
  assert.equal(crossedUp([null, 1, 3], [2, null, 2]), false);
  const rise = bars(Array.from({ length: 80 }, (_, i) => 100 + i));
  const up = signalsOf(rise, lib);
  for (const id of ['ma-up', 'ma-bull', 'rsi-high', 'cci-high']) assert.ok(up.has(id), id);
  for (const id of ['kd-low', 'rsi-low', 'bb-low']) assert.ok(!up.has(id), id);
  const fall = signalsOf(bars(Array.from({ length: 80 }, (_, i) => 200 - i)), lib);
  for (const id of ['kd-low', 'rsi-low']) assert.ok(fall.has(id), id);
  assert.ok(!fall.has('ma-up') && !fall.has('ma-bull'));
  // 布林: a quiet range, then a close above the upper band or a low under the lower band.
  const quiet = Array.from({ length: 40 }, (_, i) => 100 + (i % 2 ? .5 : -.5));
  assert.ok(signalsOf(bars([...quiet, 104]), lib).has('bb-up'));
  assert.ok(signalsOf(bars([...quiet, 96]), lib).has('bb-low'));
  assert.ok(!signalsOf(bars([...quiet, 100]), lib).has('bb-up'));
  // A speeding slide, then a sharp turn: KD and MACD cross up within the last bars.
  const slide = Array.from({ length: 60 }, (_, i) => 200 - i - i * i * .01), turn = bars([...slide, slide.at(-1) + 3, slide.at(-1) + 8]);
  const crossed = signalsOf(turn, lib);
  assert.ok(crossed.has('kd-cross'), 'KD');
  assert.ok(crossed.has('macd-cross'), 'MACD');
  assert.ok(crossed.has('cci-up'), 'CCI');
  // Too few closed candles: nothing is claimed.
  assert.equal(signalsOf(rise.slice(-20), lib).size, 0);
  assert.equal(signalsOf(rise, null).size, 0);
  // The user's own 均線 parameters decide 均線多頭排列.
  const zigzag = bars(Array.from({ length: 80 }, (_, i) => 100 + i * .2 + (i % 2 ? 3 : 0)));
  const custom = chartIndicators(JSON.stringify({ v: 1, on: {}, params: { ma: [3, 4, 5] } }));
  assert.notDeepEqual([...signalsOf(zigzag, lib)].includes('ma-bull'), [...signalsOf(zigzag, custom)].includes('ma-bull'));
  // Each series is read once per state; a new candle reads it again.
  const facts = seriesFacts('AAA:4H', rise, lib);
  assert.equal(seriesFacts('AAA:4H', rise, lib), facts);
  assert.notEqual(seriesFacts('AAA:4H', [...rise, { ...rise.at(-1), time: rise.at(-1).time + H }], lib), facts);
  assert.equal(passesSeriesFilter({ ratio: 0, signals: ['ma-up', 'ma-bull'] }, facts), true);
  assert.equal(passesSeriesFilter({ ratio: 0, signals: ['ma-up', 'kd-low'] }, facts), false, 'every checked signal must hold');
});

test('default board: named shapes first, then 走勢路徑, plain levels and trend lines last, inside each tier', () => {
  assert.deepEqual(['w', 'gartley-bull', 'channel-up', 'round-bottom', 'horizontal-resistance', 'trend-up'].map(shapeRank), [0, 0, 0, 1, 2, 2]);
  const row = (symbol, tier, id) => ({ symbol, displayTier: tier, match: { id, label: id } });
  const sorted = [row('A', 1, 'horizontal-resistance'), row('B', 1, 'w'), row('C', 1, 'round-bottom'), row('D', 1, 'gartley-bull'), row('E', 1, 'trend-up'), row('F', 2, 'trend-down'), row('G', 2, 'falling-wedge')];
  assert.deepEqual(mixPatterns(sorted).map(r => r.symbol), ['B', 'D', 'C', 'A', 'E', 'G', 'F']);
});
