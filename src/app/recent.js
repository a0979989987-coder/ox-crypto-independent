// 最近使用: the coins and 行情 tools opened lately, newest first, kept on this device.
// switchSymbol adds each coin opened on the 個股 page.
const KEY = 'ox-crypto:recent-v1', MAX = 12;
function read() { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v.filter(x => x && x.type && x.id) : []; } catch { return []; } }
export const recent = {
  list: read,
  add(item) {
    if (!item?.type || !item.id) return;
    const list = read().filter(x => !(x.type === item.type && x.id === String(item.id)));
    list.unshift({ type: item.type, id: String(item.id), at: Date.now() });
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch {}
    document.dispatchEvent(new CustomEvent('ox:recent'));
  }
};
globalThis.OXRecent = recent;
// 行情 tabs live in a shadow root; their buttons carry data-crypto-tool.
if (typeof document !== 'undefined') document.addEventListener('click', event => {
  const tool = event.composedPath().find(node => node?.dataset?.cryptoTool)?.dataset.cryptoTool;
  if (tool) recent.add({ type: 'tool', id: tool });
}, true);
