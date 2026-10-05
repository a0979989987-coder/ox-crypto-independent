// Product-only allowlist. Identity/admin/private records are never configurable.
export const FEATURE_CATALOG = Object.freeze([
  ['crypto.home','加密首頁','public_source'],['crypto.radar','加密篩選雷達','public_source'],
  ['crypto.patterns','加密形態搜尋','public_source'],['crypto.bubbles','加密泡泡圖','public_source'],
  ['crypto.strength','加密強弱指標','public_source'],['crypto.heatmap','加密熱力圖','public_source'],
  ['crypto.rotation','加密資金輪動','public_source'],['crypto.flow','加密主動買賣','public_source'],
  ['tw.home','台股首頁','api_and_public_snapshot'],['tw.radar','台股篩選雷達','api_and_public_snapshot'],
  ['tw.patterns','台股潛力形態','public_snapshot'],['tw.bubbles','台股泡泡圖','public_snapshot'],
  ['tw.rotation','台股資金輪動','api_and_public_snapshot'],['tw.etf','ETF 工具','api_and_public_snapshot'],
  ['tw.savings','存股計畫','public_snapshot'],['news.feed','市場新聞','public_snapshot'],
  ['news.calendar','經濟／市場行事曆','public_snapshot'],['media','交易媒體','public_source']
].map(([id,label,boundary])=>Object.freeze({id,label,boundary})));
export const FEATURE_IDS = new Set(FEATURE_CATALOG.map(f=>f.id));
export const TW_API_FEATURES = Object.freeze({home:'tw.home',radar:'tw.radar',research:'tw.rotation',etf:'tw.etf',outlook:'news.calendar'});
export function validCatalog(rows) {
  return Array.isArray(rows)&&rows.length===FEATURE_CATALOG.length&&new Set(rows.map(f=>f?.id)).size===rows.length&&rows.every(f=>FEATURE_IDS.has(f.id)&&['public','login'].includes(f.mode)&&typeof f.version==='string');
}
