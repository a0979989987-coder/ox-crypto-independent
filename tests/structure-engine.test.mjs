import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// 雙極結構：使用者定義的頂／底分型、結構頂／底、極陽／平衡／極陰、轉折與假突破。
const context = {};
context.globalThis = context;
runInNewContext(readFileSync(new URL('../src/core/structure-engine.js', import.meta.url), 'utf8'), context);
const S = context.OXStructure;
const bars = rows => rows.map(([open, high, low, close], i) => ({ time: 1_700_000_000 + i * 14400, open, high, low, close, volume: 1 }));
const plain = value => JSON.parse(JSON.stringify(value));

// 0–6：上漲，頂分型（K2＝第 2 根），回調低點 10.1，突破頂分型高點 12.2。
// 7–11：再一次頂分型（13.0）、回調低點 11.5、突破 → 結構底上移到 11.5。
const RISE = [
  [10, 10.4, 9.6, 10.2], [10.2, 11.2, 10.0, 11.0], [11.0, 12.2, 10.8, 12.0], [12.0, 12.1, 10.6, 10.8],
  [10.8, 11.0, 10.1, 10.3], [10.3, 11.3, 10.2, 11.2], [11.2, 12.6, 11.1, 12.5],
  [12.5, 13.0, 12.3, 12.9], [12.9, 12.95, 12.0, 12.1], [12.1, 12.4, 11.5, 11.7], [11.7, 12.5, 11.6, 12.4], [12.4, 13.4, 12.3, 13.3]
];
// 12–13：再創高 13.5 後，陰線影線跌破結構底 11.5（低點 11.4）→ 平衡。
const BREAK = [[13.3, 13.5, 13.0, 13.1], [13.1, 13.2, 11.4, 12.6]];

test('top fractal: K2 breaks the previous high, a later bar breaks K2 low before a new high (inside bars allowed)', () => {
  const list = bars([[10, 11, 9, 10.5], [10.5, 12, 10, 11.8], [11.8, 11.9, 10.5, 11], [11, 11.5, 9.8, 10]]);
  const tops = S.fractals(list).filter(f => f.type === 'top');
  assert.deepEqual(plain(tops.map(f => [f.index, f.price, f.confirmedIndex])), [[1, 12, 3]]);
});

test('an outside bar that takes K2 high first is a new high, so K2 is not a top fractal', () => {
  const list = bars([[10, 11, 9, 10.5], [10.5, 12, 10, 11.8], [11.8, 12.5, 9.5, 10]]);
  assert.equal(S.fractals(list).some(f => f.type === 'top' && f.index === 1), false);
});

test('結構底 is the lowest point of the pullback after a top fractal, set when that top is broken', () => {
  const r = S.analyze(bars(RISE.slice(0, 7)));
  const start = r.events.find(e => e.type === 'start');
  assert.equal(start.dir, 'up');
  assert.equal(start.index, 6);
  assert.equal(start.level, 12.2, 'the broken level is the top fractal high');
  assert.equal(start.structure, 10.1, 'pullback low, not a bottom-fractal rule');
  assert.equal(r.current.state, 'bull');
  assert.equal(r.current.label, '極陽');
});

test('each broken top fractal moves 結構底 up to the newest pullback low', () => {
  const r = S.analyze(bars(RISE));
  const bos = r.events.filter(e => e.type === 'bos');
  assert.deepEqual(plain(bos.map(e => [e.index, e.dir, e.level, e.structure])), [[11, 'up', 13, 11.5]]);
  assert.equal(r.current.structureLow, 11.5);
  assert.equal(r.current.watch[0].label, '結構底');
});

test('a wick through 結構底 is 多空平衡, not yet bearish', () => {
  const r = S.analyze(bars([...RISE, ...BREAK]));
  const balance = r.events.find(e => e.type === 'balance');
  assert.equal(balance.index, 13);
  assert.equal(balance.dir, 'down');
  assert.equal(balance.level, 11.5);
  assert.equal(balance.prior, 13.5, '前高 = highest point of the leg');
  assert.equal(r.states[13], 'balance');
  assert.equal(r.current.label, '平衡');
  assert.equal(r.events.some(e => e.type === 'reversal'), false);
  assert.equal(r.current.watch.find(w => w.key === 'priorHigh').price, 13.5);
});

test('reclaiming the prior high from 平衡 is 延續; the wick-only break becomes 假跌破', () => {
  const r = S.analyze(bars([...RISE, ...BREAK, [12.6, 13.6, 12.5, 13.55]]));
  const cont = r.events.find(e => e.type === 'continue');
  assert.deepEqual(plain([cont.index, cont.dir, cont.level, cont.structure]), [14, 'up', 13.5, 11.4]);
  assert.equal(r.current.state, 'bull');
  const fake = r.events.find(e => e.type === 'fake');
  assert.deepEqual(plain([fake.index, fake.dir, fake.label, fake.confirmedIndex, fake.of]), [13, 'down', '假跌破', 14, 'balance']);
});

test('轉空 needs a new down structure: a lower high after a bottom fractal, then a break of that low', () => {
  const tail = [[12.6, 12.65, 11.0, 11.2], [11.2, 12.7, 11.1, 12.6], [12.6, 12.65, 12.2, 12.3], [12.3, 12.4, 10.8, 10.9]];
  const list = bars([...RISE, ...BREAK, ...tail]);
  const early = S.analyze(list.slice(0, 16));
  assert.equal(early.current.state, 'balance', 'a bounce alone does not turn it');
  assert.equal(early.current.watch.find(w => w.key === 'turnDown').price, 11.0);
  const r = S.analyze(list);
  const rev = r.events.find(e => e.type === 'reversal');
  assert.deepEqual(plain([rev.index, rev.dir, rev.label, rev.level, rev.structure]), [17, 'down', '轉空', 11.0, 12.7]);
  assert.equal(r.current.state, 'bear');
  assert.equal(r.current.structureHigh, 12.7);
});

test('假突破: the breakout bar closes back under the top and its low is broken first', () => {
  const list = bars([...RISE.slice(0, 11), [12.4, 13.2, 12.3, 12.8], [12.8, 12.9, 12.1, 12.2]]);
  const fake = S.analyze(list).events.find(e => e.type === 'fake');
  assert.deepEqual(plain([fake.index, fake.dir, fake.label, fake.level, fake.confirmedIndex]), [11, 'up', '假突破', 13, 12]);
});

test('events on an unfinished last bar are marked provisional', () => {
  const r = S.analyze(bars(RISE.slice(0, 7)), { lastOpen: true });
  assert.equal(r.events.find(e => e.type === 'start').provisional, true);
  assert.equal(S.analyze(bars(RISE.slice(0, 7))).events.find(e => e.type === 'start').provisional, false);
});

test('bad or short input never throws', () => {
  assert.equal(S.analyze([]).current.label, '結構未成形');
  assert.equal(S.analyze(null).current.state, null);
  assert.equal(S.analyze(bars([[1, 2, 0.5, 1.5], [1, Number.NaN, 0.5, 1], [1, 2, 0.5, 1]])).current.state, null);
});

// 真實 Bitget K 線：任何一根的狀態只由它之前（含）的 K 線決定，不偷看未來。
const fixture = JSON.parse(readFileSync(new URL('./fixtures/crypto-radar-audit-20261001.json', import.meta.url), 'utf8'));
const real = Object.entries(fixture.responses).flatMap(([symbol, frames]) => Object.entries(frames).map(([frame, response]) => ({
  symbol, frame, list: response.data.map(x => ({ time: +x[0] / 1000, open: +x[1], high: +x[2], low: +x[3], close: +x[4] })).sort((a, b) => a.time - b.time)
})));

test('no lookahead on real candles: past states and events never change when newer bars arrive', () => {
  assert.ok(real.length >= 20);
  for (const { symbol, frame, list } of real) {
    const full = S.analyze(list);
    for (const k of [40, 80, list.length - 30]) {
      if (k >= list.length) continue;
      const part = S.analyze(list.slice(0, k + 1));
      assert.equal(part.states.join(), full.states.slice(0, k + 1).join(), `${symbol} ${frame} @${k}`);
      const known = e => e.type === 'fake' ? e.confirmedIndex <= k : e.index <= k;
      const sig = e => [e.type, e.dir, e.index, e.level, e.structure].join(':');
      assert.deepEqual(part.events.map(sig), full.events.filter(known).map(sig), `${symbol} ${frame} events @${k}`);
    }
  }
});

test('real candles: segments, states and watch levels are consistent', () => {
  for (const { symbol, frame, list } of real) {
    const r = S.analyze(list);
    const label = `${symbol} ${frame}`;
    for (const s of r.segments) {
      assert.ok(s.index <= s.activeFrom, label + ' a structure level is formed before it becomes active');
      if (s.endIndex != null) assert.ok(s.endIndex >= s.activeFrom, label);
      const bar = list[s.index];
      assert.equal(s.price, s.kind === 'high' ? bar.high : s.kind === 'low' ? bar.low : s.side === 'high' ? bar.high : bar.low, label);
    }
    const open = r.segments.filter(s => s.endIndex == null).map(s => s.kind).sort().join();
    const state = r.current.state;
    if (state === 'bull') assert.equal(open, 'low', label);
    if (state === 'bear') assert.equal(open, 'high', label);
    if (state === 'balance') assert.equal(open, 'ref', label);
    for (const f of r.fractals) assert.ok(f.confirmedIndex > f.index, label);
  }
});
