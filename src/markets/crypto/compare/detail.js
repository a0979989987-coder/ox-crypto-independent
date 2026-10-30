// 型態詳情, opened from a card on the 型態 tab: the coin's chart with the pattern
// before the breakout in fluorescent yellow (its line and a pale zone) and the
// candles after it shaded in the colour of the result; 1H／4H／1D／1W and the coin's
// other patterns on that timeframe; the signal's numbers and the system's reasons;
// a button to the 個股 page for the full K-line chart.
// The recorded 4H breakout is classified again by the board's own code on the 4H
// candles that had closed at that record (as scripts/crypto-breakouts.mjs did), so
// 失效價, 型態品質 and the reasons are the ones of that moment. Other timeframes and
// the coin's other patterns are classified on the current candles, as the board does.
// Requests: one Bitget candle series per timeframe opened (shared with the radar
// when it is current) and, for a record older than the series, one history page.
import { patternById } from '../patterns/catalog.js?v=patterns5d-20260929';
import { fetchSeries, parseCandles } from '../patterns/source.js?v=20261002-rank8';
import { prepareCandles, classifyPrepared, rankPatternMatches } from '../patterns/matcher.js?v=20261002-rank8';
import { STEP, taipeiTime, pct, tone } from './model.js?v=20261030-board2';
import { shareCoin, sharePrice, SHARE_UP, SHARE_DOWN, PERFORMANCE_NOTE, PICTURE_ICON } from '../share-image.js?v=20261031-share1';

export const FRAMES = Object.freeze([['1H', '1 小時'], ['4H', '4 小時'], ['1D', '日'], ['1W', '週']]);
const SECONDS = { '1H': 3600, '4H': 14400, '1D': 86400, '1W': 604800 };
const LOGGED = '@log', BOARD_CANDLES = 199, BASE = 'https://api.bitget.com', TRANSPORT = { owner: 'compare', priority: 8 };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const price = v => Number.isFinite(v) ? v.toLocaleString('en-US', { maximumSignificantDigits: 6 }) : '—';
const name = id => patternById(id)?.name || String(id || '型態');
const f = v => v.toFixed(1);

// Intraday candles are named by the time they closed (as the 型態 list), days and weeks by date.
export function candleLabel(candle, frame) {
  const step = SECONDS[frame] || STEP;
  if (step < 86400) return taipeiTime(candle.time + step);
  const d = new Date((candle.time + 8 * 3600) * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// The 4H candles the board had at record `at`: the newest 199 that had closed by then.
export function candlesAt(rows, at) {
  const byTime = new Map();
  for (const row of rows || []) {
    const time = Number(row?.[0]);
    if (Number.isFinite(time) && time < at * 1000) byTime.set(time, row);
  }
  const closed = [...byTime].sort((a, b) => a[0] - b[0]).slice(-BOARD_CANDLES).map(([, row]) => row);
  return parseCandles(closed, '4H', at * 1000).slice(-200);
}
const toRow = c => [c.time * 1000, c.open, c.high, c.low, c.close, c.volume, c.quoteVolume];

// Pattern points [time, price] → [candle index (fractional before the series), price].
export function indexPoints(pts, candles, step) {
  if (!candles.length) return [];
  const t0 = candles[0].time;
  return (pts || []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([t, y]) => [(t - t0) / step, y]).filter(([i]) => i <= candles.length - 1 + 1e-9);
}

// The chart: candles by index, the pattern zone and line in yellow, the candles after
// the breakout shaded in the colour of the latest close against the breakout close.
export function chartSVG({ candles, pts, breakIdx, frame, width = 360, height = 230, mark = '突破' }) {
  const W = Math.max(260, Math.round(width)), H = height, P = 6, end = candles.length - 1;
  const first = pts.length ? Math.floor(pts[0][0]) : breakIdx ?? end;
  let start = Math.max(0, Math.min(first, breakIdx ?? end) - 10);
  if (end - start > 130) start = end - 130;
  const line = [];
  pts.forEach(([i, y], j) => {
    if (i < start) return;
    const prev = pts[j - 1];
    if (!line.length && prev && prev[0] < start) line.push([start, prev[1] + (y - prev[1]) * (start - prev[0]) / (i - prev[0])]);
    line.push([i, y]);
  });
  const list = candles.slice(start), values = [...list.flatMap(c => [c.high, c.low]), ...line.map(p => p[1])];
  const hi = Math.max(...values), lo = Math.min(...values), bw = (W - 2 * P) / list.length, body = Math.max(1, bw * .62);
  const X = i => P + (i - start + .5) * bw, Y = v => P + 16 + (hi - v) / (hi - lo || hi * .01 || 1) * (H - 2 * P - 16);
  let s = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
  const zoneFrom = line.length ? Math.max(start, Math.round(line[0][0])) : null, zoneTo = breakIdx ?? (line.length ? Math.round(line.at(-1)[0]) : null);
  if (zoneFrom != null && zoneTo != null && zoneTo >= zoneFrom) s += `<rect class="zy" x="${f(X(zoneFrom) - bw / 2)}" y="0" width="${f(X(zoneTo) - X(zoneFrom) + bw)}" height="${H}"/>`;
  if (breakIdx != null && breakIdx < end) {
    const r = candles[end].close - candles[breakIdx].close;
    s += `<rect class="${r >= 0 ? 'zu' : 'zd'}" x="${f(X(breakIdx) + bw / 2)}" y="0" width="${f(X(end) - X(breakIdx))}" height="${H}"/>`;
  }
  for (let i = start; i <= end; i++) {
    const c = candles[i], cls = c.close >= c.open ? 'u' : 'd', top = Y(Math.max(c.open, c.close));
    s += `<line class="${cls}" x1="${f(X(i))}" x2="${f(X(i))}" y1="${f(Y(c.high))}" y2="${f(Y(c.low))}"/><rect class="${cls}" x="${f(X(i) - body / 2)}" y="${f(top)}" width="${f(body)}" height="${f(Math.max(.8, Y(Math.min(c.open, c.close)) - top))}"/>`;
  }
  if (line.length > 1) s += `<polyline class="ln" points="${line.map(([i, y]) => f(X(i)) + ',' + f(Y(y))).join(' ')}"/>`;
  if (breakIdx != null && candles[breakIdx]) {
    const x0 = X(breakIdx), left = x0 > W * .55;
    s += `<line class="mk" x1="${f(x0)}" x2="${f(x0)}" y1="0" y2="${H}"/><text x="${f(left ? x0 - 5 : x0 + 5)}" y="12" text-anchor="${left ? 'end' : 'start'}">${esc(candleLabel(candles[breakIdx], frame))} ${esc(mark)}</text>`;
  }
  return s + '</svg>';
}

// The coin's 24H 成交額 for the board's crypto grade: the radar's tickers or live quotes, else one ticker request.
function knownTurnover(symbol) {
  try { const v = Number((typeof state !== 'undefined' ? state.tickers : null)?.find?.(t => t.symbol === symbol)?.usdtVolume); if (v > 0) return v; } catch {}
  const quote = globalThis.OXCryptoQuotes?.get?.(symbol);
  return quote?.usdtVolume > 0 ? quote.usdtVolume : null;
}
async function turnoverOf(symbol, signal) {
  const known = knownTurnover(symbol);
  if (known) return known;
  try {
    const json = await globalThis.OXPublicFeed.json(`${BASE}/api/v2/mix/market/ticker?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES`, { signal, ...TRANSPORT, timeoutMs: 15000 });
    const v = Number(json?.data?.[0]?.usdtVolume);
    return v > 0 ? v : null;
  } catch (error) { if (signal.aborted) throw error; return null; }
}
const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));
function tierOf(match) { return Number.isInteger(match?.tier) ? match.tier : 3; }
// Named shapes before 走勢路徑, plain levels and trend lines last (as the board's default list).
const shapeRank = id => { const rule = patternById(id)?.rule || ''; return /^(level|trend)/.test(rule) ? 2 : rule === 'path' ? 1 : 0; };
// The board's classification and crypto grade for one series, best first.
function classify(symbol, frame, candles, turnover) {
  const matches = candles.length >= 35 ? classifyPrepared(prepareCandles(candles)) : {};
  const entry = { key: symbol + ':' + frame, data: { symbol, frame, source: 'Bitget', turnover, candles } };
  return Object.entries(matches).filter(([id]) => patternById(id))
    .map(([id, match]) => [id, rankPatternMatches([{ entry, match: { ...match, id } }])[0]?.match || match])
    .sort(([x, a], [y, b]) => tierOf(a) - tierOf(b) || shapeRank(x) - shapeRank(y) || (b.similarity ?? 0) - (a.similarity ?? 0));
}

function ensureStyle() {
  if (document.getElementById('ox-pattern-detail-style')) return;
  const style = document.createElement('style');
  style.id = 'ox-pattern-detail-style';
  style.textContent = `
dialog.ox-pd{--pd-bg:linear-gradient(160deg,#181c22,#0f1216);--pd-card:#ffffff0a;--pd-line:#ffffff1a;--pd-ink:#eceae3;--pd-muted:#9aa1a6;--pd-up:#00b8d4;--pd-down:#ff3078;--pd-hi:#e8ff2e;--pd-hi-zone:.08;
 width:min(560px,100%);max-width:100%;max-height:92dvh;margin:auto auto 0;padding:0;border:1px solid #ffffff33;border-bottom:0;border-radius:20px 20px 0 0;background:var(--pd-bg);color:var(--pd-ink);
 box-shadow:0 -12px 50px #0009,inset 0 1px #ffffff1f;overflow:auto;overscroll-behavior:contain;font:14px/1.45 system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif;font-variant-numeric:tabular-nums}
dialog.ox-pd::backdrop{background:#02050bb3;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
dialog.ox-pd[open]{animation:ox-pd-up .24s cubic-bezier(.2,.8,.2,1)}
body.theme-light dialog.ox-pd{--pd-bg:#fff;--pd-card:#f5f6f8;--pd-line:#dde1e6;--pd-ink:#30343b;--pd-muted:#636b77;--pd-up:#4598df;--pd-down:#e86480;--pd-hi:#a3b800;--pd-hi-zone:.13;border-color:#dde1e6;box-shadow:0 -10px 40px #30343b26}
body.theme-light dialog.ox-pd::backdrop{background:#47556940}
.ox-pd *{box-sizing:border-box}.ox-pd button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.ox-pd-body{padding:6px 16px calc(env(safe-area-inset-bottom) + 18px)}
.ox-pd-grip{width:38px;height:4px;margin:2px auto 6px;border-radius:2px;background:var(--pd-line)}
.ox-pd-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.ox-pd-top h2{margin:6px 0 0;font-size:21px;font-weight:750;line-height:1.2;letter-spacing:.01em}.ox-pd-top h2 small{margin-left:7px;color:var(--pd-muted);font-size:13px;font-weight:550}
.ox-pd-top p{margin:3px 0 0;color:var(--pd-muted);font-size:13px}
.ox-pd-actions{display:flex;align-items:center;gap:0;margin:-4px -10px 0 0}.ox-pd-actions button{margin:0}
dialog.ox-pd .ox-pd-share{display:grid;place-items:center;width:40px;height:44px;padding:0;border:0;border-radius:12px;background:none;box-shadow:none;color:var(--pd-muted)}
dialog.ox-pd .ox-pd-share svg{width:19px;height:19px}dialog.ox-pd .ox-pd-share:hover{color:var(--pd-ink)}
.ox-pd-share:focus-visible{outline:2px solid var(--pd-ink);outline-offset:-4px}
.ox-pd-seg{display:flex;margin:12px 0 8px;border-bottom:1px solid var(--pd-line)}
.ox-pd-seg button{flex:1;height:36px;margin:0 0 -1px;padding:0;border:0;border-bottom:2px solid transparent;border-radius:0;background:none;box-shadow:none;color:var(--pd-muted);font-size:13px;font-weight:650}
.ox-pd-seg button[aria-pressed="true"]{color:var(--pd-ink);border-bottom-color:var(--pd-ink)}
.ox-pd-kinds{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -16px;padding:2px 16px 8px}.ox-pd-kinds::-webkit-scrollbar{display:none}
.ox-pd-kinds button{flex:none;min-height:32px;margin:0;padding:0 11px;border:1px solid var(--pd-line);border-radius:8px;background:none;box-shadow:none;font-size:12.5px;white-space:nowrap}
.ox-pd-kinds button[aria-pressed="true"]{border-color:var(--pd-ink);font-weight:700}
.ox-pd-kinds small{margin-left:5px;color:var(--pd-muted);font-size:11px;font-weight:500}
.ox-pd-chart{position:relative;height:230px;margin:2px -4px 0}.ox-pd-chart svg{display:block;width:100%;height:100%}
.ox-pd-chart .u{fill:var(--pd-up);stroke:var(--pd-up)}.ox-pd-chart .d{fill:var(--pd-down);stroke:var(--pd-down)}.ox-pd-chart line.u,.ox-pd-chart line.d{stroke-width:1}
.ox-pd-chart .zy{fill:var(--pd-hi);opacity:var(--pd-hi-zone)}.ox-pd-chart .zu{fill:var(--pd-up);opacity:.13}.ox-pd-chart .zd{fill:var(--pd-down);opacity:.13}
.ox-pd-chart .ln{fill:none;stroke:var(--pd-hi);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.ox-pd-chart .mk{stroke:var(--pd-muted);stroke-width:1;stroke-dasharray:4 3}
.ox-pd-chart text{fill:var(--pd-muted);font:700 11px system-ui,-apple-system,"PingFang TC",sans-serif}
.ox-pd-legend{display:flex;gap:14px;margin:6px 0 2px;color:var(--pd-muted);font-size:12px}.ox-pd-legend i{display:inline-block;width:10px;height:10px;margin-right:5px;border-radius:2px;vertical-align:-1px}
.ox-pd-empty{display:grid;place-items:center;height:230px;color:var(--pd-muted);font-size:13px;text-align:center}
.ox-pd-facts{display:grid;grid-template-columns:1fr 1fr;margin:12px 0 0;border-top:1px solid var(--pd-line)}
.ox-pd-facts div{min-width:0;padding:9px 0;border-bottom:1px solid var(--pd-line)}.ox-pd-facts div:nth-child(odd){padding-right:10px}.ox-pd-facts div:nth-child(even){padding-left:12px;border-left:1px solid var(--pd-line)}
.ox-pd-facts div>span{display:block;color:var(--pd-muted);font-size:12px}.ox-pd-facts b{font-size:16px;font-weight:700;overflow-wrap:anywhere}.ox-pd-facts b small{margin-left:6px;color:var(--pd-muted);font-size:11px;font-weight:500}
.ox-pd .up{color:var(--pd-up)}.ox-pd .down{color:var(--pd-down)}.ox-pd .mu{color:var(--pd-muted);font-weight:500}
.ox-pd-reasons{margin:12px 0 0;padding:0;list-style:none}.ox-pd-reasons li{position:relative;padding:4px 0 4px 14px;font-size:13px;line-height:1.5}.ox-pd-reasons li::before{content:"";position:absolute;left:2px;top:12px;width:5px;height:5px;border-radius:50%;background:var(--pd-muted)}
.ox-pd-note{margin:10px 0 0;color:var(--pd-muted);font-size:11.5px;line-height:1.6}
dialog.ox-pd .ox-pd-open{display:block;width:100%;min-height:46px;margin:16px 0 0;border:0;border-radius:12px;background:#e9dcc0;box-shadow:none;color:#1b1a17!important;font-size:15px;font-weight:750}
body.theme-light dialog.ox-pd .ox-pd-open{background:#30343b;color:#fff!important}
.ox-pd-open:focus-visible,.ox-pd-seg button:focus-visible,.ox-pd-kinds button:focus-visible{outline:2px solid var(--pd-ink);outline-offset:2px}
@media(min-width:721px){dialog.ox-pd{margin:auto;max-height:88dvh;border-bottom:1px solid #ffffff33;border-radius:20px}body.theme-light dialog.ox-pd{border-bottom-color:#dde1e6}.ox-pd-body{padding-bottom:20px}}
@keyframes ox-pd-up{from{transform:translateY(36px);opacity:.4}}
@media(prefers-reduced-motion:reduce){dialog.ox-pd[open]{animation:none}}`;
  document.head.append(style);
}

// point: a record of compareModel (at, time); pick: one of its picks (s, coin, p, name, t, st, pts, c, base, results).
export function openPatternDetail({ point, pick, onOpenChart }) {
  ensureStyle();
  const abort = new AbortController(), signal = abort.signal;
  const view = { frame: '4H', pattern: LOGGED, series: new Map(), logged: { state: 'loading', match: null } };
  const dialog = document.createElement('dialog');
  dialog.className = 'ox-pd';
  dialog.setAttribute('aria-label', `${pick.coin} 型態詳情`);
  dialog.innerHTML = '<div class="ox-pd-body"></div>';
  const body = dialog.firstElementChild;
  let turnover = null, turnoverJob = null, closed = false;
  const close = () => { if (closed) return; closed = true; abort.abort(); if (dialog.open) dialog.close(); dialog.remove(); };
  dialog.addEventListener('close', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();

  const grade = () => turnoverJob ??= turnoverOf(pick.s, signal).then(v => (turnover = v));
  // One series per timeframe, classified on the current candles.
  function load(frame) {
    if (view.series.has(frame)) return view.series.get(frame).job;
    const entry = { state: 'loading', candles: [], matches: [], error: '' };
    entry.job = (async () => {
      try {
        const [series] = await Promise.all([fetchSeries(pick.s, frame, signal, Date.now(), TRANSPORT), grade()]);
        await yieldFrame();
        if (signal.aborted) return;
        entry.candles = series.candles; entry.matches = classify(pick.s, frame, series.candles, turnover); entry.state = 'ready';
      } catch (error) {
        if (signal.aborted) return;
        entry.state = 'error'; entry.error = error?.message || `${frame} K 線未取得`;
      }
      render();
    })();
    view.series.set(frame, entry);
    return entry.job;
  }
  // The recorded breakout as the board saw it: the 4H candles that had closed at the record.
  async function loadLogged() {
    await load('4H');
    const four = view.series.get('4H');
    if (signal.aborted || four.state !== 'ready') { view.logged.state = 'error'; render(); return; }
    let candles = four.candles.filter(c => c.time < point.at && !c.provisional);
    if (candles.length < BOARD_CANDLES) {
      try {
        const json = await globalThis.OXPublicFeed.json(`${BASE}/api/v2/mix/market/history-candles?symbol=${encodeURIComponent(pick.s)}&productType=USDT-FUTURES&granularity=4H&limit=200&endTime=${point.at * 1000}`, { signal, ...TRANSPORT, timeoutMs: 20000 });
        if (json?.code === '00000' && Array.isArray(json.data)) {
          const merged = candlesAt([...json.data, ...candles.map(toRow)], point.at);
          if (merged.length >= candles.length) candles = merged;
        }
      } catch (error) { if (signal.aborted) return; }
    }
    await yieldFrame();
    if (signal.aborted) return;
    const at = candles.length && candles.at(-1).time === point.at - STEP ? classify(pick.s, '4H', candles.slice(-BOARD_CANDLES), turnover) : [];
    view.logged = { state: 'ready', match: at.find(([id]) => id === pick.p)?.[1] || null };
    render();
  }

  function facts(rows) {
    return `<div class="ox-pd-facts">${rows.filter(([, v]) => v !== '—').map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
  }
  function render() {
    if (closed) return;
    const data = view.series.get(view.frame), candles = data?.candles || [];
    // On 4H the recorded pattern is its own chip; the current 4H list leaves it out.
    const matches = (data?.matches || []).filter(([id]) => !(view.frame === '4H' && id === pick.p));
    const isLog = view.frame === '4H' && view.pattern === LOGGED;
    if (!isLog && !matches.some(([id]) => id === view.pattern)) view.pattern = (matches.find(([id]) => id === pick.p) || matches[0])?.[0] || null;
    const current = !isLog ? matches.find(([id]) => id === view.pattern)?.[1] || null : null;
    const match = isLog ? view.logged.match : current, cs = match?.classicSignal;
    const step = SECONDS[view.frame];
    // Pattern points and the breakout candle.
    let pts = [], breakIdx = null;
    if (isLog) {
      pts = indexPoints(pick.pts, candles, step);
      const i = candles.findIndex(c => c.time === point.at - STEP);
      breakIdx = i >= 0 ? i : null;
    } else if (current) {
      pts = (current.points || []).filter(q => candles[q.x] && Number.isFinite(q.y)).map(q => [q.x, q.y]);
      const broken = cs?.pressure?.brokenAt;
      if (Number.isFinite(broken)) for (let i = 0; i < candles.length; i++) if (candles[i].time <= broken) breakIdx = i;
      if (breakIdx == null && /突破|跌破/.test(current.stage || '') && pts.length) breakIdx = Math.round(pts.at(-1)[0]);
    }
    const last = candles.at(-1);
    const level = isLog ? cs?.pressure?.level ?? pick.pts.at(-1)?.[1] : cs?.pressure?.level, down = !isLog && match?.side === 'SHORT';
    // The record's tier was graded with that moment's 24H 成交額, which is not kept; its
    // quality is the shape's own score, before today's turnover cap.
    const score = isLog ? cs?.money?.rawScore ?? cs?.qualityScore : cs?.qualityScore;
    const gap = Number.isFinite(level) && level > 0 && last ? (last.close / level - 1) * 100 : null;
    const rows = [
      [down ? '跌破價' : '突破價', price(level)],
      ['失效價', price(cs?.invalidation?.level)],
      ['最新收盤', last ? price(last.close) : '—'],
      [down ? '距跌破價' : '距突破價', gap == null ? '—' : `<span class="${tone(gap)}">${pct(gap)}</span>`],
      ...(isLog ? [['突破那根收盤', price(pick.base)], ...pick.results.map(r => [`之後 ${r.label}`,
        r.state === 'done' ? `<span class="${tone(r.ret)}">${pct(r.ret)}</span>${r.btc == null ? '' : `<small>BTC ${pct(r.btc)}</small>`}` : `<span class="mu">${r.state === 'wait' ? '還沒到' : '沒有資料'}</span>`])] : []),
      ['等級', isLog ? (pick.t ? `T${pick.t}` : '—') : current ? `T${tierOf(current)}` : '—'],
      ['型態品質', Number.isFinite(score) ? String(score) : '—']
    ];
    // The system's reasons; for a shape that did not qualify, why it did not.
    const reasons = [...new Set([...(cs?.reasons || []), ...(!isLog && !cs?.eligible ? cs?.rejectionReasons || [] : []), ...(!isLog && cs?.money?.reason ? [cs.money.reason] : [])])];
    const stage = isLog ? pick.st || '已收 K 確認突破' : current?.stage || (data?.state === 'ready' ? '這個週期沒有找到型態' : '');
    const title = isLog ? pick.name : current ? name(view.pattern) : '';
    const chips = `${view.frame === '4H' ? `<button type="button" data-pd-pattern="${LOGGED}" aria-pressed="${isLog}">${esc(pick.name)}<small>${esc(point.time)} 突破</small></button>` : ''}${matches.map(([id, m]) => `<button type="button" data-pd-pattern="${esc(id)}" aria-pressed="${!isLog && id === view.pattern}">${esc(name(id))}<small>T${tierOf(m)}</small></button>`).join('')}`;
    // What 分享 draws: this frame's chart and numbers, as on screen.
    view.shown = { candles, pts, breakIdx, isLog, match, current, level, last, down, gap, title, stage, ready: data?.state === 'ready' && candles.length > 0 };
    const width = Math.max(260, (body.clientWidth || 360) - 24);
    const chart = data?.state === 'ready' && candles.length
      ? `<div class="ox-pd-chart">${chartSVG({ candles, pts, breakIdx, frame: view.frame, width, mark: down ? '跌破' : '突破' })}</div>
        <div class="ox-pd-legend">${pts.length ? `<span><i style="background:var(--pd-hi)"></i>${breakIdx != null ? (down ? '跌破前型態' : '突破前型態') : '型態'}</span>` : ''}${breakIdx != null ? `<span><i style="background:${last && candles[breakIdx] && last.close < candles[breakIdx].close ? 'var(--pd-down)' : 'var(--pd-up)'}"></i>${down ? '跌破後' : '突破後'}</span>` : ''}</div>`
      : `<div class="ox-pd-empty" role="status">${data?.state === 'error' ? esc(data.error) : window.OXLoading?.markup?.(`載入 ${view.frame} K 線`) || `載入 ${view.frame} K 線…`}</div>`;
    body.innerHTML = `<div class="ox-pd-grip" aria-hidden="true"></div>
      <div class="ox-pd-top"><div><h2>${esc(pick.coin)}<small>${esc(pick.s)}</small></h2><p>${esc([title, stage].filter(Boolean).join('・'))}</p></div>
        <div class="ox-pd-actions"><button type="button" class="ox-pd-share" data-pd-share data-track="share.detail" data-track-detail="${esc(pick.s)}" aria-label="把這張圖做成圖片分享"${data?.state === 'ready' && candles.length ? '' : ' disabled'}>${PICTURE_ICON}</button><button type="button" data-pd-close aria-label="關閉"></button></div></div>
      <div class="ox-pd-seg" role="group" aria-label="時間級別">${FRAMES.map(([id, label]) => `<button type="button" data-pd-frame="${id}" aria-pressed="${id === view.frame}">${label}</button>`).join('')}</div>
      ${chips ? `<div class="ox-pd-kinds" role="group" aria-label="型態">${chips}</div>` : ''}
      ${chart}
      ${data?.state === 'ready' ? facts(rows) : ''}
      ${reasons.length && data?.state === 'ready' ? `<ul class="ox-pd-reasons">${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      ${isLog && view.logged.state === 'loading' && data?.state === 'ready' ? '<p class="ox-pd-note">正在讀取那根 K 收盤時的型態條件…</p>' : ''}
      ${isLog ? '<p class="ox-pd-note">之後的漲跌：突破那根收盤 → 之後第 1／6／18 根 4 小時 K 收盤，未含手續費、資金費率與滑價。只是紀錄，不是投資建議。</p>' : ''}
      <button type="button" class="ox-pd-open" data-pd-open>看個股完整 K 線</button>`;
  }

  dialog.addEventListener('click', event => {
    if (event.target === dialog) { close(); return; }
    const button = event.target.closest('button');
    if (!button || !dialog.contains(button)) return;
    if ('pdClose' in button.dataset) { close(); return; }
    if ('pdShare' in button.dataset) { share(); return; }
    if ('pdOpen' in button.dataset) { const frame = view.frame; close(); onOpenChart?.(pick.s, frame); return; }
    if (button.dataset.pdPattern) { view.pattern = button.dataset.pdPattern; render(); return; }
    if (button.dataset.pdFrame && button.dataset.pdFrame !== view.frame) {
      view.frame = button.dataset.pdFrame;
      view.pattern = view.frame === '4H' ? LOGGED : pick.p;
      globalThis.OXTrack?.('pattern.frame', view.frame);
      render(); load(view.frame);
    }
  });
  // 分享圖片 of what the sheet shows; the preview opens above the sheet.
  function share() {
    const s = view.shown; if (!s?.ready) return;
    const frameName = FRAMES.find(([id]) => id === view.frame)?.[1] || view.frame, tier = s.isLog ? pick.t : s.current ? tierOf(s.current) : null;
    const last = s.isLog ? pick.last : null, color = v => v > 0 ? SHARE_UP : v < 0 ? SHARE_DOWN : null;
    return shareCoin({ name: pick.coin, symbol: 'USDT 永續', chips: [[s.title, 'gold'], [tier ? 'T' + tier : '', 'tier'], [frameName + ' K', 'plain']],
      candles: s.candles, points: s.pts, breakIdx: s.breakIdx, label: s.breakIdx != null && s.candles[s.breakIdx] ? candleLabel(s.candles[s.breakIdx], view.frame) + (s.down ? ' 跌破' : ' 突破') : '',
      big: last ? { label: `突破後 ${last.label}`, value: pct(last.ret), color: color(last.ret) || '#eef1f4' } : null,
      facts: [[s.down ? '跌破價' : '突破價', sharePrice(s.level)], ['最新收盤', sharePrice(s.last?.close)], ...(s.gap == null ? [] : [[s.down ? '距跌破價' : '距突破價', pct(s.gap), color(s.gap)]])],
      dateLabel: s.isLog ? point.time + ' 突破' : frameName + ' K・' + candleLabel(s.candles.at(-1), view.frame), note: s.isLog ? PERFORMANCE_NOTE : undefined, kind: 'detail' });
  }
  render();
  loadLogged();
  globalThis.OXTrack?.('pattern.detail', pick.s);
  return { close };
}
