/* Coin logos and flicker-free list updates, shared by every list on the site.
 *
 * OXCoinLogo: the coin's own artwork from OX_COIN_LOGOS (src/app/token-logos.js, built by
 * scripts/collect-token-logos.mjs and served from this site), else its first two letters.
 * Each picture is downloaded and decoded once and kept, so a row drawn again shows it in
 * the same frame instead of blinking through the letters.
 *
 * OXPatchHTML(container, html): lists here are written as HTML strings. Assigning
 * innerHTML on every price tick threw every row away, and each new <img> blinked while it
 * decoded again. This keeps the nodes that are still there (rows are matched by
 * data-symbol, data-open, data-coin or data-key), changes only the attributes and text
 * that differ, and moves rows when the order changes, so pictures, focus, a held touch
 * and the scroll position stay put.
 */
(() => {
  'use strict';
  const MULTIPLIER = /^(?:1000000|100000|10000|1000|100|1M)(?=[A-Z])/;
  const failed = new Set(), kept = new Map();
  const base = symbol => String(symbol || '').toUpperCase().replace(/[-_]?USDT$/, '');
  function src(symbol) {
    let map; try { map = typeof OX_COIN_LOGOS !== 'undefined' ? OX_COIN_LOGOS : null; } catch { map = null; }
    if (!map) return null;
    const b = base(symbol).toLowerCase(), path = map[b] || map[b.replace(/^(?:1000000|100000|10000|1000|100|1m)(?=[a-z])/, '')] || null;
    return path && !failed.has(path) ? path : null;
  }
  // Keep one decoded copy of each picture for as long as the page lives (about 3 KB each).
  function warm(path) {
    if (!path || kept.has(path)) return;
    const img = new Image(); img.decoding = 'async'; img.src = path; kept.set(path, img);
    img.onerror = () => { failed.add(path); };
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const letters = symbol => base(symbol).replace(MULTIPLIER, '').slice(0, 2);
  // <span class="cls">AB<img></span>: the letters show only when there is no picture (app-shell.css).
  function html(symbol, { cls = 'ox-coin-logo', size = 30 } = {}) {
    const path = src(symbol); warm(path);
    return `<span class="${esc(cls)} ox-logo${path ? ' has-img' : ''}" aria-hidden="true">${esc(letters(symbol))}${path ? `<img src="${esc(path)}" alt="" width="${size}" height="${size}" decoding="sync" draggable="false" onerror="OXCoinLogo.fail(this)">` : ''}</span>`;
  }
  function element(symbol, options) {
    const t = document.createElement('template'); t.innerHTML = html(symbol, options); return t.content.firstElementChild;
  }
  // A picture that does not load is dropped from now on; the letters stay.
  function fail(img) {
    const path = img?.getAttribute?.('src'); if (path) failed.add(path);
    img?.parentElement?.classList.remove('has-img'); img?.remove();
  }
  globalThis.OXCoinLogo = Object.freeze({ src, html, element, fail, warm, has: symbol => !!src(symbol) });

  // ---------- OXPatchHTML ----------
  const KEYS = ['data-symbol', 'data-open', 'data-coin', 'data-home-symbol', 'data-key'];
  function keyOf(node) {
    if (node.nodeType !== 1) return null;
    for (const k of KEYS) { const v = node.getAttribute(k); if (v != null) return node.nodeName + '|' + k + '=' + v; }
    return null;
  }
  function morph(from, to) {
    if (from.nodeType !== 1) { if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue; return; }
    for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
    for (const { name, value } of to.attributes) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
    if (from.nodeName === 'INPUT' && from !== document.activeElement && from.value !== to.value) from.value = to.value;
    children(from, to);
  }
  function children(from, to) {
    const old = [...from.childNodes], keyed = new Map(), loose = [];
    for (const n of old) { const k = keyOf(n); if (k == null) loose.push(n); else if (!keyed.has(k)) keyed.set(k, n); }
    const used = new Set(), next = [];
    let li = 0;
    for (const n of [...to.childNodes]) {
      const k = keyOf(n); let match = null;
      if (k != null) { const c = keyed.get(k); if (c && !used.has(c)) match = c; }
      else { const c = loose[li]; if (c && c.nodeName === n.nodeName && c.nodeType === n.nodeType) { match = c; li++; } }
      if (match) { used.add(match); morph(match, n); next.push(match); } else next.push(n);
    }
    for (const n of old) if (!used.has(n)) n.remove();
    next.forEach((n, i) => { if (from.childNodes[i] !== n) from.insertBefore(n, from.childNodes[i] || null); });
  }
  const parser = document.createElement('template');
  globalThis.OXPatchHTML = function patchHTML(container, markup) {
    if (!container) return;
    parser.innerHTML = markup;
    if (!container.firstChild) { container.append(parser.content); return; }
    children(container, parser.content);
    parser.innerHTML = '';
  };
})();
