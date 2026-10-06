// Opt-in public market read. Capture once, then replay identical bodies and
// observed request durations through both schedulers. No credentials required.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createContext,runInContext} from 'node:vm';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
if(process.env.OX_PROFILE_LIVE!=='1')throw Error('Set OX_PROFILE_LIVE=1 to read the public Bitget API');
const root=resolve(import.meta.dirname,'..'),baseline=process.env.OX_PROFILE_BASELINE;
if(!baseline)throw Error('OX_PROFILE_BASELINE must name the unchanged comparison checkout');
const oldCode=await readFile(resolve(baseline,'src/core/public-feed.js'),'utf8'),newCode=await readFile(resolve(root,'src/core/public-feed.js'),'utf8');
const origin='https://api.bitget.com',base=origin+'/api/v2/mix/market/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function create(code,fetcher){const ctx=createContext({fetch:fetcher,URL,AbortController,DOMException,setTimeout,clearTimeout});runInContext(code,ctx);return ctx.OXPublicFeed;}
const responses=new Map(),realStarts=[],rateLimits=[];
const capture=create(newCode,async(url,options)=>{
 const start=performance.now();realStarts.push(start);
 const response=await fetch(url,options);if(response.status===429)rateLimits.push(url);const text=await response.text();const ms=performance.now()-start;
 responses.set(url,{status:response.status,ms,bytes:Buffer.byteLength(text),body:JSON.parse(text)});
 return {ok:response.ok,status:response.status,headers:response.headers,json:async()=>JSON.parse(text)};
});
const started=performance.now();
const [tickers,metadata]=await Promise.all([capture.json(base+'tickers?productType=USDT-FUTURES'),capture.json(origin+'/api/v3/market/instruments?category=USDT-FUTURES')]);
const allowed=new Set(metadata.data.filter(i=>i.symbolType==='crypto'&&i.type==='perpetual'&&i.status==='online'&&i.quoteCoin==='USDT').map(i=>i.symbol));
const universe=tickers.data.filter(t=>allowed.has(t.symbol)&&Number(t.usdtVolume)>0).sort((a,b)=>Number(b.usdtVolume)-Number(a.usdtVolume));
const selected=universe.slice(0,Number(process.env.OX_PROFILE_SYMBOLS||12)||undefined);
const urls=selected.flatMap(t=>['1H','4H','1D'].map(frame=>base+'candles?symbol='+encodeURIComponent(t.symbol)+'&productType=USDT-FUTURES&granularity='+frame+'&limit=180'));
// Keep the same six-symbol batches as the radar; never queue the entire
// market behind a 30-second reader deadline.
for(let i=0;i<urls.length;i+=18){await Promise.all(urls.slice(i,i+18).map(url=>capture.json(url,{owner:'radar-scan',priority:0})));console.log('captured',Math.min(i+18,urls.length)+'/'+urls.length);}
const captureMs=performance.now()-started;
async function replay(code){
 const queued=new Map(),rows=[],values=[];const start=performance.now();
 const f=create(code,async url=>{const record=responses.get(url),at=performance.now();await sleep(record.ms);rows.push({url,queueMs:at-queued.get(url),downloadMs:record.ms});return {ok:record.status===200,status:record.status,json:async()=>structuredClone(record.body)};});
 let firstSymbolMs;
 for(let i=0;i<urls.length;i+=18){
  await Promise.all(Array.from({length:Math.min(6,(urls.length-i)/3)},async(_,coin)=>{
   const data=await Promise.all(urls.slice(i+coin*3,i+coin*3+3).map(url=>{queued.set(url,performance.now());return f.json(url,{owner:'radar-scan',priority:0});}));
   if(firstSymbolMs===undefined)firstSymbolMs=performance.now()-start;values.push(data);
  }));
 }
 return {firstSymbolMs,completeMs:performance.now()-start,requestCount:rows.length,bytes:urls.reduce((n,u)=>n+responses.get(u).bytes,0),meanQueueMs:rows.reduce((n,r)=>n+r.queueMs,0)/rows.length,meanDownloadMs:rows.reduce((n,r)=>n+r.downloadMs,0)/rows.length,values:values.flat().map(v=>JSON.stringify(v)).sort(),rows};
}
const before=await replay(oldCode),after=await replay(newCode);assert.deepEqual(before.values,after.values);
const record={conditions:{capturedAt:new Date().toISOString(),publicLiveCapture:true,captureScheduler:'modified scheduler',replay:'same captured bodies and measured request durations; six-symbol batches; no UI or CPU emulation',universe:universe.length,sampledSymbols:selected.map(t=>t.symbol),captureMs,physicalIPhone:false,fullMarket:selected.length===universe.length},capture:{requests:responses.size,attempts:realStarts.length,rateLimited:rateLimits.length,bytes:[...responses.values()].reduce((n,r)=>n+r.bytes,0)},before:{...before,values:undefined},after:{...after,values:undefined},identicalResponses:true,dataSha256:createHash('sha256').update(before.values.join('\n')).digest('hex')};
await writeFile(resolve(root,process.env.OX_PROFILE_OUT||'docs/performance/round2-live-queue.json'),JSON.stringify(record,null,2));console.log(JSON.stringify({...record,before:{...record.before,rows:undefined},after:{...record.after,rows:undefined}},null,2));
