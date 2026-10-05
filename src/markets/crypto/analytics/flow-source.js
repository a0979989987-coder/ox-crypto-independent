import '../../../core/public-feed.js';
import { cryptoUniverse, PERIODS } from './flow-model.js';
const API = 'https://api.bitget.com';
const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
  const abort = () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')); };
  const id = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  signal.addEventListener('abort', abort, { once: true });
});
async function json(path, signal) {
  const body=await globalThis.OXPublicFeed.json(API+path,{signal,owner:'analytics',priority:20});
  if (body.code !== '00000' || !Array.isArray(body.data)) throw new Error('Bitget 暫時無法提供完整資料');
  return body;
}
export async function refreshFlow(period, { signal, onProgress = () => {} }) {
  if (!PERIODS[period]) throw new Error('Unsupported period');
  const [instruments, tickers] = await Promise.all([
    json('/api/v3/market/instruments?category=USDT-FUTURES', signal),
    json('/api/v2/mix/market/tickers?productType=USDT-FUTURES', signal)
  ]);
  const universe = cryptoUniverse(instruments.data, tickers.data);
  if (!universe.length) throw new Error('目前沒有可驗證的 Crypto 合約');
  const snapshot = { schemaVersion: 1, kind: 'fetched', source: 'Bitget', market: 'USDT-FUTURES', capturedAt: new Date().toISOString(), tickerRequestTime: tickers.requestTime, instruments: instruments.data, tickers: universe, flows: { [period]: {} } };
  for (let i = 0; i < universe.length; i++) {
    if (i) await pause(1100, signal); // published 1 request/sec/IP. Never flood from every frame.
    const symbol = universe[i].symbol;
    const path = `/api/v2/mix/market/taker-buy-sell?symbol=${encodeURIComponent(symbol)}&period=${period}`;
    try { snapshot.flows[period][symbol] = { path, response: await json(path, signal) }; }
    catch (error) { if (error.name === 'AbortError') throw error; snapshot.flows[period][symbol] = { path, error: error.message }; }
    onProgress(i + 1, universe.length);
  }
  snapshot.captureCompletedAt = new Date().toISOString();
  return snapshot;
}
