// Keeps the news page current between the 6-hourly snapshots and finishes
// translations the collector could not: (1) the newest headlines from
// /api/v1/news/latest, (2) the public Foresight ICS calendar read directly,
// (3) machine translation of still-untranslated titles and short summaries,
// remembered per browser. Everything here is additive: the snapshot stays the
// history and the fallback, and a failure only means "no extra data".
import { translateFields } from '../../../server/news/translate.js';
import { foresightCalendar, FORESIGHT_ICS_URL } from './foresight.js';
import { eventDay, taipeiDay } from './model.js?v=20261005-load16';

export const LATEST_URL = '/api/v1/news/latest';
export const LIVE_INTERVAL_MS = 180000;
export const FORESIGHT_INTERVAL_MS = 600000;
const MT_KEY = 'ox-news-mt-v1', MT_COOLDOWN_KEY = 'ox-news-mt-cooldown', MT_LIMIT = 900, MT_COOLDOWN_MS = 600000;
const FILL = ['titleZh', 'translationStatus', 'translationMethod', 'summary', 'summaryZh', 'summaryType', 'summaryMethod'];

async function getJSON(url, { signal, timeoutMs = 9000 } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

export async function fetchLatest(options) {
  const body = await getJSON(LATEST_URL, options);
  if (body?.schemaVersion !== 1 || !Array.isArray(body.news)) throw Error('即時新聞格式不正確');
  return body;
}

export async function fetchForesight({ signal, timeoutMs = 9000, now = Date.now() } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await fetch(FORESIGHT_ICS_URL, { signal: controller.signal, cache: 'no-cache', credentials: 'omit' });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 2_000_000) throw Error('行事曆過大');
    return foresightCalendar(text, new Date(now).toISOString());
  } finally { clearTimeout(timer); }
}

function spans(events, sourceId) {
  const groups = new Map();
  for (const item of events) { const category = item.category || 'macro'; if (!groups.has(category)) groups.set(category, []); groups.get(category).push(item); }
  return [...groups].map(([category, items]) => { const days = items.map(eventDay).filter(Boolean).sort(); return { sourceId, category, markets: [...new Set(items.flatMap(i => i.markets))], from: days[0], to: days.at(-1), complete: false }; });
}
const signature = snapshot => {
  const all = [...(snapshot.news || []), ...(snapshot.pendingNews || [])];
  return [all.length, all.filter(i => i.titleZh).length, all.filter(i => i.summaryZh).length, (snapshot.events || []).length, (snapshot.events || []).filter(e => e.titleZh).length].join(':');
};

// A new snapshot object: the static base plus whatever is newer. Items already
// in the base only gain missing fields (a translation, a summary); nothing the
// collector reviewed is overwritten.
export function composeSnapshot(base, { latest = null, foresight = null, foresightAt = null, now = Date.now() } = {}) {
  if (!base) return base;
  const news = [...(base.news || [])], pendingNews = [...(base.pendingNews || [])];
  const byId = new Map([...news, ...pendingNews].map(item => [item.id, item]));
  let added = 0;
  for (const item of latest?.news || []) {
    if (!item?.id || !item.link || !item.publishedAt) continue;
    const existing = byId.get(item.id);
    if (existing) { for (const key of FILL) if (existing[key] == null && item[key] != null) existing[key] = item[key]; continue; }
    const copy = { ...item }; (copy.titleZh ? news : pendingNews).push(copy); byId.set(copy.id, copy); added++;
  }
  const newest = (a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt));
  news.sort(newest); pendingNews.sort(newest);
  let events = base.events || [], eventCoverage = base.eventCoverage || [];
  const sources = (base.sources || []).map(source => ({ ...source }));
  const health = (id, patch) => { const index = sources.findIndex(s => s.id === id); if (index >= 0) sources[index] = { ...sources[index], ...patch }; else sources.push({ id, ...patch }); };
  for (const source of latest?.sources || []) if (source.status === 'ready') health(source.id, { status: 'ready', count: source.count, lastSuccessAt: source.lastSuccessAt, lastAttemptAt: source.lastAttemptAt, message: undefined, live: true });
  if (Array.isArray(foresight) && foresight.length) {
    // The provider's current schedule replaces its old one from today on (so a
    // withdrawn or postponed entry cannot linger); days already past keep the
    // events the snapshot recorded, since the public ICS only lists what is ahead.
    const today = taipeiDay(now), previous = new Map(events.filter(e => e.sourceId === 'foresight-calendar').map(e => [e.id, e]));
    const fresh = foresight.map(e => { const old = previous.get(e.id); return old?.title === e.title && old.titleZh ? { ...e, titleZh: old.titleZh, translationStatus: 'translated', translationMethod: old.translationMethod } : e; });
    const freshIds = new Set(fresh.map(e => e.id));
    const past = [...previous.values()].filter(e => !freshIds.has(e.id) && (eventDay(e) || '') < today);
    events = [...events.filter(e => e.sourceId !== 'foresight-calendar'), ...past, ...fresh];
    eventCoverage = [...eventCoverage.filter(c => c.sourceId !== 'foresight-calendar'), ...spans([...past, ...fresh], 'foresight-calendar')];
    health('foresight-calendar', { status: 'ready', count: fresh.length, lastSuccessAt: foresightAt, lastAttemptAt: foresightAt, message: undefined, access: 'browser-public-ics' });
  }
  const next = { ...base, news, pendingNews, events, eventCoverage, sources, liveAt: latest?.generatedAt || base.liveAt || null, liveAdded: added, baseGeneratedAt: base.generatedAt };
  next.signature = signature(next);
  return next;
}

// ---- machine translation remembered in this browser -------------------------
let memory = null, cooldownUntil = 0;
function cache() {
  if (memory) return memory;
  memory = new Map();
  try { for (const [id, entry] of Object.entries(JSON.parse(localStorage.getItem(MT_KEY) || '{}'))) if (entry && typeof entry === 'object') memory.set(id, entry); } catch {}
  try { cooldownUntil = Number(localStorage.getItem(MT_COOLDOWN_KEY)) || 0; } catch {}
  return memory;
}
function persist() {
  const entries = [...cache()].sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MT_LIMIT);
  memory = new Map(entries);
  try { localStorage.setItem(MT_KEY, JSON.stringify(Object.fromEntries(entries))); } catch {}
}
// Fills translations this browser already made, only while the original text is unchanged.
export function applyCachedTranslations(items) {
  const store = cache(); let changed = 0;
  for (const item of items || []) {
    const entry = item?.id && store.get(item.id);
    if (!entry) continue;
    if (!item.titleZh && entry.z && entry.t === item.title) { Object.assign(item, { titleZh: entry.z, translationStatus: 'translated', translationMethod: 'machine-title-only', translatedIn: 'browser' }); changed++; }
    if (item.summary && !item.summaryZh && entry.sz && entry.s === item.summary) { Object.assign(item, { summaryZh: entry.sz, summaryType: item.summaryType || 'source', summaryMethod: 'machine' }); changed++; }
  }
  return changed;
}
export const needsTranslation = item => Boolean(item && (!item.titleZh && item.title || item.summary && !item.summaryZh));
// Translates what is on screen, a few requests at a time; a refusal pauses it for ten minutes.
export async function translateItems(items, { maxRequests = 3, fetcher, now = Date.now() } = {}) {
  cache();
  const todo = (items || []).filter(needsTranslation);
  if (!todo.length || now < cooldownUntil) return [];
  const changed = new Set();
  const result = await translateFields(todo, { maxRequests, concurrency: 2, timeoutMs: 6000, limit: 120, ...(fetcher ? { fetcher } : {}),
    onTranslated(list) { for (const item of list) { changed.add(item); const entry = cache().get(item.id) || {}; cache().set(item.id, { ...entry, t: item.title, ...(item.titleZh ? { z: item.titleZh } : {}), ...(item.summaryZh ? { s: item.summary, sz: item.summaryZh } : {}), at: now }); } } });
  if (result.reason === 'translation-rate-limited' || (result.attempted > 0 && result.translated === 0)) {
    cooldownUntil = now + MT_COOLDOWN_MS;
    try { localStorage.setItem(MT_COOLDOWN_KEY, String(cooldownUntil)); } catch {}
  }
  if (changed.size) persist();
  return [...changed];
}
export function _resetTranslationMemory() { memory = null; cooldownUntil = 0; }
