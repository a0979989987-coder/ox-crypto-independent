import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pickEvents, bitgetBars, done, windowOf, KEEP } from '../scripts/collect-macro-reactions.mjs';
import { reactionPair, reactionMetric, reactionMoves } from '../src/components/news/macro-reaction.js';

test('released 非農、CPI and FOMC events, newest 8 of each, results first and the BLS schedule after', () => {
  const now = Date.parse('2026-10-31T00:00:00Z');
  const macro = { events: [
    { id: 'macro:cpi-mom:2026-10-14', metric: 'cpi-mom', titleZh: '美國 CPI 月增率', releasedAt: '2026-10-14T12:30:00.000Z' },
    { id: 'macro:fed-rate:2026-10-28', metric: 'fed-rate', titleZh: '美聯準會 FOMC 利率決策', releasedAt: '2026-10-28T18:00:00.000Z' },
    { id: 'macro:fed-rate:2026-12-09', metric: 'fed-rate', occursAt: '2026-12-09T19:00:00.000Z', releasedAt: null },
    { id: 'macro:ppi:2026-10-15', metric: 'ppi', releasedAt: '2026-10-15T12:30:00.000Z' }] };
  const bls = (title, occursAt, extra = {}) => ({ id: title, sourceId: 'bls-calendar', title, occursAt, ...extra });
  const news = { events: [
    bls('Consumer Price Index for September 2026', '2026-10-14T12:30:00.000Z'), // the same release as the result above
    bls('Consumer Price Index for August 2026', '2026-09-11T12:30:00.000Z'),
    bls('Employment Situation for October 2026', '2026-11-06T13:30:00.000Z'), // not yet
    bls('Producer Price Index for September 2026', '2026-10-15T12:30:00.000Z'),
    bls('Employment Situation for July 2026', '2026-08-07T12:30:00.000Z', { status: 'cancelled' }),
    ...Array.from({ length: 10 }, (_, i) => bls(`Employment Situation for M${i}`, new Date(Date.UTC(2026, i, 6, 12, 30)).toISOString()))] };
  const picked = pickEvents(macro, news, now), ids = picked.map(e => e.id);
  assert.deepEqual(ids.filter(id => id.includes('cpi')), ['macro:cpi-mom:2026-10-14', 'macro:cpi-mom:2026-09-11']);
  assert.equal(picked.find(e => e.id === 'macro:cpi-mom:2026-10-14').title, '美國 CPI 月增率');
  assert.deepEqual(ids.filter(id => id.includes('fed')), ['macro:fed-rate:2026-10-28']);
  const jobs = ids.filter(id => id.includes('nonfarm'));
  assert.equal(jobs.length, KEEP); assert.equal(jobs[0], 'macro:nonfarm-payrolls:2026-10-06'); assert.ok(!jobs.includes('macro:nonfarm-payrolls:2026-08-07'));
  assert.ok(!ids.some(id => id.includes('ppi') || id.includes('Producer')));
});

test('Bitget rows become closed 5-minute bars inside the window, oldest first', () => {
  const { at, from, to } = windowOf('2026-10-28T18:00:00.000Z');
  assert.equal(to - from, 240 * 60000);
  const row = (ms, close) => [String(ms), '100', '101', '99', String(close), '12.3456', '1234'];
  const json = { code: '00000', data: [row(at, 100.5), row(from - 300000, 1), row(from, 100), row(at + 300000, 99), row(to, 5), [String(at + 600000), '0', '1', '1', '1', '1']] };
  assert.deepEqual(bitgetBars(json, from, to).bars, [[from / 1000, 100, 101, 99, 100, 12.35], [at / 1000, 100, 101, 99, 100.5, 12.35], [at / 1000 + 300, 100, 101, 99, 99, 12.35]]);
  // The bar still forming is left out until it closes.
  assert.equal(bitgetBars(json, from, to, at + 300000).bars.length, 2);
  assert.equal(bitgetBars({ code: '40034', msg: 'x' }, from, to), null);
  assert.equal(bitgetBars({ code: '00000', data: [] }, from, to), null);
});

test('a window is final once its last bar reaches the end', () => {
  const { from, to } = windowOf('2026-10-14T12:30:00.000Z'), bar = ms => [ms / 1000, 1, 1, 1, 1, 0];
  assert.equal(done({ bars: [bar(from), bar(to - 5 * 60000)] }, to), true);
  assert.equal(done({ bars: [bar(from), bar(to - 30 * 60000)] }, to), false);
  assert.equal(done(null, to), false);
});

test('the calendar pairs a release with the previous one of the same data and reads its moves', () => {
  const data = { events: {
    'macro:cpi-mom:2026-09-11': { metric: 'cpi-mom', releasedAt: '2026-09-11T12:30:00.000Z' },
    'macro:cpi-mom:2026-10-14': { metric: 'cpi-mom', releasedAt: '2026-10-14T12:30:00.000Z' },
    'macro:fed-rate:2026-10-28': { metric: 'fed-rate', releasedAt: '2026-10-28T18:00:00.000Z' } } };
  // A news-calendar event merged with its result keeps its own id and carries macroId.
  const merged = reactionPair(data, { id: 'abc', macroId: 'macro:cpi-mom:2026-10-14', metric: 'cpi-mom', occursAt: '2026-10-14T12:30:00.000Z' });
  assert.equal(merged.mine.releasedAt, '2026-10-14T12:30:00.000Z'); assert.equal(merged.previous.releasedAt, '2026-09-11T12:30:00.000Z');
  // A scheduled BLS release with no result yet: its metric comes from the title; previous is the latest.
  const next = { id: 'x', sourceId: 'bls-calendar', title: 'Consumer Price Index for October 2026', occursAt: '2026-11-10T13:30:00.000Z' };
  assert.equal(reactionMetric(next), 'cpi-mom'); assert.equal(reactionMetric({ sourceId: 'bls-calendar', title: 'Producer Price Index for October 2026' }), null);
  const upcoming = reactionPair(data, next);
  assert.equal(upcoming.mine, null); assert.equal(upcoming.at, Date.parse(next.occursAt)); assert.equal(upcoming.previous.releasedAt, '2026-10-14T12:30:00.000Z');
  // The first release of a series has no previous one.
  assert.equal(reactionPair(data, { metric: 'fed-rate', releasedAt: '2026-10-28T18:00:00.000Z' }).previous, null);
  const at = Date.parse('2026-10-28T18:00:00.000Z'), t = at / 1000, bar = (s, o, h, l, c) => [s, o, h, l, c, 0];
  const bars = [bar(t - 600, 9, 10, 8, 10), bar(t - 300, 10, 11, 9, 100), bar(t, 100, 130, 95, 120), ...Array.from({ length: 11 }, (_, i) => bar(t + 300 * (i + 1), 120, 125, 90, 110 + i))];
  const m = reactionMoves(bars, at);
  assert.equal(m.before, 100); assert.equal(m.m30, 114); assert.equal(m.m60, 120); assert.equal(m.high, 130); assert.equal(m.low, 90);
  // Not reached yet: no value rather than an earlier price.
  assert.equal(reactionMoves(bars.slice(0, 5), at).m30, null);
});

test('the saved reactions come from Bitget history for real releases', async () => {
  const data = JSON.parse(await readFile(new URL('../data/macro-reactions.json', import.meta.url), 'utf8'));
  assert.equal(data.version, 1); assert.deepEqual(data.window, { before: 60, after: 180, step: 5 });
  for (const [id, e] of Object.entries(data.events)) {
    assert.match(id, /^macro:(nonfarm-payrolls|cpi-mom|fed-rate):\d{4}-\d{2}-\d{2}$/);
    const { from, to } = windowOf(e.releasedAt);
    for (const key of ['btc', 'eth']) if (e[key]) for (const b of e[key].bars) {
      assert.ok(b[0] * 1000 >= from && b[0] * 1000 < to && b[0] % 300 === 0, id);
      assert.ok(b[2] >= Math.max(b[1], b[4]) && b[3] <= Math.min(b[1], b[4]), id);
    }
  }
});
