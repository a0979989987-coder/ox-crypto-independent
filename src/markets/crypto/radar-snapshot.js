/* OX 加密 radar snapshot: the T1/T2/T3 lists within about a second.
 *
 * scripts/collect-crypto-radar.mjs runs this page's own scan (scanner.js and the OX
 * 經典 engine, unchanged) right after every 1H close and publishes crypto-radar.json
 * (same origin on Sites, the live-data branch on GitHub while the site is on Vercel).
 * The page paints those rows at once, keeps its newest results on this device for the
 * next visit (also offline), and keeps everything live in the background:
 *   - a complete evaluation from this 1H candle less than 20 minutes old (the snapshot,
 *     or this page's own full pass) only needs its candidates and the 60 most traded
 *     coins re-checked, so live-candle observations stay right;
 *   - otherwise the full scan runs again, saved candidates first, then by turnover,
 *     and every finished coin replaces its saved row at once.
 * Rankings are never stored as such: saved rows go back through OXEngine.withTurnover
 * and rebuildTierLists with the current quotes, exactly like rows the page scanned.
 * The codec below is shared by the hourly job, the device cache and the tests.
 */
(function (root) {
  'use strict';
  const SCHEMA = 'ox-crypto-radar/1';
  const HOUR = 3600000, FRESH_MS = 20 * 60000, RETAIN_MS = 2 * HOUR, TOP_TURNOVER = 60, PARTIAL_REST_MS = 30000;
  const BENCHMARKS = ['BTCUSDT', 'ETHUSDT'];
  const SOURCES = ['/data/crypto-radar.json', 'https://raw.githubusercontent.com/a0979989987-coder/ox-crypto-independent/live-data/crypto-radar.json'];
  const SOURCE_TIMEOUTS = [2500, 4000];

  // ---- codec ----------------------------------------------------------------
  // Only the signal fields the radar, 首頁 and 幣種詳情 read: OXEngine.describe,
  // OXCryptoLiquidity.apply, OXClassic.qualifyClassicRow / compareClassic /
  // rankClassicTiers, rebuildTierLists and renderOxDetail. Pivot points, candle
  // indices and other audit evidence stay out; a re-check restores full rows.
  const STR = 1, STRS = 2;
  const LEVEL = [['level', 'l']];
  const VOLUME = [['supported', 's'], ['recentRatio', 'r'], ['sustainedBars', 'b'], ['upwardShare', 'u'], ['ratio', 'x']];
  const SIGNAL = [['version', 'v'], ['side', 'd', STR], ['frame', 'f', STR], ['eligible', 'e'], ['tier', 't', STR], ['phase', 'p', STR], ['stage', 'g', STR],
    ['qualityScore', 'q'], ['observationEligible', 'o'], ['priority', 'y'], ['structureReady', 'k'], ['triggerFrame', 'h', STR], ['closedAt', 'c'], ['atr', 'a'],
    ['reasons', 'r', STRS], ['matchedReasons', 'm', STRS], ['rejectionReasons', 'x', STRS],
    ['pressure', 'P', LEVEL], ['target', 'T', LEVEL], ['invalidation', 'I', LEVEL], ['reversal', 'R', [['candidate', 'c']]],
    ['volume', 'V', VOLUME], ['triggerVolume', 'W', VOLUME], ['direction', 'D', [['confirmed', 'c'], ['higherLows', 'h'], ['reclaim', 'r']]],
    ['money', 'M', [['rawScore', 's'], ['rawTier', 't', STR]]]];
  // An eligible signal shows its reasons; any other one its matched and rejection reasons.
  const unusedReasons = signal => signal?.eligible ? ['matchedReasons', 'rejectionReasons'] : ['reasons'];

  function strings() {
    const counts = new Map();
    return {
      count(value) { if (typeof value === 'string') counts.set(value, (counts.get(value) || 0) + 1); },
      table() { const list = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([s]) => s); return { list, index: new Map(list.map((s, i) => [s, i])) }; }
    };
  }
  function project(value, spec, skip = []) {
    if (value === null || typeof value !== 'object') return value;
    const out = {};
    for (const [name, key, kind] of spec) {
      if (skip.includes(name) || value[name] === undefined) continue;
      const v = value[name];
      out[key] = Array.isArray(kind) ? project(v, kind) : kind === STRS ? (Array.isArray(v) ? v.filter(s => typeof s === 'string') : v) : v;
    }
    return out;
  }
  function walkStrings(value, spec, visit) {
    if (value === null || typeof value !== 'object') return;
    for (const [, key, kind] of spec) {
      const v = value[key];
      if (v === undefined) continue;
      if (Array.isArray(kind)) walkStrings(v, kind, visit);
      else if (kind === STR) visit(v);
      else if (kind === STRS && Array.isArray(v)) v.forEach(visit);
    }
  }
  function mapStrings(value, spec, map) {
    if (value === null || typeof value !== 'object') return value;
    const out = {};
    for (const [, key, kind] of spec) {
      const v = value[key];
      if (v === undefined) continue;
      out[key] = Array.isArray(kind) ? mapStrings(v, kind, map) : kind === STR ? (typeof v === 'string' || typeof v === 'number' ? map(v) : v) :
        kind === STRS && Array.isArray(v) ? v.map(map) : v;
    }
    return out;
  }
  function expand(value, spec, table) {
    if (value === null || typeof value !== 'object') return value;
    const out = {};
    for (const [name, key, kind] of spec) {
      const v = value[key];
      if (v === undefined) continue;
      out[name] = Array.isArray(kind) ? expand(v, kind, table) : kind === STR ? (typeof v === 'number' ? table[v] : v) :
        kind === STRS && Array.isArray(v) ? v.map(i => table[i]) : v;
    }
    return out;
  }
  const roundRatio = x => typeof x === 'number' && Number.isFinite(x) ? Number(x.toPrecision(7)) : x;
  // Ratios, ATR and returns keep 7 significant digits (a tie at 1e-7 is the only effect).
  const roundVolume = v => v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ['u', 'x', 'r'].includes(k) ? roundRatio(x) : x])) : v;
  const signalOf = signal => {
    const s = project(signal, SIGNAL, unusedReasons(signal));
    if (s?.V) s.V = roundVolume(s.V); if (s?.W) s.W = roundVolume(s.W); if (s?.a !== undefined) s.a = roundRatio(s.a);
    return s;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // classicSignal is normally one of classic.long / classic.short: store which one.
  function signalPair(classic, chosen) {
    const long = signalOf(classic?.long), short = signalOf(classic?.short), pick = signalOf(chosen);
    return { long, short, pick: chosen === undefined ? null : same(pick, long) ? 0 : same(pick, short) ? 1 : pick };
  }
  // A signal that is neither eligible nor an observation is what compactClassic keeps of
  // it: [frame, phase, stage, seconds before generation it closed, rejection reasons].
  const BRIEF_KEYS = new Set(['v', 'd', 'f', 'e', 't', 'p', 'g', 'q', 'c', 'x', 'M']);
  function isBrief(s, side, engine) {
    return s && s.e === false && !s.o && (s.t ?? null) === null && (s.q ?? null) === null && s.v === engine && s.d === side &&
      (!s.M || (s.M.s ?? null) === null && (s.M.t ?? null) === null) && Object.keys(s).every(k => BRIEF_KEYS.has(k));
  }
  const ago = (seconds, generatedAt) => Number.isFinite(seconds) ? Math.round(generatedAt / 1000) - seconds : seconds ?? null;
  const since = (delta, generatedAt) => Number.isFinite(delta) ? Math.round(generatedAt / 1000) - delta : delta;
  // Nested evidence is positional: a one-field object (a level) is its bare value ([]
  // when the field is missing), a larger one an array in spec order. null and a missing
  // field read the same everywhere the page uses them (??, ||, ?.), so null stands for both.
  const NESTED = SIGNAL.filter(([, , kind]) => Array.isArray(kind));
  function packNested(value, spec) {
    if (value === null || typeof value !== 'object') return value;
    if (spec.length === 1) return value[spec[0][1]] ?? [];
    return spec.map(([, key]) => value[key] ?? null);
  }
  function unpackNested(value, spec) {
    if (value === null || value === undefined) return value;
    if (spec.length === 1) return Array.isArray(value) ? {} : { [spec[0][1]]: value };
    return Object.fromEntries(spec.map(([, key], i) => [key, value[i]]).filter(([, v]) => v !== null && v !== undefined));
  }
  function packSignal(s, side, engine, generatedAt, ref) {
    if (!s) return null;
    const mapped = mapStrings(s, SIGNAL, ref);
    if (isBrief(s, side, engine)) return [mapped.f ?? null, mapped.p ?? null, mapped.g ?? null, ago(s.c, generatedAt), mapped.x ?? null];
    const out = { ...mapped };
    if (s.v === engine) delete out.v;
    if (side && s.d === side) delete out.d;
    if (out.c !== undefined) out.c = ago(out.c, generatedAt);
    for (const [, key, spec] of NESTED) if (out[key] !== undefined) out[key] = packNested(out[key], spec);
    return out;
  }
  function unpackSignal(s, side, engine, generatedAt, table) {
    if (Array.isArray(s)) {
      const [f, p, g, c, x] = s;
      return expand({ v: engine, d: side, f, e: false, t: null, p, g, q: null, c: since(c, generatedAt), ...(x ? { x } : {}) }, SIGNAL, table);
    }
    if (!s || typeof s !== 'object') return null;
    const nested = Object.fromEntries(NESTED.filter(([, key]) => s[key] !== undefined).map(([, key, spec]) => [key, unpackNested(s[key], spec)]));
    return expand({ ...s, ...nested, v: s.v ?? engine, d: s.d ?? side, ...(s.c !== undefined ? { c: since(s.c, generatedAt) } : {}) }, SIGNAL, table);
  }
  const finiteOr = (value, fallback = null) => Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : fallback;

  // rows: analysed radar rows (state.analyzedCache values or rows decoded earlier).
  // tickers: the Bitget quotes the rows were ranked with. Returns a JSON-ready object.
  // frames: also keep each coin's eligible single-timeframe tiers (時間組合 mode).
  function encode({ rows = [], tickers = [], generatedAt = Date.now(), startedAt = generatedAt, closes = {}, pool = tickers.length, failed = [], short = [], tiers = null,
    complete = true, frames: withFrames = true, engine = root.OXClassic?.CLASSIC_VERSION ?? null } = {}) {
    const words = strings(), packed = [];
    for (const row of rows) {
      if (!row?.symbol || !Number.isFinite(row.at)) continue;
      const main = signalPair(row.classic, row.classicSignal);
      if (!main.long || !main.short) continue;
      const frames = withFrames ? Object.entries(row.timeframeTiers || {}).filter(([, data]) => data?.eligible && Number.isFinite(data.at) && data.classic?.long && data.classic?.short)
        .map(([frame, data]) => [frame, signalPair(data.classic, data.classicSignal), data.at, data.closedAt ?? null]) : [];
      packed.push({ row, main, frames });
      for (const pair of [main, ...frames.map(f => f[1])]) for (const s of [pair.long, pair.short, typeof pair.pick === 'object' ? pair.pick : null]) walkStrings(s, SIGNAL, words.count);
      for (const value of [row.signalFrame, row.triggerFrame, ...frames.map(f => f[0])]) words.count(value);
    }
    const { list, index } = words.table();
    const ref = value => index.has(value) ? index.get(value) : value;
    const pair = p => [packSignal(p.long, 'LONG', engine, generatedAt, ref), packSignal(p.short, 'SHORT', engine, generatedAt, ref),
      typeof p.pick === 'object' && p.pick ? packSignal(p.pick, null, engine, generatedAt, ref) : p.pick];
    const secondsBefore = at => Math.round((generatedAt - at) / 1000);
    // The quote a row was ranked with travels in the row; other quotes follow separately.
    const quotes = new Map(tickers.filter(t => t?.symbol).map(t => [t.symbol, t]));
    const quote = t => [String(t.lastPr ?? ''), String(t.change24h ?? ''), String(Math.round(finiteOr(t.usdtVolume, 0)))];
    const out = {
      schema: SCHEMA, engine, generatedAt, startedAt, complete, closes, pool, failed, short, strings: list,
      // [symbol, seconds before generation, last 1H close, signal / trigger frame, liquidity,
      //  RS, turnover percentile, 1H / 4H / 24H return, long, short, chosen, frame tiers, quote]
      rows: packed.map(({ row, main, frames }) => { const t = quotes.get(row.symbol); quotes.delete(row.symbol);
        return [row.symbol, secondsBefore(row.at), finiteOr(row.lastPrice), ref(row.signalFrame ?? null), ref(row.triggerFrame ?? null),
          finiteOr(row.liqScore), finiteOr(row.rsScore), row.liqPercentile ?? null, roundRatio(finiteOr(row.ret1h)), roundRatio(finiteOr(row.ret4h)), roundRatio(finiteOr(row.ret24h)),
          ...pair(main), frames.length ? Object.fromEntries(frames.map(([frame, p, at, closedAt]) => [ref(frame), [...pair(p), secondsBefore(at), ago(closedAt, generatedAt)]])) : 0,
          t ? quote(t) : 0]; }),
      tickers: [...quotes.values()].map(t => [t.symbol, ...quote(t)]),
      // 首頁 shows the 24H range of the benchmarks.
      ranges: Object.fromEntries(tickers.filter(t => BENCHMARKS.includes(t?.symbol)).map(t => [t.symbol, [String(t.high24h ?? ''), String(t.low24h ?? '')]]))
    };
    if (tiers) out.tiers = tiers;
    return out;
  }

  // OXEngine is a script-level binding of engine.js, not a property of globalThis.
  const describer = () => typeof OXEngine !== 'undefined' ? OXEngine : root.OXEngine || null;
  // Returns { meta, tickers, rows } or null when the data is unusable here.
  function decode(snapshot, { engine = root.OXClassic?.CLASSIC_VERSION ?? null } = {}) {
    if (!snapshot || snapshot.schema !== SCHEMA || !Array.isArray(snapshot.rows) || !Array.isArray(snapshot.strings) || !Number.isFinite(snapshot.generatedAt)) return null;
    if (engine !== null && snapshot.engine !== engine) return null;
    const table = snapshot.strings, generatedAt = snapshot.generatedAt, version = snapshot.engine;
    const word = v => typeof v === 'number' ? table[v] : v;
    const pair = (long, short, pick) => {
      const classic = { long: unpackSignal(long, 'LONG', version, generatedAt, table), short: unpackSignal(short, 'SHORT', version, generatedAt, table) };
      return { classic, classicSignal: pick === 0 ? classic.long : pick === 1 ? classic.short : unpackSignal(pick, null, version, generatedAt, table) || classic.long };
    };
    const ranges = snapshot.ranges || {}, tickers = [];
    const addTicker = (symbol, [lastPr, change24h, usdtVolume] = []) => tickers.push({ symbol, lastPr, change24h, usdtVolume,
      ...(ranges[symbol] ? { high24h: ranges[symbol][0], low24h: ranges[symbol][1] } : {}), ts: String(generatedAt) });
    const rows = [];
    for (const r of snapshot.rows) {
      if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
      const [symbol, age, lastPrice, signalFrame, triggerFrame, liqScore, rsScore, liqPercentile, ret1h, ret4h, ret24h, long, short, pick, frames, quote] = r;
      if (Array.isArray(quote)) addTicker(symbol, quote);
      const main = pair(long, short, pick);
      if (!main.classic.long || !main.classic.short) continue;
      const timeframeTiers = {};
      for (const [frame, [fl, fs, fp, fa, closedAt]] of Object.entries(frames || {})) {
        const data = pair(fl, fs, fp), name = word(/^\d+$/.test(frame) ? Number(frame) : frame), engineRuntime = describer();
        if (!data.classic.long || !data.classic.short || !name) continue;
        // classifyTierFrame's shape: the describe() row of that frame plus its times.
        timeframeTiers[name] = { ...(engineRuntime ? engineRuntime.describe(data.classicSignal, data.classic) : { classic: data.classic, classicSignal: data.classicSignal, eligible: data.classicSignal.eligible, side: data.classicSignal.side }),
          at: generatedAt - fa * 1000, closedAt: since(closedAt, generatedAt) };
      }
      rows.push({ symbol, at: generatedAt - age * 1000, lastPrice, signalFrame: word(signalFrame), triggerFrame: word(triggerFrame), liqScore, rsScore, liqPercentile,
        ret1h, ret4h, ret24h, ...main, timeframeTiers });
    }
    for (const [symbol, ...quote] of snapshot.tickers || []) if (typeof symbol === 'string') addTicker(symbol, quote);
    const { schema, startedAt = generatedAt, complete = true, closes = {}, pool = tickers.length, failed = [], short = [], tiers = null } = snapshot;
    return { meta: { schema, engine: version, generatedAt, startedAt, complete, closes, pool, failed, short, tiers }, tickers, rows };
  }

  // ---- planning (pure) --------------------------------------------------------
  const hourStart = at => Math.floor(at / HOUR) * HOUR;
  // A complete evaluation counts as fresh within its own 1H candle for 20 minutes.
  function isFresh(evaluatedAt, now = Date.now()) {
    return Number.isFinite(evaluatedAt) && evaluatedAt > 0 && evaluatedAt >= hourStart(now) && now - evaluatedAt < FRESH_MS;
  }
  const qualifies = row => ['long', 'short'].some(side => root.OXClassic?.qualifyClassicRow(row, side, { observations: true }));
  // Coins whose rows are on screen first (T1 → T3, both directions), then every other
  // saved candidate by quality.
  function candidateSymbols(rows, tierMapBySide) {
    const out = [];
    for (const tier of ['t1', 't2', 't3']) for (const side of ['long', 'short']) for (const row of tierMapBySide?.[side]?.[tier] || []) out.push(row.symbol);
    const rest = rows.filter(qualifies).sort((a, b) => (Number(b.classicSignal?.qualityScore) || 0) - (Number(a.classicSignal?.qualityScore) || 0) || (a.symbol < b.symbol ? -1 : 1));
    return [...new Set([...out, ...rest.map(row => row.symbol)])];
  }
  // tickers: the scan universe (usdtVolume > 0). Returns the symbols of the next pass.
  function planPass({ tickers, rows, tierMapBySide, fresh, full = !fresh, top = TOP_TURNOVER }) {
    const inUniverse = new Set(tickers.map(t => t.symbol));
    const byTurnover = [...tickers].sort((a, b) => (Number(b.usdtVolume) || 0) - (Number(a.usdtVolume) || 0) || (a.symbol < b.symbol ? -1 : 1)).map(t => t.symbol);
    const head = [...BENCHMARKS.filter(s => inUniverse.has(s)), ...candidateSymbols(rows, tierMapBySide).filter(s => inUniverse.has(s))];
    const tail = full ? byTurnover : byTurnover.slice(0, top);
    return [...new Set([...head, ...tail])];
  }
  // Newer analysis of a coin always wins; saved rows older than the radar keeps are skipped.
  function mergeRows(current, incoming, now = Date.now()) {
    const accepted = [];
    for (const row of incoming) {
      if (!row?.symbol || !Number.isFinite(row.at) || now - row.at > RETAIN_MS) continue;
      const existing = current.get(row.symbol);
      if (existing && existing.at >= row.at) continue;
      accepted.push(row);
    }
    return accepted;
  }
  function closeLabel(close, timeZone = 'Asia/Taipei') {
    if (!Number.isFinite(close)) return '';
    try { return new Intl.DateTimeFormat('zh-TW', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(close)); }
    catch { const d = new Date(close + 8 * HOUR); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; }
  }

  const api = { SCHEMA, SOURCES, FRESH_MS, RETAIN_MS, TOP_TURNOVER, encode, decode, isFresh, planPass, candidateSymbols, mergeRows, closeLabel, hourStart };

  // ---- the page --------------------------------------------------------------
  const page = typeof document !== 'undefined' && typeof document.createElement === 'function' && typeof fetch === 'function' && !root.OXRadarSnapshotHeadless ? createPage() : null;

  function createPage() {
    const DB = 'ox-crypto-radar', STORE = 'kv', KEY = 'latest', FALLBACK_KEY = 'ox-crypto-radar-cache-v1';
    const run = { loaded: false, evaluatedAt: 0, quotesAt: 0, close: null, server: null, restored: new Map(), pass: null, refreshing: false, updatedAt: 0, saveTimer: 0, pollTimer: 0, labelTimer: 0, firstPaintAt: 0, sources: [] };
    // `state` is runtime-config.js's script-level binding, not a property of globalThis.
    const cryptoState = () => typeof state !== 'undefined' ? state : null;

    function idb(mode, work) {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(Error('IndexedDB unavailable'));
        const open = indexedDB.open(DB, 1);
        open.onupgradeneeded = () => open.result.createObjectStore(STORE);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          try {
            const tx = db.transaction(STORE, mode), request = work(tx.objectStore(STORE));
            tx.oncomplete = () => { db.close(); resolve(request?.result); };
            tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
          } catch (error) { db.close(); reject(error); }
        };
      });
    }
    async function readCache() {
      try { const value = await idb('readonly', store => store.get(KEY)); if (value) return value; } catch {}
      try { return JSON.parse(localStorage.getItem(FALLBACK_KEY)); } catch { return null; }
    }
    async function writeCache(value) {
      try { await idb('readwrite', store => store.put(value, KEY)); try { localStorage.removeItem(FALLBACK_KEY); } catch {} return; } catch {}
      try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(value)); } catch {}
    }
    async function fetchSource(url, timeoutMs) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => controller?.abort(), timeoutMs);
      try {
        const response = await fetch(url, { cache: 'no-cache', credentials: 'omit', signal: controller?.signal });
        if (!response.ok) return null;
        return await response.json();
      } catch { return null; } finally { clearTimeout(timer); }
    }
    // Same origin first (the Site's data release), then the live-data branch. Decoding
    // waits for the page's engine scripts (this file loads in <head> to start early).
    async function fetchSnapshot() {
      for (const [i, url] of SOURCES.entries()) {
        const json = await fetchSource(url, SOURCE_TIMEOUTS[i]);
        const usable = json?.schema === SCHEMA && json.complete !== false && Array.isArray(json.rows) && json.rows.length > 0;
        run.sources.push({ url, ok: usable, rows: usable ? json.rows.length : 0, at: Date.now() }); if (run.sources.length > 8) run.sources.shift();
        if (usable) return json;
      }
      return null;
    }

    function tickerMap() {
      const s = cryptoState();
      return new Map((s?.tickers || []).map(t => [t.symbol, t]));
    }
    function apply(decoded, source) {
      const s = cryptoState();
      if (!s || !decoded?.rows.length || (s.activeMarket && s.activeMarket !== 'crypto')) return false;
      // Until the live quote list arrives, the saved one ranks and prices the rows.
      if (decoded.tickers.length && (!s.tickers.length || s.tickersSource === 'saved' && decoded.meta.generatedAt > run.quotesAt)) {
        s.tickers = decoded.tickers; s.tickersSource = 'saved'; run.quotesAt = decoded.meta.generatedAt;
        s.btcTicker = s.tickers.find(t => t.symbol === 'BTCUSDT') || null; s.ethTicker = s.tickers.find(t => t.symbol === 'ETHUSDT') || null;
      }
      const quotes = tickerMap();
      for (const t of decoded.tickers) if (!quotes.has(t.symbol)) quotes.set(t.symbol, t);
      const accepted = mergeRows(s.analyzedCache, decoded.rows);
      const restored = typeof restoreRadarRows === 'function' ? restoreRadarRows(accepted, quotes) : 0;
      for (const row of accepted) { const now = s.analyzedCache.get(row.symbol); if (now?.at === row.at) run.restored.set(row.symbol, row.at); }
      const evaluated = decoded.meta.complete && decoded.meta.startedAt > run.evaluatedAt;
      if (evaluated) run.evaluatedAt = decoded.meta.startedAt;
      const close = Number.isFinite(decoded.meta.closes?.['1H']) ? decoded.meta.closes['1H'] : hourStart(decoded.meta.startedAt);
      if (restored && (!run.close || close > run.close)) run.close = close;
      if (source === 'server' && (!run.server || decoded.meta.generatedAt > run.server.generatedAt)) run.server = decoded.meta;
      if (!restored && !evaluated) return false;
      if (restored) {
        if (!run.loaded) run.firstPaintAt = Date.now();
        run.loaded = true; run.refreshing = true;
        // 時間組合 lists need single-timeframe tiers, which the hourly file leaves out.
        if (!tierModeWithoutFrames()) s.radarSnapshotReady = true;
      }
      replan();
      paint();
      return restored > 0;
    }
    function tierModeWithoutFrames() {
      const s = cryptoState();
      if (!root.OXTierFilters?.get?.('crypto')?.enabled) return false;
      return ![...run.restored.keys()].some(symbol => Object.keys(s?.analyzedCache.get(symbol)?.timeframeTiers || {}).length);
    }
    function paint() {
      const s = cryptoState(); if (!s || s.activeMarket !== 'crypto') return;
      // rebuildTierLists also renders 首頁 and OX LIVE when they are showing.
      try { if (typeof rebuildTierLists === 'function') rebuildTierLists(); } catch (error) { console.error('Radar snapshot ranking failed', error); }
      // The list is 行情 → 雷達; the quote card belongs to the 個股 page.
      try { if (s.activeView === 'strength') renderCurrentTab(); if (s.activeView === 'stock') { updateHeaderHUD(); renderBenchmarkBar(); } } catch {}
      label();
    }
    // A fresh complete evaluation re-checks its candidates; otherwise the full scan.
    function plan(tickers) {
      const s = cryptoState();
      const tierFilter = root.OXTierFilters?.get?.('crypto')?.enabled;
      if (!run.loaded && !run.evaluatedAt && !s?.analyzedCache.size) { run.pass = { full: true, startedAt: Date.now() }; return null; }
      const fresh = !tierFilter && isFresh(run.evaluatedAt);
      run.pass = { full: !fresh, startedAt: Date.now() };
      return planPass({ tickers, rows: [...s.analyzedCache.values()], tierMapBySide: s.tierMapBySide, fresh });
    }
    // The snapshot arrived after the scan started: continue with what it still needs.
    function replan() {
      const s = cryptoState();
      if (!s?.isQueueRunning || !run.pass?.full || !isFresh(run.evaluatedAt) || root.OXTierFilters?.get?.('crypto')?.enabled) return;
      const eligible = s.tickers.filter(t => Number(t.usdtVolume) > 0), done = new Set(s.scanQueue.slice(0, s.scanIndex));
      const next = planPass({ tickers: eligible, rows: [...s.analyzedCache.values()], tierMapBySide: s.tierMapBySide, fresh: true }).filter(symbol => !done.has(symbol));
      run.pass = { full: false, startedAt: run.pass.startedAt };
      s.scanQueue = next; s.scanIndex = 0;
    }
    function onPass({ completed = 0, failed = 0 } = {}) {
      const s = cryptoState();
      // A complete pass that started inside this 1H candle is a fresh evaluation.
      if (run.pass?.full && completed > 0 && failed <= Math.max(3, Math.floor((s?.scanQueue.length || 0) * .02)) && run.pass.startedAt > run.evaluatedAt) run.evaluatedAt = run.pass.startedAt;
      if (completed > 0) { run.refreshing = false; run.updatedAt = Date.now(); }
      label();
    }
    function restMs() { return isFresh(run.evaluatedAt) && !root.OXTierFilters?.get?.('crypto')?.enabled ? PARTIAL_REST_MS : 0; }
    // Live quotes reach rows that were restored and not scanned again yet.
    function onTickers() {
      const s = cryptoState(); if (!s) return;
      const quotes = tickerMap();
      for (const [symbol, at] of run.restored) {
        const row = s.analyzedCache.get(symbol), ticker = quotes.get(symbol);
        if (!row || row.at !== at) { run.restored.delete(symbol); continue; }
        if (ticker && ticker !== row.ticker) s.analyzedCache.set(symbol, { ...row, ticker, change24h: Number(ticker.change24h) || 0 });
      }
      label();
    }
    function save() { clearTimeout(run.saveTimer); run.saveTimer = setTimeout(saveNow, 1500); }
    function saveNow() {
      run.saveTimer = 0;
      const s = cryptoState(); if (!s?.analyzedCache.size) return;
      const value = encode({ rows: [...s.analyzedCache.values()], tickers: s.tickers, generatedAt: Date.now(), startedAt: run.evaluatedAt || Date.now(),
        complete: run.evaluatedAt > 0, closes: { '1H': run.evaluatedAt ? hourStart(run.evaluatedAt) : run.close }, pool: s.scanQueue.length });
      writeCache(value);
    }

    function label() {
      const s = cryptoState();
      const text = !run.loaded ? '' : run.refreshing ?
        // Without a live connection the saved close stays labelled, without 更新中.
        s?.radarLoadError ? `${closeLabel(run.close)} 收盤` :
        `${closeLabel(run.close)} 收盤・更新中${run.pass?.full && s?.scanQueue.length ? ` ${Math.min(s.scanIndex, s.scanQueue.length)}/${s.scanQueue.length}` : ''}` :
        `${closeLabel(run.updatedAt)} 已更新`;
      for (const host of [document.getElementById('screener-list'), document.querySelector('#view-home .ox-home-t1')]) {
        if (!host) continue;
        let node = host.id === 'screener-list' ? host.previousElementSibling?.matches?.('[data-radar-freshness]') ? host.previousElementSibling : null : host.querySelector(':scope > [data-radar-freshness]');
        if (!node && text) {
          node = document.createElement('small'); node.dataset.radarFreshness = ''; node.setAttribute('aria-live', 'polite');
          node.style.cssText = host.id === 'screener-list' ? 'display:block;padding:2px 12px 4px;font-size:11px;line-height:1.4;color:var(--muted);text-align:right' :
            'grid-column:1/-1;display:block;padding:6px 12px 8px;font-size:11px;line-height:1.4;color:var(--muted);text-align:right';
          if (host.id === 'screener-list') host.before(node); else host.append(node);
        }
        if (node) { node.hidden = !text; if (node.textContent !== text) node.textContent = text; }
      }
      // Follow a full pass's progress and the connection while the saved rows refresh.
      clearTimeout(run.labelTimer); run.labelTimer = 0;
      if (run.refreshing && !document.hidden) run.labelTimer = setTimeout(label, 1000);
    }

    // Check for the next hourly snapshot a few minutes after each close.
    function schedulePoll() {
      clearTimeout(run.pollTimer);
      const now = Date.now(), base = hourStart(now), due = run.server?.closes?.['1H'] >= base ? base + HOUR + 4 * 60000 : Math.max(now + 180000, base + 4 * 60000);
      run.pollTimer = setTimeout(async () => {
        if (document.hidden) { schedulePoll(); return; }
        if (Date.now() - hourStart(Date.now()) < 30 * 60000) { const next = decode(await fetchSnapshot()); if (next && apply(next, 'server')) save(); }
        schedulePoll();
      }, Math.max(30000, due - now));
    }

    async function boot() {
      const cache = readCache().then(value => { if (value) whenReady(() => { const decoded = decode(value); if (decoded) apply(decoded, 'cache'); }); }, () => {});
      const server = fetchSnapshot().then(json => { if (json) whenReady(() => { const decoded = decode(json); if (decoded && apply(decoded, 'server')) save(); }); }, () => {});
      await Promise.allSettled([cache, server]);
      whenReady(() => { label(); schedulePoll(); });
    }
    // Once the document is parsed every classic script (scanner, engine, renderers) has run.
    function whenReady(work) {
      if (document.readyState !== 'loading') { work(); return; }
      const go = () => { if (document.readyState === 'loading') return; document.removeEventListener('readystatechange', go); work(); };
      document.addEventListener('readystatechange', go);
    }
    for (const event of ['ox:viewchange', 'ox:filterchange']) document.addEventListener(event, () => setTimeout(label, 0));
    // Switching to 時間組合 with rows from the hourly file: show the scan progress, not an empty list.
    document.addEventListener('ox:timeframe-tier-change', event => {
      const s = cryptoState();
      if (event.detail?.market !== 'crypto' || !s || !run.restored.size) return;
      const waiting = tierModeWithoutFrames();
      if (s.radarSnapshotReady === !waiting) return;
      s.radarSnapshotReady = !waiting;
      try { if (s.activeView === 'strength') renderCurrentTab(); } catch {}
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { if (run.loaded) saveNow(); } else label(); });
    boot();
    return { plan, onPass, restMs, onTickers, save, restore() {}, loaded: () => run.loaded, stats: () => ({ ...run, restored: run.restored.size, label: document.querySelector('[data-radar-freshness]')?.textContent || '' }) };
  }

  root.OXRadarSnapshot = Object.freeze({ ...api, ...(page || { plan: () => null, onPass() {}, restMs: () => 0, onTickers() {}, save() {}, restore() {}, loaded: () => false, stats: () => null }) });
})(globalThis);
