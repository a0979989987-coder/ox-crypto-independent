// 「HH:MM 更新」 on every data page, so a quiet market never looks like a frozen page.
// The time is when the numbers on screen were last refreshed: the newest Bitget ticker time
// (the list refreshes every minute; the live stream keeps prices current in between).
// 首頁 shows it in the colour tiles' line (home-tiles.js); 行情's tabs under the tab row;
// 圖表 and the 個股 page under the price; 畫板 above the board. 型態 and 資訊 carry their own
// record and news times.
import { runtime } from './chrome-style.js';

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function dataTime(tickers = runtime()?.tickers || []) {
  let t = 0;
  for (const row of tickers) { const v = Number(row?.ts); if (v > t) t = v; }
  return t || null;
}
export const stampText = (t = dataTime()) => t ? `${clock.format(t)} 更新` : '';

function node(key) {
  let el = document.querySelector(`[data-ox-updated="${key}"]`);
  if (!el) { el = document.createElement('small'); el.className = 'ox-updated'; el.dataset.oxUpdated = key; el.setAttribute('aria-live', 'off'); }
  return el;
}
function place() {
  const view = document.body.dataset.view, text = stampText();
  const show = (key, anchor, how) => {
    const el = node(key);
    if (!anchor) { el.hidden = true; return; }
    if (how === 'after' ? anchor.nextElementSibling !== el : how === 'before' ? anchor.previousElementSibling !== el : el.parentElement !== anchor) anchor[how === 'append' ? 'append' : how](el);
    el.hidden = !text; if (el.textContent !== text) el.textContent = text;
  };
  const tab = window.OXMarketTabs?.current?.();
  show('market', view === 'strength' && tab !== 'chart' ? document.getElementById('ox-crypto-tools-nav') : null, 'after');
  show('quote', view === 'chart' || view === 'stock' ? document.querySelector('#view-radar .market-line-price') : null, 'append');
  show('board', view === 'radar' ? document.getElementById('ox-radar-board') : null, 'before');
  if (view === 'home') globalThis.OXHomeTiles?.render?.();
}
let timer = 0;
function schedule() { cancelAnimationFrame(timer); timer = requestAnimationFrame(place); }
if (typeof document !== 'undefined') {
  globalThis.OXUpdated = Object.freeze({ text: stampText, time: dataTime, refresh: schedule });
  for (const type of ['ox:viewchange', 'ox:crypto-toolchange', 'visibilitychange']) document.addEventListener(type, schedule);
  setInterval(() => { if (!document.hidden) place(); }, 15000);
  schedule();
}
