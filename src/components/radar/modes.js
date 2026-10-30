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
