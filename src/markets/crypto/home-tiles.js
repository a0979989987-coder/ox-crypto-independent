// 首頁色塊 for the crypto site, after the Taiwan site's (PR #48). A darker tile is a bigger
// 24H move, 青藍 up and 桃紅 down (Bitget). Which tiles and how many (4, 8 or 12) are the
// reader's choice, kept on the device and, for members, in the account (src/app/sync-keys.js):
// 「✎ 編輯」 under the tiles, a long press on a tile (wiggle, ✕ to remove, drag to reorder,
// ＋ to add), or 設定 → 首頁色塊.
// Every number is real and comes from what the page already has: the Bitget USDT perpetual
// tickers (prices, 24H change, 資金費率), the OX 板塊 groups (equal-weight average of their
// Bitget contracts), plus two small public sources fetched only while a tile needs them:
// CoinGecko (總市值 and BTC／ETH 市佔 from /global; their 24H move from the 100 largest coins,
// because /global's own 24H change can disagree with every big coin) and alternative.me's
// 恐懼貪婪指數.
// A tile waits as 「—」 in its place until its number arrives, so nothing jumps; live prices
// patch the text in place (OXPatchHTML) instead of drawing the tiles again.
import { SECTOR_GROUPS, AMBIGUOUS_BASES, CONTRACT_BASES } from './analytics/sector-taxonomy.js';
import '../../core/price-format.js';

export const TILES_KEY = 'ox-crypto:home-tiles-v1';
const GLOBAL_KEY = 'ox-crypto:home-global-v1';
const SIZES = [4, 8, 12];
export const DEFAULT_TILES = ['c:ETHUSDT', 'c:SOLUSDT', 'm:breadth', 'g:btc-dom', 'c:BNBUSDT', 'c:XRPUSDT', 'g:total', 'f:BTCUSDT', 'c:DOGEUSDT', 'g:fng', 'sec:ai', 'sec:meme'];
const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'TRX', 'AVAX', 'LINK', 'SUI', 'TON', 'HYPE', 'LTC', 'DOT', 'BCH'];
const FUNDING = ['BTC', 'ETH', 'SOL'];
const ORDER = ['主流幣', '全市場', '資金費率', '板塊'];
const FNG_ZH = { 'Extreme Fear': '極度恐懼', Fear: '恐懼', Neutral: '中性', Greed: '貪婪', 'Extreme Greed': '極度貪婪' };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fin = v => { const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v); return Number.isFinite(n) ? n : null; };
const sgn = v => v > 0 ? '+' : v < 0 ? '-' : '';
const pct = v => v == null ? '—' : `${sgn(v)}${Math.abs(v).toFixed(2)}%`;
const coin = symbol => String(symbol || '').replace(/USDT$/, '');
const priceText = v => globalThis.OXPriceText(v);
const trillion = v => v >= 1e12 ? `${(v / 1e12).toFixed(2)} 兆美元` : `${(v / 1e8).toFixed(0)} 億美元`;
const runtime = () => { try { return typeof state !== 'undefined' ? state : null; } catch { return null; } };

// ---------- saved choice ----------
export function readPrefs(storage = globalThis.localStorage) {
  let p = {}; try { p = JSON.parse(storage.getItem(TILES_KEY)) || {}; } catch {}
  const list = Array.isArray(p.list) ? p.list.filter(id => typeof id === 'string').slice(0, 40) : DEFAULT_TILES.slice();
  return { size: SIZES.includes(p.size) ? p.size : 8, list };
}
function savePrefs(p) { try { localStorage.setItem(TILES_KEY, JSON.stringify({ size: p.size, list: p.list })); } catch {} render(true); document.dispatchEvent(new CustomEvent('ox:home-tiles')); }

// ---------- numbers ----------
// The page's quote for a USDT perpetual: the live stream first, else the ticker list.
function quote(symbol, tickers) {
  const live = globalThis.OXCryptoQuotes?.get?.(symbol), row = tickers.get(symbol);
  if (!live && !row) return null;
  const price = fin(live?.lastPr ?? row?.lastPr), ratio = fin(live?.change24h ?? row?.change24h);
  return { price, change: ratio == null ? null : ratio * 100, funding: fin(row?.fundingRate) };
}
// One 板塊: its Bitget contracts (multiplier contracts as listed, ambiguous tickers left out).
const ambiguous = new Set(AMBIGUOUS_BASES);
function sectorMembers(group, tickers) {
  const out = new Set();
  for (const base of group.bases) {
    const b = base.toUpperCase(); if (ambiguous.has(b)) continue;
    for (const contract of [b, CONTRACT_BASES[b]].filter(Boolean)) {
      const row = tickers.get(contract + 'USDT');
      if (row && fin(row.usdtVolume) > 0) { out.add(row.symbol); break; }
    }
  }
  return [...out];
}
const median = list => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Every tile that can be shown, with its number when it has one.
// { id, cat, name, full, big, sub, move, scale, open, symbol }
export function catalog({ tickers: list = runtime()?.tickers || [], global = globalData } = {}) {
  const tickers = new Map(list.filter(t => t?.symbol).map(t => [t.symbol, t]));
  const out = [];
  for (const c of COINS) {
    const symbol = c + 'USDT', q = quote(symbol, tickers);
    if (q) out.push({ id: 'c:' + symbol, cat: '主流幣', name: c, big: pct(q.change), sub: priceText(q.price), move: q.change, scale: 8, open: 'coin', symbol });
  }
  // 全市場, from every eligible coin's 24H change.
  const rows = [...tickers.values()].map(t => [t.symbol, fin(t.change24h)]).filter(([, v]) => v != null);
  if (rows.length) {
    const ups = rows.filter(([, v]) => v > 0).length, downs = rows.filter(([, v]) => v < 0).length, share = ups + downs ? ups / (ups + downs) * 100 : 50;
    out.push({ id: 'm:breadth', cat: '全市場', name: '上漲家數', big: `${Math.round(share)}%`, sub: `漲${ups}・跌${downs}`, move: share - 50, scale: 40, open: 'rank' });
    const mid = median(rows.map(([, v]) => v * 100));
    out.push({ id: 'm:median', cat: '全市場', name: '中位數漲跌', big: pct(mid), sub: `${rows.length} 個幣`, move: mid, scale: 5, open: 'rank' });
    const btc = quote('BTCUSDT', tickers)?.change;
    if (btc != null && mid != null) out.push({ id: 'm:alts', cat: '全市場', name: '小幣對 BTC', full: '小幣對 BTC（中位數減 BTC）', big: pct(mid - btc), sub: `BTC ${pct(btc)}`, move: mid - btc, scale: 4, open: 'strength' });
    const sorted = [...rows].sort((a, b) => b[1] - a[1]), top = sorted[0], bottom = sorted.at(-1);
    out.push({ id: 'm:top', cat: '全市場', name: '漲幅第一', big: pct(top[1] * 100), sub: coin(top[0]), move: top[1] * 100, scale: 30, open: 'coin', symbol: top[0] });
    out.push({ id: 'm:bottom', cat: '全市場', name: '跌幅第一', big: pct(bottom[1] * 100), sub: coin(bottom[0]), move: bottom[1] * 100, scale: 30, open: 'coin', symbol: bottom[0] });
  }
  const g = global?.global;
  if (g && fin(g.total)) {
    const change = fin(g.change);
    out.push({ id: 'g:total', cat: '全市場', name: '總市值', big: change == null ? trillion(g.total) : pct(change), sub: change == null ? '24H 變化更新中' : trillion(g.total), move: change, scale: 5, open: 'bubbles' });
    // 市佔 24 小時前 from the same day's market-cap moves: share × (1 + 總市值漲跌) ÷ (1 + 該幣市值漲跌).
    for (const [c, share, own] of [['BTC', g.btc, g.btcChange], ['ETH', g.eth, g.ethChange]]) {
      if (fin(share) == null) continue;
      const before = change == null || fin(own) == null ? null : share * (1 + change / 100) / (1 + own / 100), d = before == null ? null : share - before;
      out.push({ id: `g:${c.toLowerCase()}-dom`, cat: '全市場', name: `${c} 市佔`, big: `${share.toFixed(1)}%`, sub: d == null ? '總市值占比' : `${sgn(d)}${Math.abs(d).toFixed(2)} 百分點`, move: d, scale: 1, open: 'bubbles' });
    }
  }
  const f = global?.fng;
  if (f && fin(f.value) != null) out.push({ id: 'g:fng', cat: '全市場', name: '恐懼貪婪', full: '恐懼貪婪指數', big: String(f.value), sub: FNG_ZH[f.label] || f.label || '', move: f.value - 50, scale: 50, open: 'news' });
  // 資金費率: the current period's rate; positive means longs pay shorts.
  const rate = r => r == null ? '—' : `${sgn(r)}${Math.abs(r * 100).toFixed(4)}%`;
  for (const c of FUNDING) {
    const r = fin(tickers.get(c + 'USDT')?.fundingRate);
    if (r != null) out.push({ id: `f:${c}USDT`, cat: '資金費率', name: `${c} 費率`, full: `${c} 資金費率`, big: rate(r), sub: r >= 0 ? '多方付費' : '空方付費', move: r * 100, scale: .03, open: 'funding' });
  }
  const rates = [...tickers.values()].map(t => fin(t.fundingRate)).filter(v => v != null);
  if (rates.length) { const m = median(rates); out.push({ id: 'f:median', cat: '資金費率', name: '費率中位數', full: '全市場資金費率中位數', big: rate(m), sub: `${rates.length} 個幣`, move: m * 100, scale: .03, open: 'funding' }); }
  // 板塊: equal-weight 24H change of the group's Bitget contracts.
  for (const group of SECTOR_GROUPS) {
    const changes = sectorMembers(group, tickers).map(s => fin(tickers.get(s).change24h)).filter(v => v != null);
    if (changes.length < 3) continue;
    const avg = changes.reduce((a, b) => a + b, 0) / changes.length * 100;
    out.push({ id: 'sec:' + group.id, cat: '板塊', name: group.shortName, full: `${group.shortName} 板塊`, big: pct(avg), sub: `${changes.length} 個幣`, move: avg, scale: 8, open: 'rotation' });
  }
  return out;
}

// ---------- CoinGecko global and the fear & greed index ----------
// The 24H move of the whole market, BTC and ETH from the largest coins' market caps.
export function capMoves(rows) {
  if (!Array.isArray(rows) || rows.length < 20) return { change: null, btcChange: null, ethChange: null };
  let now = 0, before = 0;
  for (const r of rows) { const cap = fin(r?.market_cap), c = fin(r?.market_cap_change_percentage_24h); if (!cap || c == null || c <= -100) continue; now += cap; before += cap / (1 + c / 100); }
  const own = id => fin(rows.find(r => r?.id === id)?.market_cap_change_percentage_24h);
  return { change: before > 0 ? (now / before - 1) * 100 : null, btcChange: own('bitcoin'), ethChange: own('ethereum') };
}
let globalData = null, globalJob = null;
try { globalData = JSON.parse(localStorage.getItem(GLOBAL_KEY)) || null; if (globalData?.global && !('btcChange' in globalData.global)) globalData = null; } catch {}
const stale = () => !globalData || Date.now() - (globalData.at || 0) > 10 * 60e3;
const getJSON = url => fetch(url, { cache: 'no-cache', credentials: 'omit' }).then(r => r.ok ? r.json() : null).catch(() => null);
function wantGlobal(force = false) {
  if (globalJob || !force && !stale()) return globalJob;
  globalJob = Promise.all([
    getJSON('https://api.coingecko.com/api/v3/global'),
    getJSON('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false'),
    getJSON('https://api.alternative.me/fng/?limit=1')
  ]).then(([cg, top, fg]) => {
    const d = cg?.data, x = fg?.data?.[0], next = { at: Date.now(), global: globalData?.global || null, fng: globalData?.fng || null };
    if (d && fin(d.total_market_cap?.usd)) next.global = { total: d.total_market_cap.usd, btc: fin(d.market_cap_percentage?.btc), eth: fin(d.market_cap_percentage?.eth), ...capMoves(top) };
    if (x && fin(x.value) != null) next.fng = { value: Math.round(fin(x.value)), label: x.value_classification || '' };
    if (!next.global && !next.fng) return;
    globalData = next; try { localStorage.setItem(GLOBAL_KEY, JSON.stringify(next)); } catch {}
    render(true); refreshEditor();
  }).finally(() => { globalJob = null; });
  return globalJob;
}

// ---------- tiles ----------
// The tile colour is a CSS variable pair per theme (crypto-home.css), so a theme change needs no redraw.
const tone = (move, scale) => {
  const k = move == null || move === 0 ? 0 : Math.min(1, Math.abs(move) / scale);
  return { dir: move == null || move === 0 ? 'f' : move > 0 ? 'u' : 'd', a: (0.14 + 0.8 * k).toFixed(2), hot: k > 0.45 };
};
let editing = false;
function tileHTML(id, t, edit) {
  const c = tone(t?.move ?? null, t?.scale || 1), label = t ? `${t.full || t.name} ${t.big}` : '資料更新中';
  return `<button type="button" class="ht-t ${c.dir}${c.hot ? ' hot' : ''}" style="--ht-a:${c.a}" data-key="${esc(id)}" data-ht="${esc(id)}" aria-label="${esc(label)}">${edit ? `<span class="ht-x" data-ht-del="${esc(id)}" aria-label="移除">×</span>` : ''}<i>${esc(t?.name || placeholderName(id))}</i>${t ? `<b>${esc(t.big)}</b><s>${esc(t.sub || '　')}</s>` : '<b class="ox-skel"></b><s class="ox-skel"></s>'}</button>`;
}
// A chosen tile whose number has not arrived keeps its place with its name.
function placeholderName(id) {
  if (id.startsWith('c:')) return coin(id.slice(2));
  if (id.startsWith('f:')) return id === 'f:median' ? '費率中位數' : coin(id.slice(2)) + ' 費率';
  if (id.startsWith('sec:')) return SECTOR_GROUPS.find(g => g.id === id.slice(4))?.shortName || '板塊';
  return { 'm:breadth': '上漲家數', 'm:median': '中位數漲跌', 'm:alts': '小幣對 BTC', 'm:top': '漲幅第一', 'm:bottom': '跌幅第一', 'g:total': '總市值', 'g:btc-dom': 'BTC 市佔', 'g:eth-dom': 'ETH 市佔', 'g:fng': '恐懼貪婪' }[id] || '—';
}
const known = id => /^(c|f):[A-Z0-9]+USDT$/.test(id) || id === 'f:median' || /^m:(breadth|median|alts|top|bottom)$/.test(id) || /^g:(total|btc-dom|eth-dom|fng)$/.test(id) || id.startsWith('sec:') && SECTOR_GROUPS.some(g => g.id === id.slice(4));
export function tilesHTML(model = { tickers: runtime()?.tickers || [] }) {
  const p = readPrefs(), all = new Map(catalog(model).map(t => [t.id, t]));
  const shown = p.list.filter(known).slice(0, p.size);
  return `<div class="ht-grid${editing ? ' editing' : ''}">${shown.map(id => tileHTML(id, all.get(id), editing)).join('')}${editing ? '<button type="button" class="ht-t ht-add" data-key="ht-add" data-ht-add aria-label="加入色塊">＋</button>' : ''}${!shown.length && !editing ? '<div class="ht-empty" data-key="ht-empty">還沒有色塊，按「編輯」加入</div>' : ''}</div>
    <div class="ht-legend"><span>顏色越深＝漲跌越大${globalThis.OXUpdated?.text() ? `・${globalThis.OXUpdated.text()}` : ''}</span><button type="button" data-ht-edit>${editing ? '完成' : '✎ 編輯'}</button></div>`;
}
export const tileSymbols = () => readPrefs().list.filter(id => /^c:/.test(id)).slice(0, 12).map(id => id.slice(2));

let lastPaint = 0, paintTimer = 0;
const box = () => document.querySelector('#view-home [data-home-tiles]');
const onHome = () => !document.hidden && document.body.dataset.view === 'home';
// Live prices arrive many times a second; the tiles take them at most once a second.
export function render(now = false) {
  const el = box(); if (!el || drag?.moved) return;
  if (!now) {
    if (!onHome()) return;
    const wait = 1000 - (performance.now() - lastPaint);
    if (wait > 0) { if (!paintTimer) paintTimer = setTimeout(() => { paintTimer = 0; render(); }, wait); return; }
  }
  lastPaint = performance.now();
  const html = tilesHTML();
  if (globalThis.OXPatchHTML) globalThis.OXPatchHTML(el, html); else el.innerHTML = html;
  if (readPrefs().list.slice(0, readPrefs().size).some(id => id.startsWith('g:'))) wantGlobal();
}

// ---------- long press: wiggle, ✕, drag to reorder ----------
function setEditing(on) { if (editing === on) return; editing = on; render(true); }
let press = null, drag = null, swallow = false;
function cellIndex(grid, x, y) {
  const cells = [...grid.querySelectorAll('.ht-t[data-ht]')]; let best = -1, d = Infinity;
  cells.forEach((c, i) => { const r = c.getBoundingClientRect(), dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2), dd = dx * dx + dy * dy; if (dd < d) { d = dd; best = i; } });
  return best;
}
function moveItem(id, to) {
  const p = readPrefs(), list = p.list.filter(x => x !== id);
  const shownIds = [...document.querySelectorAll('#view-home [data-home-tiles] .ht-t[data-ht]')].map(b => b.dataset.ht).filter(x => x !== id);
  const anchor = shownIds[to], at = anchor ? list.indexOf(anchor) : list.length;
  list.splice(at < 0 ? list.length : at, 0, id); p.list = list; savePrefs(p);
}
function open(t) {
  if (!t) return;
  globalThis.OXTrack?.('home.tile', t.id);
  if (t.open === 'coin' && t.symbol) { window.switchSymbol?.(t.symbol); return; }
  if (t.open === 'news') { if (window.OXNews?.openMarket) window.OXNews.openMarket(); else window.switchAppView?.('data'); return; }
  const tool = { rank: 'rank', funding: 'rank', strength: 'strength', bubbles: 'bubbles', rotation: 'rotation' }[t.open];
  if (tool) { window.OXMarketTabs?.select(tool); window.switchAppView?.('strength'); }
}
function listen() {
  if (listen.done) return; listen.done = true;
  document.addEventListener('pointerdown', e => {
    const t = e.target.closest?.('#view-home [data-home-tiles] .ht-t[data-ht]'); if (!t) return;
    if (editing) {
      if (e.target.closest('[data-ht-del]')) return;
      drag = { el: t, id: t.dataset.ht, sx: e.clientX, sy: e.clientY, moved: false, pid: e.pointerId };
      return;
    }
    press = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { press = null; swallow = true; setTimeout(() => { swallow = false; }, 450); setEditing(true); navigator.vibrate?.(8); }, 450) };
  }, true);
  document.addEventListener('pointermove', e => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.timer); press = null; }
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    drag.moved = true; e.preventDefault();
    drag.el.classList.add('dragging'); drag.el.style.transform = `translate(${e.clientX - drag.sx}px,${e.clientY - drag.sy}px) scale(1.06)`;
    const grid = drag.el.closest('.ht-grid'), i = cellIndex(grid, e.clientX, e.clientY);
    grid.querySelectorAll('.ht-t').forEach((c, k) => c.classList.toggle('target', k === i && c !== drag.el));
  }, { passive: false });
  const end = e => {
    if (press) { clearTimeout(press.timer); press = null; }
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.pid)) return;
    const d = drag; drag = null;
    if (!d.moved) return;
    swallow = true; setTimeout(() => { swallow = false; }, 450);
    const grid = d.el.closest('.ht-grid'), i = cellIndex(grid, e.clientX, e.clientY);
    d.el.classList.remove('dragging'); d.el.style.transform = '';
    grid.querySelectorAll('.ht-t.target').forEach(c => c.classList.remove('target'));
    moveItem(d.id, i);
  };
  document.addEventListener('pointerup', end, true); document.addEventListener('pointercancel', end, true);
  document.addEventListener('click', e => {
    if (e.target.closest?.('[data-home-tiles-edit]')) { openTileEditor(); return; }
    const inTiles = e.target.closest?.('#view-home [data-home-tiles]');
    if (swallow && inTiles) { swallow = false; e.stopPropagation(); e.preventDefault(); return; }
    swallow = false;
    if (!inTiles) { if (editing && !e.target.closest('.oc-sheet')) setEditing(false); return; }
    e.stopPropagation();
    const del = e.target.closest('[data-ht-del]');
    if (del) { const p = readPrefs(); p.list = p.list.filter(x => x !== del.dataset.htDel); savePrefs(p); return; }
    if (e.target.closest('[data-ht-add]')) { openTileEditor(); return; }
    if (e.target.closest('[data-ht-edit]')) { if (editing) setEditing(false); else openTileEditor(); return; }
    if (editing) { e.preventDefault(); return; }
    const tile = e.target.closest('.ht-t[data-ht]');
    if (tile) open(catalog().find(t => t.id === tile.dataset.ht));
  }, true);
  document.addEventListener('contextmenu', e => { if (e.target.closest?.('#view-home [data-home-tiles]')) e.preventDefault(); });
  document.addEventListener('ox:viewchange', () => { if (editing) { editing = false; } render(true); });
  // A member's saved choice arrives from the account after sign-in.
  document.addEventListener('ox:member', () => render(true));
  addEventListener('storage', e => { if (e.key === TILES_KEY) render(true); });
}

// ---------- the editor sheet (編輯, ＋ and 設定 → 首頁色塊) ----------
let refreshEditor = () => {};
export function openTileEditor() {
  listen(); wantGlobal();
  document.querySelector('.oc-sheet[data-ht-sheet]')?.remove();
  const sheet = document.createElement('div'); sheet.className = 'oc-sheet'; sheet.dataset.htSheet = '';
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', '首頁色塊');
  const back = '<svg class="oc-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
  sheet.innerHTML = `<div class="oc-sheet-head"><button type="button" class="oc-btn oc-back" data-x aria-label="收起">${back}</button><h2>首頁色塊</h2></div><div class="oc-body"><div class="hs" data-hs></div></div>`;
  const body = sheet.querySelector('[data-hs]');
  function paint() {
    const p = readPrefs(), items = catalog(), byId = new Map(items.map(t => [t.id, t])), chosen = p.list.filter(known);
    const sw = t => { const c = tone(t?.move ?? null, t?.scale || 1); return `<span class="hs-sw ${c.dir}" style="--ht-a:${c.a}"></span>`; };
    const row = (id, i) => { const t = byId.get(id); return `<div class="hs-row${i >= p.size ? ' over' : ''}" data-key="${esc(id)}" data-hs-id="${esc(id)}"><span class="hs-handle" data-hs-drag aria-label="拖曳排序">≡</span>${sw(t)}<span class="hs-n"><b>${esc(t?.full || t?.name || placeholderName(id))}</b><small>${esc(t?.cat || '資料更新中')}</small></span><em>${esc(t?.big || '—')}</em><button type="button" class="hs-del" data-hs-del="${esc(id)}" aria-label="移除">−</button></div>`; };
    const groups = ORDER.map(cat => [cat, items.filter(t => t.cat === cat)]).filter(([, l]) => l.length);
    const html = `<div class="hs-line"><span>格數</span><div class="hs-seg small">${SIZES.map(n => `<button type="button" data-hs-size="${n}" aria-pressed="${p.size === n}">${n} 格</button>`).join('')}</div></div>
        <p class="hs-label">顯示中・前 ${p.size} 個會出現在首頁，按住 ≡ 拖曳排序</p>
        <div class="hs-list" data-hs-list>${chosen.map(row).join('') || '<div class="hs-empty">還沒有選，從下面加入</div>'}</div>
        ${groups.map(([cat, list]) => `<p class="hs-label">${esc(cat)}</p><div class="hs-pick">${list.map(t => { const on = chosen.includes(t.id); return `<button type="button" class="hs-chip" data-key="${esc(t.id)}" data-hs-add="${esc(t.id)}" aria-pressed="${on}">${sw(t)}${esc(t.full || t.name)}<em>${esc(t.big)}</em><i>${on ? '✓' : '＋'}</i></button>`; }).join('')}</div>`).join('')}
        <button type="button" class="hs-reset" data-hs-reset>恢復預設</button>`;
    if (globalThis.OXPatchHTML) globalThis.OXPatchHTML(body, html); else body.innerHTML = html;
  }
  refreshEditor = () => { if (sheet.isConnected && !d) paint(); };
  paint(); document.body.append(sheet); globalThis.OXTrack?.('home.tiles.edit');
  const live = setInterval(() => { if (!sheet.isConnected) clearInterval(live); else refreshEditor(); }, 2000);
  const close = () => { sheet.remove(); clearInterval(live); refreshEditor = () => {}; document.removeEventListener('keydown', onKey); if (editing) setEditing(false); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  sheet.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-x')) { close(); return; }
    const p = readPrefs();
    if (b.dataset.hsSize) { p.size = +b.dataset.hsSize; savePrefs(p); paint(); return; }
    if (b.dataset.hsDel) { p.list = p.list.filter(x => x !== b.dataset.hsDel); savePrefs(p); paint(); return; }
    if (b.dataset.hsAdd) { const id = b.dataset.hsAdd; p.list = p.list.includes(id) ? p.list.filter(x => x !== id) : [...p.list, id]; savePrefs(p); paint(); if (id.startsWith('g:')) wantGlobal(); return; }
    if (b.hasAttribute('data-hs-reset')) { p.list = DEFAULT_TILES.slice(); p.size = 8; savePrefs(p); paint(); }
  });
  // Drag ≡ to reorder the chosen list.
  let d = null;
  sheet.addEventListener('pointerdown', e => {
    const h = e.target.closest('[data-hs-drag]'); if (!h) return;
    const rowEl = h.closest('.hs-row'); e.preventDefault();
    d = { row: rowEl, id: rowEl.dataset.hsId, y: e.clientY, pid: e.pointerId }; rowEl.classList.add('dragging'); try { h.setPointerCapture?.(e.pointerId); } catch {}
  });
  sheet.addEventListener('pointermove', e => { if (d && e.pointerId === d.pid) d.row.style.transform = `translateY(${e.clientY - d.y}px)`; });
  const drop = e => {
    if (!d || e.pointerId !== d.pid) return;
    const rows = [...sheet.querySelectorAll('.hs-row')].filter(r => r !== d.row);
    let at = rows.findIndex(r => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; }); if (at < 0) at = rows.length;
    const p = readPrefs(), order = rows.map(r => r.dataset.hsId); order.splice(at, 0, d.id);
    p.list = [...order, ...p.list.filter(x => !order.includes(x))];
    d.row.classList.remove('dragging'); d.row.style.transform = ''; d = null; savePrefs(p); paint();
  };
  sheet.addEventListener('pointerup', drop); sheet.addEventListener('pointercancel', drop);
}

if (typeof document !== 'undefined') {
  listen();
  globalThis.OXHomeTiles = Object.freeze({ render, open: openTileEditor, symbols: tileSymbols });
  const first = () => render(true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', first, { once: true }); else first();
}
