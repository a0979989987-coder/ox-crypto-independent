// Swipe left or right to move between tabs, as on the Taiwan site. A swipe
// that starts in the top 35% of the screen moves the page's top tab row
// (the 行情 tabs, 每 4 小時突破／長期勝率／過去紀錄, 行事曆／關鍵新聞); one that starts
// in the lower 65% moves the dock views (首頁, 行情, 畫板, 型態, 資訊). A swipe counts
// when it is a quick flick or a long drag and clearly horizontal, and never
// when it starts on content that handles its own gestures: the K-line chart,
// the pattern board canvas, bubbles, the heatmap, inputs, dialogs and rows
// that scroll sideways.
export const ORDER = ['home', 'strength', 'radar', 'pattern', 'data'];
export const TOP_ZONE = 0.35;
const EDGE = 20, DIRECTION_RATIO = 1.6;
const FLICK_DISTANCE = 60, FLICK_SPEED = 0.3, DRAG_DISTANCE = 120, MAX_TIME = 900;
const OWN_GESTURES = 'input,textarea,select,[contenteditable],canvas,.chart-container,.chart-box,dialog,[role="dialog"],[role="menu"],.oxn-modal-backdrop,.oxn-popover,.ox-control-overlay,.chart-tools-overlay,#ox-account-overlay,#ox-market-quick-switch,.app-dock,.oc-drawer,.oc-sheet,.ox-stock-bar';
// Layers drawn over the page keep every swipe to themselves.
const OVERLAYS = 'dialog[open],.oxn-modal-backdrop,.oxn-popover.is-open,.chart-tools-overlay.is-open,#ox-account-overlay.is-open,#radar-tier-menu:not([hidden]),#ox-provider-backdrop.show';
const BUSY_BODY = ['ox-control-open', 'ox-mqs-open', 'ox-mqs-dragging', 'chart-focus', 'ox-feature-blocked', 'oc-drawer-open'];

export function isSwipe(dx, dy, elapsed) {
  const distance = Math.abs(dx);
  if (distance < Math.abs(dy) * DIRECTION_RATIO || elapsed > MAX_TIME) return false;
  return distance >= DRAG_DISTANCE || distance >= FLICK_DISTANCE && distance / Math.max(elapsed, 1) >= FLICK_SPEED;
}
export const zoneFor = (y, height) => y < height * TOP_ZONE ? 'tabs' : 'dock';
// Next dock view for a swipe; a finger moving left (dx < 0) goes forward.
export function neighbor(view, direction) {
  // 行情 → 圖表 (view chart) sits at 行情's place.
  const index = ORDER.indexOf(view === 'chart' ? 'strength' : view);
  return index < 0 ? null : ORDER[index + direction] || null;
}

function handlesOwnGesture(path) {
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    if (node.matches(OWN_GESTURES)) return true;
    const style = getComputedStyle(node);
    if (style.touchAction === 'none') return true;
    if (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 2) return true;
    if (node === document.body) break;
  }
  return false;
}

// The visible top tab row of the current page: the tab rows live inside their
// shadow roots. The highest one on screen wins.
function topRail() {
  const roots = [document, ...[...document.querySelectorAll('*')].filter(el => el.shadowRoot).map(el => el.shadowRoot)];
  let best = null;
  for (const root of roots) for (const rail of root.querySelectorAll('.ox-radar-mode-rail,.ox-mode-rail')) {
    const rect = rail.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
    if (!best || rect.top < best.rect.top) best = { rail, rect };
  }
  return best?.rail || null;
}
function moveTopRail(direction) {
  const rail = topRail(); if (!rail) return false;
  const buttons = [...rail.querySelectorAll('button')].filter(b => !b.hidden && !b.disabled && b.getClientRects().length);
  const index = buttons.findIndex(b => b.classList.contains('active') || b.getAttribute('aria-selected') === 'true');
  const next = buttons[index + direction];
  if (index < 0 || !next) return false;
  next.click(); return true;
}

function playIn(direction) {
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const main = document.querySelector('main');
  if (!main) return;
  main.classList.remove('ox-swipe-in-next', 'ox-swipe-in-prev');
  void main.offsetWidth;
  main.classList.add(direction > 0 ? 'ox-swipe-in-next' : 'ox-swipe-in-prev');
  main.addEventListener('animationend', () => main.classList.remove('ox-swipe-in-next', 'ox-swipe-in-prev'), { once: true });
}
function moveDock(direction) {
  const next = neighbor(document.body.dataset.view, direction);
  if (!next || typeof window.switchAppView !== 'function') return false;
  // Dock buttons own their entry work (資訊 opens the news workspace); the
  // 畫板 button ignores synthetic clicks, so it switches directly.
  const button = next === 'radar' ? null : document.querySelector(`.app-dock .dock-btn[data-view-target="${next}"]`);
  if (button) button.click(); else window.switchAppView(next);
  if (document.body.dataset.view !== next) return false;
  playIn(direction); return true;
}

let start = null;
if (typeof document !== 'undefined') {
  document.addEventListener('touchstart', event => {
    start = null;
    if (event.touches.length !== 1 || BUSY_BODY.some(name => document.body.classList.contains(name)) || document.querySelector(OVERLAYS)) return;
    const touch = event.touches[0];
    // Screen edges belong to the browser's back and forward gestures.
    if (touch.clientX < EDGE || touch.clientX > innerWidth - EDGE) return;
    if (handlesOwnGesture(event.composedPath())) return;
    start = { x: touch.clientX, y: touch.clientY, time: performance.now(), zone: zoneFor(touch.clientY, innerHeight) };
  }, { passive: true });

  document.addEventListener('touchmove', event => {
    // A second finger turns the gesture into something else.
    if (start && event.touches.length > 1) start = null;
  }, { passive: true });

  document.addEventListener('touchend', event => {
    if (!start) return;
    const touch = event.changedTouches[0], dx = touch.clientX - start.x, dy = touch.clientY - start.y, elapsed = performance.now() - start.time, zone = start.zone;
    start = null;
    if (!isSwipe(dx, dy, elapsed)) return;
    const direction = dx < 0 ? 1 : -1;
    if (zone === 'tabs') moveTopRail(direction); else moveDock(direction);
  }, { passive: true });

  document.addEventListener('touchcancel', () => { start = null; }, { passive: true });
}
