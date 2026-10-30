import { loadToolModule } from '../../components/load-tool-module.js?v=20261005-recovery20';
import { showToolLoadError } from '../../components/tool-load-error.js?v=20261005-recovery20';
// 型態 (it was 對比) is the second tab of the 畫板 dock view (#view-radar, data-radar-mode="compare"):
// earlier 4H closes' confirmed upward breakouts from the pattern board and how they moved
// afterwards. The view module (./compare/view.js) and the record (data/crypto-breakouts.json)
// load the first time the tab opens; the view is suspended while another tab or view is on
// screen, so its mini-chart requests stop and the list stays as it was.

// Opens a coin on the 盤面 tab at a timeframe: the same path as the board's cards
// (OXRadarModes + switchSymbol), with the chart's period set first so it loads once.
export function openOnChart(symbol, frame = '4H') {
  if (!symbol) return;
  const runtime = typeof state !== 'undefined' ? state : null, same = runtime?.symbol === symbol;
  const changed = typeof window.setChartPeriod === 'function' && window.setChartPeriod(frame, { load: false });
  window.OXRadarModes?.set('chart');
  window.switchSymbol?.(symbol);
  if (changed && same && typeof window.loadSymbolCandles === 'function') window.loadSymbolCandles(true);
  // From deep in the list, the chart starts at the top of the page.
  const radar = document.getElementById('view-radar');
  const top = radar ? radar.getBoundingClientRect().top + scrollY - 8 : 0;
  if (scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  requestAnimationFrame(() => {
    const toggle = document.getElementById('radar-scanner-toggle');
    if (!matchMedia('(max-width:720px)').matches && toggle?.getAttribute('aria-expanded') === 'true') toggle.click();
  });
}

const slot = document.getElementById('ox-radar-compare');
if (slot) {
  const radar = document.getElementById('view-radar');
  let host = null, view = null, pending = false, generation = 0, suspended = false;
  const visible = () => (document.body.dataset.market || 'crypto') === 'crypto'
    && document.body.dataset.view === 'radar'
    && radar?.dataset.radarMode === 'compare'
    && !document.body.classList.contains('ox-feature-blocked');

  async function mount() {
    if (pending) return;
    host?.remove();
    const mountHost = host = document.createElement('div');
    mountHost.className = 'ox-radar-compare-host';
    const loading = document.createElement('div');
    loading.className = 'ox-tool-loading';
    loading.innerHTML = window.OXLoading?.markup('型態載入中') || '型態載入中…';
    slot.replaceChildren(mountHost, loading);
    pending = true;
    const token = ++generation;
    const current = () => token === generation && visible();
    try {
      const { mountCompare } = await loadToolModule(new URL('./compare/view.js?v=20261031-home1', import.meta.url).href, { current });
      if (!current()) return;
      view = mountCompare(mountHost, { onOpen: (symbol, frame) => openOnChart(symbol, frame || '4H') });
      suspended = false;
      loading.remove();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.warn('[OX 型態]', error);
      if (token === generation) showToolLoadError(loading, error, () => { generation++; pending = false; view = null; sync(); });
    } finally {
      if (token === generation) pending = false;
      else if (!view) mountHost.remove();
    }
  }
  function sync() {
    if (!visible()) {
      if (pending && !view) { generation++; pending = false; }
      if (view && !suspended) { suspended = true; view.suspend(); }
      return;
    }
    if (view) { if (suspended) { suspended = false; view.resume(); } return; }
    mount();
  }
  for (const type of ['ox:viewchange', 'ox:radar-modechange', 'ox:marketchange', 'ox:feature-policy-ready']) document.addEventListener(type, () => requestAnimationFrame(sync));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (view && !suspended) { suspended = true; view.suspend(); } } else sync();
  });
  let blocked = document.body.classList.contains('ox-feature-blocked');
  new MutationObserver(() => {
    const now = document.body.classList.contains('ox-feature-blocked');
    if (now !== blocked) { blocked = now; sync(); }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.OXRadarCompare = Object.freeze({ refresh: () => view?.refresh(), open: openOnChart });
  sync();
}
