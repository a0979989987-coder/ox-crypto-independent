import '../../../core/public-feed.js';
import { ASSET_PERIODS } from './asset-candles.js';
import { verifiedSectorUniverse } from './sector-taxonomy.js';
// A bounded foreground refresh. No browser-wide polling or fabricated history.
const BITGET_API = 'https://api.bitget.com';
async function bitget(path, signal, transport) {
  const body = await globalThis.OXPublicFeed.json(BITGET_API+path,{signal,timeoutMs:10000,...transport});
  if (body.code !== '00000' || !Array.isArray(body.data)) throw new Error('Bitget 資料格式不符');
  return body;
}
// The shared public feed already spaces starts and backs off on 429. Five
// workers fill its background slots while reserving the sixth for interaction.
async function scanSymbols(symbols,signal,visit,onDone){
 let cursor=0,done=0;
 await Promise.all(Array.from({length:Math.min(5,symbols.length)},async()=>{
  while(cursor<symbols.length){if(signal.aborted)throw new DOMException('Aborted','AbortError');
   const symbol=symbols[cursor++];await visit(symbol);if(signal.aborted)throw new DOMException('Aborted','AbortError');
   onDone(++done,symbols.length);
  }
 }));
}
function sectorSymbols(snapshot){
 const volume=new Map((snapshot.tickers||[]).map(t=>[t.symbol,Number(t.usdtVolume)||0]));
 const groups=snapshot.sectors.map(s=>[...s.members].sort((a,b)=>(volume.get(b)||0)-(volume.get(a)||0)));
 const leading=groups.flatMap(g=>g.slice(0,2));
 return [...new Set(['BTCUSDT',...leading,...groups.flat()])];
}
export function freshPeriodCandles(value,now,age=300000){
 return Boolean(value?.nativePeriod&&value.nativePeriod===value.period&&value.scan?.complete===true&&value.candles?.BTCUSDT?.response?.data?.length&&now-Number(value.requestTime)>=-10000&&now-Number(value.requestTime)<(Object.values(value.candles).some(e=>e.error)?20000:age));
}
export async function refreshPeriodCandles(snapshot,{signal,onProgress=()=>{},onPartial=()=>{},transport={owner:'analytics-period',priority:70}}){
 const period=snapshot.period,granularity=ASSET_PERIODS[period]?.[0];
 if(!granularity||period==='1d')throw Error('Unsupported rotation period');
 const symbols=sectorSymbols(snapshot),candles={};
 await scanSymbols(symbols,signal,async symbol=>{
  const path=`/api/v2/mix/market/candles?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&granularity=${granularity}&limit=32`;
  try{const response=await bitget(path,signal,transport);candles[symbol]=response.data.length>=3?{path,response}:{path,error:'K 線不足'};}
  catch(error){if(error.name==='AbortError')throw error;candles[symbol]={path,error:error.message};}
 },(done,total)=>{onPartial({period,nativePeriod:period,candles:{...candles},scan:{done,total,complete:false}});onProgress(done,total);});
 return {period,nativePeriod:period,candles,requestTime:Number(candles.BTCUSDT?.response?.requestTime),scan:{done:symbols.length,total:symbols.length,complete:true},captureCompletedAt:new Date().toISOString()};
}
export async function refreshMarket(snapshot,{signal,onProgress=()=>{},onPartial=()=>{},transport={owner:'analytics',priority:20}}){
  const [contracts,quote]=await Promise.all([
    bitget('/api/v3/market/instruments?category=USDT-FUTURES',signal,transport),
    bitget('/api/v2/mix/market/tickers?productType=USDT-FUTURES',signal,transport)
  ]);
  const verified=verifiedSectorUniverse(contracts.data,quote.data);
  if(!verified.symbols.includes('BTCUSDT')||!verified.tickers.some(t=>t.symbol==='BTCUSDT'))throw new Error('BTC 基準行情暫時無法確認');
  // Keep the already loaded cohort responsive, then add newly verified coins.
  const order=new Map();for(const symbol of ['BTCUSDT',...snapshot.tickers.map(t=>t.symbol),...verified.symbols])if(!order.has(symbol))order.set(symbol,order.size);
  const symbols=[...verified.symbols].sort((a,b)=>(order.get(a)??Infinity)-(order.get(b)??Infinity));
  const tickers=symbols.map(symbol=>verified.tickers.find(t=>t.symbol===symbol));
  const instruments=symbols.map(symbol=>verified.instruments.find(i=>i.symbol===symbol)).filter(Boolean);
  const candles={};
  await scanSymbols(symbols,signal,async s=>{
    const path=`/api/v2/mix/market/candles?symbol=${encodeURIComponent(s)}&productType=USDT-FUTURES&granularity=15m&limit=200`;
    try{const response=await bitget(path,signal,transport);candles[s]=response.data.length>=20?{path,response}:{path,error:'有效 K 線不足'};}
    catch(error){if(error.name==='AbortError')throw error;candles[s]={path,error:error.message};}
  },(done,total)=>{
    onPartial({...snapshot,kind:'partial-refresh',instruments,tickers,sectors:verified.sectors,
      previousTickers:snapshot.tickers,candles:{...snapshot.candles,...candles},requestTime:Number(quote.requestTime),scan:{done,total,complete:false}});
    onProgress(done,total);
  });
  return {...snapshot,kind:'foreground-refresh',scan:{done:symbols.length,total:symbols.length,complete:true},
    instruments,previousTickers:snapshot.tickers,tickers,sectors:verified.sectors,candles,
    requestTime:Number(quote.requestTime),captureCompletedAt:new Date().toISOString()};
}
// Daily rotation needs real daily candles. The 200×15m pool covers ~50 hours,
// which cannot produce an eight-day replay. Fetch this only when 1D is opened.
export async function refreshDailyCandles(snapshot,{signal,onProgress=()=>{},onPartial=()=>{},transport={owner:'analytics',priority:15}}){
  const symbols=sectorSymbols(snapshot);
  const dailyCandles={};
  await scanSymbols(symbols,signal,async symbol=>{
    const count=Math.min(370,Math.max(32,(snapshot.historyDays||7)+3));
    const path=`/api/v2/mix/market/candles?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&granularity=1Dutc&limit=${Math.min(200,count)}`;
    try{
      const response=await bitget(path,signal,transport);let data=response.data;
      // Providers can return fewer candles than the requested page size.
      // Keep paging backwards until the requested calendar window is covered.
      for(let page=0;data.length<count&&data.length&&page<6;page++){
        const oldest=Math.min(...data.map(row=>Number(row[0])));
        const olderPath=`/api/v2/mix/market/history-candles?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&granularity=1Dutc&limit=200&endTime=${oldest-1}`;
        let older;
        try{older=await bitget(olderPath,signal,transport);}
        catch(error){if(error.name==='AbortError')throw error;break;}
        const combined=[...new Map([...older.data,...data].map(row=>[Number(row[0]),row])).values()].sort((a,b)=>Number(a[0])-Number(b[0])).slice(-count);
        if(!older.data.length||Math.min(...combined.map(row=>Number(row[0])))>=oldest)break;
        data=combined;
      }
      dailyCandles[symbol]=data.length>=3?{path,response:{...response,data}}:{path,error:'日 K 線不足'};
    }
    catch(error){if(error.name==='AbortError')throw error;dailyCandles[symbol]={path,error:error.message};}
  },(done,total)=>{onPartial({dailyCandles:{...dailyCandles},scan:{done,total,complete:false}});onProgress(done,total);});
  return {dailyCandles,historyDays:snapshot.historyDays||7,scan:{done:symbols.length,total:symbols.length,complete:true},captureCompletedAt:new Date().toISOString()};
}
