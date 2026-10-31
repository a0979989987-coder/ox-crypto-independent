import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { sharePct, sharePrice, shareMoney, shareTime, shareTone, SHARE_UP, SHARE_DOWN, PERFORMANCE_NOTE } from '../src/markets/crypto/share-image.js';
import { SYNC_KEYS } from '../src/app/sync-keys.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('share images write coin prices, changes and Taipei times plainly', () => {
  assert.equal(sharePrice(77412.94), '77,412.9');
  assert.equal(sharePrice(2.78), '2.78');
  assert.equal(sharePrice(0.000123456789), '0.000123457');
  assert.equal(sharePrice(NaN), '—');
  assert.equal(sharePct(1.8), '+1.80%'); assert.equal(sharePct(-4.9), '-4.90%'); assert.equal(sharePct(null), '—');
  assert.equal(shareMoney(5.789e9), '57.89 億'); assert.equal(shareMoney(14835000), '1483.5 萬');
  assert.equal(shareTone(2), SHARE_UP); assert.equal(shareTone(-2), SHARE_DOWN);
  assert.equal(shareTime(Date.parse('2026-10-30T16:05:00Z')), '10/31 00:05');
  assert.equal(PERFORMANCE_NOTE.replace('\n', '・'), '過去表現不代表未來・僅供研究參考・未含手續費');
});

test('every share entry is wired: board cards and drawing, 型態 cards and sheet, 盤面, 首頁, 今日重點', async () => {
  const board = await read('src/markets/crypto/patterns/view.js');
  assert.match(board, /data-card-share/); assert.match(board, /data-action="share-drawing"/); assert.match(board, /longPress\(shadow,'\.px-card'/);
  const radar = await read('src/markets/crypto/radar-board.js');
  assert.match(radar, /onShare: shareBoardRow/); assert.match(radar, /onShareDrawing: shareBoardDrawing/);
  const compare = await read('src/markets/crypto/compare/view.js');
  assert.match(compare, /data-cmp-share/); assert.match(compare, /longPress\(root, '\.ox-cmp-pick'/); assert.match(compare, /note: PERFORMANCE_NOTE/);
  const detail = await read('src/markets/crypto/compare/detail.js');
  assert.match(detail, /data-pd-share/);
  const entries = await read('src/markets/crypto/share-entries.js');
  assert.match(entries, /ox-chart-share/); assert.match(entries, /ox-home-share/);
  assert.match(await read('src/app/app.js'), /share-entries\.js/);
  const news = await read('src/components/news/workspace.js');
  assert.match(news, /share\.news/); assert.match(news, /BTC\|以太坊\|ETH\|聯準會/);
  // The preview is a modal dialog, so it opens above 型態詳情 or an event sheet.
  assert.match(await read('src/markets/crypto/share-image.js'), /showModal\(\)/);
  assert.match(await read('index.html'), /src\/styles\/components\/share\.css\?v=/);
});

test('each usage record the page sends has a Chinese label on the admin page', async () => {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(new URL(dir, root), { withFileTypes: true })) {
      const path = dir + entry.name;
      if (entry.isDirectory()) { if (!/generated|vendor|assets/.test(path)) await walk(path + '/'); }
      else if (/\.(js|html)$/.test(entry.name)) files.push(path);
    }
  }
  await walk('src/'); files.push('index.html');
  const names = new Set();
  for (const file of files) for (const m of (await read(file)).matchAll(/data-track="([a-z][a-z0-9._-]*)"|dataset\.track ?= ?'([a-z][a-z0-9._-]*)'|OXTrack\?\.\('([a-z][a-z0-9._-]*)'|'(share\.[a-z]+)'/g)) names.add(m[1] || m[2] || m[3] || m[4]);
  names.delete('name'); // usage.js's own comment: data-track="name"
  const admin = await read('admin.html');
  for (const name of ['share.card', 'share.drawing', 'share.compare', 'share.detail', 'share.chart', 'share.home', 'share.news', 'share.image', 'bubbles.period']) assert.ok(names.has(name), name);
  assert.deepEqual([...names].filter(name => !admin.includes(`'${name}':`)), []);
});

test('synced settings are the keys the features really use', async () => {
  const synced = new Set(SYNC_KEYS.map(k => k.storage));
  const uses = {
    'ox-crypto:chart-indicators-v1': 'src/components/chart/indicators.js',
    'ox-chart-indicators': 'src/components/chart/toolbar.js',
    'ox-crypto:chart-style-v1': 'src/components/chart/indicators.js',
    'ox-crypto:board-filter-v1': 'src/markets/crypto/patterns/filters.js',
    'ox-crypto:bubble-days-v1': 'src/markets/crypto/bubbles/period.js'
  };
  for (const [key, file] of Object.entries(uses)) {
    assert.ok(synced.has(key), key + ' is synced');
    assert.ok((await read(file)).includes(`'${key}'`), key + ' is used by ' + file);
  }
  assert.equal(new Set(SYNC_KEYS.map(k => k.key)).size, SYNC_KEYS.length, 'account names are unique');
});
