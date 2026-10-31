// The hourly radar snapshot in the page (fixture Bitget market, no network):
//   fresh   lists paint from the snapshot while every candle request is still held,
//           both directions switch, only candidates + most traded coins are re-checked
//   stale   lists paint, then the full scan runs (candidates first)
//   github  the same-origin placeholder is skipped for the live-data branch copy (Vercel)
//   missing the empty placeholder and a missing GitHub copy fall back to the scan
//   repeat  a second visit paints from this device's cache without any snapshot
//   OX_TEST_BROWSER=<chrome> node scripts/crypto-radar-snapshot-ui-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { FEATURE_CATALOG } from '../server/account/feature-catalog.js';
import { collectRadar } from './collect-crypto-radar.mjs';
process.env.OX_E2E_PORT = '4299';
const { server, preparePage, testBase, bitgetBody } = createRequire(import.meta.url)('./e2e-check.cjs');
const HOUR = 3600000;
await new Promise(resolve => server.listen(4299, '127.0.0.1', resolve));

// The snapshot the job would write for this fixture market.
const { snapshot } = await collectRadar({ json: async url => ({ ...bitgetBody(new URL(url)), requestTime: String(Date.now()) }) });
const shifted = minutes => ({ ...snapshot, generatedAt: snapshot.generatedAt - minutes * 60000, startedAt: snapshot.startedAt - minutes * 60000,
  closes: { ...snapshot.closes, '1H': Math.floor((snapshot.startedAt - minutes * 60000) / HOUR) * HOUR } });
const expected = side => ['t1', 't2', 't3'].flatMap(t => snapshot.tiers[side][t]);
assert.ok(expected('long').length && expected('short').length, 'the fixture has both directions');

const browser = await chromium.launch({ headless: true, executablePath: process.env.OX_TEST_BROWSER || undefined, args: ['--no-sandbox'] });
const profile = await mkdtemp(join(tmpdir(), 'ox-radar-profile-'));
const results = [];
async function visit(name, { serve = null, github = null, holdCandles = false, width = 390, persistent = null, view = 'home' } = {}) {
  const options = { locale: 'zh-TW', viewport: { width, height: 844 } };
  const context = persistent ? await chromium.launchPersistentContext(persistent, { ...options, headless: true, executablePath: process.env.OX_TEST_BROWSER || undefined, args: ['--no-sandbox'] }) : await browser.newContext(options);
  let release; const held = new Promise(resolve => release = resolve);
  try {
    const { page, audit } = await preparePage(context, { width, height: 844 });
    await page.route('**/api/v1/account/**', route => { const id = new URL(route.request().url()).pathname.split('/').at(-1);
      return route.fulfill({ json: id === 'feature-access' ? { ok: true, features: FEATURE_CATALOG.map(f => ({ ...f, mode: 'public', version: 'fixture' })) } : id === 'session' ? { ok: true, user: null } : { configured: false } }); });
    let candleRequests = 0;
    await page.route('https://api.bitget.com/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/candles')) { candleRequests++; if (holdCandles) await held; }
      await route.fulfill({ json: { ...bitgetBody(url), requestTime: String(Date.now()) } });
    });
    if (serve) await page.route('**/data/crypto-radar.json*', route => route.fulfill({ json: serve }));
    if (github) await page.route('https://raw.githubusercontent.com/**/live-data/crypto-radar.json', route => route.fulfill({ json: github, headers: { 'access-control-allow-origin': '*' } }));
    const started = Date.now();
    await page.goto(testBase + '/', { waitUntil: 'domcontentloaded' });
    if (view === 'home') await page.locator('.app-dock [data-view-target="home"]').click();
    // 行情 opens on 圖表, the chart with the radar list beside it.
    else { await page.waitForFunction(() => !!window.OXMarketTabs, null, { timeout: 20000 }); await page.locator('.app-dock [data-view-target="strength"]').click(); }
    const list = view === 'home' ? '#home-t1-long-list [data-home-symbol], #home-t1-short-list [data-home-symbol]' : '#screener-list .coin-card[data-tier]';
    await page.locator(list).first().waitFor({ timeout: 20000 });
    const firstPaintMs = Date.now() - started;
    // The pass is planned once the live quote list is in.
    await page.waitForFunction(() => state.scanQueue.length > 0, null, { timeout: 20000 });
    const info = await page.evaluate(() => { const g = globalThis.eval; return { queue: g('state.scanQueue.length'), total: g('state.tickers.length'), label: document.querySelector('[data-radar-freshness]')?.textContent || '',
      ready: g('state.radarSnapshotReady'), long: ['t1', 't2', 't3'].flatMap(t => g('state.tierMapBySide').long[t].map(r => r.symbol)), short: ['t1', 't2', 't3'].flatMap(t => g('state.tierMapBySide').short[t].map(r => r.symbol)) }; });
    return { page, audit, info, firstPaintMs, candleRequests: () => candleRequests, release, context };
  } catch (error) { release(); await context.close(); throw error; }
}
const done = async v => { v.release(); assert.deepEqual(v.audit.pageErrors, []); await v.context.close(); };

try {
  // Fresh: everything from the snapshot while no candle has answered.
  let v = await visit('fresh', { serve: snapshot, holdCandles: true });
  assert.match(v.info.label, /^\d\d:\d\d 收盤・更新中$/);
  assert.deepEqual(v.info.long, expected('long')); assert.deepEqual(v.info.short, expected('short'));
  assert.ok(v.info.ready);
  assert.ok(v.info.queue < v.info.total || v.info.total <= 62, 'only candidates and the most traded coins');
  await v.page.locator('.app-dock [data-view-target="strength"]').click();
  // 行情 opens on 圖表: the list beside the chart paints from the snapshot too, with its close time.
  assert.equal(await v.page.evaluate(() => OXMarketTabs.current()), 'chart');
  await v.page.locator('#view-radar .workspace #screener-list .coin-card[data-tier]').first().waitFor();
  assert.deepEqual(await v.page.locator('#screener-list .coin-card[data-tier]').evaluateAll(cards => cards.map(c => c.dataset.symbol)), expected('long'));
  assert.match(await v.page.locator('#screener-list').evaluate(el => el.previousElementSibling?.textContent || ''), /^\d\d:\d\d 收盤・更新中/);
  await v.page.evaluate(() => OXMarketTabs.select('radar'));
  await v.page.locator('#ox-market-radar #screener-list .coin-card[data-tier]').first().waitFor();
  const longCards = await v.page.locator('#screener-list .coin-card[data-tier]').evaluateAll(cards => cards.map(c => c.dataset.symbol));
  assert.deepEqual(longCards, expected('long'));
  await v.page.locator('#direction-toggle').click();
  await v.page.waitForFunction(() => state.directionFilter === 'short');
  const shortCards = await v.page.locator('#screener-list .coin-card[data-tier]').evaluateAll(cards => cards.map(c => c.dataset.symbol));
  assert.deepEqual(shortCards, expected('short'));
  assert.match(await v.page.locator('#screener-list').evaluate(el => el.previousElementSibling?.textContent || ''), /收盤・更新中/);
  results.push({ case: 'fresh', firstPaintMs: v.firstPaintMs, label: v.info.label, long: longCards.length, short: shortCards.length, heldCandles: v.candleRequests() });
  // Releasing the candles finishes the re-check; the label then shows the update time.
  v.release();
  await v.page.waitForFunction(() => /已更新$/.test(document.querySelector('[data-radar-freshness]')?.textContent || ''), null, { timeout: 30000 });
  await done(v);

  // Stale (previous candle): the snapshot still paints, then a full pass runs.
  v = await visit('stale', { serve: shifted(70), holdCandles: true });
  assert.ok(v.info.long.length || v.info.short.length);
  assert.equal(v.info.queue, v.info.total, 'a full pass');
  assert.match(v.info.label, /收盤・更新中/);
  results.push({ case: 'stale', firstPaintMs: v.firstPaintMs, label: v.info.label, queue: v.info.queue });
  await done(v);

  // On Vercel: the same-origin file is the empty placeholder, the live-data branch has it.
  v = await visit('github', { github: snapshot, holdCandles: true, view: 'list' });
  assert.deepEqual(v.info.long, expected('long'));
  assert.match(v.info.label, /收盤・更新中/);
  results.push({ case: 'github', firstPaintMs: v.firstPaintMs, label: v.info.label });
  await done(v);

  // Missing: the empty placeholder, GitHub 404, then the page's own scan as before.
  v = await visit('missing', { view: 'list' });
  assert.equal(v.info.label, '');
  results.push({ case: 'missing', firstPaintMs: v.firstPaintMs, queue: v.info.queue });
  await done(v);

  // Repeat visit: the first visit's results come back from this device, offline from GitHub.
  v = await visit('first', { serve: snapshot, persistent: profile });
  await v.page.waitForTimeout(2000);
  await done(v);
  v = await visit('repeat', { persistent: profile, holdCandles: true, view: 'list' });
  assert.match(v.info.label, /收盤/);
  assert.deepEqual(v.info.long, expected('long'));
  results.push({ case: 'repeat', firstPaintMs: v.firstPaintMs, label: v.info.label });
  await done(v);
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
  await new Promise(resolve => server.close(resolve));
}
