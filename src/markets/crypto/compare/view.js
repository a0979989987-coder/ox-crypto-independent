// 型態 tab of the 畫板 dock view (it was 對比): each recorded 4H close (newest first) with
// the coins the pattern board listed as confirmed upward breakouts, a mini 4H chart of
// each and how it moved 4 小時／1 天／3 天 later against BTC; a row to keep one pattern;
// 長期勝率 added up over every record; a card opens 型態詳情 (./detail.js). Mounted by
// src/markets/crypto/radar-compare.js; styles live in src/styles/components/crypto-shell.css (.ox-cmp).
import { withDeadline } from '../../../components/resource-deadline.js';
import { STEP, compareModel, defaultOpen, isLog, miniChart, closesChart, parseRows, pct, tone, nextCloseText, patternKinds, filterModel, longRunStats, periodLabel, taipeiTime, LONG_RUN_MIN } from './model.js?v=20261030-board2';
import { openPatternDetail } from './detail.js?v=20261030-board2';

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

const CHEVRON = '<svg class="ox-cmp-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>';

export function mountCompare(host, { onOpen } = {}) {
  const root = document.createElement('div');
  root.className = 'ox-cmp';
  host.replaceChildren(root);
  // kind: the pattern kept by the filter row; statK: 長期勝率's period (6 = 1 天).
  const view = { log: null, model: null, error: null, loaded: false, open: new Set(), touched: false, kind: 'all', statsOpen: false, statK: 6, detail: null };
  const charts = new Map(); // `${symbol}@${at}` → svg, kept across renders
  let destroyed = false, suspended = false, abort = new AbortController(), observer = null;
  const queue = [], queued = new Set();
  let active = 0;

  const pointOf = at => view.model?.points.find(p => p.at === at);
  const shown = () => filterModel(view.model, view.kind);
  const pickOf = (at, symbol) => pointOf(at)?.picks.find(p => p.s === symbol);

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
        <span class="ox-cmp-name"><b>${esc(pick.coin)}</b>${pick.t ? `<span class="ox-cmp-tier" data-tier="${pick.t}">T${pick.t}</span>` : ''}<span class="ox-cmp-go" aria-hidden="true">›</span></span>
        <span class="ox-cmp-pattern">${esc(pick.name)}</span>
        <span class="ox-cmp-rets">${resultCells(pick)}</span>
      </span>
    </button>`;
  }
  // Collapsed: the coins and their latest result, on one line.
  function previewHTML(point) {
    const span = [...point.spans].reverse().find(s => s.reached);
    const items = point.picks.map(p => {
      const r = span && p.results.find(x => x.k === span.k);
      return r?.state === 'done' ? `<span>${esc(p.coin)} <b class="${tone(r.ret)}">${pct(r.ret)}</b></span>` : `<span>${esc(p.coin)}</span>`;
    }).join('');
    return `<span class="ox-cmp-preview">${span ? `<em>${span.label}</em>` : ''}${items}</span>`;
  }
  function pointHTML(point) {
    const when = `<span class="ox-cmp-when"><b>${point.time}</b><span>${point.count ? `突破 ${point.count} 個` : '沒有突破'}</span></span>`;
    if (!point.count) return `<section class="ox-cmp-point is-none" data-at="${point.at}"><div class="ox-cmp-head">${when}</div></section>`;
    const open = view.open.has(point.at);
    return `<section class="ox-cmp-point${open ? ' is-open' : ''}" data-at="${point.at}">
      <button type="button" class="ox-cmp-head" data-cmp-point="${point.at}" aria-expanded="${open}"${open ? '' : ` data-track="compare.point" data-track-detail="${point.time}"`}>${when}${open ? '' : previewHTML(point)}${CHEVRON}</button>
      ${open ? `<div class="ox-cmp-picks">${point.picks.map(p => pickHTML(point, p)).join('')}</div>` : ''}
    </section>`;
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

  // One pattern at a time: 全部型態 or a pattern in the records, the most frequent first.
  function kindsHTML() {
    const kinds = patternKinds(view.model);
    if (kinds.length < 2) return '';
    return `<div class="ox-cmp-kinds" role="group" aria-label="型態"><button type="button" data-cmp-kind="all" aria-pressed="${view.kind === 'all'}">全部型態</button>${kinds.map(k => `<button type="button" data-cmp-kind="${esc(k.id)}" aria-pressed="${view.kind === k.id}" data-track="compare.kind" data-track-detail="${esc(k.id)}">${esc(k.name)}<small>${k.n}</small></button>`).join('')}</div>`;
  }
  // 長期勝率: every record added up by tier and by pattern; folded into one line until opened.
  function statsHTML() {
    const { periods, step } = view.model, stats = longRunStats(view.log, view.statK);
    if (!stats && !periods.some(k => longRunStats(view.log, k))) return '';
    const label = periodLabel(view.statK, step), open = view.statsOpen;
    const preview = stats?.tiers.length ? stats.tiers.map(t => `<span>T${t.id} <b>${Math.round(t.win)}%</b></span>`).join('') : '<span>還沒有收盤</span>';
    const row = (title, o) => `<tr><th scope="row">${title}</th><td>${o.n}</td><td>${Math.round(o.win)}%</td><td class="${tone(o.avg)}">${pct(o.avg)}</td><td class="${o.btc == null ? 'mu' : tone(o.btc)}">${o.btc == null ? '—' : pct(o.btc)}</td></tr>`;
    const head = first => `<thead><tr><th scope="col">${first}</th><th scope="col">次數</th><th scope="col">勝率</th><th scope="col">平均</th><th scope="col">BTC</th></tr></thead>`;
    return `<section class="ox-cmp-point ox-cmp-stats${open ? ' is-open' : ''}" aria-label="長期勝率">
      <button type="button" class="ox-cmp-head" data-cmp-stats aria-expanded="${open}"${open ? '' : ' data-track="compare.stats"'}><span class="ox-cmp-when"><b>長期勝率</b><span>${stats ? `${taipeiTime(stats.from).split(' ')[0]} 起・${stats.records} 次收盤` : ''}</span></span>${open ? '' : `<span class="ox-cmp-preview"><em>${label}</em>${preview}</span>`}${CHEVRON}</button>
      ${open ? `<div class="ox-cmp-stats-body">
        <div class="ox-cmp-seg" role="group" aria-label="之後多久">${periods.map(k => `<button type="button" data-cmp-stat="${k}" aria-pressed="${k === view.statK}">${periodLabel(k, step)}</button>`).join('')}</div>
        ${stats ? `<table class="ox-cmp-table">${head('等級')}<tbody>${stats.tiers.map(t => row('T' + t.id, t)).join('')}</tbody></table>
        ${stats.patterns.length ? `<table class="ox-cmp-table">${head('型態')}<tbody>${stats.patterns.map(o => row(esc(o.name), o)).join('')}</tbody></table>` : ''}` : `<p class="ox-cmp-note">${label}後的收盤還沒到，到了會自動加進來。</p>`}
        <p class="ox-cmp-note">勝率＝之後收盤比突破那根收盤高的比例。BTC＝同一段時間 BTC 的漲跌。${stats?.few ? `${stats.patterns.length ? '另有' : '目前'} ${stats.few} 種型態不到 ${LONG_RUN_MIN} 次，先不列；每次收盤後會累積。` : ''}</p>
      </div>` : ''}
    </section>`;
  }
  function render() {
    if (destroyed) return;
    if (!view.loaded) root.innerHTML = view.error ? stateHTML('error') : stateHTML('loading');
    else if (!view.model || view.model.empty) root.innerHTML = stateHTML('empty');
    else {
      if (view.kind !== 'all' && !patternKinds(view.model).some(k => k.id === view.kind)) view.kind = 'all';
      root.innerHTML = `<p class="ox-cmp-intro">畫板每根 4 小時 K 收盤時列出的向上突破</p>${statsHTML()}${kindsHTML()}<div class="ox-cmp-list">${shown().points.map(pointHTML).join('')}</div>${footHTML(view.model)}`;
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

  root.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target || !root.contains(target)) return;
    if ('cmpRetry' in target.dataset) { view.error = null; if (!view.model) view.loaded = false; render(); load(true); return; }
    if (target.dataset.cmpSymbol) {
      const at = Number(target.dataset.cmpAt), point = pointOf(at), pick = pickOf(at, target.dataset.cmpSymbol);
      if (point && pick) { view.detail?.close(); view.detail = openPatternDetail({ point, pick, onOpenChart: (symbol, frame) => onOpen?.(symbol, frame) }); }
      return;
    }
    if (target.dataset.cmpKind) {
      view.kind = target.dataset.cmpKind;
      // Keep a record open: the newest one with this pattern, when none of the open ones has it.
      const points = shown().points;
      if (points.length && !points.some(p => view.open.has(p.at))) view.open.add(points[0].at);
      render(); return;
    }
    if ('cmpStats' in target.dataset) { view.statsOpen = !view.statsOpen; render(); return; }
    if (target.dataset.cmpStat) { view.statK = Number(target.dataset.cmpStat); render(); return; }
    const at = Number(target.dataset.cmpPoint);
    if (!Number.isFinite(at)) return;
    view.touched = true;
    if (view.open.has(at)) view.open.delete(at); else view.open.add(at);
    render();
  });

  async function load(force = false) {
    try {
      const log = await loadLog(force);
      if (destroyed) return;
      if (log !== view.log) {
        view.log = log;
        charts.clear(); // new closes change the shading; the candles stay cached until the next 4H close
        view.model = log ? compareModel(log) : null;
        const first = view.model && defaultOpen(view.model);
        if (!view.touched && first != null) view.open = new Set([first]);
        for (const at of view.open) if (!pointOf(at)) view.open.delete(at);
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
      destroyed = true; observer?.disconnect(); abort.abort(); view.detail?.close(); host.replaceChildren();
    }
  };
}
