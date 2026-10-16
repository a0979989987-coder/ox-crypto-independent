import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// 雷達與圖表指標共用同一個雙極結構引擎：真實 K 線上，雷達看到的極陽／平衡／極陰、
// 日線背景與空單的結構底，都要和 OXStructure 直接算出來的一樣。
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const context = { Date, Math, JSON, Number, String, Set, Map, Object, Array };
context.globalThis = context;
runInNewContext(`${read('../src/core/structure-engine.js')}\n${read('../src/core/liquidity-engine.js')}\n${read('../src/markets/crypto/radar-strategy.js')}`, context);
const { OXStructure: E, OXRadarStrategy: S } = context;
const fixture = JSON.parse(read('./fixtures/crypto-radar-audit-20261001.json'));
const toBars = r => r.data.map(x => ({ time: +x[0] / 1000, open: +x[1], high: +x[2], low: +x[3], close: +x[4], volume: +x[5], quoteVolume: +x[6] })).sort((a, b) => a.time - b.time);
const coins = Object.entries(fixture.responses).map(([symbol, frames]) => ({ symbol, frames: Object.fromEntries(Object.entries(frames).map(([f, r]) => [f, toBars(r)])) }));
const CONTEXT = { bull: 'aligned', bear: 'opposing', balance: 'neutral' };

test('radar structure states match the chart indicator on real candles', () => {
  for (const { symbol, frames } of coins) {
    const ticker = fixture.tickers.data.find(t => t.symbol === symbol);
    const out = S.evaluateSymbol({ symbol, contract: { baseCoin: symbol.replace(/USDT$/, '') }, ticker, frames, price: Number(ticker.lastPr) });
    for (const frame of ['1H', '4H', '1D']) {
      const direct = E.analyze(frames[frame].slice(-180)).current;
      assert.equal(out.structure[frame].state, direct.state, `${symbol} ${frame}`);
      assert.equal(out.structure[frame].structureLow, direct.structureLow, `${symbol} ${frame} 結構底`);
    }
    assert.equal(out.dailyContext, CONTEXT[out.structure['1D'].state], symbol);
  }
});

test('the short side uses the user-defined 結構底 from the same engine', () => {
  for (const { symbol, frames } of coins) {
    const t4 = S.topStructure(frames['4H']);
    if (!t4) continue;
    const s = E.analyze(frames['4H'].slice(-180));
    const brk = s.events.find(e => e.type === 'balance' && e.dir === 'down' && e.index > t4.h);
    if (brk) { assert.equal(t4.structureBroken, true, symbol); assert.equal(t4.structureLow.price, brk.level, symbol); }
    else if (s.current.state === 'bull') { assert.equal(t4.structureBroken, false, symbol); assert.equal(t4.structureLow.price, s.current.structureLow, symbol); }
  }
});
