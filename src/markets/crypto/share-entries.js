// Where 分享圖片 starts outside the tools: the 個股 page (its bar's 分享, and a picture button in the price card),
// 首頁 (the picture button beside 畫型態), and the handlers the 畫板 tab passes to the
// board (card long press / picture button, 分享 after drawing). The images themselves
// are drawn by ./share-image.js; the 型態 tab, 型態詳情 and 資訊 call it directly.
import { shareCoin, shareDrawing, shareHome, sharePct, shareTone, sharePrice, shareMoney, shareTime, PICTURE_ICON } from './share-image.js?v=20261031-v3merge';
import { homeBreakSummary } from './home-feed.js';

const runtime = () => typeof state !== 'undefined' ? state : null;
const finite = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const coin = symbol => String(symbol || '').replace(/USDT$/, '');
function ticker(symbol) {
  const live = globalThis.OXCryptoQuotes?.get?.(symbol), rt = runtime();
  const row = rt?.tickers?.find?.(t => t.symbol === symbol);
  const price = finite(live?.lastPr) ?? finite(row?.lastPr), change = finite(live?.change24h ?? row?.change24h), volume = finite(live?.usdtVolume ?? row?.usdtVolume);
  return { price, change: change == null ? null : change * 100, volume };
}
// The breakout candle of a board match: the level's break time, else the last pattern point.
function breakOf(row) {
  const candles = row.candles || [], broken = row.match?.classicSignal?.pressure?.brokenAt ?? row.classicSignal?.pressure?.brokenAt;
  let at = null;
  if (Number.isFinite(broken)) for (let i = 0; i < candles.length; i++) if (candles[i].time <= broken) at = i;
  const pts = row.match?.points || [];
  if (at == null && /突破|跌破/.test(row.match?.stage || '') && pts.length) at = Math.round(pts.at(-1).x);
  return at != null && at >= 0 && at < candles.length ? at : null;
}
const points = row => (row.match?.points || []).filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y)).map(p => [p.x, p.y]);

// 畫板: one card (long press or the picture button).
export function shareBoardRow(row) {
  const m = row.match || {}, last = row.candles?.at(-1), live = ticker(row.symbol), price = live.price ?? last?.close, change = live.change ?? finite(row.change);
  const breakIdx = breakOf(row), down = m.side === 'SHORT' || /跌破/.test(m.stage || '');
  return shareCoin({
    name: row.title || coin(row.symbol), symbol: row.frame,
    chips: [[String(m.label || '').replace(/・.*$/, ''), 'gold'], [m.tier ? 'T' + (row.displayTier ?? m.tier) : '', 'tier'], [m.stage, 'plain']],
    candles: row.candles, points: points(row), breakIdx, label: breakIdx != null ? (down ? '跌破' : '突破') : '',
    facts: [['最新價', sharePrice(price)], ['24H 漲跌', sharePct(change), shareTone(change)], ['OX 強度', row.oxScore == null ? '—' : String(row.oxScore)]],
    kind: 'board'
  });
}
// 畫板: what was drawn and the four closest.
export function shareBoardDrawing({ strokes, rows }) {
  return shareDrawing({ strokes, matches: rows.map(r => ({ name: r.title || coin(r.symbol), frame: r.frame, label: Number.isFinite(r.similarity) ? '相似 ' + r.similarity.toFixed(1) : '', candles: r.candles, points: points(r) })) });
}

// 個股: the chart being viewed.
export function shareChart() {
  const rt = runtime(), candles = rt?.candleData;
  if (!rt?.symbol || !candles?.length) return null;
  const live = ticker(rt.symbol), last = candles.at(-1), price = live.price ?? last.close;
  return shareCoin({
    name: coin(rt.symbol), symbol: 'USDT 永續', chips: [[`${rt.period || ''} K 線`, 'plain'], ['Bitget', 'plain']],
    candles, minBars: 120,
    facts: [['最新價', sharePrice(price)], ['24H 漲跌', sharePct(live.change), shareTone(live.change)], ['24H 成交額', live.volume == null ? '—' : shareMoney(live.volume) + ' U']],
    note: '看圖紀錄，不是投資建議', kind: 'chart'
  });
}

// 首頁: BTC, 市場寬度, ETH and SOL, the latest breakouts and both T1／T2／T3 lists.
export function shareHomeOverview() {
  const rt = runtime(), text = id => document.getElementById(id)?.textContent?.trim() || '—';
  const btc = ticker('BTCUSDT'), eth = ticker('ETHUSDT'), sol = ticker('SOLUSDT');
  const list = side => ['t1', 't2', 't3'].flatMap(tier => (rt?.tierMapBySide?.[side]?.[tier] || []).map(c => ({ c, tier: String(c.displayTier || c.tier || tier).toUpperCase() })))
    .filter(({ c }) => side === 'long' ? Number(c.change24h) > 0 : Number(c.change24h) < 0)
    .slice(0, 8).map(({ c, tier }) => ({ tier, name: coin(c.symbol), change: sharePct(Number(c.change24h) * 100), color: shareTone(Number(c.change24h)) }));
  const count = id => { const v = finite(text(id)); return v == null ? '—' : `${v} 個`; };
  const breaks = homeBreakSummary();
  return shareHome({
    btc: { price: btc.price == null ? text('home-btc-price') : sharePrice(btc.price), change: btc.change == null ? '' : sharePct(btc.change), color: shareTone(btc.change) },
    tiles: [['上漲', count('home-breadth-up'), shareTone(1)], ['下跌', count('home-breadth-down'), shareTone(-1)],
      ['ETH', sharePct(eth.change), shareTone(eth.change)], ['SOL', sharePct(sol.change), shareTone(sol.change)]],
    breaks: breaks && { title: `今日突破・${breaks.time}`, items: breaks.picks.slice(0, 6).map(p => ({ name: p.coin, change: sharePct(p.change), color: shareTone(p.change) })) },
    long: list('long'), short: list('short')
  });
}

// The 個股 price card's button, added once its place exists; styles in share.css.
function button(className, label, track, html) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'ox-share-pic ' + className; b.dataset.track = track;
  b.setAttribute('aria-label', label); b.title = label; b.innerHTML = html;
  return b;
}
function mount() {
  const cell = document.querySelector('#view-radar .market-line-price, .market-line-card .market-line-price');
  if (cell && !cell.querySelector('.ox-chart-share')) {
    const b = button('ox-chart-share', '把這張 K 線做成圖片分享', 'share.chart', PICTURE_ICON);
    b.addEventListener('click', event => { event.stopPropagation(); shareChart(); });
    cell.append(b);
  }
}
if (typeof document !== 'undefined') {
  // 首頁's picture button (.ox-home-share) is in the page itself, beside 畫型態.
  document.addEventListener('click', event => {
    if (!event.target.closest?.('#view-home .ox-home-share')) return;
    event.stopPropagation(); shareHomeOverview();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
  // The price card is rebuilt by some layouts; put the button back when it goes missing.
  for (const type of ['ox:viewchange', 'ox:radar-modechange', 'ox:marketchange']) document.addEventListener(type, () => requestAnimationFrame(mount));
}
