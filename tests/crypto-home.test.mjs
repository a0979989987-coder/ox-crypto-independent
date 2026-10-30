import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { pickNews } from '../src/markets/crypto/home-feed.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('此刻發生 picks three current crypto headlines, the same story once (the newer report), newest first', () => {
  const now = Date.parse('2026-10-31T02:00:00Z'), at = hours => new Date(now - hours * 3600e3).toISOString();
  const item = (id, title, hours, extra = {}) => ({ id, titleZh: title, title, link: `https://news.example/${id}`, publishedAt: at(hours), source: '來源', markets: ['crypto'], contentType: 'news', ...extra });
  const snapshot = { news: [
    item('etf', '貝萊德比特幣 ETF 單日流入 3.2 億美元', 3),
    item('etf-copy', 'BlackRock 比特幣 ETF 流入 3.2 億美元創新高', 2),
    item('fed', '聯準會鮑爾：12 月降息仍有討論空間', 6),
    item('liq', '全網 24 小時爆倉 5.6 億美元，多單為主', 1),
    item('airdrop', '必看！三個潛力幣空投教學', 0.5),
    item('old', '比特幣跌破 7 萬美元', 30),
    item('promo', '交易所 ETF 活動送 USDT', 1, { contentType: 'promotion' }),
    item('english', '', 1, { titleZh: '', title: 'Bitcoin ETF flows' }),
    item('stocks', '台積電法說會重點', 1, { markets: ['tw'] }),
    item('bad-link', '比特幣 ETF 資金流向', 1, { link: 'javascript:alert(1)' })
  ], pendingNews: [] };
  const picked = pickNews(snapshot, { now });
  assert.deepEqual(picked.map(i => i.id), ['liq', 'etf-copy', 'fed']);
  // A quiet market: older headlines fill in up to a day back, never older.
  assert.deepEqual(pickNews({ news: [item('day', '以太坊 ETF 淨流出', 20), item('old', '比特幣 ETF', 30)] }, { now }).map(i => i.id), ['day']);
  assert.deepEqual(pickNews(null, { now }), []);
});

test('首頁 numbers: 市場寬度 counts every coin, the median 24H change, and BTC change as amount（%）', async () => {
  const source = await read('src/app/view-home-theme.js');
  const fns = source.slice(source.indexOf('function homeBreadth('), source.indexOf('function renderHomeQuotes('));
  const fmtPrice = v => new Intl.NumberFormat('en-US', { maximumFractionDigits: v >= 1000 ? 2 : 4 }).format(v);
  const fmtPct = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
  const { homeBreadth, homeChangeText } = runInNewContext(`${fns}\n({ homeBreadth, homeChangeText })`, { state: { tickers: [] }, fmtPrice, fmtPct });
  const tickers = ['0.05', '-0.02', '0', '0.01', '-0.1', 'x'].map((change24h, i) => ({ symbol: `C${i}USDT`, change24h }));
  assert.deepEqual({ ...homeBreadth(tickers) }, { up: 2, down: 2, total: 5, median: 0 });
  assert.equal(homeBreadth([]).median, null);
  assert.equal(homeChangeText({ lastPr: '76825.4', change24h: '-0.03442' }), '-2,738.59（-3.44%）');
  assert.equal(homeChangeText({ lastPr: '2.5', change24h: '0.25' }), '+0.5（+25.00%）');
  assert.equal(homeChangeText(null), '—');
});

test('首頁 markup: BTC with 畫型態 and the picture button, tiles, 今日突破, both radar lists, 此刻發生', async () => {
  const html = await read('index.html');
  const home = html.slice(html.indexOf('id="view-home"'), html.indexOf('id="view-radar"'));
  for (const part of ['BTC 永續・即時', 'id="home-btc-price"', 'id="home-btc-change"', 'data-home-go="board"', 'ox-home-share', '市場寬度', 'id="home-breadth-up"',
    'id="home-eth-price"', 'id="home-sol-price"', 'data-home-breaks', '今日突破', 'data-home-go="compare"', 'oxh-radar-head', 'data-radar-freshness',
    'id="home-t1-long-list"', 'id="home-t1-short-list"', '此刻發生', 'data-home-go="news"', 'crypto-home.css?v='])
    assert.ok(home.includes(part), part);
  // The gauges and the BTC chart are gone; 市場強度 lives on the 市場指標 page.
  for (const gone of ['home-btc-strength', 'home-alt-strength', 'home-market-score', 'home-btc-mini-chart', 'data-home-mini-tf'])
    assert.ok(!home.includes(gone), gone);
  // The hourly snapshot's 「收盤・更新中」 label and the scan's progress find the new lists.
  assert.match(await read('src/markets/crypto/radar-snapshot.js'), /#view-home \.oxh-radar-head/);
  assert.match(await read('src/components/loading-state.js'), /#view-home \.oxh-radar/);
});
