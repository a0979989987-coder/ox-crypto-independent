// Hourly 雷達 snapshot. Right after each 1H close this runs the page's own radar scan
// (scripts/crypto-radar-runtime.mjs loads the browser's scanner.js, Bitget client and
// OX 經典 engine unchanged) over every Bitget USDT-M perpetual and writes
// crypto-radar.json: every analysed coin, the quotes it was ranked with and the
// resulting T1/T2/T3 lists. The page paints that file at once and then keeps it live
// (src/markets/crypto/radar-snapshot.js).
//   node scripts/collect-crypto-radar.mjs [--out path] [--current url-or-file] [--force]
//   --current  the published snapshot; a run whose 1H close is already published stops
//   --force    collect even when the published snapshot already has this close
//   --rps      requests per second, at most 8 (default)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRadarRuntime } from './crypto-radar-runtime.mjs';

export const HOUR = 3600000;
// Wait this long after the close so Bitget has finished the closed candle.
export const SETTLE_MS = 45000;
const FRAME_SECONDS = { '1H': 3600, '4H': 14400, '1D': 86400 };
const defaultSleep = ms => new Promise(done => setTimeout(done, ms));

// Bitget public market data allows 20 requests/s per IP; the page's users share that
// limit with this job only when it runs on the same network, so stay well below:
// at most 8 starts per second, 4 in flight, and back off on 429, 5xx and time-outs.
export function createBitgetTransport({ interval = 125, concurrency = 4, attempts = 4, fetcher = fetch, sleep = defaultSleep } = {}) {
  const queue = [], stats = { requests: 0, throttled: 0, retried: 0, failed: 0, serverTime: null };
  let active = 0, next = 0, timer = null;
  const pump = () => {
    if (timer) return;
    while (active < concurrency && queue.length) {
      const wait = next - Date.now();
      if (wait > 0) { timer = setTimeout(() => { timer = null; pump(); }, wait); return; }
      next = Date.now() + interval; active++;
      queue.shift()().finally(() => { active--; pump(); });
    }
  };
  const lane = task => new Promise((done, fail) => { queue.push(() => task().then(done, fail)); pump(); });
  const hold = ms => { next = Math.max(next, Date.now() + ms); };
  async function json(url, { timeoutMs = 20000 } = {}) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await lane(async () => {
          stats.requests++;
          const response = await fetcher(url, { signal: AbortSignal.timeout(Math.max(timeoutMs, 10000)) });
          if (Number(response.headers?.get?.('x-mbx-used-remain-limit') ?? NaN) <= 1) hold(1000);
          if (response.status === 429) { stats.throttled++; hold(2000 * attempt); throw Object.assign(Error('Bitget HTTP 429'), { retry: true }); }
          if (!response.ok) throw Object.assign(Error(`Bitget HTTP ${response.status}`), { retry: response.status >= 500 });
          const body = await response.json();
          if (body?.code === '429') { stats.throttled++; hold(2000 * attempt); throw Object.assign(Error('Bitget 429'), { retry: true }); }
          const time = Number(body?.requestTime);
          if (Number.isFinite(time) && time > (stats.serverTime || 0)) stats.serverTime = time;
          return body;
        });
      } catch (error) {
        // Network failures, time-outs, 429 and 5xx are retried; a refused request is not.
        if (attempt >= attempts || error.retry === false) { stats.failed++; throw error; }
        stats.retried++;
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
  }
  return { json, stats };
}

// The close time (ms) of the newest closed candle in a frame's Bitget series.
export function latestClose(candles, frame, now) {
  const seconds = FRAME_SECONDS[frame];
  const closed = (candles || []).filter(c => Number.isFinite(c?.time) && (c.time + seconds) * 1000 <= now);
  return closed.length ? (closed.at(-1).time + seconds) * 1000 : null;
}

// The scan itself: the same catalog, quote filter, candles, per-coin row and ranking
// as runScanQueueLoop in src/markets/crypto/scanner.js.
export async function scanRadar(runtime, { now = () => Date.now(), onProgress = () => {}, failRatio = .02 } = {}) {
  const { state, BitgetAPI } = runtime;
  let metadata = [];
  const [rawTickers, contracts] = await Promise.all([BitgetAPI.fetchTickers(), BitgetAPI.fetchContracts(),
    (async () => { for (let i = 0; i < 3 && !metadata.length; i++) metadata = await BitgetAPI.fetchInstrumentMetadata(); })()]);
  // Without the official asset types stock and RWA contracts could pass as crypto.
  if (!metadata.length) throw Error('Bitget instrument metadata unavailable');
  runtime.applyCryptoCatalog(contracts, metadata);
  state.tickers = runtime.selectCryptoTickers(rawTickers);
  state.btcTicker = state.tickers.find(t => t.symbol === 'BTCUSDT') || null;
  state.ethTicker = state.tickers.find(t => t.symbol === 'ETHUSDT') || null;
  if (!state.btcTicker) throw Error('BTCUSDT quote unavailable');
  const universe = state.tickers.filter(t => runtime.num(t.usdtVolume) > 0)
    .sort((a, b) => Number(['BTCUSDT', 'ETHUSDT'].includes(b.symbol)) - Number(['BTCUSDT', 'ETHUSDT'].includes(a.symbol)) || runtime.num(b.usdtVolume) - runtime.num(a.usdtVolume));
  const failed = [], short = [], noDaily = [], closes = {};
  let done = 0;
  state.analyzedCache.clear();
  await Promise.all(universe.map(async ticker => {
    const symbol = ticker.symbol;
    try {
      const raw = await runtime.fetchCryptoRadarCandles(symbol, { owner: 'radar-snapshot', priority: 0 });
      if (!raw['1D'].length) noDaily.push(symbol);
      const { row } = runtime.cryptoRadarRow(symbol, ticker, raw);
      state.analyzedCache.set(symbol, row);
      if (symbol === 'BTCUSDT') for (const frame of Object.keys(FRAME_SECONDS)) closes[frame] = latestClose(raw[frame], frame, now());
    } catch (error) {
      // A new listing has too little history to be ranked; the page skips it the same way.
      (/K 線不足/.test(error.message) ? short : failed).push(symbol);
    } finally { onProgress(++done, universe.length); }
  }));
  if (failed.length > Math.max(3, Math.floor(universe.length * failRatio))) throw Error(`Too many coins unavailable: ${failed.length}/${universe.length}`);
  if (!closes['1H']) throw Error('BTCUSDT candles unavailable');
  runtime.rebuildTierLists();
  return { universe, failed, short, noDaily, closes, tickers: state.tickers, rows: [...state.analyzedCache.values()], tiers: state.tierMapBySide };
}

export function tierSymbols(tierMapBySide) {
  return Object.fromEntries(['long', 'short'].map(side => [side, Object.fromEntries(['t1', 't2', 't3'].map(tier => [tier, (tierMapBySide?.[side]?.[tier] || []).map(row => row.symbol)]))]));
}

export async function collectRadar({ json, now = () => Date.now(), onProgress } = {}) {
  const runtime = createRadarRuntime({ json });
  const started = now();
  const scan = await scanRadar(runtime, { now, onProgress });
  const snapshot = runtime.codec.encode({
    rows: scan.rows, tickers: scan.tickers, generatedAt: now(), startedAt: started, closes: scan.closes,
    pool: scan.universe.length, failed: scan.failed, short: scan.short, tiers: tierSymbols(scan.tiers),
    // Single-timeframe tiers (時間組合 mode) would add about a third; that mode scans live.
    frames: false
  });
  return { snapshot, scan, runtime };
}

async function readCurrent(location) {
  try {
    const text = /^https?:/.test(location) ? await (await fetch(location, { cache: 'no-store', signal: AbortSignal.timeout(15000) })).text() : await readFile(location, 'utf8');
    return JSON.parse(text);
  } catch { return null; }
}

async function main() {
  const option = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const out = resolve(option('--out') || 'crypto-radar.json'), current = option('--current'), force = process.argv.includes('--force');
  const rps = Math.min(8, Math.max(1, Number(option('--rps')) || 8));
  const boundary = Math.floor(Date.now() / HOUR) * HOUR;
  if (current && !force) {
    const published = await readCurrent(current);
    if (published?.closes?.['1H'] >= boundary) { console.log(JSON.stringify({ status: 'current', close: new Date(published.closes['1H']).toISOString() })); return; }
  }
  if (Date.now() < boundary + SETTLE_MS) await defaultSleep(boundary + SETTLE_MS - Date.now());
  const transport = createBitgetTransport({ interval: Math.ceil(1000 / rps) }), started = Date.now();
  const { snapshot, scan } = await collectRadar({ json: transport.json });
  if (Math.abs(Date.now() - (transport.stats.serverTime || 0)) > 300000) throw Error('Bitget server time unavailable or skewed');
  const text = JSON.stringify(snapshot);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, text);
  const count = side => ['t1', 't2', 't3'].map(t => snapshot.tiers[side][t].length).join('/');
  console.log(JSON.stringify({ status: 'written', out, close: new Date(snapshot.closes['1H']).toISOString(), pool: scan.universe.length, rows: snapshot.rows.length,
    failed: scan.failed, short: scan.short.length, noDaily: scan.noDaily.length, long: count('long'), short_: count('short'), requests: transport.stats.requests,
    throttled: transport.stats.throttled, retried: transport.stats.retried, seconds: +((Date.now() - started) / 1000).toFixed(1), bytes: Buffer.byteLength(text) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });
