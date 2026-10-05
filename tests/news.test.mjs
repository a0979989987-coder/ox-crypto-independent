import test from 'node:test';
import assert from 'node:assert/strict';
import { FEEDS, impact, normalizeFeed, parseBlsCalendar } from '../scripts/collect-news.mjs';

test('news normalization retains only dated HTTPS source headlines', () => {
  const feed = { id: 'bls-cpi', name: 'BLS', url: 'https://www.bls.gov/feed/cpi.rss', markets: ['crypto','tw'] };
  const xml = '<feed><entry><title>Consumer Price Index released</title><link href="https://www.bls.gov/one"/><published>2026-09-24T12:30:00Z</published></entry><entry><title>Undated</title><link href="https://www.bls.gov/two"/></entry></feed>';
  const items = normalizeFeed(xml, feed);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].markets, ['crypto','tw']);
  assert.equal(items[0].impact.stars, null);
});

test('BLS calendar converts confirmed New York release time across daylight saving', () => {
  const html = '<tr><td class="date-cell"><p>Wednesday, October 14, 2026</p></td><td class="time-cell"><p>08:30 AM</p></td><td class="desc-cell"><p><strong>Consumer Price Index</strong> for September 2026</p></td></tr><tr><td class="date-cell"><p>Wednesday, December 9, 2026</p></td><td class="time-cell"><p>08:30 AM</p></td><td class="desc-cell"><p><strong>Employment Situation</strong> for November 2026</p></td></tr>';
  const events = parseBlsCalendar(html, Date.parse('2026-09-24'));
  assert.equal(events[0].occursAt, '2026-10-14T12:30:00.000Z');
  assert.equal(events[1].occursAt, '2026-12-09T13:30:00.000Z');
  assert.equal(events[0].status, 'confirmed');
});

test('unmatched headline has no invented importance score', () => {
  assert.equal(impact('Routine agency publication', 'sec').stars, null);
});

test('major data stars require the matching official source and preserve neutral direction', () => {
  const rated = impact('CPI for all items increases 0.4% in August; gasoline rises', 'bls-cpi', 'https://www.bls.gov/news.release/cpi.htm');
  assert.equal(rated.stars, 5);
  assert.equal(rated.direction, null);
  assert.match(rated.reason, /不表示多空/);
  assert.equal(rated.evidence, 'https://www.bls.gov/news.release/cpi.htm');
  assert.equal(impact('CPI for all items increases', 'bls-cpi', 'https://example.com/news').stars, null);
  assert.equal(impact('Election results announced', 'fed', 'https://www.federalreserve.gov/feeds/press_monetary.xml').stars, null);
});

test('new crypto providers require exact verified official links', () => {
  const github = { id: 'bitcoin-core', name: 'Bitcoin Core', markets: ['crypto'] };
  const entry = url => `<feed><entry><title>Bitcoin Core release</title><link href="${url}"/><published>2026-09-24T12:30:00Z</published></entry></feed>`;
  assert.equal(normalizeFeed(entry('https://github.com/bitcoin/bitcoin/releases/tag/v31.0'), github).length, 1);
  assert.equal(normalizeFeed(entry('https://github.com/fake/bitcoin/releases/tag/v31.0'), github).length, 0);
  assert.equal(normalizeFeed('<feed><entry><title>Bitcoin Core v31.0</title><link rel="self" href="https://github.com/bitcoin/bitcoin/releases.atom"/><link rel="alternate" href="https://github.com/bitcoin/bitcoin/releases/tag/v31.0"/><updated>2026-09-24T12:30:00Z</updated></entry></feed>', github).length, 1);
  assert.equal(normalizeFeed('<rss><channel><item><title>Crypto announcement</title><link>https://www.sec.gov/news/claim</link><pubDate>Thu, 24 Sep 2026 12:30:00 GMT</pubDate></item></channel></rss>', FEEDS.find(feed => feed.id === 'kraken')).length, 0);
});

test('rejects feed entries whose source link leaves the official domains', () => {
  assert.equal(normalizeFeed('<rss><channel><item><title>Claim</title><link>https://example.com/claim</link><pubDate>Thu, 24 Sep 2026 12:30:00 GMT</pubDate></item></channel></rss>', FEEDS[0]).length, 0);
});

import { localize } from '../scripts/collect-news.mjs';
import { readFile } from 'node:fs/promises';

test('published snapshot has Chinese titles and retains official originals', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../data/news.json', import.meta.url)));
  for (const item of [...snapshot.news, ...snapshot.events]) {
    if(item.translationStatus==='original'){assert.ok(item.title&&!item.titleZh);assert.ok(FEEDS.some(f=>f.id===item.sourceId));continue;}
    assert.match(item.titleZh, /[\u4e00-\u9fff]/);
    assert.ok(item.title && item.link.startsWith('https://'));
    assert.equal(item.translationStatus, 'translated');
  }
});

test('translation cannot survive a changed source title or identity', () => {
  const old = { id: 'one', title: 'Original', titleZh: '原始標題' };
  assert.equal(localize(old, [old]).titleZh, '原始標題');
  assert.equal(localize({ ...old, title: 'Correction' }, [old]).translationStatus, 'pending');
  assert.equal(localize({ ...old, id: 'two' }, [old]).titleZh, null);
});

test('reviewed Kraken and Bitcoin headlines have Traditional Chinese titles', () => {
  assert.equal(localize({ id: 'new', title: 'TREAD is available for trading!', kind: 'news' }).titleZh, 'Kraken 開放 TREAD 交易');
  assert.match(localize({ id: 'release', title: 'Bitcoin Core 31.1', kind: 'news' }).titleZh, /正式版本/);
  assert.equal(localize({ id: 'unknown', title: 'Unreviewed new announcement', kind: 'news' }).translationStatus, 'pending');
});

test('calendar translates reporting period without changing release time', () => {
  const event = { kind: 'event', title: 'Consumer Price Index for September 2026', occursAt: '2026-10-14T12:30:00.000Z' };
  const translated = localize(event);
  assert.equal(translated.titleZh, '美國 2026 年 9 月消費者物價指數');
  assert.equal(translated.occursAt, event.occursAt);
  assert.equal(localize({ ...event, title: 'Consumer Price Index for Invalid 2026' }).titleZh, null);
});

test('macro news shared with crypto keeps its official publisher identity', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../data/news.json', import.meta.url)));
  assert.ok(snapshot.news.every(item => item.markets.includes('crypto')));
  assert.equal(snapshot.news.some(item => item.sourceId === 'twse'),false);
  for (const item of snapshot.news.filter(item => ['fed','bls-cpi','bls-jobs','ecb'].includes(item.sourceId))) {
    assert.deepEqual(item.markets,['crypto']);
    if(['fed','bls-cpi','bls-jobs'].includes(item.sourceId))assert.ok(item.markets.includes('crypto'));
    assert.ok(['www.federalreserve.gov','www.bls.gov','www.ecb.europa.eu'].includes(new URL(item.link).hostname));
    assert.notEqual(item.sourceId, 'twse');
  }
});
