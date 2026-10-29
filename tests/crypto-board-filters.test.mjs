import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMEFRAMES } from '../src/markets/crypto/patterns/catalog.js';
import { BOARD_FILTER_KEY, TURNOVER_PRESETS, turnoverText, normalizeBoardFilter, readBoardFilter, writeBoardFilter, activeFilterCount, boardSectors, passesBoardFilter } from '../src/markets/crypto/patterns/filters.js';
import { browsePatternEntries } from '../src/markets/crypto/patterns/matcher.js';
import { mixPatterns } from '../src/markets/crypto/patterns/view.js';
import { fetchUniverse } from '../src/markets/crypto/patterns/source.js';

const memory = () => { const items = new Map(); return { items, getItem: k => items.has(k) ? items.get(k) : null, setItem: (k, v) => items.set(k, String(v)) }; };

test('board 篩選 defaults keep the 4H + 1H frames and no volume or sector condition', () => {
  assert.deepEqual(normalizeBoardFilter(null, TIMEFRAMES), { frames: ['4H', '1H'], limit: 0, turnover: 0, sectors: [] });
  assert.deepEqual(normalizeBoardFilter({ frames: ['1H', '1D', 'bogus', '1H'], limit: 81, turnover: -5, sectors: ['ai', 'nope', 'ai', 'meme'] }, TIMEFRAMES),
    { frames: ['1D', '1H'], limit: 0, turnover: 0, sectors: ['ai', 'meme'] });
  assert.equal(normalizeBoardFilter({ limit: 160, turnover: 10000000.4 }).turnover, 10000000);
  assert.equal(activeFilterCount({ turnover: 1e6, sectors: [] }), 1);
  assert.equal(activeFilterCount({ turnover: 1e6, sectors: ['ai'] }), 2);
});

test('the filter is remembered under one named key and read back normalized', () => {
  const storage = memory();
  assert.equal(BOARD_FILTER_KEY, 'ox-crypto:board-filter-v1');
  writeBoardFilter({ frames: ['1H', '4H'], limit: 80, turnover: 1e7, sectors: ['rwa', 'x'] }, TIMEFRAMES, storage);
  assert.deepEqual(JSON.parse(storage.items.get(BOARD_FILTER_KEY)), { v: 1, frames: ['4H', '1H'], limit: 80, turnover: 1e7, sectors: ['rwa'] });
  assert.deepEqual(readBoardFilter(TIMEFRAMES, storage), { frames: ['4H', '1H'], limit: 80, turnover: 1e7, sectors: ['rwa'] });
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
