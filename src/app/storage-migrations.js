// Remove only retired-market browser data; keep account, theme and active markets.
export function retireMarketStorage(storage, session, database) {
  for (const area of [storage, session]) {
    try {
      for (const key of Object.keys(area))
        if (/^ox-us(?:-|:|$)/.test(key) || key === 'ox-news-v2-us' || key === 'ox-tier-filters-us') area.removeItem(key);
      if (area.getItem('ox-active-market') === 'us') area.setItem('ox-active-market', 'crypto');
    } catch { /* Private browsing may disable storage. */ }
  }
  try { database?.deleteDatabase('ox-us-device'); } catch { /* Never block boot. */ }
}
if (typeof window !== 'undefined') {
  try { retireMarketStorage(window.localStorage, window.sessionStorage, window.indexedDB); } catch {}
}
