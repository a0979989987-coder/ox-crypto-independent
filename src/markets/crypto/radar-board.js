import { loadToolModule } from '../../components/load-tool-module.js?v=20261005-recovery20';
import { showToolLoadError } from '../../components/tool-load-error.js?v=20261005-recovery20';
// The pattern board is the first tab of the 畫板 dock view (#view-radar,
// data-radar-mode="board"). It used to be the 型態搜尋 tool under 指標; the
// same module is mounted here once and suspended while another tab or view is
// on screen, so drawings and results survive switching tabs.
const slot = document.getElementById('ox-radar-board');
if (slot) {
  const radar = document.getElementById('view-radar');
  let host = null, board = null, pending = false, generation = 0, suspended = false;
  const visible = () => (document.body.dataset.market || 'crypto') === 'crypto'
    && document.body.dataset.view === 'radar'
    && radar?.dataset.radarMode === 'board'
    && !document.body.classList.contains('ox-feature-blocked');

  function suspend() {
    if (board && !suspended) { suspended = true; board.suspend?.(); }
  }
  function destroy({ clearPrivate = false } = {}) {
    generation++; pending = false;
    if (board) { board.destroy?.(); if (clearPrivate) board.clearPrivateState?.(); }
    board = null; suspended = false; host?.remove(); host = null;
  }
  async function mount() {
    if (pending) return;
    // A destroyed board owns a spent shadow root, so each mount gets a fresh host.
    host?.remove();
    const mountHost = host = document.createElement('div');
    mountHost.className = 'ox-radar-board-host';
    const loading = document.createElement('div');
    loading.className = 'ox-tool-loading';
    loading.innerHTML = window.OXLoading?.markup('型態畫板載入中') || '型態畫板載入中…';
    slot.replaceChildren(mountHost, loading);
    pending = true;
    const token = ++generation;
    const current = () => token === generation && visible();
    try {
      const { mountPatternSearch } = await loadToolModule(new URL('./patterns/view.js?v=20261005-stable18', import.meta.url).href, { current });
      if (!current()) return;
      board = mountPatternSearch(mountHost, {
        onOpenRadar(symbol) {
          window.OXRadarModes?.set('chart');
          window.switchSymbol?.(symbol);
          // Desktop keeps the original behaviour: the chart opens wide.
          requestAnimationFrame(() => {
            const toggle = document.getElementById('radar-scanner-toggle');
            if (!matchMedia('(max-width:720px)').matches && toggle?.getAttribute('aria-expanded') === 'true') toggle.click();
          });
        }
      });
      suspended = false;
      loading.remove();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.warn('[OX pattern board]', error);
      if (token === generation) showToolLoadError(loading, error, () => { destroy(); sync(); });
    } finally {
      if (token === generation) pending = false;
      else if (!board) mountHost.remove();
    }
  }
  function sync() {
    if (!visible()) { if (pending && !board) { generation++; pending = false; } suspend(); return; }
    if (board) { if (suspended) { suspended = false; board.resume?.(); } return; }
    mount();
  }
  let accountId = window.OXAuth?.user?.id || null;
  document.addEventListener('ox:accountchange', () => {
    const next = window.OXAuth?.user?.id || null;
    if (next === accountId) return;
    accountId = next; destroy({ clearPrivate: true }); sync();
  });
  for (const type of ['ox:viewchange', 'ox:radar-modechange', 'ox:marketchange', 'ox:feature-policy-ready']) document.addEventListener(type, () => requestAnimationFrame(sync));
  // The access gate lifts by removing a body class, without an event.
  let blocked = document.body.classList.contains('ox-feature-blocked');
  new MutationObserver(() => {
    const now = document.body.classList.contains('ox-feature-blocked');
    if (now !== blocked) { blocked = now; sync(); }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  sync();
}
