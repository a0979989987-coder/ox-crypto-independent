import test from 'node:test';
import assert from 'node:assert/strict';
import {fedMeetingCalendar,beaReleaseCalendar,foresightCalendar,bitgetAnnouncements} from '../scripts/news-live-providers.mjs';
import {translateHeadlines} from '../scripts/news-translation.mjs';
const stamp='2026-10-06T08:00:00Z';
test('Fed meetings have source dates without invented decision times; minutes estimates stay estimates',()=>{
 const html=`2026 FOMC Meetings<div class="row fomc-meeting"><div class="fomc-meeting__month"><strong>October</strong></div><div class="fomc-meeting__date">27-28</div></div>2025 FOMC Meetings`;
 const rows=fedMeetingCalendar(html,stamp);assert.equal(rows.length,3);assert.equal(rows[0].date,'2026-10-27');assert.equal(rows[1].date,'2026-10-28');assert.equal(rows[1].occursAt,undefined);assert.equal(rows[2].date,'2026-11-18');assert.equal(rows[2].status,'estimated');assert.equal(rows[1].impact.stars,5);
});
test('BEA confirms primary GDP/PCE schedule and converts Eastern DST correctly',()=>{
 const row=(d,t)=>`<tr><td><div class="release-date">${d}</div><small>8:30 AM</small></td><td class="release-title">${t}</td></tr>`;
 const rows=beaReleaseCalendar('Year 2026 Release'+row('October 29','GDP (Advance Estimate), 3rd Quarter 2026')+row('November 25','Personal Income and Outlays, October 2026')+row('To Be Announced','GDP (Advance Estimate), 2026'),stamp);
 assert.equal(rows.length,2);assert.equal(rows[0].occursAt,'2026-10-29T12:30:00.000Z');assert.equal(rows[1].occursAt,'2026-11-25T13:30:00.000Z');assert.match(rows[1].titleZh,/PCE/);
});
const entry=(id,title,start,url='https://example.test/announcement')=>`BEGIN:VEVENT\r\nUID:${id}\r\nDTSTART:${start}\r\nSUMMARY:${title}\r\nURL:${url}\r\nEND:VEVENT\r\n`;
test('publisher calendar unfolds titles, keeps honest precision and omits contradictory and postponed schedules',()=>{
 const input='BEGIN:VCALENDAR\r\nPRODID:foresightnews.pro\r\n'+entry('1','Aptos 将于 10 月 7\r\n  日重置测试网','20261007T000000Z')+entry('2','Bad 主网将于 10 月 19 日上线','20261009T000000Z')+entry('3','Apyx 预计于 10 月 13 日 TGE','20261013T000000Z')+entry('4','Apyx 推迟 10 月 13 日 TGE','20261013T000000Z')+entry('5','Upbit 下架 RVN','20261012T070000Z')+entry('6','Bad 主网将于 2025 年 12 月 12 日上线','20261212T000000Z')+entry('7','Saturn 代币 TGE 于第四季度进行','20261231T000000Z')+entry('8','美国国税局要求 DeFi 交易信息报告','20270101T000000Z')+'END:VCALENDAR';
 const rows=foresightCalendar(input,stamp);assert.equal(rows.length,2);assert.equal(rows[0].date,'2026-10-07');assert.equal(rows[0].occursAt,undefined);assert.equal(rows[0].status,'announced');assert.equal(rows[1].occursAt,'2026-10-12T07:00:00Z');
});
test('Bitget announcements require valid original links/timestamps and do not import stock contracts or fake event times',()=>{
 const rows=bitgetAnnouncements({code:'00000',data:[{annTitle:'ETH 充提暂停',annUrl:'https://www.bitget.com/support/articles/1',cTime:'1791274260230'},{annTitle:'股票合约派息',annUrl:'https://www.bitget.com/support/articles/2',cTime:'1791274260230'},{annTitle:'ETH test',annUrl:'javascript:bad',cTime:'1791274260230'}]},stamp);
 assert.equal(rows.length,1);assert.equal(rows[0].kind,'news');assert.ok(rows[0].publishedAt);assert.equal(rows[0].occursAt,undefined);
});
test('headline translator stops a rate-limited collection and defers remaining titles',async()=>{
 const items=Array.from({length:20},(_,i)=>({title:'English '+i}));let calls=0;
 const result=await translateHeadlines(items,{concurrency:3,fetcher:async()=>{calls++;return {ok:false,status:429};}});
 assert.ok(calls<=3);assert.ok(result.deferred>=17);assert.equal(result.reason,'translation-rate-limited');assert.equal(items.some(i=>i.titleZh),false);
});
