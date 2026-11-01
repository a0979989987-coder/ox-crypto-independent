import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { catalog, capMoves, readPrefs, DEFAULT_TILES, TILES_KEY } from '../src/markets/crypto/home-tiles.js';
import { SECTOR_GROUPS } from '../src/markets/crypto/analytics/sector-taxonomy.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const t = (base, change, extra = {}) => ({ symbol: base + 'USDT', lastPr: '10', change24h: String(change), usdtVolume: '1000000', fundingRate: '0.0001', ...extra });

test('首頁色塊: every tile is a real number from the tickers, CoinGecko and the fear & greed index', () => {
  const ai = SECTOR_GROUPS.find(g => g.id === 'ai').bases.slice(0, 4);
  const tickers = [t('BTC', 0.01, { lastPr: '78000', fundingRate: '0.000052' }), t('ETH', 0.02, { lastPr: '2271.4' }), t('SOL', -0.01), t('DOGE', 0.3),
    ...ai.map((b, i) => t(b, [0.1, 0.2, -0.1, 0.4][i])), t('ZZZ', -0.25, { fundingRate: '-0.0003' })];
  const global = { global: { total: 2.61e12, btc: 59.9, eth: 10.6, change: 1, btcChange: 1, ethChange: 2 }, fng: { value: 34, label: 'Fear' } };
  const byId = new Map(catalog({ tickers, global }).map(x => [x.id, x]));
  assert.deepEqual([byId.get('c:ETHUSDT').big, byId.get('c:ETHUSDT').sub, byId.get('c:ETHUSDT').move], ['+2.00%', '2,271.4', 2]);
  assert.equal(byId.get('c:BTCUSDT').sub, '78,000');
  assert.ok(!byId.has('c:XRPUSDT'), 'a coin without a ticker is left out');
  // 上漲家數: 6 up of 9 coins with a change.
  assert.equal(byId.get('m:breadth').big, `${Math.round(6 / 9 * 100)}%`);
  assert.equal(byId.get('m:top').sub, ai[3]); assert.equal(byId.get('m:bottom').sub, 'ZZZ');
  assert.deepEqual([byId.get('f:BTCUSDT').big, byId.get('f:BTCUSDT').sub], ['+0.0052%', '多方付費']);
  // 板塊: the equal-weight 24H change of the group's coins.
  assert.equal(byId.get('sec:ai').big, '+15.00%'); assert.equal(byId.get('sec:ai').sub, '4 個幣');
  assert.equal(byId.get('g:total').big, '+1.00%'); assert.equal(byId.get('g:total').sub, '2.61 兆美元');
  // BTC moved with the market: its share stays; ETH beat it: its share rose.
  assert.equal(byId.get('g:btc-dom').sub, '0.00 百分點');
  assert.match(byId.get('g:eth-dom').sub, /^\+0\.10 百分點$/);
  assert.deepEqual([byId.get('g:fng').big, byId.get('g:fng').sub], ['34', '恐懼']);
  for (const id of DEFAULT_TILES) assert.ok(byId.has(id) || id === 'c:BNBUSDT' || id === 'c:XRPUSDT' || id === 'sec:meme', id);
});

test('首頁色塊: the 24H market move comes from the largest coins, not /global, and a bad saved choice falls back', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: i ? 'c' + i : 'bitcoin', market_cap: i ? 1e9 : 1.5e12, market_cap_change_percentage_24h: i ? 0 : 1 }));
  const m = capMoves(rows);
  assert.equal(m.btcChange, 1); assert.ok(m.change > 0.9 && m.change < 1, String(m.change));
  assert.deepEqual(capMoves([]), { change: null, btcChange: null, ethChange: null });
  const store = value => ({ getItem: key => key === TILES_KEY ? value : null });
  assert.deepEqual(readPrefs(store(null)), { size: 8, list: DEFAULT_TILES });
  assert.deepEqual(readPrefs(store('{"size":12,"list":["c:BTCUSDT",3]}')), { size: 12, list: ['c:BTCUSDT'] });
  assert.equal(readPrefs(store('{"size":5}')).size, 8);
  assert.equal(readPrefs(store('not json')).size, 8);
});

test('the drawer has 遊戲 (the owner\'s 合成市場) and 交易教學 with crypto courses only', async () => {
  const drawer = await read('src/app/drawer.js');
  assert.match(drawer, /GAME_URL = 'https:\/\/merge-market\.btcfly\.chatgpt\.site\/'/);
  assert.match(drawer, /data-dr="game"/); assert.match(drawer, /data-dr="learn"/);
  const learn = await read('src/app/learn.js') + await read('src/app/learn-art.js');
  for (const stock of ['股票', '三大法人', '籌碼面', '開戶', '2330', '買進', '賣出', '一股']) assert.ok(!learn.replace(/^\/\/.*$/gm, '').includes(stock), stock);
  for (const name of ['加密貨幣是什麼', '交易所與下單', '資金費率與持倉', '用 OX 找幣']) assert.ok(learn.includes(name), name);
});

test('the dock is the Taiwan site\'s liquid-glass lens, and a quick second tap is not swallowed', async () => {
  const dock = await read('src/app/dock-glass.js');
  for (const part of ['oc-lens', 'oc-rim', 'ZOOM', 'swallowClicks', 'ox:viewchange']) assert.ok(dock.includes(part), part);
  assert.match(dock, /ev\.isTrusted && ev\.target\.closest/);
  assert.match(await read('src/app/app.js'), /initDockGlass\(\); initTopbar\(\)/);
});
