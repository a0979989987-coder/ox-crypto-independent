import { rankingSignal } from './classic-fixtures.mjs';
import { OXClassicForTests } from './classic-test-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const read=path=>readFileSync(new URL('../src/markets/crypto/'+path,import.meta.url),'utf8');
const [api,scanner,engine,policy]=['api.js','scanner.js','engine.js','liquidity-policy.js'].map(read);

test('daily, weekly and monthly candles request Bitget UTC sessions',async()=>{
 const urls=[];
 const context={CONFIG:{apiBase:'https://api.bitget.com/api/v2/mix/market',productType:'USDT-FUTURES'},num:Number,state:{},
  OXPublicFeed:{json:async url=>{urls.push(new URL(url));return {code:'00000',requestTime:Date.now(),data:[[String(Date.UTC(2026,9,12)),'1','2','0.5','1.5','10','15']]};}}};
 context.globalThis=context;
 const BitgetAPI=runInNewContext(`${api}\nBitgetAPI`,context);
 for(const [frame,expected] of [['1D','1Dutc'],['1W','1Wutc'],['1M','1Mutc'],['4H','4H'],['1H','1H'],['1Dutc','1Dutc']]){
  await BitgetAPI.fetchCandles('BTCUSDT',frame,10);
  assert.equal(urls.at(-1).searchParams.get('granularity'),expected,frame);
 }
 await BitgetAPI.fetchCandles('BTCUSDT','1W',200,Date.UTC(2026,5,1));
 assert.match(urls.at(-1).pathname,/history-candles$/);assert.equal(urls.at(-1).searchParams.get('granularity'),'1Wutc');
 assert.equal(BitgetAPI.peekCandles('BTCUSDT','1D').frame,'1D','observations keep the requested frame name');
});

test('a missing daily or weekly frame keeps the setup out of T1 even with ample turnover',()=>{
 const context={OXClassic:OXClassicForTests,num:Number,state:{}};
 const result=runInNewContext(`${policy}\n${engine}\n${scanner}\nconst gap=markDataGap(signal,'日線 K 線暫缺');({gap,priced:OXCryptoLiquidity.apply(gap,15000000)})`,{...context,signal:{...rankingSignal('T1'),qualityScore:95}});
 assert.equal(result.gap.tier,'T2');assert.equal(result.gap.dataGap,'日線 K 線暫缺');
 assert.equal(result.priced.tier,'T2','turnover cannot promote a data-gap setup back to T1');
 assert.ok(result.gap.reasons.some(r=>/不列 T1/.test(r)));
});

test('weekly context is fetched once per UTC week and pages history until enough closed weeks exist',async()=>{
 const week=604800,monday=Date.UTC(2026,9,12)/1000,calls=[];
 const bars=(end,count)=>Array.from({length:count},(_,i)=>{const time=end-(count-1-i)*week;return {time,open:10,high:12,low:9,close:11,volume:5,quoteVolume:50};});
 const BitgetAPI={fetchCandles:async(symbol,frame,limit,endTime)=>{calls.push({frame,endTime});return endTime?bars(endTime/1000-week,20):bars(monday,13);}};
 const context={OXClassic:OXClassicForTests,num:Number,state:{},BitgetAPI,Date};
 const run=code=>runInNewContext(`${policy}\n${engine}\n${scanner}\n${code}`,context);
 const now=Date.UTC(2026,9,15,4)*1;
 const first=await run(`(async()=>{const a=await fetchWeeklyContext('SOLUSDT',${now});const b=await fetchWeeklyContext('SOLUSDT',${now+3*86400000});return {a:a.length,b:b.length,same:a===b,next:nextUtcWeek(${now})};})()`);
 assert.ok(first.a>=40,'enough closed weekly bars after paging');assert.equal(first.same,true,'cached until the next weekly open');
 assert.equal(first.next,Date.UTC(2026,9,19)/1000,'next Monday 00:00 UTC');
 assert.ok(calls.every(c=>c.frame==='1W'));assert.ok(calls.length<=4,'one recent request plus at most three history pages');
 assert.equal(calls.filter(c=>c.endTime).length,calls.length-1);
});

test('a cancelled weekly request is not cached as a data gap; a real failure is retried after 5 minutes',async()=>{
 let mode='abort',calls=0;
 const BitgetAPI={fetchCandles:async()=>{calls++;if(mode==='abort')throw new DOMException('行情工作已取消','AbortError');if(mode==='fail')throw Error('HTTP 503');return [];}};
 const context={OXClassic:OXClassicForTests,num:Number,state:{},BitgetAPI,Date,DOMException};
 const result=await runInNewContext(`${policy}\n${engine}\n${scanner}\n(async()=>{const now=Date.UTC(2026,9,15);
  await fetchWeeklyContext('ETHUSDT',now).catch(()=>{});await Promise.resolve();const afterAbort=weeklyContext.has('ETHUSDT');
  setMode('ok');await fetchWeeklyContext('ETHUSDT',now);const refetched=callCount();
  weeklyContext.clear();setMode('fail');await fetchWeeklyContext('BTCUSDT',now).catch(()=>{});await Promise.resolve();
  const failure=weeklyContext.get('BTCUSDT');return {afterAbort,refetched,retryInSeconds:failure&&failure.until-now/1000};})()`,
  Object.assign(context,{setMode:v=>{mode=v;},callCount:()=>calls}));
 assert.equal(result.afterAbort,false,'abort drops the cache entry');
 assert.equal(result.refetched,2,'the next scan requests the weekly bars again');
 assert.equal(result.retryInSeconds,300);
});
