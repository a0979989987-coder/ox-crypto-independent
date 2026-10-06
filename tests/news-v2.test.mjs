import test from 'node:test';
import assert from 'node:assert/strict';
import { monthGrid, eventDay, taipeiDay, importance, monthEvents, defaultState, newsBase, filterNews, ranking, dedupe, hotWords, safeLink, validDate, sourcesFor, coverage, agendaDays, upcomingEventDays } from '../src/components/news/model.js';
import { MARKET_CATEGORIES } from '../src/components/news/config.js';
import { identifyAssets, governanceEvents } from '../scripts/news-providers.mjs';
import { parseBlsCalendar, normalizeFeed } from '../scripts/collect-news.mjs';
import { readFile } from 'node:fs/promises';
const now = Date.parse('2026-10-02T02:00:00Z');
// Explicit test fixtures. These records are never consumed by the collector or product.
const article = (id, hours, extra = {}) => ({ id, title: 'Test verified article', titleZh: '測試新聞', sourceId: 'abmedia', link: `https://abmedia.io/${id}`, publishedAt: new Date(now - hours * 3600000).toISOString(), markets: ['crypto'], ...extra });
test('calendar builds five and six weeks including correctly placed leap day', () => {
  assert.equal(monthGrid('2026-10').weeks, 5); assert.equal(monthGrid('2026-08').weeks, 6);
  assert.equal(monthGrid('2026-08').cells[5].date, '2026-08-01');
  assert.equal(monthGrid('2024-02').cells.filter(c => !c.outside).length, 29);
  assert.equal(monthGrid('2026-08').cells.at(-1).date, '2026-09-06');
});
test('pure dates remain dates, timestamps use Taipei across international day boundaries', () => {
  assert.equal(eventDay({ date: '2026-10-02', occursAt: null }), '2026-10-02');
  assert.equal(eventDay({ occursAt: '2026-10-01T23:00:00Z' }), '2026-10-02');
  assert.equal(taipeiDay('2026-10-01T16:00:00Z'), '2026-10-02');
  assert.equal(validDate('2026-02-30'), false); assert.equal(validDate('2026-99-02'), false);
});
test('month lookup retains historical events and scopes market-specific types', () => {
  const state = { ...defaultState(), month: '2026-09' };
  const snapshot = { events: [{ id: 'past', occursAt: '2026-09-01T12:30:00Z', sourceId: 'bls-calendar', markets: ['crypto', 'tw'] }, { id: 'div', date: '2026-09-10', category: 'dividend', markets: ['tw'] }] };
  assert.equal(monthEvents(snapshot, 'crypto', state).length, 1); assert.equal(monthEvents(snapshot, 'all', state).length, 1);assert.equal(monthEvents(snapshot, 'tw', state).length, 0);
  assert.equal(MARKET_CATEGORIES.crypto.includes('dividend'), false);
});
test('agenda retains all upcoming recorded dates, chronologically groups busy days and shares filters',()=>{
 const state={...defaultState(),month:'2026-10'},snapshot={events:[
 {id:'jan',date:'2027-01-15',markets:['crypto'],category:'macro',impact:{stars:5}},
 {id:'late',occursAt:'2026-10-09T10:00:00Z',markets:['crypto'],category:'macro',impact:{stars:5}},
 {id:'early',occursAt:'2026-10-09T02:00:00Z',markets:['crypto'],category:'network',impact:{stars:1}},
 {id:'old',date:'2026-09-30',markets:['crypto']},{id:'taiwan-only',date:'2026-10-01',markets:['tw']},
 {id:'early',occursAt:'2026-10-09T02:00:00Z',markets:['crypto']},{id:'invalid',date:'2026-99-99',markets:['crypto']}]};
 const days=agendaDays(snapshot,'crypto',state);assert.deepEqual(days.map(d=>d.date),['2026-10-09','2027-01-15']);assert.deepEqual(days[0].events.map(e=>e.id),['early','late']);
 assert.equal(agendaDays(snapshot,'crypto',{...state,categories:['macro'],importance:true}).flatMap(d=>d.events).length,2);
 assert.equal(agendaDays(snapshot,'crypto',{...state,categories:[]}).length,0);
});
test('importance retains each of the five ratings', () => {
  for (const [raw, expected] of [[1,1],[2,2],[3,3],[4,4],[5,5]]) { const item = { impact: { stars: raw, ruleVersion: 'source-rule' } }; assert.equal(importance(item).value, expected); assert.equal(item.impact.stars, raw); }
  assert.equal(importance({ impact: { stars: null } }).value, null);
});
test('time multiselect is a union and uses publication rather than fetch time', () => {
  const snapshot = { news: [article('a', 2), article('b', 20), article('c', 26, { fetchedAt: new Date(now).toISOString() })] };
  const state = { ...defaultState(), times: ['3', '24'] };
  assert.deepEqual(newsBase(snapshot, 'crypto', state, {}, now).map(i => i.id), ['a', 'b']);
  state.times = []; assert.equal(newsBase(snapshot, 'crypto', state, {}, now).length, 0);
});
test('all sources, no sources and multiple source identities are different', () => {
  const snapshot = { news: [article('a', 2), article('b', 3, { sourceId: 'ethereum' })] }, state = defaultState();
  assert.equal(newsBase(snapshot, 'crypto', state, {}, now).length, 2); state.sources = []; assert.equal(newsBase(snapshot, 'crypto', state, {}, now).length, 0);
  state.sources = ['ethereum']; assert.equal(newsBase(snapshot, 'crypto', state, {}, now)[0].sourceId, 'ethereum');
});
test('canonical reposts and repeated crypto asset mentions count once', () => {
  const asset = { id: 'crypto:bitcoin', market: 'crypto', symbol: 'BTC', name: '比特幣' };
  const a = article('a', 1, { title: 'Bitcoin ETF decision arrives today', assets: [asset, asset] }), b = { ...a, id: 'b', link: `${a.link}?utm_source=yahoo` };
  assert.equal(dedupe([a,b]).length, 1); assert.equal(ranking(dedupe([a,b]))[0].count, 1);

});
test('asset matching uses market identities and rejects ambiguous ordinary acronyms', () => {
  assert.equal(identifyAssets('Bitcoin 與 BTC 今日', ['crypto']).filter(a => a.symbol === 'BTC').length, 1);
  assert.equal(identifyAssets('NEAR the LINK', ['crypto']).length, 0);
  assert.equal(identifyAssets('比特幣', ['tw']).length, 0);
});
test('hotwords use the article subset and exclude numeric fragments and stopwords', () => {
  const words = hotWords([article('a', 1, { titleZh: '台積電先進封裝 0 月 0 億 最新新聞' })]).map(([w]) => w);
  assert.equal(words.some(w => /^\d/.test(w)), false); assert.equal(words.includes('最新'), false); assert.ok(words.length);
});
test('keyword union, text search and asset filter compose independently', () => {
  const items = [article('a', 1, { titleZh: '比特幣 ETF 核准', assets: [{ id: 'btc', symbol: 'BTC', name: '比特幣' }] }), article('b', 1, { titleZh: '以太坊 升級', assets: [{ id: 'eth', symbol: 'ETH', name: '以太坊' }] })];
  const state = { ...defaultState(), words: ['比特幣','以太坊'] }; assert.equal(filterNews(items, state).length, 2); state.query = 'BTC'; assert.equal(filterNews(items, state).length, 1);
});
test('source missing, failed and successfully empty states remain distinguishable', () => {
  const snapshot = { generatedAt: '2026-10-02T00:00:00Z', sources: [{ id: 'abmedia', status: 'ready', count: 0 }, { id: 'ethereum', status: 'error' }] };
  const sources = sourcesFor(snapshot, 'crypto'); assert.equal(sources.find(s => s.id === 'abmedia').count, 0); assert.equal(sources.find(s => s.id === 'ethereum').status, 'error'); assert.equal(sources.find(s => s.id === 'theblock').status, 'not-connected');
  assert.equal(coverage(snapshot, 'crypto', '2025-01').complete, false);
});
test('BLS historical release days remain queryable and DST retains exact times', () => {
  const html = '<tr><td class="date-cell"><p>Friday, January 9, 2026</p></td><td class="time-cell"><p>08:30 AM</p></td><td class="desc-cell"><p><strong>Employment Situation</strong> for December 2025</p></td></tr>';
  assert.equal(parseBlsCalendar(html, now)[0].occursAt, '2026-01-09T13:30:00.000Z');
});
test('governance timestamps require the verified official space and keep the proposal original', () => {
  const proposals = [{id:'abc123',title:'Original proposal',space:{id:'aave.eth'},start:now/1000,end:now/1000+3600},{id:'fake',title:'Fake',space:{id:'other.eth'},start:1,end:2}];
  const events = governanceEvents(proposals); assert.equal(events.length,2); assert.equal(events[0].proposalTitle,'Original proposal'); assert.equal(events[0].status,'confirmed'); assert.equal(events[1].occursAt,new Date(now).toISOString()); assert.equal(events[1].endsAt,events[0].occursAt); assert.ok(events[1].id.endsWith(':start'));
});
test('untrusted XML declarations, unsafe protocols and mismatched publisher links are rejected', () => {
  assert.equal(safeLink('javascript:alert(1)'), null); assert.equal(safeLink('https://user:secret@example.com'), null);
  assert.throws(() => normalizeFeed('<!DOCTYPE rss><rss/>', { id: 'abmedia', url: 'https://abmedia.io/feed' }));
  assert.equal(normalizeFeed('<rss><channel><item><title>Misleading</title><link>https://evil.example/news</link><pubDate>Fri, 02 Oct 2026 01:00:00 GMT</pubDate></item></channel></rss>', { id:'abmedia',url:'https://abmedia.io/feed',markets:['crypto'] }).length,0);
});
test('preview collection is isolated from production writes and does not alter global market IDs', async () => {
  const workflow = await readFile(new URL('../.github/workflows/news-preview.yml', import.meta.url),'utf8'); assert.match(workflow,/contents: read/); assert.doesNotMatch(workflow,/git push|HEAD:main|schedule:/);
  const quick = await readFile(new URL('../src/components/navigation/market-quick-switch.js', import.meta.url),'utf8'); const declared=quick.slice(quick.indexOf('const MARKETS'),quick.indexOf('const MENU_ID')); assert.match(declared,/id: "crypto"/);assert.doesNotMatch(declared,/id: "tw"/);assert.doesNotMatch(declared,/id: "us"|id: "news"/);
  assert.doesNotMatch(await readFile(new URL('../src/core/config.js',import.meta.url),'utf8'),/"us"/);
});
test('headline aliases aggregate into the verified asset name and media does not get official confidence', async () => {
  const { impact, cryptoRelevant } = await import('../scripts/collect-news.mjs');
  const a = { id:'crypto:bitcoin',market:'crypto',symbol:'BTC',name:'比特幣',aliases:['Bitcoin'] };
  const words = hotWords([article('a', 1, { titleZh:'BTC 比特幣 Bitcoin ETF', assets:[a] })]);
  assert.equal(words.filter(([w]) => ['BTC','Bitcoin','比特幣'].includes(w)).length,1);
  assert.equal(impact('Bitcoin ETF','coindesk','https://www.coindesk.com/test').sourceConfidence,null);
  assert.equal(cryptoRelevant('Apple announces a new iPhone'),false);
});

test('upcoming dates omit empty future groups and isolate market-specific events even in a legacy mixed snapshot', () => {
 const snapshot={events:[
 {id:'tw',date:'2026-10-05',category:'dividend',markets:['tw']},
 {id:'eth',date:'2026-10-06',category:'network',markets:['crypto','tw'],kind:'event'},
 {id:'macro',date:'2026-10-07',category:'macro',markets:['crypto','tw']},
 {id:'late',date:'2026-10-13',category:'macro',markets:['tw']} ]};
 const state=defaultState();
 const tw=upcomingEventDays(snapshot,'tw',state,'2026-10-05');
 assert.deepEqual(tw.map(d=>d.date),['2026-10-05']);
 const crypto=upcomingEventDays(snapshot,'crypto',state,'2026-10-05');
 assert.deepEqual(crypto.map(d=>d.events.map(e=>e.id)),[[],['eth'],['macro']]);
 assert.deepEqual(upcomingEventDays(snapshot,'tw',{...state,categories:[]},'2026-10-05').map(d=>d.date),['2026-10-05']);
 assert.equal(monthEvents(snapshot,'tw',{...state,month:'2026-10'}).some(e=>e.id==='eth'),false);
 assert.equal(agendaDays(snapshot,'tw',{...state,month:'2026-10'}).flatMap(d=>d.events).some(e=>e.id==='eth'),false);
});
