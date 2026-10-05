import test from 'node:test';
import assert from 'node:assert/strict';
import { importance, matchesImportance } from '../src/components/news/model.js';
import { macroResult, macroValue, mergeMacroResults } from '../src/components/news/macro.js';
import { parseBlsResult, parseFedCalendar, parseFedRate, easternTime, macroFingerprint } from '../scripts/collect-macro-results.mjs';
const now = Date.parse('2026-10-05T12:00:00Z');
const released = { metric: 'cpi-mom', unit: '%', releasedAt: '2026-10-02T12:30:00Z', consensus: 0.3, consensusSource: 'https://example.com/survey', sourceUrl: 'https://www.bls.gov/release' };
test('unchanged polling timestamps do not trigger deployments but revised facts and outages do',()=>{
  const old={generatedAt:'a',events:[{actual:29,updatedAt:'a'}],sources:[{status:'ready',lastAttemptAt:'a'}]};
  const next={generatedAt:'b',events:[{updatedAt:'b',actual:29}],sources:[{lastAttemptAt:'b',status:'ready'}]};
  assert.equal(macroFingerprint(old),macroFingerprint(next));next.events[0].actual=30;assert.notEqual(macroFingerprint(old),macroFingerprint(next));next.events[0].actual=29;next.sources[0].status='error';assert.notEqual(macroFingerprint(old),macroFingerprint(next));
});
test('all five result labels handle threshold rounding and missing information safely', () => {
  for (const [actual, label] of [[0.1,'利多'],[0.2,'小多'],[0.3,'中性'],[0.4,'小空'],[0.5,'利空']]) assert.equal(macroResult({...released,actual},now).label,label);
  assert.equal(macroResult({...released,actual:0,consensus:null},now).label,'待判讀');
  assert.equal(macroResult({...released,actual:0,consensusSource:null},now).label,'待判讀');
  assert.equal(macroResult({...released,actual:null},now).label,'待更新');
  assert.equal(macroResult({...released,actual:0,releasedAt:'2027-01-01'},now).label,'待公布');
  assert.equal(macroResult({...released,actual:0,unit:'人'},now).label,'待判讀');
  assert.equal(macroValue(0,'%'),'0%'); assert.equal(macroValue(null),'—');
});
test('important switch distinguishes stars from unrated rather than three grade groups', () => {
  for (const stars of [1,2,3,4,5]) { const e={impact:{stars}}; assert.equal(importance(e).value,stars);assert.ok(matchesImportance(e,true));assert.ok(!matchesImportance(e,false)); }
  for(const stars of [null,0,6,'5']) { const e={impact:{stars}};assert.ok(matchesImportance(e,false));assert.ok(!matchesImportance(e,true)); }
});
test('macro overlays preserve deep link identity and remain idempotent across refreshes', () => {
  const snapshot={events:[{id:'calendar-id',category:'macro',title:'Employment Situation for September',occursAt:'2026-10-02T12:30:00Z'}]};
  const overlay={schemaVersion:1,events:[{id:'release-id',category:'macro',title:'非農',matchTitle:'Employment Situation for ',occursAt:'2026-10-02T12:30:00Z',actual:29}]};
  const merged=mergeMacroResults(mergeMacroResults(snapshot,overlay),overlay);assert.equal(merged.events.length,1);assert.equal(merged.events[0].id,'calendar-id');assert.equal(merged.events[0].actual,29);
});
test('BLS parsers use official publication date, revisions, sign and seasonal monthly units', () => {
  const jobs=parseBlsResult('<pre>8:30 a.m. (ET) Friday, October 2, 2026 Both nonfarm payroll employment (+29,000) revised from +162,000 to +133,000</pre>','nonfarm-payrolls');
  assert.equal(jobs.actual,29000);assert.equal(jobs.previous,133000);assert.equal(jobs.previousOriginal,162000);assert.equal(jobs.releasedAt,'2026-10-02T12:30:00.000Z');
  const cpi=parseBlsResult('<pre>8:30 a.m. (ET) Friday, September 11, 2026 (CPI-U) decreased 0.1 percent on a seasonally adjusted basis in August after rising 0.2 percent</pre>','cpi-mom');assert.equal(cpi.actual,-0.1);assert.equal(cpi.previous,0.2);
  assert.throws(()=>parseBlsResult('<pre>Unsupported layout</pre>','cpi-mom'));
  assert.equal(easternTime('2026-12-04'),'2026-12-04T13:30:00.000Z');
});
test('Fed fractional range and publication time remain distinct from meeting schedule', () => {
  const html='2026 FOMC Meetings<div class="row fomc-meeting"><div class="fomc-meeting__month"><strong>September</strong></div><div class="fomc-meeting__date">15-16*</div><a href="/newsevents/pressreleases/monetary20260916a.htm">HTML</a>2025 FOMC Meetings';
  const [meeting]=parseFedCalendar(html,new Date(now));assert.equal(meeting.releasedAt,null);
  const e=parseFedRate('For release at 2:00 p.m. EDT target range by 1/4 percentage point to 3-3/4 to 4 percent',meeting);
  assert.equal(e.actual,4);assert.equal(e.rateRange,'3.75–4%');assert.equal(e.occursAt,'2026-09-16T18:00:00.000Z');assert.equal(e.date,null);
});
