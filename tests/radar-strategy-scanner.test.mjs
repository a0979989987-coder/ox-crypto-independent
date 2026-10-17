import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { OXClassicForTests } from './classic-test-runtime.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const scanner = read('../src/markets/crypto/scanner.js');
const engine = read('../src/markets/crypto/engine.js');
const policy = read('../src/markets/crypto/liquidity-policy.js');
const strategy = read('../src/markets/crypto/radar-strategy.js');

const side = (score, t1, extra = {}) => ({ listed: true, t1, score, frame: '4H', triggerFrame: '1H', stop: 1,
  pathway: { key: 'pressure', group: '壓力突破', name: '水平壓力突破', closed: true },
  elements: { certainty: 60, strength: 60, rr: 2, room: 0.15, rrScore: 80, roomScore: 60 },
  matched: ['途徑 · 壓力突破'], deductions: [{ text: '1H 待確認', points: 6 }], gates: [], rejections: [], ...extra });
function rank(rows) {
  const state = { analyzedCache: new Map(rows.map(r => [r.symbol, { quoteVol: 5e6, lastPrice: 2, at: Date.now(), ...r }])),
    tickers: [], directionFilter: 'long', instrumentCatalog: new Map() };
  const context = { OXClassic: OXClassicForTests, state, benchmarkSymbols: new Set(['BTCUSDT', 'ETHUSDT']), num: Number,
    isCryptoSymbolAllowed: () => true, syncDirectionalBadges() {}, syncWatchBadge() {}, renderMarketStrength() {},
    renderHomeOverview() {}, renderOxLive() {} };
  context.globalThis = context;
  runInNewContext(`${policy}\n${engine}\n${strategy}\n${scanner}\nrebuildTierLists();`, context);
  return state;
}
const radarRow = (symbol, long, short = { listed: false, rejections: ['4H 近期沒有急漲段'] }) =>
  ({ symbol, radar: { version: 2, product: 'crypto', long, short } });

test('radar lists come from the strategy layer: T1 only for T1-qualified rows', () => {
  const state = rank([
    radarRow('AAAUSDT', side(80, true)), radarRow('BBBUSDT', side(90, false)), radarRow('CCCUSDT', side(50, false)),
    radarRow('DDDUSDT', { listed: false, rejections: ['沒有入選途徑'] })
  ]);
  const long = state.tierMapBySide.long;
  assert.equal(JSON.stringify(long.t1.map(r => r.symbol)), JSON.stringify(['AAAUSDT']));
  assert.equal(JSON.stringify(long.t2.map(r => r.symbol)), JSON.stringify(['BBBUSDT', 'CCCUSDT']));
  assert.equal(long.t1[0].oxScore, 80);
  assert.equal(long.t1[0].radarSide.pathway.group, '壓力突破');
  assert.equal(state.tierMapBySide.short.t1.length + state.tierMapBySide.short.t2.length, 0);
});

test('stablecoins and gold tokens never enter the radar ranking', () => {
  const state = rank([radarRow('USDCUSDT', side(95, true)), radarRow('PAXGUSDT', side(95, true)), radarRow('SOLUSDT', side(70, true))]);
  const symbols = ['t1', 't2', 't3'].flatMap(t => [...state.tierMapBySide.long[t]].map(r => r.symbol));
  assert.equal(JSON.stringify(symbols), JSON.stringify(['SOLUSDT']));
});

test('a live price beyond the structure invalidation drops the row', () => {
  const state = rank([radarRow('LOWUSDT', side(80, true, { stop: 3 })), radarRow('OKUSDT', side(70, true, { stop: 1 }))]);
  assert.equal(JSON.stringify(state.tierMapBySide.long.t1.map(r => r.symbol)), JSON.stringify(['OKUSDT']));
});

test('short lists use the top-confirmation decision', () => {
  const short = side(66, false, { side: 'SHORT', stop: 5, pathway: { key: 'top-confirmed', group: '頂部確認', name: '頂分型確認', closed: true } });
  const state = rank([radarRow('PUMPUSDT', { listed: false, rejections: [] }, short)]);
  assert.equal(JSON.stringify(state.tierMapBySide.short.t2.map(r => r.symbol)), JSON.stringify(['PUMPUSDT']));
  assert.equal(state.tierMapBySide.short.t2[0].side, 'SHORT');
});

test('a saved snapshot restores strategy rows that were listed on either side', () => {
  const state = { tickers: [{ symbol: 'SOLUSDT', change24h: 0.02, usdtVolume: 5e6 }], analyzedCache: new Map(), instrumentCatalog: new Map() };
  const rows = [radarRow('SOLUSDT', side(70, true)), radarRow('OLDUSDT', { listed: false, rejections: [] })];
  const context = { OXClassic: OXClassicForTests, state, num: Number, Date, isCryptoSymbolAllowed: () => true,
    localStorage: { getItem: () => JSON.stringify({ savedAt: Date.now(), rows }) } };
  context.globalThis = context;
  runInNewContext(`${policy}\n${engine}\n${strategy}\n${scanner}\nrestoreRadarSnapshot();`, context);
  assert.equal(state.analyzedCache.size, 1);
  assert.equal(state.analyzedCache.get('SOLUSDT').radar.long.listed, true);
  assert.equal(state.radarSnapshotReady, true);
});

test('each side fills T2 and T3 to 15: selected rows first, then fill candidates, never T1', () => {
  const fill = score => side(score, false, { listed: false, fillable: true, fillReason: '已拉離觸發位 2.6 ATR（過度拉升，禁止追高）',
    rejections: ['已拉離觸發位 2.6 ATR（過度拉升，禁止追高）'] });
  const rows = [
    ...Array.from({ length: 3 }, (_, i) => radarRow('SEL' + i + 'USDT', side(40 - i, false))),
    ...Array.from({ length: 40 }, (_, i) => radarRow('FIL' + i + 'USDT', fill(90 - i)))
  ];
  const long = rank(rows).tierMapBySide.long;
  assert.equal(long.t1.length, 0);
  assert.equal(long.t2.length, 15);
  assert.equal(long.t3.length, 15);
  assert.equal(JSON.stringify(long.t2.slice(0, 3).map(r => r.symbol)), JSON.stringify(['SEL0USDT', 'SEL1USDT', 'SEL2USDT']));
  assert.equal(long.t2[3].radarFill, true);
  assert.equal(long.t2[3].setupName, 'OX 雷達 · 補位');
  assert.match(long.t2[3].reasons[0], /^補位（未完全入選）：已拉離觸發位/);
  const symbols = ['t2', 't3'].flatMap(t => long[t].map(r => r.symbol));
  assert.equal(new Set(symbols).size, 30);
});

test('a coin selected on one side never fills the opposite side', () => {
  const shortFill = side(50, false, { side: 'SHORT', stop: 5, listed: false, fillable: true, fillReason: '頂部確認已過時（20 根 4H 前）',
    pathway: { key: 'top-confirmed', group: '頂部確認', name: '頂分型確認', closed: true } });
  const state = rank([radarRow('BOTHUSDT', side(60, false), shortFill), radarRow('ONLYUSDT', { listed: false, rejections: [] }, shortFill)]);
  const short = ['t1', 't2', 't3'].flatMap(t => state.tierMapBySide.short[t].map(r => r.symbol));
  assert.equal(JSON.stringify(short), JSON.stringify(['ONLYUSDT']));
  assert.equal(state.tierMapBySide.long.t2[0].symbol, 'BOTHUSDT');
});

test('a coin selected on both sides stays only on the side where it scores higher', () => {
  const shortSel = side(60, false, { side: 'SHORT', stop: 5, pathway: { key: 'top-confirmed', group: '頂部確認', name: '頂分型確認', closed: true } });
  const state = rank([radarRow('TWOUSDT', side(31, false), shortSel)]);
  const long = ['t1', 't2', 't3'].flatMap(t => state.tierMapBySide.long[t].map(r => r.symbol));
  const short = ['t1', 't2', 't3'].flatMap(t => state.tierMapBySide.short[t].map(r => r.symbol));
  assert.equal(long.length, 0);
  assert.equal(JSON.stringify(short), JSON.stringify(['TWOUSDT']));
});

test('an exact tie between both sides keeps the coin on the long list only', () => {
  const shortSel = side(40, false, { side: 'SHORT', stop: 5, pathway: { key: 'top-confirmed', group: '頂部確認', name: '頂分型確認', closed: true } });
  const state = rank([radarRow('TIEUSDT', side(40, false), shortSel)]);
  assert.equal(state.tierMapBySide.long.t2[0].symbol, 'TIEUSDT');
  assert.equal(['t1', 't2', 't3'].reduce((n, t) => n + state.tierMapBySide.short[t].length, 0), 0);
});
