import '../../../core/public-feed.js';
const API='https://api.bitget.com';
export async function json(url,signal) {
  return globalThis.OXPublicFeed.json(url,{signal,owner:'bubbles',priority:30});
}
let capCache=null;
export async function fetchCaps(signal) {
  if(capCache&&Date.now()-capCache.at<300000)return capCache.rows;
  const rows=await json('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false',signal);
  if(!Array.isArray(rows)||!rows.length)throw Error('市值資料暫時無法取得');capCache={at:Date.now(),rows};return rows;
}
export async function fetchQuotes(signal) {
  const [quotes,instruments]=await Promise.all([json(API+'/api/v2/mix/market/tickers?productType=USDT-FUTURES',signal),json(API+'/api/v3/market/instruments?category=USDT-FUTURES',signal)]);
  if(quotes.code!=='00000'||instruments.code!=='00000'||!Array.isArray(quotes.data)||!Array.isArray(instruments.data))throw Error('行情資料暫時無法取得');
  const allowed=new Map(instruments.data.filter(i=>i.symbolType==='crypto'&&i.type==='perpetual'&&i.status==='online'&&i.quoteCoin==='USDT').map(i=>[i.symbol,i]));
  return quotes.data.filter(t=>allowed.has(t.symbol)).map(t=>({...t,baseCoin:allowed.get(t.symbol).baseCoin}));
}
export async function fetchLargeTrades(symbol,signal) {
  const body=await json(API+`/api/v2/mix/market/fills?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&limit=100`,signal);
  if(body.code!=='00000'||!Array.isArray(body.data))throw Error('大單資料暫時無法取得');
  return {records:body.data,time:Number(body.requestTime)};
}
export const pause=(ms,signal)=>new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(id);reject(new DOMException('Aborted','AbortError'));};
  const id=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
});
