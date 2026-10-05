import { inflateRawSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import { rocDate } from './news-providers.mjs';

// Read one bounded member without extracting paths or executing document content.
export function documentXML(bytes) {
  const b = Buffer.from(bytes); if (b.length > 2_000_000) throw Error('DOCX exceeds size limit');
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error('Invalid DOCX ZIP');
  const entries = b.readUInt16LE(end + 10); let at = b.readUInt32LE(end + 16);
  if (entries > 200) throw Error('Too many DOCX members');
  for (let i = 0; i < entries; i++) {
    if (at + 46 > b.length || b.readUInt32LE(at) !== 0x02014b50) throw Error('Invalid DOCX directory');
    const flags = b.readUInt16LE(at + 8), method = b.readUInt16LE(at + 10), size = b.readUInt32LE(at + 20), expanded = b.readUInt32LE(at + 24);
    const length = b.readUInt16LE(at + 28), extra = b.readUInt16LE(at + 30), comment = b.readUInt16LE(at + 32), offset = b.readUInt32LE(at + 42);
    const name = b.subarray(at + 46, at + 46 + length).toString('utf8'); at += 46 + length + extra + comment;
    if (name !== 'word/document.xml') continue;
    if (flags & 1 || expanded > 2_000_000 || offset + 30 > b.length || b.readUInt32LE(offset) !== 0x04034b50) throw Error('Unsupported DOCX member');
    const start = offset + 30 + b.readUInt16LE(offset + 26) + b.readUInt16LE(offset + 28);
    if (start + size > b.length) throw Error('Truncated DOCX member');
    const compressed = b.subarray(start, start + size);
    const xml = (method === 0 ? compressed : method === 8 ? inflateRawSync(compressed, { maxOutputLength: 2_000_000 }) : Buffer.alloc(0)).toString('utf8');
    if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Unsupported document XML'); return xml;
  }
  throw Error('Document XML missing');
}
const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
function texts(object) {
  if (!object || typeof object !== 'object') return [];
  const result = [];
  for (const [key, value] of Object.entries(object)) {
    if (key === 'w:t') result.push(...array(value).map(v => typeof v === 'object' ? v['#text'] || '' : String(v)));
    else if (!key.startsWith('@_')) for (const v of array(value)) result.push(...texts(v));
  }
  return result;
}
export function conferenceEvents(xml, context) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Unsupported document XML');
  const rows = [...xml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map(row => [...row[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map(cell => texts(parser.parse(`<cell>${cell[1]}</cell>`)).join('').replace(/\s+/g, ' ').trim()));
  const time = s => s.replace(/\s/g, '').match(/^(\d{1,2}:\d{2})[~～–－-](\d{1,2}:\d{2})$/);
  const timetable = new Map();
  for (const row of rows) if (row.length === 3 && time(row[0]) && time(row[2])) timetable.set(row[0].replace(/\s/g, ''), time(row[2]));
  const result = [];
  for (const row of rows) {
    if (row.length !== 7 || !/^\d{4}$/.test(row[1]) || !row[2]) continue;
    const day = row[3].match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/), session = time(row[4]);
    if (!day || !session) continue;
    const date = rocDate(`${context.year - 1911}/${day[1].padStart(2, '0')}/${day[2].padStart(2, '0')}`); if (!date) continue;
    const actual = timetable.get(row[4].replace(/\s/g, ''));
    // Where the official table separates registration from the meeting, use meeting time.
    const start = actual?.[1] || session[1], end = actual?.[2] || session[2], company = row[2].replace(/\s*(-KY)/g, '$1');
    const occursAt = new Date(`${date}T${start.padStart(5, '0')}:00+08:00`).toISOString();
    result.push({ id: `twse-conference:${row[1]}:${date}:${start}`, kind: 'event', category: 'earnings', markets: ['tw'], company, symbol: row[1],
      title: `${company}（${row[1]}）法說會`, titleZh: `${company}（${row[1]}）法說會`, translationStatus: 'translated', shortTitle: `${company}法說`,
      occursAt, endsAt: new Date(`${date}T${end.padStart(5, '0')}:00+08:00`).toISOString(), originalTimezone: 'Asia/Taipei',
      session: row[4], registrationNote: actual ? `表列時段 ${row[4]} 包含報到；法說 ${actual[1]}～${actual[2]}` : '時段依官方月表；未另列報到時間',
      location: row[5] === '101 1F' ? '臺灣證券交易所 1 樓（台北 101）' : row[5], description: row[6] || null,
      announcementStatus: /取消/.test(row[6]) ? 'cancelled' : 'confirmed', status: 'confirmed', sourceId: 'twse-conferences', source: '證交所・法說會月表',
      sourceUrl: context.url, documentUrl: context.documentUrl, link: context.url, livestreamUrl: 'https://webpro.twse.com.tw/', updatedAt: context.updatedAt,
      assets: [{ id: `tw:${row[1]}`, market: 'tw', symbol: row[1], name: company }], impact: { stars: null, ruleVersion: 'unassessed-v1', reason: '官方月表未提供重要性分級' }
    });
  }
  return result;
}
export async function collectConferences(fetchText, updatedAt) {
  const list = JSON.parse(await fetchText('https://www.twse.com.tw/news/eventList?response=json'));
  const months = (list.data || []).filter(row => /上市公司辦理法人說明會/.test(row[1]) && /20\d{2}年/.test(row[1])).slice(0, 3);
  if (!months.length) throw Error('Official conference month list missing');
  const results = await Promise.allSettled(months.map(async row => {
    const id = row[2]; if (!/^[a-f\d]+$/i.test(id)) throw Error('Invalid official event ID');
    const url = `https://www.twse.com.tw/rwd/zh/news/eventDetail?response=json&id=${id}`;
    const detail = JSON.parse(await fetchText(url)); const content = detail.data?.[0]?.[0] || '';
    const path = content.match(/href="(\/staticFiles\/news\/event\/[a-f\d]+\.docx)"/i)?.[1]; if (!path) throw Error('Official conference DOCX missing');
    const documentUrl = `https://www.twse.com.tw${path}`;
    const response = await fetch(documentUrl, { signal: AbortSignal.timeout(25000) }); if (!response.ok) throw Error(`HTTP ${response.status}`);
    const xml = documentXML(await response.arrayBuffer());
    return conferenceEvents(xml, { year: Number(row[1].match(/(20\d{2})年/)[1]), url, documentUrl, updatedAt });
  }));
  const items = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
  if (!items.length) throw Error('No supported official conference tables');
  items.warnings = results.filter(r => r.status === 'rejected').map(r => String(r.reason?.message || 'Month unavailable'));
  return items;
}
