import test from 'node:test';
import assert from 'node:assert/strict';
import { pressure, classify, cryptoUniverse, buildFlow } from '../src/markets/crypto/analytics/flow-model.js';
const hour = 3600000;
const data = rows => ({ instruments: [{symbol:'BTCUSDT',baseCoin:'BTC',symbolType:'crypto',type:'perpetual',status:'online',quoteCoin:'USDT'}], tickers:[{symbol:'BTCUSDT',lastPr:'10',change24h:'0.01',usdtVolume:'100'}], flows:{'1h':{BTCUSDT:{response:{requestTime:hour*4+1,data:rows}}}} });
test('pressure uses same-asset taker buy/sell volume and rejects missing, zero and negative values', () => {
 assert.equal(pressure({buyVolume:'75',sellVolume:'25'}),50);
 assert.equal(pressure({buyVolume:25,sellVolume:75}),-50);
 for(const row of [{buyVolume:0,sellVolume:0},{buyVolume:null,sellVolume:2},{buyVolume:-1,sellVolume:2},{buyVolume:'',sellVolume:2},{buyVolume:'abc',sellVolume:2}]) assert.equal(pressure(row),null);
});
test('quadrants distinguish weakening selling from strengthening buying', () => {
 assert.equal(classify(-20,10).id,'sell-down'); assert.equal(classify(-20,-10).id,'sell-up');
 assert.equal(classify(20,10).id,'buy-up'); assert.equal(classify(20,-10).id,'buy-down');
 assert.equal(classify(0,10).id,'neutral'); assert.equal(classify(10,0).id,'neutral');
});
test('unknown asset types, stocks and offline contracts never leak into Crypto', () => {
 const ins=['crypto','stock',undefined].map((symbolType,i)=>({symbol:`S${i}`,baseCoin:`S${i}`,symbolType,type:'perpetual',status:'online',quoteCoin:'USDT'}));
 assert.deepEqual(cryptoUniverse(ins,ins.map(i=>({symbol:i.symbol,usdtVolume:100}))).map(i=>i.symbol),['S0']);
});
test('only adjacent complete source periods create a point; open period is omitted', () => {
 const s=data([{ts:hour,buyVolume:3,sellVolume:1},{ts:hour*2,buyVolume:1,sellVolume:3},{ts:hour*3,buyVolume:2,sellVolume:2},{ts:hour*4,buyVolume:100,sellVolume:0}]);
 const m=buildFlow(s);assert.equal(m.target,hour*3);assert.equal(m.rows[0].x,0);assert.equal(m.rows[0].y,50);assert.equal(m.rows[0].change24h,1);
 const g=buildFlow(data([{ts:hour,buyVolume:1,sellVolume:1},{ts:hour*3,buyVolume:1,sellVolume:1}]));assert.equal(g.rows.length,0);assert.deepEqual(g.excluded,['BTCUSDT']);
});
test('a source failure remains missing, not a zero-valued healthy market', () => {
 const s=data([]);s.flows['1h'].BTCUSDT={error:'HTTP 429'};const m=buildFlow(s);assert.equal(m.rows.length,0);assert.equal(m.expected,1);assert.equal(m.excluded.length,1);
});
