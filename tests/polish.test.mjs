import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { stampText, dataTime } from '../src/app/updated-stamp.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('an empty radar list says why: still scanning, the market leans the other way, or nothing qualifies', async () => {
  const source = await read('src/app/view-home-theme.js');
  const fns = source.slice(source.indexOf('function homeBreadth('), source.indexOf('function renderHomeQuotes('));
  const run = state => runInNewContext(`${fns}\n({ long: radarEmptyReason('long'), short: radarEmptyReason('short') })`, { state });
  const tickers = (up, down) => [...Array(up).fill('0.02'), ...Array(down).fill('-0.02')].map((change24h, i) => ({ symbol: `C${i}USDT`, change24h }));
  assert.deepEqual({ ...run({ tickers: tickers(3, 3), scanQueue: Array(465), scanIndex: 23, radarSnapshotReady: false }).long }, { title: '掃描中 23/465', text: '多頭候選會陸續出現。', busy: true });
  const bear = run({ tickers: tickers(10, 40), scanQueue: [], scanIndex: 0, radarSnapshotReady: true });
  assert.equal(bear.long.title, '目前沒有多頭候選・市場偏空'); assert.match(bear.long.text, /^10 個上漲、40 個下跌；/); assert.equal(bear.long.busy, false);
  assert.equal(bear.short.title, '目前沒有空頭候選');
  assert.equal(run({ tickers: tickers(40, 10), radarSnapshotReady: true }).short.title, '目前沒有空頭候選・市場偏多');
  assert.equal(run({ tickers: [], radarSnapshotReady: false, radarLoadError: true }).long.title, '行情資料尚未取得');
});

test('every data page carries 「HH:MM 更新」 from the newest Bitget ticker time', () => {
  const at = Date.parse('2026-11-01T10:03:40Z');
  assert.equal(dataTime([{ ts: String(at - 60000) }, { ts: String(at) }, { ts: 'x' }]), at);
  assert.equal(stampText(at), '18:03 更新');
  assert.equal(stampText(null), '');
});

test('the polish layer: no text under 11px in the tool stylesheets, one motion spec, details stay open across patches', async () => {
  for (const file of ['src/markets/crypto/patterns/patterns.css', 'src/markets/crypto/bubbles/bubbles.css', 'src/markets/crypto/analytics/flow.css'])
    assert.match(await read(file), /看得清楚: no text under 11px[\s\S]*\{font-size:11px!important\}\s*$/, file);
  const css = await read('src/styles/components/polish.css');
  for (const part of ['--ox-base:240ms', 'ox-view-in', 'ox-sheet-in', '.ox-skel:empty', '.ox-updated', 'details.ox-info', '--oc-muted:#5d6470']) assert.ok(css.includes(part), part);
  assert.match(await read('src/app/coin-logo.js'), /folded && name === 'open'/);
  assert.match(await read('src/markets/crypto/compare/view.js'), /ⓘ 怎麼計算/);
  assert.match(await read('index.html'), /class="ox-detail-summary"[\s\S]*id="ox-detail-grid" hidden/);
});
