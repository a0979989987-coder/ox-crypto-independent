import test from 'node:test';
import assert from 'node:assert/strict';

// A per-test browser storage stand-in.
const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const live = await import('../src/components/news/live.js');
const { composeSnapshot, applyCachedTranslations, translateItems, needsTranslation, _resetTranslationMemory } = live;

const base = () => ({
  schemaVersion: 1, generatedAt: '2026-10-15T21:32:45.289Z',
  news: [{ id: 'a', title: 'Reviewed', titleZh: '已審核標題', translationStatus: 'translated', link: 'https://www.coindesk.com/a', publishedAt: '2026-10-15T20:00:00Z', sourceId: 'coindesk', markets: ['crypto'] }],
  pendingNews: [{ id: 'b', title: 'Pending headline', titleZh: null, translationStatus: 'pending', link: 'https://cointelegraph.com/b', publishedAt: '2026-10-15T21:00:00Z', sourceId: 'cointelegraph', markets: ['crypto'] }],
  events: [{ id: 'foresight:1', sourceId: 'foresight-calendar', title: '旧标题', titleZh: '舊標題', date: '2026-10-20', category: 'unlock', markets: ['crypto'] },
    { id: 'foresight:2', sourceId: 'foresight-calendar', title: '会被移除', titleZh: '會被移除', date: '2026-10-21', category: 'unlock', markets: ['crypto'] },
    { id: 'fed:meeting:2026-10-28', sourceId: 'fed-calendar', title: 'FOMC', titleZh: 'FOMC', date: '2026-10-28', category: 'macro', markets: ['crypto'] }],
  eventCoverage: [{ sourceId: 'foresight-calendar', category: 'unlock', from: '2026-10-01', to: '2026-10-06', complete: false }],
  sources: [{ id: 'coindesk', status: 'ready', lastSuccessAt: '2026-10-15T21:32:45.289Z' }, { id: 'abmedia', status: 'error', message: 'HTTP 403', lastSuccessAt: '2026-10-06T08:49:45.788Z' }, { id: 'foresight-calendar', status: 'error', message: 'HTTP 403' }]
});
const latest = {
  schemaVersion: 1, generatedAt: '2026-10-16T03:30:00.000Z',
  sources: [{ id: 'abmedia', status: 'ready', count: 1, lastSuccessAt: '2026-10-16T03:30:00.000Z' }, { id: 'coindesk', status: 'error', message: 'HTTP 403' }],
  news: [
    { id: 'a', title: 'Reviewed', titleZh: '機器翻譯不該覆蓋', link: 'https://www.coindesk.com/a', publishedAt: '2026-10-15T20:00:00Z', summary: 'A summary.', summaryZh: '一段摘要。' },
    { id: 'b', title: 'Pending headline', titleZh: '待翻譯標題', translationStatus: 'translated', link: 'https://cointelegraph.com/b', publishedAt: '2026-10-15T21:00:00Z' },
    { id: 'c', title: '新鏈新聞', titleZh: '新鏈新聞', link: 'https://abmedia.io/c', publishedAt: '2026-10-16T03:00:00Z', sourceId: 'abmedia', markets: ['crypto'] },
    { id: 'd', title: 'Fresh untranslated', titleZh: null, link: 'https://cointelegraph.com/d', publishedAt: '2026-10-16T03:10:00Z', sourceId: 'cointelegraph', markets: ['crypto'] }
  ]
};

test('live headlines are added; existing items only gain missing fields, reviewed text is never overwritten', () => {
  const next = composeSnapshot(base(), { latest });
  assert.equal(next.liveAdded, 2);
  assert.deepEqual(next.news.map(n => n.id), ['c', 'a'], 'translated items, newest first');
  assert.deepEqual(next.pendingNews.map(n => n.id), ['d', 'b']);
  const a = next.news.find(n => n.id === 'a');
  assert.deepEqual([a.titleZh, a.summaryZh], ['已審核標題', '一段摘要。']);
  assert.equal(next.pendingNews.find(n => n.id === 'b').titleZh, '待翻譯標題');
  assert.equal(next.liveAt, latest.generatedAt);
  assert.equal(next.generatedAt, '2026-10-15T21:32:45.289Z', 'the snapshot time stays the snapshot time');
});

test('source health: a newsroom refused by the collector but read live is ready again; a live failure does not mark a good source bad', () => {
  const next = composeSnapshot(base(), { latest });
  assert.deepEqual(['status', 'message'].map(k => next.sources.find(s => s.id === 'abmedia')[k]), ['ready', undefined]);
  assert.equal(next.sources.find(s => s.id === 'coindesk').status, 'ready');
});

test('the browser-read Foresight calendar replaces that provider’s events and keeps translations of unchanged titles', () => {
  const fresh = [{ id: 'foresight:1', sourceId: 'foresight-calendar', title: '旧标题', titleZh: null, date: '2026-10-20', category: 'unlock', markets: ['crypto'] },
    { id: 'foresight:3', sourceId: 'foresight-calendar', title: '新事件', titleZh: null, date: '2026-10-25', category: 'listing', markets: ['crypto'] }];
  const snapshot = base(); snapshot.events.push({ id: 'foresight:0', sourceId: 'foresight-calendar', title: '已过去', titleZh: '已過去', date: '2026-10-10', category: 'unlock', markets: ['crypto'] });
  const next = composeSnapshot(snapshot, { foresight: fresh, foresightAt: '2026-10-16T03:30:00.000Z', now: Date.parse('2026-10-16T03:30:00Z') });
  assert.deepEqual(next.events.map(e => e.id).sort(), ['fed:meeting:2026-10-28', 'foresight:0', 'foresight:1', 'foresight:3'], 'past days keep their history; a future entry missing from the feed is gone');
  assert.equal(next.events.find(e => e.id === 'foresight:1').titleZh, '舊標題');
  assert.deepEqual(next.eventCoverage.map(c => [c.category, c.from, c.to]).sort(), [['listing', '2026-10-25', '2026-10-25'], ['unlock', '2026-10-10', '2026-10-20']]);
  assert.deepEqual(['status', 'access'].map(k => next.sources.find(s => s.id === 'foresight-calendar')[k]), ['ready', 'browser-public-ics']);
});

test('signature changes only when something new arrived', () => {
  const one = composeSnapshot(base(), { latest }), two = composeSnapshot(base(), { latest });
  assert.equal(one.signature, two.signature);
  assert.notEqual(composeSnapshot(base(), {}).signature, one.signature);
});

test('browser translations: batched, remembered, re-applied only while the original text is unchanged', async () => {
  store.clear(); _resetTranslationMemory();
  const items = [{ id: 'x', title: 'Bitcoin climbs', summary: 'Buyers returned.' }, { id: 'y', title: '比特币上涨' }, { id: 'z', title: '已有', titleZh: '已有' }];
  let calls = 0;
  const changed = await translateItems(items, { now: 1000, fetcher: async url => { calls++; return { ok: true, status: 200, json: async () => url.searchParams.getAll('q').map(q => ({ 'Bitcoin climbs': '比特幣上漲', 'Buyers returned.': '買盤回歸。', '比特币上涨': '比特幣上漲' })[q]) }; } });
  assert.equal(calls, 2);
  assert.deepEqual(changed.map(i => i.id).sort(), ['x', 'y']);
  assert.equal(needsTranslation(items[0]), false);
  _resetTranslationMemory();
  const again = [{ id: 'x', title: 'Bitcoin climbs', summary: 'Buyers returned.' }, { id: 'y', title: '比特币上涨（更新）' }];
  assert.equal(applyCachedTranslations(again), 2, 'title and summary of x');
  assert.deepEqual([again[0].titleZh, again[0].summaryZh, again[0].translatedIn], ['比特幣上漲', '買盤回歸。', 'browser']);
  assert.equal(again[1].titleZh, undefined, 'a changed headline waits for a new translation');
});

test('browser translations pause for ten minutes after a refusal', async () => {
  store.clear(); _resetTranslationMemory();
  let calls = 0;
  const refuse = async () => { calls++; return { ok: false, status: 429 }; };
  await translateItems([{ id: 'p', title: 'Refused headline' }], { now: 0, fetcher: refuse });
  const before = calls;
  await translateItems([{ id: 'q', title: 'Another headline' }], { now: 60000, fetcher: refuse });
  assert.equal(calls, before, 'no request during the pause');
  await translateItems([{ id: 'q', title: 'Another headline' }], { now: 700000, fetcher: refuse });
  assert.ok(calls > before, 'tries again after the pause');
});
