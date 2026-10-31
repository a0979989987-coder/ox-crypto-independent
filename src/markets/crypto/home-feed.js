// 首頁 parts that fill in after the numbers (those are painted by renderHomeOverview in
// src/app/view-home-theme.js):
//   今日突破  the newest 4H close with breakouts in the 型態 record (data/crypto-breakouts.json),
//             read through the 型態 tool module so both pages share one download of the record
//             and of each coin's 4H candles. A card draws the pattern outline from the record at
//             once and its 4H chart when the candles arrive (only cards on screen ask for them).
//   此刻發生  three current crypto headlines from the 資訊 news snapshot (window.OXNews).
//   live      BTC, ETH, SOL and the breakout coins on the public quote stream while 首頁 shows.
// Buttons: 畫型態 → 畫板, 全部 → 型態 or 資訊, a breakout card → that coin's 4H chart.
import { loadToolModule } from '../../components/load-tool-module.js';
import { localizeNewsText } from '../../components/news/localization.js';

const STEP = 14400, DAY = 86400, MAX_CARDS = 12, LOADS = 2;
const MINI = Object.freeze({ width: 150, height: 78, pad: 4, bars: 42 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '—';
const coin = symbol => String(symbol || '').replace(/USDT$/, '');
const runtime = () => typeof state !== 'undefined' ? state : null;
const root = () => document.getElementById('view-home');
const onHome = () => !document.hidden && document.body.dataset.view === 'home' && (document.body.dataset.market || 'crypto') === 'crypto';
const muted = text => `<span class="oxh-muted oxh-pad">${esc(text)}</span>`;

function lastPrice(symbol) {
  const live = Number(globalThis.OXCryptoQuotes?.get?.(symbol)?.lastPr);
  if (live > 0) return live;
  const row = runtime()?.tickers?.find?.(t => t.symbol === symbol);
  return row ? Number(row.lastPr) : NaN;
}
// The coin's own artwork when the site has it, else its first two letters.
function logo(symbol) {
  const base = coin(symbol), key = base.replace(/^1000(?=[A-Z])/, '').toLowerCase();
  const src = typeof OX_COIN_LOGOS !== 'undefined' ? OX_COIN_LOGOS[key] : null;
  return `<span class="oxh-logo" aria-hidden="true">${esc(base.slice(0, 2))}${src ? `<img src="${esc(src)}" alt="" width="20" height="20" decoding="async">` : ''}</span>`;
}
const dropBrokenLogos = box => box.querySelectorAll('.oxh-logo img').forEach(img => img.addEventListener('error', () => img.remove(), { once: true }));

// ---------- 今日突破 ----------
const compareURL = () => new URL('./compare/view.js?v=20261031-home1', import.meta.url).href;
const breaks = { at: null, time: '', count: 0, picks: [], charts: new Map(), queue: [], queued: new Set(), active: 0, observer: null, module: null, job: null, candle: 0 };

function sinceBreak(pick) {
  const now = lastPrice(pick.s);
  return pick.base > 0 && now > 0 ? (now / pick.base - 1) * 100 : NaN;
}
function refreshChanges() {
  const box = root()?.querySelector('[data-home-breaks-list]');
  if (!box) return;
  for (const el of box.querySelectorAll('[data-chg]')) {
    const pick = breaks.picks.find(p => p.s === el.dataset.chg), v = pick ? sinceBreak(pick) : NaN;
    const text = pct(v), cls = `oxh-chg ${Number.isFinite(v) ? v > 0 ? 'u' : v < 0 ? 'd' : 'f' : 'f'}`;
    if (el.textContent !== text) el.textContent = text;
    if (el.className !== cls) el.className = cls;
  }
}
// After the breakout the record has one close per 4H candle; show a few slots beyond them.
const afterK = pick => Math.min(18, Math.max(2, (pick.c?.length || 1) - 1));
function cardHTML(pick) {
  const key = `${pick.s}@${breaks.at}`;
  const chart = breaks.charts.get(key) || breaks.module.closesChart(pick, breaks.at, { size: MINI, maxK: afterK(pick), label: '' });
  return `<button type="button" class="oxh-card oxh-break" data-home-break="${esc(pick.s)}" aria-label="${esc(pick.coin)} ${esc(pick.name)} 突破，打開 4 小時 K 線">
    <span class="oxh-bn">${logo(pick.s)}<b>${esc(pick.coin)}</b>${pick.t ? `<i data-tier="${pick.t}">T${pick.t}</i>` : ''}</span>
    <small>${esc(pick.name)}</small>
    <span class="oxh-mini" data-mini="${esc(pick.s)}"${breaks.charts.has(key) ? '' : ' data-outline'}>${chart}</span>
    <span class="oxh-bf"><span>突破後</span><em class="oxh-chg f" data-chg="${esc(pick.s)}">—</em></span>
  </button>`;
}
// Only cards on screen (and the next one) ask for candles, two at a time.
function pump() {
  while (breaks.active < LOADS && breaks.queue.length) {
    const symbol = breaks.queue.shift(), at = breaks.at, candle = breaks.candle, pick = breaks.picks.find(p => p.s === symbol);
    if (!pick) continue;
    breaks.active++;
    breaks.module.candlesFor(symbol).then(candles => {
      const svg = at === breaks.at && candle === breaks.candle ? breaks.module.miniChart(pick, at, candles, { size: MINI, maxK: afterK(pick), label: '', mark: true }) : '';
      if (!svg) return;
      breaks.charts.set(`${symbol}@${at}`, svg);
      const box = root()?.querySelector(`[data-home-breaks-list] [data-mini="${CSS.escape(symbol)}"]`);
      if (box) { box.innerHTML = svg; delete box.dataset.outline; }
    }).catch(() => { breaks.queued.delete(`${symbol}@${at}`); /* the outline stays */ })
      .finally(() => { breaks.active--; pump(); });
  }
}
function watchMinis(list) {
  breaks.observer?.disconnect();
  if (!('IntersectionObserver' in window)) { for (const pick of breaks.picks.slice(0, 4)) want(pick.s); return; }
  breaks.observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) want(entry.target.dataset.mini);
  }, { root: list, rootMargin: '0px 60% 0px 0px' });
  list.querySelectorAll('[data-outline]').forEach(el => breaks.observer.observe(el));
}
function want(symbol) {
  const key = `${symbol}@${breaks.at}`;
  if (!symbol || breaks.charts.has(key) || breaks.queued.has(key)) return;
  breaks.queued.add(key); breaks.queue.push(symbol); pump();
}

function hydrateBreaks() {
  breaks.job ??= paintBreaks().finally(() => { breaks.job = null; });
  return breaks.job;
}
async function paintBreaks() {
  const section = root()?.querySelector('[data-home-breaks]');
  if (!section) return;
  const list = section.querySelector('[data-home-breaks-list]'), time = section.querySelector('[data-home-breaks-time]');
  const fail = text => { if (!list.querySelector('.oxh-break')) { list.innerHTML = muted(text); time.textContent = ''; } };
  let model;
  try {
    breaks.module ??= await loadToolModule(compareURL(), { current: () => true });
    model = breaks.module.compareModel(await breaks.module.loadLog());
  } catch (error) { if (error?.name !== 'AbortError') fail('突破紀錄暫時無法載入'); return; }
  // The newest 4H close that had breakouts, if it is from the last day.
  const point = model.points.find(p => p.count);
  if (!point || Date.now() / 1000 - point.at > DAY) {
    breaks.at = null; breaks.picks = []; breaks.observer?.disconnect();
    time.textContent = '';
    list.innerHTML = muted(point ? '24 小時內沒有新的向上突破' : '還沒有突破紀錄');
    syncQuotes(); return;
  }
  // Each 4H close adds a candle to the charts; draw them again from the new candles.
  const candle = Math.floor(Date.now() / 1000 / STEP);
  if (candle !== breaks.candle) { breaks.candle = candle; breaks.charts.clear(); breaks.at = null; }
  if (point.at !== breaks.at || !list.querySelector('.oxh-break')) {
    breaks.at = point.at; breaks.time = point.time; breaks.count = point.count;
    breaks.queue = []; breaks.queued.clear();
    breaks.picks = [...point.picks].sort((a, b) => (a.t ?? 9) - (b.t ?? 9)).slice(0, MAX_CARDS);
    time.textContent = `${point.time} 突破・${point.count} 個`;
    list.innerHTML = breaks.picks.map(cardHTML).join('');
    dropBrokenLogos(list);
    list.scrollLeft = 0;
    watchMinis(list);
  }
  refreshChanges(); syncQuotes();
}
// What 首頁's share image lists under the numbers.
export function homeBreakSummary() {
  if (!breaks.at || !breaks.picks.length) return null;
  return { time: breaks.time, count: breaks.count, picks: breaks.picks.map(p => ({ coin: p.coin, change: sinceBreak(p) })) };
}

// ---------- 此刻發生 ----------
const KEY_WORDS = /比特幣|BTC|以太坊|ETH|聯準會|Fed|FOMC|鮑爾|利率|降息|升息|CPI|PCE|非農|就業|通膨|ETF|SEC|監管|法案|清算|爆倉|資金費率|未平倉|穩定幣|USDT|USDC|美股|那斯達克|關稅|美元指數|美債|Strategy|貝萊德|BlackRock|灰度|交易所/gi;
const HYPE = /空投|迷因|meme|百倍|千倍|暴漲.{0,4}幣|潛力幣|翻倍|必看/i;
const titleOf = item => localizeNewsText(item.titleZh || (/[一-鿿]/.test(item.title || '') ? item.title : ''));
const safeLink = value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } };
// The market's headlines of the last 12 hours (24 when it was quiet), most relevant first;
// the same story from two outlets once.
export function pickNews(snapshot, { now = Date.now(), count = 3 } = {}) {
  const all = [...(snapshot?.news || []), ...(snapshot?.pendingNews || [])].filter(item => {
    const t = Date.parse(item?.publishedAt);
    return Number.isFinite(t) && t <= now + 60000 && (!item.markets?.length || item.markets.includes('crypto')) && item.contentType !== 'promotion' && titleOf(item) && safeLink(item.link);
  });
  const score = item => { const t = titleOf(item), stars = Number.isInteger(item.impact?.stars) ? item.impact.stars : 0; return stars * 10 + Math.min(3, (t.match(KEY_WORDS) || []).length) * 3 - (HYPE.test(t) ? 6 : 0); };
  const nums = t => new Set((t.match(/\d+(?:[.,]\d+)+|\d{3,}/g) || []).map(s => s.replace(/,/g, '')));
  const names = t => new Set((t.match(/[A-Za-z]{3,}/g) || []).map(s => s.toLowerCase()));
  const pairs = t => { const s = t.replace(/[^\p{Script=Han}]/gu, ''), out = new Set(); for (let k = 0; k < s.length - 1; k++) out.add(s.slice(k, k + 2)); return out; };
  const shared = (a, b) => [...a].filter(x => b.has(x)).length;
  const same = (a, b) => { const n = shared(a.n, b.n); return n >= 2 || n >= 1 && shared(a.w, b.w) >= 1 || shared(a.p, b.p) / Math.max(1, Math.min(a.p.size, b.p.size)) >= .6; };
  for (const hours of [12, 24]) {
    const recent = all.filter(item => now - Date.parse(item.publishedAt) <= hours * 3600e3)
      .sort((a, b) => score(b) - score(a) || String(b.publishedAt).localeCompare(String(a.publishedAt)));
    const kept = [];
    for (const item of recent) {
      const t = titleOf(item), mark = { item, n: nums(t), w: names(t), p: pairs(t) };
      if (kept.some(k => same(mark, k))) continue;
      kept.push(mark); if (kept.length === count) break;
    }
    if (kept.length === count || hours === 24) return kept.map(k => k.item).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  }
  return [];
}
const taipei = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function when(iso, now = Date.now()) {
  const p = Object.fromEntries(taipei.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  const today = Object.fromEntries(taipei.formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return `${p.month === today.month && p.day === today.day ? '' : `${p.month}/${p.day} `}${p.hour}:${p.minute}`;
}
let newsAt = 0, newsJob = null;
function hydrateNews(force = false) {
  if (newsJob || !force && Date.now() - newsAt < 5 * 60e3) return newsJob;
  const box = root()?.querySelector('[data-home-news-list]');
  if (!box || !window.OXNews?.refresh) return null;
  newsJob = Promise.resolve(window.OXNews.refresh(false, { priority: 'low' })).then(snapshot => {
    if (!snapshot) { if (!box.querySelector('.oxh-newsrow')) box.innerHTML = muted('新聞暫時無法載入'); return; }
    newsAt = Date.now();
    const items = pickNews(snapshot);
    box.innerHTML = items.length ? items.map(item => `<a class="oxh-card oxh-newsrow" href="${esc(safeLink(item.link))}" target="_blank" rel="noopener noreferrer"><h4>${esc(titleOf(item))}</h4><span class="oxh-meta">${esc(item.source || '')}・${when(item.publishedAt)}</span></a>`).join('')
      : muted('最近沒有新的市場新聞');
  }).catch(() => { if (!box.querySelector('.oxh-newsrow')) box.innerHTML = muted('新聞暫時無法載入'); }).finally(() => { newsJob = null; });
  return newsJob;
}

// ---------- live prices while 首頁 shows ----------
let quotes = null;
const quoteSymbols = () => ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', ...breaks.picks.map(p => p.s)];
function onQuotes() { window.renderHomeQuotes?.(); refreshChanges(); }
function syncQuotes() {
  if (!onHome() || !globalThis.OXCryptoQuotes) { quotes?.stop(); quotes = null; return; }
  if (quotes) quotes.update(quoteSymbols()); else quotes = globalThis.OXCryptoQuotes.subscribe(quoteSymbols(), onQuotes);
}

// ---------- buttons ----------
// 畫型態 opens 畫板; 今日突破's 全部 opens the 型態 page.
function openBoardTab(mode) {
  window.switchAppView?.(mode === 'compare' ? 'pattern' : 'radar');
}
function onClick(event) {
  const go = event.target.closest?.('#view-home [data-home-go]');
  if (go) {
    event.preventDefault();
    const target = go.dataset.homeGo;
    if (target === 'news') { if (window.OXNews?.openMarket) window.OXNews.openMarket(); else window.switchAppView?.('data'); }
    else openBoardTab(target === 'compare' ? 'compare' : 'board');
    return;
  }
  const card = event.target.closest?.('#view-home [data-home-break]');
  if (card) {
    event.preventDefault();
    const symbol = card.dataset.homeBreak;
    if (window.OXRadarCompare?.open) window.OXRadarCompare.open(symbol, '4H'); else window.switchSymbol?.(symbol);
  }
}

let started = false, newsTimer = 0;
function sync() {
  if (!onHome()) { syncQuotes(); clearTimeout(newsTimer); newsTimer = 0; return; }
  syncQuotes();
  hydrateBreaks();
  // The news snapshot is large: it comes after the numbers and the breakouts.
  if (!newsTimer && !newsAt) newsTimer = setTimeout(() => { newsTimer = 0; if (onHome()) hydrateNews(); }, 1200);
  else if (newsAt) hydrateNews();
}
function start() {
  if (started || !root()) return;
  started = true;
  document.addEventListener('click', onClick);
  for (const type of ['ox:viewchange', 'ox:marketchange', 'visibilitychange']) document.addEventListener(type, () => requestAnimationFrame(sync));
  // A new 4H record lands a few minutes after each close; prices between quote updates.
  setInterval(() => { if (onHome()) { hydrateBreaks(); refreshChanges(); } }, 60000);
  sync();
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
