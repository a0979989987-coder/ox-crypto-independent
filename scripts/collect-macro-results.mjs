import { readFile, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const months = 'January February March April May June July August September October November December'.split(' ');
const text = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&ndash;|&#8211;/g, '-').replace(/\s+/g, ' ').trim();
const number = value => value == null ? null : Number(value.replaceAll(',', ''));
export function macroFingerprint(value) {
  const volatile = new Set(['updatedAt','generatedAt','lastAttemptAt','lastSuccessAt']);
  const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => !volatile.has(k) && v[k] !== undefined).sort().map(k => [k,stable(v[k])])) : v;
  return JSON.stringify(stable(value));
}
export function easternTime(date, hour = 8, minute = 30) {
  const guess = new Date(`${date}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00Z`);
  const localHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(guess));
  return new Date(guess.getTime() + ((hour - localHour + 24) % 24) * 3600000).toISOString();
}
function base(metric, date, title, sourceUrl, stamp) {
  return { id: `macro:${metric}:${date}`, category: 'macro', kind: 'event', country: '美國', sourceId: metric === 'fed-rate' ? 'fed' : 'bls-calendar', source: metric === 'fed-rate' ? 'Federal Reserve' : 'U.S. BLS', markets: ['crypto','tw'], title, titleZh: title, metric, occursAt: easternTime(date), releasedAt: easternTime(date), updatedAt: stamp, status: 'confirmed', previous: null, consensus: null, actual: null, sourceUrl, impact: { stars: 5, ruleVersion: 'official-major-macro-v1', evidence: sourceUrl, reason: '官方重大經濟數據／貨幣政策決策，重要性 5 星。' } };
}
export function parseBlsResult(html, metric, stamp = new Date().toISOString()) {
  const pre = html.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1];
  if (!pre) throw Error('BLS release body missing');
  const body = text(pre), release = body.match(/8:30 a\.m\. \(ET\) \w+, (\w+) (\d{1,2}), (\d{4})/);
  if (!release || !months.includes(release[1])) throw Error('BLS release date missing');
  const date = `${release[3]}-${String(months.indexOf(release[1]) + 1).padStart(2,'0')}-${release[2].padStart(2,'0')}`;
  const item = base(metric, date, metric === 'nonfarm-payrolls' ? '美國非農就業人口' : '美國 CPI 月增率', `https://www.bls.gov/news.release/archives/${metric === 'nonfarm-payrolls' ? 'empsit' : 'cpi'}_${date.slice(5,7)}${date.slice(8)}${date.slice(0,4)}.htm`, stamp);
  item.matchTitle = metric === 'nonfarm-payrolls' ? 'Employment Situation for ' : 'Consumer Price Index for ';
  if (metric === 'nonfarm-payrolls') {
    const actual = body.match(/nonfarm payroll employment\s*\(([+-]?[\d,]+)\)/i) || body.match(/(?:Total )?nonfarm payroll employment (?:increased|rose|declined|decreased|fell) by ([\d,]+)/i);
    const revisions = [...body.matchAll(/(?:from|at) ([+-]?[\d,]+) to ([+-]?[\d,]+)/g)];
    const previous = revisions.at(-1);
    item.actual = number(actual?.[1]);
    if (actual && /(?:declined|decreased|fell) by/i.test(actual[0])) item.actual = -item.actual;
    item.previous = number(previous?.[2]); item.previousOriginal = number(previous?.[1]); item.unit = '人';
  } else {
    const match = body.match(/\(CPI-U\) (increased|rose|declined|decreased|fell) ([\d.]+) percent on a seasonally adjusted basis[\s\S]*?after (rising|increasing|declining|decreasing|falling) ([\d.]+) percent/i);
    if (!match) throw Error('CPI monthly values missing; unsupported release wording');
    item.actual = Number(match[2]) * (/declined|decreased|fell/.test(match[1]) ? -1 : 1);
    item.previous = Number(match[4]) * (/declining|decreasing|falling/.test(match[3]) ? -1 : 1); item.unit = '%';
  }
  if (!Number.isFinite(item.actual)) throw Error('Actual value missing; unsupported release wording');
  if (Date.parse(item.releasedAt) > Date.parse(stamp)) throw Error('Release is in the future');
  return item;
}
export function parseFedCalendar(html, now = new Date()) {
  const events = [], year = now.getUTCFullYear();
  const section = html.split(`${year} FOMC Meetings`)[1]?.split(`${year - 1} FOMC Meetings`)[0];
  if (!section) throw Error('Current Fed meeting calendar missing');
  for (const row of section.split(/<div class="[^"]*\brow\b[^\"]*\bfomc-meeting\b[^\"]*"/).slice(1)) {
    const month = row.match(/fomc-meeting__month[^>]*>\s*<strong>(\w+)<\/strong>/)?.[1];
    const days = row.match(/fomc-meeting__date[^>]*>([\d-]+)/)?.[1];
    if (!months.includes(month) || !days) continue;
    const date = `${year}-${String(months.indexOf(month)+1).padStart(2,'0')}-${days.split('-').at(-1).padStart(2,'0')}`;
    const url = row.match(/href="(\/newsevents\/pressreleases\/monetary\d{8}a\.htm)"/)?.[1];
    const item = base('fed-rate', date, '美聯準會 FOMC 利率決策', 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', now.toISOString());
    item.date = date; item.occursAt = null; item.releasedAt = null; item.unit = '%'; item.allDay = false;
    item.scheduleBasis = '官方會議最後日（美東日期），確切台北公布時間待官方公告。';
    if (url) item.statementUrl = new URL(url, 'https://www.federalreserve.gov').href;
    events.push(item);
  }
  if (!events.length) throw Error('No Fed meetings parsed');
  return events;
}
export function parseFedRate(html, item, stamp = new Date().toISOString()) {
  const body = text(html);
  const range = body.match(/target range[^.]{0,200}?(?:to|at) (\d+(?:-\d+\/\d+)?) to (\d+(?:-\d+\/\d+)?) percent/);
  const release = body.match(/For release at (\d+):(\d+) p\.m\. (?:EDT|EST)/);
  if (!range || !release) throw Error('Fed policy range or publication time missing');
  const rate = value => { const [whole, fraction] = value.split('-'); if (!fraction) return Number(whole); const [n,d] = fraction.split('/').map(Number); return Number(whole) + n / d; };
  const releasedAt = easternTime(item.date, Number(release[1]) + 12, Number(release[2]));
  if (Date.parse(releasedAt) > Date.parse(stamp)) throw Error('Fed release is in the future');
  return { ...item, date: null, occursAt: releasedAt, releasedAt, actual: rate(range[2]), label: '聯邦基金利率區間上限', rateRange: `${rate(range[1])}–${rate(range[2])}%`, sourceUrl: item.statementUrl, scheduleBasis: null, updatedAt: stamp };
}
export async function collectMacroResults() {
  const file = new URL('../data/macro-results.json', import.meta.url), stamp = new Date().toISOString();
  const old = await readFile(file, 'utf8').then(JSON.parse).catch(() => ({ events: [] }));
  const expectations = await readFile(new URL('../data/macro-consensus.json', import.meta.url), 'utf8').then(JSON.parse);
  const fetchText = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent':'OX-EconomicCalendar/1.0 (public release facts)' } }); if (!r.ok) throw Error(`HTTP ${r.status}`); return r.text(); };
  const jobs = [['nonfarm-payrolls', 'https://www.bls.gov/news.release/empsit.nr0.htm'], ['cpi-mom', 'https://www.bls.gov/news.release/cpi.nr0.htm'], ['fed-rate', 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm']];
  const results = await Promise.allSettled(jobs.map(async ([metric, url]) => {
    const html = await fetchText(url); if (metric !== 'fed-rate') return [parseBlsResult(html, metric, stamp)];
    const meetings = parseFedCalendar(html), published = meetings.filter(e => e.statementUrl);
    const releases = await Promise.allSettled(published.map(async (e,i) => {
      const cached = old.events.find(o => o.id === e.id && Number.isFinite(o.actual) && o.releasedAt);
      return cached && i < published.length - 2 ? cached : parseFedRate(await fetchText(e.statementUrl), e, stamp);
    }));
    releases.forEach((r,i) => { if (r.status === 'fulfilled') { const e = r.value; if (i > 0 && releases[i-1].status === 'fulfilled') e.previous = releases[i-1].value.actual; meetings[meetings.findIndex(m => m.id === e.id)] = e; } });
    return meetings;
  }));
  const events = new Map(old.events.map(e => [e.id, e]));
  results.forEach(result => { if (result.status === 'fulfilled') for (const e of result.value) {
    const expected = expectations[e.id];
    if (expected && Number.isFinite(expected.value) && expected.unit === e.unit && expected.sourceUrl?.startsWith('https://')) { e.consensus = expected.value; e.consensusSource = expected.sourceUrl; }
    const retained = events.get(e.id);
    // A failed statement fetch must not erase a previously verified release.
    events.set(e.id, retained?.releasedAt && !e.releasedAt ? { ...retained } : { ...retained, ...e });
  }});
  const sources = results.map((result, i) => ({ metric: jobs[i][0], endpoint: jobs[i][1], status: result.status === 'fulfilled' ? 'ready' : 'error', lastAttemptAt: stamp, lastSuccessAt: result.status === 'fulfilled' ? stamp : old.sources?.find(s => s.metric === jobs[i][0])?.lastSuccessAt, message: result.status === 'rejected' ? String(result.reason.message) : null }));
  if (!results.some(r => r.status === 'fulfilled')) throw Error('All macro sources failed; previous snapshot retained');
  const next = { schemaVersion: 1, generatedAt: stamp, sources, events: [...events.values()] };
  if (macroFingerprint(next) === macroFingerprint(old)) return { changed: false, events: events.size, sources };
  const temp = new URL('../data/macro-results.next.json', import.meta.url); await writeFile(temp, JSON.stringify(next, null, 2) + '\n'); await rename(temp, file);
  return { changed: true, events: events.size, sources };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) collectMacroResults().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
