// 行情 → 自選 and 排行: one row per USDT perpetual (logo, name, price, a solid change
// block, a star), a bar of how many rose and fell over 24H, and a tap opens the 個股
// page. 自選 has the search box of the old 自選 tab (exact code first, then prefix,
// then contains; 30 rows). 排行 reads the Bitget tickers the page already has
// (24H change, 成交額, 資金費率, 持倉), so it adds no requests. Prices on screen
// follow the shared live quote connection.
import { escapeHTML, tickers, coinOf, openCoin } from '../../app/chrome-style.js';
import { quoteOf, priceText, pctText, moneyText, block, logoHTML } from '../../app/topbar.js';

const RANKS = [['up', '漲幅'], ['down', '跌幅'], ['turnover', '成交額'], ['funding', '資金費率'], ['oi', '持倉']];
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/></svg>';
const SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>';
const finite = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const watchRecords = () => { try { return getWatchlistRecords().filter(r => r?.symbol); } catch { return []; } };
const fundingText = v => v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(4)}%`;
// 持倉 in USDT: open contracts × mark price.
const oiOf = t => { const n = finite(t.holdingAmount), p = finite(t.markPrice) ?? finite(t.lastPr); return n != null && p != null ? n * p : null; };

// Exact code first, then prefix, then contains; at most 30 rows (the old 自選 search).
export function searchTickers(list, term, limit = 30) {
  const needle = String(term || '').replace(/[\s/]+/g, '').toUpperCase().replace(/USDT$/, '');
  if (!needle) return [];
  const rank = t => { const b = coinOf(t.symbol); return b === needle ? 0 : b.startsWith(needle) ? 1 : 2; };
  return list.filter(t => coinOf(t.symbol).includes(needle)).sort((a, b) => rank(a) - rank(b) || (finite(b.usdtVolume) || 0) - (finite(a.usdtVolume) || 0)).slice(0, limit);
}
// The 排行 lists from raw tickers.
export function rankTickers(list, kind, { flip = false, limit = 50 } = {}) {
  const ch = t => finite(t.change24h);
  const sorted = kind === 'up' ? list.filter(t => ch(t) > 0).sort((a, b) => ch(b) - ch(a))
    : kind === 'down' ? list.filter(t => ch(t) < 0).sort((a, b) => ch(a) - ch(b))
    : kind === 'turnover' ? list.filter(t => finite(t.usdtVolume) > 0).sort((a, b) => finite(b.usdtVolume) - finite(a.usdtVolume))
    : kind === 'funding' ? list.filter(t => finite(t.fundingRate) != null).sort((a, b) => (finite(b.fundingRate) - finite(a.fundingRate)) * (flip ? -1 : 1))
    : list.filter(t => oiOf(t) > 0).sort((a, b) => oiOf(b) - oiOf(a));
  return sorted.slice(0, limit);
}
export function breadth(list) {
  let ups = 0, downs = 0;
  for (const t of list) { const c = finite(t.change24h); if (c > 0) ups++; else if (c < 0) downs++; }
  return { ups, downs };
}

export function mountMarketList(host, { mode = 'watch' } = {}) {
  const view = { mode, rank: 'up', query: '', sort: null, flip: false };
  const root = document.createElement('div'); root.className = 'ml'; root.dataset.mode = mode; host.replaceChildren(root);
  let quotes = null, timer = 0, typing = 0, life = new AbortController();
  const row = (t, list, alt, sub) => {
    const q = quoteOf(t), on = list.has(t.symbol);
    return `<div class="ml-row" role="button" tabindex="0" data-open="${escapeHTML(t.symbol)}" aria-label="${escapeHTML(coinOf(t.symbol))}，打開個股頁">${logoHTML(t.symbol, 'ox-coin-logo ml-logo')}<span class="nm"><b>${escapeHTML(coinOf(t.symbol))}</b><small>${sub ?? `24H 成交額 ${moneyText(q.volume)}`}</small></span><span class="px" data-px>${priceText(q.price)}</span>${alt ? `<span class="ml-chg alt">${alt}</span>` : `<span class="ml-chg ${block(q.change)}" data-chg>${pctText(q.change)}</span>`}<button type="button" class="ml-star" data-star="${escapeHTML(t.symbol)}" aria-pressed="${on}" aria-label="${on ? '移出' : '加入'}自選 ${escapeHTML(coinOf(t.symbol))}">${STAR}</button></div>`;
  };
  function render() {
    const all = tickers(), mine = new Set(watchRecords().map(r => r.symbol)), { ups, downs } = breadth(all), total = ups + downs || 1;
    let html = `<div class="ml-ratio" aria-hidden="true"><i style="width:${(ups / total * 100).toFixed(1)}%;background:var(--oc-up)"></i><i style="flex:1;background:var(--oc-down)"></i></div>
      <div class="ml-ratio-t"><span class="up">漲 ${ups}</span><span>USDT 永續・24H</span><span class="down">跌 ${downs}</span></div>`;
    if (view.mode === 'watch') {
      const term = view.query.trim();
      html += `<label class="ml-search">${SEARCH}<input type="search" enterkeyhint="search" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="搜尋幣種代號，點 ☆ 加入自選" aria-label="搜尋幣種加入自選" value="${escapeHTML(view.query)}"></label>`;
      if (term) {
        const found = searchTickers(all, term);
        html += found.length ? found.map(t => row(t, mine)).join('') : `<div class="ml-empty">${all.length ? `找不到「${escapeHTML(term)}」，請輸入幣種代號，例如 BTC、ETH。` : '正在取得幣種清單…'}</div>`;
      } else {
        const by = new Map(all.map(t => [t.symbol, t]));
        let list = watchRecords().map(r => by.get(r.symbol)).filter(Boolean);
        if (view.sort) list = [...list].sort((a, b) => view.sort * ((finite(b.change24h) ?? -99) - (finite(a.change24h) ?? -99)));
        html += `<div class="ml-lh"><span>幣種</span><span>最新價</span><button type="button" data-sort aria-label="照 24H 漲跌排序">24H 漲跌 ${view.sort === 1 ? '↓' : view.sort === -1 ? '↑' : '↕'}</button><span></span></div>`;
        html += list.length ? list.map(t => row(t, mine)).join('')
          : `<div class="ml-empty">${all.length ? '還沒有自選。<br>點右邊的 ☆ 就能加入，登入 Google 後換手機也在。' : '正在取得幣種清單…'}</div>${all.length ? `<div class="ml-sec">24H 成交額最大</div>${rankTickers(all, 'turnover', { limit: 10 }).map(t => row(t, mine)).join('')}` : ''}`;
      }
    } else {
      const list = rankTickers(all, view.rank, { flip: view.flip }), funding = view.rank === 'funding', oi = view.rank === 'oi';
      html += `<div class="ml-seg" role="group" aria-label="排行">${RANKS.map(([id, t]) => `<button type="button" data-rank="${id}" aria-pressed="${view.rank === id}" data-track="rank.kind" data-track-detail="${id}">${t}</button>`).join('')}</div>`;
      html += `<div class="ml-lh"><span>幣種</span><span>最新價</span>${funding ? `<button type="button" data-flip aria-label="切換資金費率排序">資金費率 ${view.flip ? '↑' : '↓'}</button>` : `<span>${oi ? '持倉' : '24H 漲跌'}</span>`}<span></span></div>`;
      html += list.map((t, i) => row(t, mine, funding ? fundingText(finite(t.fundingRate)) : oi ? moneyText(oiOf(t)) : null, `#${i + 1}・24H 成交額 ${moneyText(quoteOf(t).volume)}`)).join('')
        || `<div class="ml-empty">${all.length ? '目前沒有符合的幣種' : '資料載入中…'}</div>`;
      if (list.length && (funding || oi)) html += `<p class="ml-foot">${funding ? '資金費率：每次結算時多空互付的比例，正數是多單付給空單。' : '持倉：未平倉合約張數 × 標記價格，以 USDT 計。'}資料來自 Bitget。</p>`;
    }
    const input = root.querySelector('.ml-search input'), focused = input && document.activeElement === input, caret = focused ? input.selectionStart : null;
    // Patched in place: rows, their logos and the search box stay the same nodes (src/app/coin-logo.js).
    if (globalThis.OXPatchHTML) globalThis.OXPatchHTML(root, html); else root.innerHTML = html;
    if (focused) { const next = root.querySelector('.ml-search input'); next.focus({ preventScroll: true }); try { next.setSelectionRange(caret, caret); } catch {} }
    syncQuotes();
  }
  // Live prices for the rows on screen.
  function syncQuotes() {
    const symbols = root.isConnected && !document.hidden ? [...root.querySelectorAll('.ml-row[data-open]')].map(el => el.dataset.open).slice(0, 60) : [];
    if (!symbols.length) { quotes?.stop?.(); quotes = null; return; }
    if (quotes) { quotes.update(symbols); return; }
    quotes = globalThis.OXCryptoQuotes?.subscribe(symbols, rows => {
      for (const q of rows) for (const el of root.querySelectorAll(`.ml-row[data-open="${CSS.escape(q.symbol)}"]`)) {
        const px = el.querySelector('[data-px]'), chg = el.querySelector('[data-chg]'), change = Number(q.change24h) * 100;
        if (px) px.textContent = priceText(q.lastPr);
        if (chg && Number.isFinite(change)) { chg.textContent = pctText(change); chg.className = 'ml-chg ' + block(change); }
      }
    }) || null;
  }
  root.addEventListener('click', e => {
    const star = e.target.closest('[data-star]');
    if (star) { e.stopPropagation(); try { toggleWatchSymbol(star.dataset.star); } catch {} render(); return; }
    const b = e.target.closest('button');
    if (b?.dataset.rank) { if (view.rank !== b.dataset.rank) { view.rank = b.dataset.rank; view.flip = false; render(); } return; }
    if (b?.hasAttribute('data-sort')) { view.sort = view.sort === 1 ? -1 : view.sort === -1 ? null : 1; render(); return; }
    if (b?.hasAttribute('data-flip')) { view.flip = !view.flip; render(); return; }
    const open = e.target.closest('[data-open]');
    if (open) openCoin(open.dataset.open);
  }, { signal: life.signal });
  root.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.ml-row[data-open]')) { e.preventDefault(); openCoin(e.target.dataset.open); }
    if (e.key === 'Enter' && e.target.matches?.('.ml-search input')) { e.preventDefault(); e.target.blur(); }
  }, { signal: life.signal });
  root.addEventListener('input', e => { if (e.target.matches('.ml-search input')) { view.query = e.target.value; clearTimeout(typing); typing = setTimeout(render, 120); } }, { signal: life.signal });
  document.addEventListener('ox:watchlist', () => { if (!root.contains(document.activeElement)) render(); }, { signal: life.signal });
  document.addEventListener('visibilitychange', syncQuotes, { signal: life.signal });
  // Rows follow the ticker refresh; a search being typed is left alone.
  const tick = () => { if (!document.hidden && root.isConnected && !(document.activeElement?.matches?.('.ml-search input') && root.contains(document.activeElement))) render(); };
  render();
  timer = setInterval(tick, 10000);
  return {
    mode: () => view.mode,
    setMode(next) { if (next === view.mode) return; view.mode = next; root.dataset.mode = next; render(); },
    refresh: render,
    suspend() { clearInterval(timer); timer = 0; quotes?.stop?.(); quotes = null; },
    resume() { if (!timer) timer = setInterval(tick, 10000); render(); },
    destroy() { clearInterval(timer); quotes?.stop?.(); life.abort(); root.remove(); }
  };
}
