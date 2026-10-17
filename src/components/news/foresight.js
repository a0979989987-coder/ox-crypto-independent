// Foresight News public blockchain calendar (iCalendar). Shared by the
// 6-hourly collector and the news page: the page reads the same public ICS
// directly when the collector's datacenter request is refused, so upcoming
// unlocks, listings and network upgrades stay current. Browser-safe.
import { validDate } from './model.js?v=20261005-load16';

export const FORESIGHT_ICS_URL = 'https://api.foresightnews.pro/v1/calendar.ics';
const https = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } };
const dateKey = (year, month, day) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
const base = (sourceId, url, title, updatedAt) => ({ sourceId, sourceUrl:url, link:url, title, kind:'event', markets:['crypto'], updatedAt, status:'confirmed', announcementStatus:'confirmed', impact:{stars:null,ruleVersion:'unassessed-v1',reason:'來源未提供重要性分級'} });

// iCalendar's folded lines are unfolded before parsing. Midnight values are
// treated as date-only, never advertised as a precisely confirmed 08:00 event.
export function foresightCalendar(ics, stamp) {
  if (!/^BEGIN:VCALENDAR/m.test(ics) || !/PRODID:foresightnews\.pro/.test(ics)) throw Error('Foresight 行事曆格式無效');
  const unfolded=ics.replace(/\r?\n[ \t]/g,''), events=[], cancelled=new Set();
  const entries=[...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g)].map(([,block])=>Object.fromEntries(block.split(/\r?\n/).flatMap(line=>{const m=line.match(/^([A-Z-]+)(?:;[^:]*)?:(.*)$/);return m?[[m[1],m[2].replace(/\\n/g,' ').replace(/\\([,;\\])/g,'$1')]]:[]})));
  for (const entry of entries) if (/取消|推迟|延期|推遲/.test(entry.SUMMARY||'')) cancelled.add((entry.SUMMARY||'').split(/\s/)[0]);
  for (const entry of entries) {
    const title=entry.SUMMARY||'', time=entry.DTSTART?.match(/^(20\d{2})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/), link=https(entry.URL);
    if (/法令|监管|監管|国税局|國稅局|央行要求|金融行为|金融行為/.test(title)) continue;
    if (!entry.UID || !time || !link || cancelled.has(title.split(/\s/)[0]) || /取消|推迟|延期|推遲/.test(title)) continue;
    const date=dateKey(time[1],+time[2],+time[3]); if (!validDate(date)) continue;
    const titleYear=title.match(/(20\d{2})\s*年/);if(titleYear&&titleYear[1]!==time[1])continue;
    if(/第[一二三四1-4]季度/.test(title)&&!/\d{1,2}\s*月\s*\d{1,2}\s*日/.test(title))continue;
    const explicit=title.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    // A real feed can contain inconsistent DTSTART and title dates: omit it.
    if (explicit && (+explicit[1]!==+time[2] || +explicit[2]!==+time[3])) continue;
    const category=/解锁|解鎖/.test(title)?'unlock':/空投|领取|領取|申领|申領|快照/.test(title)?'airdrop':/销毁|銷毀|回购|回購/.test(title)?'burn':/投票|治理/.test(title)?'governance':/上架|下架|TGE|交易|上市/.test(title)?'listing':/主网|主網|测试网|測試網|升级|升級|Bitcoin Core|硬分叉/.test(title)?'network':/法令|监管|監管|ETF|法院/.test(title)?'regulation':/会议|會議|峰会|峰會|TOKEN2049|Frontiers/.test(title)?'conference':null;
    if (!category || category==='regulation') continue;
    const precise=time[4] && time.slice(4).join('')!=='000000';
    const estimated=/预计|預計|拟|擬/.test(title);
    events.push({...base('foresight-calendar','https://foresightnews.pro/article/detail/4',title,stamp),id:`foresight:${entry.UID}`,link,sourceUrl:link,source:'Foresight News 區塊鏈日曆',titleZh:null,translationStatus:'pending',category,...(precise?{occursAt:`${date}T${time[4]}:${time[5]}:${time[6]}Z`,originalTimezone:'UTC'}:{date,originalTimezone:null}),status:estimated?'estimated':'announced',announcementStatus:estimated?'estimated':'announced',scheduleBasis:'Foresight News 公開行事曆所列排程，屬媒體彙整；請以原始公告為準。來源未指定精確時刻時僅顯示日期。'});
  }
  if (!events.length) throw Error('Foresight 日曆沒有可驗證事件');
  return events;
}
