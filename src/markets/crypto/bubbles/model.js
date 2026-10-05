export const METRICS = [['change','漲幅'],['volume','成交量'],['cap','市值'],['flow','大資金灌入'],['score','OX 評分']];
export const LARGE_TRADE = 10000;
export function finite(v) { return v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null; }
export function largeTradeFlow(records, now = Date.now()) {
  const trades = new Map();
  for (const r of records || []) {
    const price=finite(r.price), size=finite(r.size), ts=finite(r.ts), side=String(r.side).toLowerCase();
    if (!r.tradeId || !(price>0 && size>0) || !ts || ts>now+5000 || ts<now-300000 || !['buy','sell'].includes(side)) continue;
    trades.set(String(r.tradeId), { amount:price*size, side, ts });
  }
  if (!trades.size) return null;
  let buy=0, sell=0, count=0;
  for (const r of trades.values()) if (r.amount>=LARGE_TRADE) { count++; if(r.side==='buy')buy+=r.amount;else sell+=r.amount; }
  return { value:buy-sell, buy, sell, count, trades:trades.size, from:Math.min(...[...trades.values()].map(r=>r.ts)), to:Math.max(...[...trades.values()].map(r=>r.ts)) };
}
const aliases={'1000SHIB':'SHIB','1000PEPE':'PEPE','1000BONK':'BONK','1000SATS':'SATS'};
export function canonical(base) { return aliases[base] || base; }
const known={BTC:'bitcoin',ETH:'ethereum',SOL:'solana',XRP:'ripple',BNB:'binancecoin',DOGE:'dogecoin',ADA:'cardano',TRX:'tron',LINK:'chainlink',SUI:'sui',AVAX:'avalanche-2',DOT:'polkadot',LTC:'litecoin',BCH:'bitcoin-cash',NEAR:'near',ARB:'arbitrum',OP:'optimism',APT:'aptos',UNI:'uniswap',PEPE:'pepe',SHIB:'shiba-inu',BONK:'bonk',HYPE:'hyperliquid',ZEC:'zcash',QNT:'quant-network',TON:'the-open-network',TAO:'bittensor',ICP:'internet-computer',ONDO:'ondo-finance',WLD:'worldcoin-wld',FET:'fetch-ai',JUP:'jupiter-exchange-solana',PUMP:'pump-fun'};
export function matchCap(base, price, caps, now=Date.now()) {
  const name=canonical(base), matches=caps.filter(c=>String(c.symbol).toUpperCase()===name);
  const candidate=known[name]?matches.find(c=>c.id===known[name]):matches.length===1?matches[0]:null;
  const stamp=Date.parse(candidate?.last_updated), spot=finite(candidate?.current_price), contract=price/(aliases[base]?1000:1);
  if(!candidate || !(spot>0) || Math.abs(contract/spot-1)>.3 || !stamp || now-stamp>30*60000 || stamp>now+60000 || !(finite(candidate.market_cap)>=0) || finite(candidate.market_cap)===null) return null;
  return candidate;
}
export function bubbleRows(tickers, {analyses=new Map(), caps=[], flows=new Map(), metric='change', direction='both', query='', watch=null, limit=50, now=Date.now()}={}) {
  const rows=tickers.flatMap(t=>{
    const price=finite(t.lastPr), change=finite(t.change24h), volume=finite(t.usdtVolume), stamp=finite(t.ts);
    if(!(price>0 && volume>0) || change===null || !stamp || now-stamp>60000 || stamp>now+10000) return [];
    const base=t.baseCoin || t.symbol.replace(/USDT$/,''), analysis=analyses.get(t.symbol), cap=matchCap(base,price,caps,now), flow=flows.get(t.symbol);
    const freshFlow=flow && now-flow.at<45000 ? flow : null;
    const values={change:change*100,volume,cap:cap?.market_cap??null,flow:freshFlow?.value??null,score:finite(analysis?.oxScore)};
    const value=values[metric],signed=metric==='flow'?values.flow:change;
    if(value===null || (direction==='long'&&!(signed>0)) || (direction==='short'&&!(signed<0)) || (watch&&!watch.has(t.symbol)) || (query&&!base.toUpperCase().includes(query.toUpperCase())))return [];
    return [{symbol:t.symbol,base,price,change:change*100,volume,cap:cap?.market_cap??null,capTime:cap?.last_updated,score:values.score,flow:freshFlow,value,image:cap?.image,stamp}];
  });
  return rows.sort((a,b)=>metric==='change'||metric==='flow'?Math.abs(b.value)-Math.abs(a.value)||a.symbol.localeCompare(b.symbol):b.value-a.value||a.symbol.localeCompare(b.symbol)).slice(0,limit);
}
export function metricText(value,metric) {
  if(!Number.isFinite(value))return '—';
  if(metric==='change')return `${value>0?'+':''}${value.toFixed(2)}%`;
  if(metric==='score')return `OX ${Math.round(value)}`;
  const n=Math.abs(value), unit=n>=1e12?'T':n>=1e9?'B':n>=1e6?'M':n>=1e3?'K':'',scale=unit==='T'?1e12:unit==='B'?1e9:unit==='M'?1e6:unit==='K'?1e3:1;
  return `${metric==='cap'?'$':''}${value<0?'−':metric==='flow'&&value>0?'+':''}${(n/scale).toFixed(n>=1000?1:0)}${unit}`;
}
export function radiusTargets(rows,width,height) {
  if(!rows.length)return [];
  const values=rows.map(r=>Math.log1p(Math.abs(r.value))),low=Math.min(...values),high=Math.max(...values),min=width<500?11:14,peak=Math.min(width,height)*.23;
  // Compare the displayed value range, retaining equal sizes for equal data.
  // A log scale keeps cap/volume outliers readable without flattening nearby values.
  const weights=values.map(v=>high===low?1:.14+.86*Math.pow((v-low)/(high-low),1.1));
  const area=width*height*.52, sum=weights.reduce((a,b)=>a+b,0);
  return weights.map(w=>Math.max(min,Math.min(peak,Math.sqrt(area*w/sum/Math.PI))));
}
