// GET /api/v1/news/latest — the last 36 hours from the fast-moving crypto
// newsrooms and Bitget announcements, normalized by the same rules as the
// snapshot collector, with Traditional Chinese titles and short summaries
// where translation succeeds. The CDN keeps one copy for three minutes, so the
// publishers see at most one request per region every few minutes however
// many people have the news page open. The static data/news.json snapshot
// remains the history and the fallback; this endpoint only adds what is newer.
import { FEEDS, LIVE_FEED_IDS, TRADITIONAL_SOURCES, BITGET_ANNOUNCEMENTS_URL, normalizeFeed, fetchText, bitgetAnnouncements } from './feeds.js';
import { identifyAssets } from './assets.js';
import { translateFields } from './translate.js';

export const LATEST_SCHEMA_VERSION = 1;
const HAN = /[一-鿿]/;
const MAX_ITEMS = 160;

function send(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export async function collectLatest({ fetcher = (...args) => fetch(...args), now = Date.now(), windowHours = 36, feedTimeoutMs = 6000, translate = true, translationOptions = {} } = {}) {
  const stamp = new Date(now).toISOString(), since = now - windowHours * 3600000;
  const feeds = FEEDS.filter(feed => LIVE_FEED_IDS.includes(feed.id));
  const loads = [
    ...feeds.map(feed => ({ id: feed.id, load: async () => normalizeFeed(await fetchText(feed.url, { fetcher, timeoutMs: feedTimeoutMs }), feed) })),
    { id: 'bitget', load: async () => bitgetAnnouncements(JSON.parse(await fetchText(BITGET_ANNOUNCEMENTS_URL, { fetcher, timeoutMs: feedTimeoutMs })), stamp) }
  ];
  const results = await Promise.allSettled(loads.map(entry => entry.load()));
  const sources = [], seen = new Map();
  results.forEach((result, i) => {
    const id = loads[i].id;
    if (result.status !== 'fulfilled') { sources.push({ id, status: 'error', lastAttemptAt: stamp, message: String(result.reason?.message || '來源請求失敗').slice(0, 100) }); return; }
    const recent = result.value.filter(item => { const at = Date.parse(item.publishedAt); return Number.isFinite(at) && at >= since && at <= now + 60000; });
    sources.push({ id, status: 'ready', count: recent.length, lastSuccessAt: stamp, lastAttemptAt: stamp });
    for (const item of recent) if (!seen.has(item.id)) seen.set(item.id, item);
  });
  const news = [...seen.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, MAX_ITEMS).map(item => {
    const traditional = TRADITIONAL_SOURCES.includes(item.sourceId);
    const titleZh = traditional && HAN.test(item.title) ? item.title : null;
    const summaryZh = item.summary && traditional && HAN.test(item.summary) ? item.summary : null;
    return { ...item, titleZh, translationStatus: titleZh ? 'translated' : 'pending', ...(item.summary ? { summaryZh, summaryType: 'source' } : {}), live: true };
  });
  let translation = { attempted: 0, translated: 0, failed: 0, deferred: 0, requests: 0 };
  if (translate && news.length) {
    try { translation = await translateFields(news, { fetcher, limit: 400, maxRequests: 10, concurrency: 4, timeoutMs: 3500, ...translationOptions }); }
    catch { translation = { ...translation, failed: news.length, reason: 'translation-error' }; }
  }
  for (const item of news) item.assets = identifyAssets(item.titleZh || item.title, item.markets, []);
  return { schemaVersion: LATEST_SCHEMA_VERSION, kind: 'news-latest', generatedAt: stamp, windowHours, sources, news, translation };
}

export function createLatestNewsHandler(options = {}) {
  return async function latestNews(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return send(res, 405, { error: 'method-not-allowed' }, 'no-store'); }
    try {
      const body = await collectLatest({ ...options, now: options.now ? options.now() : Date.now() });
      // Every newsroom failing is an outage, not "no news": a short cache so it retries soon.
      if (!body.sources.some(source => source.status === 'ready')) return send(res, 502, { ...body, error: 'all-sources-failed' }, 'public, max-age=0, s-maxage=30');
      return send(res, 200, body, 'public, max-age=60, s-maxage=180, stale-while-revalidate=600');
    } catch {
      return send(res, 500, { schemaVersion: LATEST_SCHEMA_VERSION, error: 'latest-news-unavailable' }, 'public, max-age=0, s-maxage=15');
    }
  };
}
