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
// Pages saved before the build mark (2026-11-01) have no fresh-page check of their own. A page
// restored from such a copy loads it here (src/app/fresh-html.js) and reloads itself once.
(() => {
  if (typeof document.querySelector !== 'function' || globalThis.OXFreshHTML || document.querySelector('meta[name="ox-build"]')) return;
  const script = document.createElement('script'); script.src = 'src/app/fresh-html.js?v=20261101-v7'; script.async = true;
  (document.head || document.documentElement).append(script);
})();
