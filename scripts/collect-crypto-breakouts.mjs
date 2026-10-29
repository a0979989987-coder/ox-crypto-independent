// Records each 4H close since the last run: the coins the pattern board lists as
// confirmed upward breakouts on the 4H chart (Bitget USDT-M perpetuals, the board's
// default pool of every eligible contract), and the closes of earlier records since.
// Runs hourly; a close missed by all four runs of its window is caught up later from
// Bitget history candles ending at that close (at most the last 6 closes).
//   node scripts/collect-crypto-breakouts.mjs [--out path]   (default data/crypto-breakouts.json)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectUniverse } from '../src/markets/crypto/patterns/source.js';
import { BTC, PERIODS, boundaryOf, pendingBoundaries, seriesPaths, scanPoint, closeIndex, updateLog } from './crypto-breakouts.mjs';

const BASE = 'https://api.bitget.com';
const option = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const file = option('--out') ? resolve(option('--out')) : fileURLToPath(new URL('../data/crypto-breakouts.json', import.meta.url));
const iso = at => new Date(at * 1000).toISOString().replace('.000', '');
const sleep = ms => new Promise(done => setTimeout(done, ms));

// Bitget public market data allows 20 requests/s per IP for candles and about 5/s for
// history candles (x-mbx-used-remain-limit counts 4 → 0). Stay far below both:
// candles ≤ 8/s with 4 in flight, history ≤ 2.5/s one at a time.
function lane(interval, concurrency) {
  const queue = [];
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
  return {
    run: task => new Promise((done, fail) => { queue.push(() => task().then(done, fail)); pump(); }),
    hold: ms => { next = Math.max(next, Date.now() + ms); }
  };
}
const lanes = { candles: lane(125, 4), history: lane(400, 1) }, stop = new AbortController();
let requests = 0, throttled = 0;
async function bitget(path, through) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await through.run(async () => {
        if (stop.signal.aborted) throw Object.assign(Error('Run abandoned'), { retry: false });
        requests++;
        const response = await fetch(BASE + path, { signal: AbortSignal.any([stop.signal, AbortSignal.timeout(20000)]) });
        if (Number(response.headers.get('x-mbx-used-remain-limit') ?? NaN) <= 1) through.hold(1000);
        if (response.status === 429) { throttled++; through.hold(2000 * attempt); throw Error('Bitget HTTP 429'); }
        if (!response.ok) throw Object.assign(Error(`Bitget HTTP ${response.status}`), { retry: response.status >= 500 });
        const json = await response.json();
        if (json.code !== '00000' || !Array.isArray(json.data)) throw Object.assign(Error(`Bitget ${json.code} ${json.msg || ''}`.trim()), { retry: json.code === '429' });
        return json;
      });
    } catch (error) {
      // Network failures, time-outs, 429 and 5xx are retried with backoff; a refused request is not.
      if (attempt >= 4 || error.retry === false || stop.signal.aborted) throw error;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

async function main() {
  const started = Date.now();
  let log = null;
  try { log = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (log && (!Array.isArray(log.points) || !Array.isArray(log.history))) throw Error(`${file} is not a breakout log; refusing to replace it`);
  // No 4H candle closes between boundaries: the hourly runs after a recorded close stop here.
  if (log?.at >= boundaryOf(Date.now())) { console.log(JSON.stringify({ at: iso(log.at), status: 'current' })); return; }

  const [quotes, metadata] = await Promise.all([
    bitget('/api/v2/mix/market/tickers?productType=USDT-FUTURES', lanes.candles),
    bitget('/api/v3/market/instruments?category=USDT-FUTURES', lanes.candles)]);
  const serverTime = Number(quotes.requestTime);
  if (!Number.isFinite(serverTime) || Math.abs(Date.now() - serverTime) > 300000) throw Error('Bitget server time unavailable or skewed');
  const latest = boundaryOf(serverTime), pending = pendingBoundaries(log, latest);
  if (!pending.length) { console.log(JSON.stringify({ at: iso(log.at), status: 'current' })); return; }
  // Right after a close Bitget may still be finishing that candle.
  if (serverTime < (latest + 60) * 1000) await sleep((latest + 60) * 1000 - serverTime);

  // The board's default pool: every eligible contract (limit 0), ordered by 24H turnover.
  const universe = selectUniverse(quotes.data, metadata.data, 0);
  if (!universe.length) throw Error('No eligible Bitget contracts');
  const inPool = new Set(universe.map(t => t.symbol)), allowed = Math.max(3, Math.floor(universe.length * .02));
  // BTC for the comparison, and earlier picks that left the pool but still need closes.
  const extra = [...new Set([BTC, ...(log?.points || []).flatMap(p => p.picks.filter(x => (x.c?.length ?? 0) <= PERIODS.at(-1)).map(x => x.s))])].filter(s => !inPool.has(s));
  const series = new Map();
  let recentFailed = 0;
  await Promise.all([...universe.map(t => t.symbol), ...extra].map(async symbol => {
    const paths = seriesPaths(symbol, inPool.has(symbol) ? pending : [latest]);
    const [recent, history] = await Promise.all([
      bitget(paths.recent, lanes.candles).then(json => json.data, () => {
        // The newest close cannot be recorded: stop asking and retry on the next hourly run.
        if (inPool.has(symbol) && ++recentFailed > allowed) stop.abort();
        return null;
      }),
      paths.history ? bitget(paths.history, lanes.history).then(json => json.data, () => null) : null]);
    series.set(symbol, { recent, history });
  }));

  // A close with too many unavailable series is not recorded. If it is the newest, nothing
  // is written and the next hourly run tries again; an older one stays a gap.
  const scans = pending.map(at => scanPoint(at, universe.map(t => {
    const { recent, history } = series.get(t.symbol);
    return { symbol: t.symbol, turnover: Number(t.usdtVolume), rows: at === latest ? recent : recent && history ? [...history, ...recent] : null };
  })));
  const points = scans.filter(s => s.failed + s.stale <= allowed).map(s => s.point);
  const skipped = scans.filter(s => s.failed + s.stale > allowed).map(s => ({ at: iso(s.point.at), failed: s.failed, stale: s.stale }));
  const { failed, stale } = scans.at(-1), now = points.find(p => p.at === latest);
  if (!now) {
    console.error(JSON.stringify({ at: iso(latest), status: 'incomplete', skipped, requests, throttled, seconds: +((Date.now() - started) / 1000).toFixed(1) }));
    process.exitCode = 1;
    return;
  }
  const closeOf = closeIndex(new Map([...series].map(([symbol, s]) => [symbol, [...(s.history || []), ...(s.recent || [])]])), latest);
  const next = updateLog(log, { points, closeOf });
  if (!next) { console.log(JSON.stringify({ at: iso(log.at), status: 'current' })); return; }
  const text = JSON.stringify(next);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  console.log(JSON.stringify({ at: iso(latest), recorded: points.map(p => iso(p.at)), skipped, pool: now.pool, scanned: now.scanned, failed, stale,
    picks: now.picks.length, tiers: [1, 2, 3].map(t => now.picks.filter(p => p.t === t).length).join('/'),
    points: next.points.length, history: next.history.length, requests, throttled, seconds: +((Date.now() - started) / 1000).toFixed(1), bytes: Buffer.byteLength(text) }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
