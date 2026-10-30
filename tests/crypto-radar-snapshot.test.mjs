// The hourly radar snapshot: the collector runs the page's own scan, the page restores
// it into the same ranking, and the publisher never rewinds or bloats main.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRadarRuntime } from '../scripts/crypto-radar-runtime.mjs';
import { collectRadar, createBitgetTransport, latestClose, tierSymbols } from '../scripts/collect-crypto-radar.mjs';
import { checkSnapshot, isNewer, publishBranch, publishSites } from '../scripts/publish-crypto-radar.mjs';
import { releaseFiles } from '../scripts/publish-site-data.mjs';
import { decide } from '../scripts/trigger-crypto-radar.mjs';
import { publishData, DATA_POINTER, sha256 } from '../worker/data-store.js';
import { DATA_WORKFLOWS, LIVE_DATA, DATA_FILE } from '../worker/site.js';

const HOUR = 3600000;
// Values from the vm realm (the page runtime) compare by content.
const plain = value => JSON.parse(JSON.stringify(value));
const same = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);
// A small Bitget market: rising coins tested under a ceiling with directional volume and
// their mirror images, so both directions have candidates, plus a thin new listing.
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'SUIUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'NEWUSDT'];
function market(now = Date.now()) {
  const tickers = SYMBOLS.map((symbol, i) => ({ symbol, lastPr: String(i ? 3200 / (i + 1) : 63250), change24h: String((i % 2 ? -1 : 1) * (.012 + i * .003)),
    usdtVolume: String(i === 11 ? 500000 : 900000000 - i * 40000000), high24h: '65000', low24h: '61000', ts: String(now) }));
  const contracts = SYMBOLS.map(symbol => ({ symbol, baseCoin: symbol.replace('USDT', ''), quoteCoin: 'USDT', symbolStatus: 'normal', symbolType: 'perpetual' }));
  const instruments = SYMBOLS.map(symbol => ({ symbol, symbolType: 'crypto', type: 'perpetual', status: 'online', quoteCoin: 'USDT', isRwa: 'NO' }));
  const candles = (symbol, granularity) => {
    const i = SYMBOLS.indexOf(symbol), duration = { '1H': HOUR, '4H': 4 * HOUR, '1D': 24 * HOUR }[granularity];
    const boundary = Math.floor(now / duration) * duration, bullish = i % 2 === 0, scale = Number(tickers[i].lastPr) / (bullish ? 99.5 : 100.5), out = [];
    const count = symbol === 'NEWUSDT' ? 20 : 80;
    for (let k = 0; k < count; k++) {
      let close = k >= 62 ? 94 + (k - 62) * (.3 + i * .01) : 95 + Math.sin(k * Math.PI / 8) * 2;
      const open = out.at(-1)?.close ?? close - .2;
      out.push({ open, close, high: [16, 32, 48].includes(k) ? 100 : Math.max(open, close) + .25, low: Math.min(open, close) - .25, volume: k >= 70 ? 1800 + i * 40 : 1000 });
    }
    // The newest bar is the candle still forming, like Bitget's own series.
    return out.map((c, k) => { const bar = bullish ? c : { ...c, open: 200 - c.open, close: 200 - c.close, high: 200 - c.low, low: 200 - c.high };
      return [boundary - (count - 1 - k) * duration, bar.open * scale, bar.high * scale, bar.low * scale, bar.close * scale, bar.volume, bar.close * scale * bar.volume].map(String); });
  };
  const requests = [];
  const json = async url => {
    const u = new URL(url); requests.push(u);
    const requestTime = String(now);
    if (u.pathname.endsWith('/tickers')) return { code: '00000', requestTime, data: tickers };
    if (u.pathname.endsWith('/contracts')) return { code: '00000', requestTime, data: contracts };
    if (u.pathname.includes('/v3/market/instruments')) return { code: '00000', requestTime, data: instruments };
    if (u.pathname.endsWith('/candles')) return { code: '00000', requestTime, data: candles(u.searchParams.get('symbol'), u.searchParams.get('granularity')) };
    throw Error('unexpected ' + url);
  };
  return { tickers, json, requests };
}
const page = () => createRadarRuntime({ json: async () => { throw Error('offline'); } });
const ranked = rt => ['long', 'short'].flatMap(side => ['t1', 't2', 't3'].flatMap(tier => rt.state.tierMapBySide[side][tier].map(r =>
  [side, tier, r.symbol, r.oxScore, r.side, r.displayTier, r.setupName, r.statusText, r.rankStatus, r.reasons.join('|'), r.flowScore, r.structScore, r.liqScore, r.rsScore, r.quoteVol,
    r.classicSignal.pressure?.level, r.classicSignal.target?.level, r.classicSignal.invalidation?.level, r.classicSignal.money?.reason].join(' '))));
// The page: decode the snapshot, restore its rows with the given quotes and rank them.
function restore(snapshot, quotes) {
  const rt = page(), decoded = rt.codec.decode(JSON.parse(JSON.stringify(snapshot)));
  rt.state.tickers = quotes || decoded.tickers; rt.state.btcTicker = rt.state.tickers.find(t => t.symbol === 'BTCUSDT');
  const restored = rt.restoreRadarRows(decoded.rows, new Map(rt.state.tickers.map(t => [t.symbol, t])));
  rt.rebuildTierLists();
  return { rt, decoded, restored };
}

test('the collector runs the page scan over every coin and writes a compact snapshot', async () => {
  const now = Date.now(), fixture = market(now);
  const { snapshot, scan, runtime } = await collectRadar({ json: fixture.json, now: () => now });
  // The browser's own requests: three 180-candle series per coin.
  const candleRequests = fixture.requests.filter(u => u.pathname.endsWith('/candles'));
  assert.equal(candleRequests.length, SYMBOLS.length * 3);
  same([...new Set(candleRequests.map(u => u.searchParams.get('granularity') + ':' + u.searchParams.get('limit')))].sort(), ['1D:180', '1H:180', '4H:180']);
  assert.equal(snapshot.schema, 'ox-crypto-radar/1');
  assert.equal(snapshot.engine, runtime.OXClassic.CLASSIC_VERSION);
  assert.equal(snapshot.complete, true);
  same(scan.short, ['NEWUSDT'], 'a listing without enough history is skipped like on the page');
  assert.equal(snapshot.rows.length, SYMBOLS.length - 1);
  assert.equal(snapshot.closes['1H'], Math.floor(now / HOUR) * HOUR);
  assert.ok(snapshot.closes['4H'] <= now && snapshot.closes['1D'] <= now);
  same(snapshot.tiers, tierSymbols(scan.tiers));
  const members = ['long', 'short'].map(side => ['t1', 't2', 't3'].flatMap(t => snapshot.tiers[side][t]));
  assert.ok(members[0].length && members[1].length, 'both directions have candidates');
  // Small: brief signals for the rest, strings shared, quotes inside the rows.
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  assert.ok(bytes < snapshot.rows.length * 1200, `${bytes} bytes for ${snapshot.rows.length} coins`);
  assert.ok(snapshot.rows.every(r => Array.isArray(r[15]) && r[15].length === 3), 'each row carries its quote');
  same(snapshot.ranges.BTCUSDT, ['65000', '61000']);
  assert.ok(new Set(snapshot.strings).size === snapshot.strings.length);
  checkSnapshot(JSON.parse(JSON.stringify(snapshot)), { minRows: 5 });
});

test('the page restores the snapshot into the same T1/T2/T3 lists and 幣種詳情 as the scan', async () => {
  const now = Date.now(), fixture = market(now);
  const { snapshot, runtime } = await collectRadar({ json: fixture.json, now: () => now });
  const { rt, decoded, restored } = restore(snapshot, fixture.tickers);
  assert.equal(restored, snapshot.rows.length);
  same(tierSymbols(rt.state.tierMapBySide), snapshot.tiers);
  same(ranked(rt), ranked(runtime));
  // Every analysed coin (detail, market strength, home events) reads the same values.
  for (const [symbol, row] of runtime.state.analyzedCache) {
    const a = runtime.OXEngine.withTurnover(row, row.quoteVol), b = rt.OXEngine.withTurnover(rt.state.analyzedCache.get(symbol), row.quoteVol);
    for (const field of ['side', 'tier', 'oxScore', 'setupName', 'statusText', 'reasons', 'flowScore', 'structScore', 'setupScore', 'isSurge', 'structureLabel', 'swingHigh', 'swingLow', 'liqScore', 'rsScore', 'liqPercentile', 'signalFrame', 'triggerFrame', 'lastPrice'])
      same(b[field], a[field], `${symbol} ${field}`);
    for (const field of ['ret1h', 'ret4h', 'ret24h']) assert.ok(Math.abs(b[field] - a[field]) <= Math.abs(a[field]) * 1e-6 + 1e-12, `${symbol} ${field}`);
  }
  // Before the live quote list arrives, the snapshot's own quotes rank it identically.
  same(tierSymbols(restore(snapshot).rt.state.tierMapBySide), snapshot.tiers);
  assert.equal(decoded.tickers.find(t => t.symbol === 'BTCUSDT').high24h, '65000');
  // 時間組合 rows keep their single-timeframe tiers when frames are kept (device cache).
  const cached = rt.codec.decode(JSON.parse(JSON.stringify(rt.codec.encode({ rows: [...runtime.state.analyzedCache.values()], tickers: fixture.tickers, generatedAt: now }))));
  const original = [...runtime.state.analyzedCache.values()].find(r => Object.values(r.timeframeTiers).some(f => f?.eligible));
  const copy = cached.rows.find(r => r.symbol === original.symbol);
  for (const [frame, data] of Object.entries(original.timeframeTiers).filter(([, d]) => d?.eligible))
    for (const field of ['eligible', 'side', 'tier', 'oxScore', 'setupName', 'reasons']) same(copy.timeframeTiers[frame][field], data[field], frame + ' ' + field);
});

test('snapshot rows go live: newer scans replace them, live prices move the lists, both directions switch', async () => {
  const now = Date.now(), fixture = market(now);
  const { snapshot } = await collectRadar({ json: fixture.json, now: () => now });
  const { rt } = restore(snapshot, fixture.tickers);
  const longs = ['t1', 't2', 't3'].flatMap(t => rt.state.tierMapBySide.long[t]), shorts = ['t1', 't2', 't3'].flatMap(t => rt.state.tierMapBySide.short[t]);
  assert.ok(longs.every(r => r.side === 'LONG') && shorts.every(r => r.side === 'SHORT'));
  assert.ok(longs.length && shorts.length);
  // A live price far through a long's invalidation removes it, like on the page.
  const leaving = longs[0], invalid = leaving.classicSignal.invalidation.level - leaving.classicSignal.atr;
  rt.state.tickers = rt.state.tickers.map(t => t.symbol === leaving.symbol ? { ...t, lastPr: String(invalid) } : t);
  rt.rebuildTierLists();
  assert.ok(!['t1', 't2', 't3'].some(t => rt.state.tierMapBySide.long[t].some(r => r.symbol === leaving.symbol)));
  // A fresh scan of a coin replaces its snapshot row; an older saved row never does.
  const symbol = shorts[0].symbol, live = rt.state.analyzedCache.get(symbol);
  const rescan = { ...live, at: now + 60000, classic: { long: { ...live.classic.long }, short: { version: live.classic.short.version, eligible: false, side: 'SHORT', frame: '4H', tier: null, phase: 'none', stage: '尚未形成', qualityScore: null, rejectionReasons: ['右側下攻結構不足'] } } };
  rescan.classicSignal = rescan.classic.long;
  rt.state.analyzedCache.set(symbol, rt.OXEngine.withTurnover(rescan, live.quoteVol));
  assert.equal(rt.restoreRadarRows([{ ...live, at: now - 1000 }]), 0, 'an older row does not replace a newer one');
  rt.rebuildTierLists();
  assert.ok(!['t1', 't2', 't3'].some(t => rt.state.tierMapBySide.short[t].some(r => r.symbol === symbol)));
  same(rt.codec.mergeRows(rt.state.analyzedCache, [{ symbol, at: now + 30000 }, { symbol: 'ZZZUSDT', at: now }, { symbol: 'OLDUSDT', at: now - 3 * HOUR }], now).map(r => r.symbol), ['ZZZUSDT']);
});

test('a fresh complete evaluation only needs its candidates and the most traded coins re-checked', () => {
  const rt = page(), { isFresh, planPass, hourStart, FRESH_MS } = rt.codec;
  const close = hourStart(Date.now()) - HOUR;
  assert.equal(isFresh(close + 60000, close + 10 * 60000), true);
  assert.equal(isFresh(close + 60000, close + 60000 + FRESH_MS), false, '20 minutes later the full scan runs again');
  assert.equal(isFresh(close - 60000, close + 60000), false, 'an evaluation from the previous candle is stale');
  assert.equal(isFresh(0, close), false);
  const tickers = Array.from({ length: 200 }, (_, i) => ({ symbol: i < 2 ? ['BTCUSDT', 'ETHUSDT'][i] : `C${i}USDT`, usdtVolume: String(1e9 - i * 1e6) }));
  const signal = (side, quality) => ({ version: rt.OXClassic.CLASSIC_VERSION, eligible: true, side, tier: 'T2', qualityScore: quality });
  const rows = [{ symbol: 'C150USDT', classic: { long: signal('LONG', 80) }, classicSignal: signal('LONG', 80) }, { symbol: 'C199USDT', classic: { short: signal('SHORT', 70) }, classicSignal: signal('SHORT', 70) }, { symbol: 'C10USDT', classic: { long: { eligible: false } } }];
  const shown = { long: { t1: [], t2: [{ symbol: 'C199USDT' }], t3: [] }, short: { t1: [], t2: [], t3: [] } };
  const fresh = planPass({ tickers, rows, tierMapBySide: shown, fresh: true });
  same(fresh.slice(0, 4), ['BTCUSDT', 'ETHUSDT', 'C199USDT', 'C150USDT'], 'benchmarks, then the coins on screen, then other candidates');
  assert.equal(fresh.length, 2 + 60 + 2 - 2, 'plus the 60 most traded coins');
  assert.ok(!fresh.includes('C100USDT'));
  const full = planPass({ tickers, rows, tierMapBySide: shown, fresh: false });
  assert.equal(full.length, 200);
  same(full.slice(0, 5), ['BTCUSDT', 'ETHUSDT', 'C199USDT', 'C150USDT', 'C2USDT'], 'a full pass also starts with saved candidates, then by turnover');
  assert.equal(rt.codec.closeLabel(Date.UTC(2026, 9, 30, 5)), '13:00');
});

test('snapshots from another engine, schema or older than the radar keeps are not used', async () => {
  const now = Date.now(), fixture = market(now);
  const { snapshot } = await collectRadar({ json: fixture.json, now: () => now });
  const rt = page();
  assert.equal(rt.codec.decode({ ...snapshot, engine: snapshot.engine + 1 }), null);
  assert.equal(rt.codec.decode({ ...snapshot, schema: 'ox-crypto-radar/0' }), null);
  assert.equal(rt.codec.decode(JSON.parse(await readFile(new URL('../data/crypto-radar.json', import.meta.url), 'utf8'))), null, 'the committed placeholder is empty');
  const old = rt.codec.decode({ ...snapshot, generatedAt: now - 3 * HOUR });
  rt.state.tickers = fixture.tickers;
  assert.equal(rt.restoreRadarRows(old.rows, new Map(fixture.tickers.map(t => [t.symbol, t]))), 0);
  assert.throws(() => checkSnapshot({ ...snapshot, rows: snapshot.rows.slice(0, 3) }, { minRows: 5 }), /complete radar snapshot/);
  assert.throws(() => checkSnapshot({ ...snapshot, complete: false }, { minRows: 5 }), /complete radar snapshot/);
});

test('the Bitget transport stays under 8 requests a second and backs off on 429 and 5xx', async () => {
  const starts = [], replies = [{ status: 429 }, { status: 503 }, { status: 200 }];
  const fetcher = async () => { starts.push(Date.now()); const r = replies.shift() || { status: 200 }; return { status: r.status, ok: r.status === 200, headers: { get: () => null }, json: async () => ({ code: '00000', data: [], requestTime: String(Date.now()) }) }; };
  const waits = [], transport = createBitgetTransport({ fetcher, sleep: async ms => { waits.push(ms); } });
  await transport.json('https://api.bitget.com/a');
  assert.equal(transport.stats.throttled, 1); assert.equal(transport.stats.retried, 2); same(waits, [1000, 2000]);
  starts.length = 0;
  await Promise.all(Array.from({ length: 9 }, (_, i) => transport.json('https://api.bitget.com/b' + i)));
  assert.ok(starts.at(-1) - starts[0] >= 8 * 125 - 20, 'nine starts take at least a second');
  const refused = createBitgetTransport({ fetcher: async () => ({ status: 400, ok: false, headers: { get: () => null } }), sleep: async () => {} });
  await assert.rejects(refused.json('https://api.bitget.com/c'), /HTTP 400/);
  assert.equal(refused.stats.retried, 0);
  assert.equal(latestClose([{ time: 0 }, { time: 3600 }], '1H', 7200 * 1000 - 1), 3600 * 1000);
});

test('the workflow publishes off main: hourly fallback, one run at a time, Sites only when switched on', async () => {
  const yaml = (await readFile(new URL('../.github/workflows/update-crypto-radar.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(yaml, /\n  workflow_dispatch:\n/);
  same([...yaml.matchAll(/cron: '([^']+)'/g)].map(m => m[1]), ['5 * * * *']);
  assert.match(yaml, /concurrency:\n(?:\s*#.*\n)*\s+group: update-crypto-radar\n\s+cancel-in-progress: false/);
  assert.match(yaml, /contents: write/); assert.match(yaml, /id-token: write/);
  assert.match(yaml, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(yaml, /collect-crypto-radar\.mjs --out "\$RUNNER_TEMP\/crypto-radar\.json" --current "https:\/\/raw\.githubusercontent\.com\/\$\{\{ github\.repository \}\}\/live-data\/crypto-radar\.json"/);
  assert.match(yaml, /publish-crypto-radar\.mjs --file "\$RUNNER_TEMP\/crypto-radar\.json" --to branch/);
  assert.match(yaml, /if: \$\{\{ always\(\) && !cancelled\(\) && github\.ref == 'refs\/heads\/main' && vars\.OX_SITES_DATA == 'on' \}\}\n(?:.*\n)*?\s+node scripts\/publish-crypto-radar\.mjs --file "\$RUNNER_TEMP\/crypto-radar\.json" --to sites/);
  // Nothing is committed to main.
  assert.doesNotMatch(yaml, /git (?:add|commit)|HEAD:main|push origin/);
  assert.ok(DATA_WORKFLOWS.includes('update-crypto-radar.yml'));
  assert.ok(LIVE_DATA.every(path => DATA_FILE.test(path)));
});

test('the live-data branch holds one commit with only the newest snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ox-live-data-'));
  try {
    const git = (cwd, args, options = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
    git(dir, ['init', '--quiet', '--bare', 'remote.git']); git(dir, ['init', '--quiet', 'work']);
    const work = join(dir, 'work'); git(work, ['remote', 'add', 'origin', join(dir, 'remote.git')]);
    const run = (args, options = {}) => git(work, args, options);
    const snap = (close, generatedAt) => ({ schema: 'ox-crypto-radar/1', engine: 11, complete: true, generatedAt, closes: { '1H': close }, strings: [], rows: Array.from({ length: 60 }, (_, i) => ['C' + i]) });
    const send = s => publishBranch({ bytes: Buffer.from(JSON.stringify(s)), snapshot: s, git: run });
    assert.equal(send(snap(HOUR, HOUR + 90000)).status, 'published');
    assert.equal(send(snap(2 * HOUR, 2 * HOUR + 90000)).status, 'published');
    assert.equal(send(snap(HOUR, HOUR + 99000)).status, 'kept', 'an older close never replaces a newer one');
    assert.equal(send(snap(2 * HOUR, 2 * HOUR + 90000)).status, 'kept', 'the same snapshot is not pushed twice');
    const remote = join(dir, 'remote.git');
    assert.equal(git(remote, ['rev-list', '--count', 'live-data']).trim(), '1');
    assert.equal(git(remote, ['ls-tree', '--name-only', 'live-data']).trim(), 'crypto-radar.json');
    assert.equal(JSON.parse(git(remote, ['show', 'live-data:crypto-radar.json'])).closes['1H'], 2 * HOUR);
    assert.equal(git(remote, ['branch', '--list', 'main']).trim(), '');
  } finally { await rm(dir, { recursive: true, force: true }); }
  assert.equal(isNewer({ closes: { '1H': 2 }, generatedAt: 5 }, { closes: { '1H': 2 }, generatedAt: 4 }), true);
  assert.equal(isNewer({ closes: { '1H': 1 }, generatedAt: 9 }, { closes: { '1H': 2 }, generatedAt: 4 }), false);
});

test('Sites: the radar rides along every data release and an older writer cannot restore its copy', async () => {
  const committed = { files: new Map([['data/news.json', Buffer.from('{}')], ['data/crypto-radar.json', Buffer.from('{"rows":[]}')]]), manifest: { 'data/news.json': { sha256: 'a'.repeat(64), size: 2 }, 'data/crypto-radar.json': { sha256: 'b'.repeat(64), size: 11 } } };
  const current = { files: { 'data/crypto-radar.json': { sha256: 'c'.repeat(64), size: 99999 } } };
  const kept = releaseFiles(committed, current);
  same(kept.manifest['data/crypto-radar.json'], current.files['data/crypto-radar.json'], 'other collectors keep the published radar, not main\'s placeholder');
  assert.ok(!kept.files.has('data/crypto-radar.json'));
  const fresh = releaseFiles(committed, current, { 'data/crypto-radar.json': Buffer.from('{"new":1}') });
  assert.equal(fresh.manifest['data/crypto-radar.json'].size, 9); assert.ok(fresh.files.has('data/crypto-radar.json'));
  assert.equal(releaseFiles(committed, null).manifest['data/crypto-radar.json'].sha256, 'b'.repeat(64));
  assert.throws(() => releaseFiles(committed, current, { 'data/news.json': Buffer.from('{}') }), /live data/);
  // The Worker refuses a release built on an older pointer of the same commit.
  const values = new Map(); let serial = 0;
  const bucket = { async get(key) { const v = values.get(key); return v ? { ...v, json: async () => JSON.parse(new TextDecoder().decode(v.bytes)) } : null; },
    async head(key) { const v = values.get(key); return v ? { size: v.bytes.length, customMetadata: v.customMetadata } : null; },
    async put(key, value, options = {}) { const old = values.get(key); if (options.onlyIf?.etagMatches !== undefined && old?.etag !== options.onlyIf.etagMatches) return null;
      const v = { bytes: typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value), customMetadata: options.customMetadata, etag: String(++serial) }; values.set(key, v); return v; } };
  const bytes = new TextEncoder().encode('{"ok":1}'), hash = await sha256(bytes);
  const call = (operation, body) => publishData(new Request('https://crypto.oxpattern.com/api/v1/crypto/data-upload/' + operation, { method: 'PUT', body }), bucket, { run_id: '9' });
  await call('blob?sha256=' + hash, bytes);
  const files = Object.fromEntries(['data/news.json', 'data/macro-results.json', 'previews/data/crypto-flow-history.json', 'data/crypto-radar.json'].map(p => [p, { sha256: hash, size: bytes.length }]));
  const commit = 'd'.repeat(40);
  assert.equal((await call('release', JSON.stringify({ commit, files, previousCommit: null, previousRevision: 0 }))).status, 200);
  const first = await (await bucket.get(DATA_POINTER)).json();
  assert.equal(first.revision, 1);
  assert.equal((await call('release', JSON.stringify({ commit, files, previousCommit: commit, previousRevision: first.revision }))).status, 200);
  assert.equal((await call('release', JSON.stringify({ commit, files, previousCommit: commit, previousRevision: first.revision }))).status, 409, 'a writer that read the older release starts over');
  assert.equal((await (await bucket.get(DATA_POINTER)).json()).revision, 2);
  // publishSites compares the Site's copy first.
  let published = 0;
  const site = snapshot => async () => ({ ok: true, text: async () => JSON.stringify(snapshot) });
  const next = { closes: { '1H': 2 * HOUR }, generatedAt: 2 * HOUR + 1 };
  assert.equal((await publishSites({ bytes, snapshot: next, fetcher: site({ closes: { '1H': 2 * HOUR }, generatedAt: 2 * HOUR + 5 }), publish: async () => { published++; return {}; } })).status, 'kept');
  assert.equal((await publishSites({ bytes, snapshot: next, fetcher: site({ closes: { '1H': HOUR }, generatedAt: HOUR + 5 }), publish: async ({ live }) => { published++; assert.ok(live['data/crypto-radar.json']); return {}; } })).status, 'published');
  assert.equal(published, 1);
});

test('the home PC starts one run per close', () => {
  const close = Date.UTC(2026, 9, 30, 5), now = close + 20000;
  assert.equal(decide({ now, runs: [], published: { closes: { '1H': close - HOUR } } }).start, true);
  assert.equal(decide({ now, runs: [{ createdAt: new Date(now - 5 * 60000).toISOString(), status: 'in_progress' }], published: null }).start, false, 'a run started in the last 10 minutes');
  assert.equal(decide({ now, runs: [{ createdAt: new Date(now - 11 * 60000).toISOString(), status: 'completed' }], published: null }).start, true);
  assert.equal(decide({ now, runs: [], published: { closes: { '1H': close } } }).start, false, 'this close is already published');
});
