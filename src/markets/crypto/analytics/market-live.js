import '../../../core/public-feed.js';
import { verifiedSectorUniverse } from './sector-taxonomy.js';
// A bounded foreground refresh. No browser-wide polling or fabricated history.
const BITGET_API = 'https://api.bitget.com';
async function bitget(path, signal, transport) {
  const body = await globalThis.OXPublicFeed.json(BITGET_API+path,{signal,...transport});
  if (body.code !== '00000' || !Array.isArray(body.data)) throw new Error('Bitget 資料格式不符');
  return body;
}
const delay=(ms,signal)=>new Promise((resolve,reject)=>{
  const id=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
  function abort(){clearTimeout(id);reject(new DOMException('Aborted','AbortError'));}
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
});
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
  for(let i=0;i<symbols.length;i++){
    if(i)await delay(160,signal);
    const s=symbols[i];
    const path=`/api/v2/mix/market/candles?symbol=${encodeURIComponent(s)}&productType=USDT-FUTURES&granularity=15m&limit=200`;
    try{
      const response=await bitget(path,signal,transport);
      candles[s]=response.data.length>=20?{path,response}:{path,error:'有效 K 線不足'};
    }catch(error){if(error.name==='AbortError')throw error;candles[s]={path,error:error.message};}
    const partial={...snapshot,kind:'partial-refresh',instruments,tickers,sectors:verified.sectors,
      previousTickers:snapshot.tickers,candles:{...snapshot.candles,...candles},requestTime:Number(quote.requestTime),
      scan:{done:i+1,total:symbols.length,complete:false}};
    onPartial(partial);onProgress(i+1,symbols.length);
  }
  return {...snapshot,kind:'foreground-refresh',scan:{done:symbols.length,total:symbols.length,complete:true},
    instruments,previousTickers:snapshot.tickers,tickers,sectors:verified.sectors,candles,
    requestTime:Number(quote.requestTime),captureCompletedAt:new Date().toISOString()};
}
// Daily rotation needs real daily candles. The 200×15m pool covers ~50 hours,
// which cannot produce an eight-day replay. Fetch this only when 1D is opened.
export async function refreshDailyCandles(snapshot,{signal,onProgress=()=>{},onPartial=()=>{},transport={owner:'analytics',priority:15}}){
  const symbols=[...new Set(['BTCUSDT',...snapshot.sectors.flatMap(s=>s.members)])];
  const dailyCandles={};
  for(let i=0;i<symbols.length;i++){
    if(i)await delay(160,signal);
    const symbol=symbols[i],path=`/api/v2/mix/market/candles?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&granularity=1Dutc&limit=32`;
    try{const response=await bitget(path,signal,transport);dailyCandles[symbol]=response.data.length>=3?{path,response}:{path,error:'日 K 線不足'};}
    catch(error){if(error.name==='AbortError')throw error;dailyCandles[symbol]={path,error:error.message};}
    onPartial({dailyCandles:{...dailyCandles},scan:{done:i+1,total:symbols.length,complete:false}});
    onProgress(i+1,symbols.length);
  }
  return {dailyCandles,scan:{done:symbols.length,total:symbols.length,complete:true},captureCompletedAt:new Date().toISOString()};
}
