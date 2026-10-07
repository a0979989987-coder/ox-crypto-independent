import '../../../core/public-feed.js';

export const ASSET_PERIODS = Object.freeze({
  '1m':['1m',60], '5m':['5m',300], '15m':['15m',900], '30m':['30m',1800],
  '1h':['1H',3600], '2h':['2H',7200], '4h':['4H',14400], '6h':['6Hutc',21600],
  '12h':['12Hutc',43200], '1d':['1Dutc',86400], '1w':['1Wutc',604800]
});

// Small public-only cache. In-flight deduplication and reader cancellation belong
// to OXPublicFeed, which is also used by the main chart and market scans.
export function createAssetCandleSource({feed=globalThis.OXPublicFeed,
  api=typeof BitgetAPI==='undefined'?null:BitgetAPI,now=Date.now,maxEntries=24,maxAge=15000}={}) {
  const cache=new Map();
  function valid(value,symbol,period) {
    const serverTime=Number(value.serverTime);
    if(!Number.isFinite(serverTime)||Math.abs(now()-serverTime)>300000)throw Error('K 線來源時間過期，請重試');
    const unique=new Map();
    for(const c of value.candles||[]) {
      const {time,open,high,low,close}=c;
      if(![time,open,high,low,close].every(Number.isFinite)||time*1000>serverTime||
        Math.min(open,low,close)<=0||high<Math.max(open,close)||low>Math.min(open,close))continue;
      unique.set(time,c);
    }
    const candles=[...unique.values()].sort((a,b)=>a.time-b.time);
    const seconds=ASSET_PERIODS[period][1];let start=0;
    for(let i=1;i<candles.length;i++)if(candles[i].time-candles[i-1].time!==seconds)start=i;
    const tail=candles.slice(start);
    if(tail.length<2||serverTime/1000-tail.at(-1).time>seconds*2)throw Error('K 線不足或期別缺漏，請重試');
    return {symbol,period,serverTime,candles:tail,source:'Bitget'};
  }
  return {
    async load(symbol,period,signal) {
      if(signal?.aborted)throw new DOMException('Aborted','AbortError');
      if(!/^[A-Z0-9]+USDT$/.test(symbol)||!ASSET_PERIODS[period])throw Error('不支援的幣種或 K 線級別');
      const key=symbol+':'+period,timestamp=now(),cached=cache.get(key);
      if(cached&&timestamp-cached.serverTime>=0&&timestamp-cached.serverTime<maxAge){cache.delete(key);cache.set(key,cached);return cached;}
      const granularity=ASSET_PERIODS[period][0],shared=api?.peekCandles?.(symbol,granularity,timestamp);
      let value;
      if(shared&&timestamp-shared.serverTime>=0&&timestamp-shared.serverTime<maxAge)value=shared;
      else if(api?.fetchCandles) {
        const candles=await api.fetchCandles(symbol,granularity,200,null,{signal,owner:'analytics-detail',priority:100,timeoutMs:12000});
        value={candles,serverTime:api.peekCandles?.(symbol,granularity,now())?.serverTime};
      } else {
        const url=`https://api.bitget.com/api/v2/mix/market/candles?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&granularity=${granularity}&limit=200`;
        const json=await feed.json(url,{signal,owner:'analytics-detail',priority:100,timeoutMs:12000});
        if(json.code!=='00000'||!Array.isArray(json.data))throw Error('Bitget K 線資料格式錯誤');
        value={serverTime:json.requestTime,candles:json.data.map(r=>{
          const [ms,open,high,low,close,volume,quoteVolume]=r.map(Number);
          return {time:ms/1000,open,high,low,close,volume,quoteVolume};
        })};
      }
      if(signal?.aborted)throw new DOMException('Aborted','AbortError');
      const result=valid(value,symbol,period);cache.delete(key);cache.set(key,result);
      while(cache.size>maxEntries)cache.delete(cache.keys().next().value);
      return result;
    },
    size:()=>cache.size
  };
}
