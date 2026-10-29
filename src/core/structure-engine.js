/* OX 雙極結構（使用者定義的結構規則）。
 *
 * 純函式：只看傳入的 K 線（由舊到新），不碰 DOM、網路，也不使用未來資料。
 * 圖表指標（src/components/chart/structure-layer.js）與雷達共用同一套判斷。
 *
 * 規則（全部「影線即算」，不看 K 線顏色，不做包含處理）：
 *   頂分型：上漲過程中任一根 K（K2）突破前一根 K 的高點；之後在再創新高之前，
 *           有 K 線跌破 K2 的低點，就確認 K2 是頂分型。跌破的那根不一定緊接在 K2 後面。
 *           同一根 K 同時突破 K2 高點與低點（外包 K）＝再創新高，K2 不算頂分型。
 *   底分型：反過來。
 *   結構底：頂分型之後回調，之後突破該頂分型的高點時，回調的最低點就是結構底
 *           （跟底分型無關）。多方結構裡，要突破的頂分型是這一段的最高點（前高）。
 *   結構頂：反過來。
 *   極陽：多方結構成立。跌破結構底＝多空平衡，還不是轉空。
 *   平衡：從極陽跌破結構底後，重新突破前高＝延續（回到極陽，結構底改為這段回調的最低點）；
 *         出現新的下跌結構（前高之後的低點先反彈、再被跌破，反彈高點即新結構頂）＝轉空（極陰）。
 *         從極陰突破結構頂後同理反過來。
 *   假突破：突破（或跌破）結構關鍵位的那根 K 收回關鍵位內，之後在任何一根 K 收到關鍵位外之前，
 *           就先跌破（或突破）那根 K 的低點（高點）。
 *
 * 同一根 K 同時碰到上下兩邊時，依 K 線方向推定先後：陽線先走低點再走高點，陰線反之。
 */
(function (root) {
  'use strict';
  const STRUCTURE_VERSION = 1;
  const STATE_LABEL = Object.freeze({ bull: '極陽', balance: '平衡', bear: '極陰' });
  const EVENT_LABEL = Object.freeze({
    'start:up': '多方結構', 'start:down': '空方結構',
    'bos:up': '結構上移', 'bos:down': '結構下移',
    'balance:down': '平衡', 'balance:up': '平衡',
    'continue:up': '延續', 'continue:down': '延續',
    'reversal:up': '轉多', 'reversal:down': '轉空',
    'fake:up': '假突破', 'fake:down': '假跌破'
  });
  const finite = Number.isFinite;

  function validBars(bars) {
    return Array.isArray(bars) && bars.every(c => c && finite(c.high) && finite(c.low) && c.high >= c.low);
  }

  // 頂分型與底分型（逐根判斷，完全照使用者定義）。
  function fractals(bars) {
    const out = [];
    const n = bars.length;
    for (let k = 1; k < n; k++) {
      const b = bars[k], p = bars[k - 1];
      if (b.high > p.high) {
        for (let j = k + 1; j < n; j++) {
          if (bars[j].high > b.high) break;
          if (bars[j].low < b.low) { out.push({ type: 'top', index: k, time: b.time, price: b.high, confirmedIndex: j, confirmedTime: bars[j].time }); break; }
        }
      }
      if (b.low < p.low) {
        for (let j = k + 1; j < n; j++) {
          if (bars[j].low < b.low) break;
          if (bars[j].high > b.high) { out.push({ type: 'bottom', index: k, time: b.time, price: b.low, confirmedIndex: j, confirmedTime: bars[j].time }); break; }
        }
      }
    }
    return out.sort((a, b) => a.confirmedIndex - b.confirmedIndex || a.index - b.index);
  }

  /**
   * @param {Array<{time:number,open:number,high:number,low:number,close:number}>} bars 由舊到新
   * @param {{lastOpen?:boolean}} options lastOpen：最後一根尚未收 K（事件標示為未收 K）
   */
  function analyze(bars, { lastOpen = false } = {}) {
    const n = Array.isArray(bars) ? bars.length : 0;
    const result = { version: STRUCTURE_VERSION, fractals: [], segments: [], events: [], states: new Array(n).fill(null), current: null };
    if (n < 3 || !validBars(bars)) { result.current = describe(result, bars || [], null); return result; }
    const H = i => bars[i].high, L = i => bars[i].low;
    const bullBar = i => bars[i].close >= bars[i].open;
    result.fractals = fractals(bars);
    const confirmedAt = Array.from({ length: n }, () => ({ top: [], bottom: [] }));
    for (const f of result.fractals) confirmedAt[f.confirmedIndex][f.type].push(f);

    // 回調低點：從頂分型（或前高）那根之後，到突破那根之前。陰線的低點出現在高點之後，
    // 所以起點陰線要算進回調；突破那根是陽線時，低點先出現，也算進回調。
    const pullbackLow = (from, i) => {
      const a = bullBar(from) ? from + 1 : from, b = bullBar(i) ? i : i - 1;
      if (a > b) return from;
      let k = a; for (let x = a + 1; x <= b; x++) if (L(x) < L(k)) k = x;
      return k;
    };
    const bounceHigh = (from, i) => {
      const a = bullBar(from) ? from : from + 1, b = bullBar(i) ? i - 1 : i;
      if (a > b) return from;
      let k = a; for (let x = a + 1; x <= b; x++) if (H(x) > H(k)) k = x;
      return k;
    };
    const legExtreme = (from, i, side) => {
      // 前高／前低：結構位設立後這一段的極點（跌破那根若是陰線，高點在跌破前，算進去）。
      const b = side === 'high' ? (bullBar(i) ? i - 1 : i) : (bullBar(i) ? i : i - 1);
      let k = from; for (let x = from + 1; x <= Math.max(from, b); x++) if (side === 'high' ? H(x) > H(k) : L(x) < L(k)) k = x;
      return k;
    };

    let trend = null, phase = null; // trend: 'up' | 'down'；phase: 'extreme' | 'balance'
    let sLow = null, sHigh = null, ref = null, broken = null, since = 0;
    let anchorTop = -1, anchorBottom = -1;
    let activeTops = [], activeBottoms = [];
    const breaks = [], open = { low: null, high: null, ref: null };

    const point = (index, price) => ({ index, time: bars[index].time, price });
    const event = (type, dir, i, level, extra = {}) => {
      result.events.push({ type, dir, index: i, time: bars[i].time, level, label: EVENT_LABEL[type + ':' + dir], provisional: lastOpen && i === n - 1, ...extra });
    };
    const startSegment = (kind, at, activeFrom) => {
      const segment = { kind, side: at.side || (kind === 'low' ? 'low' : kind === 'high' ? 'high' : null), index: at.index, time: at.time, price: at.price, activeFrom, activeTime: bars[activeFrom].time, endIndex: null, endTime: null, end: null };
      result.segments.push(segment); open[kind] = segment;
    };
    const endSegment = (kind, i, why) => {
      const segment = open[kind];
      if (!segment) return;
      segment.endIndex = i; segment.endTime = bars[i].time; segment.end = why; open[kind] = null;
    };
    const setState = (t, p, i) => { if (t !== trend || p !== phase) since = i; trend = t; phase = p; };

    function bullStructure(i, kind, level, from) {
      const at = point(pullbackLow(from, i), 0); at.price = L(at.index);
      breaks.push({ dir: 'up', level, index: i, kind });
      if (kind === 'bos' && at.price <= sLow.price) return; // 極陽裡結構底只上移，不下移
      endSegment('low', i, 'replaced'); endSegment('high', i, 'reversed'); endSegment('ref', i, kind);
      sLow = at; sHigh = null; ref = null; broken = null;
      startSegment('low', sLow, i);
      event(kind, 'up', i, level, { structure: sLow.price });
      setState('up', 'extreme', i);
    }
    function bearStructure(i, kind, level, from) {
      const at = point(bounceHigh(from, i), 0); at.price = H(at.index);
      breaks.push({ dir: 'down', level, index: i, kind });
      if (kind === 'bos' && at.price >= sHigh.price) return; // 極陰裡結構頂只下移
      endSegment('high', i, 'replaced'); endSegment('low', i, 'reversed'); endSegment('ref', i, kind);
      sHigh = at; sLow = null; ref = null; broken = null;
      startSegment('high', sHigh, i);
      event(kind, 'down', i, level, { structure: sHigh.price });
      setState('down', 'extreme', i);
    }

    function upPhase(i) {
      const h = H(i);
      activeBottoms.push(...confirmedAt[i].bottom);
      const hit = activeTops.filter(f => f.price < h);
      if (hit.length) activeTops = activeTops.filter(f => f.price >= h);
      const newest = hit.reduce((m, f) => !m || f.index > m.index ? f : m, null);
      if (newest) anchorTop = Math.max(anchorTop, newest.index);
      if (trend === 'down' && phase === 'extreme' && h > sHigh.price) {
        breaks.push({ dir: 'up', level: sHigh.price, index: i, kind: 'balance' });
        endSegment('high', i, 'broken');
        broken = sHigh; ref = point(legExtreme(sHigh.index, i, 'low'), 0); ref.price = L(ref.index); ref.side = 'low';
        startSegment('ref', ref, i);
        event('balance', 'up', i, sHigh.price, { prior: ref.price });
        setState('down', 'balance', i);
      }
      if (trend === 'up' && phase === 'balance' && h > ref.price) { bullStructure(i, 'continue', ref.price, Math.max(anchorTop, ref.index)); return; }
      if (!newest) return;
      if (trend === null) bullStructure(i, 'start', newest.price, anchorTop);
      else if (trend === 'up' && phase === 'extreme') bullStructure(i, 'bos', newest.price, anchorTop);
      else if (trend === 'down' && phase === 'balance') {
        const eligible = hit.filter(f => f.index > ref.index);
        if (eligible.length) bullStructure(i, 'reversal', eligible.reduce((m, f) => f.index > m.index ? f : m).price, anchorTop);
      }
      // 極陰中、或多方平衡中（前高之下）被突破的頂分型：只是小結構，不改變狀態。
    }
    function downPhase(i) {
      const l = L(i);
      activeTops.push(...confirmedAt[i].top);
      const hit = activeBottoms.filter(f => f.price > l);
      if (hit.length) activeBottoms = activeBottoms.filter(f => f.price <= l);
      const newest = hit.reduce((m, f) => !m || f.index > m.index ? f : m, null);
      if (newest) anchorBottom = Math.max(anchorBottom, newest.index);
      if (trend === 'up' && phase === 'extreme' && l < sLow.price) {
        breaks.push({ dir: 'down', level: sLow.price, index: i, kind: 'balance' });
        endSegment('low', i, 'broken');
        broken = sLow; ref = point(legExtreme(sLow.index, i, 'high'), 0); ref.price = H(ref.index); ref.side = 'high';
        startSegment('ref', ref, i);
        event('balance', 'down', i, sLow.price, { prior: ref.price });
        setState('up', 'balance', i);
      }
      if (trend === 'down' && phase === 'balance' && l < ref.price) { bearStructure(i, 'continue', ref.price, Math.max(anchorBottom, ref.index)); return; }
      if (!newest) return;
      if (trend === null) bearStructure(i, 'start', newest.price, anchorBottom);
      else if (trend === 'down' && phase === 'extreme') bearStructure(i, 'bos', newest.price, anchorBottom);
      else if (trend === 'up' && phase === 'balance') {
        const eligible = hit.filter(f => f.index > ref.index);
        if (eligible.length) bearStructure(i, 'reversal', eligible.reduce((m, f) => f.index > m.index ? f : m).price, anchorBottom);
      }
    }

    for (let i = 1; i < n; i++) {
      if (bullBar(i)) { downPhase(i); upPhase(i); } else { upPhase(i); downPhase(i); }
      result.states[i] = trend === null ? null : phase === 'balance' ? 'balance' : trend === 'up' ? 'bull' : 'bear';
    }

    // 假突破／假跌破：突破那根收回關鍵位內，之後在任何一根收到關鍵位外之前，先反向破掉那根 K。
    for (const b of breaks) {
      const i = b.index, bar = bars[i];
      if (lastOpen && i === n - 1) continue;
      if (b.dir === 'up' ? bar.close > b.level : bar.close < b.level) continue;
      for (let j = i + 1; j < n; j++) {
        const closed = !(lastOpen && j === n - 1);
        if (b.dir === 'up' ? bars[j].low < bar.low : bars[j].high > bar.high) {
          result.events.push({ type: 'fake', dir: b.dir, index: i, time: bar.time, level: b.level, label: EVENT_LABEL['fake:' + b.dir],
            confirmedIndex: j, confirmedTime: bars[j].time, of: b.kind, provisional: !closed });
          break;
        }
        if (closed && (b.dir === 'up' ? bars[j].close > b.level : bars[j].close < b.level)) break;
      }
    }
    // 同一根 K 可能同時有結構事件與假突破，保留順序：結構事件在前。
    result.events.sort((a, b) => a.index - b.index || (a.type === 'fake') - (b.type === 'fake'));

    const above = activeTops.filter(f => f.price > bars[n - 1].close).sort((a, b) => a.price - b.price)[0] || null;
    const below = activeBottoms.filter(f => f.price < bars[n - 1].close).sort((a, b) => b.price - a.price)[0] || null;
    const state = { trend, phase, since, sLow, sHigh, ref, broken, nextTop: above, nextBottom: below,
      turnDown: trend === 'up' && phase === 'balance' ? activeBottoms.filter(f => f.index > ref.index).sort((a, b) => b.index - a.index)[0] || null : null,
      turnUp: trend === 'down' && phase === 'balance' ? activeTops.filter(f => f.index > ref.index).sort((a, b) => b.index - a.index)[0] || null : null,
      legHigh: null, legLow: null };
    if (trend === 'up' && phase === 'extreme') { let k = sLow.index; for (let x = k; x < n; x++) if (H(x) > H(k)) k = x; state.legHigh = point(k, H(k)); }
    if (trend === 'down' && phase === 'extreme') { let k = sHigh.index; for (let x = k; x < n; x++) if (L(x) < L(k)) k = x; state.legLow = point(k, L(k)); }
    result.current = describe(result, bars, state);
    return result;
  }

  // 目前狀態與要看的價位（給圖表狀態列、雷達與詳情使用）。
  function describe(result, bars, s) {
    const n = bars.length;
    if (!s || !s.trend) return { state: null, label: '結構未成形', since: null, bars: null, watch: [], lastEvent: null, lastFake: null };
    const state = s.phase === 'balance' ? 'balance' : s.trend === 'up' ? 'bull' : 'bear';
    const watch = [];
    const add = (key, label, at, note) => { if (at && finite(at.price)) watch.push({ key, label, price: at.price, index: at.index, time: at.time, note }); };
    if (state === 'bull') {
      add('structureLow', '結構底', s.sLow, '跌破＝多空平衡');
      if (s.nextTop) add('nextTop', '頂分型高點', s.nextTop, '突破＝結構底上移');
      if (s.legHigh && (!s.nextTop || s.legHigh.price > s.nextTop.price)) add('priorHigh', '前高', s.legHigh, '這段的最高點');
    } else if (state === 'bear') {
      add('structureHigh', '結構頂', s.sHigh, '突破＝多空平衡');
      if (s.nextBottom) add('nextBottom', '底分型低點', s.nextBottom, '跌破＝結構頂下移');
      if (s.legLow && (!s.nextBottom || s.legLow.price < s.nextBottom.price)) add('priorLow', '前低', s.legLow, '這段的最低點');
    } else if (s.trend === 'up') {
      add('priorHigh', '前高', s.ref, '突破＝延續（回到極陽）');
      add('turnDown', '轉空位', s.turnDown, '跌破＝轉空（極陰）');
      add('brokenLow', '原結構底', s.broken, '已跌破');
    } else {
      add('priorLow', '前低', s.ref, '跌破＝延續（回到極陰）');
      add('turnUp', '轉多位', s.turnUp, '突破＝轉多（極陽）');
      add('brokenHigh', '原結構頂', s.broken, '已突破');
    }
    const lastEvent = result.events.filter(e => e.type !== 'fake').at(-1) || null;
    return {
      state, label: STATE_LABEL[state], from: s.phase === 'balance' ? (s.trend === 'up' ? 'bull' : 'bear') : null,
      since: s.since, sinceTime: bars[s.since]?.time ?? null, bars: n - 1 - s.since,
      structureLow: state === 'bull' ? s.sLow.price : null, structureHigh: state === 'bear' ? s.sHigh.price : null,
      brokenLevel: state === 'balance' ? s.broken?.price ?? null : null, priorLevel: state === 'balance' ? s.ref?.price ?? null : null,
      watch, lastEvent, lastFake: result.events.filter(e => e.type === 'fake').at(-1) || null
    };
  }

  // 每根 K 之前 14 根的平均真實波幅（只看過去，不含當根）。
  function rollingATR(bars, length = 14) {
    const out = new Array(bars.length).fill(0), tr = [];
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      out[i] = tr.length ? sum / tr.length : bars[i].high - bars[i].low;
      const t = i === 0 ? bars[0].high - bars[0].low : Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
      tr.push(t); sum += t;
      if (tr.length > length) sum -= tr.shift();
    }
    return out;
  }

  /* 裸 K 套保線與頂部確認（使用者定義）。
   * 上漲裸 K：每根 K 的低點都沒有跌破前一根的低點（影線即算），套保線＝前一根 K 的低點，
   *   一路往上移；某根跌破前一根低點＝裸 K 破。急漲後第一次破＝頂部確認。
   * 下跌裸 K 反過來（套保線＝前一根高點；急跌後第一次突破前一根高點＝底部確認）。
   * 急漲／急跌：裸 K 連續至少 minRun 根、這一段漲（跌）幅至少 fastATR 倍 ATR（以起漲前的 ATR 計），
   * 與雷達空單的急漲段同一個 ATR 門檻；雷達另外要求 4H 漲幅 15%，圖表各級別通用所以不套百分比。 */
  function nakedRuns(bars, { minRun = 3, fastATR = 5, lastOpen = false } = {}) {
    const n = Array.isArray(bars) ? bars.length : 0;
    const runs = [];
    if (n < minRun + 1 || !validBars(bars)) return { runs, current: { up: null, down: null } };
    const atrs = rollingATR(bars);
    for (const dir of ['up', 'down']) {
      const breaks = i => dir === 'up' ? bars[i].low < bars[i - 1].low : bars[i].high > bars[i - 1].high;
      let start = 0;
      for (let i = 1; i <= n; i++) {
        if (i < n && !breaks(i)) continue;
        const end = i - 1, count = end - start;
        if (count >= minRun) {
          let ext = start;
          for (let k = start; k <= end; k++) if (dir === 'up' ? bars[k].high > bars[ext].high : bars[k].low < bars[ext].low) ext = k;
          const base = dir === 'up' ? bars[start].low : bars[start].high, peak = dir === 'up' ? bars[ext].high : bars[ext].low;
          const a = atrs[start] || atrs[end] || 0, moveATR = a > 0 ? Math.abs(peak - base) / a : 0;
          const brokenAt = i < n ? i : null;
          runs.push({
            dir, from: start, to: end, count, base, peak, peakIndex: ext, moveATR, fast: moveATR >= fastATR,
            stops: Array.from({ length: count }, (_, k) => ({ index: start + 1 + k, time: bars[start + 1 + k].time, price: dir === 'up' ? bars[start + k].low : bars[start + k].high })),
            brokenAt, brokenTime: brokenAt == null ? null : bars[brokenAt].time, provisional: brokenAt != null && lastOpen && brokenAt === n - 1
          });
        }
        start = i;
      }
    }
    runs.sort((a, b) => a.from - b.from);
    // 目前還在進行的裸 K：套保位＝最後一根已收 K 的低點（上漲）／高點（下跌）。
    const ongoing = dir => {
      const run = runs.filter(r => r.dir === dir && r.brokenAt == null).at(-1);
      if (!run) return null;
      const ref = lastOpen ? n - 2 : n - 1;
      if (ref < run.from) return null;
      return { run, stop: dir === 'up' ? bars[ref].low : bars[ref].high, index: ref, time: bars[ref].time, count: run.count, fast: run.fast };
    };
    return { runs, current: { up: ongoing('up'), down: ongoing('down') } };
  }

  root.OXStructure = Object.freeze({ STRUCTURE_VERSION, STATE_LABEL, EVENT_LABEL, fractals, analyze, nakedRuns, rollingATR });
})(globalThis);
