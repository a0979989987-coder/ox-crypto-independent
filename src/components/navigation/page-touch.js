// Keep single-finger scrolling while preventing mobile browser page zoom.
(() => {
  const preventZoom = event => { if (event.cancelable) event.preventDefault(); };
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(name, preventZoom, { passive: false });
  }
  document.addEventListener('touchmove', event => {
    if (event.touches.length > 1) preventZoom(event);
  }, { passive: false });
})();
