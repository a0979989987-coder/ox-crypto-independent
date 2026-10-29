import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('shared escapeHtml neutralises markup from market data', () => {
  const escapeHtml = runInNewContext(`${read('src/core/runtime-config.js')}\nescapeHtml`, { localStorage: { getItem: () => null, setItem() {} }, Intl });
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml(`"a" & 'b'`), '&quot;a&quot; &amp; &#39;b&#39;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(75), '75');
});

// Exchange / snapshot fields that reach innerHTML templates. Interpolations that
// only feed comparisons, dataset/textContent or internal constant labels are listed.
const dataField = /\.(?:symbol|base|reason|setupName|structureLabel)\b|\b(?:row|r|e)\.name\b/;
const allowed = new Map([
  ['src/app/view-home-theme.js', ['${coin.symbol}', '${surge.symbol.replace(/USDT$/, "")}']],
  // Selection comparisons only emit a constant class; header fields use textContent.
  ['src/markets/crypto/scanner.js', ["${t.symbol === state.symbol ? 'selected' : ''}", "${rec.symbol === state.symbol ? 'selected' : ''}", "${c.symbol === state.symbol ? 'selected' : ''}"]],
  ['src/markets/crypto/presentation.js', ['${ticker.symbol}']],
  ['src/markets/crypto/analytics/flow-view.js', ['${state.selected===r.symbol}', "${state.selectedIds===null||state.selectedIds.includes(r.symbol)?'checked':''}", "${watched.has(r.symbol)?'★ 已加入自選':'☆ 加入自選'}", "${watched.has(r.symbol)?'★':'☆'}", "${watched.has(r.symbol)?'取消':'加入'}", '${watched.has(r.symbol)}', '${row.name}']]
]);

// Every innermost ${...} expression (nested template literals are skipped; their
// own interpolations are visited separately).
function interpolations(source) {
  const found = [];
  for (let index = source.indexOf('${'); index !== -1; index = source.indexOf('${', index + 2)) {
    let depth = 0, end = index + 1;
    for (; end < source.length; end++) {
      if (source[end] === '{') depth++;
      else if (source[end] === '}' && --depth === 0) break;
    }
    const expression = source.slice(index, end + 1);
    if (!expression.includes('`')) found.push(expression);
  }
  return found;
}

for (const [file, exceptions] of allowed) {
  test(`${file} escapes external fields interpolated into markup`, () => {
    const source = read(file);
    const unescaped = interpolations(source)
      .filter(expression => dataField.test(expression) && !/^\$\{\s*(?:escape|escapeHtml|esc)\(/.test(expression) && !/\.map\((?:escape|escapeHtml|esc)\)/.test(expression) && !exceptions.includes(expression));
    assert.deepEqual(unescaped, []);
  });
}

test('home event rows render a hostile symbol and reason as text', () => {
  const source = read('src/app/view-home-theme.js');
  const start = source.indexOf('if (eventBox) eventBox.innerHTML');
  const line = source.slice(start, source.indexOf('\n', start));
  const escapeHtml = runInNewContext(`${read('src/core/runtime-config.js')}\nescapeHtml`, { localStorage: { getItem: () => null, setItem() {} }, Intl });
  const eventBox = { innerHTML: '' };
  const events = [{ symbol: '<img src=x onerror=alert(1)>USDT', type: '進入 T1', reason: '<script>x</script>', tag: 'T1', icon: '⚡' }];
  runInNewContext(line, { eventBox, events, escapeHtml });
  assert.doesNotMatch(eventBox.innerHTML, /<img|<script/);
  assert.match(eventBox.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(eventBox.innerHTML, /&lt;script&gt;x&lt;\/script&gt;/);
});

test('radar reasons and detail reasons are escaped before joining markup', () => {
  const scanner = read('src/markets/crypto/scanner.js'), presentation = read('src/markets/crypto/presentation.js');
  assert.match(scanner, /\(c\.reasons\|\|\[\]\)\.map\(fmtSignalReason\)\.map\(escapeHtml\)\.join/);
  assert.match(scanner, /\$\{escapeHtml\(c\.setupName\)\}/);
  assert.match(presentation, /\$\{escapeHtml\(fmtSignalReason\(r\.text\)\)\}/);
});
