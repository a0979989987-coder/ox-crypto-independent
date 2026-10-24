/* First-screen stylesheet policy (deferred: runs after every head stylesheet
 * has loaded or failed, and before DOMContentLoaded applies the saved theme).
 * 1. A core stylesheet that failed is retried once in place (same cascade
 *    position, ?retry=1), instead of leaving the page unstyled.
 * 2. Light-theme-only sheets (every rule is scoped to body.theme-light) are
 *    fetched without blocking first paint (media="not all") and switched on
 *    only while the light theme is active. */
(() => {
  if (globalThis.OXStyleBoot) return;
  // An HTTP error or a non-CSS response still leaves an empty sheet in Chrome,
  // so a core stylesheet without any rule counts as failed.
  const failed = link => { try { return !link.sheet || link.sheet.cssRules.length === 0; } catch { return false; } };
  function retry(link) {
    if (!link.isConnected || link.dataset.oxRetried || !link.getAttribute('href')) return;
    const next = link.cloneNode();
    const url = new URL(link.href, location.href); url.searchParams.set('retry', '1');
    next.href = url.href; next.dataset.oxRetried = '1';
    next.setAttribute('blocking', 'render');
    next.addEventListener('load', () => link.remove(), { once: true });
    link.after(next);
  }
  addEventListener('error', event => {
    const link = event.target;
    // Lazily loaded sheets (data-ox-lazy-css) retry through their own loader.
    if (link instanceof HTMLLinkElement && link.rel === 'stylesheet' && !link.dataset.oxLazyCss) retry(link);
  }, true);
  for (const link of document.querySelectorAll('link[rel="stylesheet"][href]')) if (link.media !== 'not all' && failed(link)) retry(link);

  const lightSheets = () => document.querySelectorAll('link[data-ox-theme-css="light"]');
  const savedLight = () => {
    try {
      const mode = localStorage.getItem('ox-ui-theme');
      return mode === 'light' || mode === 'system' && matchMedia('(prefers-color-scheme: light)').matches;
    } catch { return false; }
  };
  function sync(light) {
    for (const link of lightSheets()) {
      const media = light ? 'all' : 'not all';
      if (link.media !== media) link.media = media;
    }
  }
  // Before the shell applies the saved theme on DOMContentLoaded.
  sync(document.body?.classList.contains('theme-light') || savedLight());
  // applyThemeNow toggles body.theme-light and then dispatches ox:themechange.
  document.addEventListener('ox:themechange', event => sync(event.detail?.resolved === 'light' || document.body.classList.contains('theme-light')));
  const watch = () => new MutationObserver(() => sync(document.body.classList.contains('theme-light'))).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch, { once: true });
  globalThis.OXStyleBoot = Object.freeze({ retry, sync });
})();
