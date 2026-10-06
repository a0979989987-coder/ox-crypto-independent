import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync(new URL('../src/markets/crypto/live-quotes.js',import.meta.url),'utf8');
function harness(){
 let now=100000,id=0;const timers=new Map(),sockets=[],events=new Map(),target={hidden:false,addEventListener:(type,fn)=>events.set(type,fn)};
 target.body={classList:{contains:()=>!!target.blocked}};
 class Observer{constructor(fn){events.set('bodyclass',fn);}observe(){}}
 class WS {constructor(){this.readyState=0;this.sent=[];sockets.push(this);}open(){this.readyState=1;this.onopen?.();}send(data){this.sent.push(data);}close(){this.readyState=3;this.onclose?.();}push(symbol='BTCUSDT',price=12,ts=now){this.onmessage?.({data:JSON.stringify({arg:{instType:'USDT-FUTURES',channel:'ticker',instId:symbol},data:[{symbol,lastPr:price,change24h:.02,quoteVolume:9000,ts}],ts})});}}
 class Clock extends Date{static now(){return now;}}
 const schedule=(fn,ms,repeat=false)=>{timers.set(++id,{fn,at:now+ms,ms,repeat});return id;};
 const api=runInNewContext(code+'\nOXCryptoQuotes',{Date:Clock,document:target,window:target,WebSocket:WS,MutationObserver:Observer,console,setTimeout:schedule,clearTimeout:i=>timers.delete(i),setInterval:(f,m)=>schedule(f,m,true),clearInterval:i=>timers.delete(i),requestAnimationFrame:f=>schedule(f,16),cancelAnimationFrame:i=>timers.delete(i)});
 function advance(ms){const end=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;if(due[1].repeat)due[1].at+=due[1].ms;else timers.delete(due[0]);due[1].fn();}now=end;}
 return {api,sockets,target,events,advance,timers};
}
test('visible subscribers share one ticker socket and show each push within a frame',()=>{
 const h=harness(),a=[],b=[];const first=h.api.subscribe(['BTCUSDT'],q=>a.push(q)),second=h.api.subscribe(['BTCUSDT','ETHUSDT'],q=>b.push(q));assert.equal(h.sockets.length,1);const ws=h.sockets[0];ws.open();
 for(let i=0;i<3;i++){ws.push('BTCUSDT',12+i);h.advance(16);assert.equal(a.at(-1)[0].lastPr,12+i);h.advance(384);}
 assert.equal(b.at(-1)[0].lastPr,14);first.stop();assert.equal(ws.readyState,1);ws.push('BTCUSDT',15);h.advance(16);assert.equal(a.at(-1)[0].lastPr,14);assert.equal(b.at(-1)[0].lastPr,15);second.stop();assert.equal(ws.readyState,3);assert.equal(h.timers.size,0);
});
test('old REST snapshots, stale pushes and unrelated channels cannot roll back a live quote',()=>{
 const h=harness();h.api.subscribe(['BTCUSDT'],()=>{});const ws=h.sockets[0];ws.open();ws.push('BTCUSDT',15);h.advance(100);
 h.api.seed([{symbol:'BTCUSDT',lastPr:10,change24h:.01,usdtVolume:3}],99999);ws.push('BTCUSDT',11,99998);ws.push('ETHUSDT',1);assert.equal(h.api.get('BTCUSDT').lastPr,15);assert.equal(h.api.get('ETHUSDT'),null);h.advance(15000);assert.equal(h.api.get('BTCUSDT'),null);
});
test('hidden pages close the socket, preserve subscribers and reconnect with current symbols',()=>{
 const h=harness(),values=[];const feed=h.api.subscribe(['BTCUSDT'],q=>values.push(q));const old=h.sockets[0];old.open();h.target.hidden=true;h.events.get('visibilitychange')();assert.equal(old.readyState,3);feed.update(['ETHUSDT']);old.push('BTCUSDT',99);h.advance(50000);assert.equal(values.length,0);h.target.hidden=false;h.events.get('visibilitychange')();const ws=h.sockets[1];ws.open();assert.equal(JSON.parse(ws.sent[0]).args[0].instId,'ETHUSDT');ws.push('ETHUSDT',20);h.advance(16);assert.equal(values.at(-1)[0].symbol,'ETHUSDT');feed.stop();
});
test('retry attempts are finite; reconnect after online resumes without orphan timers',()=>{
 const h=harness(),feed=h.api.subscribe(['BTCUSDT'],()=>{});for(let i=0;i<5;i++){h.sockets.at(-1).close();h.advance(40000);}assert.equal(h.sockets.length,5);assert.equal(h.timers.size,0);h.events.get('online')();assert.equal(h.sockets.length,6);feed.stop();h.advance(60000);assert.equal(h.sockets.length,6);assert.equal(h.timers.size,0);
});
test('subscribed channels and quote cache have bounds, invalid prices never display',()=>{
 const h=harness(),feed=h.api.subscribe(Array.from({length:150},(_,i)=>'COIN'+i+'USDT'),()=>{});const ws=h.sockets[0];ws.open();assert.equal(JSON.parse(ws.sent[0]).args.length,100);
 h.api.seed(Array.from({length:300},(_,i)=>({symbol:'COIN'+i+'USDT',lastPr:1,change24h:0,usdtVolume:1})),100000);assert.equal(h.api.get('COIN0USDT').lastPr,1,'visible quotes survive broad REST snapshots');assert.equal(h.api.get('COIN100USDT'),null);assert.equal(h.api.get('COIN299USDT').lastPr,1);ws.push('COIN1USDT',-1);assert.equal(h.api.get('COIN1USDT').lastPr,1);feed.stop();
});
test('updating symbols unsubscribes old channels and ignores queued messages after stop',()=>{
 const h=harness(),values=[],feed=h.api.subscribe(['BTCUSDT'],q=>values.push(q));const ws=h.sockets[0];ws.open();feed.update(['ETHUSDT']);h.advance(500);const sent=ws.sent.map(JSON.parse);assert.equal(sent[1].op,'unsubscribe');assert.equal(sent[2].args[0].instId,'ETHUSDT');ws.push('ETHUSDT',20);feed.stop();h.advance(16);assert.equal(values.length,0);assert.equal(h.timers.size,0);
});

test('rapid membership changes coalesce rather than flooding subscription messages',()=>{
 const h=harness(),feed=h.api.subscribe(['BTCUSDT'],()=>{});const ws=h.sockets[0];ws.open();for(let i=0;i<50;i++)feed.update(['COIN'+i+'USDT']);assert.equal(ws.sent.length,1);h.advance(500);assert.equal(ws.sent.length,3);assert.equal(JSON.parse(ws.sent[2]).args[0].instId,'COIN49USDT');feed.stop();assert.equal(h.timers.size,0);
});

test('many symbols do not repaint unaffected subscribers on each tick',()=>{
 const h=harness(),a=[],b=[],one=h.api.subscribe(['BTCUSDT'],q=>a.push(q)),two=h.api.subscribe(['ETHUSDT'],q=>b.push(q));h.sockets[0].open();h.sockets[0].push('BTCUSDT',12);h.advance(16);h.sockets[0].push('ETHUSDT',20);h.advance(16);assert.equal(a.length,1);assert.equal(b.length,1);one.stop();two.stop();
});

test('policy gate prevents quote connections and pending renders, then resumes only when revealed',()=>{
 const h=harness(),values=[];h.target.blocked=true;h.events.get('bodyclass')();const feed=h.api.subscribe(['BTCUSDT'],q=>values.push(q));assert.equal(h.sockets.length,0);h.target.blocked=false;h.events.get('bodyclass')();const ws=h.sockets[0];ws.open();ws.push('BTCUSDT',12);h.target.blocked=true;h.events.get('bodyclass')();h.advance(16);assert.equal(values.length,0);assert.equal(ws.readyState,3);h.target.blocked=false;h.events.get('bodyclass')();h.advance(16);assert.equal(values.at(-1)[0].lastPr,12);feed.stop();
});
