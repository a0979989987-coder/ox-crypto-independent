import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketRefreshCache } from '../src/markets/crypto/analytics/market-cache.js';
const snapshot={tickers:[{symbol:'BTCUSDT'},{symbol:'ETHUSDT'}],requestTime:1};
const complete=time=>({...snapshot,requestTime:time,scan:{done:2,total:2,complete:true}});
test('background and foreground share computation, partial coverage and cancellation isolation',async()=>{
 let calls=0,finish,upstream,transport,partial;const cache=createMarketRefreshCache(async(_snapshot,options)=>{calls++;upstream=options.signal;transport=options.transport;options.onPartial({...snapshot,tickers:snapshot.tickers.slice(0,1),scan:{done:1,total:2,complete:false}});return new Promise(r=>finish=r);},{now:()=>1000000});
 const warm=new AbortController(),a=cache.refresh(snapshot,{signal:warm.signal,priority:-20});await Promise.resolve();
 const b=cache.refresh(snapshot,{priority:20,onPartial:value=>partial=value});warm.abort();await assert.rejects(a,{name:'AbortError'});
 assert.equal(upstream.aborted,false);assert.equal(transport.priority,20);assert.equal(partial.scan.total,2);assert.equal(partial.scan.complete,false);
 finish(complete(1000000));assert.equal((await b).tickers.length,2);assert.equal(calls,1);assert.equal(cache.stats().cached,1);
});
test('handoff grace allows tool entry to join without cancelling or restarting upstream',async()=>{
 let calls=0,finish,upstream;const cache=createMarketRefreshCache(async(_s,{signal})=>{calls++;upstream=signal;return new Promise(r=>finish=r);},{now:()=>1000000,abortGraceMs:30});
 const controller=new AbortController(),a=cache.refresh(snapshot,{signal:controller.signal});await Promise.resolve();controller.abort();await assert.rejects(a,{name:'AbortError'});
 const b=cache.refresh(snapshot);await new Promise(r=>setTimeout(r,40));assert.equal(upstream.aborted,false);finish(complete(1000000));await b;assert.equal(calls,1);
});
test('freshness uses source timestamp, pools have bounds and a changed pool cannot reuse partial data',async()=>{
 let time=1000000,calls=0;const cache=createMarketRefreshCache(async s=>{calls++;return {...s,requestTime:time,scan:{done:s.tickers.length,total:s.tickers.length,complete:true}};},{now:()=>time,maxPools:2});
 await cache.refresh(snapshot);await cache.refresh(snapshot);assert.equal(calls,1);time+=300001;await cache.refresh(snapshot);assert.equal(calls,2);
 await cache.refresh({tickers:[{symbol:'SOLUSDT'}]});await cache.refresh({tickers:[{symbol:'XRPUSDT'}]});assert.equal(cache.stats().cached,2);await cache.refresh(snapshot);assert.equal(calls,5);
});
test('failed or incomplete refreshes are not cached as complete and allow a finite foreground retry',async()=>{
 let calls=0;const cache=createMarketRefreshCache(async()=>{calls++;return calls===1?{...snapshot,tickers:snapshot.tickers.slice(0,1),scan:{done:1,total:2,complete:false}}:complete(1000000);},{now:()=>1000000});
 await assert.rejects(cache.refresh(snapshot),/完整觀察池/);await new Promise(r=>setImmediate(r));assert.equal(cache.stats().cached,0);assert.equal((await cache.refresh(snapshot)).scan.complete,true);assert.equal(calls,2);
});
test('leaving every reader aborts abandoned work after the short handoff window',async()=>{
 let upstream;const cache=createMarketRefreshCache(async(_s,{signal})=>{upstream=signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));},{abortGraceMs:5});
 const c=new AbortController(),read=cache.refresh(snapshot,{signal:c.signal});await Promise.resolve();c.abort();await assert.rejects(read,{name:'AbortError'});await new Promise(r=>setTimeout(r,15));assert.equal(upstream.aborted,true);assert.equal(cache.stats().pending,0);
});
test('a complete flag cannot hide a changed symbol pool or unprocessed members',async()=>{
 for(const next of [{...complete(1000000),tickers:[{symbol:'BTCUSDT'},{symbol:'SOLUSDT'}]},{...complete(1000000),scan:{done:1,total:2,complete:true}}]){
  const cache=createMarketRefreshCache(async()=>next,{now:()=>1000000});await assert.rejects(cache.refresh(snapshot),/完整觀察池/);assert.equal(cache.stats().cached,0);
 }
});

test('same taker period shares a refresh while different periods remain separate, bounded and foreground-promoted',async()=>{
 let calls=0,finish,transport;const cache=createMarketRefreshCache(async(seed,options)=>{calls++;transport=options.transport;return new Promise(r=>finish=()=>r({...seed,scan:{done:20,total:20,complete:true},stamp:1000}));},{keyFor:s=>s.period,isFresh:(v,now)=>v?.scan?.complete&&now-v.stamp<300000,validate:v=>assert.equal(v.scan.done,20),maxPools:3,now:()=>1000});
 const c=new AbortController(),warm=cache.refresh({period:'1h'},{signal:c.signal,priority:-20});await Promise.resolve();const foreground=cache.refresh({period:'1h'},{priority:20});c.abort();await assert.rejects(warm,{name:'AbortError'});assert.equal(transport.priority,20);finish();await foreground;await cache.refresh({period:'1h'});assert.equal(calls,1);assert.equal(cache.stats().cached,1);
});
