import '../../../core/public-feed.js';
import { TIMEFRAMES, candleBoundary } from './catalog.js?v=patterns5d-20260929';
import '../liquidity-policy.js?v=20261002-rank8';
import { evaluateClassic, compareClassic, compactClassic, CLASSIC_TIER_LIMITS } from '../../../core/classic.js?v=20261002-rank8';
const BASE='https://api.bitget.com';
const candleCache=new Map();
const abortError=()=>new DOMException('Aborted','AbortError');
function wait(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted)return reject(abortError());const id=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);function cancel(){clearTimeout(id);reject(abortError());}signal?.addEventListener('abort',cancel,{once:true});});}
async function request(path,signal,transport={}){
  const json=await globalThis.OXPublicFeed.json(BASE+path,{signal,owner:'patterns',priority:10,...transport});
  if(json.code!=='00000'||!Array.isArray(json.data))throw Error(`Bitget ${json.code||'格式錯誤'}`);
  return json;
}
export function parseCandles(rows,frame,serverTime,{includeOpen=false}={}){
  const seconds=TIMEFRAMES[frame],map=new Map();if(!seconds||!Number.isFinite(serverTime))return [];
  const boundary=candleBoundary(serverTime,frame);
  const times=[...new Set(rows.map(r=>Number(r[0])).filter(Number.isFinite))].sort((a,b)=>a-b);
  if(times.some((t,i)=>i&&(t-times[i-1])%(seconds*1000)!==0))return [];
  for(const row of rows){
    if(row.length<7||row[5]==null||row[6]==null||row[5]===''||row[6]==='')continue;
    const [ms,open,high,low,close,volume,quoteVolume]=row.map(Number),time=ms/1000;
    const provisional=time===boundary&&time+seconds>serverTime/1000;
    if(![ms,open,high,low,close,volume,quoteVolume].every(Number.isFinite)||(time-boundary)%seconds||open<=0||close<=0||low<=0||high<Math.max(open,close)||low>Math.min(open,close)||high<low||volume<0||quoteVolume<0||time>serverTime/1000||provisional&&!includeOpen||!provisional&&ms+seconds*1000>serverTime)continue;
    map.set(time,{time,open,high,low,close,volume,quoteVolume,...(provisional?{provisional:true}:{})});
  }
  const sorted=[...map.values()].sort((a,b)=>a.time-b.time);
  // Only the most recent uninterrupted run is eligible; never fill gaps with invented candles.
  let start=0;for(let i=1;i<sorted.length;i++)if(sorted[i].time-sorted[i-1].time!==seconds)start=i;
  const tail=sorted.slice(start);
  if(!tail.length||tail.at(-1).time+seconds<boundary)return [];
  return tail;
}
export function selectUniverse(tickers,instruments,limit=80){
  const allowed=new Set(instruments.filter(i=>i.symbolType==='crypto'&&i.type==='perpetual'&&i.status==='online'&&i.quoteCoin==='USDT').map(i=>i.symbol));
  return tickers.filter(t=>allowed.has(t.symbol)&&Number(t.usdtVolume)>0&&Number(t.lastPr)>0).sort((a,b)=>Number(b.usdtVolume)-Number(a.usdtVolume)).slice(0,limit||Infinity);
}
export function radarCandidates(runtime=typeof state==='undefined'?null:state){
  if(runtime?.activeMarket&&runtime.activeMarket!=='crypto')return [];
  const seen=new Set();
  return ['t1','t2','t3'].flatMap((tier,i)=>(runtime?.tierMap?.[tier]||[]).slice(0,CLASSIC_TIER_LIMITS[tier.toUpperCase()]).flatMap((r,rank)=>{
    if(!r.symbol||seen.has(r.symbol))return [];
    seen.add(r.symbol);return [{symbol:r.symbol,tier:i+1,rank,side:r.side}];
  }));
}
export function radarSymbols(runtime=typeof state==='undefined'?null:state){return radarCandidates(runtime).map(r=>r.symbol);}
export async function fetchUniverse(signal,limit=80,transport={}){
  const [quotes,metadata]=await Promise.all([request('/api/v2/mix/market/tickers?productType=USDT-FUTURES',signal,transport),request('/api/v3/market/instruments?category=USDT-FUTURES',signal,transport)]);
  const serverTime=Number(quotes.requestTime);
  if(!Number.isFinite(serverTime)||Math.abs(Date.now()-serverTime)>300000)throw Error('行情時間戳過期，請稍後重試');
  const eligible=selectUniverse(quotes.data,metadata.data,0),radar=new Set(radarSymbols());
  const selected=selectUniverse(quotes.data,metadata.data,limit);
  const tickers=[...eligible.filter(t=>radar.has(t.symbol)),...selected.filter(t=>!radar.has(t.symbol))].sort((a,b)=>
    Number(radar.has(b.symbol))-Number(radar.has(a.symbol))||
    Number(Number(b.usdtVolume)>=3000000)-Number(Number(a.usdtVolume)>=3000000)||
    Math.abs(Number(b.change24h))-Math.abs(Number(a.change24h))||Number(b.usdtVolume)-Number(a.usdtVolume));
  if(!tickers.length)throw Error('沒有符合流動性條件的加密合約');
  const allowed=new Set(metadata.data.filter(i=>i.symbolType==='crypto'&&i.type==='perpetual'&&i.status==='online'&&i.quoteCoin==='USDT').map(i=>i.symbol));
  return {tickers,allTickers:quotes.data.filter(t=>allowed.has(t.symbol)&&[t.lastPr,t.change24h,t.usdtVolume].every(v=>v!==''&&Number.isFinite(Number(v)))),serverTime};
}
export async function fetchSeries(symbol,frame,signal,now=Date.now(),transport={}){
  const key=`${symbol}:${frame}`,cached=candleCache.get(key),boundary=candleBoundary(now,frame);
  if(cached?.candles.at(-1)?.provisional?cached.candles.at(-1).time===boundary&&now-cached.serverTime<300000:cached?.candles.at(-1)?.time+TIMEFRAMES[frame]===boundary)return cached;
  // The native radar already obtains real 1H/4H observations. Reuse those
  // responses when current instead of downloading the same series again.
  const shared=typeof BitgetAPI!=='undefined'?BitgetAPI.peekCandles?.(symbol,frame,now):null;
  if(shared&&candleBoundary(shared.serverTime,frame)===boundary){
    const candles=parseCandles(shared.candles.map(c=>[c.time*1000,c.open,c.high,c.low,c.close,c.volume,c.quoteVolume]),
      frame,shared.serverTime,{includeOpen:frame==='1W'}).slice(-200);
    if(candles.length>=35){const value={...shared,candles,source:'Bitget'};candleCache.set(key,value);return value;}
  }
  const granularity=['6H','12H','1D','1W'].includes(frame)?frame+'utc':frame;
  const path=`/api/v2/mix/market/candles?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&granularity=${granularity}&limit=200`;
  const data=await request(path,signal,transport),serverTime=Number(data.requestTime);
  let rows=data.data;
  if(frame==='1W'){
    // The recent endpoint returns only about 90 days (13 weeks). Page real history,
    // preserving UTC week boundaries; never synthesize candles from chart shapes.
    const historical=(cached?.candles||[]).filter(c=>!c.provisional).map(c=>[c.time*1000,c.open,c.high,c.low,c.close,c.volume,c.quoteVolume]);
    rows=[...historical,...rows];
    for(let page=0;page<7&&new Set(rows.map(r=>Number(r[0]))).size<80;page++){
      const earliest=Math.min(...rows.map(r=>Number(r[0])));if(!Number.isFinite(earliest))break;
      const past=await request(`/api/v2/mix/market/history-candles?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&granularity=1Wutc&limit=200&endTime=${earliest}`,signal,transport);
      const older=past.data.filter(r=>Number(r[0])<earliest);if(!older.length)break;
      rows=[...older,...rows];
    }
  }
  const candles=parseCandles(rows,frame,serverTime,{includeOpen:frame==='1W'}).slice(-200);
  if(Math.abs(now-serverTime)>300000||candles.length<35)throw Error(`${symbol} ${frame} K 線不足或缺漏`);
  const value={candles,source:'Bitget',frame,symbol,serverTime};candleCache.set(key,value);
  if(candleCache.size>1200)candleCache.delete(candleCache.keys().next().value);
  return value;
}
export function primeCandleCache(data){
  if(data?.candles?.length>=35&&TIMEFRAMES[data.frame])candleCache.set(`${data.symbol}:${data.frame}`,data);
}
export function classicScore(ticker,candles,tickers){
  const signals=['long','short'].map(side=>globalThis.OXCryptoLiquidity.apply(evaluateClassic(candles,{side}),ticker?.usdtVolume));
  return signals.filter(s=>s.eligible).sort(compareClassic)[0]?.qualityScore ?? null;
}
export async function scanUniverse(universe,frames,{signal,onSeries,onProgress,concurrency=4,transport={}}){
  let cursor=0,done=0,failed=0,coinsDone=0;const total=universe.tickers.length*frames.length,coinsTotal=universe.tickers.length;
  const jobs=universe.tickers.map(ticker=>async()=>{
    for(const frame of frames){
      if(signal.aborted)throw abortError();
      try{
        const data=await fetchSeries(ticker.symbol,frame,signal,universe.serverTime,transport);
        const classic=Object.fromEntries(['long','short'].map(side=>[side,compactClassic(globalThis.OXCryptoLiquidity.apply(evaluateClassic(data.candles,{side,frame,now:universe.serverTime}),ticker.usdtVolume))]));
        const chosen=Object.values(classic).filter(s=>s.eligible).sort(compareClassic)[0];
        await onSeries({...data,ticker,classic,oxScore:chosen?.qualityScore??null,quoteTime:universe.serverTime,turnover:Number(ticker.usdtVolume),change:Number(ticker.change24h)*100});
      }catch(e){if(signal.aborted)throw e;failed++;}
      done++;onProgress({done,total,failed,coinsDone,coinsTotal});
    }
    coinsDone++;onProgress({done,total,failed,coinsDone,coinsTotal});
  });
  await Promise.all(Array.from({length:Math.max(1,Math.min(4,concurrency))},async()=>{while(cursor<jobs.length){if(signal.aborted)throw abortError();const job=jobs[cursor++];await job();}}));
  return {done,total,failed};
}
