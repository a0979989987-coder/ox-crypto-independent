import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {strengthBubbleRadius} from '../src/markets/crypto/analytics/flow-chart.js';
import {replayWindow,replayCoverage} from '../src/markets/crypto/analytics/replay-ranges.js';
import {retainDailyFlow,mergeFlowHistory} from '../src/markets/crypto/analytics/flow-history.js';
import {buildFlowHistory} from '../src/markets/crypto/analytics/flow-model.js';
import {buildRotation} from '../src/markets/crypto/analytics/tools-model.js';
import {localizeNewsText} from '../src/components/news/localization.js';
test('rotation strength sizes remain readable and taker sell strength matches buy strength',()=>{
 for(const mobile of [true,false]){
  const radii=[-10,-5,0,5,10].map(x=>strengthBubbleRadius({x},{rotation:true,domain:10,mobile}));
  assert.ok(radii[0]>=16);assert.ok(radii.every((r,i)=>!i||r>radii[i-1]));
  assert.equal(strengthBubbleRadius({x:-70},{mobile}),strengthBubbleRadius({x:70},{mobile}));
 }
});
test('calendar replay ranges clamp month endings and report insufficient history honestly',()=>{
 const now=Date.UTC(2026,2,31);assert.equal(replayWindow('1m',now).start,Date.UTC(2026,1,28));
 assert.equal(replayWindow('1y',now).days,365);assert.equal(replayWindow('7d',now).days,7);
 const frames=[{ts:now-86400000},{ts:now}];assert.equal(replayCoverage(frames,'1y',now).complete,false);
});
test('daily taker archive deduplicates corrected observations and never creates missing days',()=>{
 const now=Date.UTC(2026,9,7),old={symbols:{BTCUSDT:[{ts:now-3*86400000,buyVolume:'2',sellVolume:'1'}]}};
 const snapshot={period:'1d',tickers:[{symbol:'BTCUSDT'}],flows:{'1d':{BTCUSDT:{response:{requestTime:now,data:[{ts:now,buyVolume:'3',sellVolume:'1'}]}}}}};
 const archive=retainDailyFlow(old,snapshot,now);const merged=mergeFlowHistory(snapshot,archive);
 assert.equal(merged.flows['1d'].BTCUSDT.response.data.length,2);
 assert.equal(merged.flows['1d'].BTCUSDT.response.data[1].buyVolume,'3');
 assert.equal(snapshot.flows['1d'].BTCUSDT.response.data.length,1);
});
test('scan ordering balances the two sides and completed workers do not wait for a slow symbol',async()=>{
 const code=readFileSync(new URL('../src/markets/crypto/scanner.js',import.meta.url),'utf8');
 const api=runInNewContext(code+'\n({orderCryptoScanTickers,scanCryptoPool})',{document:{addEventListener(){}},num:Number,setTimeout});
 const rows=[{symbol:'UP',change24h:.02,usdtVolume:4e6},{symbol:'DOWN1',change24h:-.5,usdtVolume:4e6},{symbol:'DOWN2',change24h:-.4,usdtVolume:4e6}];
 assert.equal(api.orderCryptoScanTickers(rows)[0].symbol,'UP');
 let resolveSlow;const gate=new Promise(r=>resolveSlow=r),started=[];let index=0;
 const pool=api.scanCryptoPool(()=>['slow','fast','next'][index++]??null,async symbol=>{started.push(symbol);if(symbol==='slow')await gate;},2);
 await new Promise(r=>setTimeout(r,10));assert.ok(started.includes('next'));resolveSlow();await pool;
});
test('localized event labels retain ticker symbols and the supplied source text',()=>{
 const original='Ethereum Ecosystem Summit in Singapore · BTC';
 assert.equal(localizeNewsText(original),'以太坊生態高峰會 in 新加坡 · BTC');assert.equal(original,'Ethereum Ecosystem Summit in Singapore · BTC');
});

test('yearly daily history follows short pages and preserves recent data when older pages fail',async()=>{
 const code=readFileSync(new URL('../src/markets/crypto/analytics/market-live.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
 const calls=[],day=86400000,latest=Date.UTC(2026,9,7);let fail=false;
 const api=runInNewContext(code+'\n({refreshDailyCandles})',{setTimeout,clearTimeout,DOMException,Date,globalThis:{OXPublicFeed:{async json(url){
  calls.push(url);const q=new URL(url).searchParams,start=q.has('endTime')?Math.floor(Number(q.get('endTime'))/day)*day:latest;
  if(fail&&q.has('endTime'))throw Error('unavailable');
  return {code:'00000',data:Array.from({length:90},(_,i)=>[String(start-i*day),'1','2','1','2','1','2'])};
 }}}});
 const seed={historyDays:365,sectors:[]},signal=new AbortController().signal;
 const full=await api.refreshDailyCandles(seed,{signal});
 assert.equal(full.dailyCandles.BTCUSDT.response.data.length,368);assert.equal(calls.length,5);
 assert.equal(new Set(full.dailyCandles.BTCUSDT.response.data.map(r=>r[0])).size,368);
 fail=true;const partial=await api.refreshDailyCandles(seed,{signal});assert.equal(partial.dailyCandles.BTCUSDT.response.data.length,90);
});

test('missing benchmark days omit those periods without discarding otherwise complete sector members',()=>{
 const day=86400000,end=Date.UTC(2026,9,7),data=Array.from({length:368},(_,i)=>[String(end-(368-i)*day),'1','2','1','2','1','2']);
 const entry=rows=>({response:{requestTime:end,data:rows}});
 const model=buildRotation({dailyCandles:{BTCUSDT:entry(data.filter((_,i)=>i!==180)),ETHUSDT:entry(data),SOLUSDT:entry(data)},sectors:[{id:'test',name:'Test',members:['ETHUSDT','SOLUSDT']}]},'1d',365);
 assert.equal(model.frames.length,363);assert.ok(model.frames.every(f=>f.rows.length===1));
 const missing=Number(data[180][0]);assert.ok(model.frames.every(f=>f.ts!==missing+day&&f.ts!==missing+2*day));
});

test('venue daily taker buckets at UTC+8 midnight replay only after closing',()=>{
 const day=86400000,start=Date.UTC(2026,8,6,16),now=start+30*day+4*3600000;
 const rows=Array.from({length:31},(_,i)=>({ts:start+i*day,buyVolume:'2',sellVolume:'1'}));
 const snapshot={mode:'volume',tickers:[{symbol:'BTCUSDT',baseCoin:'BTC',usdtVolume:1}],flows:{'1d':{BTCUSDT:{response:{requestTime:now,data:rows}}}}};
 const history=buildFlowHistory(snapshot,'1d',365);
 assert.equal(history.frames.length,29);assert.equal(history.frames.at(-1).ts,start+29*day);
 assert.ok(history.frames.every(f=>f.ts+day<=now));
});
