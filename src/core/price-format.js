/* Coin prices, one way everywhere (lists, 個股頁, cards, chart axis, share pictures).
 *
 * Prices run from 100,000 down to 0.0000001. Like the exchanges, a price with three or
 * more zeros after the point shows how many zeros as a small number:
 *   0.0008023   → 0.0₃8023      0.0000049651 → 0.0₅4965
 * Larger prices keep their usual decimals: 77,954.9 · 2,271.4 · 1.2541 · 0.042318.
 *
 * Loaded as a plain script (index.html, before src/core/runtime-config.js) and imported for
 * its side effect by modules; both read globalThis.OXPriceText.
 */
(function () {
  'use strict';
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  const sub = n => String(n).split('').map(d => SUB[+d]).join('');
  // value → text. sig: significant digits kept after the zeros (4 like the exchanges).
  function priceText(value, { sig = 4, empty = '—', zero = '—', grouping = true } = {}) {
    const x = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
    if (!Number.isFinite(x)) return empty;
    if (x === 0) return zero;
    const a = Math.abs(x), sign = x < 0 ? '-' : '';
    if (a < 0.001) {
      const zeros = Math.floor(-Math.log10(a)); // zeros between the point and the first digit
      const fixed = a.toFixed(Math.min(20, zeros + sig));
      const m = /^0\.(0*)(\d+)$/.exec(fixed);
      if (m && m[1].length >= 3) return `${sign}0.0${sub(m[1].length)}${m[2].slice(0, sig).replace(/0+$/, '') || '0'}`;
    }
    const digits = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8;
    return sign + a.toLocaleString('en-US', { maximumFractionDigits: digits, useGrouping: grouping });
  }
  globalThis.OXPriceText = priceText;
})();
