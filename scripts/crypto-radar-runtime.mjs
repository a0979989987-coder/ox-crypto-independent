// The page's own radar code (runtime config, Bitget client, OX 經典 engine, crypto
// liquidity policy, scanner and the snapshot codec), loaded unchanged into a Node vm
// context. scripts/collect-crypto-radar.mjs and the tests run the scan with it, so the
// hourly snapshot can never drift from what the browser computes.
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

export const RADAR_SCRIPTS = Object.freeze([
  'src/core/runtime-config.js',
  'src/components/strength/snapshots.js',
  'src/markets/crypto/api.js',
  'src/core/classic-engine.js',
  'src/markets/crypto/liquidity-policy.js',
  'src/markets/crypto/engine.js',
  'src/markets/crypto/scanner.js',
  'src/markets/crypto/radar-snapshot.js'
]);
const root = new URL('../', import.meta.url);
const sources = new Map();
const source = path => { if (!sources.has(path)) sources.set(path, readFileSync(new URL(path, root), 'utf8')); return sources.get(path); };

function memoryStorage() {
  const values = new Map();
  return { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null, getItem: k => values.has(k) ? values.get(k) : null,
    setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k), clear: () => values.clear() };
}

// json(url, {timeoutMs}) answers like OXPublicFeed.json: the parsed Bitget body.
export function createRadarRuntime({ json }) {
  const noop = () => {};
  const element = null;
  const document = { hidden: false, body: null, getElementById: () => element, querySelector: () => element, querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop };
  const context = createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, URL, URLSearchParams, AbortController, AbortSignal, DOMException,
    TextEncoder, TextDecoder, structuredClone, document, localStorage: memoryStorage(), CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    addEventListener: noop, removeEventListener: noop, OXRadarSnapshotHeadless: true,
    OXPublicFeed: { json: (url, options = {}) => json(String(url), options), cancel: noop },
    // DOM-only callbacks the shared functions notify after a ranking change.
    syncKeyLevelVisibilityUI: noop, setKeyLevelsVisible: noop, syncWatchBadge: noop, renderOxLive: noop, renderMarketStrength: noop, renderHomeOverview: noop
  });
  context.window = context;
  for (const path of RADAR_SCRIPTS) runInContext(source(path), context, { filename: path });
  const run = code => runInContext(code, context);
  return {
    context,
    state: run('state'),
    BitgetAPI: run('BitgetAPI'),
    OXClassic: run('OXClassic'),
    OXEngine: run('OXEngine'),
    codec: run('OXRadarSnapshot'),
    applyCryptoCatalog: run('applyCryptoCatalog'),
    selectCryptoTickers: run('selectCryptoTickers'),
    fetchCryptoRadarCandles: run('fetchCryptoRadarCandles'),
    cryptoRadarRow: run('cryptoRadarRow'),
    restoreRadarRows: run('restoreRadarRows'),
    rebuildTierLists: run('rebuildTierLists'),
    orderCryptoScanTickers: run('orderCryptoScanTickers'),
    num: run('num')
  };
}
