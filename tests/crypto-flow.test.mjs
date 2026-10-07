import test from 'node:test';
import assert from 'node:assert/strict';
import { pressure, classify, cryptoUniverse, buildFlow, PERIODS, buildFlowHistory } from '../src/markets/crypto/analytics/flow-model.js';
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
test('flow modes select up to 50 verified contracts and never fabricate OX scores',()=>{
 const ins=Array.from({length:55},(_,i)=>({symbol:`C${i}USDT`,baseCoin:`C${i}`,symbolType:'crypto',type:'perpetual',status:'online',quoteCoin:'USDT'}));
 const tickers=ins.map((r,i)=>({symbol:r.symbol,usdtVolume:String(i+1),change24h:String((55-i)/100)}));
 assert.equal(cryptoUniverse(ins,tickers).length,50);
 assert.equal(cryptoUniverse(ins,tickers,50,'volume')[0].symbol,'C54USDT');
 assert.equal(cryptoUniverse(ins,tickers,50,'gain')[0].symbol,'C0USDT');
 const scores=new Map([['C0USDT',{oxScore:88}],['C1USDT',{oxScore:97}]]);
 assert.deepEqual(cryptoUniverse(ins,tickers,50,'score',scores).map(r=>r.symbol),['C1USDT','C0USDT']);
 assert.deepEqual(cryptoUniverse(ins,tickers,50,'score',new Map()),[]);
});
test('only adjacent complete source periods create a point; open period is omitted', () => {
 const s=data([{ts:hour,buyVolume:3,sellVolume:1},{ts:hour*2,buyVolume:1,sellVolume:3},{ts:hour*3,buyVolume:2,sellVolume:2},{ts:hour*4,buyVolume:100,sellVolume:0}]);
 const m=buildFlow(s);assert.equal(m.target,hour*3);assert.equal(m.rows[0].x,0);assert.equal(m.rows[0].y,50);assert.equal(m.rows[0].change24h,1);
 assert.equal(m.rows[0].netNotional,0,'net estimate comes from actual taker volume difference');
 const g=buildFlow(data([{ts:hour,buyVolume:1,sellVolume:1},{ts:hour*3,buyVolume:1,sellVolume:1}]));assert.equal(g.rows.length,0);assert.deepEqual(g.excluded,['BTCUSDT']);
});
test('a source failure remains missing, not a zero-valued healthy market', () => {
 const s=data([]);s.flows['1h'].BTCUSDT={error:'HTTP 429'};const m=buildFlow(s);assert.equal(m.rows.length,0);assert.equal(m.expected,1);assert.equal(m.excluded.length,1);
});

test('replay uses only closed consecutive source periods and retains the current cohort',async()=>{
 const snapshot=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../previews/data/crypto-flow-snapshot.json',import.meta.url),'utf8'));
 const current=buildFlow(snapshot,'1h'),history=buildFlowHistory(snapshot,'1h');
 assert.deepEqual(history.frames.at(-1).rows,current.rows);
 for(const frame of history.frames){assert.deepEqual(frame.rows.map(r=>r.symbol),current.rows.map(r=>r.symbol));assert.ok(frame.ts<=current.target);assert.equal(frame.ts%3600000,0);for(const row of frame.rows)assert.ok(Number.isFinite(row.x)&&Number.isFinite(row.y));}
});
test('short and daily taker periods use exchange-supported intervals and preserve non-BTC coins',async()=>{
 const snapshot=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../previews/data/crypto-flow-snapshot.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(PERIODS),['5m','15m','30m','1h','2h','4h','6h','12h','1d']);
 const current=buildFlow(snapshot,'1h'),history=buildFlowHistory(snapshot,'1h');
 assert.ok(current.rows.length>1);assert.ok(history.frames.every(f=>f.rows.length===current.rows.length));
 assert.ok(current.rows.some(r=>r.symbol==='ETHUSDT'),'BTC turnover cannot erase other valid symbols');
});
