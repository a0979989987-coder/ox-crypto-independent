// 公布前後走勢 (data/macro-reactions.json): 5-minute bars of the Bitget USDT perpetuals
// BTCUSDT and ETHUSDT from one hour before to three hours after each US jobs report
// (非農), CPI and FOMC decision, so the calendar can put a release beside the previous one.
//   node scripts/collect-macro-reactions.mjs
// Release times: data/macro-results.json (official release facts) first, then the BLS
// schedule in data/news.json for CPI／非農 releases that have no result record. Crypto
// trades around the clock, so past releases fill from Bitget's history candles; a window
// is final once it reaches its end, and final windows are kept as they are.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const BEFORE = 60, AFTER = 180, STEP = 5, KEEP = 8;
export const METRICS = ['nonfarm-payrolls', 'cpi-mom', 'fed-rate'];
export const INSTRUMENTS = Object.freeze({ btc: 'BTCUSDT', eth: 'ETHUSDT' });
const BLS_TITLES = { 'nonfarm-payrolls': /^Employment Situation for /, 'cpi-mom': /^Consumer Price Index for / };
const TITLES = { 'nonfarm-payrolls': '美國非農就業人口', 'cpi-mom': '美國 CPI 月增率', 'fed-rate': '美聯準會 FOMC 利率決策' };
const easternDay = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

// Released events, newest KEEP per metric: verified results first, then the BLS schedule
// for the same metric on another day (same id scheme: macro:<metric>:<US release date>).
export function pickEvents(macro, news = null, now = Date.now()) {
  const byId = new Map();
  for (const e of macro?.events || []) {
    const at = Date.parse(e.releasedAt);
    if (!METRICS.includes(e.metric) || !(at <= now)) continue;
    byId.set(e.id, { id: e.id, metric: e.metric, title: e.titleZh || e.title || TITLES[e.metric], releasedAt: new Date(at).toISOString() });
  }
  for (const e of news?.events || []) {
    const metric = Object.keys(BLS_TITLES).find(m => BLS_TITLES[m].test(e.title || '')), at = Date.parse(e.occursAt);
    if (!metric || e.sourceId !== 'bls-calendar' || e.status === 'cancelled' || !(at <= now)) continue;
    const id = `macro:${metric}:${easternDay(at)}`;
    if (!byId.has(id)) byId.set(id, { id, metric, title: TITLES[metric], releasedAt: new Date(at).toISOString() });
  }
  return METRICS.flatMap(m => [...byId.values()].filter(e => e.metric === m).sort((a, b) => b.releasedAt.localeCompare(a.releasedAt)).slice(0, KEEP));
}
export function windowOf(releasedAt) {
  const at = Date.parse(releasedAt);
  return { at, from: at - BEFORE * 60000, to: at + AFTER * 60000 };
}
// Bitget candles [ms, open, high, low, close, base volume, quote volume] → closed bars
// [seconds, open, high, low, close, volume] inside [from, to), oldest first.
export function bitgetBars(json, from, to, now = Infinity) {
  if (json?.code !== '00000' || !Array.isArray(json.data)) return null;
  const bars = new Map();
  for (const row of json.data) {
    const t = Number(row?.[0]), [o, h, l, c, v] = (row || []).slice(1, 6).map(Number);
    if (!(t >= from && t < to) || t + STEP * 60000 > now || ![o, h, l, c].every(x => Number.isFinite(x) && x > 0) || h < l) continue;
    bars.set(t, [t / 1000, o, h, l, c, Number.isFinite(v) ? Math.round(v * 100) / 100 : 0]);
  }
  const list = [...bars.values()].sort((a, b) => a[0] - b[0]);
  return list.length ? { bars: list } : null;
}
// A window is final once its last bar reaches the end of the window.
export const done = (window, to) => !!window?.bars?.length && window.bars.at(-1)[0] * 1000 >= to - 10 * 60000;

async function main() {
  const root = new URL('../', import.meta.url), file = new URL('data/macro-reactions.json', root);
  const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
  const macro = await read('data/macro-results.json'), news = await read('data/news.json').catch(() => null);
  let old = { events: {} }; try { old = await read('data/macro-reactions.json'); } catch {}
  const pause = ms => new Promise(r => setTimeout(r, ms));
  let requests = 0;
  // Bitget's public limit is shared with the site's visitors' browsers: one request at a time, with a pause.
  async function candles(symbol, from, to) {
    const url = `https://api.bitget.com/api/v2/mix/market/history-candles?symbol=${symbol}&productType=USDT-FUTURES&granularity=${STEP}m&startTime=${from}&endTime=${to}&limit=200`;
    for (let attempt = 0; ; attempt++) {
      if (requests++) await pause(350);
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'OX-MacroReactions/1.0' }, signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (json?.code !== '00000') throw Error(`Bitget ${json?.code} ${json?.msg || ''}`.trim());
        return json;
      } catch (error) { if (attempt) throw error; await pause(1500); }
    }
  }
  const events = {}, now = Date.now();
  for (const e of pickEvents(macro, news, now)) {
    const { from, to } = windowOf(e.releasedAt), prev = old.events?.[e.id]?.releasedAt === e.releasedAt ? old.events[e.id] : {};
    const item = { metric: e.metric, title: e.title, releasedAt: e.releasedAt };
    for (const [key, symbol] of Object.entries(INSTRUMENTS)) {
      item[key] = prev[key] || null;
      if (done(item[key], to)) continue;
      try { item[key] = bitgetBars(await candles(symbol, from, Math.min(to, now)), from, to, now) || item[key]; }
      catch (error) { console.warn(`${symbol} ${e.id} unavailable:`, error.message); }
    }
    events[e.id] = item;
  }
  const next = { version: 1, updatedAt: new Date().toISOString(), source: 'Bitget USDT 永續', window: { before: BEFORE, after: AFTER, step: STEP }, events };
  const same = JSON.stringify({ ...next, updatedAt: null }) === JSON.stringify({ ...old, updatedAt: null });
  if (!same) await writeFile(file, JSON.stringify(next) + '\n');
  console.log(JSON.stringify({ changed: !same, requests, events: Object.fromEntries(Object.entries(events).map(([id, e]) => [id, Object.fromEntries(Object.keys(INSTRUMENTS).map(k => [k, e[k]?.bars.length || 0]))])) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1; });
