// Midnight Ink colour layer generator (shared by the build script and its test).
//
// The dark theme is spread over ~50 historical stylesheets with hard-coded
// colours. Instead of hand-copying hundreds of selectors, every colour-bearing
// declaration that applies to the dark theme is cloned under `.theme-midnight`
// and its neutral greys are re-mapped onto the Midnight Ink tokens.
//
// Cascade safety: each clone gets exactly one extra class of specificity
// (0,1,0) and keeps its source order, and *every* declaration of a cloned
// property family is cloned (even when its value does not change). The clone
// of the original winner therefore always wins again, so the dark layout is
// reproduced exactly and only the colours move to the new palette.

export const FAMILIES = [
  /^background(?:-color|-image)?$/, /^background-/, /^border(?!.*radius)(?!-spacing|-collapse)/,
  /^outline/, /^column-rule/, /^color$/, /^-webkit-text-fill-color$/, /^caret-color$/,
  /^accent-color$/, /^fill$/, /^stroke$/, /^text-decoration/, /^box-shadow$/, /^text-shadow$/,
  /^scrollbar-color$/, /^stop-color$/, /^-webkit-tap-highlight-color$/,
];

// Token palette (identical in the Taiwan independent site).
export const TOKENS = {
  bg: [10, 14, 22], s1: [15, 21, 32], s2: [21, 28, 41], s3: [27, 36, 51],
  ink: [236, 231, 222], ink2: [169, 176, 188], ink3: [110, 118, 133],
  accent: [217, 199, 154], haze: [226, 232, 240], shade: [3, 6, 12],
};
const TOKEN_VAR = { bg: '--mi-bg', s1: '--mi-surface-1', s2: '--mi-surface-2', s3: '--mi-surface-3', ink: '--mi-ink', ink2: '--mi-ink-2', ink3: '--mi-ink-3', accent: '--mi-accent' };

// ---------- CSS parsing ----------
function stripComments(css) {
  let out = '', i = 0, quote = null;
  while (i < css.length) {
    const c = css[i];
    if (quote) { out += c; if (c === '\\') { out += css[i + 1] ?? ''; i += 2; continue; } if (c === quote) quote = null; i++; continue; }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === '/' && css[i + 1] === '*') { const end = css.indexOf('*/', i + 2); i = end < 0 ? css.length : end + 2; continue; }
    out += c; i++;
  }
  return out;
}
// Split on a delimiter that is outside strings, (), [] and {}.
export function splitTop(text, delimiter) {
  const parts = []; let depth = 0, quote = null, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === delimiter && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}
function matchBrace(css, open) {
  let depth = 0, quote = null;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return css.length;
}
const GROUPING = /^@(media|supports|container|layer)\b/i;
export function parseCss(source) {
  const css = stripComments(source);
  function block(text) {
    const nodes = []; let i = 0;
    while (i < text.length) {
      // find next '{' or ';' at top level
      let j = i, quote = null, depth = 0;
      for (; j < text.length; j++) {
        const c = text[j];
        if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (depth === 0 && (c === '{' || c === ';' || c === '}')) break;
      }
      if (j >= text.length) break;
      const prelude = text.slice(i, j).trim();
      if (text[j] !== '{') { i = j + 1; continue; }
      const close = matchBrace(text, j), body = text.slice(j + 1, close);
      if (prelude.startsWith('@')) {
        if (GROUPING.test(prelude)) nodes.push({ type: 'group', prelude, children: block(body) });
      } else if (prelude) {
        const decls = splitTop(body, ';').map(d => d.trim()).filter(Boolean).map(d => {
          const colon = d.indexOf(':'); if (colon < 0) return null;
          let prop = d.slice(0, colon).trim(); let value = d.slice(colon + 1).trim();
          if (!prop.startsWith('--')) prop = prop.toLowerCase();
          const important = /!\s*important\s*$/i.test(value);
          if (important) value = value.replace(/\s*!\s*important\s*$/i, '');
          return { prop, value, important };
        }).filter(Boolean);
        nodes.push({ type: 'rule', selectors: splitTop(prelude, ',').map(s => s.trim()).filter(Boolean), decls });
      }
      i = close + 1;
    }
    return nodes;
  }
  return block(css);
}

// ---------- colour handling ----------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
function hexToRgba(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
  const n = [0, 2, 4, 6].map(i => parseInt(h.slice(i, i + 2), 16));
  return [n[0], n[1], n[2], h.length === 8 ? n[3] / 255 : 1];
}
function parseFunc(text) {
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/i.exec(text); if (!m) return null;
  const parts = m[2].replace(/\s*\/\s*/, ',').split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (p, scale) => p.endsWith('%') ? parseFloat(p) / 100 * scale : parseFloat(p);
  let alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  if (m[1].toLowerCase().startsWith('rgb')) return [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255), alpha];
  const h = parseFloat(parts[0]), s = parseFloat(parts[1]) / 100, l = parseFloat(parts[2]) / 100;
  return [...hslToRgb(h, s, l), alpha];
}
function hslToRgb(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255].map(Math.round);
}
const lightness = ([r, g, b]) => (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255 * 100;
const chroma = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
const hex = rgb => '#' + rgb.slice(0, 3).map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const alphaText = a => String(+a.toFixed(3)).replace(/^0\./, '.');
const tokenColor = (name, a) => a >= 0.999 && TOKEN_VAR[name] ? `var(${TOKEN_VAR[name]})` : `rgb(var(--mi-${name}-rgb) / ${alphaText(a)})`;
const tinted = (l, s, a) => { const rgb = hslToRgb(218, s / 100, l / 100); return a >= 0.999 ? hex(rgb) : `rgb(${rgb.join(' ')} / ${alphaText(a)})`; };
const surface = l => l < 7.6 ? 'bg' : l < 10.6 ? 's1' : l < 13.6 ? 's2' : l < 17.5 ? 's3' : null;

// role: bg | line | text | shadow | accent
export function mapColor(rgba, role) {
  const [r, g, b, a] = rgba;
  if (a <= 0) return null;
  const l = lightness(rgba), c = chroma(rgba);
  if (c > 30 && !(c <= 42 && l < 22)) return null; // saturated accent colours keep their hue
  if (role === 'accent') {
    if (l >= 58) return tokenColor('accent', a);
    role = 'bg';
  }
  if (role === 'text') {
    // Readable text keeps WCAG 4.5:1 on every Midnight surface: dimmed copies of
    // ink/ink-2 are floored, and the old dim greys use ink-2 at 80% instead of
    // ink-3 (#6E7685 is ~4:1, reserved for non-text marks and disabled states).
    if (l >= 80) return tokenColor('ink', Math.max(a, 0.62));
    if (l >= 52) return tokenColor('ink2', Math.max(a, 0.8));
    if (l >= 36) return tokenColor('ink2', 0.8);
    if (l < 12) return tokenColor('bg', a);
    return tinted(l, 26, a);
  }
  if (role === 'shadow') {
    if (l < 4) return tokenColor('shade', a);
    if (l >= 60) return tokenColor('haze', a);
    return tinted(l, 24, a);
  }
  if (role === 'line') {
    if (a < 0.55) { if (l >= 60) return tokenColor('haze', a); if (l < 4) return tokenColor('shade', a); return tinted(l, 22, a); }
    if (l < 11) return tokenColor(surface(l), a);
    if (l < 19) return 'var(--mi-line)';
    if (l < 32) return 'var(--mi-line-strong)';
    if (l < 55) return tokenColor('haze', 0.28);
    if (l < 76) return tokenColor('haze', 0.44);
    return tokenColor('haze', 0.62);
  }
  // background
  if (a < 0.55) {
    if (l >= 60) return tokenColor('haze', a);
    if (l < 4) return tokenColor('shade', a);
    const s = surface(l); if (s) return tokenColor(s, a);
    return tinted(l, 22, a);
  }
  const s = surface(l); if (s) return tokenColor(s, a);
  if (l < 40) return tinted(l, 24 - (l - 17.5) * 0.4, a);
  if (l < 75) return tinted(l, 10, a);
  if (l >= 88) return tokenColor('ink', a);
  return null;
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^()]*\)|\b(?:white|black)\b/g;
function parseColor(token) {
  if (token[0] === '#') return [3, 4, 6, 8].includes(token.length - 1) ? hexToRgba(token) : null;
  if (/^white$/i.test(token)) return [255, 255, 255, 1];
  if (/^black$/i.test(token)) return [0, 0, 0, 1];
  return parseFunc(token);
}
export function mapValue(value, role) {
  if (/var\(/.test(value) && !/#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i.test(value)) return value;
  // keep url(...) and var(--name) untouched
  const masks = [];
  const masked = value.replace(/url\([^)]*\)|var\(--[\w-]+/gi, m => { masks.push(m); return `\u0000${masks.length - 1}\u0000`; });
  const out = masked.replace(COLOR_RE, token => {
    if (/var\(/.test(token)) return token;
    const rgba = parseColor(token); if (!rgba || rgba.some(n => Number.isNaN(n))) return token;
    return mapColor(rgba, role) ?? token;
  });
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => masks[i]);
}
// Shadows: Midnight Ink is smoked glass, so outer light glows (white neon
// halos with blur >= 6px on box-shadow, >= 4px on text-shadow) are removed;
// inset highlights and dark drop shadows are kept and re-mapped.
export function mapShadow(value, prop) {
  if (!hasColor(value)) return value;
  return splitTop(value, ',').map(raw => {
    const part = raw.trim(); COLOR_RE.lastIndex = 0;
    const token = part.match(COLOR_RE)?.[0], rgba = token && parseColor(token);
    if (rgba && !/\binset\b/.test(part) && rgba[3] > 0.06 && lightness(rgba) > 60 && chroma(rgba) <= 30) {
      const lengths = part.replace(token, ' ').match(/-?[\d.]+(?:px|em|rem)?/g) || [];
      const blur = parseFloat(lengths[2] ?? '0');
      if (blur >= (prop === 'text-shadow' ? 4 : 6)) return prop === 'text-shadow' ? '0 0 0 transparent' : '0 0 0 0 transparent';
    }
    return mapValue(part, 'shadow');
  }).join(',');
}
export function hasColor(value) { COLOR_RE.lastIndex = 0; return COLOR_RE.test(value.replace(/url\([^)]*\)/gi, '')); }

const CUSTOM_ROLE = [
  [/gold|accent|champagne|focus|selected|highlight/i, 'accent'],
  [/line|border|stroke|rule|divider|edge|hairline|outline|track-line/i, 'line'],
  [/ink|text|fg|muted|label|copy|title|heading|foreground|subtle|faint/i, 'text'],
  [/shadow|glow/i, 'shadow'],
  [/bg|background|panel|surface|card|glass|fill|base|canvas|paper|chip|track|tile|sheet|dock|plate|well|scrim|overlay/i, 'bg'],
];
export function roleFor(prop, value) {
  if (prop.startsWith('--')) {
    for (const [re, role] of CUSTOM_ROLE) if (re.test(prop)) return role;
    const m = value.match(COLOR_RE); const rgba = m && parseColor(m[0]);
    if (!rgba) return 'bg';
    const l = lightness(rgba); return l < 20 ? 'bg' : l > 55 ? 'text' : 'line';
  }
  if (/^(background|-webkit-tap-highlight-color)/.test(prop)) return 'bg';
  if (/^(border|outline|column-rule|scrollbar-color)/.test(prop)) return 'line';
  if (/^(box-shadow|text-shadow)$/.test(prop)) return 'shadow';
  if (prop === 'accent-color') return 'accent';
  return 'text';
}

// ---------- selector scoping ----------
function withoutNot(selector) {
  let out = '', i = 0;
  while (i < selector.length) {
    if (selector.startsWith(':not(', i)) { let depth = 0, j = i + 4; for (; j < selector.length; j++) { if (selector[j] === '(') depth++; else if (selector[j] === ')' && --depth === 0) break; } i = j + 1; continue; }
    out += selector[i++];
  }
  return out;
}
export const lightOnly = selector => /\.theme-light\b|data-ox-theme\s*=\s*["']?light|\.theme-midnight\b/.test(withoutNot(selector));
export function scopeDocument(selector) {
  const m = /^(html|:root)(?![\w-])/.exec(selector);
  if (m) return m[1] + '.theme-midnight' + selector.slice(m[1].length);
  if (/^::?view-transition/.test(selector)) return null;
  return '.theme-midnight ' + selector;
}
const PALETTE = '[data-ox-palette="midnight"]';
export function scopeShadow(selector) {
  if (selector.startsWith(':host(')) return ':host(' + selector.slice(6).replace(/^([^)]*)\)/, `$1${PALETTE})`);
  if (/^:host(?![\w-])/.test(selector)) return `:host(${PALETTE})` + selector.slice(5);
  return `:host(:where(${PALETTE})) ` + selector;
}

// ---------- layer generation ----------
export function buildLayer(sources, scope) {
  const parsed = sources.map(({ css }) => parseCss(css));
  const inFamily = prop => FAMILIES.some(re => re.test(prop));
  // Custom properties are cloned when any declaration of that name carries a colour.
  const colourVars = new Set();
  const visit = nodes => { for (const n of nodes) { if (n.type === 'group') visit(n.children); else for (const d of n.decls) if (d.prop.startsWith('--') && hasColor(d.value)) colourVars.add(d.prop); } };
  parsed.forEach(visit);
  const wanted = d => d.prop.startsWith('--') ? colourVars.has(d.prop) : inFamily(d.prop);
  let rules = 0, changed = 0;
  function emit(nodes) {
    let out = '';
    for (const n of nodes) {
      if (n.type === 'group') {
        if (!/^@media|^@supports/i.test(n.prelude)) continue;
        const inner = emit(n.children); if (inner) out += `${n.prelude}{${inner}}`;
        continue;
      }
      const selectors = n.selectors.filter(s => !lightOnly(s)).map(scope).filter(Boolean);
      if (!selectors.length) continue;
      const decls = n.decls.filter(wanted);
      if (!decls.length) continue;
      const body = decls.map(d => {
        const mapped = !hasColor(d.value) ? d.value : /^(box|text)-shadow$/.test(d.prop) ? mapShadow(d.value, d.prop) : mapValue(d.value, roleFor(d.prop, d.value));
        if (mapped !== d.value) changed++;
        return `${d.prop}:${mapped}${d.important ? '!important' : ''}`;
      }).join(';');
      rules++;
      out += `${selectors.join(',')}{${body}}\n`;
    }
    return out;
  }
  const css = parsed.map((nodes, i) => { const body = emit(nodes); return body ? `/* ${sources[i].path} */\n${body}` : ''; }).join('');
  return { css, rules, changed };
}
