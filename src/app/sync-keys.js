// The browser settings a signed-in member's account keeps in sync across devices.
// One list for the page (src/app/account.js) and the server (server/app/auth.js).
// To sync another setting, add one line:
//   storage: the localStorage key the feature already uses
//   key:     a short stable name stored in the account (a-z, 0-9, -)
//   type:    'json' when the stored text is JSON, 'text' for a plain string
//   merge:   'records' — a list of {symbol,…}; both devices' items are kept (自選)
//            'list'    — a list of plain values; both devices' items are kept
//            'value'   — one setting; the account's copy wins on a new device
export const SYNC_KEYS = Object.freeze([
  { storage: 'ox-watchlist', key: 'watchlist', type: 'json', merge: 'records', label: '自選' },
  // The chart toolbar's 成交量／OX 指標／前高前低 switches still live under the old key.
  { storage: 'ox-chart-indicators', key: 'chart-indicators', type: 'json', merge: 'value', label: '個股指標' },
  { storage: 'ox-crypto:chart-indicators-v1', key: 'chart-indicator-settings', type: 'json', merge: 'value', label: '指標參數' },
  { storage: 'ox-chart-timeframes', key: 'chart-timeframes', type: 'json', merge: 'value', label: '時間級別' },
  { storage: 'ox-crypto:chart-style-v1', key: 'chart-style', type: 'text', merge: 'value', label: 'K 線／線圖' },
  { storage: 'ox-crypto:board-filter-v1', key: 'board-filter', type: 'json', merge: 'value', label: '畫板篩選' },
  { storage: 'ox-crypto:bubble-days-v1', key: 'bubble-days', type: 'text', merge: 'value', label: '泡泡圖天數' },
  { storage: 'ox-radar-filter-mode', key: 'radar-filter-mode', type: 'text', merge: 'value', label: '雷達篩選模式' },
  { storage: 'ox-radar-custom-filters', key: 'radar-custom-filters', type: 'json', merge: 'value', label: '雷達自訂篩選' },
  { storage: 'ox-crypto-sector-watch:guest', key: 'sector-watch', type: 'json', merge: 'list', label: '板塊關注' }
].map(Object.freeze));
// Largest saved value for one key, in characters of JSON.
export const MAX_SYNC_CHARS = 24000;
// Most records kept in a merged list (the watchlist itself keeps 100).
export const MAX_LIST_ITEMS = 200;
// How a device's copy and the account's copy become one on the first sign-in of a device.
export function mergeValue(item, local, remote) {
  if (item.merge === 'records') {
    // 自選: keep this device's order, add the account's other coins; the newer copy of a coin wins.
    const out = new Map();
    for (const list of [local, remote]) for (const row of Array.isArray(list) ? list : []) {
      if (!row || typeof row.symbol !== 'string') continue;
      const prev = out.get(row.symbol);
      if (!prev || (Number(row.savedAt) || 0) > (Number(prev.savedAt) || 0)) out.set(row.symbol, row);
    }
    const next = [...out.values()].slice(0, 100);
    return next.length ? next : undefined;
  }
  if (item.merge === 'list') {
    const next = [...new Set([...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])])].slice(0, MAX_LIST_ITEMS);
    return next.length ? next : undefined;
  }
  return remote !== undefined ? remote : local;
}
