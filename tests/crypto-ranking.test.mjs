import { preparation, shortBars, rankingSignal } from './classic-fixtures.mjs';
import { OXClassicForTests } from './classic-test-runtime.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const scanner = readFileSync(new URL("../src/markets/crypto/scanner.js", import.meta.url), "utf8");
const engine=readFileSync(new URL('../src/markets/crypto/engine.js',import.meta.url),'utf8');
const policy=readFileSync(new URL('../src/markets/crypto/liquidity-policy.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../src/markets/crypto/api.js',import.meta.url),'utf8');

test('Bitget non-RWA crypto token survives a colliding stock ticker fallback',()=>{
  const classify=contract=>runInNewContext(`${api}\nclassifyInstrument(${JSON.stringify(contract)})`,{});
  assert.equal(classify({symbol:'CVXUSDT',baseCoin:'CVX',symbolType:'perpetual',quoteCoin:'USDT',isRwa:'NO'}),'crypto');
  assert.equal(classify({symbol:'CVXUSDT',baseCoin:'CVX',symbolType:'perpetual',quoteCoin:'USDT',isRwa:'YES'}),'stock');
  assert.equal(classify({symbol:'CVXUSDT',baseCoin:'CVX',symbolType:'perpetual',quoteCoin:'USDT',isRwa:'NO',assetSymbolType:'stock'}),'stock');
});

function rank(rows, scanState={}, side='long') {
  const state = {
    analyzedCache: new Map(rows.map(row => [row.symbol, {quoteVol:15000000,...row,classic:row.classic||{long:rankingSignal(row.tier.toUpperCase())},
      classicSignal:row.classicSignal||rankingSignal(row.tier.toUpperCase())}])),
    tickers: [], directionFilter: "long", ...scanState
  };
  const context = {
    OXClassic:OXClassicForTests, state, benchmarkSymbols: new Set(["BTCUSDT", "ETHUSDT"]), num: Number,
    isCryptoSymbolAllowed:()=>true,
    syncDirectionalBadges() {}, syncWatchBadge() {}, renderMarketStrength() {},
    renderHomeOverview() {}, renderOxLive() {}
  };
  runInNewContext(`${policy}\n${engine}\n${scanner}\nrebuildTierLists();`, context);
  return state.tierMapBySide[side];
}

test("Crypto radar preserves strict T1 and fills the next 15 plus 15 ranked slots without repeats", () => {
  const rows = ["t1", "t2", "t3"].flatMap((tier, tierIndex) =>
    Array.from({ length: 35 }, (_, index) => ({
      symbol: `COIN${tierIndex}${String(index).padStart(2, "0")}USDT`,
      side: "LONG", tier, oxScore: 100 - index,
      classicSignal:{...rankingSignal(tier.toUpperCase()),qualityScore:rankingSignal(tier.toUpperCase()).qualityScore-index/100},
      classic:{long:{...rankingSignal(tier.toUpperCase()),qualityScore:rankingSignal(tier.toUpperCase()).qualityScore-index/100}},
      t1Fit: tier === "t1" ? 100 - index : 0,
      t2Fit: tier === "t2" ? 100 - index : 0,
      t3Fit: tier === "t3" ? 100 - index : 0
    }))
  );
  const result = rank(rows);
  for (const tier of ["t1", "t2", "t3"]) {
    assert.equal(result[tier].length, tier==='t1'?10:15);
    assert.ok(result[tier].every(row => row.tier === tier));
  }
  const symbols = ["t1", "t2", "t3"].flatMap(tier => result[tier].map(row => row.symbol));
  assert.equal(new Set(symbols).size, 40);
  assert.ok(result.t2.some(row=>row.qualityTier==='T1'),'Unused T1 candidates fill the remaining ranked slots');
  assert.ok(result.t1[0].t1Fit > result.t1.at(-1).t1Fit);
});

test("Crypto radar shows only available symbols when fewer than 10 exist", () => {
  const result = rank([{ symbol: "SOLUSDT", side: "LONG", tier: "t1", oxScore: 80, t1Fit: 80 }]);
  assert.equal(result.t1.length, 1);
  assert.equal(result.t2.length, 0);
  assert.equal(result.t3.length, 0);
});

 test("unqualified candidates never fill T1 even with a high T1 fit",()=>{
 const result=rank([{symbol:"EARLYUSDT",side:"LONG",tier:"t3",oxScore:95,t1Fit:100,t2Fit:80,t3Fit:80}]);
 assert.equal(result.t1.length,0);
 assert.equal(result.t2.length+result.t3.length,1);
 });

test('radar publishes qualified rows while the first scan remains unfinished', () => {
  const result=rank([{symbol:'SOLUSDT',side:'LONG',tier:'t1',oxScore:90,t1Fit:90}],
    {isQueueRunning:true,radarSnapshotReady:false});
  assert.equal(result.t1.length,1);
  assert.equal(result.t1[0].symbol,'SOLUSDT');
  assert.equal(result.t2.length+result.t3.length,0);
});
test('nearby quality uses current directional strength to break scan-order ties',()=>{
 const rows=[
  {symbol:'DEXEUSDT',side:'LONG',tier:'t1',change24h:.003,ret4h:.002,quoteVol:220000},
  {symbol:'CAPUSDT',side:'LONG',tier:'t1',change24h:.27,ret4h:.12,quoteVol:4000000}
 ];
 assert.deepEqual(rank(rows).t1.map(r=>r.symbol),['CAPUSDT']);
 assert.equal(rank(rows).t2[0].symbol,'DEXEUSDT');
 assert.equal(rank(rows).t2[0].oxScore,54);
});
test('turnover and sustained volume outrank an equally graded thin fast spike',()=>{
 const rich=rankingSignal('T2'),thin=rankingSignal('T2');
 rich.volume={recentRatio:2,sustainedBars:3};thin.volume={recentRatio:3,sustainedBars:1};
 const rows=[
  {symbol:'THINUSDT',side:'LONG',tier:'t2',classicSignal:thin,classic:{long:thin},change24h:.2,quoteVol:200000},
  {symbol:'FUNDEDUSDT',side:'LONG',tier:'t2',classicSignal:rich,classic:{long:rich},change24h:.03,quoteVol:15000000}
 ];
 assert.equal(rank(rows).t2[0].symbol,'FUNDEDUSDT');
});
test('a 1H level with volume and matching 4H trend enters observations, never T1',()=>{
 const frames={'1H':preparation(),'4H':preparation()};
 const context={OXClassic:OXClassicForTests};
 const signal=runInNewContext(`${scanner}\nintradayClassicObservation(frames,'long')`,{...context,frames});
 assert.equal(signal.observationEligible,true);
 assert.equal(signal.eligible,false);
 assert.equal(signal.tier,null);
 assert.ok(signal.qualityScore<=74);
 const contrary=runInNewContext(`${scanner}\nintradayClassicObservation(frames,'long')`,
  {...context,frames:{...frames,'4H':shortBars(preparation())}});
 assert.equal(contrary,null);
});
test('a slow 4H grind cannot promote an isolated 1H observation',()=>{
 const bars=preparation(),fast=OXClassicForTests.evaluateClassic(bars,{frame:'1H'});
 const anchor={...OXClassicForTests.evaluateClassic(bars,{frame:'4H'}),
  direction:{confirmed:true,advance:.4,position:.65},pressure:null,volume:{complete:true,recentRatio:1}};
 const fake={evaluateClassic:(_bars,{frame})=>frame==='4H'?anchor:fast};
 const signal=runInNewContext(`${scanner}\nintradayClassicObservation(frames,'long')`,
  {OXClassic:fake,frames:{'1H':bars,'4H':bars}});
 assert.equal(signal,null);
});
test('both directions are independently ranked even when the cached primary direction is opposite',()=>{
  const long=rankingSignal('T1','long'),short=rankingSignal('T1','short');
  const row={symbol:'BOTHUSDT',side:'SHORT',tier:'t1',classic:{long,short},classicSignal:short,oxScore:short.qualityScore};
  const longRank=rank([row]),shortRank=rank([row],{},'short');
  assert.equal(longRank.t1.length,1);assert.equal(longRank.t1[0].side,'LONG');
  assert.equal(longRank.t1[0].classicSignal.side,'LONG');
  assert.equal(shortRank.t1.length,1);assert.equal(shortRank.t1[0].side,'SHORT');
});

test('radar snapshot uses current tickers and excludes expired or unavailable coins', () => {
  function restore(savedAt){
    const state={tickers:[{symbol:'SOLUSDT',change24h:.02}]};
    runInNewContext(`${policy}\n${engine}\n${scanner}\nrestoreRadarSnapshot();`,{
      state:Object.assign(state,{analyzedCache:new Map()}),OXClassic:OXClassicForTests,num:Number,Date,
      isCryptoSymbolAllowed:()=>true,
      localStorage:{getItem:()=>JSON.stringify({savedAt,rows:[{symbol:'SOLUSDT',side:'LONG',tier:'t1',classic:{long:rankingSignal()},change24h:.5},{symbol:'REMOVEDUSDT'}]})}
    });
    return state;
  }
  const current=restore(Date.now());
  assert.equal(current.analyzedCache.size,1);
  assert.equal(current.analyzedCache.get('SOLUSDT').change24h,.02);
  assert.equal(current.radarSnapshotReady,true);
  assert.equal(restore(Date.now()-360000).analyzedCache.size,1);
  assert.equal(restore(Date.now()-2*60*60*1000-1000).analyzedCache.size,0);
});

 test('returning radar retains a paused scan but never an invalidated price or unbounded result',()=>{
 const row={symbol:'SOLUSDT',side:'LONG',tier:'t1',at:Date.now()-360000,lastPrice:100};
 assert.equal(rank([row]).t1.length,1);
 assert.equal(rank([{...row,at:Date.now()-7201000}]).t1.length,0);
 const signal=rankingSignal('T1');
 assert.equal(rank([row],{tickers:[{symbol:'SOLUSDT',lastPr:signal.invalidation.level-signal.atr}]}).t1.length,0);
 });

test('new RWA listings and HPQ never fall into the crypto fallback',()=>{
 const classify=contract=>runInNewContext(`${api}\nclassifyInstrument(contract)`,{contract});
 assert.equal(classify({symbol:'HPQUSDT',baseCoin:'HPQ',isRwa:'YES'}),'stock');
 assert.notEqual(classify({symbol:'HPQUSDT'}),'crypto');
 assert.equal(classify({symbol:'HPQUSDT',symbolType:'perpetual',quoteCoin:'USDT',isRwa:'NO'}),'stock');
 assert.equal(classify({symbol:'HPQUSDT',assetSymbolType:'crypto',isRwa:'NO'}),'stock');
 assert.equal(classify({symbol:'USDJPYUSDT',assetSymbolType:'crypto',isRwa:'NO'}),'other');
 assert.equal(classify({symbol:'NEWSTOCKUSDT',assetSymbolType:'crypto',isRwa:'YES'}),'other');
 assert.equal(classify({symbol:'NEWSTOCKUSDT',isRwa:'YES'}),'other');
 assert.equal(classify({symbol:'XAUTUSDT',isRwa:'YES'}),'crypto');
 assert.equal(classify({symbol:'NEWCOINUSDT',symbolType:'perpetual',quoteCoin:'USDT',isRwa:'NO'}),'crypto');
});

test('a 97-point setup with 114k turnover cannot enter T1 or retain a high display score',()=>{
 for(const side of ['long','short']){
  const signal={...rankingSignal('T1',side),qualityScore:97};
  const result=rank([{symbol:'THINUSDT',side:side.toUpperCase(),tier:'t1',quoteVol:114000,
   classicSignal:signal,classic:{[side]:signal}}],{},side);
  assert.equal(result.t1.length,0);
  assert.equal(result.t2[0].oxScore,54);
  assert.equal(result.t2[0].classicSignal.qualityScore,54);
  assert.equal(result.t2[0].qualityTier,'T3');
  assert.match(result.t2[0].classicSignal.money.reason,/300 萬/);
 }
});

test('live turnover overrides a stale high-volume snapshot without cumulatively penalizing it',()=>{
 const row={symbol:'SOLUSDT',side:'LONG',tier:'t1',quoteVol:15000000};
 const live=rank([row],{tickers:[{symbol:'SOLUSDT',usdtVolume:'114000'}]});
 assert.equal(live.t1.length,0);assert.equal(live.t2[0].oxScore,54);
 const setup={...rankingSignal('T1'),qualityScore:97};
 const apply=(s,v)=>runInNewContext(`${policy}\nOXCryptoLiquidity.apply(signal,turnover)`,{signal:s,turnover:v});
 const thin=apply(setup,114000);
 assert.equal(apply(thin,114000).qualityScore,54);
 assert.equal(apply(thin,15000000).qualityScore,97);
 assert.equal(apply(thin,15000000).tier,'T1');
 for(const missing of [null,undefined,'',NaN,-1,0]){
  const s=apply(setup,missing);assert.equal(s.tier,'T3');assert.equal(s.qualityScore,54);
 }
 assert.equal(apply({...setup,eligible:false,tier:null,observationEligible:true,qualityScore:48},15000000).qualityScore,48);
});

test('liquidity gates apply at each monetary band without changing setup validity',()=>{
 const setup={...rankingSignal('T1'),qualityScore:97};
 for(const [turnover,cap,tier]of [[299999,54,'T3'],[300000,69,'T3'],[1000000,79,'T2'],[2999999,79,'T2'],[3000000,89,'T1'],[10000000,97,'T1']]){
  const s=runInNewContext(`${policy}\nOXCryptoLiquidity.apply(signal,turnover)`,{signal:setup,turnover});
  assert.equal(s.qualityScore,cap);assert.equal(s.tier,tier);assert.equal(s.eligible,true);
 }
});

test('liquidity adjustment leaves low-turnover evidence available for 15 plus 15 observation slots',()=>{
 const rows=Array.from({length:30},(_,i)=>({symbol:`THIN${i}USDT`,side:'LONG',tier:'t1',quoteVol:114000}));
 const result=rank(rows);
 assert.equal(result.t1.length,0);assert.equal(result.t2.length,15);assert.equal(result.t3.length,15);
 assert.ok([...result.t2,...result.t3].every(r=>r.oxScore===54));
});
