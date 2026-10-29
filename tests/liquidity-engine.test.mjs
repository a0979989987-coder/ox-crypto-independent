import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// 裸 K 套保線／頂部確認、流動性地圖（牆、燃料）、不平衡 K 與高級訂單塊。
const context = {};
context.globalThis = context;
runInNewContext(readFileSync(new URL('../src/core/structure-engine.js', import.meta.url), 'utf8'), context);
runInNewContext(readFileSync(new URL('../src/core/liquidity-engine.js', import.meta.url), 'utf8'), context);
const { OXStructure: S, OXLiquidity: Q } = context;
const plain = value => JSON.parse(JSON.stringify(value));
const ohlc = rows => rows.map(([open, high, low, close, volume = 100], i) => ({ time: 1_700_000_000 + i * 3600, open, high, low, close, volume }));
// 以收盤價路徑產生 K 線：開盤＝前一根收盤，上下影各 0.15。
const path = (closes, vol = () => 100) => { let prev = 100; return closes.map((close, i) => { const open = prev; prev = close; return { time: 1_700_000_000 + i * 3600, open, close, high: Math.max(open, close) + 0.15, low: Math.min(open, close) - 0.15, volume: vol(i) }; }); };

test('裸 K 套保線: every stop is the previous bar low while no bar breaks it; the first break ends the run', () => {
  const list = ohlc([[10, 10.5, 9.5, 10.2], [10.2, 11, 10, 10.8], [10.8, 11.6, 10.6, 11.5], [11.5, 12.4, 11.2, 12.3], [12.3, 13, 12.1, 12.9], [12.9, 13.1, 11.9, 12.2]]);
  const up = S.nakedRuns(list, { minRun: 3, fastATR: 99 }).runs.find(r => r.dir === 'up');
  assert.deepEqual(plain([up.from, up.to, up.count, up.brokenAt]), [0, 4, 4, 5]);
  assert.deepEqual(plain(up.stops.map(s => [s.index, s.price])), [[1, 9.5], [2, 10], [3, 10.6], [4, 11.2]]);
  assert.equal(up.fast, false, 'not a fast rally under this threshold, so no 頂部確認');
});

test('頂部確認: the first naked-K break after a fast rally (≥ 5 ATR from where it started)', () => {
  const base = Array.from({ length: 20 }, (_, i) => [100, 100.6, 99.4, 100 + (i % 2 ? .2 : -.2)]);
  const rally = [[100, 102, 99.9, 101.8], [101.8, 104, 101.5, 103.9], [103.9, 106.5, 103.6, 106.2], [106.2, 108.4, 106, 108.1], [108.1, 108.6, 105.8, 106]];
  const runs = S.nakedRuns(ohlc([...base, ...rally])).runs.filter(r => r.dir === 'up');
  const fast = runs.find(r => r.fast);
  assert.ok(fast, 'the rally is fast');
  assert.equal(fast.brokenAt, 24, 'the bar that breaks the previous low confirms the top');
  assert.ok(fast.moveATR >= 5);
});

test('an ongoing run reports the 套保 stop at the last closed bar', () => {
  const list = ohlc([[10, 10.5, 9.5, 10.2], [10.2, 11, 10, 10.8], [10.8, 11.6, 10.6, 11.5], [11.5, 12.4, 11.2, 12.3], [12.3, 13, 12.1, 12.9]]);
  assert.equal(S.nakedRuns(list).current.up.stop, 12.1);
  assert.equal(S.nakedRuns(list, { lastOpen: true }).current.up.stop, 11.2, 'the live bar is not a stop yet');
});

test('不平衡: the bar before the gap is the 高級訂單塊 (down gap = resistance, up gap = support)', () => {
  const list = ohlc([[10, 10.4, 9.8, 10.2], [10.2, 10.3, 9.9, 10.1], [10.1, 10.15, 8.6, 8.7], [8.7, 9.6, 8.5, 8.6], [8.6, 8.9, 8.4, 8.8], [8.8, 9.0, 8.7, 8.9]]);
  const down = Q.imbalances(list).find(f => f.dir === 'down');
  assert.deepEqual(plain([down.role, down.index, down.block.index, down.block.top, down.block.bottom, down.gap.top, down.gap.bottom, down.brokenAt]), ['resistance', 2, 1, 10.3, 9.9, 9.9, 9.6, null]);
  const closedAbove = Q.imbalances([...list, ...ohlc([[8.9, 10.6, 8.9, 10.5]]).map(c => ({ ...c, time: c.time + 6 * 3600 }))]).find(f => f.dir === 'down');
  assert.equal(closedAbove.brokenAt, 6, 'a close above the block retires it');
  const up = Q.imbalances(ohlc([[10, 10.2, 9.8, 10], [10, 11.6, 10, 11.5], [11.5, 11.9, 10.4, 11.8]])).find(f => f.dir === 'up');
  assert.deepEqual(plain([up.role, up.block.index, up.gap.bottom, up.gap.top]), ['support', 0, 10.2, 10.4]);
});

test('火箭模型: slow dense decline overhead is 燃料, high-volume dump starts are 牆', () => {
  const closes = [];
  for (let i = 0; i < 30; i++) closes.push(100 + (i % 2 ? 0.8 : -0.8));
  closes.push(101, 102);
  for (let k = 1; k <= 12; k++) closes.push(102 - k * 0.34 + (k % 2 ? 0.12 : -0.12)); // 緩跌：小實體、沒有爆量
  closes.push(98.6, 99.4, 100.2);
  closes.push(98.5, 96.6, 95.0, 95.2, 94.9, 95.1);                                    // 爆量急跌
  const list = path(closes, i => (i >= 47 && i <= 49 ? 350 : 100));
  const structure = S.analyze(list);
  const map = Q.map(list, { structure, frame: '1H' });
  assert.equal(map.fuel.length, 1);
  assert.equal(map.fuel[0].dir, 1, 'above price');
  assert.equal(map.fuel[0].label, '緩跌燃料');
  assert.ok(map.fuel[0].top > 102 && map.fuel[0].bottom < 98);
  const walls = map.walls.filter(w => w.dir === 1).map(w => w.price);
  assert.deepEqual(plain(walls), [96.6, 98.5, 100.2], 'open of each high-volume down bar, nearest first');
  assert.equal(map.walls.every(w => w.sources[0] === '爆量下跌起點'), true);
  const room = Q.room(map, 1);
  assert.equal(room.wall.price, 96.6);
  assert.equal(room.fuel, 0, 'the fuel is beyond the first wall');
});

test('walls that price has already closed through are gone; larger-frame long wicks count', () => {
  const daily = [];
  for (let i = 0; i < 25; i++) daily.push([100, 101, 99, 100 + (i % 2 ? .3 : -.3)]);
  daily.push([100, 112, 99.5, 100.4]); // 長上影
  daily.push([100.4, 101, 99.6, 100.2]);
  const chart = path(Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3)));
  const structure = S.analyze(chart);
  const map = Q.map(chart, { structure, frame: '4H', larger: [{ frame: '1D', bars: ohlc(daily) }] });
  const wick = map.walls.find(w => w.kind === 'wick');
  assert.deepEqual(plain([wick.dir, wick.price, wick.label]), [1, 112, '1D 長上影']);
  const through = Q.map(chart, { structure, frame: '4H', larger: [{ frame: '1D', bars: ohlc([...daily, [100.2, 113, 100, 112.6]]) }] });
  assert.equal(through.walls.some(w => w.kind === 'wick' && w.price === 112), false);
});

test('假突破 points become walls until a close goes back through them', () => {
  const RISE = [[10, 10.4, 9.6, 10.2], [10.2, 11.2, 10.0, 11.0], [11.0, 12.2, 10.8, 12.0], [12.0, 12.1, 10.6, 10.8], [10.8, 11.0, 10.1, 10.3], [10.3, 11.3, 10.2, 11.2], [11.2, 12.6, 11.1, 12.5],
    [12.5, 13.0, 12.3, 12.9], [12.9, 12.95, 12.0, 12.1], [12.1, 12.4, 11.5, 11.7], [11.7, 12.5, 11.6, 12.4], [12.4, 13.2, 12.3, 12.8], [12.8, 12.9, 12.1, 12.2]];
  const pad = Array.from({ length: 8 }, (_, i) => [12.2, 12.5, 11.9, 12.2 + (i % 2 ? .1 : -.1)]);
  const list = ohlc([...RISE, ...pad]);
  const structure = S.analyze(list);
  assert.ok(structure.events.some(e => e.type === 'fake' && e.dir === 'up' && e.index === 11));
  const wall = Q.map(list, { structure, frame: '4H' }).walls.find(w => w.sources.includes('假突破高點'));
  assert.equal(wall.price, 13.2);
});

// 真實 K 線：輸出結構完整、不丟例外、未來 K 線不會讓已失效的訂單塊復活。
const fixture = JSON.parse(readFileSync(new URL('./fixtures/crypto-radar-audit-20261001.json', import.meta.url), 'utf8'));
const real = Object.entries(fixture.responses).map(([symbol, frames]) => ({ symbol, frames: Object.fromEntries(Object.entries(frames).map(([f, r]) => [f, r.data.map(x => ({ time: +x[0] / 1000, open: +x[1], high: +x[2], low: +x[3], close: +x[4], volume: +x[5], quoteVolume: +x[6] })).sort((a, b) => a.time - b.time)])) }));

test('real candles: walls sit on the right side of price, blocks are unbroken, everything is finite', () => {
  for (const { symbol, frames } of real) {
    const list = frames['4H'];
    const structure = S.analyze(list);
    const map = Q.map(list, { structure, frame: '4H', larger: [{ frame: '1D', bars: frames['1D'] }] });
    const price = list.at(-1).close;
    for (const w of map.walls) {
      assert.ok(Number.isFinite(w.price), symbol);
      assert.ok(w.dir === 1 ? w.price > price : w.price < price, `${symbol} ${w.label} ${w.price} vs ${price}`);
    }
    for (const f of map.fuel) assert.ok(f.top > f.bottom && (f.dir === 1 ? f.top > price : f.bottom < price), symbol);
    for (const b of map.blocks) {
      assert.equal(b.brokenAt, null, symbol);
      const after = list.slice(b.index + 2);
      assert.equal(after.some(c => b.role === 'resistance' ? c.close > b.block.top : c.close < b.block.bottom), false, symbol);
    }
    const runs = S.nakedRuns(list).runs;
    for (const r of runs) for (let k = 0; k < r.stops.length; k++) {
      const bar = list[r.stops[k].index];
      assert.ok(r.dir === 'up' ? bar.low >= r.stops[k].price : bar.high <= r.stops[k].price, `${symbol} naked run holds`);
    }
  }
});
