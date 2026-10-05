import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClassic, evaluateFrames, CLASSIC_VERSION, rankClassicTiers } from '../src/core/classic.js';
import { preparation, shortBars, rankingSignal } from './classic-fixtures.mjs';

test('repeated valid overhead pressure with upward progress and volume qualifies before breakout', () => {
  const s = evaluateClassic(preparation(), { frame: '4H' });
  assert.equal(s.version, CLASSIC_VERSION);
  assert.equal(s.eligible, true, JSON.stringify(s.rejectionReasons));
  assert.equal(s.phase, 'prebreakout');
  assert.ok(s.pressure.touches >= 2);
  assert.equal(s.pressure.state, 'valid');
});
test('same nearby pressure rewards directional volume without granting a weak test a top grade',()=>{
 const bars=preparation(),last=bars.at(-1);
 last.close=99.65;last.high=Math.max(last.open,last.close)+.25;
 const weak=evaluateClassic(bars);
 for(let i=65;i<bars.length;i++)bars[i].volume=3500;
 const stronger=evaluateClassic(bars);
 assert.equal(weak.phase,'prebreakout');assert.equal(stronger.phase,'prebreakout');
 assert.equal(weak.eligible,true);assert.equal(stronger.eligible,true);
 assert.ok(stronger.qualityScore>=weak.qualityScore+6);
 assert.ok(weak.qualityScore<82);
});
test('a single oversized volume bar does not outscore sustained buying or invent unknown target room',()=>{
 const spike=preparation(),steady=preparation();
 for(let i=64;i<72;i++){spike[i].volume=1000;steady[i].volume=4000;}
 spike.at(-1).volume=15000;
 const one=evaluateClassic(spike),many=evaluateClassic(steady);
 assert.equal(one.volume.sustainedBars,1);assert.equal(many.volume.sustainedBars,4);
 assert.ok(one.volume.impulseRatio>many.volume.impulseRatio);
 assert.ok(one.qualityScore<many.qualityScore);
 assert.equal(one.roomRisk,null);assert.equal(many.roomRisk,null);
 assert.ok(one.reasons.some(r=>r.includes('下一個歷史目標尚未辨識')));
});
test('price scale and market labels do not change qualification or quality tier', () => {
  const a = evaluateClassic(preparation(), { market: 'crypto' });
  for (const scale of [0.0001, 10, 10000]) {
    const b = evaluateClassic(preparation({ scale }), { market: 'tw' });
    assert.equal(b.eligible, a.eligible); assert.equal(b.tier, a.tier); assert.equal(b.phase, a.phase);
  }
});
test('nearness or absolute turnover cannot compensate for absent upward volume', () => {
  const s = evaluateClassic(preparation({ volume: false }), { turnover: 1e12 });
  assert.equal(s.eligible, false); assert.equal(s.tier, null);
  assert.ok(s.rejectionReasons.includes('上攻量能不足'));
});
test('missing volume stays unavailable', () => {
  const bars = preparation(); bars[50].volume = null;
  const s = evaluateClassic(bars);
  assert.equal(s.eligible, false); assert.equal(s.volume.ratio, null);
});
test('down-volume and current falling structure are excluded at every tier', () => {
  const bars = preparation(), last = bars.at(-1);
  Object.assign(last, { close: last.open - 2, low: last.open - 2.2, volume: 12000 });
  const s = evaluateClassic(bars);
  assert.equal(s.eligible, false); assert.equal(s.tier, null); assert.equal(s.volume.distribution, true);
});
test('cross-and-return consumes the original pressure instead of resetting preparation', () => {
  const bars = preparation();
  for (const [i, close] of [[50, 102], [51, 103], [52, 94]]) {
    const open = bars[i].open;
    Object.assign(bars[i], { close, high: Math.max(open, close) + .3, low: Math.min(open, close) - .3 });
  }
  const s = evaluateClassic(bars);
  const old = s.levels.filter(p => p.kind === 'horizontal' && Math.abs(p.level - 100) < .1);
  assert.ok(old.length); assert.ok(old.every(p => p.state === 'consumed'));
  assert.ok(!s.pressure || Math.abs(s.pressure.level - 100) > .1);
});
test('an unfinished crossing is a probe, never a confirmed breakout', () => {
  const bars = preparation(), last = bars.at(-1);
  bars.push({ time: last.time + 3600, open: last.close, high: 101, low: last.close - .1, close: 100.6, volume: 3000, provisional: true });
  const s = evaluateClassic(bars);
  assert.equal(s.phase, 'probe'); assert.equal(s.pressure.state, 'valid');
  assert.equal(s.closedAt, last.time); assert.equal(s.provisional, true);
});
test('future bars cannot create touches or change a historical scan', () => {
  const bars = preparation(), now = bars.at(-1).time * 1000 + 1000;
  const future = { ...bars.at(-1), time: now / 1000 + 100000, high: 300, close: 250, volume: 1e8 };
  assert.deepEqual(evaluateClassic([...bars, future], { now }), evaluateClassic(bars, { now }));
});
test('short and long rules are mirrored with strictly separated direction', () => {
  const bars = shortBars(preparation()), bear = evaluateClassic(bars, { side: 'short' }), bull = evaluateClassic(bars);
  assert.equal(bear.eligible, true); assert.equal(bear.side, 'SHORT'); assert.equal(bull.eligible, false);
});
test('a higher-frame setup cannot bypass a weak trigger frame', () => {
  const s = evaluateFrames({ '4H': preparation(), '1H': shortBars(preparation()) }, { setupFrame: '4H', triggerFrame: '1H' });
  assert.equal(s.eligible, false); assert.equal(s.tier, null);
  assert.ok(s.rejectionReasons.some(r => r.includes('1H')));
});

test('descending resistance uses highs; mirrored rising support uses lows',()=>{
 const bars=preparation().map((c,i)=>({...c,open:c.open-.04*i,high:c.high-.04*i,low:c.low-.04*i,close:c.close-.04*i}));
 const down=evaluateClassic(bars),up=evaluateClassic(shortBars(bars),{side:'short'});
 assert.equal(down.pressure.kind,'diagonal');assert.ok(down.pressure.slope<0);
 assert.equal(up.pressure.kind,'diagonal');assert.ok(up.pressure.slope>0);
 assert.ok(down.levels.filter(p=>p.kind==='diagonal').every(p=>p.slope<0));
 assert.ok(up.levels.filter(p=>p.kind==='diagonal').every(p=>p.slope>0));
});
test('an upper wick test keeps pressure valid until a close actually confirms crossing',()=>{
 const bars=preparation();bars.at(-1).high=100.2;
 const s=evaluateClassic(bars);assert.equal(s.phase,'prebreakout');assert.equal(s.pressure.state,'valid');
});
test('a higher-frame setup cannot waive exhaustion on the trigger frame',()=>{
 const trigger=preparation(),last=trigger.at(-1);last.high+=6;
 const s=evaluateFrames({'4H':preparation(),'1H':trigger},{setupFrame:'4H',triggerFrame:'1H'});
 assert.equal(s.eligible,false);assert.equal(s.tier,null);
});
test('T1 overflow fills T2 and T3 as the next 15 plus 15 ranked candidates',()=>{
 const input=Array.from({length:55},(_,i)=>({symbol:'COIN'+i,classicSignal:{...rankingSignal(),qualityScore:100-i/10}}));
 const output=rankClassicTiers([...input,input[0]],{side:'long'});
 assert.deepEqual(['T1','T2','T3'].map(t=>output.filter(r=>r.tier===t).length),[10,15,15]);
 assert.equal(new Set(output.map(r=>r.symbol)).size,40);
 assert.ok(output.every(r=>r.qualityTier==='T1'));
 assert.deepEqual(output.filter(r=>r.tier==='T2').map(r=>r.symbol),input.slice(10,25).map(r=>r.symbol));
 assert.deepEqual(output.filter(r=>r.tier==='T3').map(r=>r.symbol),input.slice(25,40).map(r=>r.symbol));
});
test('an empty strict T1 never borrows weaker candidates while T2 and T3 still fill 15 each',()=>{
 const input=Array.from({length:45},(_,i)=>({symbol:'C'+i,classicSignal:{...rankingSignal('T3'),qualityScore:70-i/10}}));
 input.push({symbol:'INVALID',classicSignal:{...rankingSignal(),eligible:false}});
 input.push({symbol:'BEAR',classicSignal:rankingSignal('T1','short')});
 const output=rankClassicTiers(input,{side:'long'});
 assert.deepEqual(['T1','T2','T3'].map(t=>output.filter(r=>r.tier===t).length),[0,15,15]);
 assert.ok(output.every(r=>r.classicSignal.eligible&&r.classicSignal.side==='LONG'));
 assert.equal(output.length,30);
});

test('a supported 1H impulse cannot replace missing 4H directional volume',()=>{
 const s=evaluateFrames({'4H':preparation({volume:false}),'1H':preparation()}, {setupFrame:'4H',triggerFrame:'1H'});
 assert.equal(s.eligible,false);assert.ok(s.rejectionReasons.includes('上攻量能不足'));
});
test('momentum without a tested liquidity origin is not a classic continuation',()=>{
 const bars=Array.from({length:72},(_,i)=>({time:1700000000+i*3600,open:90+i*.4,close:90+i*.4+.3,high:90+i*.4+.4,low:90+i*.4-.1,volume:i>=64?2000:1000}));
 const s=evaluateClassic(bars);assert.equal(s.direction.confirmed,true);assert.equal(s.volume.supported,true);
 assert.equal(s.eligible,false);assert.equal(s.pressure,null);assert.equal(s.phase,'watch');
});
test('a weak bounce inside a larger decline and its mirrored pullback never change sides',()=>{
 const bars=preparation().map((c,i)=>{const offset=i<56?(56-i)*.7:0;return {...c,open:c.open+offset,close:c.close+offset,high:c.high+offset,low:c.low+offset};});
 for(const [input,side] of [[bars,'long'],[shortBars(bars),'short']]){
  const s=evaluateClassic(input,{side});assert.equal(s.direction.opposingContext,true);assert.equal(s.eligible,false);
 }
});
test('previous rule-version signals cannot reenter the current ranking',()=>{
 assert.equal(rankClassicTiers([{symbol:'STALE',classicSignal:{...rankingSignal(),version:CLASSIC_VERSION-1}}]).length,0);
});
test('a previous decline does not ban a recovered, strong rebound attacking valid pressure',()=>{
 const bars=preparation().map((c,i)=>{const offset=i<12?(12-i)*2:0;return {...c,open:c.open+offset,close:c.close+offset,high:c.high+offset,low:c.low+offset};});
 const s=evaluateClassic(bars);assert.equal(s.eligible,true,JSON.stringify(s.rejectionReasons));
 assert.equal(s.pressure.state,'valid');assert.equal(s.volume.supported,true);
});
test('directional observations fill 15/15 without masquerading as strict T1 signals',()=>{
 const signal=evaluateClassic(preparation({volume:false}));
 assert.equal(signal.eligible,false);assert.equal(signal.observationEligible,true);
 const input=Array.from({length:40},(_,i)=>({symbol:'OBS'+i,classicSignal:signal}));
 const ranked=rankClassicTiers(input,{side:'long'});
 assert.deepEqual(['T1','T2','T3'].map(t=>ranked.filter(r=>r.tier===t).length),[0,15,15]);
 assert.ok(ranked.every(r=>r.observationOnly&&r.rankStatus.includes('觀察')));
});
test('weak countertrend bounces and distribution cannot fill observation quotas',()=>{
 const declining=preparation().map((c,i)=>{const offset=i<56?(56-i)*.7:0;return {...c,open:c.open+offset,close:c.close+offset,high:c.high+offset,low:c.low+offset};});
 const falling=preparation(),last=falling.at(-1);Object.assign(last,{close:last.open-2,low:last.open-2.2,volume:12000});
 for(const bars of [declining,falling]){const s=evaluateClassic(bars);assert.equal(s.observationEligible,false);assert.deepEqual(rankClassicTiers([{symbol:'BAD',classicSignal:s}]),[]);}
});
test('a directional observation requires complete actual volume history',()=>{
 const bars=preparation({volume:false});bars[50].volume=null;
 assert.equal(evaluateClassic(bars).observationEligible,false);
});
test('direction alone without tested liquidity or a supported strong impulse is not an observation',()=>{
 const bars=Array.from({length:72},(_,i)=>({time:1700000000+i*3600,open:90+i*.4,close:90+i*.4+.3,high:90+i*.4+.4,low:90+i*.4-.1,volume:1000}));
 const s=evaluateClassic(bars);assert.equal(s.direction.confirmed,true);
 assert.equal(s.volume.supported,false);assert.equal(s.observationEvidence.liquidity,false);
 assert.equal(s.observationEligible,false);assert.deepEqual(rankClassicTiers([{symbol:'BARE',classicSignal:s}]),[]);
});
test('missing activation confirmation cannot display a perfect completeness score',()=>{
 const s=evaluateClassic(preparation({volume:false}));
 assert.equal(s.observationEligible,true);assert.equal(s.eligible,false);assert.ok(s.qualityScore<=79);
 const combined=evaluateFrames({'4H':preparation(),'1H':preparation({volume:false})},{setupFrame:'4H',triggerFrame:'1H'});
 assert.equal(combined.eligible,false);assert.ok(combined.qualityScore<=79);
});
test('remaining candidates descend by fulfilled-condition score before proximity priority',()=>{
 const near={symbol:'NEAR',classicSignal:{...rankingSignal('T3'),qualityScore:45,priority:0}};
 const stronger={symbol:'STRONG',classicSignal:{...rankingSignal('T3'),qualityScore:75,priority:1}};
 assert.deepEqual(rankClassicTiers([near,stronger]).map(r=>r.symbol),['STRONG','NEAR']);
});
test('observations retain actual qualifying features without claiming missing confirmations',()=>{
 const combined=evaluateFrames({'4H':preparation(),'1H':preparation({volume:false})},{setupFrame:'4H',triggerFrame:'1H'});
 assert.equal(combined.observationEligible,true);assert.equal(combined.eligible,false);
 assert.ok(combined.matchedReasons.some(r=>r.includes('次獨立測試')));
 assert.ok(combined.matchedReasons.some(r=>r.includes('4H 同向放量已確認')));
 assert.ok(!combined.matchedReasons.some(r=>r.includes('1H 同向放量已確認')));
 assert.ok(combined.rejectionReasons.some(r=>r.includes('1H')));
});
