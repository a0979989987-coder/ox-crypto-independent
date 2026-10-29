// 對比 data → view: the records of data/crypto-breakouts.json (written by
// scripts/collect-crypto-breakouts.mjs at every 4H close), newest first, with each
// pick's return after 4 小時／1 天／3 天 against BTC over the same span, and the
// mini 4H charts as SVG strings. Pure functions: no DOM, no network.
import { patternById } from '../patterns/catalog.js?v=patterns5d-20260929';

export const STEP = 14400;
export const DEFAULT_PERIODS = Object.freeze([1, 6, 18]);
const TAIPEI = 8 * 3600; // UTC+8 all year
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const pad = n => String(n).padStart(2, '0');

export const coinName = symbol => String(symbol || '').replace(/USDT$/, '');
export const patternName = id => patternById(id)?.name || String(id || '型態');
// Unix seconds → 「10/29 08:00」 in Taipei time.
export function taipeiTime(seconds) {
  const d = new Date((seconds + TAIPEI) * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
export const periodLabel = (k, step = STEP) => { const hours = k * step / 3600; return hours < 24 || hours % 24 ? `${hours} 小時` : `${hours / 24} 天`; };
export const pct = v => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
export const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
// The next 4H close after `ms`, as 「12:00」 Taipei time.
export function nextCloseText(ms, step = STEP) {
  const next = (Math.floor(ms / 1000 / step) + 1) * step;
  return taipeiTime(next).split(' ')[1];
}

export const isLog = log => !!log && typeof log === 'object' && Array.isArray(log.points);

// The whole tab. A period is reached once the log has recorded the close k candles after
// the breakout candle; reached without a close (a coin delisted, a data gap) is "missing".
export function compareModel(log, { names = patternName } = {}) {
  if (!isLog(log)) return { points: [], empty: true, method: '', updatedAt: null };
  const step = num(log.step) > 0 ? log.step : STEP;
  const periods = Array.isArray(log.periods) && log.periods.length && log.periods.every(k => Number.isInteger(k) && k > 0) ? [...log.periods] : [...DEFAULT_PERIODS];
  const valid = log.points.filter(p => p && num(p.at) != null);
  const latest = num(log.at) ?? Math.max(-Infinity, ...valid.map(p => p.at));
  const btc = log.btc && typeof log.btc === 'object' ? log.btc : {};
  const points = [...valid].sort((a, b) => b.at - a.at).filter((p, i, list) => !i || p.at !== list[i - 1].at).map(point => {
    const from = num(btc[point.at]);
    const spans = periods.map(k => {
      const at = point.at + k * step, reached = latest >= at, to = num(btc[at]);
      return { k, label: periodLabel(k, step), at, reached, btc: reached && from > 0 && to > 0 ? (to / from - 1) * 100 : null };
    });
    const picks = (Array.isArray(point.picks) ? point.picks : []).filter(p => p && typeof p.s === 'string' && p.s).map(p => {
      const c = Array.isArray(p.c) ? p.c : [], base = num(c[0]);
      const results = spans.map(span => {
        const close = num(c[span.k]);
        const state = !span.reached ? 'wait' : base > 0 && close > 0 ? 'done' : 'missing';
        const ret = state === 'done' ? (close / base - 1) * 100 : null;
        return { k: span.k, label: span.label, state, ret, btc: span.btc, vs: ret != null && span.btc != null ? ret - span.btc : null };
      });
      const pts = (Array.isArray(p.pts) ? p.pts : []).filter(q => Array.isArray(q) && num(q[0]) != null && num(q[1]) > 0);
      return { s: p.s, coin: coinName(p.s), p: p.p, name: names(p.p), t: Number.isInteger(p.t) ? p.t : null, st: p.st || '', pts, c: c.map(num), base,
        results, last: [...results].reverse().find(r => r.state === 'done') || null };
    });
    return { at: point.at, time: taipeiTime(point.at), count: picks.length, pool: num(point.pool), scanned: num(point.scanned),
      spans, picks, settled: spans.every(s => s.reached) };
  });
  const updated = Date.parse(log.updatedAt);
  return { frame: log.frame || '4H', step, periods, latest: Number.isFinite(latest) ? latest : null, points, empty: !points.length,
    method: typeof log.method === 'string' ? log.method : '', updatedAt: Number.isFinite(updated) ? updated : null,
    updated: Number.isFinite(updated) ? taipeiTime(Math.floor(updated / 1000)) : '' };
}
// The point opened when the tab first shows: the newest one with picks.
export const defaultOpen = model => model.points.find(p => p.count)?.at ?? null;

// ---------- mini 4H charts ----------
export const MINI = Object.freeze({ width: 150, height: 96, pad: 4, bars: 48 });
const f = v => v.toFixed(1);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The pattern line on an x axis measured in candles from `t0`, clipped where it enters
// the window: points before `from` are replaced by the line's value at `from`.
function clipLine(pts, t0, step, from) {
  const raw = pts.map(([t, y]) => [(t - t0) / step, y]), out = [];
  raw.forEach(([x, y], i) => {
    if (x < from) return;
    const prev = raw[i - 1];
    if (!out.length && prev && prev[0] < from) out.push([from, prev[1] + (y - prev[1]) * (from - prev[0]) / (x - prev[0])]);
    out.push([x, y]);
  });
  return out;
}
function frame(values, xs, { width, height, pad }) {
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || hi * .01 || 1;
  return { X: x => pad + (x - xs[0]) / (xs[1] - xs[0] || 1) * (width - 2 * pad), Y: v => pad + (hi - v) / span * (height - 2 * pad) };
}
function marker(x, width, height, label, line = true) {
  const left = x > width * .62;
  return `${line ? `<line class="mk" x1="${f(x)}" x2="${f(x)}" y1="0" y2="${height}"/>` : ''}<text x="${f(left ? x - 4 : x + 4)}" y="10" text-anchor="${left ? 'end' : 'start'}">${esc(label)}</text>`;
}

// Candles [{time (open, seconds), open, high, low, close}], one uninterrupted 4H run.
// Shows up to `maxK` candles after the breakout (the 3 天 mark), shading them in the
// colour of the latest result; '' when the breakout candle is not in the series.
export function miniChart(pick, at, candles, { step = STEP, maxK = 18, label = '突破', size = MINI } = {}) {
  const { width, height, bars } = size, bt = at - step;
  const bi = candles.findIndex(c => c.time === bt);
  if (bi < 0) return '';
  const end = Math.min(candles.length - 1, bi + maxK), start = Math.max(0, end - bars + 1), shown = candles.slice(start, end + 1);
  const t0 = candles[start].time, line = clipLine(pick.pts || [], t0, step, -.5).filter(([x]) => x <= end - start + .5);
  const values = [...shown.flatMap(c => [c.high, c.low]), ...line.map(p => p[1])];
  const n = shown.length, slot = (width - 2 * size.pad) / Math.max(n, 12);
  const { Y } = frame(values, [0, 1], size), X = x => size.pad + (x + .5) * slot, body = Math.max(1, slot * .62);
  let svg = '';
  const rel = bi - start, after = end - bi, last = pick.last?.ret;
  if (after > 0) svg += `<rect class="z${last == null ? 'flat' : tone(last)}" x="${f(X(rel) + slot / 2)}" y="0" width="${f(after * slot)}" height="${height}"/>`;
  svg += `<rect class="bk" x="${f(X(rel) - slot / 2)}" y="0" width="${f(slot)}" height="${height}"/>`;
  shown.forEach((c, i) => {
    const cls = c.close >= c.open ? 'u' : 'd', top = Y(Math.max(c.open, c.close)), x = X(i);
    svg += `<line class="${cls}" x1="${f(x)}" x2="${f(x)}" y1="${f(Y(c.high))}" y2="${f(Y(c.low))}"/><rect class="${cls}" x="${f(x - body / 2)}" y="${f(top)}" width="${f(body)}" height="${f(Math.max(.8, Y(Math.min(c.open, c.close)) - top))}"/>`;
  });
  if (line.length > 1) svg += `<polyline class="ln" points="${line.map(([x, y]) => f(X(x)) + ',' + f(Y(y))).join(' ')}"/>`;
  svg += marker(X(rel), width, height, label, false);
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${svg}</svg>`;
}

// Without candles: the pattern line before the breakout and the recorded closes after it.
export function closesChart(pick, at, { step = STEP, maxK = 18, size = MINI, before = size.bars - maxK - 1, label = '突破' } = {}) {
  const { width, height } = size, bt = at - step;
  const closes = (pick.c || []).slice(0, maxK + 1).map((v, k) => [k, v]).filter(([, v]) => v > 0);
  const line = clipLine(pick.pts || [], bt, step, -before);
  if (closes.length + line.length < 2) return '';
  const xs = [-before, Math.max(maxK, 6)], values = [...closes.map(p => p[1]), ...line.map(p => p[1])];
  const { X, Y } = frame(values, xs, size), last = pick.last?.ret;
  let svg = `<rect class="z${last == null ? 'flat' : tone(last)}" x="${f(X(0))}" y="0" width="${f(X(closes.at(-1)?.[0] || 0) - X(0))}" height="${height}"/>`;
  if (line.length > 1) svg += `<polyline class="ln" points="${line.map(([x, y]) => f(X(x)) + ',' + f(Y(y))).join(' ')}"/>`;
  if (closes.length > 1) svg += `<polyline class="cl ${last == null ? '' : tone(last)}" points="${closes.map(([x, y]) => f(X(x)) + ',' + f(Y(y))).join(' ')}"/>`;
  if (closes.length) svg += `<circle class="dot" cx="${f(X(0))}" cy="${f(Y(closes[0][1]))}" r="2"/>`;
  svg += marker(X(0), width, height, label);
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${svg}</svg>`;
}

// Bitget candle rows → closed 4H candles, the newest uninterrupted run (never filled in).
export function parseRows(rows, serverMs, step = STEP) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const [ms, open, high, low, close] = (row || []).slice(0, 5).map(Number), time = ms / 1000;
    if (![ms, open, high, low, close].every(Number.isFinite) || time % step || open <= 0 || close <= 0 || low <= 0 || high < low) continue;
    if ((time + step) * 1000 > serverMs) continue; // still forming
    map.set(time, { time, open, high, low, close });
  }
  const sorted = [...map.values()].sort((a, b) => a.time - b.time);
  let first = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].time - sorted[i - 1].time !== step) first = i;
  return sorted.slice(first);
}
