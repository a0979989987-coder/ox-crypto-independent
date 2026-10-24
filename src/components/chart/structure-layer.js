/* 雙極結構指標：把 OXStructure（src/core/structure-engine.js）與 OXLiquidity（src/core/liquidity-engine.js）
 * 的判斷畫在主 K 線圖上。指標設定裡可各自開關：
 *   結構頂／底：多方結構底（實線）、空方結構頂（實線）、平衡時要收復的前高／前低（虛線）。
 *   頂／底分型：K 線上方／下方的小點。
 *   事件：平衡、延續、轉多、轉空；假突破／假跌破是影線尖端的小叉。
 *   狀態色帶：圖表最上方一條細色帶，極陽／平衡／極陰。
 *   裸 K 套保線：急漲／急跌段與目前這段的裸 K 階梯線；急漲後第一次破＝頂部確認（急跌後＝底部確認）。
 *   流動性地圖：上方／下方最近的牆（爆量起點、假突破點、更大級別長影線）與緩跌／緩漲燃料區。
 *   訂單塊／不平衡：不平衡缺口前那一根（高級訂單塊），未失效的才畫。
 *   多級別狀態：1H／4H／1D／1W 各自的極陽／平衡／極陰與套保位，點一下切換級別。
 * 結構只用目前圖表的 K 線；多級別與更大級別長影線另外以低優先權讀取同一檔的 Bitget K 線。
 * 最後一根未收 K 的事件標示為「未收 K」。
 */
(() => {
  'use strict';
  const LAYER_KEY = 'ox-structure-layers';
  const DEFAULT_LAYERS = Object.freeze({ lines: true, fractals: true, events: true, ribbon: true, naked: true, mtf: true, liquidity: true, blocks: false });
  const SHOWN_EVENTS = new Set(['balance', 'continue', 'reversal', 'fake']);
  const SHORT = Object.freeze({ balance: '平', continue: '續' });
  const MTF_FRAMES = Object.freeze(['1H', '4H', '1D', '1W']);
  const MTF_MAX_AGE = 3 * 60 * 1000;
  const LIVE_REFRESH_MS = 1000;
  const NEAREST = Object.freeze({ walls: 3, fuel: 2, blocks: 3 });
  let layers = readLayers();
  let model = null, modelKey = '', bars = [];
  let primitive = null, attachedTo = null, timer = 0, lastRun = 0;
  const mtf = new Map();
  let mtfSymbol = null, mtfLoading = null, mtfVersion = 0;

  function readLayers() {
    try { return { ...DEFAULT_LAYERS, ...JSON.parse(localStorage.getItem(LAYER_KEY) || '{}') }; } catch { return { ...DEFAULT_LAYERS }; }
  }
  function saveLayers() { try { localStorage.setItem(LAYER_KEY, JSON.stringify(layers)); } catch {} }
  const toggle = () => document.getElementById('chk-structure');
  // runtime-config.js 以 const 宣告 state（全域詞法綁定，不在 globalThis 上）。
  const chartState = () => typeof state === 'undefined' ? null : state;
  function enabled() {
    const s = chartState();
    return !!toggle()?.checked && !!s?.candleSeries && s.activeMarket === 'crypto' && !document.body.classList.contains('chart-focus');
  }
  const price = v => typeof fmtPrice === 'function' ? fmtPrice(v) : String(+Number(v).toPrecision(6));
  const secondsOf = frame => { try { return periods[frame] || 0; } catch { return 0; } };
  const isOpen = (list, frame) => { const last = list?.at(-1), s = secondsOf(frame); return !!last && s > 0 && (last.time + s) * 1000 > Date.now(); };
  const escapeText = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function palette() {
    const theme = globalThis.OXTheme?.current?.() || 'dark';
    const c = globalThis.OXTheme?.chart?.(theme) || {};
    const light = theme === 'light';
    return {
      up: c.up || '#00b8d4', down: c.down || '#ff3078', balance: light ? '#a87b17' : '#e6c76f', fuel: light ? '#b7791f' : '#f0b44c',
      text: light ? '#1f2937' : '#eef2f4', chip: light ? 'rgba(255,255,255,.94)' : 'rgba(13,16,19,.88)', wash: light ? .03 : .035
    };
  }
  function alpha(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---------- 計算 ----------
  function keyFor(list) {
    const s = chartState(), last = list.at(-1);
    return `${s?.symbol}:${s?.period}:${list.length}:${list[0]?.time}:${last?.time}:${last?.high}:${last?.low}:${last?.close}:${mtfVersion}`;
  }
  function largerFrames(period) {
    const own = secondsOf(period), s = chartState();
    return MTF_FRAMES.filter(f => secondsOf(f) > own).map(f => ({ frame: f, bars: mtf.get(s?.symbol + ':' + f)?.bars || [] })).filter(x => x.bars.length);
  }
  function compute(list) {
    const key = keyFor(list);
    if (key === modelKey && model) return model;
    const s = chartState(), period = s?.period, lastOpen = isOpen(list, period);
    bars = list;
    const analysis = globalThis.OXStructure?.analyze(list, { lastOpen }) || null;
    const naked = globalThis.OXStructure?.nakedRuns?.(list, { lastOpen }) || null;
    const liquidity = analysis && globalThis.OXLiquidity ? globalThis.OXLiquidity.map(list, { structure: analysis, larger: largerFrames(period), lastOpen, frame: period }) : null;
    model = { analysis, naked, liquidity };
    modelKey = key;
    // 目前圖表的級別直接用畫面上的 K 線更新多級別狀態（比另外讀的更即時）。
    if (MTF_FRAMES.includes(period) && analysis) mtf.set(s.symbol + ':' + period, { frame: period, at: Date.now(), bars: list, current: analysis.current, naked: naked?.current || null });
    return model;
  }

  // ---------- 多級別 ----------
  function summarize(list, frame) {
    const lastOpen = isOpen(list, frame);
    const analysis = globalThis.OXStructure.analyze(list, { lastOpen });
    return { frame, at: Date.now(), bars: list, current: analysis.current, naked: globalThis.OXStructure.nakedRuns(list, { lastOpen }).current };
  }
  function loadFrames() {
    const s = chartState(), symbol = s?.symbol;
    if (!symbol || !(layers.mtf || layers.liquidity) || typeof BitgetAPI === 'undefined') return null;
    if (mtfSymbol !== symbol) { mtf.clear(); mtfSymbol = symbol; }
    const stale = MTF_FRAMES.filter(f => f !== s.period && !(Date.now() - (mtf.get(symbol + ':' + f)?.at || 0) < MTF_MAX_AGE));
    if (!stale.length || mtfLoading) return mtfLoading;
    mtfLoading = Promise.all(stale.map(async frame => {
      try {
        const peek = BitgetAPI.peekCandles?.(symbol, frame, Date.now(), MTF_MAX_AGE);
        const list = peek?.candles?.length ? peek.candles : await BitgetAPI.fetchCandles(symbol, frame, 200, null, { owner: 'structure-mtf', priority: 30 });
        if (mtfSymbol !== symbol) return;
        mtf.set(symbol + ':' + frame, Array.isArray(list) && list.length >= 3 ? summarize(list, frame) : { frame, at: Date.now(), bars: [], current: null, naked: null, empty: true });
      } catch {
        if (mtfSymbol === symbol && !mtf.has(symbol + ':' + frame)) mtf.set(symbol + ':' + frame, { frame, at: Date.now(), bars: [], current: null, naked: null, failed: true });
      }
    })).finally(() => {
      mtfLoading = null;
      if (chartState()?.symbol === symbol) { mtfVersion++; refresh(); }
    });
    return mtfLoading;
  }

  // ---------- 繪圖（lightweight-charts 4.2 series primitive） ----------
  class StructureView {
    constructor(owner) { this.owner = owner; this.scene = null; }
    update() { this.scene = enabled() && model?.analysis ? scene(this.owner) : null; }
    zOrder() { return 'top'; }
    renderer() {
      const sc = this.scene;
      return { draw: target => drawScene(target, sc), drawBackground: target => drawBackground(target, sc) };
    }
  }
  class StructurePrimitive {
    constructor() { this.view = new StructureView(this); }
    attached({ chart, series, requestUpdate }) { this.chart = chart; this.series = series; this.requestUpdate = requestUpdate; }
    detached() { this.chart = null; this.series = null; this.requestUpdate = null; }
    updateAllViews() { this.view.update(); }
    paneViews() { return [this.view]; }
  }

  function scene(owner) {
    const ts = owner.chart?.timeScale(), series = owner.series, analysis = model.analysis;
    if (!ts || !series || !bars.length) return null;
    const firstTime = bars[0].time, lastTime = bars.at(-1).time;
    const x = time => ts.timeToCoordinate(time);
    // 起點早於圖表第一根（例如更大級別的影線）就從左緣畫起。
    const xFrom = time => time < firstTime ? -10 : x(time) ?? x(bars.find(c => c.time >= time)?.time ?? lastTime);
    const y = value => series.priceToCoordinate(value);
    const spacing = Math.max(1, ts.options().barSpacing || 6);
    const range = ts.getVisibleLogicalRange();
    const from = Math.max(0, Math.floor(range?.from ?? 0) - 2), to = Math.min(bars.length - 1, Math.ceil(range?.to ?? bars.length) + 2);
    const lastX = x(lastTime);
    const visible = i => i >= from && i <= to;
    const axis = document.querySelector('#chart .chart-price-axis');
    const legend = document.getElementById('chart-structure-legend');
    const out = { spacing, colors: palette(), lines: [], dots: [], tags: [], marks: [], runs: [], labels: [], steps: [], zones: [], walls: [],
      right: axis && axis.offsetParent ? axis.offsetWidth : 0,
      legend: legend && !legend.hidden ? { x: legend.offsetLeft - 4, y: legend.offsetTop - 4, w: legend.offsetWidth + 8, h: legend.offsetHeight + 8 } : null };
    const tag = (index, above, text, tone, rank, provisional = false) => {
      const bar = bars[index], ex = x(bar.time), hi = y(bar.high), lo = y(bar.low);
      if (ex == null || hi == null || lo == null) return;
      out.tags.push({ x: ex, high: hi, low: lo, above, text: text + (provisional ? '?' : ''), tone, provisional, rank, index });
    };

    if (layers.lines) {
      for (const s of analysis.segments) {
        const end = s.endIndex ?? bars.length - 1;
        if (end < from || s.index > to) continue;
        const x1 = x(s.time), x2 = s.endIndex == null ? (lastX ?? 0) + spacing * 3 : x(s.endTime), py = y(s.price);
        if (x1 == null || x2 == null || py == null) continue;
        out.lines.push({ kind: s.kind, x1, x2, y: py, active: s.endIndex == null });
        if (s.endIndex == null) out.labels.push({ kind: s.kind, x: (lastX ?? 0) + spacing * 1.5, y: py, text: segmentName(s) + ' ' + price(s.price) });
      }
    }
    if (layers.fractals) {
      for (const f of analysis.fractals) {
        if (!visible(f.index)) continue;
        const fx = x(f.time), fy = y(f.price);
        if (fx == null || fy == null) continue;
        out.dots.push({ type: f.type, x: fx, y: fy + (f.type === 'top' ? -6 : 6) });
      }
    }
    if (layers.events) {
      const lastMajor = analysis.events.filter(e => e.type !== 'fake' && SHOWN_EVENTS.has(e.type)).at(-1);
      for (const e of analysis.events) {
        if (!SHOWN_EVENTS.has(e.type) || !visible(e.index)) continue;
        const bar = bars[e.index], ex = x(e.time), above = e.dir === 'up';
        if (e.type === 'fake') {
          const tip = y(above ? bar.high : bar.low);
          if (ex != null && tip != null) out.marks.push({ x: ex, y: tip + (above ? -7 : 7), tone: tone(e) });
          continue;
        }
        // 轉多／轉空與最新一個事件寫全名；其餘在 K 線密集時縮成一個字，滑過或點一下看說明。
        const full = e.type === 'reversal' || e === lastMajor || spacing >= 9;
        tag(e.index, above, full ? e.label : SHORT[e.type] || e.label, tone(e), e.type === 'reversal' ? 0 : e === lastMajor ? 1 : 2, e.provisional);
      }
    }
    if (layers.naked && model.naked) {
      for (const run of model.naked.runs) {
        const ongoing = run.brokenAt == null;
        if (!(run.fast || ongoing) || run.to < from || run.from > to) continue;
        const pts = run.stops.map(s => ({ x: x(s.time), y: y(s.price) })).filter(p => p.x != null && p.y != null);
        if (pts.length) out.steps.push({ dir: run.dir, pts, ongoing, fast: run.fast });
        if (run.fast && run.brokenAt != null && visible(run.brokenAt))
          tag(run.brokenAt, run.dir === 'up', run.dir === 'up' ? '頂部確認' : '底部確認', run.dir === 'up' ? 'down' : 'up', 0, run.provisional);
      }
    }
    if (layers.liquidity && model.liquidity) {
      const live = model.liquidity.price;
      for (const dir of [1, -1]) {
        model.liquidity.walls.filter(w => w.dir === dir).sort((a, b) => Math.abs(a.price - live) - Math.abs(b.price - live)).slice(0, NEAREST.walls).forEach(w => {
          const wy = y(w.price), wx = xFrom(w.time);
          if (wy != null && wx != null) out.walls.push({ dir, x: wx, y: wy, text: '牆 ' + w.sources.join('＋') });
        });
        model.liquidity.fuel.filter(f => f.dir === dir).sort((a, b) => Math.abs((a.top + a.bottom) / 2 - live) - Math.abs((b.top + b.bottom) / 2 - live)).slice(0, NEAREST.fuel).forEach(f => {
          const top = y(f.top), bottom = y(f.bottom), fx = xFrom(f.from);
          if (top != null && bottom != null && fx != null) out.zones.push({ kind: 'fuel', x: fx, top, bottom, text: f.label });
        });
      }
    }
    if (layers.blocks && model.liquidity) {
      const live = model.liquidity.price;
      for (const role of ['resistance', 'support']) {
        model.liquidity.blocks.filter(b => b.role === role).sort((a, b) => Math.abs((a.block.top + a.block.bottom) / 2 - live) - Math.abs((b.block.top + b.block.bottom) / 2 - live)).slice(0, NEAREST.blocks).forEach(b => {
          const top = y(b.block.top), bottom = y(b.block.bottom), bx = x(b.block.time);
          if (top == null || bottom == null || bx == null) return;
          out.zones.push({ kind: role, x: bx - spacing / 2, top, bottom, text: '訂單塊' });
          const g1 = x(b.gap.from), g2 = x(b.gap.to), gt = y(b.gap.top), gb = y(b.gap.bottom);
          if (g1 != null && g2 != null && gt != null && gb != null) out.zones.push({ kind: 'gap', x: g1, x2: g2, top: gt, bottom: gb, role });
        });
      }
    }
    if (layers.ribbon) {
      let start = from, current = analysis.states[from];
      for (let i = from + 1; i <= to + 1; i++) {
        const s = i <= to ? analysis.states[i] : undefined;
        if (s === current && i <= to) continue;
        const a = x(bars[start].time), b = x(bars[i - 1].time);
        if (current && a != null && b != null) out.runs.push({ state: current, x1: a - spacing / 2, x2: b + spacing / 2 });
        start = i; current = s;
      }
    }
    out.tags.sort((a, b) => a.rank - b.rank || b.index - a.index);
    return out;
  }
  const segmentName = s => s.kind === 'low' ? '結構底' : s.kind === 'high' ? '結構頂' : s.side === 'high' ? '前高' : '前低';
  function tone(e) {
    if (e.type === 'balance') return 'balance';
    if (e.type === 'fake') return e.dir === 'up' ? 'down' : 'up';
    return e.dir === 'up' ? 'up' : 'down';
  }
  const colorOf = (colors, key) => ['up', 'low', 'bull', 'support'].includes(key) ? colors.up : ['down', 'high', 'bear', 'resistance'].includes(key) ? colors.down : key === 'fuel' ? colors.fuel : colors.balance;

  function drawBackground(target, sc) {
    if (!sc) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const width = mediaSize.width - sc.right;
      for (const r of sc.runs) {
        const color = colorOf(sc.colors, r.state);
        ctx.fillStyle = alpha(color, sc.colors.wash * (r.state === 'balance' ? .8 : 1));
        ctx.fillRect(r.x1, 0, r.x2 - r.x1, mediaSize.height);
        ctx.fillStyle = alpha(color, .85);
        ctx.fillRect(r.x1, 0, r.x2 - r.x1, 3);
      }
      // 燃料區、訂單塊畫在 K 線後面，延伸到右邊。
      for (const z of sc.zones) {
        const top = Math.min(z.top, z.bottom), h = Math.max(1, Math.abs(z.bottom - z.top));
        if (z.kind === 'gap') {
          ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = alpha(colorOf(sc.colors, z.role), .55); ctx.lineWidth = 1;
          ctx.strokeRect(z.x, top, Math.max(2, z.x2 - z.x), h); ctx.restore();
          continue;
        }
        const color = colorOf(sc.colors, z.kind), left = Math.max(0, z.x);
        ctx.fillStyle = alpha(color, z.kind === 'fuel' ? .06 : .12);
        ctx.fillRect(left, top, Math.max(0, width - left), h);
        ctx.fillStyle = alpha(color, .5);
        ctx.fillRect(left, top, 2, h);
      }
    });
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  const overlapsRect = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  function drawScene(target, sc) {
    if (!sc) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const colors = sc.colors, width = mediaSize.width - sc.right;
      ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif';
      ctx.textBaseline = 'middle';
      for (const l of sc.lines) {
        ctx.save();
        ctx.strokeStyle = alpha(colorOf(colors, l.kind), l.active ? .95 : .5);
        ctx.lineWidth = l.active ? 1.6 : 1.1;
        ctx.setLineDash(l.kind === 'ref' ? [5, 4] : []);
        ctx.beginPath(); ctx.moveTo(l.x1, Math.round(l.y) + .5); ctx.lineTo(Math.min(l.x2, width), Math.round(l.y) + .5); ctx.stroke();
        ctx.restore();
      }
      // 裸 K 套保線：每根 K 下方（上方）一小段，等於前一根的低點（高點）。
      for (const st of sc.steps) {
        ctx.save();
        ctx.strokeStyle = alpha(colorOf(colors, st.dir), st.ongoing ? .95 : .6); ctx.lineWidth = st.ongoing ? 1.6 : 1.2;
        ctx.beginPath();
        st.pts.forEach((p, k) => {
          const l = p.x - sc.spacing / 2, r = Math.min(width, p.x + sc.spacing / 2);
          if (k === 0) ctx.moveTo(l, p.y); else ctx.lineTo(l, p.y);
          ctx.lineTo(r, p.y);
        });
        ctx.stroke(); ctx.restore();
      }
      // 牆：從形成處畫到右緣，標示來源。
      for (const w of sc.walls) {
        const color = colorOf(colors, w.dir === 1 ? 'down' : 'up'), wy = Math.round(w.y) + .5, left = Math.max(0, w.x);
        ctx.save(); ctx.strokeStyle = alpha(color, .75); ctx.lineWidth = 2; ctx.setLineDash([8, 3]);
        ctx.beginPath(); ctx.moveTo(left, wy); ctx.lineTo(width, wy); ctx.stroke(); ctx.restore();
        const tw = Math.ceil(ctx.measureText(w.text).width) + 10, h = 14, lx = Math.max(2, width - tw - 4);
        let ly = wy + (w.dir === 1 ? -h - 2 : 2);
        const box = top => ({ x: lx, y: top, w: tw, h });
        if (sc.legend && overlapsRect(box(ly), sc.legend)) ly = wy + (w.dir === 1 ? 2 : -h - 2);
        if (sc.legend && overlapsRect(box(ly), sc.legend)) continue;
        ctx.fillStyle = colors.chip; roundRect(ctx, lx, ly, tw, h, 4); ctx.fill();
        ctx.fillStyle = color; ctx.fillText(w.text, lx + 5, ly + h / 2 + .5);
      }
      const zoneLabels = [];
      for (const z of sc.zones) {
        if (z.kind === 'gap' || !z.text) continue;
        const top = Math.min(z.top, z.bottom), h = Math.abs(z.bottom - z.top);
        const rect = { x: Math.max(4, z.x + 5), y: top + Math.min(h / 2, 9) - 6, w: ctx.measureText(z.text).width, h: 12 };
        if (h < 10 || z.x > width - 40 || zoneLabels.some(p => overlapsRect(rect, p)) || (sc.legend && overlapsRect(rect, sc.legend))) continue;
        zoneLabels.push(rect);
        ctx.fillStyle = alpha(colorOf(colors, z.kind), .9);
        ctx.fillText(z.text, rect.x, rect.y + 6);
      }
      const r = sc.spacing < 4 ? 1.4 : 2;
      for (const d of sc.dots) {
        ctx.fillStyle = alpha(d.type === 'top' ? colors.down : colors.up, .78);
        ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, Math.PI * 2); ctx.fill();
      }
      // 假突破／假跌破：影線尖端的小叉。
      for (const m of sc.marks) {
        ctx.save(); ctx.strokeStyle = colorOf(colors, m.tone); ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(m.x - 3, m.y - 3); ctx.lineTo(m.x + 3, m.y + 3); ctx.moveTo(m.x + 3, m.y - 3); ctx.lineTo(m.x - 3, m.y + 3); ctx.stroke();
        ctx.restore();
      }
      // 事件標籤：重要的先放，重疊時往外推開；碰到左上角狀態列或圖表邊緣就改放 K 線另一側。
      const placed = [];
      const overlaps = overlapsRect;
      const hits = rect => placed.some(p => overlaps(rect, p));
      const blocked = rect => rect.y < 2 || rect.y + rect.h > mediaSize.height - 2 || (sc.legend && overlaps(rect, sc.legend));
      for (const t of sc.tags) {
        const color = colorOf(colors, t.tone), w = Math.ceil(ctx.measureText(t.text).width) + 10, h = 15;
        const layout = above => {
          const step = above ? -1 : 1, base = above ? t.high : t.low;
          const rect = { x: Math.max(2, Math.min(width - w - 2, t.x - w / 2)), y: base + step * 12 - h / 2, w, h, above, base };
          for (let k = 0; k < 6 && hits(rect); k++) rect.y += step * (h + 2);
          return rect;
        };
        let rect = layout(t.above);
        if (blocked(rect)) { const other = layout(!t.above); if (!blocked(other)) rect = other; }
        placed.push(rect);
        const step = rect.above ? -1 : 1;
        ctx.save();
        ctx.strokeStyle = alpha(color, .45); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(t.x, rect.base + step * 2); ctx.lineTo(t.x, rect.above ? rect.y + h : rect.y); ctx.stroke();
        ctx.fillStyle = colors.chip; roundRect(ctx, rect.x, rect.y, w, h, 7); ctx.fill();
        ctx.strokeStyle = alpha(color, .9); ctx.setLineDash(t.provisional ? [3, 2] : []); ctx.stroke();
        ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(t.text, rect.x + w / 2, rect.y + h / 2 + .5);
        ctx.restore();
      }
      ctx.textAlign = 'left';
      // 結構線標價：只畫在最新 K 線右邊的空白處；放不下就不畫（左上角狀態列已有價位）。
      for (const l of sc.labels) {
        const color = colorOf(colors, l.kind), w = Math.ceil(ctx.measureText(l.text).width) + 10, h = 15;
        if (l.x + w > width - 4) continue;
        ctx.fillStyle = colors.chip; roundRect(ctx, l.x, l.y - h - 2, w, h, 4); ctx.fill();
        ctx.fillStyle = color; ctx.fillText(l.text, l.x + 5, l.y - h / 2 - 1.5);
      }
    });
  }

  // ---------- 狀態列與說明 ----------
  function legendHost() {
    const chart = document.getElementById('chart');
    if (!chart) return null;
    let host = document.getElementById('chart-structure-legend');
    if (!host) {
      host = document.createElement('div');
      host.id = 'chart-structure-legend';
      host.className = 'chart-structure-legend';
      host.hidden = true;
      host.addEventListener('click', event => {
        const chip = event.target.closest('[data-structure-frame]');
        if (!chip) return;
        const button = document.querySelector(`#chart-timeframe-strip .btn-tf[data-tf="${chip.dataset.structureFrame}"]`);
        if (button && !button.classList.contains('active')) button.click();
      });
      chart.append(host);
    }
    return host;
  }
  const level = (label, value, note) => `<span class="sl-level" title="${escapeText(note || '')}"><i>${escapeText(label)}</i>${escapeText(price(value))}</span>`;
  function renderLegend() {
    const host = legendHost();
    if (!host) return;
    const current = model?.analysis?.current;
    if (!enabled() || !current) { host.hidden = true; return; }
    const s = chartState();
    const since = current.state && Number.isFinite(current.bars) ? (current.bars === 0 ? '本根' : current.bars + ' 根') : '';
    const from = current.from === 'bull' ? '多方跌破結構底' : current.from === 'bear' ? '空方突破結構頂' : '';
    const parts = current.watch.map(w => level(w.label, w.price, w.note));
    const run = model.naked?.current;
    if (layers.naked && run) {
      const side = current.state === 'bear' ? run.down : current.state === 'bull' ? run.up : run.up || run.down;
      if (side) parts.push(level((side === run.up ? '多單' : '空單') + '套保', side.stop, `裸 K 連續 ${side.count} 根${side.fast ? '（急' + (side === run.up ? '漲' : '跌') + '）' : ''}；${side === run.up ? '跌破' : '突破'}這根就是裸 K 破`));
    }
    if (layers.liquidity && model.liquidity && globalThis.OXLiquidity) {
      const dir = current.state === 'bear' ? -1 : 1, room = globalThis.OXLiquidity.room(model.liquidity, dir);
      if (room?.wall) parts.push(`<span class="sl-level" title="${escapeText(room.wall.sources.join('、'))}"><i>${dir === 1 ? '上方牆' : '下方牆'}</i>${escapeText(price(room.wall.price))}<small>${dir === 1 ? '+' : '−'}${(room.distance * 100).toFixed(1)}%${room.fuel ? ' · 燃料 ' + room.fuel : ''}</small></span>`);
    }
    let mtfRow = '';
    if (layers.mtf) {
      const chips = MTF_FRAMES.map(f => {
        const row = mtf.get(s?.symbol + ':' + f), cur = row?.current, active = f === s?.period;
        const label = row?.failed ? '讀取失敗' : row?.empty ? '無資料' : cur ? cur.label : '…';
        const run = row?.naked, stop = cur?.state === 'bear' ? run?.down : run?.up;
        const title = cur ? `${f} ${cur.label}${cur.watch[0] ? '，' + cur.watch[0].label + ' ' + price(cur.watch[0].price) : ''}${stop ? '，套保 ' + price(stop.stop) : ''}` : `${f} 讀取中`;
        const short = cur ? { bull: '陽', balance: '平', bear: '陰' }[cur.state] || '—' : row?.failed || row?.empty ? '—' : '…';
        return `<button type="button" class="sl-frame is-${cur?.state || 'none'}${active ? ' is-active' : ''}" data-structure-frame="${f}" aria-pressed="${active}" aria-label="${escapeText(title)}" title="${escapeText(title)}"><i>${f}</i><span class="sl-full">${escapeText(label)}</span><span class="sl-short" aria-hidden="true">${escapeText(short)}</span></button>`;
      }).join('');
      mtfRow = `<span class="sl-mtf" role="group" aria-label="多級別結構狀態">${chips}</span>`;
    }
    const className = `chart-structure-legend is-${current.state || 'none'}`;
    const html = `<span class="sl-row"><span class="sl-head"><b>${escapeText(current.label)}</b><small>${escapeText([s?.period, from, since].filter(Boolean).join(' · '))}</small></span>${parts.join('')}</span>${mtfRow}`;
    // 即時行情每秒刷新：內容沒變就不重畫，避免按鈕閃動、鍵盤焦點跑掉。
    if (host.className !== className) host.className = className;
    if (host.__oxHtml !== html) { host.innerHTML = html; host.__oxHtml = html; }
    host.hidden = false;
  }

  const EXPLAIN = {
    'balance:down': e => `平衡：跌破結構底 ${price(e.level)}（影線即算），還不是轉空。重新突破前高 ${price(e.prior)}＝延續。`,
    'balance:up': e => `平衡：突破結構頂 ${price(e.level)}（影線即算），還不是轉多。重新跌破前低 ${price(e.prior)}＝延續。`,
    'continue:up': e => `延續：重新突破前高 ${price(e.level)}，回到極陽。新結構底 ${price(e.structure)}。`,
    'continue:down': e => `延續：重新跌破前低 ${price(e.level)}，回到極陰。新結構頂 ${price(e.structure)}。`,
    'reversal:up': e => `轉多：平衡後回調低點墊高，突破頂分型高點 ${price(e.level)}。新結構底 ${price(e.structure)}。`,
    'reversal:down': e => `轉空：平衡後反彈高點降低，跌破底分型低點 ${price(e.level)}。新結構頂 ${price(e.structure)}。`,
    'fake:up': e => `假突破：突破 ${price(e.level)} 後收回，接著跌破這根 K 的低點。`,
    'fake:down': e => `假跌破：跌破 ${price(e.level)} 後收回，接著突破這根 K 的高點。`
  };
  function explainAt(time) {
    const analysis = model?.analysis;
    if (!analysis || !enabled()) return null;
    const index = bars.findIndex(c => c.time === time);
    if (index < 0) return null;
    const lines = [];
    if (layers.events) for (const e of analysis.events) if (e.index === index && SHOWN_EVENTS.has(e.type)) lines.push((EXPLAIN[e.type + ':' + e.dir]?.(e) || e.label) + (e.provisional ? '（未收 K）' : ''));
    if (layers.naked) for (const r of model.naked?.runs || []) if (r.fast && r.brokenAt === index)
      lines.push(`${r.dir === 'up' ? '頂部確認：急漲' : '底部確認：急跌'} ${r.moveATR.toFixed(1)} ATR、裸 K ${r.count} 根沒破，這根第一次${r.dir === 'up' ? '跌破前一根低點' : '突破前一根高點'}${r.provisional ? '（未收 K）' : ''}。`);
    if (layers.fractals) for (const f of analysis.fractals) if (f.index === index) lines.push(`${f.type === 'top' ? '頂分型' : '底分型'} ${price(f.price)}：${f.confirmedIndex - f.index} 根後${f.type === 'top' ? '跌破這根低點' : '突破這根高點'}確認`);
    if (layers.blocks) for (const b of model.liquidity?.blocks || []) if (b.block.index === index)
      lines.push(`高級訂單塊（${b.role === 'resistance' ? '壓力／多單目標' : '支撐／空單目標'}）${price(b.block.bottom)}–${price(b.block.top)}：後面留下不平衡缺口，證明這根的力道。`);
    return lines.length ? lines : null;
  }
  function tooltip() {
    const chart = document.getElementById('chart');
    if (!chart) return null;
    let tip = document.getElementById('ox-structure-tooltip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'ox-structure-tooltip'; tip.className = 'ox-indicator-tooltip ox-structure-tooltip'; chart.append(tip); }
    return tip;
  }
  function showTip(param, sticky) {
    const lines = param?.time && param.point ? explainAt(param.time) : null;
    const tip = tooltip();
    if (!tip) return;
    if (!lines) { if (!sticky) tip.classList.remove('show'); return; }
    const chart = document.getElementById('chart');
    tip.textContent = lines.join('\n');
    tip.classList.add('show');
    const w = Math.min(260, chart.clientWidth - 16);
    const left = Math.max(8, Math.min(chart.clientWidth - w - 8, param.point.x + 12));
    const top = Math.max(8, Math.min(chart.clientHeight - 90, param.point.y + 14));
    tip.style.maxWidth = w + 'px';
    tip.style.transform = `translate3d(${left}px,${top}px,0)`;
    if (sticky) { clearTimeout(showTip.timer); showTip.timer = setTimeout(() => tip.classList.remove('show'), 3200); }
  }

  // ---------- 生命週期 ----------
  function attach() {
    const s = chartState();
    if (!s?.candleSeries || attachedTo === s.candleSeries) return !!primitive;
    if (typeof s.candleSeries.attachPrimitive !== 'function') return false;
    primitive = new StructurePrimitive();
    s.candleSeries.attachPrimitive(primitive);
    attachedTo = s.candleSeries;
    if (s.chart && !s.chart.__oxStructureTips) {
      s.chart.__oxStructureTips = true;
      s.chart.subscribeCrosshairMove(param => { if (matchMedia('(hover:hover) and (pointer:fine)').matches) showTip(param, false); });
      s.chart.subscribeClick(param => showTip(param, true));
    }
    return true;
  }
  function repaint() { primitive?.requestUpdate?.(); renderLegend(); }
  function refresh(list = chartState()?.candleData) {
    clearTimeout(timer); timer = 0;
    if (!attach()) return null;
    if (enabled() && Array.isArray(list) && list.length) { compute(list); loadFrames(); }
    lastRun = Date.now();
    repaint();
    return model?.analysis || null;
  }
  function schedule() {
    if (!enabled() || timer) return;
    timer = setTimeout(() => { timer = 0; refresh(); }, Math.max(0, LIVE_REFRESH_MS - (Date.now() - lastRun)));
  }
  function syncLayerInputs() {
    const box = document.getElementById('chart-structure-layers');
    if (box) box.hidden = !toggle()?.checked;
    document.querySelectorAll('[data-structure-layer]').forEach(input => { input.checked = !!layers[input.dataset.structureLayer]; });
  }
  function bind() {
    toggle()?.addEventListener('change', () => { syncLayerInputs(); refresh(); });
    document.querySelectorAll('[data-structure-layer]').forEach(input => input.addEventListener('change', () => {
      layers = { ...layers, [input.dataset.structureLayer]: input.checked };
      saveLayers(); modelKey = ''; refresh();
    }));
    document.addEventListener('ox:chartdata', schedule);
    document.addEventListener('ox:themechange', repaint);
    syncLayerInputs();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true }); else bind();

  globalThis.OXStructureLayer = Object.freeze({
    refresh, repaint, enabled,
    current: () => model?.analysis?.current || null,
    analysis: () => model?.analysis || null,
    model: () => model,
    frames: () => Object.fromEntries(MTF_FRAMES.map(f => [f, mtf.get(chartState()?.symbol + ':' + f)?.current || null])),
    layers: () => ({ ...layers })
  });
})();
