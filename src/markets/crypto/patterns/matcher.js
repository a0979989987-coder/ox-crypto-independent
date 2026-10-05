import { CLASSIC_VERSION, evaluateClassic, compareClassic, compactClassic, rankClassicTiers } from '../../../core/classic.js?v=20261002-rank8';
import { PATTERNS, patternById } from './catalog.js?v=patterns5d-20260929';
import '../liquidity-policy.js?v=20261002-rank8';
const clamp = (x, a=0, b=1) => Math.max(a, Math.min(b, x));
const mean = a => a.reduce((s,x)=>s+x,0)/a.length;
export function normalize(points) {
  if(points.length<2)return [];
  const lo=Math.min(...points.map(p=>p.y)),hi=Math.max(...points.map(p=>p.y));
  const left=points[0].x,span=points.at(-1).x-left;
  if(hi-lo<1e-12||span<=0)return [];
  return points.map(p=>({x:(p.x-left)/span,y:(p.y-lo)/(hi-lo)}));
}
export function resample(points,n=40) {
  const p=normalize(points);if(!p.length)return [];
  let j=1;return Array.from({length:n},(_,i)=>{
    const x=i/(n-1);while(j<p.length-1&&p[j].x<x)j++;
    const t=clamp((x-p[j-1].x)/(p[j].x-p[j-1].x||1));
    return p[j-1].y+(p[j].y-p[j-1].y)*t;
  });
}
// Bounded DTW plus aligned error preserves timing and prevents arbitrary warping.
export function similarity(a,b) {
  if(a.length!==b.length||a.length<4)return 0;
  const n=a.length,band=7;let prev=new Float64Array(n+1).fill(Infinity),row=new Float64Array(n+1);prev[0]=0;
  for(let i=1;i<=n;i++){
    row.fill(Infinity);
    for(let j=Math.max(1,i-band);j<=Math.min(n,i+band);j++)row[j]=Math.abs(a[i-1]-b[j-1])+Math.min(prev[j],row[j-1],prev[j-1]);
    [prev,row]=[row,prev];
  }
  const aligned=mean(a.map((x,i)=>Math.abs(x-b[i])));
  const edge=(Math.abs(a[0]-b[0])+Math.abs(a.at(-1)-b.at(-1)))/2;
  return clamp(1-(prev[n]/n*.55+aligned*.3+edge*.15)*2.2)*100;
}
export function swingPoints(candles,radius=2,threshold=0) {
  const raw=[];
  for(let i=radius;i<candles.length-radius;i++){
    const c=candles[i],slice=candles.slice(i-radius,i+radius+1);
    const high=slice.every(x=>c.high>=x.high)&&slice.some(x=>c.high>x.high);
    const low=slice.every(x=>c.low<=x.low)&&slice.some(x=>c.low<x.low);
    if(high===low)continue; // Intrabar order is unknown for an outside bar.
    const p={x:i,y:high?c.high:c.low,type:high?1:-1};const last=raw.at(-1);
    if(last?.type===p.type){if((p.y-last.y)*p.type>0)raw[raw.length-1]=p;}
    else if(!last||Math.abs(p.y-last.y)>=threshold)raw.push(p);
  }
  return raw;
}
function alternating(p,t) {return p.slice(1).every((v,i)=>Math.sign(v.y-p[i].y)===Math.sign(t[i+1].y-t[i].y));}
export function harmonicRatios(p) {
  const v=p.map(x=>typeof x==='number'?x:x.y),[a,b,c,d]=v.slice(-4);
  const ab=Math.abs(b-a),bc=Math.abs(c-b),cd=Math.abs(d-c);
  if(Math.min(ab,bc,cd)<=1e-12)return null;
  const out={bc:bc/ab,cd:cd/bc,equal:cd/ab};
  if(v.length===5){const xa=Math.abs(v[1]-v[0]);if(!xa)return null;out.ab=ab/xa;out.ad=Math.abs(v[1]-v[4])/xa;}
  return out;
}
export function validateHarmonic(p,pattern) {
  const ratios=harmonicRatios(p);if(!ratios||!alternating(p,pattern.points))return null;
  const [x,a,b,c,d]=p.map(q=>q.y);
  if(p.length===5){const dir=Math.sign(a-x);if((c-b)*dir<=0||(a-c)*dir<=0)return null;}
  for(const [key,[lo,hi]] of Object.entries(pattern.ratios)) {
    const tolerance=lo===hi?lo*.05:0;
    if(ratios[key]<lo-tolerance-1e-9||ratios[key]>hi+tolerance+1e-9)return null;
  }
  return ratios;
}
function regression(points){const mx=mean(points.map(p=>p.x)),my=mean(points.map(p=>p.y));const m=points.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0)/(points.reduce((s,p)=>s+(p.x-mx)**2,0)||1);return {m,b:my-m*mx};}
export function structureValid(p,pattern) {
  if(p.length!==pattern.points.length||!alternating(p,pattern.points))return false;
  const q=normalize(p).map(v=>v.y),r=pattern.rule;
  if(r==='harmonic')return !!validateHarmonic(p,pattern);
  if(r==='w'||r==='m'){
    const v=r==='m'?q.map(v=>1-v):q;
    return Math.abs(v[1]-v[3])<=.25&&v[0]-v[1]>=.35&&v[2]-Math.max(v[1],v[3])>=.30&&v[4]-v[3]>=.18;
  }
  if(['hs','ihs','triple-bottom','triple-top'].includes(r)){
    const v=['hs','triple-top'].includes(r)?q.map(v=>1-v):q;
    const shoulders=Math.abs(v[1]-v[5])<=.18,neck=Math.abs(v[2]-v[4])<=.18;
    return shoulders&&neck&&(r==='hs'||r==='ihs'?Math.min(v[1],v[5])-v[3]>=.16:Math.max(v[1],v[3],v[5])-Math.min(v[1],v[3],v[5])<=.18)&&v[6]>=Math.min(v[2],v[4])-.18;
  }
  const z=normalize(p);const highs=z.filter((v,i)=>p[i].type===1),lows=z.filter((v,i)=>p[i].type===-1);
  if(highs.length<2||lows.length<2)return false;
  const h=regression(highs),l=regression(lows),width0=h.b-l.b,width1=h.m+h.b-l.m-l.b;
  const contracts=width0>0&&width1>0&&width1/width0<.76;
  switch(r){
    case 'triangle':return contracts&&h.m<-.12&&l.m>.12;
    case 'ascending':return contracts&&Math.abs(h.m)<.16&&l.m>.24;
    case 'descending':return contracts&&Math.abs(l.m)<.16&&h.m<-.24;
    case 'range':return Math.abs(h.m)<.18&&Math.abs(l.m)<.18;
    case 'falling-wedge':return contracts&&h.m<-.28&&l.m<-.08;
    case 'rising-wedge':return contracts&&h.m>.08&&l.m>.28;
    case 'broadening':return width0>0&&width1>width0*1.35&&h.m>.15&&l.m<-.15;
    case 'channel-up':return h.m>.25&&l.m>.25&&Math.abs(h.m-l.m)<.25;
    case 'channel-down':return h.m<-.25&&l.m<-.25&&Math.abs(h.m-l.m)<.25;
    case 'flag-up':case 'flag-down':case 'pennant-up':case 'pennant-down':{
      const dir=r.endsWith('up')?1:-1;
      if((q[1]-q[0])*dir<.8)return false;
      const tail=p.slice(1),tailPattern={points:pattern.points.slice(1),rule:r.startsWith('flag')?(dir===1?'channel-down':'channel-up'):'triangle'};
      return structureValid(tail,tailPattern);
    }
    default:return true;
  }
}
function atr(c) {return mean(c.slice(1).map((v,i)=>Math.max(v.high-v.low,Math.abs(v.high-c[i].close),Math.abs(v.low-c[i].close))));}
const LONG_PATTERNS=new Set(['w','ascending','ihs','triple-bottom','falling-wedge','channel-up','flag-up','pennant-up','v-bottom','round-bottom','cup','retest-up','stairs-up']);
const SHORT_PATTERNS=new Set(['m','descending','hs','triple-top','rising-wedge','channel-down','flag-down','pennant-down','v-top','round-top','cup-down','retest-down','stairs-down']);
function patternSignal(context,pattern,query={}) {
 const id=pattern?.id||query.id;
 let side=LONG_PATTERNS.has(id)||id?.endsWith('-bull')?'long':SHORT_PATTERNS.has(id)||id?.endsWith('-bear')?'short':null;
 if(!side&&query.points?.length&&Math.abs(query.points.at(-1).y-query.points[0].y)>.12)side=query.points.at(-1).y>query.points[0].y?'long':'short';
 const signals=side?[context.classic[side]]:Object.values(context.classic);
 return signals.filter(Boolean).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||
  Number(b.observationEligible)-Number(a.observationEligible)||compareClassic(a,b))[0]||null;
}
function patternPhase(signal){
 const decision=compactClassic(signal);
 return {tier:signal.eligible?Number(signal.tier.slice(1)):signal.observationEligible?2:3,
  stage:signal.eligible?signal.stage:'型態形成 · 尚待量價確認',side:signal.side,
  patternOnly:!signal.eligible,classicSignal:decision};
}
function setupPhase(context,pattern,pivots,score,shape,visual,end,query) {
 const signal=patternSignal(context,pattern,query);if(!signal)return null;
 if(pattern&&['w','m','ihs','hs','triple-bottom','triple-top'].includes(pattern.rule)&&pivots){
  const dir=signal.side==='LONG'?1:-1,trough=pivots.at(-2).y;
  if((context.candles.at(-1).close-trough)*dir<-.35*context.volatility)return null;
 }
 return patternPhase(signal);
}
// Build reusable features once per symbol/timeframe, independent of the selected drawing.
export function prepareCandles(candles) {
  // Recent 14-bar true range: distant high-volatility history must not erase
  // a smaller, currently forming weekly base.
  const volatility=atr(candles.slice(-15)), n=candles.length, swings=[];
  for(const [radius,multiple] of [[1,.5],[2,.65],[3,1],[5,1.5],[8,2]]) {
    const p=swingPoints(candles,radius,volatility*multiple);swings.push(p);
  }
  const windows=[];
  for(let end=n-1;end>=Math.max(0,n-7);end-=2)for(let span=16;span<=Math.min(160,end);span+=4){
    const start=end-span,slice=candles.slice(start,end+1),points=slice.map((c,i)=>({x:i,y:c.close}));
    if(Math.max(...slice.map(c=>c.high))-Math.min(...slice.map(c=>c.low))<volatility*2)continue;
    windows.push({start,end,samples:resample(points)});
  }
  return {candles,volatility,swings,windows,visuals:new Map(),classic:{long:evaluateClassic(candles),short:evaluateClassic(candles,{side:'short'})}};
}
const targets=new Map(PATTERNS.map(p=>[p.id,resample(p.points)]));
// Cached geometry and grades must be requalified together, including preclassified feeds.
export function classificationCurrent(entry,indexVersion){
 return !entry?.classifying && entry?.version===indexVersion && ['long','short'].every(side=>entry.data?.classic?.[side]?.version===CLASSIC_VERSION) &&
  Object.values(entry.matches||{}).every(match=>match.classicSignal?.version===CLASSIC_VERSION);
}
export function validLevelGeometry(candles,level,side,volatility){
 const points=level?.points;if(!points||points.length!==2||!(volatility>0))return false;
 const start=candles.findIndex(c=>c.time===points[0].time),end=candles.findIndex(c=>c.time===points[1].time);
 if(start<0||end<=start||!points.every(p=>Number.isFinite(p.price)))return false;
 const slope=(points[1].price-points[0].price)/(end-start),dir=side==='LONG'?1:-1;
 if(level.kind==='diagonal'&&slope*dir>=0)return false;
 // An active boundary must stay outside candle bodies throughout its lifetime.
 // A small wick test is allowed; a line slicing through the formation is not.
 for(let i=start;i<candles.length;i++){
  const c=candles[i],line=points[0].price+slope*(i-start);
  const body=dir===1?Math.max(c.open,c.close):Math.min(c.open,c.close);
  if(level.state==='valid'&&(body-line)*dir>volatility*.25)return false;
  if(level.kind==='diagonal'&&level.state!=='valid')return false;
 }
 return true;
}
function levelMatch(context,pattern) {
 const c=context.candles,trend=pattern.rule.startsWith('trend');
 const sides=pattern.rule.endsWith('support')?['short']:['long'];
 const price=c.at(-1)?.close;
 const candidates=sides.flatMap(side=>{
  const signal=context.classic[side];if(!signal)return [];
  const levels=[signal.pressure,...(signal.levels||[])].filter(p=>p&&p.state!=='consumed'&&
   (p.state==='valid'||!trend&&signal.eligible&&p.state==='broken')&&p.kind===(trend?'diagonal':'horizontal')&&
   (!trend||Math.sign(p.slope)===(pattern.id==='trend-up'?1:-1))&&
   validLevelGeometry(c,p,signal.side,signal.atr||context.volatility)&&
   (p.state==='broken'||(signal.side==='LONG'?p.level-price:price-p.level)>=-.15*(signal.atr||context.volatility)));
  levels.sort((a,b)=>Math.abs(a.level-price)-Math.abs(b.level-price)||b.touches-a.touches);
  if(!levels.length)return [];
  const pressure=levels[0],same=signal.pressure?.kind===pressure.kind &&
   signal.pressure?.formedAt===pressure.formedAt && Math.abs(signal.pressure.level-pressure.level)<(signal.atr||context.volatility)*.05;
  // A valid but different line cannot borrow another setup's eligibility/score.
  return [{...signal,pressure,...(!same?{eligible:false,tier:null,observationEligible:false,qualityScore:null,stage:'有效邊界 · 尚待量價確認'}:{})}];
 });
 const signal=candidates.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||compareClassic(a,b))[0];
 if(!signal)return null;
 const points=signal.pressure.points.map(p=>({x:c.findIndex(b=>b.time===p.time),y:p.price}));
 return {start:points[0].x,end:points.at(-1).x,points,label:pattern.name,lastTime:c.at(-1).time,
  touches:signal.pressure.touches,...patternPhase(signal),
  kind:'level',similarity:Math.round(clamp(1-(signal.pressure.errorATR||0)/2)*100),
  classicSignal:{...compactClassic(signal),pressure:signal.pressure}};
}
// Version-5 snapshots contain real OHLCV and useful geometry, but their grades
// are obsolete. Requalify every result against the current shared engine.
export function qualifyPatternMatches(context,matches) {
 const result={};
 for(const [id,match]of Object.entries(matches||{})){
  const pattern=patternById(id);if(!pattern)continue;
  if(pattern.rule.startsWith('level')||pattern.rule.startsWith('trend')){const m=levelMatch(context,pattern);if(m)result[id]=m;continue;}
  if(!Array.isArray(match.points)||!Number.isFinite(match.start)||!Number.isFinite(match.end)||
    context.candles.length-1-match.end>8||match.end>=context.candles.length||
    pattern.rule!=='path'&&!structureValid(match.points,pattern))continue;
  const phase=setupPhase(context,pattern,match.points,match.similarity,match.similarity,match.similarity,match.end,{});
  if(phase)result[id]={...match,...phase};
 }
 // A newly valid pressure must be discoverable even when absent in old geometry.
 for(const p of PATTERNS.filter(p=>p.rule.startsWith('level')||p.rule.startsWith('trend'))){const m=levelMatch(context,p);if(m)result[p.id]=m;}
 return result;
}
export function matchPrepared(context,query) {
  const {candles,n= context.candles.length}=context;
  if(candles.length<35)return null;
  const sketch=query.mode==='sketch',pattern=sketch?null:patternById(query.id);
  if(pattern?.rule.startsWith('level')||pattern?.rule.startsWith('trend'))return levelMatch(context,pattern);
  const target=sketch?resample(query.points||[]):targets.get(pattern?.id)||resample(query.points||[]);
  if(!target.length)return null;
  let best=null;
  const consider=(start,end,pivots,ratios=null,samples=null)=>{
    if(end-start<15||end-start>160||n-1-end>8)return;
    const key=start+':'+end;
    let visualSamples=samples||context.visuals.get(key);
    if(!visualSamples){const slice=candles.slice(start,end+1);if(Math.max(...slice.map(c=>c.high))-Math.min(...slice.map(c=>c.low))<context.volatility*2)return;visualSamples=resample(slice.map((c,i)=>({x:i,y:c.close})));context.visuals.set(key,visualSamples);}
    const visual=similarity(visualSamples,target);let score=visual,shape=visual;
    if(pivots){shape=similarity(resample(pivots),target);score=.6*shape+.4*visual;if(shape<70)return;}
    const reversal=pattern&&['w','m'].includes(pattern.rule);
    const minimum=sketch?70:pattern?.rule==='harmonic'?72:reversal?71:77;
    if(score<minimum)return;
    const phase=setupPhase(context,pattern,pivots,score,shape,visual,end,query);if(!phase)return;
    if(best&&(phase.tier>best.tier||phase.tier===best.tier&&score<=best.similarity))return;
    best={start,end,similarity:Math.round(score*10)/10,points:pivots||candles.slice(start,end+1).map((c,i)=>({x:i+start,y:c.close})),ratios,label:sketch?'相似路徑':pattern?.name||'自繪路徑',...phase,kind:sketch?'sketch':'pattern',lastTime:candles[end].time};
  };
  if(pattern&&pattern.rule!=='path') {
    for(const base of context.swings){
      const pivots=[...base];
      if(pattern.rule!=='harmonic'&&pivots.length){const last=pivots.at(-1),c=candles.at(-1);if((c.close-last.y)*last.type<0)pivots.push({x:n-1,y:c.close,type:-last.type});}
      const k=pattern.points.length;
      for(let i=Math.max(0,pivots.length-k-6);i<=pivots.length-k;i++){
        const p=pivots.slice(i,i+k);if(n-1-p.at(-1).x>8||!structureValid(p,pattern))continue;
        consider(p[0].x,p.at(-1).x,p,pattern.rule==='harmonic'?validateHarmonic(p,pattern):null);
      }
    }
  }else {
    // Cheap aligned distance narrows the candidates before DTW. Timing and price are normalized.
    const nearest=context.windows.map(w=>({w,error:mean(w.samples.map((v,i)=>Math.abs(v-target[i])))})).sort((a,b)=>a.error-b.error).slice(0,16);
    for(const {w} of nearest)consider(w.start,w.end,null,null,w.samples);
  }
  if(sketch&&best&&query.id){
    const structural=matchPrepared(context,{id:query.id});
    if(structural&&Math.abs(structural.end-best.end)<=8&&Math.abs(structural.start-best.start)<=25){
      best.tier=structural.tier;best.stage=structural.stage;
    }else{return null;}
  }
  return best;
}
export function matchCandles(candles,query){return matchPrepared(prepareCandles(candles),query);}
export function classifyPrepared(context){
  const matches={};if(context.candles.length<35)return matches;for(const p of PATTERNS){const match=matchPrepared(context,{id:p.id});if(match)matches[p.id]=match;}return matches;
}
export function indexPrepared(context,matches){
 return {matches:matches?qualifyPatternMatches(context,matches):classifyPrepared(context),
  classic:Object.fromEntries(Object.entries(context.classic).map(([side,signal])=>[side,compactClassic(signal)]))};
}
export function patternCounts(entries,frames){
  const sets=new Map(PATTERNS.map(p=>[p.id,new Set()]));
  for(const entry of entries)if(frames.includes(entry.data.frame))for(const id of Object.keys(entry.matches))sets.get(id)?.add(entry.data.symbol);
  return Object.fromEntries([...sets].map(([id,s])=>[id,s.size]));
}
// Identify the turning sequence independently of handwriting width/speed. Small
// tremors are removed with an amplitude threshold, not by warping market candles.
export function recognizeReversal(points){
  const values=resample(points,81);if(!values.length)return null;
  const smooth=values.map((v,i)=>mean(values.slice(Math.max(0,i-1),Math.min(values.length,i+2))));
  for(const threshold of [.12,.17,.22]){
    const turns=[{x:0,y:smooth[0]}];let direction=0,extreme=turns[0];
    for(let i=1;i<smooth.length;i++){
      const p={x:i/(smooth.length-1),y:smooth[i]};
      if(!direction){if(Math.abs(p.y-extreme.y)>=threshold){direction=Math.sign(p.y-extreme.y);extreme=p;}continue;}
      if((p.y-extreme.y)*direction>=0)extreme=p;
      else if((extreme.y-p.y)*direction>=threshold){turns.push(extreme);direction=-direction;extreme=p;}
    }
    turns.push({x:1,y:smooth.at(-1)});
    if(turns.length!==5)continue;
    const w=turns[1].y<turns[0].y,v=turns.map(p=>w?p.y:1-p.y);
    if(v[0]-v[1]>.22&&v[2]-Math.max(v[1],v[3])>.24&&v[4]-v[3]>.2&&Math.abs(v[1]-v[3])<.48&&turns.slice(1).every((p,i)=>p.x-turns[i].x>.035))return w?'w':'m';
  }
  return null;
}
export function queryFromStrokes(strokes) {
  const valid=strokes.filter(s=>s.length>=2);if(!valid.length)return null;
  // Two drawn boundaries become an alternating path between their measured envelopes.
  if(valid.length===2){
    const lines=valid.map(s=>regression(s)),left=Math.max(...valid.map(s=>Math.min(...s.map(p=>p.x)))),right=Math.min(...valid.map(s=>Math.max(...s.map(p=>p.x))));
    if(right-left>.15){
      const mid=(left+right)/2;lines.sort((a,b)=>(b.m*mid+b.b)-(a.m*mid+a.b));
      const points=Array.from({length:7},(_,i)=>{const x=left+(right-left)*i/6,l=lines[i%2];return{x,y:l.m*x+l.b};});
      if(lines[0].m*right+lines[0].b>=lines[1].m*right+lines[1].b){
        const candidates=PATTERNS.filter(p=>['triangle','ascending','descending','range','falling-wedge','rising-wedge','channel-up','channel-down','broadening'].includes(p.id));
        const best=candidates.map(p=>({p,s:similarity(resample(points),resample(p.points))})).sort((a,b)=>b.s-a.s)[0];
        return best.s>=83?{id:best.p.id,points,mode:'sketch'}:{points,mode:'sketch'};
      }
    }
  }
  const raw=valid.at(-1),a=raw[0].x,b=raw.at(-1).x;
  const chronological=b>=a?raw:[...raw].reverse();let last=-Infinity;
  const path=chronological.filter(p=>{if(p.x<=last+.001)return false;last=p.x;return true;});
  if(path.length<2||path.at(-1).x-path[0].x<.12)return null;
  const line=regression(path),deviation=Math.sqrt(mean(path.map(p=>(p.y-line.m*p.x-line.b)**2))),height=Math.max(...path.map(p=>p.y))-Math.min(...path.map(p=>p.y));
  if(height<.045)return {id:'horizontal-resistance',mode:'level'};
  if(deviation<.025&&Math.abs(line.m)>.15)return {id:line.m>0?'trend-up':'trend-down',mode:'level'};
  const p=normalize(path);if(!p.length)return null;
  const reversal=recognizeReversal(p);
  if(reversal)return {id:reversal,points:p,mode:'pattern',recognition:'turns'};
  // Only label a hand-drawn common shape when strongly aligned; harmonic names require explicit ratio validation.
  const best=PATTERNS.filter(t=>t.rule!=='harmonic'&&!t.rule.startsWith('level')&&!t.rule.startsWith('trend')).map(t=>({t,s:similarity(resample(p),resample(t.points))})).sort((a,b)=>b.s-a.s)[0];
  return best.s>=78?{id:best.t.id,points:p,mode:'sketch'}:{points:p,mode:'sketch'};
}
export function sortMatches(rows){return [...rows].sort((a,b)=>(a.displayTier??a.match?.tier??3)-(b.displayTier??b.match?.tier??3)||(b.rankPriority??-1)-(a.rankPriority??-1)||b.similarity-a.similarity||(b.oxScore??-1)-(a.oxScore??-1)||(b.turnover??0)-(a.turnover??0)||String(a.symbol??a.match?.label??'').localeCompare(String(b.symbol??b.match?.label??'')));}
export function rankPatternMatches(matches){
 const candidates=matches.map(value=>{
  // Geometry remains searchable. Apply the crypto monetary grade only when
  // displaying a real Bitget series; Taiwan/US series use their own units.
  const signal=value.entry.data.source==='Bitget'?globalThis.OXCryptoLiquidity.apply(value.match.classicSignal,value.entry.data.turnover):value.match.classicSignal;
  const match=signal?{...value.match,classicSignal:signal,...(signal.eligible?{tier:Number(signal.tier.slice(1))}:{})}:value.match;
  return {...value,match,symbol:value.entry.data.symbol,classicSignal:signal,similarity:match.similarity};
 });
 // The canvas discovers formations across the selected universe. Radar quotas
 // only apply to an explicitly supplied radar list, never to drawing searches.
 if(!matches.length||!matches.every(value=>value.match.radar)){
  const seen=new Set();return sortMatches(candidates).filter(value=>{
   const key=value.entry.key||value.entry.data.symbol+':'+value.entry.data.frame;
   return !seen.has(key)&&seen.add(key);
  });
 }
 return rankClassicTiers(candidates,{compare:(a,b)=>compareClassic(a,b)||b.similarity-a.similarity})
  .map(value=>{const tier=Number(value.tier.slice(1));return {...value,match:{...value.match,tier,
   qualityTier:value.qualityTier,...(value.match.radar?{radarTier:tier}:{})}};});
}
export function browsePatternEntries(entries){
 const bestBySymbol=new Map();
 for(const entry of entries){
  const best=sortMatches(Object.values(entry.matches||{}).map(match=>({match,similarity:match.similarity}))).at(0)?.match;
  const signal=best?.classicSignal||Object.values(entry.data.classic||{}).sort((a,b)=>
   Number(b.eligible)-Number(a.eligible)||Number(b.observationEligible)-Number(a.observationEligible)||compareClassic(a,b))[0];
  if(!signal)continue;
  const n=entry.data.candles.length;
  const candidate={entry,match:best||{label:'走勢瀏覽',similarity:0,points:[],start:Math.max(0,n-60),end:n-1,
   ...patternPhase(signal),stage:'走勢瀏覽 · 尚未選擇型態',browse:true}};
  const previous=bestBySymbol.get(entry.data.symbol);
  if(!previous||candidate.match.tier<previous.match.tier||candidate.match.tier===previous.match.tier&&
   candidate.match.similarity>previous.match.similarity)bestBySymbol.set(entry.data.symbol,candidate);
 }
 return rankPatternMatches([...bestBySymbol.values()]);
}
