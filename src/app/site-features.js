// Tools the owner can switch off from the admin page (功能開關). Visitors then see
// the owner's message instead of the tool. id is the tool's data-crypto-tool value,
// or a whole page (views lists the dock views it covers). Add a line to make another
// tool switchable; the admin page and the site pick it up from here.
export const SWITCHES = Object.freeze([
  { id: 'patterns', label: '型態搜尋（畫板）' },
  { id: 'bubbles', label: '泡泡圖' },
  { id: 'strength', label: '強弱對比' },
  { id: 'heatmap', label: '熱力圖' },
  { id: 'rotation', label: '板塊輪動' },
  { id: 'flow', label: '主動買賣' },
  { id: 'news', label: '新聞與行事曆', views: ['data', 'news'] },
  { id: 'media', label: '媒體', views: ['media'] }
].map(Object.freeze));
export const SWITCH_IDS = new Set(SWITCHES.map(item => item.id));
export const switchLabel = id => SWITCHES.find(item => item.id === id)?.label || id;
