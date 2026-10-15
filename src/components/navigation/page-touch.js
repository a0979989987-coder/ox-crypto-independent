// Page pinch-zoom stays available for reading (accessibility). A two-finger
// gesture is only kept from zooming the page where it belongs to the app:
// charts, canvases and the fixed header/dock. One-finger scrolling stays native.
(() => {
  const ZONES = 'canvas,#chart,.chart-container,.btc-premium-chart-wrap,.ox-home-preview-chart,.app-dock,.ox-shell-header,[data-ox-no-zoom]';
  const inZone = event => (event.composedPath?.() || [event.target]).some(node => typeof node?.matches === 'function' && node.matches(ZONES));
  const keepInApp = event => { if (event.cancelable && inZone(event)) event.preventDefault(); };
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(name, keepInApp, { passive: false });
  }
  document.addEventListener('touchmove', event => {
    if (event.touches.length > 1) keepInApp(event);
  }, { passive: false });
})();
