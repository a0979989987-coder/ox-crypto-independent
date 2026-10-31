/* #view-radar holds three pages of the app, picked by switchAppView (view-home-theme.js):
 *   畫板 (view radar, mode board)     — the pattern board (src/markets/crypto/radar-board.js)
 *   型態 (view pattern, mode compare) — every 4H close's confirmed breakouts and how they
 *                                       moved (src/markets/crypto/radar-compare.js)
 *   個股 (view stock, mode chart)     — the K-line chart, quote card and coin details
 * #view-radar[data-radar-mode] is the single source of truth for CSS. The old 自選 tab
 * is 行情 → 自選 now. OXRadarModes.set(mode) opens the matching page, so older callers
 * (and the feature search) keep working.
 */
(() => {
  'use strict';
  const root = document.getElementById('view-radar');
  if (!root) return;
  const MODES = ['board', 'compare', 'chart'];
  const VIEW = { board: 'radar', compare: 'pattern', chart: 'stock' };
  let applied = null;

  const valid = mode => MODES.includes(mode);
  const current = () => valid(root.dataset.radarMode) ? root.dataset.radarMode : 'board';
  // The 個股 page drops the old side list: the chart is always full width with its drawing tools.
  root.classList.add('ox-scanner-collapsed');

  // 行情 → 圖表 (view chart) is the original radar page: the T1／T2／T3 list sits right of
  // the chart (analytics/entry.js moves it there). The arrow folds it away; the chart then
  // takes the width and shows its drawing tools and 全螢幕. The fold is remembered.
  const FOLD_KEY = 'ox-crypto:chart-list-folded';
  let folded = false; try { folded = localStorage.getItem(FOLD_KEY) === '1'; } catch {}
  let fade = null;
  function syncFold() {
    const onChart = document.body.dataset.view === 'chart', hidden = !onChart || folded;
    if (root.classList.contains('ox-scanner-collapsed') !== hidden) {
      root.classList.toggle('ox-scanner-collapsed', hidden);
      requestAnimationFrame(() => { try { window.resizeChartToContainer?.(true); } catch {} });
    }
    const panel = document.getElementById('radar-scanner-panel');
    if (panel && root.contains(panel)) { panel.setAttribute('aria-hidden', String(hidden)); panel.inert = hidden; }
    else if (panel) { panel.removeAttribute('aria-hidden'); panel.inert = false; }
    const toggle = document.getElementById('radar-scanner-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!hidden));
      toggle.setAttribute('aria-label', hidden ? '展開右側雷達' : '收起右側雷達');
      toggle.title = toggle.getAttribute('aria-label');
      toggle.querySelector('path')?.setAttribute('d', hidden ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7');
    }
    document.dispatchEvent(new CustomEvent('ox:radarvisibilitychange'));
    if (onChart) requestAnimationFrame(timeInView);
  }
  // Beside the list the time row is narrow: keep the chosen time (1D) in view.
  const strip = document.getElementById('chart-timeframe-strip');
  function timeInView() {
    const active = strip?.querySelector('.btn-tf.active');
    if (document.body.dataset.view !== 'chart' || !active || strip.scrollWidth <= strip.clientWidth + 1) return;
    const over = active.getBoundingClientRect().right - strip.getBoundingClientRect().right + 4;
    if (over > 0) strip.scrollLeft += over;
  }
  if (strip) {
    if ('ResizeObserver' in window) new ResizeObserver(() => requestAnimationFrame(timeInView)).observe(strip);
    new MutationObserver(() => requestAnimationFrame(timeInView)).observe(strip, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  document.addEventListener('click', event => {
    if (!event.target.closest?.('#radar-scanner-toggle') || document.body.dataset.view !== 'chart') return;
    folded = !folded;
    try { localStorage.setItem(FOLD_KEY, folded ? '1' : '0'); } catch {}
    fade?.cancel();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) fade = document.getElementById('chart')?.animate([{ opacity: .72 }, { opacity: 1 }], { duration: 620, easing: 'cubic-bezier(.22,.8,.22,1)' }) || null;
    syncFold();
  });
  // After the list has moved (analytics/entry.js listens to the same event first).
  document.addEventListener('ox:viewchange', () => { syncFold(); requestAnimationFrame(syncFold); });

  function apply() {
    const mode = current(), previous = applied;
    if (previous === mode) return;
    applied = mode;
    if (mode === 'chart') {
      // The chart was sized while hidden; fit it now.
      requestAnimationFrame(() => {
        if (current() !== 'chart') return;
        try { window.resizeChartToContainer?.(true); } catch {}
      });
    }
    document.dispatchEvent(new CustomEvent('ox:radar-modechange', { detail: { mode, previous } }));
  }

  // Any caller may ask for a mode; it opens that page. 'watch' opens 行情 → 自選.
  function set(mode) {
    if (mode === 'watch') { window.OXMarketTabs?.select('watch'); window.switchAppView?.('strength'); return true; }
    if (!valid(mode)) return false;
    if (document.body.dataset.view !== VIEW[mode]) window.switchAppView?.(VIEW[mode]);
    else if (root.dataset.radarMode !== mode) root.dataset.radarMode = mode;
    return true;
  }

  // The chart often loads while 個股 is hidden; the first time it shows at full width the
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

  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-radar-mode'] });
  window.OXRadarModes = Object.freeze({ get: current, set, modes: MODES.slice() });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
})();
