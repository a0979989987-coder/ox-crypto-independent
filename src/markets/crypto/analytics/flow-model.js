// Crypto-only, venue-specific taker pressure. These are not cash-inflow estimates.
export const PERIODS = Object.freeze({ '15m': 900000, '1h': 3600000, '4h': 14400000 });
export const STATES = Object.freeze([
  { id: 'buy-up', name: '買壓增強', note: '買方占優，力道增加', color: '#91c7b1', direction: '↗' },
  { id: 'buy-down', name: '買壓放緩', note: '買方占優，力道放緩', color: '#cfbc91', direction: '↘' },
  { id: 'sell-down', name: '賣壓放緩', note: '賣方占優，力道放緩', color: '#9eaec4', direction: '↗' },
  { id: 'sell-up', name: '賣壓增強', note: '賣方占優，力道增加', color: '#cd9399', direction: '↘' }
]);
export function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
export function pressure(row) {
  const b = finite(row?.buyVolume), s = finite(row?.sellVolume);
  return b !== null && s !== null && b >= 0 && s >= 0 && b + s > 0 ? 100 * (b - s) / (b + s) : null;
}
export function classify(x, y) {
  if (x === 0 || y === 0) return { id: 'neutral', name: '中性／持平', color: '#a5aaa9', direction: '—' };
  return STATES[x > 0 ? (y > 0 ? 0 : 1) : (y > 0 ? 2 : 3)];
}
export function cryptoUniverse(instruments, tickers, limit = 20) {
  // Require explicit asset metadata. Never silently treat stocks or unknown instruments as crypto.
  const bySymbol = new Map(instruments.filter(i => i.symbolType === 'crypto' && i.type === 'perpetual' && i.status === 'online' && i.quoteCoin === 'USDT').map(i => [i.symbol, i]));
  return tickers.filter(t => bySymbol.has(t.symbol) && finite(t.usdtVolume) > 0)
    .sort((a, b) => Number(b.usdtVolume) - Number(a.usdtVolume)).slice(0, limit)
    .map(t => ({ ...t, baseCoin: bySymbol.get(t.symbol).baseCoin }));
}
export function buildFlow(snapshot, period = '1h', {target:requestedTarget=null}={}) {
  const interval = PERIODS[period];
  if (!interval) throw new Error('Unsupported period');
  const entries = snapshot.flows?.[period] || {};
  const universe = cryptoUniverse(snapshot.instruments || [], snapshot.tickers || []);
  const pairs = new Map(); const candidates = new Map();
  for (const ticker of universe) {
    const response = entries[ticker.symbol]?.response;
    const sourceTime = finite(response?.requestTime);
    if (!sourceTime || !Array.isArray(response?.data)) continue;
    // Conservatively exclude the latest possibly open source period. No local clock assumption.
    const cutoff = Math.floor(sourceTime / interval) * interval - interval;
    const records = new Map(response.data.filter(r => Number(r.ts) <= cutoff && Number(r.ts) % interval === 0 && pressure(r) !== null).map(r => [Number(r.ts), r]));
    const valid = new Map();
    for (const [ts, row] of records) if (records.has(ts - interval)) {
      valid.set(ts, [row, records.get(ts - interval)]);
      candidates.set(ts, (candidates.get(ts) || 0) + 1);
    }
    pairs.set(ticker.symbol, valid);
  }
  // Largest common cohort first, newest period second; report excluded symbols, never zero-fill.
  const target = requestedTarget ?? ([...candidates].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || null);
  const rows = universe.flatMap(t => {
    const pair = pairs.get(t.symbol)?.get(target); if (!pair) return [];
    const [current, previous] = pair; const x = pressure(current), old = pressure(previous), y = x - old;
    return [{ symbol: t.symbol, base: t.baseCoin, price: finite(t.lastPr), change24h: finite(t.change24h) === null ? null : Number(t.change24h) * 100,
      turnover: Number(t.usdtVolume), tickerTime: Number(t.ts || snapshot.tickerRequestTime), x, y, previous: old,
      buy: Number(current.buyVolume), sell: Number(current.sellVolume), ts: target, state: classify(x, y) }];
  });
  return { rows, target, period, excluded: universe.filter(t => !rows.some(r => r.symbol === t.symbol)).map(t => t.symbol), expected: universe.length };
}
// Replay retains the current cohort and uses only consecutive, closed periods.
export function buildFlowHistory(snapshot,period='1h',wantedFrames=8) {
  const current=buildFlow(snapshot,period);if(!current.target)return {frames:[],current,period};
  const frames=[];
  for(let i=wantedFrames-1;i>=0;i--){const model=buildFlow(snapshot,period,{target:current.target-i*PERIODS[period]});
    if(current.rows.every(r=>model.rows.some(previous=>previous.symbol===r.symbol)))frames.push({...model,rows:model.rows.filter(r=>current.rows.some(c=>c.symbol===r.symbol)),ts:model.target});
  }
  return {frames,current,period};
}
const dateFormatter=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
export const signed = (value, digits = 1) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(digits)}` : '—';
export const compact = value => !Number.isFinite(value) ? '—' : value >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : value.toFixed(1);
export const dateLabel = ts => ts ? dateFormatter.format(new Date(ts)) : '—';
