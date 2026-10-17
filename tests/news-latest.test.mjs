import test from 'node:test';
import assert from 'node:assert/strict';
import { FEEDS, sourceSummary, normalizeFeed, LIVE_FEED_IDS } from '../server/news/feeds.js';
import { collectLatest, createLatestNewsHandler } from '../server/news/latest.js';

// Synthetic feeds in each publisher's real description format (texts are made up).
const NOW = Date.parse('2026-10-16T03:30:00Z');
const at = hours => new Date(NOW - hours * 3600000).toUTCString();
const rss = items => `<?xml version="1.0"?><rss><channel>${items.join('')}</channel></rss>`;
const item = (title, link, hours, description) => `<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${at(hours)}</pubDate>${description == null ? '' : `<description>${description}</description>`}</item>`;
const FIXTURES = {
  cointelegraph: rss([item('Bitcoin miners slide after hot inflation print', 'https://cointelegraph.com/news/miners-slide', 1,
    '<![CDATA[<p style="float:right; margin:0 0 10px 15px; width:240px;"><img src="https://s3.example/x.jpg" alt="Bitcoin miners slide"></p><p>Listed miners fell as much as 12% after a hotter inflation reading weighed on AI infrastructure names. </p>]]>')]),
  cryptoslate: rss([item('Exchange wallets add 84 million XRP', 'https://cryptoslate.com/xrp-wallets/', 2,
    '<![CDATA[<p>Exchange balances rose by 84 million XRP while the price slipped toward $1.30, a pattern analysts read as selling pressure.</p>\n<p><a href="https://cryptoslate.com/xrp-wallets/">…</a></p>… Join our newsletter for daily updates.]]>')]),
  theblock: rss([item('Bitcoin drops below $81,000', 'https://www.theblock.co/post/1/bitcoin-drops', 3, '<![CDATA[Asian equities fell sharply on Thursday morning while bitcoin lost support near $81,000.]]>'),
    item('Old story', 'https://www.theblock.co/post/2/old', 60, '<![CDATA[Too old for the live window, the snapshot already has it.]]>')]),
  coindesk: rss([item('Crypto policy vacancy at the White House', 'https://www.coindesk.com/policy/2026/10/15/vacancy', 4, '')]),
  odaily: rss([item('美国SOL现货ETF单日净流出981万美元', 'https://www.odaily.news/zh-CN/newsflash/525039', 0.5,
    '&lt;p&gt;Odaily星球日报讯 根据 SoSoValue 数据，昨日 SOL 现货 ETF 单日总净流出 981.79 万美元。&lt;/p&gt;&lt;p&gt;第二段不会出现在摘要。&lt;/p&gt;')]),
  blocktempo: rss([item('以太坊質押量創新高', 'https://www.blocktempo.com/eth-staking-high/', 5,
    '<![CDATA[<p>以太坊質押總量再創新高，鏈上數據顯示機構質押占比持續提升 [&#8230;]</p> 〈<a href="https://www.blocktempo.com/eth-staking-high/">以太坊質押量創新高</a>〉這篇文章最早發佈於《動區BlockTempo》。]]>')]),
};
const BITGET = { code: '00000', data: [{ annTitle: 'Bitget 将上线 ABC/USDT 合约', annUrl: 'https://www.bitget.com/zh-CN/support/articles/1', cTime: String(NOW - 1800000) }] };
const feedFor = url => FEEDS.find(feed => feed.url === String(url));
function fetcher({ failing = [], translate = q => `譯：${q}` } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    const href = String(url); calls.push(href);
    if (href.includes('translate')) { const u = new URL(href); return { ok: true, status: 200, json: async () => u.searchParams.getAll('q').map(translate) }; }
    if (href.includes('api.bitget.com')) return { ok: true, status: 200, text: async () => JSON.stringify(BITGET) };
    const feed = feedFor(href);
    if (!feed || failing.includes(feed.id)) return { ok: false, status: 403, text: async () => '' };
    return { ok: true, status: 200, text: async () => FIXTURES[feed.id] ?? rss([]) };
  };
  fn.calls = calls; return fn;
}

test('source summary: first text paragraph, no image, link, newsletter or "first published" boilerplate', () => {
  const ct = normalizeFeed(FIXTURES.cointelegraph, FEEDS.find(f => f.id === 'cointelegraph'))[0];
  assert.equal(ct.summary, 'Listed miners fell as much as 12% after a hotter inflation reading weighed on AI infrastructure names.');
  const cs = normalizeFeed(FIXTURES.cryptoslate, FEEDS.find(f => f.id === 'cryptoslate'))[0];
  assert.equal(cs.summary, 'Exchange balances rose by 84 million XRP while the price slipped toward $1.30, a pattern analysts read as selling pressure.');
  const bt = normalizeFeed(FIXTURES.blocktempo, FEEDS.find(f => f.id === 'blocktempo'))[0];
  assert.equal(bt.summary, '以太坊質押總量再創新高，鏈上數據顯示機構質押占比持續提升…', 'the publisher cut its teaser, so it stays visibly cut');
  const od = normalizeFeed(FIXTURES.odaily, FEEDS.find(f => f.id === 'odaily'))[0];
  assert.equal(od.summary, '根据 SoSoValue 数据，昨日 SOL 现货 ETF 单日总净流出 981.79 万美元。');
  const cd = normalizeFeed(FIXTURES.coindesk, FEEDS.find(f => f.id === 'coindesk'))[0];
  assert.equal('summary' in cd, false, 'an empty description gives no summary');
});

test('source summary: long text is cut at a sentence, a repeated title is not a summary', () => {
  const long = 'First sentence explains the move in detail for readers. ' + 'Second sentence keeps going with more context and more numbers to read. '.repeat(5);
  assert.equal(sourceSummary(long, 'Title'), 'First sentence explains the move in detail for readers. Second sentence keeps going with more context and more numbers to read. Second sentence keeps going with more context and more numbers to read.');
  assert.equal(sourceSummary('<p>Federal Reserve issues FOMC statement</p>', 'Federal Reserve issues FOMC statement'), null);
  const cjk = '這是第一句很長的中文摘要，內容說明市場變化與資金流向，並且提到多個交易所的數據變化與觀察。' + '第二句繼續補充更多細節與數字，讓摘要超過長度上限以便測試截斷。'.repeat(3);
  const cut = sourceSummary(cjk, '');
  assert.ok(cut.length <= 100 && cut.endsWith('。'), cut);
  assert.equal(sourceSummary('', 'x'), null);
});

test('live endpoint: only the last 36 hours, newest first, every publisher rule from the collector', async () => {
  const body = await collectLatest({ fetcher: fetcher(), now: NOW });
  assert.equal(body.schemaVersion, 1);
  assert.deepEqual(body.news.map(n => n.sourceId), ['odaily', 'bitget', 'cointelegraph', 'cryptoslate', 'theblock', 'coindesk', 'blocktempo']);
  assert.equal(body.news.some(n => n.title === 'Old story'), false);
  assert.equal(body.news.every(n => n.link.startsWith('https://') && n.live === true), true);
  assert.deepEqual(body.sources.map(s => s.id).sort(), [...LIVE_FEED_IDS, 'bitget'].sort());
});

test('live endpoint: Traditional Chinese newsrooms keep their own text; others are machine translated, batched', async () => {
  const fn = fetcher();
  const body = await collectLatest({ fetcher: fn, now: NOW });
  const bt = body.news.find(n => n.sourceId === 'blocktempo');
  assert.deepEqual([bt.titleZh, bt.summaryZh, bt.translationMethod], ['以太坊質押量創新高', '以太坊質押總量再創新高，鏈上數據顯示機構質押占比持續提升…', undefined]);
  const ct = body.news.find(n => n.sourceId === 'cointelegraph');
  assert.equal(ct.titleZh, '譯：Bitcoin miners slide after hot inflation print');
  assert.equal(ct.summaryZh, '譯：Listed miners fell as much as 12% after a hotter inflation reading weighed on AI infrastructure names.');
  assert.equal(ct.summaryMethod, 'machine');
  assert.equal(fn.calls.filter(u => u.includes('translate')).length, 2, 'one English batch and one Simplified Chinese batch');
  assert.deepEqual(body.news.find(n => n.sourceId === 'odaily').assets.map(a => a.symbol), ['SOL']);
});

test('live endpoint: a refused newsroom is reported, the rest still arrive; translation failure leaves titles pending', async () => {
  const body = await collectLatest({ fetcher: fetcher({ failing: ['abmedia', 'coindesk'], translate: () => null }), now: NOW });
  assert.deepEqual(body.sources.filter(s => s.status === 'error').map(s => [s.id, s.message]), [['abmedia', 'HTTP 403'], ['coindesk', 'HTTP 403']]);
  assert.equal(body.news.some(n => n.sourceId === 'coindesk'), false);
  const ct = body.news.find(n => n.sourceId === 'cointelegraph');
  assert.deepEqual([ct.titleZh, ct.translationStatus], [null, 'pending']);
});

function response() {
  const headers = {}; let resolve;
  const done = new Promise(r => { resolve = r; });
  return { headers, done, statusCode: 200, setHeader(k, v) { headers[k.toLowerCase()] = v; }, end(body) { this.body = body; resolve(); } };
}
test('handler: CDN-cacheable JSON for GET, short cache when every source fails, 405 otherwise', async () => {
  const ok = response();
  await createLatestNewsHandler({ fetcher: fetcher(), now: () => NOW })({ method: 'GET' }, ok);
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers['cache-control'], /s-maxage=180/);
  assert.equal(JSON.parse(ok.body).news.length, 7);
  const down = response();
  await createLatestNewsHandler({ fetcher: async () => ({ ok: false, status: 503, text: async () => '' }), now: () => NOW })({ method: 'GET' }, down);
  assert.equal(down.statusCode, 502);
  assert.match(down.headers['cache-control'], /s-maxage=30/);
  const post = response();
  await createLatestNewsHandler({ fetcher: fetcher() })({ method: 'POST' }, post);
  assert.equal(post.statusCode, 405);
});
