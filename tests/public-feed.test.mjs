import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../src/core/public-feed.js',import.meta.url),'utf8');
function feed(options={}){const context=vm.createContext({fetch:options.fetcher,URL,AbortController,DOMException,setTimeout,clearTimeout});vm.runInContext(code,context);return context.OXPublicFeed.create(options);}
const response=(data=1)=>({ok:true,status:200,json:async()=>data});
test('in-flight background work leaves capacity for the visible chart',async()=>{
 const seen=[],releases=[];const f=feed({intervalMs:1,concurrency:4,fetcher:async url=>{seen.push(url);if(!url.endsWith('/chart'))await new Promise(resolve=>releases.push(resolve));return response();}});
 const scans=Array.from({length:4},(_,i)=>f.json('https://market.test/scan'+i,{priority:0}));
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(seen.length,3);
 await f.json('https://market.test/chart',{priority:100});assert.equal(seen.at(-1),'https://market.test/chart');
 while(releases.length)releases.shift()();await new Promise(resolve=>setTimeout(resolve,10));while(releases.length)releases.shift()();await Promise.all(scans);
});
test('radar/pattern/chart work share start rate and chart has queued priority',async()=>{const seen=[];let release;const gate=new Promise(r=>release=r);const f=feed({intervalMs:12,concurrency:1,fetcher:async url=>{seen.push({url,at:Date.now()});if(seen.length===1)await gate;return response();}});const a=f.json('https://market.test/first',{priority:0});const b=f.json('https://market.test/radar',{priority:0});const c=f.json('https://market.test/chart',{priority:100});release();await Promise.all([a,b,c]);assert.equal(seen[1].url,'https://market.test/chart');assert.ok(seen[2].at-seen[1].at>=9);});
test('429 cools the whole host, retries once, and cancellation removes departed work',async()=>{const times=[];const f=feed({intervalMs:1,concurrency:1,cooldownMs:20,fetcher:async url=>{times.push({url,at:Date.now()});return times.length===1?{status:429,ok:false,headers:{get:()=>null}}:response();}});const a=f.json('https://market.test/a');const cancelled=f.json('https://market.test/old',{owner:'departed'});f.cancel('departed');await assert.rejects(cancelled,{name:'AbortError'});await a;assert.equal(times.length,2);assert.ok(times[1].at-times[0].at>=18);assert.equal(f.stats().queued,0);});
test('stalled body is bounded and does not consume all future capacity',async()=>{let calls=0;const f=feed({intervalMs:1,concurrency:1,fetcher:async()=>++calls===1?{ok:true,status:200,json:()=>new Promise(()=>{})}:response(7)});await assert.rejects(f.json('https://market.test/stalled',{timeoutMs:12}),{name:'TimeoutError'});assert.equal(await f.json('https://market.test/recovered'),7);});
test('persistent 429 is finite and never becomes an empty market result',async()=>{let calls=0;const f=feed({intervalMs:1,cooldownMs:5,fetcher:async()=>{calls++;return {status:429,ok:false,headers:{get:()=>null}};}});await assert.rejects(f.json('https://market.test/radar'),{status:429});assert.equal(calls,2);});
test('one subscriber leaving never cancels another; equivalent query order is merged',async()=>{
 let calls=0,release,upstream;const barrier=new Promise(r=>release=r),f=feed({intervalMs:1,fetcher:async(_url,{signal})=>{calls++;upstream=signal;await barrier;return response({price:42});}});
 const controller=new AbortController();const a=f.json('https://market.test/candles?a=1&b=2',{signal:controller.signal,owner:'hidden'}),b=f.json('https://market.test/candles?b=2&a=1',{owner:'chart',priority:100});controller.abort();await assert.rejects(a,{name:'AbortError'});assert.equal(upstream.aborted,false);release();assert.equal((await b).price,42);assert.equal(calls,1);assert.equal(f.stats().merged,1);
});
test('cache respects expiry and range; bounded cache never stores errors',async()=>{
 let calls=0;const f=feed({intervalMs:1,maxCache:2,fetcher:async()=>response(++calls)});
 const read=range=>f.json('https://market.test/candles?limit='+range,{maxAgeMs:25});
 assert.equal(await read(100),1);assert.equal(await read(100),1);assert.equal(await read(200),2);assert.equal(await read(300),3);assert.equal(f.stats().cached,2);await new Promise(r=>setTimeout(r,30));assert.equal(await read(200),4);assert.equal(await read(100),5);
});
test('subscriber timeout does not release a still-needed shared request',async()=>{
 let release;const f=feed({intervalMs:1,fetcher:()=>new Promise(r=>release=()=>r(response(9)))});
 const a=f.json('https://market.test/shared',{timeoutMs:8}),b=f.json('https://market.test/shared',{timeoutMs:500});await assert.rejects(a,{name:'TimeoutError'});assert.equal(f.stats().active,1);release();assert.equal(await b,9);assert.equal(f.stats().active,0);
});
test('default throughput stays below the public API rate while retaining chart capacity',async()=>{
 const starts=[],releases=[];const f=feed({fetcher:async url=>{starts.push(Date.now());await new Promise(r=>releases.push(r));return response(url);}});
 const work=Array.from({length:6},(_,i)=>f.json('https://market.test/batch'+i,{priority:0}));
 await new Promise(r=>setTimeout(r,430));assert.equal(starts.length,5);
 const chart=f.json('https://market.test/chart',{priority:100});await new Promise(r=>setTimeout(r,90));assert.equal(starts.length,6);
 assert.ok(starts.slice(1).every((t,i)=>t-starts[i]>=70));
 while(releases.length)releases.shift()();await new Promise(r=>setTimeout(r,90));while(releases.length)releases.shift()();await Promise.all([...work,chart]);
});
test('rate limiting reduces the following start rate and diagnostics separate waiting from downloading',async()=>{
 const starts=[];let count=0;const f=feed({intervalMs:12,concurrency:1,cooldownMs:25,fetcher:async()=>{starts.push(Date.now());await new Promise(r=>setTimeout(r,6));return count++===0?{status:429,ok:false,headers:{get:()=>null}}:response(1);}});
 await f.json('https://market.test/a',{owner:'radar-scan'});await f.json('https://market.test/b');
 assert.ok(starts[2]-starts[1]>=21,'after cooling it must not immediately return to the original rate');
 const a=f.timings()[0];assert.equal(a.attempts,2);assert.equal(a.status,200);assert.ok(a.queueMs>=20);assert.ok(a.downloadMs>=10);assert.equal(a.owner,'radar-scan');
 a.owner='mutated';assert.equal(f.timings()[0].owner,'radar-scan','diagnostic callers cannot mutate internal records');
});
test('diagnostic history is bounded',async()=>{
 const f=feed({intervalMs:0,fetcher:async()=>response()});
 for(let i=0;i<260;i++)await f.json('https://market.test/'+i);
 assert.equal(f.timings().length,240);
});
test('speculative preparation uses at most one slot while charts can start immediately',async()=>{
 const started=[],releases=[];const f=feed({intervalMs:0,fetcher:async url=>{started.push(url);await new Promise(r=>releases.push(r));return response(url);}});
 const first=f.json('https://market.test/warm-a',{priority:-20}),second=f.json('https://market.test/warm-b',{priority:-10});
 const chart=f.json('https://market.test/chart',{priority:100});assert.equal(started.length,2);assert.ok(started[1].endsWith('/chart'));
 releases.shift()();releases.shift()();await Promise.all([first,chart]);await new Promise(r=>setImmediate(r));assert.equal(started.length,3);releases.shift()();await second;
});
