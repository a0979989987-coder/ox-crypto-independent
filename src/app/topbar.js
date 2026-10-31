// The 首頁 top bar (static markup in index.html, #ox-topbar): the avatar opens the
// left drawer, one search box finds coins and features, and 通知 lists what is new.
// The search box rotates the most traded USDT perpetuals so it always suggests
// something. Other pages give its room to their content (app-shell.css).
import { icon, escapeHTML, avatarHTML, tickers, coinOf, openCoin, runtime } from './chrome-style.js';

const SEEN_KEY = 'ox-crypto:notice-seen-v1';
const readJSON = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };
const finite = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
export const pctText = v => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
export const block = v => v > 0 ? 'u' : v < 0 ? 'd' : 'f';
export function priceText(v) {
  const x = finite(v); if (!x) return '—';
  return x.toLocaleString('en-US', { maximumFractionDigits: x >= 1000 ? 2 : x >= 1 ? 4 : x >= .01 ? 6 : 8 });
}
export function moneyText(v) {
  const x = finite(v); if (x == null) return '—';
  return x >= 1e8 ? `${(x / 1e8).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}億` : x >= 1e4 ? `${(x / 1e4).toLocaleString('zh-TW', { maximumFractionDigits: x >= 1e6 ? 0 : 1 })}萬` : x.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
}
// Bitget reports the 24H change as a fraction; the newest pushed quote wins.
export function quoteOf(ticker) {
  const live = globalThis.OXCryptoQuotes?.get?.(ticker.symbol);
  const change = finite(live?.change24h ?? ticker.change24h);
  return { symbol: ticker.symbol, price: finite(live?.lastPr ?? ticker.lastPr), change: change == null ? null : change * 100, volume: finite(live?.usdtVolume ?? ticker.usdtVolume) };
}
// The coin's logo (src/assets/token-logos), else its first two letters.
export function logoHTML(symbol, cls = 'oc-logo-coin') {
  const base = coinOf(symbol), key = base.replace(/^1000(?=[A-Z])/, '').toLowerCase();
  let src = null; try { src = typeof OX_COIN_LOGOS !== 'undefined' ? OX_COIN_LOGOS[key] : null; } catch {}
  return `<span class="${cls}" aria-hidden="true">${escapeHTML(base.slice(0, 2))}${src ? `<img src="${escapeHTML(src)}" alt="" width="30" height="30" decoding="async" loading="lazy" onerror="this.remove()">` : ''}</span>`;
}
const taipei = iso => new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

// Features reachable from search: [label, keywords, view, 行情 tab]
export const FEATURES = [
  ['雷達 T1／T2／T3', '雷達 分級 多頭 空頭 熱門 radar', 'strength', 'radar'], ['自選', '收藏 觀察 watchlist', 'strength', 'watch'],
  ['排行', '漲幅 跌幅 成交額 資金費率 熱門', 'strength', 'rank'], ['泡泡圖', '量能 漲跌 bubbles', 'strength', 'bubbles'],
  ['強弱對比', 'BTC 小幣 強度 指標', 'strength', 'strength'], ['熱力圖', '板塊 熱度 heatmap', 'strength', 'heatmap'],
  ['板塊輪動', '板塊 族群 輪動 rotation', 'strength', 'rotation'], ['主動買賣', '資金 主動 買盤 賣盤 flow', 'strength', 'flow'],
  ['型態畫板', '畫 型態 W 底 頭肩 諧波 突破', 'radar'], ['每 4 小時突破・勝率', '型態 突破 勝率 紀錄 4H', 'pattern'],
  ['新聞・行事曆', '資訊 新聞 經濟數據 非農 CPI 聯準會 FOMC', 'data'], ['設定・使用說明', '主題 深色 白金 帳號 通知 Bitget UID 說明', 'settings']
];
export function openFeature([, , view, tool]) {
  if (tool) window.OXMarketTabs?.select(tool);
  if (view === 'data') { if (window.OXNews?.openMarket) window.OXNews.openMarket(); else window.switchAppView?.('data'); }
  else if (view === 'settings') globalThis.OXDrawer?.openSettings();
  else window.switchAppView?.(view);
}

let bar, hotIndex = -1, hotTimer = 0;
const byTurnover = () => tickers().map(quoteOf).filter(q => q.volume > 0).sort((a, b) => b.volume - a.volume);
function hotNames() { return byTurnover().slice(0, 8).map(q => coinOf(q.symbol)); }
function rotateHot() {
  const label = bar?.querySelector('.oc-search span'); const names = hotNames();
  if (!label || !names.length) return;
  hotIndex = (hotIndex + 1) % names.length;
  const next = `🔥 ${names[hotIndex]} 熱門搜尋`;
  if (label.textContent === next) return;
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) { label.textContent = next; return; }
  label.classList.add('out'); setTimeout(() => { label.textContent = next; label.classList.remove('out'); }, 250);
}
function startHot() { if (hotTimer || !hotNames().length) return; rotateHot(); hotTimer = setInterval(() => { if (!document.hidden && document.body.dataset.view === 'home') rotateHot(); }, 3800); }

// ---------- search ----------
function coinRow(q) {
  return `<button type="button" class="oc-btn oc-row" data-coin="${escapeHTML(q.symbol)}">${logoHTML(q.symbol)}<div class="grow"><b>${escapeHTML(coinOf(q.symbol))}</b><small>24H 成交額 ${moneyText(q.volume)}</small></div><span class="px">${priceText(q.price)}</span><span class="oc-chg ${block(q.change)}">${pctText(q.change)}</span></button>`;
}
function rank(list, term) {
  const t = term.replace(/[\s/]+/g, '').toUpperCase().replace(/USDT$/, '');
  if (!t) return [];
  const score = q => { const b = coinOf(q.symbol); return b === t ? 0 : b.startsWith(t) ? 1 : b.includes(t) ? 2 : 9; };
  return list.map(q => [score(q), q]).filter(([n]) => n < 9).sort((a, b) => a[0] - b[0] || (b[1].volume || 0) - (a[1].volume || 0)).map(([, q]) => q);
}
export function openSearch(initial = '') {
  const sheet = document.createElement('div'); sheet.className = 'oc-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', '搜尋');
  sheet.innerHTML = `<div class="oc-sheet-head"><label class="oc-input">${icon('search')}<input type="search" enterkeyhint="search" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="幣種代號或功能" aria-label="搜尋幣種或功能"></label><button type="button" class="oc-btn oc-cancel" data-x>取消</button></div><div class="oc-body"></div>`;
  const input = sheet.querySelector('input'), body = sheet.querySelector('.oc-body');
  function render() {
    const term = input.value.trim(), all = tickers().map(quoteOf);
    if (!term) {
      const recent = (globalThis.OXRecent?.list() || []).filter(x => x.type === 'coin').slice(0, 8);
      const hot = byTurnover().slice(0, 10);
      body.innerHTML = (recent.length ? `<div class="oc-sec"><span>最近看過</span></div><div class="oc-chips">${recent.map(x => `<button type="button" class="oc-btn oc-chip" data-coin="${escapeHTML(x.id)}">${escapeHTML(coinOf(x.id))}</button>`).join('')}</div>` : '')
        + `<div class="oc-sec"><span>功能</span></div><div class="oc-chips">${FEATURES.slice(0, 9).map((f, i) => `<button type="button" class="oc-btn oc-chip" data-feature="${i}">${f[0]}</button>`).join('')}</div>`
        + (hot.length ? `<div class="oc-sec"><span>24H 成交額最大</span><span>Bitget USDT 永續</span></div>${hot.map(coinRow).join('')}` : '<div class="oc-empty">幣種清單載入中…</div>');
      return;
    }
    const found = rank(all, term).slice(0, 40), t = term.toLowerCase();
    const features = FEATURES.map((f, i) => [f, i]).filter(([f]) => (f[0] + ' ' + f[1]).toLowerCase().includes(t));
    body.innerHTML = (features.length ? `<div class="oc-sec"><span>功能</span></div>${features.map(([f, i]) => `<button type="button" class="oc-btn oc-row" data-feature="${i}"><span class="oc-kind">${icon('tool')}</span><div class="grow"><b>${f[0]}</b><small>${f[1]}</small></div></button>`).join('')}` : '')
      + (found.length ? `<div class="oc-sec"><span>幣種</span><span>${found.length >= 40 ? '前 40 個' : found.length + ' 個'}</span></div>${found.map(coinRow).join('')}` : '')
      + (!features.length && !found.length ? `<div class="oc-empty">${all.length ? `找不到「${escapeHTML(term)}」` : '幣種清單載入中…'}</div>` : '');
  }
  const close = () => { sheet.remove(); document.removeEventListener('keydown', onKey); clearInterval(refresh); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  sheet.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.x != null) { close(); return; }
    if (t.dataset.coin) { close(); globalThis.OXTrack?.('search.coin', coinOf(t.dataset.coin)); openCoin(t.dataset.coin); return; }
    if (t.dataset.feature) { close(); globalThis.OXTrack?.('search.feature', FEATURES[+t.dataset.feature][0]); openFeature(FEATURES[+t.dataset.feature]); }
  });
  let typing = 0;
  input.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(render, 80); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(typing); render(); body.querySelector('[data-coin],[data-feature]')?.click(); } });
  document.addEventListener('keydown', onKey);
  input.value = initial; render();
  // The ticker list arrives a moment after the page opens.
  const refresh = setInterval(() => { if (!sheet.isConnected) { clearInterval(refresh); return; } if (!input.value.trim() && !body.querySelector('[data-coin]')) render(); }, 1500);
  document.body.append(sheet); requestAnimationFrame(() => input.focus());
}

// ---------- 通知 ----------
let macroJob = null, breakoutJob = null, breakoutAt = 0;
const loadJSON = path => fetch(new URL(path, document.baseURI), { cache: 'no-cache', credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null);
const loadMacro = () => macroJob ??= loadJSON('data/macro-results.json').then(j => j || (macroJob = null));
function loadBreakouts() { if (!breakoutJob || Date.now() - breakoutAt > 10 * 60e3) { breakoutAt = Date.now(); breakoutJob = loadJSON('data/crypto-breakouts.json'); } return breakoutJob; }
const macroValue = (v, unit) => !Number.isFinite(v) ? '—' : unit === '人' ? `${(v / 1e4).toLocaleString('zh-TW', { maximumFractionDigits: 1 })} 萬人` : `${v}${unit || ''}`;
const watchSymbols = () => { try { return new Set(getWatchlistRecords().map(r => r.symbol)); } catch { return new Set(); } };
const at4h = seconds => { const d = new Date((seconds + 8 * 3600) * 1000); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:00`; };
export async function notices() {
  const items = [], now = Date.now();
  const a = globalThis.OXSiteConfig?.announcement;
  if (a?.text) items.push({ id: 'a:' + a.id, kind: 'megaphone', title: '公告', text: a.text, link: /^https:\/\//.test(a.link || '') ? a.link : '' });
  const [macro, log] = await Promise.all([loadMacro(), loadBreakouts()]);
  // 自選 coins in the newest 4 小時 K breakouts the board listed.
  const point = Array.isArray(log?.points) ? [...log.points].sort((x, y) => y.at - x.at)[0] : null, mine = watchSymbols();
  for (const p of point?.picks || []) if (mine.has(p.s)) items.push({ id: `b:${point.at}:${p.s}`, kind: 'spark', title: `${coinOf(p.s)} 確認突破`, text: `4 小時 K${p.t ? '・T' + p.t : ''}・${at4h(point.at)} 收盤`, coin: p.s });
  for (const e of macro?.events || []) {
    if (Array.isArray(e.markets) && !e.markets.includes('crypto')) continue;
    const at = Date.parse(e.releasedAt || e.occursAt || '');
    if (!Number.isFinite(at)) continue;
    const title = e.titleZh || e.title;
    if (e.releasedAt && now >= at && now - at < 36 * 3600e3) items.push({ id: 'r:' + e.id, kind: 'calendar', title: title + ' 公布', text: `實際 ${macroValue(e.actual, e.unit)}・前值 ${macroValue(e.previous, e.unit)}`, action: 'data' });
    else if (!e.releasedAt && at > now && at - now < 7 * 86400e3) items.push({ id: 'm:' + e.id, kind: 'calendar', title, text: `台北 ${taipei(e.occursAt)}${Number.isFinite(e.previous) ? '・前值 ' + macroValue(e.previous, e.unit) : ''}`, action: 'data' });
  }
  return items;
}
function seen() { return new Set(readJSON(SEEN_KEY, [])); }
export async function unreadCount() { const s = seen(); return (await notices()).filter(x => !s.has(x.id)).length; }
async function refreshDot() { const n = await unreadCount(); bar?.querySelector('.oc-dot')?.toggleAttribute('hidden', !n); document.dispatchEvent(new CustomEvent('ox:notice-count', { detail: n })); }
export async function openNotices() {
  const sheet = document.createElement('div'); sheet.className = 'oc-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', '通知');
  sheet.innerHTML = `<div class="oc-sheet-head"><button type="button" class="oc-btn oc-back" data-x aria-label="收起">${icon('back')}</button><h2>通知</h2></div><div class="oc-body"><div class="oc-empty">載入中…</div></div>`;
  document.body.append(sheet);
  const close = () => { sheet.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const items = await notices(), was = seen();
  if (!sheet.isConnected) return;
  sheet.querySelector('.oc-body').innerHTML = items.length ? items.map((x, i) => `<button type="button" class="oc-btn oc-note${was.has(x.id) ? '' : ' new'}" data-i="${i}"><span class="oc-kind">${icon(x.kind)}</span><div><b>${escapeHTML(x.title)}</b><p>${escapeHTML(x.text)}</p></div></button>`).join('')
    : '<div class="oc-empty">目前沒有新通知。<br>自選幣種確認突破、經濟數據公布前後、站內公告都會出現在這裡。</div>';
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...items.map(x => x.id), ...was])].slice(0, 300))); } catch {}
  refreshDot();
  sheet.addEventListener('click', e => {
    if (e.target.closest('[data-x]')) { close(); return; }
    const x = items[+e.target.closest('[data-i]')?.dataset.i]; if (!x) return;
    close();
    if (x.coin) openCoin(x.coin);
    else if (x.link) open(x.link, '_blank', 'noopener');
    else if (x.action === 'data') (window.OXNews?.openMarket ? window.OXNews.openMarket() : window.switchAppView?.('data'));
  });
}

// ---------- bar ----------
export function initTopbar() {
  bar = document.getElementById('ox-topbar'); if (!bar) return;
  // Page tabs pin just under the bar (text-tabs.js reads --oc-top-h); 0 while it is hidden.
  new ResizeObserver(() => document.documentElement.style.setProperty('--oc-top-h', bar.offsetHeight + 'px')).observe(bar);
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-oc]'); if (!b) return;
    if (b.dataset.oc === 'drawer') globalThis.OXDrawer?.open();
    if (b.dataset.oc === 'search') { openSearch(); globalThis.OXTrack?.('search.open'); }
    if (b.dataset.oc === 'notices') { openNotices(); globalThis.OXTrack?.('notices.open'); }
  });
  const paintAvatar = () => { for (const el of document.querySelectorAll('[data-oc="drawer"]')) el.innerHTML = avatarHTML(); };
  document.addEventListener('ox:member', paintAvatar); paintAvatar();
  document.addEventListener('ox:siteconfig', refreshDot);
  document.addEventListener('ox:watchlist', refreshDot);
  // The ticker list arrives after the first paint.
  const wait = setInterval(() => { if (runtime()?.tickers?.length) { clearInterval(wait); startHot(); } }, 1000);
  refreshDot(); setInterval(() => { if (!document.hidden) refreshDot(); }, 10 * 60e3);
  globalThis.OXSearch = { open: openSearch }; globalThis.OXNotices = { open: openNotices, unreadCount };
}
