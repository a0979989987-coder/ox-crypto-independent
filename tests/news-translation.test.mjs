import test from 'node:test';import assert from 'node:assert/strict';
import {translateHeadlines} from '../scripts/news-translation.mjs';
import {translateFields, parseBatch, acceptTranslation, MT_ENDPOINTS} from '../server/news/translate.js';
// The /translate_a/t endpoint answers one entry per q=, in order.
const reply = list => ({ ok: true, status: 200, json: async () => list });
const fake = map => async url => reply(url.searchParams.getAll('q').map(q => map[q] ?? q));

test('headlines receive Traditional Chinese translations while reviewed titles and numeric placeholders stay untouched',async()=>{
 const items=[{title:'Crypto market update'},{title:'Reviewed headline',titleZh:'已核對標題'},{title:'00416a'}];let calls=0;
 const result=await translateHeadlines(items,{fetcher:async url=>{calls++;assert.equal(url.searchParams.get('tl'),'zh-TW');assert.deepEqual(url.searchParams.getAll('q'),['Crypto market update']);return reply(['加密市場動態']);}});
 assert.equal(calls,1);assert.equal(items[0].titleZh,'加密市場動態');assert.equal(items[0].translationMethod,'machine-title-only');assert.equal(items[1].titleZh,'已核對標題');assert.equal(result.translated,1);
});
test('translation errors never claim completion or fabricate an original-language title',async()=>{const items=[{title:'English news'}];await translateHeadlines(items,{fetcher:async()=>reply(['English news'])});assert.equal(items[0].titleZh,undefined);assert.equal(items[0].translationStatus,undefined);});

test('English and Simplified Chinese never share a request (sl=auto would leave one language untranslated)', async () => {
  const seen = [];
  const items = [{ title: 'Bitcoin rallies' }, { title: '比特币上涨' }, { title: 'ETH ETF inflows' }];
  await translateFields(items, { fetcher: async url => { seen.push([url.searchParams.get('sl'), url.searchParams.getAll('q')]); return reply(url.searchParams.getAll('q').map(q => ({ 'Bitcoin rallies': '比特幣上漲', 'ETH ETF inflows': '以太坊 ETF 資金流入', '比特币上涨': '比特幣上漲' })[q])); } });
  assert.deepEqual(seen, [['en', ['Bitcoin rallies', 'ETH ETF inflows']], ['zh-CN', ['比特币上涨']]]);
  assert.deepEqual(items.map(i => i.titleZh), ['比特幣上漲', '比特幣上漲', '以太坊 ETF 資金流入']);
});

test('summaries are translated with titles and marked as machine translations', async () => {
  const items = [{ title: 'Solana upgrade', summary: 'The upgrade cuts finality to 150 ms.' }];
  const result = await translateFields(items, { fetcher: fake({ 'Solana upgrade': 'Solana 升級', 'The upgrade cuts finality to 150 ms.': '此次升級把最終確認時間縮短到 150 毫秒。' }) });
  assert.equal(result.requests, 1);
  assert.deepEqual([items[0].titleZh, items[0].summaryZh, items[0].summaryMethod], ['Solana 升級', '此次升級把最終確認時間縮短到 150 毫秒。', 'machine']);
});

test('batches stay within the URL budget and the text count', async () => {
  const items = Array.from({ length: 45 }, (_, i) => ({ title: `Headline number ${i} about bitcoin markets` }));
  const sizes = [];
  await translateFields(items, { fetcher: async url => { sizes.push(url.searchParams.getAll('q').length); assert.ok(url.href.length < 7000); return reply(url.searchParams.getAll('q').map(q => '中文 ' + q)); } });
  assert.deepEqual(sizes, [20, 20, 5]);
  assert.equal(items.every(i => i.titleZh?.startsWith('中文')), true);
});

test('a rate-limited endpoint is skipped for the rest of the run; the fallback endpoint carries on', async () => {
  const hosts = [];
  const items = Array.from({ length: 25 }, (_, i) => ({ title: `English ${i} news` }));
  const result = await translateFields(items, { concurrency: 1, fetcher: async url => { hosts.push(url.hostname); return url.hostname === new URL(MT_ENDPOINTS[0]).hostname ? { ok: false, status: 429 } : reply(url.searchParams.getAll('q').map(q => '譯 ' + q)); } });
  assert.deepEqual(hosts, ['translate.googleapis.com', 'clients5.google.com', 'clients5.google.com']);
  assert.equal(result.translated, 25);
  assert.equal(result.reason, 'translation-rate-limited');
});

test('response parsing accepts strings and [text, language] pairs, nothing else', () => {
  assert.deepEqual(parseBatch(['甲', ['乙', 'en']], 2), ['甲', '乙']);
  assert.equal(parseBatch(['甲'], 2), null, 'count mismatch is not a translation');
  assert.deepEqual(parseBatch('甲', 1), ['甲']);
  assert.deepEqual(parseBatch([[['甲', 'x']]], 1), [null]);
  assert.equal(acceptTranslation('English', 'English', 'en'), null);
  assert.equal(acceptTranslation('资金流出', '資金流出', 'zh-CN'), '資金流出');
  assert.equal(acceptTranslation('已是繁體', '已是繁體', 'zh-CN'), '已是繁體', 'Traditional text stays itself');
});
