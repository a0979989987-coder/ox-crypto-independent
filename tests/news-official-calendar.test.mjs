import test from 'node:test';import assert from 'node:assert/strict';import {nyseCalendar,ethereumUpgradeCalendar} from '../scripts/news-official-calendar.mjs';
test('NYSE closes only on official table days, retains US trading dates and early session differences',()=>{
 const names=['New Year’s Day','Martin Luther King, Jr. Day',"Washington&#x27;s Birthday",'Good Friday','Memorial Day','Juneteenth National Independence Day','Independence Day','Labor Day','Thanksgiving Day','Christmas Day'];
 const days=['January 1','January 19','February 16','April 3','May 25','June 19','July 3','September 7','November 26','December 25'];
 const html='<table><tr><th>Holiday</th><th>2026</th></tr>'+names.map((n,i)=>`<tr><td>${n}</td><td>${days[i]}</td></tr>`).join('')+'</table><p>Each market closes early Friday, November 27, 2026.</p>';
 const events=nyseCalendar(html);assert.equal(events.length,11);assert.equal(events.filter(e=>e.marketClosed).length,10);assert.equal(events.at(-1).date,'2026-11-27');assert.equal(events.at(-1).category,'exchange');assert.ok(events.every(e=>e.originalTimezone==='America/New_York'));assert.ok(!events.some(e=>e.date==='2026-10-12'));assert.throws(()=>nyseCalendar('no table'));
});
test('Ethereum activation imports confirmed timestamps without inventing TBD mainnet dates',()=>{
 const html='<table><tr><td>Sepolia</td><td>353,024</td><td>11,296,768</td><td>2026-10-06 13:53:36</td><td>1791294816</td></tr><tr><td>Mainnet</td><td>TBD</td><td>TBD</td><td>TBD</td><td>TBD</td></tr></table>';
 const events=ethereumUpgradeCalendar(html);assert.equal(events.length,1);assert.equal(events[0].occursAt,'2026-10-06T13:53:36.000Z');assert.equal(events[0].chain,'Sepolia');assert.deepEqual(events[0].markets,['crypto']);assert.ok(events[0].description.includes('不表示'));assert.throws(()=>ethereumUpgradeCalendar('TBD'));
});
