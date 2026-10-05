import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/markets/crypto/live-candles.js',import.meta.url),'utf8');
const candle=(time=60,close=10)=>({time,open:10,high:Math.max(11,close),low:9,close,volume:2,quoteVolume:20});
function harness(fetcher=async()=>[candle()]){
  let now=61000,id=0;const timers=new Map(),sockets=[],events=new Map(),updates=[],calls=[];
  const target={hidden:false,addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:type=>events.delete(type)};
  class WS{
    constructor(){this.readyState=0;this.sent=[];sockets.push(this);}
    open(){this.readyState=1;this.onopen();}
    send(data){this.sent.push(data);}
    close(){this.readyState=3;this.onclose?.();}
    push(data,ts=now,extra={}){this.onmessage?.({data:JSON.stringify({arg:{instType:'USDT-FUTURES',channel:'candle1m',instId:'BTCUSDT'},data:data.map(c=>[c.time*1000,c.open,c.high,c.low,c.close,c.volume,c.quoteVolume]),ts,...extra})});}
  }
  class Clock extends Date{static now(){return now;}}
  const schedule=(fn,ms,repeat)=>{timers.set(++id,{fn,ms,at:now+ms,repeat});return id;};
  const api=runInNewContext(source+'\n({CryptoLiveCandles,updateCryptoLiveSeries})',{Date:Clock,WebSocket:WS,periods:{'1m':60,'1W':604800,'1D':86400,'3m':180},BitgetAPI:{fetchCandles:async(...args)=>{calls.push(args);return fetcher(...args);}},document:target,window:target,setInterval:(fn,ms)=>schedule(fn,ms,true),clearInterval:id=>timers.delete(id),setTimeout:(fn,ms)=>schedule(fn,ms,false),clearTimeout:id=>timers.delete(id)});
  const subscribe=(period='1m',options)=>api.CryptoLiveCandles.subscribe('BTCUSDT',period,data=>updates.push(data),options);
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  const advance=async(ms)=>{const end=now+ms;while(true){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;if(due[1].repeat)due[1].at+=due[1].ms;else timers.delete(due[0]);due[1].fn();await flush();}now=end;await flush();};
  return {...api,subscribe,sockets,updates,calls,target,events,advance,flush};
}
test('a push arriving during REST bootstrap wins; the current candle updates and the next bar appends',async()=>{
  let resolve;const h=harness(()=>new Promise(r=>resolve=r)),feed=h.subscribe();h.sockets[0].open();const loading=feed.load();
  h.sockets[0].push([candle(60,12)]);resolve([candle(0),candle(60,10)]);
  const initial=await loading;assert.equal(initial.at(-1).close,12);assert.equal(h.updates.length,0);
  h.sockets[0].push([candle(60,13)],62000);assert.equal(h.updates.at(-1)[0].close,13);
  h.sockets[0].push([candle(120,14)],120000);assert.equal(h.updates.at(-1)[0].time,120);
  const sent=JSON.parse(h.sockets[0].sent[0]);assert.equal(sent.args[0].channel,'candle1m');feed.stop();
});
test('late, invalid and wrong-symbol messages are ignored; stopped subscriptions cannot write',async()=>{
  const h=harness(),feed=h.subscribe();h.sockets[0].open();await feed.load();const ws=h.sockets[0];
  ws.push([candle(60,12)],63000);const count=h.updates.length;
  ws.push([candle(60,11)],62000);ws.push([candle(60,14)],64000,{arg:{instId:'ETHUSDT',instType:'USDT-FUTURES',channel:'candle1m'}});
  ws.push([{...candle(),high:5}],65000);assert.equal(h.updates.length,count);
  feed.stop();ws.push([candle(120,14)],120000);await h.advance(20000);assert.equal(h.updates.length,count);assert.equal(h.sockets.length,1);assert.equal(h.events.size,0);
});
test('rollover reconciles the final closed bar while a REST snapshot cannot roll back the live current bar',async()=>{
  let data=[candle(60,10)];const h=harness(()=>Promise.resolve(data)),feed=h.subscribe();h.sockets[0].open();await feed.load();
  h.sockets[0].push([candle(60,12)],62000);
  await feed.resync();assert.equal(h.updates.at(-1).at(-1).close,12,'stream stays authoritative for the open candle');
  data=[candle(60,13),candle(120,10)];h.sockets[0].push([candle(120,14)],120000);await h.flush();
  assert.equal(h.updates.at(-1)[0].close,13,'completed bar is reconciled');assert.equal(h.updates.at(-1).at(-1).close,14,'new bar retains fresher push');feed.stop();
});
test('disconnects resubscribe and fill gaps; suspension and silent streams recover without user navigation',async()=>{
  let data=[candle()];const h=harness(()=>Promise.resolve(data)),feed=h.subscribe();h.sockets[0].open();await feed.load();
  data=[candle(60,12),candle(120,13)];h.sockets[0].close();await h.advance(1000);assert.equal(h.sockets.length,2);h.sockets[1].open();await h.flush();assert.equal(h.updates.at(-1).at(-1).time,120);
  const before=h.calls.length;await h.advance(16000);assert(h.calls.length>before,'silent stream uses automatic REST fallback');
  h.target.hidden=true;const hidden=h.calls.length;await h.advance(5000);assert.equal(h.calls.length,hidden);
  h.target.hidden=false;h.events.get('visibilitychange')();await h.flush();assert(h.calls.length>hidden);feed.stop();
});
test('initial HTTP failure recovers by itself, and unsupported intervals use polling without invalid subscriptions',async()=>{
  let fail=true;const h=harness(()=>fail?Promise.reject(new Error('offline')):Promise.resolve([candle()]));
  const feed=h.subscribe('3m');await assert.rejects(feed.load());assert.equal(h.sockets.length,0);fail=false;await h.advance(5000);assert.equal(h.updates.at(-1)[0].close,10);feed.stop();
});
test('silent candle stream refreshes within five seconds without waiting for disconnect',async()=>{
 const h=harness(),feed=h.subscribe();h.sockets[0].open();await feed.load();h.sockets[0].push([candle(60,12)],61000);
 const before=h.calls.length;await h.advance(6000);assert(h.calls.length>before);feed.stop();
});
test('live updates retain loaded history and do not call setData for same-bar ticks or new bars',()=>{
  const h=harness(),writes=[];const series={setData:data=>writes.push(['set',data]),update:c=>writes.push(['update',c])};
  const previous=[candle(0),candle(60)];let data=h.updateCryptoLiveSeries(series,null,previous,[candle(60,12)]);assert.equal(data.length,2);assert.equal(writes[0][0],'update');
  data=h.updateCryptoLiveSeries(series,null,data,[candle(120,13)]);assert.equal(data.length,3);assert(writes.every(([op])=>op==='update'));
  h.updateCryptoLiveSeries(series,null,data,[candle(-60),candle(0,11),candle(120,13)]);assert.equal(writes.at(-1)[0],'set');assert.equal(writes.at(-1)[1][0].time,0);
});
test('countdown uses candle start including weekly anchors and actual calendar month length',()=>{
  const h=harness();const feb=Date.UTC(2024,0,31,16)/1000;
  assert.equal(h.CryptoLiveCandles.closeTime({time:feb},'1M'),Date.UTC(2024,1,29,16)/1000);
  const anchor=Date.UTC(2026,8,27,16)/1000;assert.equal(h.CryptoLiveCandles.closeTime({time:anchor},'1W'),anchor+604800);
});
