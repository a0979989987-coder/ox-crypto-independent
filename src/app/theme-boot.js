/* Theme boot — runs synchronously at the top of <head>, before first paint.
 * Midnight Ink (午夜墨) is a colour layer over the dark theme. Its stylesheet is
 * written into <head> here only for viewers who chose it, as a parser-inserted
 * (render-blocking) link, so the first paint is already Midnight Ink and the
 * other themes never download it. Every rule in it is scoped to
 * html.theme-midnight, so the sheet stays inert until that class is set.
 * Also keeps <meta name="theme-color"> in step with the active palette. */
(() => {
  if (globalThis.OXTheme) return;
  const KEY = 'ox-ui-theme', MODES = ['dark', 'light', 'midnight', 'system'];
  const MIDNIGHT_CSS = 'src/styles/themes/midnight-ink.css?v=20261015-midnight1';
  const MIDNIGHT_TOOLS_CSS = 'src/styles/themes/midnight-ink-tools.css?v=20261015-midnight1';
  const BAR = { dark: '#121417', light: '#ffffff', midnight: '#0a0e16' };
  // Chart colours shared by every lightweight-charts instance (main K-line, home preview).
  const CHART = {
    dark: { bg: '#121417', text: '#929995', grid: '#202725', border: '#343b37', label: '#4c525e', level: '#eee7df', up: '#00b8d4', down: '#ff3078' },
    light: { bg: '#ffffff', text: '#616d7c', grid: 'rgba(148,163,184,.16)', border: '#d7dee7', label: '#8d712e', level: '#8d712e', up: '#4598df', down: '#e86480' },
    midnight: { bg: '#0f1520', text: '#a9b0bc', grid: 'rgba(226,232,240,.06)', border: 'rgba(226,232,240,.16)', label: '#2a3447', level: '#d9c79a', up: '#00b8d4', down: '#ff3078' },
  };
  const root = document.documentElement;
  const prefersLight = () => { try { return matchMedia('(prefers-color-scheme: light)').matches; } catch { return false; } };
  function saved() {
    try { const mode = localStorage.getItem(KEY); return MODES.includes(mode) ? mode : 'dark'; } catch { return 'dark'; }
  }
  // palette: 'dark' | 'light' | 'midnight'; resolved: the light/dark base it builds on.
  function resolve(mode = saved()) {
    const palette = mode === 'system' ? (prefersLight() ? 'light' : 'dark') : MODES.includes(mode) ? mode : 'dark';
    return { mode, palette, resolved: palette === 'light' ? 'light' : 'dark' };
  }
  function current() {
    return document.body?.classList.contains('theme-light') ? 'light' : root.classList.contains('theme-midnight') ? 'midnight' : 'dark';
  }
  function setBarColor(palette) {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
    meta.content = BAR[palette] || BAR.dark;
  }
  let pending = null;
  // Resolves true once the Midnight Ink sheet is usable (false when it failed).
  function loadMidnight() {
    let link = document.querySelector('link[data-ox-theme-css="midnight"]');
    if (link && !pending) { try { if (link.sheet && link.sheet.cssRules.length) return Promise.resolve(true); } catch {} }
    if (pending) return pending;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = MIDNIGHT_CSS;
      link.dataset.oxThemeCss = 'midnight'; link.dataset.oxLazyCss = 'midnight';
      document.head.append(link);
    }
    pending = new Promise(done => {
      const finish = ok => { pending = null; if (!ok) link.remove(); done(ok); };
      link.addEventListener('load', () => { let ok = false; try { ok = !!link.sheet?.cssRules.length; } catch { ok = true; } finish(ok); }, { once: true });
      link.addEventListener('error', () => finish(false), { once: true });
    });
    return pending;
  }
  const initial = resolve();
  root.dataset.oxThemeMode = initial.mode;
  if (initial.palette === 'midnight') {
    root.classList.add('theme-midnight');
    if (document.readyState === 'loading') document.write(`<link rel="stylesheet" href="${MIDNIGHT_CSS}" data-ox-theme-css="midnight" data-ox-lazy-css="midnight">`);
    else loadMidnight();
  }
  setBarColor(initial.palette);
  globalThis.OXTheme = Object.freeze({
    KEY, MODES, MIDNIGHT_TOOLS_CSS, saved, resolve, current, loadMidnight, setBarColor,
    chart: (palette = current()) => CHART[palette] || CHART.dark,
  });
})();
