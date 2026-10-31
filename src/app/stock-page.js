// 個股 page (it was the 盤面 tab): the K-line takes the full width with its drawing
// tools, indicator panes and 全螢幕, the coin's details below, and a bar in the
// dock's place keeps the things done on a coin: ‹ back, 自選, 分享 and 畫相似型態
// (search the board for the shape of this coin's recent candles). The page is a
// step down from a list, so the dock steps aside; ‹ or the phone's back gesture
// returns (view-home-theme.js keeps the history entry).
import { icon, runtime, coinOf, toast } from './chrome-style.js';
import { shareChart } from '../markets/crypto/share-entries.js?v=20261031-share1';

let bar;
const symbol = () => runtime()?.symbol || null;
const starred = s => { try { return isWatchlisted(s); } catch { return false; } };
function sync() {
  if (!bar) return;
  const s = symbol(), on = !!s && starred(s), star = bar.querySelector('[data-stock-act="watch"]');
  star.setAttribute('aria-pressed', String(on)); star.querySelector('span').textContent = on ? '已自選' : '自選';
  star.setAttribute('aria-label', s ? `${on ? '移出' : '加入'}自選 ${coinOf(s)}` : '自選');
}
// The last ~60 closes as a left-to-right shape (x 0→1, y 0→1 bottom to top), thinned to about 40 points.
export function shapeOf(candles, bars = 60) {
  const list = (candles || []).slice(-bars).map(c => Number(c.close)).filter(Number.isFinite);
  if (list.length < 10) return null;
  const lo = Math.min(...list), hi = Math.max(...list), step = Math.max(1, Math.floor(list.length / 40)), out = [];
  for (let i = 0; i < list.length; i += step) out.push({ x: i / (list.length - 1), y: hi === lo ? .5 : (list[i] - lo) / (hi - lo) });
  if (out.at(-1).x !== 1) out.push({ x: 1, y: hi === lo ? .5 : (list.at(-1) - lo) / (hi - lo) });
  return out;
}
function act(kind) {
  if (kind === 'back') { window.OXBack?.(); return; }
  const s = symbol(); if (!s) return;
  if (kind === 'watch') { try { toggleWatchSymbol(s); } catch {} sync(); return; }
  if (kind === 'share') { if (!shareChart()) toast('K 線還在載入，稍後再試'); return; }
  if (kind === 'shape') {
    const rt = runtime(), points = shapeOf(rt?.symbol === s ? rt.candleData : null);
    if (!points) { toast('K 線還在載入，稍後再試'); return; }
    globalThis.OXTrack?.('stock.shape', coinOf(s));
    document.dispatchEvent(new CustomEvent('ox:draw-shape', { detail: { points, symbol: s, frame: rt.period } }));
  }
}
export function initStockPage() {
  bar = document.createElement('div'); bar.className = 'ox-stock-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '個股操作');
  bar.innerHTML = `<button type="button" class="back" data-stock-act="back" aria-label="返回">${icon('back')}</button><button type="button" data-stock-act="watch" data-track="stock.watch" aria-pressed="false">${icon('star')}<span>自選</span></button><button type="button" data-stock-act="share" data-track="share.chart">${icon('share')}<span>分享</span></button><button type="button" class="primary" data-stock-act="shape">${icon('pen')}<span>畫相似型態</span></button>`;
  document.body.append(bar);
  bar.addEventListener('click', e => { const b = e.target.closest('[data-stock-act]'); if (b) act(b.dataset.stockAct); });
  for (const type of ['ox:viewchange', 'ox:watchlist', 'ox:accountchange']) document.addEventListener(type, () => requestAnimationFrame(sync));
  const radar = document.getElementById('view-radar');
  if (radar) new MutationObserver(sync).observe(radar, { attributes: true, attributeFilter: ['data-selected-symbol'] });
  sync();
}
