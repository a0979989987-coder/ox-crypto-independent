// Old page, new files. A phone can show a page it kept from an earlier visit (Safari restores
// tabs and history from its own copy) while the CSS and JS it asks for come from the newest
// deploy; the page then pairs old markup with new styles (the 首頁 tiles fell apart into rows
// of 「—」). Every page carries the mark of the file versions it was built with
// (<meta name="ox-build">, written by scripts/asset-versions.mjs). This asks the server for
// the current page, past the cache, and when its mark differs the page reloads once, so it
// always runs with the files it was made for. It asks again when the page comes back from the
// back/forward cache or after a long time in the background. A failed check changes nothing.
(() => {
  const mine = document.querySelector('meta[name="ox-build"]')?.content || '';
  if (!globalThis.fetch || !/^https?:$/.test(location.protocol)) return;
  const KEY = 'ox-build-reload';
  let busy = false;
  async function check() {
    if (busy) return; busy = true;
    try {
      const response = await fetch(location.pathname, { cache: 'no-cache', credentials: 'same-origin' });
      if (!response.ok) return;
      const live = /<meta\s+name="ox-build"\s+content="([^"]*)"/i.exec(await response.text())?.[1];
      if (!live || live === mine) { try { sessionStorage.removeItem(KEY); } catch {} return; }
      // One reload per new build: if the browser still hands back the old page, stop there.
      let tried = null; try { tried = sessionStorage.getItem(KEY); sessionStorage.setItem(KEY, live); } catch {}
      if (tried === live) return;
      location.reload();
    } catch {} finally { busy = false; }
  }
  globalThis.OXFreshHTML = { check, build: mine };
  check();
  addEventListener('pageshow', event => { if (event.persisted) check(); });
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 10 * 60 * 1000) check();
  });
})();
