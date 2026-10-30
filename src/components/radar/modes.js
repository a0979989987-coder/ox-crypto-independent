/* 畫板 dock view: one page with four top tabs, like the Taiwan site.
 *   畫板 board — the pattern board (mounted by src/markets/crypto/radar-board.js)
 *   型態 compare — earlier 4H closes' confirmed breakouts and how they moved (was 對比)
 *                  (mounted by src/markets/crypto/radar-compare.js)
 *   盤面 chart — the K-line chart, quote card, T1/T2/T3 list and coin details
 *   自選 watch — the watchlist with a search box to star any USDT perpetual
 * #view-radar[data-radar-mode] is the single source of truth; CSS shows the
 * matching panes. The last tab is remembered on this device.
 */
(() => {
  'use strict';
  const root = document.getElementById('view-radar');
  if (!root) return;
  const MODES = ['board', 'compare', 'chart', 'watch'];
  const KEY = 'ox-radar-mode';
  const rail = root.querySelector('.ox-radar-mode-rail');
  const tabs = rail ? [...rail.querySelectorAll('[data-radar-tab]')] : [];
  let applied = null;

  const valid = mode => MODES.includes(mode);
  const current = () => valid(root.dataset.radarMode) ? root.dataset.radarMode : 'board';

  try {
    const saved = localStorage.getItem(KEY);
    if (valid(saved)) root.dataset.radarMode = saved;
  } catch {}

  function position() {
    if (!rail) return;
    const active = tabs.find(tab => tab.dataset.radarTab === current());
    if (!active || !active.offsetWidth) return;
    rail.style.setProperty('--mode-x', `${active.offsetLeft}px`);
    rail.style.setProperty('--mode-width', `${active.offsetWidth}px`);
  }

  function apply() {
    const mode = current(), previous = applied;
    tabs.forEach(tab => {
      const on = tab.dataset.radarTab === mode;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    position();
    if (previous === mode) return;
    applied = mode;
    if (mode === 'chart') {
      // The chart was sized while hidden; fit it and refresh the list now.
      requestAnimationFrame(() => {
        if (current() !== 'chart') return;
        try { window.resizeChartToContainer?.(true); } catch {}
        try { if (state.activeView === 'radar') renderCurrentTab(); } catch {}
      });
    }
    if (mode === 'watch') renderWatch();
    syncQuotes();
    document.dispatchEvent(new CustomEvent('ox:radar-modechange', { detail: { mode, previous } }));
  }

  // Any caller may request a tab; feature access follows the visible tab.
  function set(mode, { focus = false, persist = true } = {}) {
    if (!valid(mode)) return false;
    if (root.dataset.radarMode !== mode) root.dataset.radarMode = mode;
    if (persist) { try { localStorage.setItem(KEY, mode); } catch {} }
    apply();
    if (focus) tabs.find(tab => tab.dataset.radarTab === mode)?.focus({ preventScroll: true });
    if (window.OXFeatures?.ready && document.body.dataset.view === 'radar') window.OXFeatures.enterView('radar');
    return true;
  }

  // The chart often loads while 盤面 is hidden; the first time it shows at full width the
  // latest candle is re-anchored with the usual drawing room. Later visits keep the user's pan.
  const chartEl = document.getElementById('chart');
  if (chartEl && 'ResizeObserver' in window) {
    const firstShow = new ResizeObserver(entries => {
      if (!entries.some(entry => entry.contentRect.width > 0)) return;
      firstShow.disconnect();
      if (typeof state !== 'undefined' && state.chart) requestAnimationFrame(() => window.applyChartFutureSpace?.(true));
    });
    firstShow.observe(chartEl);
  }

  rail?.addEventListener('click', event => {
    const tab = event.target.closest('[data-radar-tab]');
    if (!tab || tab.dataset.radarTab === current()) return;
    set(tab.dataset.radarTab);
    // A tab change starts at the top of the page when the rail is off screen.
    const top = root.getBoundingClientRect().top + scrollY - 8;
    if (scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  });
  rail?.addEventListener('keydown', event => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length];
    set(tab.dataset.radarTab, { focus: true });
  });
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-radar-mode'] });
  if (rail) new ResizeObserver(position).observe(rail);
  window.addEventListener('resize', position, { passive: true });
  document.addEventListener('ox:viewchange', event => {
    if (event.detail?.to !== 'radar') { syncQuotes(); return; }
    requestAnimationFrame(position);
    if (current() === 'watch') renderWatch();
    syncQuotes();
  });

  /* ---- 自選: watchlist and search ---- */
  const watch = document.getElementById('ox-radar-watch');
  const input = document.getElementById('ox-watch-input');
  const list = document.getElementById('ox-watch-list');
  const count = document.getElementById('ox-watch-count');
  let quotes = null;
  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>';
  const base = symbol => String(symbol).replace(/USDT$/, '');
  const records = () => { try { return getWatchlistRecords().filter(rec => typeof isCryptoSymbolAllowed !== 'function' || isCryptoSymbolAllowed(rec.symbol)); } catch { return []; } };
  const tickerFor = symbol => {
    const live = globalThis.OXCryptoQuotes?.get(symbol);
    if (live) return live;
    try { return state.tickers.find(t => t.symbol === symbol) || null; } catch { return null; }
  };
  function universe() {
    try { return state.tickers.filter(t => t?.symbol && (typeof isCryptoSymbolAllowed !== 'function' || isCryptoSymbolAllowed(t.symbol))); } catch { return []; }
  }
  // Exact symbol first, then prefix, then contains; at most 30 rows.
  function search(term) {
    const needle = term.replace(/[\s/]+/g, '').toUpperCase().replace(/USDT$/, '');
    if (!needle) return [];
    const rank = t => { const b = base(t.symbol); return b === needle ? 0 : b.startsWith(needle) ? 1 : 2; };
    return universe().filter(t => base(t.symbol).includes(needle) || t.symbol.includes(needle))
      .sort((a, b) => rank(a) - rank(b) || Number(b.usdtVolume || 0) - Number(a.usdtVolume || 0)).slice(0, 30);
  }
  function row(symbol, starred) {
    const ticker = tickerFor(symbol);
    const change = Number(ticker?.change24h ?? NaN);
    const item = document.createElement('div');
    item.className = 'ox-watch-row';
    item.dataset.symbol = symbol;
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.setAttribute('aria-label', `${base(symbol)}，開啟盤面`);
    const logo = typeof createCoinLogo === 'function' ? createCoinLogo(symbol) : document.createElement('span');
    const main = document.createElement('span'); main.className = 'ox-watch-main';
    const name = document.createElement('strong'); name.textContent = base(symbol);
    const sub = document.createElement('small'); sub.textContent = ticker ? `24H 成交額 ${fmtCryptoVolume(ticker.usdtVolume)} USDT` : '等待行情';
    main.append(name, sub);
    const quote = document.createElement('span'); quote.className = 'ox-watch-quote';
    const price = document.createElement('strong'); price.textContent = ticker ? fmtPrice(ticker.lastPr) : '—';
    const pct = document.createElement('span'); pct.textContent = Number.isFinite(change) ? fmtPct(change) : '—';
    if (Number.isFinite(change)) pct.className = change >= 0 ? 'positive' : 'negative';
    quote.append(price, pct);
    const star = document.createElement('button');
    star.type = 'button';
    star.className = `watch-star ox-watch-star${starred ? ' is-starred' : ''}`;
    star.dataset.watchSymbol = symbol;
    star.setAttribute('aria-pressed', String(starred));
    star.setAttribute('aria-label', `${starred ? '移除' : '加入'} ${base(symbol)} 自選`);
    star.innerHTML = STAR;
    item.append(logo, main, quote, star);
    return item;
  }
  function empty(text) { const box = document.createElement('div'); box.className = 'ox-watch-empty'; box.textContent = text; return box; }
  function renderWatch() {
    if (!list) return;
    const saved = records(), term = input?.value.trim() || '';
    if (count) count.textContent = String(saved.length);
    const starred = new Set(saved.map(rec => rec.symbol));
    if (term) {
      const rows = search(term);
      list.replaceChildren(...(rows.length ? rows.map(t => row(t.symbol, starred.has(t.symbol))) : [empty(universe().length ? `找不到「${term}」，請輸入幣種代號，例如 BTC、ETH。` : '正在取得幣種清單…')]));
    } else {
      list.replaceChildren(...(saved.length ? saved.map(rec => row(rec.symbol, true)) : [empty('尚未加入自選。在上方搜尋幣種，點星星即可加入。')]));
    }
    syncQuotes();
  }
  // Live prices for the rows on screen, from the shared quote connection.
  function syncQuotes() {
    const on = !!list && current() === 'watch' && document.body.dataset.view === 'radar' && !document.hidden;
    const symbols = on ? [...list.querySelectorAll('.ox-watch-row')].map(el => el.dataset.symbol).slice(0, 60) : [];
    if (!symbols.length) { quotes?.stop?.(); quotes = null; return; }
    if (quotes) { quotes.update(symbols); return; }
    quotes = globalThis.OXCryptoQuotes?.subscribe(symbols, rows => {
      for (const quote of rows) {
        const item = list.querySelector(`.ox-watch-row[data-symbol="${CSS.escape(quote.symbol)}"]`);
        if (!item) continue;
        item.querySelector('.ox-watch-quote strong').textContent = fmtPrice(quote.lastPr);
        const pct = item.querySelector('.ox-watch-quote span');
        pct.textContent = fmtPct(quote.change24h);
        pct.className = Number(quote.change24h) >= 0 ? 'positive' : 'negative';
        item.querySelector('.ox-watch-main small').textContent = `24H 成交額 ${fmtCryptoVolume(quote.usdtVolume)} USDT`;
      }
    }) || null;
  }
  let typing = 0;
  input?.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(renderWatch, 120); });
  input?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
  function open(item) {
    const symbol = item?.dataset.symbol;
    if (!symbol) return;
    set('chart');
    if (typeof switchSymbol === 'function') switchSymbol(symbol);
  }
  list?.addEventListener('click', event => {
    if (event.target.closest('[data-watch-symbol]')) { setTimeout(renderWatch, 0); return; }
    open(event.target.closest('.ox-watch-row'));
  });
  list?.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.classList?.contains('ox-watch-row')) { event.preventDefault(); open(event.target); }
  });
  // Stars toggled anywhere (盤面 list included) update the count and rows.
  const badge = document.getElementById('badge-watch');
  if (badge) new MutationObserver(() => { if (current() === 'watch') renderWatch(); else if (count) count.textContent = String(records().length); }).observe(badge, { childList: true, characterData: true, subtree: true });
  document.addEventListener('ox:accountchange', () => { if (current() === 'watch') renderWatch(); });
  document.addEventListener('visibilitychange', syncQuotes);
  // The ticker universe arrives after the first paint; refresh an open search.
  setInterval(() => { if (watch && current() === 'watch' && document.body.dataset.view === 'radar' && !document.hidden && (input?.value.trim() || !quotes)) renderWatch(); }, 15000);

  window.OXRadarModes = Object.freeze({ get: current, set, modes: MODES.slice() });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
})();
