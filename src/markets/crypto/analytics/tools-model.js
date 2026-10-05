import { finite } from './flow-model.js';
export const TOOL_PERIODS = Object.freeze({'15m':900000,'1h':3600000,'4h':14400000,'24h':86400000});
export const ROTATION_STATES = Object.freeze([
 {id:'leading',name:'領先擴大',color:'#91c7b1'}, {id:'cooling',name:'領先降溫',color:'#cfbc91'},
 {id:'improving',name:'落後改善',color:'#9eaec4'}, {id:'lagging',name:'落後擴大',color:'#cd9399'}
]);
export const rotationState=(x,y)=>x===0||y===0?{id:'flat',name:'持平',color:'#a3acab'}:ROTATION_STATES[x>0?(y>0?0:1):(y>0?2:3)];
const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : null;
const sum = a => a.reduce((s,v)=>s+v,0);
export function candleIndex(data) {
 return new Map(Object.entries(data.candles||{}).map(([s,e])=>[s,new Map((e.response?.data||[]).filter(r=>r.length>=7 && r.slice(0,7).every(v=>finite(v)!==null) && Number(r[1])>0 && Number(r[4])>0 && Number(r[6])>=0).map(r=>[Number(r[0]),r.map(Number)]))]));
}
export function candleWindow(index,symbol,end,step) {
 const map=index.get(symbol); if(!map)return null;
 const rows=[]; for(let t=end-step;t<end;t+=900000){const r=map.get(t);if(!r)return null;rows.push(r);}
 if(!rows.length)return null;
 return {returnPct:100*(rows.at(-1)[4]/rows[0][1]-1),volume:sum(rows.map(r=>r[6])),price:rows.at(-1)[4],open:rows[0][1],end};
}
export function buildRotation(data,period='1h',wantedFrames=8) {
 const step=TOOL_PERIODS[period];if(!step)throw new Error('Unsupported rotation period');
 const index=candleIndex(data),btc=index.get('BTCUSDT');if(!btc?.size)return {frames:[],sectors:[],excluded:[],period};
 const sourceTime=Math.min(...Object.values(data.candles).filter(e=>e.response?.data?.length).map(e=>Number(e.response.requestTime)));
 const end=Math.floor(sourceTime/step)*step;
 const oldest=Math.min(...btc.keys());const frameCount=Math.max(0,Math.min(wantedFrames,Math.floor((end-oldest)/step)-1));
 const ends=Array.from({length:frameCount},(_,i)=>end-(frameCount-1-i)*step);
 const validMember=s=>ends.every(t=>candleWindow(index,s,t,step)&&candleWindow(index,s,t-step,step));
 const sectors=(data.sectors||[]).map(s=>({...s,validMembers:s.members.filter(validMember)}));
 const frames=ends.flatMap(t=>{
  const bm=candleWindow(index,'BTCUSDT',t,step),bp=candleWindow(index,'BTCUSDT',t-step,step);if(!bm||!bp)return [];
  const cohorts=sectors.filter(s=>s.validMembers.length>=2);
  const currentVolumes=cohorts.map(s=>sum(s.validMembers.map(m=>candleWindow(index,m,t,step).volume)));
  const previousVolumes=cohorts.map(s=>sum(s.validMembers.map(m=>candleWindow(index,m,t-step,step).volume)));
  const total=sum(currentVolumes),oldTotal=sum(previousVolumes);
  const rows=cohorts.map((s,i)=>{
   const members=s.validMembers.map(symbol=>{const a=candleWindow(index,symbol,t,step),b=candleWindow(index,symbol,t-step,step);return {symbol,base:symbol.replace(/USDT$/,''),...a,relative:a.returnPct-bm.returnPct,previousRelative:b.returnPct-bp.returnPct,volumeChange:b.volume>0?100*(a.volume/b.volume-1):null};});
   const x=mean(members.map(m=>m.relative)),previous=mean(members.map(m=>m.previousRelative)),y=x-previous;
   return {...s,expectedMembers:s.members.length,symbol:s.id,base:s.name,x,y,previous,returnPct:mean(members.map(m=>m.returnPct)),turnover:currentVolumes[i],share:total>0?100*currentVolumes[i]/total:null,shareChange:total>0&&oldTotal>0?100*(currentVolumes[i]/total-previousVolumes[i]/oldTotal):null,breadth:100*members.filter(m=>m.relative>0).length/members.length,members,state:rotationState(x,y),ts:t};
  });
  return [{ts:t,rows,benchmark:bm.returnPct,totalVolume:total}];
 });
 return {frames,sectors,period,excluded:sectors.filter(s=>s.validMembers.length<2).map(s=>({name:s.name,valid:s.validMembers.length,expected:s.members.length})),end};
}
export function heatmapRows(data,period='24h') {
 const step=TOOL_PERIODS[period],index=candleIndex(data);if(!step)return [];
 const available=Object.values(data.candles||{}).filter(e=>e.response?.data?.length);if(!available.length)return [];
 const end=Math.floor(Math.min(...available.map(e=>Number(e.response.requestTime)))/900000)*900000;
 const groups=new Map((data.sectors||[]).flatMap(s=>s.members.map(m=>[m,s])));
 return (data.tickers||[]).flatMap(t=>{const w=candleWindow(index,t.symbol,end,step);if(!w)return [];return [{...w,symbol:t.symbol,base:t.symbol.replace(/USDT$/,''),sector:groups.get(t.symbol)?.name||'BTC 基準',sectorId:groups.get(t.symbol)?.id||'benchmark',cap:finite(data.coins?.[t.symbol]?.market_cap),capTime:data.coins?.[t.symbol]?.last_updated}];});
}
export function derivativeRows(data) {
 const meta=new Map(data.instruments.map(i=>[i.symbol,i])),prior=new Map((data.previousTickers||[]).map(t=>[t.symbol,t]));
 return data.tickers.map(t=>{
  const old=prior.get(t.symbol),baseOI=finite(t.holdingAmount),mark=finite(t.markPrice),idx=finite(t.indexPrice),fund=data.funding?.[t.symbol]?.response?.data?.[0];
  const oiChange=baseOI!==null&&finite(old?.holdingAmount)>0?100*(baseOI/Number(old.holdingAmount)-1):null;
  const priceChange=finite(t.lastPr)>0&&finite(old?.lastPr)>0?100*(Number(t.lastPr)/Number(old.lastPr)-1):null;
  const ratio=data.ratios?.[t.symbol]?.response?.data?.slice().sort((a,b)=>Number(b.ts)-Number(a.ts))[0];
  return {symbol:t.symbol,base:t.symbol.replace(/USDT$/,''),price:finite(t.lastPr),baseOI,notional:baseOI!==null&&mark!==null?baseOI*mark:null,funding:finite(t.fundingRate??fund?.fundingRate),interval:finite(fund?.fundingRateInterval??meta.get(t.symbol)?.fundInterval),nextUpdate:finite(fund?.nextUpdate),premium:idx>0&&mark!==null?100*(mark/idx-1):null,oiChange,priceChange,previousTime:finite(old?.ts),ts:finite(t.ts),ratio:finite(ratio?.longShortRatio),ratioTime:finite(ratio?.ts),turnover:finite(t.usdtVolume)};
 }).sort((a,b)=>(b.notional??-1)-(a.notional??-1));
}
export function normalizeTrades(entry) {
 const unique=new Map();for(const row of entry?.records||[]){const side=String(row.side).toLowerCase(),p=finite(row.price),q=finite(row.size),ts=finite(row.ts);if(!row.tradeId||p===null||q===null||ts===null||p<=0||q<=0||!['buy','sell'].includes(side))continue;unique.set(String(row.tradeId),{id:String(row.tradeId),price:p,size:q,ts,side});}
 return [...unique.values()].sort((a,b)=>a.ts-b.ts||a.id.localeCompare(b.id));
}
export function orderFlow(entry,{interval=60000,step=10}={}) {
 if(!(step>0)||!(interval>0))throw new Error('Invalid buckets');
 const trades=normalizeTrades(entry);if(!trades.length)return {trades:[],bars:[],profile:[],cvd:[],total:0,delta:0};
 const bars=new Map(),profile=new Map(),cvd=[];let running=0,buy=0,sell=0;
 for(const t of trades){const time=Math.floor(t.ts/interval)*interval;const bucket=Math.floor((t.price+step*1e-8)/step);let b=bars.get(time);if(!b){b={time,open:t.price,high:t.price,low:t.price,close:t.price,buy:0,sell:0,levels:new Map()};bars.set(time,b);}b.high=Math.max(b.high,t.price);b.low=Math.min(b.low,t.price);b.close=t.price;b[t.side]+=t.size;
  let level=b.levels.get(bucket);if(!level){level={bucket,price:bucket*step,bid:0,ask:0};b.levels.set(bucket,level);}level[t.side==='buy'?'ask':'bid']+=t.size;
  const p=profile.get(bucket)||{bucket,price:bucket*step,bid:0,ask:0};p[t.side==='buy'?'ask':'bid']+=t.size;profile.set(bucket,p);
  if(t.side==='buy')buy+=t.size;else sell+=t.size;running+=t.side==='buy'?t.size:-t.size;cvd.push({ts:t.ts,value:running,price:t.price});
 }
 const out=[...bars.values()].map(b=>{const total=b.buy+b.sell,levels=[...b.levels.values()].map(l=>{const below=b.levels.get(l.bucket-1),above=b.levels.get(l.bucket+1);return {...l,total:l.ask+l.bid,delta:l.ask-l.bid,buyImbalance:below?.bid>0&&l.ask>=3*below.bid&&l.ask>=total*.01,sellImbalance:above?.ask>0&&l.bid>=3*above.ask&&l.bid>=total*.01};}).sort((a,b)=>b.price-a.price);return {...b,total,delta:b.buy-b.sell,levels,poc:levels.reduce((a,l)=>!a||l.total>a.total?l:a,null)?.price,partial:b.time<=trades[0].ts&&b.time+interval>trades[0].ts||b.time<=trades.at(-1).ts&&b.time+interval>trades.at(-1).ts};});
 return {trades,bars:out,profile:[...profile.values()].map(l=>({...l,total:l.bid+l.ask})).sort((a,b)=>b.price-a.price),cvd,total:buy+sell,delta:buy-sell,buy,sell,from:trades[0].ts,to:trades.at(-1).ts};
}
