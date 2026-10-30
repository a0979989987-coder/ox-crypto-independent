// 型態 dock page (it was 對比), three small text tabs like the Taiwan site:
//   每 4 小時突破 — one recorded 4H close at a time (‹ › step through them): the coins the
//                   pattern board listed as confirmed upward breakouts, a mini 4H chart of
//                   each and how it moved 4 小時／1 天／3 天 later against BTC, by tier and pattern
//   長期勝率      — every record added up by tier and by pattern
//   過去紀錄      — one line per recorded close; a line opens it on 每 4 小時突破
// A card opens 型態詳情 (./detail.js). Mounted by src/markets/crypto/radar-compare.js;
// styles live in src/styles/components/crypto-shell.css (.ox-cmp).
import { withDeadline } from '../../../components/resource-deadline.js';
import { STEP, compareModel, defaultOpen, isLog, miniChart, closesChart, parseRows, pct, tone, nextCloseText, longRunStats, periodLabel, taipeiTime, patternName, LONG_RUN_MIN } from './model.js?v=20261030-board2';
import { createTextTabs } from '../../../app/text-tabs.js';
import { openPatternDetail, indexPoints } from './detail.js?v=20261031-share1';
import { shareCoin, sharePrice, SHARE_UP, SHARE_DOWN, PERFORMANCE_NOTE, longPress, PICTURE_ICON } from '../share-image.js?v=20261031-share1';

const LOG_URL = new URL('../../../../data/crypto-breakouts.json', import.meta.url).href;
const FRESH_MS = 3 * 60000, LOADS = 3;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const boundary = (ms = Date.now()) => Math.floor(ms / 1000 / STEP) * STEP;

// ---------- the log: same origin, revalidated on every load, kept a few minutes ----------
let job = null, jobAt = 0;
export function loadLog(force = false) {
  // A record lands a few minutes after each 4H close; a copy from before that close is stale.
  if (!force && job && Date.now() - jobAt < FRESH_MS && boundary(jobAt) === boundary()) return job;
  jobAt = Date.now();
  job = withDeadline(async signal => {
    const response = await fetch(LOG_URL, { cache: 'no-cache', credentials: 'same-origin', signal });
    // Not recorded yet: a static host answers 404, the Site's data release 503 SNAPSHOT_UNAVAILABLE.
    if (response.status === 404) return null;
    if (response.status === 503) {
      const body = await response.json().catch(() => null);
      if (body?.error?.code === 'SNAPSHOT_UNAVAILABLE') return null;
    }
    if (!response.ok) throw Error(`型態紀錄 HTTP ${response.status}`);
    const log = await response.json();
    if (!isLog(log)) throw Error('型態紀錄格式不符');
    return log;
  }, 12000, '型態紀錄載入逾時').catch(error => { job = null; throw error; });
  return job;
}

// ---------- 4H candles for the mini charts: the shared public feed, a few at a time ----------
const series = new Map();
function candlesFor(symbol, signal) {
  const now = boundary(), hit = series.get(symbol);
  if (hit && hit.boundary === now) return hit.promise;
  let promise;
  // The radar's own 4H observation of this coin, when it is current.
  const shared = globalThis.BitgetAPI?.peekCandles?.(symbol, '4H');
  const reused = shared?.candles?.length ? parseRows(shared.candles.map(c => [c.time * 1000, c.open, c.high, c.low, c.close]), shared.serverTime) : [];
  if (reused.length >= 35 && reused.at(-1).time + STEP === now) promise = Promise.resolve(reused);
  else {
    const url = `https://api.bitget.com/api/v2/mix/market/candles?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&granularity=4H&limit=200`;
    promise = globalThis.OXPublicFeed.json(url, { signal, owner: 'compare', priority: 6, timeoutMs: 20000 }).then(json => {
      if (json?.code !== '00000' || !Array.isArray(json.data)) throw Error('Bitget K 線格式不符');
      const candles = parseRows(json.data, Number(json.requestTime) || Date.now());
      if (!candles.length) throw Error('Bitget K 線不足');
      return candles;
    });
  }
  series.set(symbol, { boundary: now, promise });
  promise.catch(() => { if (series.get(symbol)?.promise === promise) series.delete(symbol); });
  if (series.size > 240) series.delete(series.keys().next().value);
  return promise;
}

const TABS = [['point', '每 4 小時突破'], ['stats', '長期勝率'], ['history', '過去紀錄']], HISTORY_ROWS = 30;
const average = list => list.length ? list.reduce((s, v) => s + v, 0) / list.length : null;

export function mountCompare(host, { onOpen } = {}) {
  const page = document.createElement('div'), root = document.createElement('div');
  page.className = 'ox-cmp-page'; root.className = 'ox-cmp';
  // at: the 4H close on 每 4 小時突破; k: its period (1 = 4 小時, 6 = 1 天, 18 = 3 天);
  // tier, kind: its filters; statK: 長期勝率's period.
  const view = { tab: 'point', log: null, model: null, error: null, loaded: false, at: null, picked: false, k: 6, tier: 'all', kind: 'all', statK: 6, allHistory: false, detail: null };
  const tabs = createTextTabs({ tabs: TABS, selected: view.tab, label: '型態分類', attribute: 'data-cmp-tab', sticky: true, onSelect(id) { view.tab = id; globalThis.OXTrack?.('compare.tab', id); render(); if (scrollY > 0) scrollTo({ top: 0 }); } });
  page.append(tabs.element, root);
  host.replaceChildren(page);
  requestAnimationFrame(() => tabs.position());
  const charts = new Map(); // `${symbol}@${at}` → svg, kept across renders
  let destroyed = false, suspended = false, abort = new AbortController(), observer = null;
  const queue = [], queued = new Set();
  let active = 0;

  const pointOf = at => view.model?.points.find(p => p.at === at);
  const pickOf = (at, symbol) => pointOf(at)?.picks.find(p => p.s === symbol);
  const resultOf = (pick, k) => pick.results.find(r => r.k === k);
  const reached = (point, k) => !!point.spans.find(s => s.k === k)?.reached;
  // The period shown for a close: the longest reached one up to the chosen period.
  const periodOf = point => [...view.model.periods].reverse().find(k => k <= view.k && reached(point, k)) || view.model.periods.find(k => reached(point, k)) || 0;
  // Opens on the newest close with results, like the Taiwan site's 每日突破; a newer close
  // still waiting for its first result is one tap away.
  const defaultPoint = model => model.points.find(p => p.count && reached(p, model.periods[0]))?.at ?? defaultOpen(model) ?? model.points[0]?.at ?? null;

  function resultCells(pick) {
    return pick.results.map(r => {
      const value = r.state === 'done' ? `<b class="${tone(r.ret)}">${pct(r.ret)}</b>` : `<b class="mu">${r.state === 'wait' ? '還沒到' : '—'}</b>`;
      const btc = r.state === 'wait' ? '' : r.btc == null ? 'BTC —' : `BTC ${pct(r.btc)}`;
      return `<span class="ox-cmp-k">${r.label}</span>${value}<span class="ox-cmp-btc">${btc}</span>`;
    }).join('');
  }
  function pickHTML(point, pick) {
    const key = `${pick.s}@${point.at}`, svg = charts.get(key);
    return `<button type="button" class="ox-cmp-pick" data-cmp-symbol="${esc(pick.s)}" data-cmp-at="${point.at}" data-track="compare.pick" data-track-detail="${esc(pick.s)}" aria-label="${esc(pick.coin)} ${esc(pick.name)}，看型態詳情" aria-haspopup="dialog">
      <span class="ox-cmp-mini"${svg ? '' : ' data-pending'} data-key="${esc(key)}">${svg || ''}</span>
      <span class="ox-cmp-main">
        <span class="ox-cmp-name"><b>${esc(pick.coin)}</b>${pick.t ? `<span class="ox-cmp-tier" data-tier="${pick.t}">T${pick.t}</span>` : ''}<span class="ox-cmp-pic" role="button" data-cmp-share data-track="share.compare" data-track-detail="${esc(pick.s)}" aria-label="把 ${esc(pick.coin)} 做成圖片分享">${PICTURE_ICON}</span><span class="ox-cmp-go" aria-hidden="true">›</span></span>
        <span class="ox-cmp-pattern">${esc(pick.name)}</span>
        <span class="ox-cmp-rets">${resultCells(pick)}</span>
      </span>
    </button>`;
  }
  function footHTML(model) {
    const lines = model.method.split(/[；;]/).map(s => s.trim()).filter(Boolean);
    return `<footer class="ox-cmp-foot">${lines.length ? `<p>計算：${lines.map(esc).join('。')}。</p>` : ''}<p>${model.updated ? `紀錄更新 ${model.updated}（台北時間）・` : ''}只是紀錄，不是投資建議。</p></footer>`;
  }
  function stateHTML(kind) {
    if (kind === 'loading') return `<div class="ox-cmp-state" role="status">${window.OXLoading?.markup?.('型態紀錄載入中') || '型態紀錄載入中…'}</div>`;
    if (kind === 'error') return `<div class="ox-cmp-state" role="status"><b>型態紀錄暫時無法載入</b><p>請確認網路後再試一次。</p><button type="button" class="ox-cmp-retry" data-cmp-retry>重試</button></div>`;
    return `<div class="ox-cmp-state" role="status"><b>已開始記錄</b><p>第一筆會在下一根 4 小時 K 收盤後出現。</p><p>收盤時間（台北）<span class="ox-cmp-nowrap">08／12／16／20／00／04 點</span><br>下一次：${nextCloseText(Date.now())}</p><button type="button" class="ox-cmp-retry is-quiet" data-cmp-retry>重新整理</button></div>`;
  }

  // 每 4 小時突破: one close, stepped with ‹ ›, a period, tier and pattern filter, the coins.
  function pointPageHTML() {
    const points = view.model.points;
    if (!pointOf(view.at)) view.at = defaultPoint(view.model);
    const point = pointOf(view.at), index = points.indexOf(point), k = periodOf(point), span = point.spans.find(s => s.k === k);
    const tiers = [1, 2, 3].map(t => {
      const list = point.picks.filter(p => p.t === t), values = k ? list.map(p => resultOf(p, k)).filter(r => r?.state === 'done').map(r => r.ret) : [];
      return { t, n: list.length, avg: average(values) };
    }).filter(x => x.n);
    if (view.tier !== 'all' && !tiers.some(x => String(x.t) === view.tier)) view.tier = 'all';
    const kinds = [...point.picks.reduce((m, p) => m.set(p.p, (m.get(p.p) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
    if (view.kind !== 'all' && !kinds.some(([id]) => id === view.kind)) view.kind = 'all';
    const picks = point.picks.filter(p => (view.tier === 'all' || String(p.t) === view.tier) && (view.kind === 'all' || p.p === view.kind));
    if (k) picks.sort((a, b) => (resultOf(b, k)?.ret ?? -Infinity) - (resultOf(a, k)?.ret ?? -Infinity));
    const nav = `<div class="ox-cmp-nav">
        <button type="button" data-cmp-step="1" aria-label="前一根 4 小時 K" ${index < points.length - 1 ? '' : 'disabled'}>‹</button>
        <div class="ox-cmp-title">${k ? `${point.time} 突破 <span class="mu">→</span> ${taipeiTime(span.at)} 收盤` : `${point.time} 突破`}
          <small>${!point.count ? '這根 4 小時 K 收盤時沒有突破' : k ? `畫板這根 4 小時 K 收盤時列出的向上確認突破・${point.count} 個` : `下一根 4 小時 K 收盤後更新・${point.count} 個`}</small></div>
        <button type="button" data-cmp-step="-1" aria-label="下一根 4 小時 K" ${index > 0 ? '' : 'disabled'}>›</button>
      </div>`;
    const latest = points.find(p => p.count), first = view.model.periods[0];
    const pending = latest && latest !== point && !reached(latest, first) ? `<button type="button" class="ox-cmp-pending" data-cmp-goto="${latest.at}">${latest.time} 突破 ${latest.count} 個・${periodLabel(first, view.model.step)}後收盤更新 ›</button>` : '';
    if (!point.count) return nav + pending + `<div class="ox-cmp-state is-quiet" role="status"><p>這一次沒有幣種確認突破，按 ‹ 看前一根。</p></div>`;
    return nav + pending + `<div class="ox-cmp-seg" role="group" aria-label="之後多久">${view.model.periods.map(p => {
        const ok = reached(point, p);
        return `<button type="button" data-cmp-k="${p}" aria-pressed="${p === k}" ${ok ? '' : 'disabled'}>${periodLabel(p, view.model.step)}${ok ? '' : '（未滿）'}</button>`;
      }).join('')}</div>
      <div class="ox-cmp-chips" role="group" aria-label="等級">
        <button type="button" data-cmp-tier="all" aria-pressed="${view.tier === 'all'}">全部 ${point.count}</button>
        ${tiers.map(x => `<button type="button" data-cmp-tier="${x.t}" aria-pressed="${view.tier === String(x.t)}"><span>T${x.t} ${x.n} 個</span>${x.avg == null ? '' : `<b class="${tone(x.avg)}">${pct(x.avg)}</b>`}</button>`).join('')}
      </div>
      ${kinds.length > 1 ? `<div class="ox-cmp-kinds" role="group" aria-label="型態"><button type="button" data-cmp-kind="all" aria-pressed="${view.kind === 'all'}">全部型態</button>${kinds.map(([id, n]) => `<button type="button" data-cmp-kind="${esc(id)}" aria-pressed="${view.kind === id}" data-track="compare.kind" data-track-detail="${esc(id)}">${esc(patternName(id))}<small>${n}</small></button>`).join('')}</div>` : ''}
      <div class="ox-cmp-picks">${picks.map(p => pickHTML(point, p)).join('')}</div>`;
  }
  // 長期勝率: every record added up by tier and by pattern.
  function statsHTML() {
    const { periods, step } = view.model, stats = longRunStats(view.log, view.statK);
    if (!stats && !periods.some(k => longRunStats(view.log, k))) return '';
    const label = periodLabel(view.statK, step);
    const row = (title, o) => `<tr><th scope="row">${title}</th><td>${o.n}</td><td>${Math.round(o.win)}%</td><td class="${tone(o.avg)}">${pct(o.avg)}</td><td class="${o.btc == null ? 'mu' : tone(o.btc)}">${o.btc == null ? '—' : pct(o.btc)}</td></tr>`;
    const head = first => `<thead><tr><th scope="col">${first}</th><th scope="col">次數</th><th scope="col">勝率</th><th scope="col">平均</th><th scope="col">BTC</th></tr></thead>`;
    return `<section class="ox-cmp-hist" aria-label="長期勝率">
      ${stats ? `<p class="ox-cmp-lead">${taipeiTime(stats.from).split(' ')[0]} 起・${stats.records} 次 4 小時收盤・勝率＝之後收盤比突破那根收盤高的比例</p>` : ''}
      <div class="ox-cmp-seg" role="group" aria-label="之後多久">${periods.map(k => `<button type="button" data-cmp-stat="${k}" aria-pressed="${k === view.statK}">${periodLabel(k, step)}</button>`).join('')}</div>
      ${stats ? `<table class="ox-cmp-table">${head('等級')}<tbody>${stats.tiers.map(t => row('T' + t.id, t)).join('')}</tbody></table>
      ${stats.patterns.length ? `<table class="ox-cmp-table">${head('型態')}<tbody>${stats.patterns.map(o => row(esc(o.name), o)).join('')}</tbody></table>` : ''}` : `<p class="ox-cmp-note">${label}後的收盤還沒到，到了會自動加進來。</p>`}
      <p class="ox-cmp-note">BTC＝同一段時間 BTC 的漲跌。${stats?.few ? `${stats.patterns.length ? '另有' : '目前'} ${stats.few} 種型態不到 ${LONG_RUN_MIN} 次，先不列；每次收盤後會累積。` : ''}</p>
    </section>`;
  }
  // 過去紀錄: one line per recorded close with picks, newest first.
  function historyHTML() {
    const rows = (Array.isArray(view.log?.history) ? view.log.history : []).filter(h => h && Number.isFinite(h.at) && h.n > 0);
    if (!rows.length) return '';
    const [k1, k2] = view.model.periods, step = view.model.step, stat = (h, k) => h['k' + k] && typeof h['k' + k] === 'object' ? h['k' + k] : null;
    const done = rows.filter(h => stat(h, k1)), vs = (list, k) => average(list.filter(h => stat(h, k)?.btc != null).map(h => stat(h, k).avg - stat(h, k).btc));
    const tiles = [[periodLabel(k1, step) + '平均', average(done.map(h => stat(h, k1).avg))], [periodLabel(k1, step) + '比 BTC', vs(done, k1)], [periodLabel(k2, step) + '比 BTC', vs(rows, k2)]];
    const cell = v => v == null ? '<td class="mu">—</td>' : `<td class="${tone(v)}">${pct(v)}</td>`;
    const list = [...rows].reverse(), shown = view.allHistory ? list : list.slice(0, HISTORY_ROWS);
    return `<section class="ox-cmp-hist" aria-label="過去紀錄">
      <p class="ox-cmp-lead">${taipeiTime(rows[0].at).split(' ')[0]} 起 ${rows.length} 次有突破的 4 小時收盤・點一行看那次的幣種</p>
      <div class="ox-cmp-tiles">${tiles.map(([label, v]) => `<div><span>${label}</span><b class="${v == null ? 'mu' : tone(v)}">${v == null ? '—' : pct(v)}</b></div>`).join('')}</div>
      <table class="ox-cmp-table ox-cmp-days"><thead><tr><th scope="col">收盤</th><th scope="col">個數</th><th scope="col">${periodLabel(k1, step)}</th><th scope="col">勝率</th><th scope="col">BTC</th><th scope="col">${periodLabel(k2, step)}</th><th scope="col">BTC</th></tr></thead><tbody>
      ${shown.map(h => `<tr ${pointOf(h.at) ? `data-cmp-at="${h.at}" tabindex="0"` : ''} aria-current="${h.at === view.at}"><td>${taipeiTime(h.at)}</td><td>${h.n}</td>${cell(stat(h, k1)?.avg)}<td${stat(h, k1) ? '' : ' class="mu"'}>${stat(h, k1) ? stat(h, k1).win + '%' : '—'}</td>${cell(stat(h, k1)?.btc)}${cell(stat(h, k2)?.avg)}${cell(stat(h, k2)?.btc)}</tr>`).join('')}
      </tbody></table>
      ${list.length > shown.length ? `<button type="button" class="ox-cmp-more" data-cmp-more>顯示全部 ${list.length} 次</button>` : ''}
    </section>`;
  }
  function render() {
    if (destroyed) return;
    if (!view.loaded) root.innerHTML = view.error ? stateHTML('error') : stateHTML('loading');
    else if (!view.model || view.model.empty) root.innerHTML = stateHTML('empty');
    else {
      const html = view.tab === 'stats' ? statsHTML() : view.tab === 'history' ? historyHTML() : pointPageHTML();
      root.innerHTML = (html || '<div class="ox-cmp-state is-quiet" role="status"><p>次數還不夠，每根 4 小時 K 收盤後會累積。</p></div>') + footHTML(view.model);
    }
    watchMinis();
  }

  // ---------- mini charts near the viewport ----------
  function draw(box, svg) { box.innerHTML = svg; box.removeAttribute('data-pending'); charts.set(box.dataset.key, svg); }
  function paint(symbol, candles) {
    root.querySelectorAll(`.ox-cmp-mini[data-pending][data-key^="${CSS.escape(symbol)}@"]`).forEach(box => {
      const at = Number(box.dataset.key.split('@')[1]), pick = pickOf(at, symbol);
      if (!pick) return;
      const svg = (candles && miniChart(pick, at, candles)) || closesChart(pick, at);
      if (svg) draw(box, svg); else { box.removeAttribute('data-pending'); box.classList.add('is-blank'); }
    });
  }
  function pump() {
    while (active < LOADS && queue.length && !suspended && !destroyed) {
      const symbol = queue.shift(), signal = abort.signal;
      active++;
      candlesFor(symbol, signal).then(candles => { if (!signal.aborted) paint(symbol, candles); },
        error => { if (!signal.aborted && error?.name !== 'AbortError') paint(symbol, null); })
        .finally(() => { active--; queued.delete(symbol); pump(); });
    }
  }
  function want(box) {
    const symbol = box.dataset.key.split('@')[0];
    if (queued.has(symbol)) return;
    queued.add(symbol); queue.push(symbol); pump();
  }
  function watchMinis() {
    observer?.disconnect();
    if (suspended || destroyed) return;
    const boxes = root.querySelectorAll('.ox-cmp-mini[data-pending]');
    if (!boxes.length) return;
    if (typeof IntersectionObserver !== 'function') { boxes.forEach(want); return; }
    observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      want(entry.target);
    }), { rootMargin: '240px 0px' });
    boxes.forEach(box => observer.observe(box));
  }

  // 分享圖片: the picture button by the tier, or a long press on the coin.
  async function sharePick(at, symbol) {
    const point = pointOf(at), pick = pickOf(at, symbol);
    if (!point || !pick) return;
    let candles = [];
    try { candles = await candlesFor(symbol, abort.signal); } catch {}
    const breakIdx = candles.findIndex(c => c.time === at - STEP), last = pick.last;
    const result = r => r.state === 'done' ? [`之後 ${r.label}`, pct(r.ret), r.ret > 0 ? SHARE_UP : r.ret < 0 ? SHARE_DOWN : null] : [`之後 ${r.label}`, r.state === 'wait' ? '還沒到' : '—'];
    return shareCoin({ name: pick.coin, symbol: 'USDT 永續', chips: [[pick.name, 'gold'], [pick.t ? 'T' + pick.t : '', 'tier'], ['4 小時 K', 'plain']],
      candles, points: indexPoints(pick.pts, candles, STEP), breakIdx: breakIdx >= 0 ? breakIdx : null, label: point.time + ' 突破',
      big: last ? { label: `突破後 ${last.label}`, value: pct(last.ret), color: last.ret > 0 ? SHARE_UP : last.ret < 0 ? SHARE_DOWN : '#eef1f4' } : null,
      facts: [['突破那根收盤', sharePrice(pick.base)], ...pick.results.slice(0, 2).map(result)],
      dateLabel: point.time + ' 突破', note: PERFORMANCE_NOTE, kind: 'compare' });
  }
  const stopPress = longPress(root, '.ox-cmp-pick', el => sharePick(Number(el.dataset.cmpAt), el.dataset.cmpSymbol));
  root.addEventListener('click', event => {
    const pic = event.target.closest('[data-cmp-share]');
    if (pic) { event.stopPropagation(); const pickEl = pic.closest('.ox-cmp-pick'); sharePick(Number(pickEl?.dataset.cmpAt), pickEl?.dataset.cmpSymbol); return; }
    const target = event.target.closest('button');
    if (!target || !root.contains(target)) return;
    if ('cmpRetry' in target.dataset) { view.error = null; if (!view.model) view.loaded = false; render(); load(true); return; }
    if (target.dataset.cmpSymbol) {
      const at = Number(target.dataset.cmpAt), point = pointOf(at), pick = pickOf(at, target.dataset.cmpSymbol);
      if (point && pick) { view.detail?.close(); view.detail = openPatternDetail({ point, pick, onOpenChart: (symbol, frame) => onOpen?.(symbol, frame) }); }
      return;
    }
    if (target.dataset.cmpKind) { view.kind = target.dataset.cmpKind; render(); return; }
    if (target.dataset.cmpTier) { view.tier = target.dataset.cmpTier; render(); return; }
    if (target.dataset.cmpK) { view.k = Number(target.dataset.cmpK); render(); return; }
    if (target.dataset.cmpStat) { view.statK = Number(target.dataset.cmpStat); render(); return; }
    if ('cmpMore' in target.dataset) { view.allHistory = true; render(); return; }
    if (target.dataset.cmpGoto) { view.at = Number(target.dataset.cmpGoto); view.picked = true; view.tier = 'all'; view.kind = 'all'; render(); return; }
    if (target.dataset.cmpStep) {
      const points = view.model?.points || [], next = points[points.findIndex(p => p.at === view.at) + Number(target.dataset.cmpStep)];
      if (!next) return;
      view.at = next.at; view.picked = true; view.tier = 'all'; view.kind = 'all';
      globalThis.OXTrack?.('compare.point', next.time); render();
    }
  });
  // 過去紀錄: a line opens that close on 每 4 小時突破.
  function openLine(line) {
    const at = Number(line?.dataset.cmpAt);
    if (!pointOf(at)) return;
    view.at = at; view.picked = true; view.tier = 'all'; view.kind = 'all';
    tabs.select('point');
  }
  root.addEventListener('click', event => { const line = event.target.closest('tr[data-cmp-at]'); if (line) openLine(line); });
  root.addEventListener('keydown', event => { const line = event.target.closest?.('tr[data-cmp-at]'); if (line && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openLine(line); } });

  async function load(force = false) {
    try {
      const log = await loadLog(force);
      if (destroyed) return;
      if (log !== view.log) {
        view.log = log;
        charts.clear(); // new closes change the shading; the candles stay cached until the next 4H close
        view.model = log ? compareModel(log) : null;
        // A new close moves the page to it, unless a close was picked.
        if (view.model && (!view.picked || !pointOf(view.at))) view.at = defaultPoint(view.model);
      }
      view.loaded = true; view.error = null;
    } catch (error) {
      if (destroyed) return;
      if (!view.loaded) view.error = error;
      console.warn('[OX 型態]', error?.message || error);
    }
    render();
  }

  render();
  load();
  return {
    refresh: () => load(true),
    suspend() {
      if (suspended) return;
      suspended = true; observer?.disconnect(); observer = null;
      abort.abort(); abort = new AbortController(); queue.length = 0; queued.clear();
    },
    resume() {
      if (!suspended) return;
      suspended = false; watchMinis();
      load();
    },
    destroy() {
      destroyed = true; stopPress(); observer?.disconnect(); abort.abort(); view.detail?.close(); tabs.destroy(); host.replaceChildren();
    }
  };
}
