import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateFrames} from '../src/core/classic.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/crypto-forming-boundary-20261002.json',import.meta.url)));
function sample(symbol){
 const response=fixture.responses[symbol],now=Math.max(...Object.values(response).map(r=>r.requestTime));
 return {now,frames:Object.fromEntries(Object.entries(response).map(([f,r])=>[f,r.data.map(v=>({time:+v[0]/1000,open:+v[1],high:+v[2],low:+v[3],close:+v[4],volume:+v[5],provisional:+v[0]+({'1H':3600,'4H':14400,'1D':86400})[f]*1000>r.requestTime})).sort((a,b)=>a.time-b.time)]))};
}
const decide=({frames,now})=>evaluateFrames(frames,{now,setupFrame:'4H',triggerFrame:'1H'});
test('forming boundary retains actual incomplete evidence below ready-entry grades',()=>{
 const s=decide(sample('PEPEUSDT'));
 assert.equal(s.eligible,false);assert.equal(s.observationEligible,true);
 assert.equal(s.observationClass,'forming-boundary');assert.ok(s.qualityScore<55);
 assert.equal(s.pressure.state,'valid');assert.ok(s.pressure.touches>=2);
 assert.ok(s.matchedReasons.some(r=>r.includes('獨立測試')));
 assert.ok(s.rejectionReasons.some(r=>r.includes('尚缺')));
});
test('broader observations do not promote distribution or opposing context',()=>{
 for(const symbol of ['AAVEUSDT','GRVTUSDT']){
  const s=decide(sample(symbol));assert.equal(s.eligible,false);assert.equal(s.observationEligible,false);
 }
 const sampleData=sample('PEPEUSDT'),last=sampleData.frames['1H'].filter(c=>!c.provisional).at(-1);
 last.close=last.low=last.open*.85;last.volume*=20;
 assert.equal(decide(sampleData).observationEligible,false);
});
test('intact PROM setup with weak trigger is low-grade observation, never T1',()=>{
 const s=decide(sample('PROMUSDT'));assert.equal(s.eligible,false);assert.equal(s.observationEligible,true);
 assert.ok(s.qualityScore<=54);assert.ok(s.rejectionReasons.some(r=>r.includes('1H')));
});
