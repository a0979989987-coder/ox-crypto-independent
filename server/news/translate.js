// Machine translation of public headlines and the publisher's own short RSS
// summary only — never article bodies, account data or anything a user typed.
// Isomorphic: the 6-hourly collector (Node), /api/v1/news/latest and the news
// page in the browser (bundled into src/generated/tool-news.js) share it.
//
// Texts are grouped by source language and sent in batches (several q= per
// request). With sl=auto a mixed batch is detected as one language and the
// rest comes back untranslated, so English and Simplified Chinese never share
// a request. An endpoint that answers 429 is not used again in the same run.
export const MT_ENDPOINTS = Object.freeze([
  'https://translate.googleapis.com/translate_a/t?client=gtx',
  'https://clients5.google.com/translate_a/t?client=dict-chrome-ex'
]);
export const TRANSLATED_FIELDS = Object.freeze([['title', 'titleZh'], ['summary', 'summaryZh']]);
const HAN = /[一-鿿]/;
const LATIN = /[a-z]{3}/i;
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
export const sourceLanguage = text => HAN.test(text) ? 'zh-CN' : 'en';
// Some aggregated feed entries carry only a ticker or a numeric placeholder.
const translatable = text => text.length > 1 && text.length <= 1500 && (LATIN.test(text) || HAN.test(text)) && !/^\d{4,6}[a-z]?$/i.test(text);

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return { signal: AbortSignal.timeout(ms), done() {} };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

// The /translate_a/t response is an array with one entry per q: a string, or
// [string, detectedLanguage] when sl=auto. Anything else is not a translation.
export function parseBatch(payload, count) {
  const list = typeof payload === 'string' ? [payload] : Array.isArray(payload) ? payload : null;
  if (!list || list.length !== count) return null;
  return list.map(entry => typeof entry === 'string' ? entry : Array.isArray(entry) && typeof entry[0] === 'string' ? entry[0] : null);
}

// A translation must be Chinese and must not just echo an English original.
// Simplified → Traditional may legitimately return the same characters.
export function acceptTranslation(original, translated, sl) {
  const text = clean(translated);
  if (!text || !HAN.test(text) || text.length > 1500) return null;
  if (sl !== 'zh-CN' && text === clean(original)) return null;
  return text;
}

function batches(jobs, { maxTexts = 20, maxBytes = 5500 } = {}) {
  const out = [];
  let current = [], bytes = 0;
  for (const job of jobs) {
    const size = encodeURIComponent(job.text).length + 3;
    if (current.length && (current.length >= maxTexts || bytes + size > maxBytes)) { out.push(current); current = []; bytes = 0; }
    current.push(job); bytes += size;
  }
  if (current.length) out.push(current);
  return out;
}

// Fills item[to] from item[from] for every [from, to] pair that is missing.
// Returns counts; never marks an item translated unless a valid translation arrived.
export async function translateFields(items, {
  fields = TRANSLATED_FIELDS, fetcher = (...args) => fetch(...args), limit = 1000, maxRequests = 60, concurrency = 2,
  timeoutMs = 6000, endpoints = MT_ENDPOINTS, tl = 'zh-TW', onTranslated = null
} = {}) {
  const jobs = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    for (const [from, to] of fields) {
      const text = clean(item[from]);
      if (typeof item[from] !== 'string' || item[to] || !translatable(text)) continue;
      jobs.push({ item, from, to, text, sl: sourceLanguage(text) });
      if (jobs.length >= limit) break;
    }
    if (jobs.length >= limit) break;
  }
  const queue = [...batches(jobs.filter(j => j.sl === 'en')), ...batches(jobs.filter(j => j.sl === 'zh-CN'))];
  const blocked = new Set();
  let cursor = 0, requests = 0, translated = 0, failed = 0, attempted = 0, reason = null;
  async function request(endpoint, batch) {
    const url = new URL(endpoint);
    url.searchParams.set('sl', batch[0].sl); url.searchParams.set('tl', tl);
    for (const job of batch) url.searchParams.append('q', job.text);
    const timer = timeoutSignal(timeoutMs);
    try {
      const response = await fetcher(url, { signal: timer.signal });
      if (response.status === 429) { blocked.add(endpoint); reason = 'translation-rate-limited'; return null; }
      if (!response.ok) return null;
      return parseBatch(await response.json(), batch.length);
    } catch { return null; } finally { timer.done(); }
  }
  async function worker() {
    while (cursor < queue.length && requests < maxRequests) {
      const batch = queue[cursor++];
      let result = null;
      for (const endpoint of endpoints) {
        if (blocked.has(endpoint) || requests >= maxRequests) continue;
        requests++;
        result = await request(endpoint, batch);
        if (result) break;
      }
      // Rate limited everywhere: these texts were never really tried — they are deferred to the next run.
      if (!result && endpoints.every(e => blocked.has(e))) { cursor = queue.length; continue; }
      attempted += batch.length;
      if (!result) { failed += batch.length; continue; }
      const changed = [];
      batch.forEach((job, i) => {
        const text = acceptTranslation(job.text, result[i], job.sl);
        if (!text) { failed++; return; }
        job.item[job.to] = text;
        if (job.from === 'title') Object.assign(job.item, { translationStatus: 'translated', translationMethod: 'machine-title-only' });
        else job.item[`${job.from}Method`] = 'machine';
        translated++; changed.push(job.item);
      });
      if (changed.length && onTranslated) { try { onTranslated(changed); } catch {} }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return { attempted, translated, failed, deferred: jobs.length - attempted, requests, ...(reason ? { reason } : {}) };
}
