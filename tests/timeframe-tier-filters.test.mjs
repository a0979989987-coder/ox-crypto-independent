import { rankingSignal } from './classic-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
function filters(){const data=new Map(),context={window:{},localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},document:{dispatchEvent(){}},CustomEvent:class{}};runInNewContext(readFileSync(new URL('../src/components/radar/timeframe-filters.js',import.meta.url),'utf8'),context);return context.window.OXTierFilters;}
test('timeframe combinations enforce all/any, real classifications and independent market preferences',()=>{
 const f=filters(),rules=[{frame:'1H',tier:'T1'},{frame:'4H',tier:'T2'}];
 const rows=[{id:'both',frames:{'1H':'t1','4H':'T2'}},{id:'one',frames:{'1H':'T1'}},{id:'wrong',frames:{'1H':'T3','4H':'T2'}},{id:'unknown',frames:{}}];
 f.set('crypto',{enabled:true,rules});
 const ids=()=>f.apply(rows,'crypto',(r,frame)=>r.frames[frame]).map(r=>r.id);
 assert.deepEqual(ids(),['both']);assert(!f.get('tw').enabled);
 f.set('crypto',{enabled:true,rules,match:'any'});assert.deepEqual(ids(),['both','one','wrong']);
 assert.equal(f.resolve(rows[2],f.get('crypto'),(r,frame)=>r.frames[frame]).frame,'4H');
 f.set('crypto',{enabled:false,rules});assert.equal(f.apply(rows,'crypto',()=>null),rows);
 assert.equal(f.normalize(null).rules.length,0);
 assert.equal(f.normalize({rules:[...rules,{frame:'1H',tier:'T3'},{frame:'bogus',tier:'T1'}]}).rules.length,2);
});
test('combination direction rejects opposite setups, and Crypto excludes unfinished hourly and calendar-month candles',()=>{
 const f=filters(),config=f.normalize({enabled:true,rules:[{frame:'1H',tier:'T1'},{frame:'4H',tier:'T2'}]});
 const row={'1H':{tier:'T1',side:'LONG'},'4H':{tier:'T2',side:'SHORT'}};
 assert.equal(f.resolve(row,config,(r,frame,side)=>r[frame].side===side?r[frame]:null,'LONG'),null);
 const context={};runInNewContext(readFileSync(new URL('../src/markets/crypto/scanner.js',import.meta.url),'utf8'),context);
 const now=Date.parse('2026-10-01T07:30:00Z');
 const bars=[{time:now/1000-3600},{time:now/1000-1800}];context.bars=bars;context.now=now;
 assert.equal(runInNewContext("closedTierCandles(bars,'1H',now).length",context),1);
 context.bars=[{time:Date.parse('2026-09-01T00:00:00Z')/1000},{time:Date.parse('2026-10-01T00:00:00Z')/1000}];
 assert.equal(runInNewContext("closedTierCandles(bars,'1M',now).length",context),1);
 context.bars=[{time:Date.parse('2026-09-30T16:00:00Z')/1000}];
 assert.equal(runInNewContext("closedTierCandles(bars,'1M',now).length",context),0,'Bitget UTC+8 October candle is still forming after UTC midnight');
});
