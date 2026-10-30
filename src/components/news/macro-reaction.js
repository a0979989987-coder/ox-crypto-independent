// 公布前後走勢 in a 非農／CPI／FOMC event's detail: this release beside the previous one
// of the same data, as 5-minute bars of the Bitget BTC or ETH USDT perpetual from one
// hour before to three hours after, with the release moment in fluorescent yellow
// (data/macro-reactions.json, written by scripts/collect-macro-reactions.mjs).
export const REACTION_METRICS = ['nonfarm-payrolls', 'cpi-mom', 'fed-rate'];
const INSTRUMENTS = [['btc', 'BTC', 0], ['eth', 'ETH', 2]];
const BEFORE = 60, AFTER = 180, STEP = 300;
let job = null, jobAt = 0;
const load = () => {
  if (!job || Date.now() - jobAt > 5 * 60000) {
    jobAt = Date.now();
    job = fetch('data/macro-reactions.json?t=' + Math.floor(Date.now() / 300000), { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw Error('HTTP ' + r.status); return r.json(); })
      .catch(error => { job = null; throw error; });
  }
  return job;
};
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const taipei = (ms, opts) => new Date(ms).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hourCycle: 'h23', ...opts });
const when = ms => taipei(ms, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const clock = ms => taipei(ms, { hour: '2-digit', minute: '2-digit' });
const num = (v, digits) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// 非農／CPI events from the BLS schedule carry no result record yet: read their metric from the title.
export function reactionMetric(item) {
  if (REACTION_METRICS.includes(item?.metric)) return item.metric;
  if (item?.sourceId !== 'bls-calendar') return null;
  return /^Employment Situation for /.test(item.title || '') ? 'nonfarm-payrolls' : /^Consumer Price Index for /.test(item.title || '') ? 'cpi-mom' : null;
}
// This release (by id, else by its time) and the previous release of the same data.
export function reactionPair(data, item) {
  const metric = reactionMetric(item), events = data?.events || {}, time = Date.parse(item?.releasedAt || item?.occursAt);
  const list = Object.values(events).filter(e => e.metric === metric).sort((a, b) => a.releasedAt.localeCompare(b.releasedAt));
  const mine = events[item?.macroId] || events[item?.id] || (Number.isFinite(time) ? list.find(e => Math.abs(Date.parse(e.releasedAt) - time) < 60000) : null) || null;
  const at = mine ? Date.parse(mine.releasedAt) : Number.isFinite(time) ? time : null;
  const previous = list.filter(e => at == null || Date.parse(e.releasedAt) < at).at(-1) || null;
  return { metric, at, mine, previous };
}
// Price just before the release, 30 and 60 minutes after it, and the range after it.
export function reactionMoves(bars, at) {
  const t = at / 1000, closeAt = s => bars.find(b => b[0] + STEP === s)?.[4] ?? null;
  const post = bars.filter(b => b[0] >= t);
  return { before: closeAt(t) ?? bars.filter(b => b[0] < t).at(-1)?.[4] ?? null, m30: closeAt(t + 1800), m60: closeAt(t + 3600),
    high: post.length ? Math.max(...post.map(b => b[2])) : null, low: post.length ? Math.min(...post.map(b => b[3])) : null };
}

// Candles over the whole window (a release still in progress fills from the left),
// hour lines with Taipei times, the release line and its first 30 minutes in yellow.
function chart(bars, at) {
  const W = 340, H = 158, top = 8, bottom = 18, slots = (BEFORE + AFTER) * 60 / STEP, from = at / 1000 - BEFORE * 60;
  const lo = Math.min(...bars.map(b => b[3])), hi = Math.max(...bars.map(b => b[2])), bw = W / slots, body = Math.max(1.2, bw * .62);
  const X = s => (s - from) / STEP * bw, Y = v => top + (hi - v) / (hi - lo || hi * .001 || 1) * (H - top - bottom), f = v => v.toFixed(1);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="公布前 1 小時到公布後 3 小時的 5 分 K">`;
  s += `<rect class="hl-band" x="${f(X(at / 1000))}" y="0" width="${f(bw * 6)}" height="${H - bottom}"/>`;
  for (let h = 0; h <= (BEFORE + AFTER) / 60; h++) {
    const sec = from + h * 3600, x = X(sec), release = sec === at / 1000;
    if (!release) s += `<line class="grid" x1="${f(x)}" x2="${f(x)}" y1="0" y2="${H - bottom}"/>`;
    s += `<text class="${release ? 'hl-text' : 'tick'}" x="${f(Math.min(W - 2, Math.max(2, x)))}" y="${H - 5}" text-anchor="${h === 0 ? 'start' : x > W - 20 ? 'end' : 'middle'}">${release ? '公布 ' : ''}${clock(sec * 1000)}</text>`;
  }
  for (const b of bars) {
    const x = X(b[0]) + bw / 2, cls = b[4] >= b[1] ? 'u' : 'd', y = Y(Math.max(b[1], b[4]));
    s += `<line class="${cls}" x1="${f(x)}" x2="${f(x)}" y1="${f(Y(b[2]))}" y2="${f(Y(b[3]))}"/><rect class="${cls}" x="${f(x - body / 2)}" y="${f(y)}" width="${f(body)}" height="${f(Math.max(.8, Y(Math.min(b[1], b[4])) - y))}"/>`;
  }
  s += `<line class="hl-line" x1="${f(X(at / 1000))}" x2="${f(X(at / 1000))}" y1="0" y2="${H - bottom}"/>`;
  return s + '</svg>';
}

export function macroReactionSection(item) {
  const box = el('section', 'oxn-reaction'); box.setAttribute('aria-label', '公布前後走勢');
  const head = el('div', 'oxn-reaction-head'), seg = el('div', 'oxn-reaction-seg'), body = el('div', 'oxn-reaction-body', '讀取走勢…');
  seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', '看哪個幣');
  head.append(el('h3', '', '公布前後走勢'), seg);
  box.append(head, body, el('p', 'oxn-reaction-note', 'Bitget USDT 永續・5 分 K・台北時間'));
  let instrument = 'btc', data = null;
  for (const [id, name] of INSTRUMENTS) {
    const b = el('button', '', name); b.type = 'button'; b.dataset.instrument = id;
    b.onclick = () => { if (instrument === id) return; instrument = id; globalThis.OXTrack?.('macro.reaction', id); paint(); };
    seg.append(b);
  }
  function card(title, event, at) {
    const wrap = el('div', 'oxn-reaction-card'), w = event?.[instrument];
    wrap.append(el('div', 'oxn-reaction-title', title));
    if (!w?.bars?.length || at == null) {
      const soon = at == null || at > Date.now() - 45 * 60000;
      wrap.append(el('p', 'oxn-reaction-empty', !event && title.startsWith('上次') ? '還沒有上一次的紀錄' : soon ? '公布後幾分鐘更新' : '這次沒有取得走勢資料'));
      return wrap;
    }
    const chartBox = el('div', 'oxn-reaction-chart'); chartBox.innerHTML = chart(w.bars, at); wrap.append(chartBox);
    const digits = INSTRUMENTS.find(i => i[0] === instrument)[2], m = reactionMoves(w.bars, at);
    const diff = v => v == null || m.before == null ? '—' : `${v - m.before >= 0 ? '+' : ''}${num(v - m.before, digits)}（${v >= m.before ? '+' : ''}${((v / m.before - 1) * 100).toFixed(2)}%）`;
    const facts = el('div', 'oxn-reaction-facts');
    for (const [k, v, sign] of [['公布前', m.before == null ? '—' : num(m.before, digits), 0], ['30 分後', diff(m.m30), (m.m30 ?? m.before) - m.before], ['1 小時後', diff(m.m60), (m.m60 ?? m.before) - m.before], ['公布後高／低', m.high == null ? '—' : `${num(m.high, digits)}／${num(m.low, digits)}`, 0]]) {
      const c = el('div'); c.append(el('small', '', k), el('b', sign > 0 ? 'up' : sign < 0 ? 'down' : '', v)); facts.append(c);
    }
    wrap.append(facts);
    return wrap;
  }
  function paint() {
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.instrument === instrument)));
    if (!data) return;
    const { at, mine, previous } = reactionPair(data, item);
    body.replaceChildren(card(`這次・${at != null ? when(at) : '待公布'}`, mine, at), card(previous ? `上次・${when(Date.parse(previous.releasedAt))}` : '上次', previous, previous ? Date.parse(previous.releasedAt) : null));
  }
  paint();
  load().then(d => { data = d; paint(); }, () => { body.textContent = '走勢資料暫時無法載入'; });
  return box;
}
