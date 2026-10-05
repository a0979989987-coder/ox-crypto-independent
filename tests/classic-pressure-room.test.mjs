import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateClassic,evaluateFrames} from '../src/core/classic.js';
import {preparation} from './classic-fixtures.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/crypto-pressure-room-20261001.json',import.meta.url)));
function sample(symbol){
 const response=fixture.responses[symbol],now=Math.max(...Object.values(response).map(r=>r.requestTime));
 const frames=Object.fromEntries(Object.entries(response).map(([f,r])=>[f,r.data.map(v=>({time:+v[0]/1000,open:+v[1],high:+v[2],low:+v[3],close:+v[4],volume:+v[5],provisional:+v[0]+({'1H':3600,'4H':14400,'1D':86400})[f]*1000>r.requestTime})).sort((a,b)=>a.time-b.time)]));
 return {frames,now};
}
test('US current horizontal attack is the trigger, not an obstacle above an obsolete lower swing',()=>{
 const {frames,now}=sample('USUSDT');
 const signal=evaluateClassic(frames['1H'],{frame:'1H',now,contextFrame:'1D',contextBars:frames['1D']});
 assert.equal(signal.pressure.kind,'horizontal');assert.equal(signal.pressure.level,.03572);
 assert.equal(signal.pressure.state,'valid');assert.equal(signal.horizontalReady,true);
 assert.ok(signal.target.level>signal.pressure.level);assert.equal(signal.target.frame,'1D');
 assert.ok(!signal.rejectionReasons.includes('下一個目標空間不足'));
 assert.ok(signal.qualityScore<90);
});
test('PROM recognizes the observed 4H horizontal ceiling instead of duplicate rising lines',()=>{
 const {frames,now}=sample('PROMUSDT'),s=evaluateClassic(frames['4H'],{frame:'4H',now});
 assert.equal(s.pressure.kind,'horizontal');assert.equal(s.pressure.level,6.7167);
 assert.equal(s.pressure.touches,2);assert.equal(s.horizontalReady,true);
 assert.ok(!s.rejectionReasons.includes('下一個目標空間不足'));
 assert.equal(s.target,null); // Distant rising projections are not historical objectives.
 const combined=evaluateFrames(frames,{now,setupFrame:'4H',triggerFrame:'1H'});
 assert.equal(combined.eligible,false); // Actual live 1H pullback still blocks strict entry.
 assert.ok(combined.rejectionReasons.some(r=>r.includes('1H')));
});
test('ALICE volume spike cannot invent upper targets or score 90 after extending and retracing',()=>{
 const {frames,now}=sample('ALICEUSDT');
 for(const [setupFrame,triggerFrame] of [['4H','1H'],['1D','4H']]){
  const s=evaluateFrames(frames,{now,setupFrame,triggerFrame,confirmationFrame:setupFrame==='1D'?'1H':undefined});
  assert.ok(s.qualityScore<82);assert.equal(s.eligible,false);assert.equal(s.target,null);
 }
});
test('larger frame horizontal evidence earns priority only with the same actual volume confirmation',()=>{
 const bars=preparation();
 const hourly=evaluateClassic(bars,{frame:'1H'}),daily=evaluateClassic(bars,{frame:'1D'});
 assert.equal(hourly.horizontalReady,true);assert.equal(daily.horizontalReady,true);
 assert.ok(daily.qualityScore>hourly.qualityScore);
 const weak=evaluateClassic(preparation({volume:false}),{frame:'1W'});
 assert.equal(weak.horizontalReady,false);assert.equal(weak.eligible,false);
});
test('a provisional leap toward a new ceiling cannot borrow closed proximity for T1',()=>{
 const bars=preparation();bars.push({...bars.at(-1),time:bars.at(-1).time+3600,open:99,close:101,high:101.2,low:98.8,provisional:true});
 const s=evaluateClassic(bars,{frame:'4H'});
 assert.equal(s.phase,'probe');assert.equal(s.eligible,false);assert.ok(s.qualityScore<82);
});

test('confirmed recovery uses post-low buying at a fresh horizontal ceiling, retaining original selloff evidence',()=>{
 const {frames,now}=sample('USUSDT');
 const s=evaluateFrames(frames,{now,setupFrame:'4H',triggerFrame:'1H'});
 assert.equal(s.volume.window,'confirmed-recovery');assert.ok(s.volume.previousUpwardShare<.56);
 assert.ok(s.volume.upwardShare>.7);assert.equal(s.pressure.kind,'horizontal');
 assert.equal(s.eligible,true);assert.equal(s.tier,'T1');assert.ok(s.qualityScore<90);
 const missing=structuredClone(frames);missing['4H'].at(-12).volume=null;
 assert.equal(evaluateFrames(missing,{now,setupFrame:'4H',triggerFrame:'1H'}).eligible,false);
 const falling=structuredClone(frames);const last=falling['4H'].at(-1);last.close=last.low=.017;
 assert.equal(evaluateFrames(falling,{now,setupFrame:'4H',triggerFrame:'1H'}).eligible,false);
});
