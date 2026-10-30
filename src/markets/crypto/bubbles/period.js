// 泡泡圖 N 日漲跌: the small label above each coin's name. N is 3, 5 or a custom 2–60
// days, remembered on this device (and synced for members, src/app/sync-keys.js).
// The change is the latest price against the daily close N days before today's
// candle (Bitget USDT 永續 1D, Taipei days). Each coin's daily candles are read once
// a day, two at a time, only for the coins on screen.
export const PERIOD_KEY = 'ox-crypto:bubble-days-v1';
export const PERIOD_PRESETS = Object.freeze([3, 5]);
export const PERIOD_MIN = 2, PERIOD_MAX = 60, PERIOD_DEFAULT = 5;
export const clampDays = value => { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.max(PERIOD_MIN, Math.min(PERIOD_MAX, n)) : PERIOD_DEFAULT; };
export function readPeriodDays(storage = globalThis.localStorage) {
  try { const raw = storage?.getItem(PERIOD_KEY); return raw == null || raw === '' ? PERIOD_DEFAULT : clampDays(raw); } catch { return PERIOD_DEFAULT; }
}
export function writePeriodDays(days, storage = globalThis.localStorage) {
  const value = clampDays(days);
  try { storage?.setItem(PERIOD_KEY, String(value)); } catch {}
  return value;
}
// candles: daily, oldest first, the last one is today's (still open). price: the live price.
export function periodChange(candles, days, price = null) {
  if (!Array.isArray(candles) || candles.length <= days) return null;
  const base = Number(candles.at(-1 - days)?.close), now = Number.isFinite(price) && price > 0 ? price : Number(candles.at(-1)?.close);
  return base > 0 && now > 0 ? (now / base - 1) * 100 : null;
}
// The Taipei day a timestamp (ms) falls on, as a day number.
export const taipeiDay = ms => Math.floor((ms + 8 * 3600000) / 86400000);

const LIMIT = PERIOD_MAX + 4, CONCURRENCY = 2;
// fetchJSON(url, signal) → Bitget's reply. One cache per page: the board, home and a
// remount of the bubbles all share it.
export function createDailyCloses(fetchJSON, { now = Date.now, max = 400 } = {}) {
  const cache = new Map(), queue = [], waiting = new Set();
  let active = 0, listeners = new Set();
  // A copy lasts the Taipei day (at most 6 hours); a failed read is retried after 10 minutes.
  const fresh = hit => hit && taipeiDay(hit.at) === taipeiDay(now()) && now() - hit.at < (hit.failed ? 600000 : 6 * 3600000);
  function pump(signal) {
    while (active < CONCURRENCY && queue.length && !signal?.aborted) {
      const symbol = queue.shift(); active++;
      const url = `https://api.bitget.com/api/v2/mix/market/candles?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&granularity=1D&limit=${LIMIT}`;
      Promise.resolve().then(() => fetchJSON(url, signal)).then(json => {
        if (json?.code !== '00000' || !Array.isArray(json.data)) throw Error('Bitget 日 K 格式不符');
        const candles = json.data.map(r => ({ time: Math.floor(Number(r[0]) / 1000), close: Number(r[4]) })).filter(c => Number.isFinite(c.time) && c.close > 0).sort((a, b) => a.time - b.time);
        cache.delete(symbol); cache.set(symbol, { at: now(), candles });
        while (cache.size > max) cache.delete(cache.keys().next().value);
      }).catch(error => { if (error?.name !== 'AbortError') cache.set(symbol, { at: now(), candles: [], failed: true }); })
        .finally(() => { active--; waiting.delete(symbol); for (const fn of listeners) fn(symbol); pump(signal); });
    }
  }
  return {
    get(symbol) { const hit = cache.get(symbol); return fresh(hit) ? hit.candles : null; },
    // Queue the coins without a current copy; returns how many were queued.
    want(symbols, signal) {
      let added = 0;
      for (const symbol of symbols) if (!fresh(cache.get(symbol)) && !waiting.has(symbol)) { waiting.add(symbol); queue.push(symbol); added++; }
      pump(signal); return added;
    },
    cancel() { for (const symbol of queue) waiting.delete(symbol); queue.length = 0; },
    pending: () => waiting.size,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}
