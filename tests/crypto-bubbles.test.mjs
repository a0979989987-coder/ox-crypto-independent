import test from 'node:test';
import assert from 'node:assert/strict';
import {bubbleRows, matchCap, largeTradeFlow, radiusTargets} from '../src/markets/crypto/bubbles/model.js';
const now=1790817800000;
const quote=(base,value=1)=>({symbol:base+'USDT',baseCoin:base,lastPr:'10',change24h:String(value/100),usdtVolume:'100000',ts:now});
const cap=(symbol,id)=>({symbol,id,current_price:10,market_cap:1000000,last_updated:new Date(now).toISOString()});
test('bubble ranking shows both strong gains and losses, preserving real metric values',()=>{
  const tickers=[quote('A',2),quote('B',-8),quote('C',5)];
  assert.deepEqual(bubbleRows(tickers,{now,limit:2}).map(r=>[r.base,r.value]),[['B',-8],['C',5]]);
  assert.deepEqual(bubbleRows(tickers,{now,query:'a'}).map(r=>r.base),['A']);
  assert.deepEqual(bubbleRows(tickers,{now,watch:new Set(['CUSDT'])}).map(r=>r.base),['C']);
});
test('unavailable values remain missing while verified zero flow and zero score remain valid',()=>{
  const tickers=[quote('A'),quote('B')],analyses=new Map([['AUSDT',{oxScore:0}]]),flows=new Map([['BUSDT',{value:0,at:now}]]);
  assert.deepEqual(bubbleRows(tickers,{now,metric:'score',analyses}).map(r=>[r.base,r.value]),[['A',0]]);
  assert.deepEqual(bubbleRows(tickers,{now,metric:'flow',flows}).map(r=>[r.base,r.value]),[['B',0]]);
  assert.equal(bubbleRows(tickers,{now,metric:'cap'}).length,0);
  assert.equal(bubbleRows(tickers,{now:now+60001}).length,0);
  assert.equal(bubbleRows(tickers,{now:now+45001,metric:'flow',flows}).length,0);
});
test('long/short filtering precedes limits and follows the bubble color for every metric',()=>{
  const tickers=[quote('A',-9),quote('B',5),quote('C',2),quote('D',0)];
  const analyses=new Map(tickers.map(t=>[t.symbol,{oxScore:70}]));
  const caps=tickers.map(t=>cap(t.baseCoin.toLowerCase(),t.baseCoin.toLowerCase()));
  for(const metric of ['change','volume','cap','score']){
    assert.deepEqual(bubbleRows(tickers,{metric,now,analyses,caps,direction:'long',limit:2}).map(r=>r.base),['B','C']);
    assert.deepEqual(bubbleRows(tickers,{metric,now,analyses,caps,direction:'short'}).map(r=>r.base),['A']);
    assert.equal(bubbleRows(tickers,{metric,now,analyses,caps,direction:'both'}).length,4);
  }
  const flows=new Map([['AUSDT',{value:5000,at:now}],['BUSDT',{value:-3000,at:now}],['CUSDT',{value:0,at:now}]]);
  assert.deepEqual(bubbleRows(tickers,{metric:'flow',now,flows,direction:'long'}).map(r=>r.base),['A']);
  assert.deepEqual(bubbleRows(tickers,{metric:'flow',now,flows,direction:'short'}).map(r=>r.base),['B']);
  assert.equal(bubbleRows(tickers,{metric:'flow',now,flows,direction:'both'}).length,3);
});
test('market cap refuses ambiguous or stale identities and accounts for 1000-token contracts',()=>{
  assert.equal(matchCap('ABC',10,[cap('abc','one'),cap('abc','two')],now),null);
  assert.equal(matchCap('BTC',10,[cap('btc','bitcoin'),cap('btc','other')],now)?.id,'bitcoin');
  assert.equal(matchCap('1000PEPE',10000,[cap('pepe','pepe')],now)?.id,'pepe');
  assert.equal(matchCap('BTC',100,[cap('btc','bitcoin')],now),null);
  assert.equal(matchCap('BTC',10,[cap('btc','bitcoin')],now+1800001),null);
  assert.equal(matchCap('BTC',10,[{...cap('btc','bitcoin'),market_cap:null}],now),null);
  assert.equal(matchCap('BTC',10,[{...cap('btc','bitcoin'),market_cap:-1}],now),null);
});
test('large-trade sample deduplicates IDs and only counts recent verified notional above threshold',()=>{
  const trade=(tradeId,side,size,ts=now)=>({tradeId,side,size,price:100,ts});
  const rows=[trade('1','buy',150),trade('1','buy',150),trade('2','sell',100),trade('3','buy',99),trade('4','buy',200,now-300001),trade('5','other',200),trade('6','buy',0)];
  const f=largeTradeFlow(rows,now);
  assert.equal(f.value,5000);assert.equal(f.count,2);assert.equal(f.trades,3);
  assert.equal(largeTradeFlow([],now),null);
  assert.equal(largeTradeFlow([trade('x','buy',1)],now).value,0);
});
test('radii fit phone and desktop layouts across 30–100 coins without nonfinite values',()=>{
  for(const count of [1,30,50,100])for(const [w,h] of [[320,460],[390,514],[1440,640]]){
    const rows=Array.from({length:count},(_,i)=>({value:i%3?-i*7:0})),r=radiusTargets(rows,w,h);
    assert.equal(r.length,count);assert.ok(r.every(v=>Number.isFinite(v)&&v>0&&v<w/2&&v<h/2));
    assert.ok(r.reduce((sum,v)=>sum+Math.PI*v*v,0)<w*h*.7);
  }
});
test('size differences remain visible in a clustered value range without inventing unequal data',()=>{
  const values=Array.from({length:50},(_,i)=>({value:6+i*.12}));
  const radii=radiusTargets(values,356,504);
  assert.ok(radii.at(-1)/radii[0]>2);
  assert.ok(radii.every((r,i)=>i===0||r>radii[i-1]));
  assert.deepEqual(radiusTargets(values.map(r=>({...r,value:-r.value})),356,504),radii);
  const equal=radiusTargets(Array.from({length:50},()=>({value:70})),356,504);
  assert.ok(equal.every(r=>r===equal[0]));
});
