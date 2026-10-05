import '../../../core/public-feed.js';
// A bounded foreground refresh. No browser-wide polling or fabricated history.
const BITGET_API = 'https://api.bitget.com';
async function bitget(path, signal) {
  const body = await globalThis.OXPublicFeed.json(BITGET_API+path,{signal,owner:'analytics',priority:20});
  if (body.code !== '00000' || !Array.isArray(body.data)) throw new Error('Bitget 資料格式不符');
  return body;
}
const delay=(ms,signal)=>new Promise((resolve,reject)=>{
  const id=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
  function abort(){clearTimeout(id);reject(new DOMException('Aborted','AbortError'));}
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
});
export async function refreshMarket(snapshot,{signal,onProgress=()=>{}}){
  const symbols=snapshot.tickers.map(t=>t.symbol);
  const quote=await bitget('/api/v2/mix/market/tickers?productType=USDT-FUTURES',signal);
  const tickers=symbols.map(s=>quote.data.find(t=>t.symbol===s));
  if(tickers.some(t=>!t))throw new Error('觀察池部分幣種缺少最新行情');
  const candles={};
  for(let i=0;i<symbols.length;i++){
    if(i)await delay(160,signal);
    const s=symbols[i];
    const path=`/api/v2/mix/market/candles?symbol=${encodeURIComponent(s)}&productType=USDT-FUTURES&granularity=15m&limit=200`;
    const response=await bitget(path,signal);
    if(response.data.length<100)throw new Error(`${s} K 線不足，保留舊快照`);
    candles[s]={path,response};onProgress(i+1,symbols.length);
  }
  return {...snapshot,kind:'foreground-refresh',previousTickers:snapshot.tickers,tickers,candles,requestTime:Number(quote.requestTime),captureCompletedAt:new Date().toISOString()};
}
