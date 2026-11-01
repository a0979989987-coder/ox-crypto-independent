import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const load = async () => { const ctx = {}; ctx.globalThis = ctx; runInNewContext(await read('src/core/price-format.js'), ctx); return ctx.OXPriceText; };

test('prices with three or more zeros after the point show the zero count, like the exchanges', async () => {
  const f = await load();
  assert.equal(f(0.0008023), '0.0₃8023');
  assert.equal(f('0.0000049651'), '0.0₅4965');
  assert.equal(f(0.0000025), '0.0₅25');
  assert.equal(f(0.0001), '0.0₃1');
  assert.equal(f(-0.00008), '-0.0₄8');
  assert.equal(f(1e-9), '0.0₈1');
  assert.equal(f(0.0000035, { sig: 5 }), '0.0₅35');
  // Two zeros or fewer stay as they are; larger prices keep their usual decimals.
  assert.equal(f(0.0012345), '0.0012345');
  assert.equal(f(0.00099999), '0.00099999');
  assert.equal(f(0.042318), '0.042318');
  assert.equal(f(1.25412), '1.2541');
  assert.equal(f(77954.92), '77,954.92');
  for (const empty of [0, null, undefined, '', 'x', NaN]) assert.equal(f(empty), '—');
});

test('every place that shows a price uses the shared format', async () => {
  assert.match(await read('src/core/runtime-config.js'), /const fmtPrice = v => \{\s*if \(globalThis\.OXPriceText\) return globalThis\.OXPriceText\(v\);/);
  assert.match(await read('src/app/topbar.js'), /export function priceText\(v\) \{ return globalThis\.OXPriceText\(v\); \}/);
  for (const file of ['src/markets/crypto/home-tiles.js', 'src/markets/crypto/share-image.js', 'src/markets/crypto/compare/detail.js', 'src/markets/crypto/patterns/charts.js',
    'src/markets/crypto/analytics/flow-view.js', 'src/components/chart/workspace.js', 'src/components/chart/home-preview.js', 'src/markets/crypto/bubbles/view.js'])
    assert.match(await read(file), /OXPriceText/, file);
  const html = await read('index.html');
  assert.ok(html.indexOf('src/core/price-format.js') < html.indexOf('src/core/runtime-config.js'), 'loaded before the runtime');
});
