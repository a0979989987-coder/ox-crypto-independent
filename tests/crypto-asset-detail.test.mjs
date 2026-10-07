import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssetCandleSource,ASSET_PERIODS} from '../src/markets/crypto/analytics/asset-candles.js';
import {candleChart} from '../src/markets/crypto/patterns/charts.js';

const timestamp=Date.UTC(2026,9,7,4);
function response(now=timestamp,seconds=3600){const end=Math.floor(now/1000/seconds)*seconds;return {code:'00000',requestTime:now,data:Array.from({length:100},(_,i)=>[(end-(99-i)*seconds)*1000,100+i,102+i,99+i,101+i,5,500])};}
const candles=json=>json.data.map(([ms,open,high,low,close])=>({time:ms/1000,open,high,low,close}));

test('asset details reuse only fresh matching main-chart candles and expire the small cache',async()=>{
 let now=timestamp,calls=0;
 const shared={candles:candles(response()),serverTime:timestamp};
 const source=createAssetCandleSource({now:()=>now,api:{peekCandles:(s,p)=>p==='1H'?shared:null},feed:{json:async(url,options)=>{calls++;assert.equal(options.priority,100);assert.equal(options.owner,'analytics-detail');return response(now,url.includes('1Dutc')?86400:3600);}}});
 assert.equal((await source.load('BTCUSDT','1h')).candles.length,100);assert.equal(calls,0);
 await source.load('BTCUSDT','1h');assert.equal(calls,0);
 now+=16000;await source.load('BTCUSDT','1h');assert.equal(calls,1,'expired live candle is fetched again');
 await source.load('BTCUSDT','1d');assert.equal(calls,2,'daily K lines use actual daily data');
 for(const period of ['1m','5m','15m','1h','4h','1d','1w'])assert.ok(ASSET_PERIODS[period]);
});

test('asset candle cache is bounded and never admits invalid symbols, stale timestamps or a missing latest run',async()=>{
 let mode='good';const source=createAssetCandleSource({api:null,now:()=>timestamp,maxEntries:3,feed:{json:async()=>mode==='stale'?response(timestamp-400000):mode==='bad'?{...response(),data:[[timestamp,0,0,0,0,0,0]]}:response()}});
 for(let i=0;i<5;i++)await source.load('C'+i+'USDT','1h');assert.equal(source.size(),3);
 await assert.rejects(source.load('BTC;USDT','1h'),/不支援/);await assert.rejects(source.load('BTCUSDT','99h'),/不支援/);
 mode='stale';await assert.rejects(source.load('STALEUSDT','1h'),/時間過期/);
 mode='bad';await assert.rejects(source.load('BADUSDT','1h'),/不足或期別缺漏/);assert.equal(source.size(),3);
});

test('closing a candle detail cancels its reader without cancelling the same main-chart request',async()=>{
 let resolveFetch,calls=0;const feed=globalThis.OXPublicFeed.create({intervalMs:0,fetcher:()=>{calls++;return new Promise(resolve=>resolveFetch=resolve);}});
 const detail=createAssetCandleSource({feed,api:null,now:()=>timestamp}),controller=new AbortController();
 const task=detail.load('ETHUSDT','1h',controller.signal);
 const main=feed.json('https://api.bitget.com/api/v2/mix/market/candles?symbol=ETHUSDT&productType=USDT-FUTURES&granularity=1H&limit=200',{owner:'chart',priority:100});
 controller.abort();await assert.rejects(task,{name:'AbortError'});
 resolveFetch({ok:true,status:200,json:async()=>response()});assert.equal((await main).code,'00000');assert.equal(calls,1);assert.equal(detail.size(),0);
});

test('live candle updates preserve an inspected historical range and zoom',()=>{
 const old=new Map(),set=(key,value)=>{old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
 const callbacks=new Map(),events={},ranges=[];let serial=0;
 set('document',{body:{classList:{contains:()=>false}},addEventListener(){}});set('ResizeObserver',class{observe(){}disconnect(){}});set('devicePixelRatio',1);
 set('requestAnimationFrame',fn=>{const id=++serial;callbacks.set(id,fn);return id;});set('cancelAnimationFrame',id=>callbacks.delete(id));
 const ctx=new Proxy({},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
 const canvas={clientWidth:400,clientHeight:240,style:{},getContext:()=>ctx,addEventListener:(name,fn)=>events[name]=fn,setPointerCapture(){}};
 const draw=()=>{const entries=[...callbacks.entries()];callbacks.clear();for(const [,fn] of entries)fn();};
 try{
  const row={candles:candles(response())},chart=candleChart(canvas,row,{interactive:true,onRange:r=>ranges.push(r)});draw();
  events.wheel({preventDefault(){},deltaY:-100});draw();
  events.pointerdown({pointerId:1,clientX:100,clientY:50});events.pointermove({pointerId:1,clientX:160,clientY:50});events.pointerup({pointerId:1});draw();
  const before=ranges.at(-1);chart.update({candles:[...row.candles,{...row.candles.at(-1),time:row.candles.at(-1).time+3600}]});draw();
  const after=ranges.at(-1);assert.equal(after.count,before.count);assert.ok(Math.abs(after.stop-before.stop)<=1,'refresh preserves the inspected historical candles');chart.destroy();assert.equal(callbacks.size,0);
 }finally{for(const [key,value] of old)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];}
});
