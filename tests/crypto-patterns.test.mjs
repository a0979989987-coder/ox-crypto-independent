import { evaluateClassic } from '../src/core/classic.js';
import { preparation, shortBars, rankingSignal } from './classic-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { PATTERNS,patternById,TIMEFRAMES,candleBoundary } from '../src/markets/crypto/patterns/catalog.js';
import { normalize,resample,similarity,matchCandles,validateHarmonic,structureValid,queryFromStrokes,sortMatches,prepareCandles,classifyPrepared,matchPrepared,patternCounts,rankPatternMatches,browsePatternEntries } from '../src/markets/crypto/patterns/matcher.js';
import { parseCandles,selectUniverse,classicScore,fetchSeries,radarSymbols,radarCandidates } from '../src/markets/crypto/patterns/source.js';

test('crypto drawing grades respect turnover without deleting shapes or applying USDT caps to Taiwan',()=>{
 const signal={...rankingSignal('T1'),qualityScore:97};
 const value=source=>({entry:{key:'COIN:4H',data:{symbol:'COIN',frame:'4H',source,turnover:114000}},
  match:{tier:1,similarity:95,classicSignal:signal}});
 const crypto=rankPatternMatches([value('Bitget')]);
 assert.equal(crypto.length,1);assert.equal(crypto[0].match.tier,3);
 assert.equal(crypto[0].match.classicSignal.qualityScore,54);
 const tw=rankPatternMatches([value('TWSE')]);
 assert.equal(tw[0].match.tier,1);assert.equal(tw[0].match.classicSignal.qualityScore,97);
});

// Explicit synthetic fixtures, only for checking positive/negative geometric invariants.
function fixture(points){
  const values=[points[0].y+(points[1].y>points[0].y?.16:-.16)];
  for(let i=0;i<points.length-1;i++)for(let j=0;j<10;j++)values.push(points[i].y+(points[i+1].y-points[i].y)*j/10);
  values.push(points.at(-1).y);
  const sign=Math.sign(points.at(-2).y-points.at(-1).y);for(let i=1;i<=4;i++)values.push(points.at(-1).y+sign*.025*i);
  return values.map((v,i)=>{const close=100+v*10,open=100+(values[i-1]??v)*10;return {time:1700000000+i*3600,open,high:Math.max(open,close)+.04,low:Math.min(open,close)-.04,close,volume:100,quoteVolume:close*100};});
}
function geometryMatch(candles,query){
  const context=prepareCandles(candles);
  context.classic={long:rankingSignal(),short:rankingSignal('T1','short')};
  return matchPrepared(context,query);
}
test('drawing invariants: time scale, price scale and offset; inverse W is dissimilar',()=>{
  const p=patternById('w').points;
  assert.ok(similarity(resample(p),resample(p.map(v=>({x:v.x*300+7,y:v.y*14+991}))))>99.9);
  assert.ok(similarity(resample(p),resample(patternById('m').points))<55);
  assert.equal(queryFromStrokes([p]).id,'w');
  assert.equal(queryFromStrokes([[{x:.1,y:.5},{x:.2,y:.5},{x:.4,y:.5}]]).id,'horizontal-resistance');
  assert.equal(queryFromStrokes([[{x:0,y:1},{x:.5,y:.8},{x:1,y:.6}],[{x:0,y:0},{x:.5,y:.2},{x:1,y:.4}]]).id,'triangle');
});
test('W matching cannot return an M, missing second trough or an old completed W',()=>{
  const w=fixture(patternById('w').points),m=fixture(patternById('m').points);
  assert.ok(geometryMatch(w,{id:'w'}));assert.ok(matchCandles(w,{id:'w'}).patternOnly,'A forming shape remains searchable without full volume confirmation');
  assert.equal(matchCandles(m,{id:'w'}),null);
  assert.equal(matchCandles(w.slice(0,25),{id:'w'}),null);
  const tail=Array.from({length:30},(_,i)=>({...w.at(-1),time:w.at(-1).time+(i+1)*3600,open:111+i,close:111+i,high:111.1+i,low:110.9+i}));
  assert.equal(matchCandles([...w,...tail],{id:'w'}),null);
});
test('common patterns require their distinct structural geometry',()=>{
  for(const id of ['w','m','triangle','ascending','descending','range','ihs','hs','triple-bottom','triple-top','falling-wedge','rising-wedge','broadening','channel-up','channel-down','flag-up','flag-down','pennant-up','pennant-down']){
    const p=patternById(id),points=p.points.map((v,i)=>({...v,type:i===0?Math.sign(v.y-p.points[1].y):Math.sign(v.y-p.points[i-1].y)}));
    assert.ok(structureValid(points,p),id+' structural rule accepts the specified geometry');
  }
  const p=patternById('triangle');assert.equal(structureValid(patternById('range').points.map((p,i)=>({...p,type:i%2?-1:1})),p),false);
});
test('harmonic ratios reject visually similar geometry with wrong Fibonacci proportions',()=>{
  for(const p of PATTERNS.filter(p=>p.rule==='harmonic')){
    assert.ok(validateHarmonic(p.points,p),p.id);
    const altered=p.points.map((v,i)=>({...v,y:i===p.points.length-1?v.y+.5:v.y}));
    assert.equal(validateHarmonic(altered,p),null,p.id);
  }
  assert.equal(validateHarmonic(patternById('w').points,patternById('gartley-bull')),null);
});
test('geometric matcher retains every named template after the common eligibility gate',()=>{
  for(const p of PATTERNS.filter(p=>!p.rule.startsWith('level')&&!p.rule.startsWith('trend')))assert.ok(geometryMatch(fixture(p.points),{id:p.id}),p.id);
});
test('closed candles only: deduplicate, reject invalid OHLC and never bridge a missing interval',()=>{
  const base=1700002800000,rows=Array.from({length:8},(_,i)=>[String(base+i*3600000),'100','102','99','101','5','505']);
  const server=base+7.5*3600000;
  assert.equal(parseCandles([...rows,rows[2]],'1H',server).length,7);
  assert.equal(parseCandles(rows.filter((_,i)=>i!==4),'1H',server).length,2);
  assert.equal(parseCandles(rows.slice(0,5),'1H',server).length,0);
  assert.equal(parseCandles(rows,'4H',server).length,0);
  const invalid=rows.map(r=>[...r]);invalid[6][2]='90';assert.equal(parseCandles(invalid,'1H',server).length,0);
});
test('UTC Monday week boundary and provisional Bitget candle are explicit, fresh, and never synthesized',async()=>{
  const monday=Date.parse('2026-09-28T00:00:00Z'),now=monday+36*3600000,week=604800000;
  assert.equal(candleBoundary(now,'1W'),monday/1000);
  const rows=Array.from({length:40},(_,i)=>[String(monday-(39-i)*week),'100','103','98','101','10','1010']);
  assert.equal(parseCandles(rows,'1W',now).length,39);
  const actual=parseCandles(rows,'1W',now,{includeOpen:true});assert.equal(actual.length,40);assert.equal(actual.at(-1).provisional,true);
  assert.equal(parseCandles(rows.filter((_,i)=>i!==30),'1W',now,{includeOpen:true}).length,9);
  const originalFetch=globalThis.fetch;let requested='';
  try{
    globalThis.fetch=async url=>{requested=String(url);return {ok:true,json:async()=>({code:'00000',requestTime:now,data:rows})};};
    const data=await fetchSeries('WEEKTESTUSDT','1W',new AbortController().signal,now);
    assert.match(requested,/granularity=1Wutc/);assert.equal(data.candles.at(-1).provisional,true);
    const {entryCurrent,INDEX_VERSION}=await import('../src/markets/crypto/patterns/index-cache.js');
    const entry={version:INDEX_VERSION,data};
    assert.equal(entryCurrent(entry,now+299000),true);assert.equal(entryCurrent(entry,now+301000),false);
  }finally{globalThis.fetch=originalFetch;}
});
test('canvas universe excludes stock tokens and unavailable instruments while retaining low-turnover formations',()=>{
  const tickers=['BTC','ETH','AAPL','LOW','OFF'].map((s,i)=>({symbol:s+'USDT',lastPr:'10',usdtVolume:s==='LOW'?'90000':String(1e8-i*1e7)}));
  const instruments=tickers.map(t=>({symbol:t.symbol,symbolType:t.symbol==='AAPLUSDT'?'stock':'crypto',type:'perpetual',status:t.symbol==='OFFUSDT'?'offline':'online',quoteCoin:'USDT'}));
  assert.deepEqual(selectUniverse(tickers,instruments,80).map(t=>t.symbol),['BTCUSDT','ETHUSDT','LOWUSDT']);
});
test('ranking prioritizes similarity, OX only breaks ties',()=>{
  assert.deepEqual(sortMatches([{symbol:'B',similarity:82,oxScore:99},{symbol:'A',similarity:95,oxScore:40},{symbol:'C',similarity:95,oxScore:85}]).map(r=>r.symbol),['C','A','B']);
  assert.doesNotThrow(()=>sortMatches([{match:{tier:1,label:'W'},similarity:85},{match:{tier:1,label:'阻力'},similarity:85}]));
});
test('pattern tier and phase come from the shared eligible signal; failed reversals remain excluded',()=>{
  const p=fixture(patternById('w').points),context=prepareCandles(p);
  context.classic.long={...rankingSignal('T2'),phase:'breakout',stage:'已收 K 確認突破'};
  const match=matchPrepared(context,{id:'w'});assert.equal(match.tier,2);assert.equal(match.stage,'已收 K 確認突破');
  const failed=fixture(patternById('ihs').points),close=failed[51].low-3;
  failed.push({...failed.at(-1),time:failed.at(-1).time+3600,open:close+1,close,low:close-.1,high:close+1.1});
  assert.equal(geometryMatch(failed,{id:'ihs'}),null);
  assert.deepEqual(sortMatches([{symbol:'L',similarity:99,match:{tier:3}},{symbol:'H',similarity:83,match:{tier:1}},{symbol:'M',similarity:90,match:{tier:2}}]).map(r=>r.symbol),['H','M','L']);
});
test('horizontal pressure uses independent rejected tests and actual upward volume',()=>{
 const bars=preparation(),signal=evaluateClassic(bars),match=matchCandles(bars,{id:'horizontal-resistance'});
 assert.ok(match);assert.ok(match.touches>=2);assert.equal(match.tier,Number(signal.tier.slice(1)));
 const forming=matchCandles(preparation({volume:false}),{id:'horizontal-resistance'});
 assert.ok(forming);assert.equal(forming.classicSignal.eligible,false);assert.notEqual(forming.tier,1);
 const single=structuredClone(bars);single[12].high=97;single[28].high=97;
 const candidate=matchCandles(single,{id:'horizontal-resistance'});
 assert.ok(!candidate||candidate.classicSignal.pressure.level!==100);
});
test('classic score unavailable without the original engine; not replaced by similarity',()=>assert.equal(classicScore({},[],[]),null));
test('score adapter uses shared eligibility and cannot reward high turnover or bearish volume',()=>{
 const ticker={usdtVolume:1e12,change24h:2},bars=preparation();
 assert.equal(classicScore(ticker,bars,[ticker]),evaluateClassic(bars).qualityScore);
 assert.equal(classicScore(ticker,preparation({volume:false}),[ticker]),null);
});

test('clear asymmetric W is recognized structurally; optional similar-path mode retains the common gate',()=>{
  const points=[1,.04,.75,0,.62].map((y,i)=>({x:[0,.18,.51,.79,1][i],y}));
  const query=queryFromStrokes([points]);assert.equal(query.mode,'pattern');assert.equal(query.id,'w');assert.ok(query.points.length);
  const c=fixture(points);assert.ok(geometryMatch(c,query));assert.ok(matchCandles(c,query).patternOnly);
  const sketch={...query,mode:'sketch'},forced={...sketch,id:'m'};assert.equal(geometryMatch(c,forced),null);assert.ok(geometryMatch(c,sketch));
});
test('forming W can be found without requiring neckline completion; inverse is rejected',()=>{
  const c=fixture([1,0,.8,.10,.60].map((y,i)=>({x:i/4,y})));
  const match=geometryMatch(c,{id:'w'});assert.ok(match);assert.equal(match.stage,rankingSignal().stage);assert.equal(match.tier,1);assert.ok(matchCandles(c,{id:'w'}).patternOnly);
  assert.equal(matchCandles(c,{id:'m'}),null);
});
test('uneven hand-drawn W and M tolerate small tremors, but a V is not a W',()=>{
  const shape=[{x:0,y:1},{x:.12,y:.08},{x:.43,y:.7},{x:.82,y:.2},{x:1,y:.82}];
  const drawn=[];for(let i=0;i<shape.length-1;i++)for(let j=0;j<20;j++){const t=j/20;drawn.push({x:shape[i].x+(shape[i+1].x-shape[i].x)*t,y:shape[i].y+(shape[i+1].y-shape[i].y)*t+Math.sin(j*2)*.012});}drawn.push(shape.at(-1));
  assert.equal(queryFromStrokes([drawn]).id,'w');assert.equal(queryFromStrokes([drawn.map(p=>({...p,y:1-p.y}))]).id,'m');
  assert.notEqual(queryFromStrokes([[{x:0,y:1},{x:.5,y:0},{x:1,y:1}]]).id,'w');
});
test('a consumed pressure cannot be promoted by a W drawing or similarity score',()=>{
 const bars=preparation();for(const [i,close]of [[66,102],[67,103],[68,98]]){const open=bars[i].open;Object.assign(bars[i],{close,high:Math.max(open,close)+.2,low:Math.min(open,close)-.2});}
 const match=matchCandles(bars,{id:'w'});
 assert.ok(!match||match.classicSignal.pressure?.state!=='consumed');
 assert.ok(evaluateClassic(bars).levels.some(p=>p.level===100&&p.state==='consumed'));
});
test('radar candidate bridge is read-only, deduplicated and Crypto-only',()=>{
  const runtime={activeMarket:'crypto',tierMap:{t1:[{symbol:'BTCUSDT'}],t2:[{symbol:'BTCUSDT'},{symbol:'ALGOUSDT'}],t3:[]}},before=JSON.stringify(runtime);
  assert.deepEqual(radarSymbols(runtime),['BTCUSDT','ALGOUSDT']);assert.equal(JSON.stringify(runtime),before);
  assert.deepEqual(radarCandidates(runtime).map(({symbol,tier,rank})=>[symbol,tier,rank]),[['BTCUSDT',1,0],['ALGOUSDT',2,1]]);
  assert.deepEqual(radarSymbols({...runtime,activeMarket:'tw'}),[]);
});
test('weekly fetch pages 90-day historical slices, preserves actual current week and reuses history',async()=>{
  const monday=Date.parse('2026-09-28T00:00:00Z'),now=monday+3600000,week=604800000;
  const rows=Array.from({length:100},(_,i)=>[String(monday-(99-i)*week),'100','103','98','101','10','1010']);
  const oldFetch=globalThis.fetch,requests=[];
  try{
    globalThis.fetch=async input=>{const url=new URL(input);requests.push(url.pathname);const end=Number(url.searchParams.get('endTime'));return {ok:true,json:async()=>({code:'00000',requestTime:now,data:end?rows.filter(r=>Number(r[0])<end).slice(-13):rows.slice(-13)})};};
    const data=await fetchSeries('PAGEDWEEKUSDT','1W',new AbortController().signal,now);
    assert.ok(data.candles.length>=80);assert.equal(data.candles.at(-1).provisional,true);assert.ok(requests.filter(x=>x.endsWith('history-candles')).length>=5);
  }finally{globalThis.fetch=oldFetch;}
});
function cleanRisingSupport(){
  return Array.from({length:81},(_,i)=>{
    const base=100+i*.06,offset=1.8*Math.sin(i*Math.PI/10)**2,close=base+offset,open=base-.06+1.8*Math.sin((i-1)*Math.PI/10)**2;
    return {time:1700000000+i*3600,open,close,high:Math.max(open,close)+.035,low:Math.min(open,close)-.035,volume:100,quoteVolume:close*100};
  });
}
test('horizontal and diagonal level searches do not substitute each other',()=>{
 const bars=preparation(),matches=classifyPrepared(prepareCandles(bars));
 assert.ok(matches['horizontal-resistance']);
 assert.ok(matchCandles(shortBars(bars),{id:'horizontal-support'}));
 for(const id of ['trend-up','trend-down']){const m=matchCandles(bars,{id});assert.ok(!m||m.classicSignal.pressure.kind==='diagonal');}
 const noVolume=cleanRisingSupport(),forming=matchCandles(noVolume,{id:'trend-up'});
 assert.ok(forming);assert.equal(forming.classicSignal.eligible,false);assert.notEqual(forming.tier,1);
});
test('a full close-through-and-return removes that line from every search mode',()=>{
 const bars=preparation();for(const [i,close]of [[50,102],[51,103],[52,94]]){const open=bars[i].open;Object.assign(bars[i],{close,high:Math.max(open,close)+.3,low:Math.min(open,close)-.3});}
 const signal=evaluateClassic(bars);assert.ok(signal.levels.filter(p=>p.level===100).every(p=>p.state==='consumed'));
 const match=matchCandles(bars,{id:'horizontal-resistance'});assert.ok(!match||match.classicSignal.pressure.level!==100);
});
test('preclassification and direct search use the same gate; counts deduplicate symbols across frames',()=>{
 const bars=preparation(),context=prepareCandles(bars),matches=classifyPrepared(context),direct=matchPrepared(context,{id:'horizontal-resistance'});
 assert.deepEqual(matches['horizontal-resistance'],direct);
 const entries=[{data:{symbol:'BTCUSDT',frame:'1H'},matches},{data:{symbol:'BTCUSDT',frame:'4H'},matches},{data:{symbol:'ETHUSDT',frame:'15m'},matches}];
 assert.equal(patternCounts(entries,['1H','4H'])['horizontal-resistance'],1);assert.equal(patternCounts(entries,['1H','4H','15m'])['horizontal-resistance'],2);
 const forming=classifyPrepared(prepareCandles(preparation({volume:false})));
 assert.ok(forming['horizontal-resistance']);assert.ok(Object.values(forming).every(m=>m.patternOnly&&m.tier!==1));
});
test('canvas searches retain more than radar quotas and blank browsing does not depend on radar membership',()=>{
 const bars=preparation({volume:false}),context=prepareCandles(bars),matches=classifyPrepared(context);
 const entries=Array.from({length:65},(_,i)=>({key:'DRAW'+i+':1H',data:{symbol:'DRAW'+i,frame:'1H',candles:bars,classic:context.classic},matches}));
 const results=rankPatternMatches(entries.map(entry=>({entry,match:matches['horizontal-resistance']})));
 assert.equal(results.length,65);assert.ok(results.every(r=>!r.match.classicSignal.eligible&&r.match.tier!==1));
 assert.equal(browsePatternEntries(entries).length,65);
});

test('cache cannot carry an index across a close boundary or algorithm version',async()=>{
  const {entryCurrent,INDEX_VERSION}=await import('../src/markets/crypto/patterns/index-cache.js');
  const start=1700002800,candles=Array.from({length:40},(_,i)=>({time:start+i*3600}));
  const entry={version:INDEX_VERSION,data:{frame:'1H',candles}},now=(start+40.5*3600)*1000;
  assert.equal(entryCurrent(entry,now),true);assert.equal(entryCurrent(entry,now+3600000),false);
  assert.equal(entryCurrent({...entry,version:0},now),false);
  assert.equal(Object.keys(TIMEFRAMES).length,11);
});
test('canvas reuses current native candle observations without requesting them again',async()=>{
 const now=Date.now(),boundary=candleBoundary(now,'1H'),previous=globalThis.BitgetAPI,originalFetch=globalThis.fetch;
 const candles=Array.from({length:40},(_,i)=>({time:boundary-(40-i)*3600,open:100,high:102,low:99,close:101,volume:10,quoteVolume:1010}));
 let requests=0;
 try{
  globalThis.BitgetAPI={peekCandles:()=>({symbol:'REUSEQAUSDT',frame:'1H',serverTime:now,candles})};
  globalThis.fetch=async()=>{requests++;throw Error('Candle transport must not be used');};
  const series=await fetchSeries('REUSEQAUSDT','1H',new AbortController().signal,now);
  assert.equal(series.candles.length,40);assert.equal(requests,0);assert.equal(series.candles.at(-1).quoteVolume,1010);
 }finally{globalThis.fetch=originalFetch;if(previous===undefined)delete globalThis.BitgetAPI;else globalThis.BitgetAPI=previous;}
});

test('automatic trend drawings use the correct candle side and never rising overhead resistance',()=>{
 const rising=cleanRisingSupport(),falling=shortBars(rising);
 for(const [bars,id,side] of [[rising,'trend-up','SHORT'],[falling,'trend-down','LONG']]){
  const match=matchCandles(bars,{id});assert.ok(match);assert.equal(match.classicSignal.side,side);
  const line=match.classicSignal.pressure;
  assert.equal(line.state,'valid');assert.ok(id==='trend-up'?line.slope>0:line.slope<0);
  assert.ok(id==='trend-up'?line.level<=bars.at(-1).close:line.level>=bars.at(-1).close);
 }
 const risingHighs=preparation().map((c,i)=>({...c,open:c.open+.04*i,high:c.high+.04*i,low:c.low+.04*i,close:c.close+.04*i}));
 const signal=evaluateClassic(risingHighs);
 assert.ok(signal.levels.filter(p=>p.kind==='diagonal').every(p=>p.slope<0));
});

test('old high grades are requalified even when the candle cache is current or preclassified',async()=>{
 const {classificationCurrent,indexPrepared}=await import('../src/markets/crypto/patterns/matcher.js');
 const {CLASSIC_VERSION}=await import('../src/core/classic.js');
 const {INDEX_VERSION}=await import('../src/markets/crypto/patterns/index-cache.js');
 const bars=cleanRisingSupport(),context=prepareCandles(bars),current=indexPrepared(context);
 const data={candles:bars,classic:current.classic,preclassified:current.matches};
 assert.equal(classificationCurrent({version:INDEX_VERSION,data,matches:current.matches},INDEX_VERSION),true);
 assert.equal(classificationCurrent({version:INDEX_VERSION,data,matches:current.matches,classifying:true},INDEX_VERSION),false);
 assert.equal(classificationCurrent({version:8,data,matches:current.matches},INDEX_VERSION),false);
 const stale={...data,classic:{...data.classic,long:{...data.classic.long,version:CLASSIC_VERSION-1}}};
 assert.equal(classificationCurrent({version:INDEX_VERSION,data:stale,matches:current.matches},INDEX_VERSION),false);
 const fake={'trend-down':{tier:1,similarity:100,classicSignal:{version:0,eligible:true,qualityScore:99}}};
 const repaired=indexPrepared(context,fake);
 assert.equal(repaired.matches['trend-down'],undefined);
 assert.ok(Object.values(repaired.matches).every(m=>m.classicSignal.qualityScore!==99));
});
test('line geometry rejects overhead rising support, broken resistance and lines slicing candle bodies',async()=>{
 const {validLevelGeometry}=await import('../src/markets/crypto/patterns/matcher.js');
 const c=cleanRisingSupport();
 const level={kind:'diagonal',state:'valid',points:[{time:c[0].time,price:c[0].low},{time:c.at(-1).time,price:c.at(-1).low}]};
 assert.equal(validLevelGeometry(c,level,'SHORT',1),true);
 const overhead=structuredClone(level);overhead.points[1].price+=5;
 assert.equal(validLevelGeometry(c,overhead,'SHORT',1),false);
 const down=shortBars(c),resistance={...level,points:level.points.map(p=>({...p,price:200-p.price}))};
 assert.equal(validLevelGeometry(down,resistance,'LONG',1),true);
 const broken=structuredClone(down);broken.at(-1).close+=3;broken.at(-1).high=broken.at(-1).close;
 assert.equal(validLevelGeometry(broken,resistance,'LONG',1),false);
 const cross=structuredClone(c);cross[30].open=cross[30].close=95;cross[30].low=94;
 assert.equal(validLevelGeometry(cross,level,'SHORT',1),false);
});
