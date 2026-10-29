import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { STEP, compareModel, defaultOpen, coinName, patternName, taipeiTime, periodLabel, nextCloseText, miniChart, closesChart, parseRows, pct } from '../src/markets/crypto/compare/model.js';
import { updateLog } from '../scripts/crypto-breakouts.mjs';
import { DATA_FILE, DATA_WORKFLOWS } from '../worker/site.js';
import { isWorkerOnly } from '../scripts/sites-platform.mjs';

const L = 1793232000; // 2026-10-29 00:00 UTC = 08:00 Taipei, a 4H boundary
const pick = (s, t, c, extra = {}) => ({ s, p: 'horizontal-resistance', t, st: '已收 K 確認突破', pts: [[L - 30 * STEP, 10], [L - STEP, 10]], c, ...extra });
const point = (at, picks = []) => ({ at, pool: 400, scanned: 390, picks });
const log = (at, points, btc = {}) => ({ version: 1, updatedAt: new Date((at + 300) * 1000).toISOString(), frame: '4H', step: STEP, periods: [1, 6, 18], at, method: '突破 K 收盤 → 之後第 1／6／18 根 4 小時 K 收盤；BTC 為同期漲跌', btc, points, history: [] });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('records are listed newest first, in Taipei time, with plain labels', () => {
  const model = compareModel(log(L, [point(L - 2 * STEP, [pick('AAAUSDT', 1, [1])]), point(L), point(L - STEP, [pick('BBBUSDT', 2, [1])])]));
  assert.deepEqual(model.points.map(p => p.at), [L, L - STEP, L - 2 * STEP]);
  assert.deepEqual(model.points.map(p => p.time), ['10/29 08:00', '10/29 04:00', '10/29 00:00']);
  assert.deepEqual(model.points.map(p => p.count), [0, 1, 1]);
  assert.equal(model.updated, '10/29 08:05');
  assert.deepEqual([1, 6, 18].map(k => periodLabel(k)), ['4 小時', '1 天', '3 天']);
  assert.equal(taipeiTime(L + 4 * STEP), '10/30 00:00');
  // The point opened first is the newest one that has picks.
  assert.equal(defaultOpen(model), L - STEP);
  assert.equal(coinName('1000PEPEUSDT'), '1000PEPE');
  assert.equal(nextCloseText(Date.UTC(2026, 9, 29, 1, 30)), '12:00');
  assert.equal(nextCloseText(Date.UTC(2026, 9, 29, 15, 59)), '00:00');
});

test('pattern names come from the board catalog, harmonic patterns included', () => {
  assert.equal(patternName('horizontal-resistance'), '水平阻力');
  assert.equal(patternName('gartley-bull'), '加特利 Gartley・多');
  assert.equal(patternName('abcd127-bull'), '延伸 CD＝1.27 AB・多');
  assert.equal(patternName('no-such-pattern'), 'no-such-pattern');
  const model = compareModel(log(L, [point(L, [pick('AAAUSDT', 1, [1], { p: 'bat-bull' })])]));
  assert.equal(model.points[0].picks[0].name, '蝙蝠 Bat・多');
});

test('a period counts only once its 4H close is recorded; returns are against BTC over the same span', () => {
  const at = L - 10 * STEP, btc = { [at]: 100, [at + STEP]: 101, [at + 6 * STEP]: 97 };
  const model = compareModel(log(L, [point(at, [
    pick('AAAUSDT', 1, [10, 10.5, 10, 10, 10, 10, 12, 12, 12, 12, 12]),
    pick('BBBUSDT', 3, [20, 19]) // its series ended after one candle (left the pool, no data)
  ])], btc));
  const [p] = model.points;
  assert.deepEqual(p.spans.map(s => [s.k, s.reached]), [[1, true], [6, true], [18, false]]);
  const [a, b] = p.picks;
  assert.deepEqual(a.results.map(r => r.state), ['done', 'done', 'wait']);
  close(a.results[0].ret, 5); close(a.results[0].btc, 1); close(a.results[0].vs, 4);
  close(a.results[1].ret, 20); close(a.results[1].btc, -3); close(a.results[1].vs, 23);
  assert.equal(a.results[2].ret, null);
  assert.equal(a.last.k, 6);
  assert.deepEqual(b.results.map(r => r.state), ['done', 'missing', 'wait']);
  close(b.results[0].ret, -5);
  assert.equal(b.results[1].ret, null);
  close(b.results[1].btc, -3);
  assert.equal(pct(5), '+5.00%'); assert.equal(pct(-3), '-3.00%'); assert.equal(pct(0), '0.00%');
  // The newest record: nothing reached yet.
  const fresh = compareModel(log(L, [point(L, [pick('AAAUSDT', 1, [10])])])).points[0];
  assert.deepEqual(fresh.picks[0].results.map(r => r.state), ['wait', 'wait', 'wait']);
  assert.equal(fresh.picks[0].last, null);
  assert.equal(fresh.settled, false);
});

test('missing or broken data never throws and never invents a number', () => {
  for (const bad of [null, undefined, {}, { points: 'x' }, []]) assert.equal(compareModel(bad).empty, true);
  assert.equal(compareModel(log(L, [])).empty, true);
  const model = compareModel({ points: [
    { at: L, picks: [null, { s: '' }, { s: 'ZEROUSDT', c: [0, 1, 1, 1, 1, 1, 1] }, { s: 'NOCUSDT' }, { s: 'BADPTSUSDT', c: [5], pts: [[L, 'x'], null, [L - STEP, 4]] }] },
    { at: 'x' }, { at: L }, null
  ] });
  assert.equal(model.points.length, 1, 'bad and repeated records are dropped');
  const picks = model.points[0].picks;
  assert.deepEqual(picks.map(p => p.s), ['ZEROUSDT', 'NOCUSDT', 'BADPTSUSDT']);
  // Without log.at the newest record is the latest; without btc, BTC is unknown.
  assert.ok(picks.every(p => p.results.every(r => r.state === 'wait' && r.ret === null && r.btc === null)));
  assert.deepEqual(picks[2].pts, [[L - STEP, 4]]);
  assert.equal(picks[0].t, null);
  assert.equal(model.updated, '');
  // A zero base close is unusable; BTC missing at one end is unknown, not zero.
  const later = compareModel(log(L + 6 * STEP, [point(L, [{ s: 'ZEROUSDT', c: [0, 1, 1, 1, 1, 1, 1] }])], { [L]: 100 })).points[0].picks[0];
  assert.deepEqual(later.results.map(r => [r.state, r.btc]), [['missing', null], ['missing', null], ['wait', null]]);
  assert.equal(compareModel({ ...log(L, [point(L)]), step: -1, periods: ['a'] }).periods.join(), '1,6,18');
});

test('the recorder\'s own log is read as it is written', () => {
  const path = { AAAUSDT: k => 10 + k, BTCUSDT: k => 100 + k };
  const closeOf = (s, t) => path[s]?.((t - L) / STEP);
  let recorded = updateLog(null, { points: [point(L, [pick('AAAUSDT', 1)])], closeOf, now: '2026-10-29T00:08:00.000Z' });
  recorded = updateLog(recorded, { points: [point(L + 6 * STEP, [pick('AAAUSDT', 2)])], closeOf, now: '2026-10-30T00:08:00.000Z' });
  const model = compareModel(JSON.parse(JSON.stringify(recorded)));
  assert.deepEqual(model.points.map(p => [p.time, p.count]), [['10/30 08:00', 1], ['10/29 08:00', 1]]);
  const [r1, r6, r18] = model.points[1].picks[0].results;
  close(r1.ret, 10); close(r1.btc, 1); close(r6.ret, 60); close(r6.btc, 6);
  assert.equal(r18.state, 'wait');
  assert.equal(model.updated, '10/30 08:08');
  assert.match(model.method, /BTC 為同期漲跌/);
});

const candle = (time, close, open = close) => ({ time, open, high: Math.max(open, close) * 1.01, low: Math.min(open, close) * .99, close });
test('mini chart: the pattern line over the candles, the breakout candle marked, later candles shaded', () => {
  const at = L - 10 * STEP, candles = Array.from({ length: 120 }, (_, i) => candle(L - (119 - i) * STEP - STEP, 10 + (i % 7) / 10));
  const [p] = compareModel(log(L, [point(at, [pick('AAAUSDT', 1, [10, 11, 10, 10, 10, 10, 9])])])).points[0].picks;
  const svg = miniChart(p, at, candles);
  assert.match(svg, /^<svg viewBox="0 0 150 96"/);
  assert.match(svg, /<polyline class="ln"/);
  assert.match(svg, /<rect class="zdown"/, 'shaded in the colour of the latest result (1 天 -10%)');
  assert.match(svg, /class="bk"/);
  assert.match(svg, />突破</);
  // At most 48 candles, and never past the 3 天 mark.
  assert.ok((svg.match(/<rect class="[ud]"/g) || []).length <= 48);
  assert.equal(miniChart(p, L + 50 * STEP, candles), '', 'no chart when the breakout candle is not in the series');
  const fallback = closesChart(p, at);
  assert.match(fallback, /<polyline class="ln"/);
  assert.match(fallback, /<polyline class="cl down"/);
  assert.equal(closesChart({ pts: [], c: [5] }, at), '');
});

test('candle rows: only closed 4H candles of the newest uninterrupted run', () => {
  const row = (t, c) => [String(t * 1000), String(c), String(c * 1.01), String(c * .99), String(c), '1', '1'];
  const rows = [row(L - 5 * STEP, 1), row(L - 3 * STEP, 2), row(L - 2 * STEP, 3), row(L - STEP, 4), row(L, 5), ['x']];
  const list = parseRows(rows, (L + 60) * 1000);
  assert.deepEqual(list.map(c => c.time), [L - 3 * STEP, L - 2 * STEP, L - STEP]);
  assert.equal(parseRows(rows, (L + STEP) * 1000).at(-1).time, L);
  assert.deepEqual(parseRows(null, Date.now()), []);
});

test('the log is a public data file the Site publishes, and the recorder may publish it', async () => {
  assert.match('data/crypto-breakouts.json', DATA_FILE);
  assert.ok(isWorkerOnly('/data/crypto-breakouts.json'));
  assert.ok(DATA_WORKFLOWS.includes('record-crypto-breakouts.yml'));
  const workflow = (await readFile(new URL('../.github/workflows/record-crypto-breakouts.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /if: \$\{\{ always\(\) && !cancelled\(\) && github\.ref == 'refs\/heads\/main' && vars\.OX_SITES_DATA == 'on' \}\}/);
});
