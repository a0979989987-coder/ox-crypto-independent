// Translate public headlines and the publisher's short RSS summary only; never
// submit article bodies or user data. Reviewed translations in the collector
// take precedence over this fallback. Shared with the live endpoint and the
// news page: see server/news/translate.js.
import { translateFields } from '../server/news/translate.js';
export async function translateHeadlines(items, { fetcher, limit = 100, concurrency = 2, timeoutMs = 6000, maxRequests = 80 } = {}) {
  return translateFields(items, { ...(fetcher ? { fetcher } : {}), limit, concurrency, timeoutMs, maxRequests });
}
