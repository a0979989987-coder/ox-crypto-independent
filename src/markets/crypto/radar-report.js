/* 雷達成績單：自動記下雷達列出的每一檔（多／空、T1／T2／T3、進榜價、停損、目標），
 * 之後用 1H K 線檢查 7 天內先碰到目標還是停損（影線即算），統計各分級的命中率與期望值。
 *
 * 只記這台裝置開著雷達時看到的訊號（存在瀏覽器 localStorage），不上傳、不需要帳號。
 * 同一檔同一方向連續在榜算同一筆；離榜超過 6 小時再進榜才算新的一筆。分級記錄最高到過哪一級。
 * 判定：多單 K 線低點碰到停損＝停損；高點碰到目標＝命中。同一根 K 同時碰到兩邊，保守算停損。
 * 7 天內都沒碰到＝到期，以第 7 天收盤計算報酬。
 */
(function (root) {
  'use strict';
  const KEY = 'ox-radar-report-v1';
  const HORIZON_MS = 7 * 86400000, REOPEN_MS = 6 * 3600000, KEEP_MS = 45 * 86400000, MAX_ENTRIES = 800;
  const FRESH_MS = 30 * 60000; // 只記分析時間在 30 分鐘內的列（重新整理時恢復的舊快照不算新訊號）
  const TIER_RANK = { t1: 1, t2: 2, t3: 3 };
  const finite = Number.isFinite;
  let entries = load(), dirty = false, saveTimer = 0;

  function load() {
    try { const list = JSON.parse(root.localStorage?.getItem(KEY) || '[]'); return Array.isArray(list) ? list.filter(e => e && e.symbol && e.side) : []; }
    catch { return []; }
  }
  function save(now = Date.now()) {
    entries = entries.filter(e => now - e.firstAt <= KEEP_MS).sort((a, b) => a.firstAt - b.firstAt).slice(-MAX_ENTRIES);
    try { root.localStorage?.setItem(KEY, JSON.stringify(entries)); } catch {}
    dirty = false;
  }
  function scheduleSave() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = 0; if (dirty) save(); }, 5000);
  }

  // 由雷達名單更新紀錄。lists = state.tierMapBySide；priceOf(symbol) 取目前價格。
  function record(lists, { now = Date.now(), priceOf = () => null } = {}) {
    let changed = false;
    for (const side of ['long', 'short']) {
      for (const tier of ['t1', 't2', 't3']) {
        for (const row of lists?.[side]?.[tier] || []) {
          const r = row.radarSide;
          if (!r || !row.symbol || (row.at && now - row.at > FRESH_MS)) continue;
          const open = entries.findLast?.(e => e.symbol === row.symbol && e.side === side) ?? [...entries].reverse().find(e => e.symbol === row.symbol && e.side === side);
          if (open && now - open.lastSeen <= REOPEN_MS && now - open.firstAt <= HORIZON_MS) {
            open.lastSeen = now;
            if (TIER_RANK[tier] < TIER_RANK[open.bestTier]) { open.bestTier = tier; open.bestAt = now; }
            changed = true;
            continue;
          }
          const price = priceOf(row.symbol) ?? row.lastPrice;
          if (!finite(price) || price <= 0) continue;
          entries.push({ id: row.symbol + ':' + side + ':' + now, symbol: row.symbol, side, tier, bestTier: tier, firstAt: now, lastSeen: now, price,
            stop: finite(r.stop) ? r.stop : null, target: finite(r.target?.level) ? r.target.level : null, rr: finite(r.elements?.rr) ? r.elements.rr : null,
            score: r.score ?? null, fill: !r.listed, path: r.pathway?.group || '', frame: r.frame || '', outcome: null });
          changed = true;
        }
      }
    }
    if (changed) scheduleSave();
    return changed;
  }

  // 用之後的 K 線判定一筆紀錄（純函式，方便測試）。bars：由舊到新的 1H K 線。
  function judge(entry, bars, now = Date.now()) {
    const dir = entry.side === 'short' ? -1 : 1, end = entry.firstAt + HORIZON_MS;
    // 進榜那一小時的 K 線分不出進榜前後的價格，從下一根 1H 開始判定。
    const start = Math.floor(entry.firstAt / 3600000) * 3600000 + 3600000;
    const usable = (bars || []).filter(c => c.time * 1000 >= start && c.time * 1000 < end).sort((a, b) => a.time - b.time);
    let best = entry.price, worst = entry.price, status = 'open', at = null, exit = null;
    for (const c of usable) {
      const hitStop = finite(entry.stop) && (dir === 1 ? c.low <= entry.stop : c.high >= entry.stop);
      const hitTarget = finite(entry.target) && (dir === 1 ? c.high >= entry.target : c.low <= entry.target);
      if (hitStop) { status = 'stop'; at = c.time * 1000; exit = entry.stop; worst = dir === 1 ? Math.min(worst, entry.stop) : Math.max(worst, entry.stop); break; }
      best = dir === 1 ? Math.max(best, c.high) : Math.min(best, c.low);
      worst = dir === 1 ? Math.min(worst, c.low) : Math.max(worst, c.high);
      if (hitTarget) { status = 'target'; at = c.time * 1000; exit = entry.target; break; }
    }
    if (status === 'open' && now >= end && usable.length) { status = 'expired'; exit = usable.at(-1).close; at = end; }
    const move = x => finite(x) ? dir * (x / entry.price - 1) : null;
    const risk = finite(entry.stop) ? Math.abs(entry.price - entry.stop) : null;
    const r = status === 'target' && finite(entry.target) && risk ? Math.abs(entry.target - entry.price) / risk
      : status === 'stop' ? -1 : status === 'expired' && risk ? dir * (exit - entry.price) / risk : null;
    return { status, at, mfe: move(best), mae: -move(worst) || 0, ret: exit === null ? null : move(exit), r, bars: usable.length, evaluatedAt: now };
  }

  // api.js 以 const 宣告 BitgetAPI（全域詞法綁定，不在 globalThis 上）。
  const bitget = () => typeof BitgetAPI !== 'undefined' ? BitgetAPI : root.BitgetAPI;
  async function evaluate({ now = Date.now(), fetchCandles = bitget()?.fetchCandles?.bind(bitget()), onProgress } = {}) {
    if (!fetchCandles) return 0;
    const pending = entries.filter(e => (!e.outcome || e.outcome.status === 'open') && now - e.firstAt >= 3600000 &&
      (!e.outcome || now - e.outcome.evaluatedAt >= 20 * 60000));
    const bySymbol = new Map();
    for (const e of pending) bySymbol.set(e.symbol, [...(bySymbol.get(e.symbol) || []), e]);
    let done = 0;
    const jobs = [...bySymbol.entries()];
    const worker = async () => {
      while (jobs.length) {
        const [symbol, list] = jobs.shift();
        try {
          const oldest = Math.min(...list.map(e => e.firstAt));
          // 最近 200 根 1H 約 8 天；更早的紀錄改讀那段期間的歷史 K 線。
          const recent = now - oldest <= 190 * 3600000;
          const bars = recent ? await fetchCandles(symbol, '1H', 200, null, { owner: 'radar-report', priority: 10 })
            : await fetchCandles(symbol, '1H', 200, Math.min(now, oldest + HORIZON_MS + 3600000), { owner: 'radar-report', priority: 10 });
          for (const e of list) e.outcome = judge(e, bars, now);
        } catch { /* 下次再試 */ }
        done += list.length;
        onProgress?.(done, pending.length);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (pending.length) save(now);
    return pending.length;
  }

  // 統計：side＝long／short，days＝期間。
  function summary({ side = 'long', days = 7, now = Date.now() } = {}) {
    const list = entries.filter(e => e.side === side && now - e.firstAt <= days * 86400000);
    const rows = ['t1', 't2', 't3', 'all'].map(tier => {
      const group = tier === 'all' ? list : list.filter(e => e.bestTier === tier);
      const judged = group.filter(e => e.outcome && e.outcome.status !== 'open');
      const wins = judged.filter(e => e.outcome.status === 'target').length, stops = judged.filter(e => e.outcome.status === 'stop').length;
      const avg = key => { const v = group.map(e => e.outcome?.[key]).filter(finite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
      const rs = judged.map(e => e.outcome.r).filter(finite);
      return { tier, count: group.length, judged: judged.length, wins, stops, expired: judged.length - wins - stops,
        hitRate: wins + stops ? wins / (wins + stops) : null, mfe: avg('mfe'), mae: avg('mae'),
        expectancy: rs.length ? rs.reduce((s, x) => s + x, 0) / rs.length : null };
    });
    return { side, days, rows, recent: list.slice(-40).reverse() };
  }

  // ---------- 介面 ----------
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = x => finite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '—';
  const price = v => typeof root.fmtPrice === 'function' ? root.fmtPrice(v) : (typeof fmtPrice === 'function' ? fmtPrice(v) : String(v));
  const when = ms => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const STATUS = { target: '命中目標', stop: '觸及停損', expired: '7 天到期', open: '進行中' };
  let view = { side: 'long', days: 7 }, overlay = null, lastFocus = null, busy = false;

  function dialog() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'ox-radar-report';
    overlay.hidden = true;
    overlay.innerHTML = `<div class="orr-dialog" role="dialog" aria-modal="true" aria-labelledby="orr-title" tabindex="-1">
      <div class="orr-head"><div><h2 id="orr-title">雷達成績單</h2><p>這台裝置開著雷達時記下的訊號，用 1H K 線檢查進榜後 7 天內先碰到目標還是停損（影線即算，同一根兩邊都碰到算停損）。</p></div>
        <button type="button" class="orr-close" data-orr-close aria-label="關閉成績單">×</button></div>
      <div class="orr-controls"><div class="orr-seg" role="group" aria-label="方向"><button type="button" data-orr-side="long">多單</button><button type="button" data-orr-side="short">空單</button></div>
        <div class="orr-seg" role="group" aria-label="期間"><button type="button" data-orr-days="7">7 天</button><button type="button" data-orr-days="30">30 天</button></div>
        <button type="button" class="orr-refresh" data-orr-refresh>更新結果</button><span class="orr-status" role="status"></span></div>
      <div class="orr-body"></div></div>`;
    document.body.append(overlay);
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target.closest('[data-orr-close]')) { close(); return; }
      const sideButton = event.target.closest('[data-orr-side]'), daysButton = event.target.closest('[data-orr-days]');
      if (sideButton) { view.side = sideButton.dataset.orrSide; render(); }
      if (daysButton) { view.days = Number(daysButton.dataset.orrDays); render(); }
      if (event.target.closest('[data-orr-refresh]')) refresh();
    });
    overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
    return overlay;
  }
  function render() {
    const host = dialog(), data = summary(view);
    host.querySelectorAll('[data-orr-side]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.orrSide === view.side)));
    host.querySelectorAll('[data-orr-days]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.orrDays) === view.days)));
    const label = { t1: 'T1', t2: 'T2', t3: 'T3', all: '合計' };
    const table = `<table class="orr-table"><thead><tr><th scope="col">分級</th><th scope="col">訊號</th><th scope="col">已結算</th><th scope="col" title="命中目標 ÷（命中目標＋觸及停損）">命中率</th><th scope="col" title="每筆以停損距離為 1R：命中＝計畫盈虧比，停損＝−1，到期＝實際報酬">期望值</th><th scope="col" title="進榜後最大有利幅度的平均">平均最大有利</th><th scope="col" title="進榜後最大不利幅度的平均">平均最大不利</th></tr></thead><tbody>${
      data.rows.map(r => `<tr class="${r.tier === 'all' ? 'is-total' : ''}"><th scope="row">${label[r.tier]}</th><td>${r.count}</td><td>${r.judged}${r.judged ? `<small>（中 ${r.wins} · 停 ${r.stops}${r.expired ? ' · 到期 ' + r.expired : ''}）</small>` : ''}</td><td>${finite(r.hitRate) ? Math.round(r.hitRate * 100) + '%' : '—'}</td><td>${finite(r.expectancy) ? (r.expectancy >= 0 ? '+' : '') + r.expectancy.toFixed(2) + 'R' : '—'}</td><td>${pct(r.mfe)}</td><td>${finite(r.mae) ? pct(-r.mae) : '—'}</td></tr>`).join('')
    }</tbody></table>`;
    const recent = data.recent.length ? `<ol class="orr-list">${data.recent.map(e => {
      const o = e.outcome, status = o ? o.status : 'open';
      return `<li class="is-${status}"><span class="orr-when">${when(e.firstAt)}</span><button type="button" class="orr-symbol" data-orr-symbol="${esc(e.symbol)}">${esc(e.symbol.replace(/USDT$/, ''))}</button>` +
        `<span class="orr-tier">${esc(e.bestTier.toUpperCase())}${e.fill ? ' 補位' : ''}</span><span class="orr-path">${esc(e.path)}</span>` +
        `<span class="orr-entry">${esc(price(e.price))}</span><span class="orr-outcome">${STATUS[status]}${o && finite(o.mfe) ? ` <small>最大 ${pct(o.mfe)} / ${pct(-o.mae)}</small>` : ''}</span></li>`;
    }).join('')}</ol>` : '<p class="orr-empty">這段期間還沒有記錄。開著雷達時，進榜的幣會自動記下來。</p>';
    host.querySelector('.orr-body').innerHTML = table + '<h3>最近進榜</h3>' + recent;
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    const status = dialog().querySelector('.orr-status');
    status.textContent = '讀取 K 線中…';
    try {
      const n = await evaluate({ onProgress: (done, total) => { status.textContent = `讀取 K 線 ${done}/${total}`; } });
      status.textContent = n ? '已更新' : '沒有需要更新的紀錄';
    } catch { status.textContent = '更新失敗，稍後再試'; }
    busy = false;
    render();
  }
  function open() {
    lastFocus = document.activeElement;
    const host = dialog();
    host.hidden = false;
    document.body.classList.add('ox-radar-report-open');
    render();
    host.querySelector('.orr-dialog').focus();
    refresh();
  }
  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('ox-radar-report-open');
    lastFocus?.focus?.({ preventScroll: true });
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('click', event => {
      if (event.target.closest?.('[data-radar-report]')) { event.preventDefault(); open(); return; }
      const symbol = event.target.closest?.('[data-orr-symbol]');
      if (symbol && typeof root.switchSymbol === 'function') { close(); root.switchSymbol(symbol.dataset.orrSymbol); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) save(); });
  }

  root.OXRadarReport = Object.freeze({ record, judge, evaluate, summary, open, close, entries: () => entries.map(e => ({ ...e })), _reset: list => { entries = list || []; } });
})(globalThis);
