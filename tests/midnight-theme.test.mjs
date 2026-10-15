import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMidnight } from '../scripts/build-midnight-theme.mjs';
import { parseCss, mapColor, mapValue, mapShadow, scopeDocument, scopeShadow, lightOnly } from '../scripts/theme/midnight-map.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('index.html');
const selectorsOf = css => { const out = []; const walk = nodes => { for (const n of nodes) n.type === 'group' ? walk(n.children) : out.push(...n.selectors); }; walk(parseCss(css)); return out; };

test('generated Midnight Ink sheets are up to date with every source stylesheet', async () => {
  const { stats, ...files } = await buildMidnight();
  for (const [path, css] of Object.entries(files)) assert.equal(read(path), css, `${path} is stale: run npm run build:tools`);
  assert.ok(stats.document.rules > 1000 && stats.tools.rules > 200);
});

test('Midnight Ink rules are inert unless the theme is active', () => {
  for (const s of selectorsOf(read('src/styles/themes/midnight-ink.css')))
    assert.match(s, /\.theme-midnight/, s);
  for (const s of selectorsOf(read('src/styles/themes/midnight-ink-tools.css')))
    assert.match(s, /\[data-ox-palette="midnight"\]/, s);
});

test('the shared palette tokens are exact', () => {
  const css = read('src/styles/themes/midnight-ink.css');
  for (const token of ['--mi-bg:#0A0E16', '--mi-surface-1:#0F1520', '--mi-surface-2:#151C29', '--mi-surface-3:#1B2433',
    '--mi-line:rgba(226,232,240,.08)', '--mi-line-strong:rgba(226,232,240,.16)', '--mi-ink:#ECE7DE', '--mi-ink-2:#A9B0BC',
    '--mi-ink-3:#6E7685', '--mi-accent:#D9C79A', '--mi-accent-soft:rgba(217,199,154,.14)']) assert.ok(css.includes(token), token);
});

test('Midnight Ink loads only on demand and is decided before first paint', () => {
  assert.doesNotMatch(html, /<link[^>]+midnight-ink/, 'no static link: other themes never download it');
  const head = html.slice(0, html.indexOf('</head>'));
  const firstScript = head.match(/<script\b[^>]*>/)[0];
  assert.match(firstScript, /src="src\/app\/theme-boot\.js/, 'theme boot is the first head script');
  assert.doesNotMatch(firstScript, /\b(defer|async|type="module")\b/, 'theme boot runs synchronously');
  assert.ok(head.indexOf('theme-boot.js') < head.indexOf('rel="stylesheet"'), 'before any stylesheet');
  const boot = read('src/app/theme-boot.js');
  assert.match(boot, /midnight-ink\.css/); assert.match(boot, /document\.write/);
  for (const choice of ['data-control-theme="midnight"', 'data-theme-choice="midnight"']) assert.ok(html.includes(choice), choice);
});

test('neutral greys move onto Midnight tokens while hues are preserved', () => {
  assert.equal(mapColor([18, 20, 23, 1], 'bg'), 'var(--mi-surface-1)');
  assert.equal(mapColor([13, 16, 18, 1], 'bg'), 'var(--mi-bg)');
  assert.equal(mapColor([52, 57, 58, 1], 'line'), 'var(--mi-line-strong)');
  assert.equal(mapColor([240, 238, 232, 1], 'text'), 'var(--mi-ink)');
  assert.equal(mapColor([255, 255, 255, 0.08], 'bg'), 'rgb(var(--mi-haze-rgb) / .08)');
  assert.equal(mapColor([0, 184, 212, 1], 'text'), null, 'long cyan keeps its colour');
  assert.equal(mapColor([255, 48, 120, 1], 'text'), null, 'short magenta keeps its colour');
  // readable text never maps to the ~4:1 weak tone
  assert.equal(mapColor([110, 115, 118, 1], 'text'), 'rgb(var(--mi-ink2-rgb) / .8)');
  assert.equal(mapValue('linear-gradient(#141819, #0d1012 60%, transparent)', 'bg'), 'linear-gradient(var(--mi-surface-1), var(--mi-bg) 60%, transparent)');
  assert.equal(mapValue('var(--x, #fff)', 'text'), 'var(--x, var(--mi-ink))');
  assert.equal(mapValue('url(#a1b) #000', 'bg'), 'url(#a1b) ' + mapColor([0, 0, 0, 1], 'bg'), 'url fragments are not colours');
});

test('white neon halos are removed, inset highlights and drop shadows stay', () => {
  assert.equal(mapShadow('0 0 10px #ffffff2b', 'box-shadow'), '0 0 0 0 transparent');
  assert.equal(mapShadow('inset 0 1px 0 #ffffff14,0 8px 24px #0007', 'box-shadow'), 'inset 0 1px 0 rgb(var(--mi-haze-rgb) / .078),0 8px 24px rgb(var(--mi-shade-rgb) / .467)');
  assert.equal(mapShadow('0 0 7px #fff8', 'text-shadow'), '0 0 0 transparent');
});

test('scoping adds exactly one class of specificity and drops light-only rules', () => {
  assert.equal(scopeDocument('body.ox-terminal .panel'), '.theme-midnight body.ox-terminal .panel');
  assert.equal(scopeDocument(':root'), ':root.theme-midnight');
  assert.equal(scopeDocument('html.ox-live-disabled body'), 'html.theme-midnight.ox-live-disabled body');
  assert.equal(scopeShadow(':host'), ':host([data-ox-palette="midnight"])');
  assert.equal(scopeShadow(':host(.wide) .x'), ':host(.wide[data-ox-palette="midnight"]) .x');
  assert.equal(scopeShadow('.cfx'), ':host(:where([data-ox-palette="midnight"])) .cfx');
  assert.equal(lightOnly('body.theme-light .panel'), true);
  assert.equal(lightOnly('body:not(.theme-light) .panel'), false);
  assert.equal(lightOnly(':host([data-ox-theme="light"]) .cfx'), true);
});

test('every theme switch path knows Midnight Ink', () => {
  const runtime = read('src/app/view-home-theme.js');
  assert.match(runtime, /OXTheme\.loadMidnight\(\)/, 'class flips only after the sheet is usable');
  assert.match(runtime, /theme-midnight/);
  assert.match(read('src/components/style-ready.js'), /data-ox-palette|oxPalette/);
  assert.match(read('src/components/account/summary.js'), /midnight:"午夜墨"/);
  assert.match(read('src/styles/components/radar-polish.css'), /animation-duration:240ms/);
});
