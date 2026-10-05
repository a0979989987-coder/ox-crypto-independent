import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateClassic,evaluateFrames,rankClassicTiers} from '../src/core/classic.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/crypto-classic-reversals-20261001.json',import.meta.url)));
const monFixture=JSON.parse(readFileSync(new URL('./fixtures/crypto-mon-20261001.json',import.meta.url)));
const radarAudit=JSON.parse(readFileSync(new URL('./fixtures/crypto-radar-audit-20261001.json',import.meta.url)));
function recordedFrames(response){
 const now=Math.max(...Object.values(response).map(r=>Number(r.requestTime)));
 const frames=Object.fromEntries(Object.entries(response).map(([frame,r])=>[frame,
   r.data.map(v=>({time:+v[0]/1000,open:+v[1],high:+v[2],low:+v[3],close:+v[4],volume:+v[5],
     provisional:+v[0]+({'1H':3600,'4H':14400,'1D':86400})[frame]*1000>r.requestTime})).sort((a,b)=>a.time-b.time)]));
 return {frames,now};
}
function sample(symbol){
 return recordedFrames(fixture.responses[symbol]);
}
test('recorded CAP remains an observation when the current candle recovers a prior upper wick',()=>{
 const {frames,now}=sample('CAPUSDT'),s=evaluateFrames(frames,{now,setupFrame:'4H',triggerFrame:'1H'});
 assert.equal(s.wickRecovered,true);assert.equal(s.observationEligible,true);assert.equal(s.eligible,false);
 assert.equal(s.phase,'watch');assert.ok(s.matchedReasons.some(r=>r.includes('收復前一根上影線')));
 assert.equal(rankClassicTiers([{symbol:'CAPUSDT',classicSignal:s}])[0].tier,'T2');
});
test('recorded CAP daily probe is observed without calling incomplete daily volume confirmed',()=>{
 const {frames,now}=sample('CAPUSDT'),s=evaluateFrames(frames,{now,setupFrame:'1D',triggerFrame:'4H'});
 assert.equal(s.frame,'1D');assert.equal(s.phase,'probe');assert.equal(s.observationEligible,true);assert.equal(s.eligible,false);
 assert.equal(s.volume.supported,false);assert.ok(s.qualityScore<82);
});
test('recorded volume-backed swing reversal may enter observations before the broader downtrend is reclaimed',()=>{
 const {frames,now}=sample('龙虾USDT'),s=evaluateFrames(frames,{now,setupFrame:'4H',triggerFrame:'1H'});
 assert.equal(s.direction.opposingContext,true);assert.equal(s.reversal.candidate,true);
 assert.equal(s.observationEligible,true);assert.equal(s.eligible,false);assert.equal(s.phase,'reversal-probe');
 assert.equal(s.pressure.kind,'swing');assert.equal(s.pressure.touches,1);assert.equal(s.pressure.level,.088692);
 assert.ok(s.matchedReasons.some(r=>r.includes('低點之後已收 K 同向放量')));
 assert.ok(s.qualityScore>=72&&s.qualityScore<82);
 assert.equal(rankClassicTiers([{symbol:'龙虾USDT',classicSignal:s}])[0].tier,'T2');
});
test('a high wick or large volume below the reclaimed swing cannot activate a reversal observation',()=>{
 const {frames,now}=sample('龙虾USDT'),bars=frames['4H'];bars.at(-1).close=.080;
 const s=evaluateClassic(bars,{now,frame:'4H'});assert.equal(s.reversal.candidate,false);assert.equal(s.observationEligible,false);
});
test('fresh invalidation drops a previously observed reversal',()=>{
 const {frames,now}=sample('龙虾USDT');Object.assign(frames['4H'].at(-1),{close:.025,low:.02});
 assert.equal(evaluateFrames(frames,{now,setupFrame:'4H',triggerFrame:'1H'}).observationEligible,false);
});
test('a strong higher-frame reversal cannot waive falling distribution on its trigger frame',()=>{
 const {frames,now}=sample('龙虾USDT'),bars=frames['1H'].filter(c=>!c.provisional),last=bars.at(-1);
 Object.assign(last,{close:last.open-.02,low:last.open-.025,volume:last.volume*10});frames['1H']=bars;
 assert.equal(evaluateFrames(frames,{now,setupFrame:'4H',triggerFrame:'1H'}).observationEligible,false);
});
test('reversal observation needs complete actual volume and works symmetrically on the short side',()=>{
 const {frames,now}=sample('龙虾USDT'),mirrored=Object.fromEntries(Object.entries(frames).map(([f,bars])=>[f,bars.map(c=>({...c,open:1-c.open,close:1-c.close,high:1-c.low,low:1-c.high}))]));
 const bear=evaluateFrames(mirrored,{side:'short',now,setupFrame:'4H',triggerFrame:'1H'});
 assert.equal(bear.side,'SHORT');assert.equal(bear.observationEligible,true);assert.equal(bear.phase,'reversal-probe');
 frames['4H'].at(-12).volume=null;
 assert.equal(evaluateFrames(frames,{now,setupFrame:'4H',triggerFrame:'1H'}).observationEligible,false);
});
test('recorded MON unfinished daily probe cannot score 99 or bypass a nearby 4H ceiling and weak 1H tape',()=>{
 const {frames,now}=recordedFrames(monFixture.responses);
 const result=evaluateFrames(frames,{side:'long',setupFrame:'1D',triggerFrame:'4H',confirmationFrame:'1H',now});
 assert.equal(result.phase,'probe');assert.equal(result.eligible,false);assert.equal(result.observationEligible,false);
 assert.ok(result.qualityScore<=79); // Old duplicate diagonal targets no longer create a space veto.
 assert.ok(result.rejectionReasons.some(r=>r.includes('1H 短線方向')));
 assert.deepEqual(rankClassicTiers([{symbol:'MONUSDT',classicSignal:result}]),[]);
});
test('recorded flat SNX GRVT CVX 1000SATS JST and WOO cannot crowd fresh volume-backed reversals',()=>{
 const rows=[];
 for(const symbol of ['SNXUSDT','GRVTUSDT','CVXUSDT','1000SATSUSDT','JSTUSDT','WOOUSDT']){
  const {frames,now}=recordedFrames(radarAudit.responses[symbol]);
  const signals=[['4H','1H'],['1D','4H']].map(([setupFrame,triggerFrame])=>
    evaluateFrames(frames,{setupFrame,triggerFrame,confirmationFrame:setupFrame==='1D'?'1H':undefined,now}));
  assert.ok(signals.every(s=>!s.eligible&&!s.observationEligible),symbol+' is no current long candidate');
  rows.push({symbol,classicSignal:signals[1]});
 }
 const reversal=sample('龙虾USDT'),s=evaluateFrames(reversal.frames,{setupFrame:'4H',triggerFrame:'1H',now:reversal.now});
 assert.equal(s.observationEligible,true);rows.push({symbol:'龙虾USDT',classicSignal:s});
 assert.deepEqual(rankClassicTiers(rows).map(row=>row.symbol),['龙虾USDT']);
});
test('recorded RE cannot bypass 1H distribution even after duplicate targets are removed',()=>{
 const {frames,now}=recordedFrames(radarAudit.responses.REUSDT),signal=evaluateFrames(frames,
  {setupFrame:'1D',triggerFrame:'4H',confirmationFrame:'1H',now});
 assert.equal(signal.eligible,false);assert.equal(signal.observationEligible,false);
 assert.notEqual(signal.phase,'breakout');
 assert.ok(signal.rejectionReasons.some(reason=>reason.includes('1H 短線方向')));
});
test('recorded CAP still enters a directional observation during strong volume-backed recovery',()=>{
 const {frames,now}=recordedFrames(radarAudit.responses.CAPUSDT),signal=evaluateFrames(frames,
  {setupFrame:'4H',triggerFrame:'1H',now});
 assert.equal(signal.observationEligible,true);assert.equal(signal.eligible,false);
 assert.ok(signal.qualityScore>0&&signal.qualityScore<82);
});
test('partial-condition scores separate a strong swing reversal from a nearby-target probe',()=>{
 const cap=recordedFrames(radarAudit.responses.CAPUSDT),lobster=sample('龙虾USDT');
 const probe=evaluateFrames(cap.frames,{setupFrame:'4H',triggerFrame:'1H',now:cap.now});
 const reversal=evaluateFrames(lobster.frames,{setupFrame:'4H',triggerFrame:'1H',now:lobster.now});
 assert.equal(probe.observationEligible,true);
 assert.equal(reversal.observationEligible,true);
 assert.ok(reversal.qualityScore>probe.qualityScore,
   `fresh reversal ${reversal.qualityScore} must outrank target-constrained probe ${probe.qualityScore}`);
 assert.deepEqual(rankClassicTiers([
  {symbol:'CAPUSDT',classicSignal:probe},{symbol:'龙虾USDT',classicSignal:reversal}
 ]).map(row=>row.symbol),['龙虾USDT','CAPUSDT']);
});
