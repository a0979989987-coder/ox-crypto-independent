import { SOURCE_CATALOG, MARKET_CATEGORIES, EVENT_PROVIDERS } from './config.js?v=20261005-calendar11';
export const validDate = value => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false; const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; };
export const safeLink = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; } };
export const plain = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
export function taipeiDay(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = name => parts.find(p => p.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function eventDay(item) {
  if (item.date && validDate(item.date)) return item.date;
  return Number.isFinite(Date.parse(item.occursAt)) ? taipeiDay(item.occursAt) : null;
}
export function eventCategory(item) {
  if (item.category) return item.category;
  if (item.kind === 'token-unlock') return 'unlock';
  if (item.sourceId === 'bls-calendar') return 'macro';
  return null;
}
export function importance(item) {
  const raw = item.impact?.stars;
  const value = Number.isInteger(raw) && raw >= 1 && raw <= 5 ? raw : null;
  return { value, raw: raw ?? null, source: item.impact?.ruleVersion || null, evidence: safeLink(item.impact?.evidence), reason: item.impact?.reason || null };
}
export const matchesImportance = (item, enabled) => typeof enabled !== 'boolean' || Boolean(importance(item).value) === enabled;
export function monthGrid(month) {
  const [year, index] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, index - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const weeks = Math.ceil((offset + days) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => {
    const date = new Date(Date.UTC(year, index - 1, 1 - offset + i)).toISOString().slice(0, 10);
    return { date, day: Number(date.slice(8)), outside: date.slice(0, 7) !== month };
  });
  return { weeks, cells };
}
export function shiftMonth(month, delta) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7); }
export function defaultState() { return { tab: 'calendar', calendarView: 'month', month: taipeiDay().slice(0, 7), categories: null, importance: null, times: ['week'], timePresetVersion: 2, customTime: null, sources: null, words: [], query: '', asset: null, limit: 40, scroll: 0, market: 'all' }; }
export const inMarket = (item, scope) => Boolean(item.markets?.includes('crypto') && (scope === 'all' || scope === 'crypto') &&
  (!(item.kind === 'event' || item.date || item.occursAt) || !eventCategory(item) || MARKET_CATEGORIES.crypto?.includes(eventCategory(item))));
export function upcomingEventDays(snapshot, scope, state, start) {
  return Array.from({ length: 8 }, (_, index) => {
    const date = new Date(start + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    const events = (snapshot?.events || []).filter(item => eventDay(item) === day && inMarket(item, scope) &&
      (state.categories === null || state.categories.includes(eventCategory(item))) && matchesImportance(item, state.importance))
      .sort((a, b) => (a.occursAt || '').localeCompare(b.occursAt || '') || (a.titleZh || a.title || '').localeCompare(b.titleZh || b.title || ''));
    return { date: day, events, index };
  }).filter(day => day.index === 0 || day.events.length);
}
export function canonicalURL(value) {
  const safe = safeLink(value); if (!safe) return null;
  const url = new URL(safe); for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(key)) url.searchParams.delete(key);
  url.hash = ''; return url.href.replace(/\/$/, '');
}
function titleKey(item) { return plain(item.originalTitle || item.title).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}]/gu, ''); }
export function dedupe(items) {
  const groups = [], links = new Map(), titles = new Map();
  for (const item of items) {
    const link = canonicalURL(item.canonicalUrl || item.link); if (!link) continue;
    const key = titleKey(item), day = item.publishedAt?.slice(0, 10) || '';
    const existing = links.get(link) || (key.length >= 14 ? titles.get(`${day}:${key}`) : null);
    if (existing) { existing.reports.push(item); continue; }
    const copy = { ...item, link, reports: [item] }; groups.push(copy); links.set(link, copy); if (key.length >= 14) titles.set(`${day}:${key}`, copy);
  }
  return groups;
}
export function newsBase(snapshot, scope, state, prefs = {}, now = Date.now()) {
  const hidden = new Set(prefs.hidden || []), muted = new Set(prefs.mutedSources || []);
  const windows = (state.times || []).map(Number).filter(h => h > 0 && h <= 720);
  const ranges = windows.map(hours => [now - hours * 3600000, now + 60000]);
  if (state.times?.includes('week')) { const monday = new Date(`${taipeiDay(now)}T00:00:00+08:00`); const weekday = new Date(`${taipeiDay(now)}T12:00:00Z`).getUTCDay(); monday.setUTCDate(monday.getUTCDate() - (weekday + 6) % 7); ranges.push([monday.getTime(), now + 60000]); }
  if (state.times?.includes('custom') && validDate(state.customTime?.from) && validDate(state.customTime?.to) && state.customTime.from <= state.customTime.to) ranges.push([Date.parse(`${state.customTime.from}T00:00:00+08:00`), Date.parse(`${state.customTime.to}T00:00:00+08:00`) + 86400000 - 1]);
  if (!ranges.length) return [];
  return dedupe([...(snapshot?.news || []), ...(snapshot?.pendingNews || [])].filter(item => {
    const published = Date.parse(item.publishedAt);
    // Some aggregated RSS entries contain only a ticker, not an article title.
    const title=plain(item.titleZh||item.title).trim();
    return title.length>0 && !/^\d{4,6}[a-z]?$/i.test(title) && inMarket(item, scope) && !hidden.has(item.id) && !muted.has(item.sourceId) && item.contentType !== 'promotion' &&
      Number.isFinite(published) && published <= now + 60000 && ranges.some(([from, to]) => published >= from && published <= to) &&
      (state.sources === null || state.sources.includes(item.sourceId));
  })).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
export function filterNews(items, state) {
  const query = plain(state.query).normalize('NFKC').toLocaleLowerCase();
  return items.filter(item => {
    const text = [item.titleZh, item.title, item.summaryZh, ...(item.assets || []).flatMap(a => [a.symbol, a.name, ...(a.aliases || [])])].join(' ').normalize('NFKC').toLocaleLowerCase();
    return (!query || text.includes(query)) && (!state.words.length || state.words.some(word => text.includes(word.toLocaleLowerCase()))) &&
      (!state.asset || (item.assets || []).some(a => a.id === state.asset));
  });
}
export function monthEvents(snapshot, scope, state) {
  return (snapshot?.events || []).filter(item => {
    const day = eventDay(item), type = eventCategory(item), level = importance(item).value;
    return inMarket(item, scope) && day?.slice(0, 7) === state.month &&
      (state.categories === null || state.categories.includes(type)) && matchesImportance(item, state.importance);
  }).sort((a, b) => (eventDay(a) + (a.occursAt || '')).localeCompare(eventDay(b) + (b.occursAt || '')));
}
// Agenda includes every recorded date from the chosen month onward, rather
// than silently dropping events in later months or truncating a busy day.
export function agendaDays(snapshot, scope, state) {
  const dates = new Map(), seen = new Set();
  for (const item of snapshot?.events || []) {
    const day=eventDay(item),type=eventCategory(item),level=importance(item).value;
    if(!day||day<state.month+'-01'||!inMarket(item,scope)||seen.has(item.id)||
      state.categories!==null&&!state.categories.includes(type)||!matchesImportance(item,state.importance))continue;
    seen.add(item.id);if(!dates.has(day))dates.set(day,[]);dates.get(day).push(item);
  }
  return [...dates].sort(([a],[b])=>a.localeCompare(b)).map(([date,events])=>({date,events:events.sort((a,b)=>(a.occursAt||date).localeCompare(b.occursAt||date)||plain(a.titleZh||a.title).localeCompare(plain(b.titleZh||b.title)))}));
}
const STOP = new Set('以及 相關 表示 今年 今天 昨日 目前 預計 可能 最新 消息 新聞 公告 發布 宣布 報導 指出 美國 台灣 全球 官方 公司 集團 市場 投資 投資人 金融 交易 交易所 新增 因為 已經 還有 這個 這次 這些 其中 一個 成為 提供 推出 開放 預告 進行 發展 調整 計畫 資訊 來源 更新 年 月 日 萬 億 元 美元 the and for with from this that are has new its to of in on by at an us as is a will over via announces release available'.split(' '));
const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'word' });
export function hotWords(items) {
  const counts = new Map();
  for (const item of items) {
    const words = new Set((item.assets || []).map(a => a.name));
    const aliases = new Map((item.assets || []).flatMap(a => [a.symbol, a.name, ...(a.aliases || [])].map(word => [word.normalize('NFKC').toLowerCase(), a.name])));
    const text = plain(item.titleZh || item.title).normalize('NFKC');
    for (const part of segmenter.segment(text)) {
      const word = part.segment.trim();
      if (!part.isWordLike || STOP.has(word.toLowerCase()) || word.length < 2 || word.length > 16 || /^\d/.test(word) || /^[\p{P}\p{Z}\p{S}]+$/u.test(word) || /^[\d,.]+[月億萬元%]?$/.test(word)) continue;
      words.add(aliases.get(word.toLowerCase()) || (/^(ETF|NFT|AI|DeFi|DAO)$/i.test(word) ? word.toUpperCase() : word));
    }
    for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-TW')).slice(0, 36);
}
export function ranking(items) {
  const counts = new Map();
  for (const item of items) for (const asset of new Map((item.assets || []).map(a => [a.id, a])).values()) {
    if (!asset.id || !asset.market) continue;
    const old = counts.get(asset.id) || { ...asset, count: 0 }; old.count++; counts.set(asset.id, old);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol));
}
export function sourcesFor(snapshot, scope) {
  return SOURCE_CATALOG.filter(s => scope === 'all' || s.markets.includes(scope)).map(source => {
    const health = snapshot?.sources?.find(s => s.id === source.id);
    return { ...source, ...health, id: source.id, name: source.name, lastSuccessAt: health?.lastSuccessAt || (health?.status === 'ready' ? snapshot.generatedAt : null) };
  });
}
export function coverage(snapshot, scope, month) {
  const sources = sourcesFor(snapshot, scope), categories = MARKET_CATEGORIES[scope];
  const categoryCoverage = categories.map(category => {
    const spans = (snapshot?.eventCoverage || []).filter(c => c.category === category && (scope === 'all' || c.markets?.includes(scope)));
    const covered = spans.some(c => c.from?.slice(0, 7) <= month && c.to?.slice(0, 7) >= month && c.complete === true);
    const known = (snapshot?.events || []).filter(e => inMarket(e, scope) && eventCategory(e) === category && eventDay(e)?.slice(0, 7) === month).length;
    const connected = sources.filter(s => EVENT_PROVIDERS[category]?.includes(s.id) && s.status !== 'not-connected');
    return { category, covered, known, spans, connected };
  });
  return { sources, categories: categoryCoverage, complete: categoryCoverage.every(c => c.covered) };
}
