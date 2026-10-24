import { createHash } from 'node:crypto';
import { validDate } from '../src/components/news/model.js';

const months = 'January February March April May June July August September October November December'.split(' ');
const plain = html => String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
const id = value => createHash('sha256').update(value).digest('hex').slice(0, 20);
const https = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } };
const dateKey = (year, month, day) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
const base = (sourceId, url, title, updatedAt) => ({ sourceId, sourceUrl:url, link:url, title, kind:'event', markets:['crypto'], updatedAt, status:'confirmed', announcementStatus:'confirmed', impact:{stars:null,ruleVersion:'unassessed-v1',reason:'來源未提供重要性分級'} });
const importance = (stars, reason, url) => ({stars,ruleVersion:'official-release-category-v1',reason:`${reason}；星級表示事件類別重要性，不表示多空或數據結果。`,evidence:url,sourceConfidence:'official-source'});

// Shared with the live endpoint and the browser; see those modules.
export { bitgetAnnouncements } from '../server/news/feeds.js';
export { foresightCalendar } from '../src/components/news/foresight.js';

export function fedMeetingCalendar(html, stamp) {
  const url = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', events=[];
  const panels = [...html.matchAll(/(20\d{2}) FOMC Meetings([\s\S]*?)(?=(?:20\d{2}) FOMC Meetings|$)/g)];
  for (const [,year,section] of panels) {
    if (+year < +stamp.slice(0,4) || +year > +stamp.slice(0,4)+1) continue;
    const meetings = section.split(/<div\b[^>]*class="[^"]*\brow fomc-meeting[^"]*"[^>]*>/i).slice(1);
    for (const meeting of meetings) {
      const month = plain(meeting.match(/class="[^"]*fomc-meeting__month[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
      const days = plain(meeting.match(/class="[^"]*fomc-meeting__date[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '').match(/^(\d{1,2})-(\d{1,2})\*?$/);
      const mi = months.indexOf(month)+1;
      if (!mi || !days) continue;
      const start = dateKey(year,mi,days[1]), end = dateKey(year,mi,days[2]);
      if (!validDate(start) || !validDate(end) || end < start) continue;
      for (const [date,label] of [[start,'會議開始'],[end,'會議結束／政策決議日']]) {
        const title=`美國聯準會 FOMC ${label}`;
        events.push({...base('fed-calendar',url,title,stamp),id:`fed:meeting:${date}`,titleZh:title,translationStatus:'translated',date,category:'macro',country:'美國',originalTimezone:'America/New_York',scheduleBasis:'聯準會官方會議日曆僅列日期，未提供此場會議的精確公布時間。',impact:importance(5,'聯準會預定政策會議',url)});
      }
      const released=plain(meeting).match(/Released ([A-Z][a-z]+) (\d{1,2}), (20\d{2})/);
      const minuteDate=released ? dateKey(released[3],months.indexOf(released[1])+1,released[2]) : new Date(Date.parse(end+'T12:00:00Z')+21*86400000).toISOString().slice(0,10);
      if (!validDate(minuteDate)) continue;
      const title='美國聯準會 FOMC 會議紀要';
      events.push({...base('fed-calendar',url,title,stamp),id:`fed:minutes:${end}`,titleZh:title,translationStatus:'translated',date:minuteDate,category:'macro',country:'美國',originalTimezone:'America/New_York',status:released?'confirmed':'estimated',announcementStatus:released?'confirmed':'estimated',scheduleBasis:released?'官方頁面列出的紀要發布日期。':'依聯準會官方「政策決議後三週發布紀要」規則推估日期；精確時間待公告。',impact:importance(4,'聯準會會議紀要',url)});
    }
  }
  if (!events.length) throw Error('聯準會會議日曆沒有可驗證日期');
  return events;
}

const easternZone = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'short'});
export function beaReleaseCalendar(html, stamp) {
  const url='https://www.bea.gov/news/schedule', events=[];
  const year=html.match(/Year\s*(?:<[^>]*>\s*)*(20\d{2})/)?.[1] || plain(html).match(/Year (20\d{2}) Release/)?.[1];
  if (!year) throw Error('BEA 日曆年份缺失');
  for (const [,row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const releaseDate=plain(row.match(/class="release-date"[^>]*>([\s\S]*?)<\/div>/i)?.[1]||'').match(/^([A-Z][a-z]+) (\d{1,2})$/);
    const time=plain(row.match(/<small\b[^>]*>([\s\S]*?)<\/small>/i)?.[1]||'');
    const title=plain(row.match(/<td\b[^>]*class="release-title[^>]*>([\s\S]*?)<\/td>/i)?.[1]||'');
    if (!releaseDate || !/^(GDP \(|Personal Income and Outlays,|U\.S\. International Trade in Goods and Services,)/.test(title) || !/^\d{1,2}:\d{2} [AP]M$/.test(time)) continue;
    const date=dateKey(year,months.indexOf(releaseDate[1])+1,releaseDate[2]); if (!validDate(date)) continue;
    const zone=easternZone.formatToParts(new Date(date+'T12:00:00Z')).find(p=>p.type==='timeZoneName')?.value;
    const timestamp=Date.parse(`${date} ${time} ${zone==='EDT'?'EDT':'EST'}`); if (!Number.isFinite(timestamp)) continue;
    const translated=title.replace('Personal Income and Outlays','個人所得與支出（含 PCE 物價）').replace('U.S. International Trade in Goods and Services','商品與服務貿易').replace('GDP (Advance Estimate)','GDP（初值）').replace('GDP (Second Estimate) and Corporate Profits','GDP（第二次估計）與企業獲利').replace('GDP (Third Estimate), Industries, Corporate Profits, State GDP, and State Personal Income','GDP（第三次估計）、產業與企業獲利及州別所得').replace(/([1-4])(?:st|nd|rd|th) Quarter (20\d{2})/,(_,q,y)=>`${y} 年第 ${q} 季`).replace(/([A-Z][a-z]+) (20\d{2})$/, (whole,m,y)=>months.includes(m)?`${y} 年 ${months.indexOf(m)+1} 月`:whole).replace(/,\s*/g,'，');
    events.push({...base('bea-calendar',url,title,stamp),id:`bea:${id(date+title)}`,titleZh:`美國 ${translated.replace(/^美國 /,'')}`,translationStatus:'translated',occursAt:new Date(timestamp).toISOString(),category:'macro',country:'美國',originalTimezone:'America/New_York',previous:null,consensus:null,actual:null,impact:importance(/GDP|Personal Income/.test(title)?5:3,'BEA 官方經濟數據排程',url)});
  }
  if (!events.length) throw Error('BEA 日曆沒有可驗證公布時間');
  return events;
}

