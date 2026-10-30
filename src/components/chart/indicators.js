/* Technical indicators on the Crypto K-line chart (ported from OX 台股's 盤面).
   均線 and 布林 are drawn on the candles; KD, RSI, MACD and CCI each get a small
   pane under the volume, on the same bars, with its own scale. Every indicator has
   a name tag; tapping it opens a parameter sheet sized for phones. The settings
   sheet (指標與篩選) starts with the K 線／線圖 switch and lists the indicators
   with their parameters.

   Choices persist on this device under STORAGE_KEY as
   {v:1,on:{ma,bb,kd,rsi,macd,cci:boolean},params:{<id>:[numbers]}} (params only for
   indicators the user changed). window.OXChartIndicators.get()/set(next) read and
   replace them for a later account sync; set() announces CHANGE_EVENT.
   K 線 or 線圖 is kept under STYLE_KEY ('candle' | 'line'). In 線圖 the candles stay
   on the chart (levels, scaling and markers hang on them) but are drawn invisible
   under a close-price line; setStyle() announces STYLE_EVENT. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'ox-crypto:chart-indicators-v1';
  const CHANGE_EVENT = 'ox:chart-indicators-change';
  const STYLE_KEY = 'ox-crypto:chart-style-v1', STYLE_EVENT = 'ox:chart-style-change';
  const INDICATORS = Object.freeze({
    ma: Object.freeze({ name: '均線', overlay: true, params: [['短', 5], ['中', 20], ['長', 60]] }),
    bb: Object.freeze({ name: '布林', overlay: true, params: [['週期', 20], ['倍數', 2]] }),
    kd: Object.freeze({ name: 'KD', params: [['週期', 9], ['K', 3], ['D', 3]] }),
    rsi: Object.freeze({ name: 'RSI', params: [['短', 6], ['長', 14]] }),
    macd: Object.freeze({ name: 'MACD', params: [['快', 12], ['慢', 26], ['訊號', 9]] }),
    cci: Object.freeze({ name: 'CCI', params: [['週期', 14]] })
  });
  const IDS = Object.keys(INDICATORS), PANES = ['kd', 'rsi', 'macd', 'cci'];
  // Dashed reference lines in each pane; LABELS are the ones named on the right edge
  // (CCI's 0 line stays unnamed so its short pane is not crowded).
  const LEVELS = { kd: [80, 20], rsi: [70, 30], macd: [0], cci: [100, 0, -100] };
  const LABELS = { kd: [80, 20], rsi: [70, 30], macd: [0], cci: [100, -100] };

  // ---- calculations (null until enough bars) ----
  function sma(values, n) {
    let sum = 0;
    return values.map((v, i) => { sum += v; if (i >= n) sum -= values[i - n]; return i >= n - 1 ? sum / n : null; });
  }
  function ema(values, n) {
    const k = 2 / (n + 1); let prev = null, seen = 0, seed = 0;
    return values.map(v => {
      if (v === null || v === undefined) return null;
      if (prev === null) { seen++; seed += v; if (seen < n) return null; prev = seed / n; return prev; }
      prev = v * k + prev * (1 - k); return prev;
    });
  }
  function bollinger(closes, n, mult) {
    const mid = sma(closes, n);
    return mid.map((m, i) => {
      if (m === null) return null;
      let sq = 0; for (let j = i - n + 1; j <= i; j++) sq += (closes[j] - m) ** 2;
      const sd = Math.sqrt(sq / n);
      return { mid: m, up: m + mult * sd, low: m - mult * sd };
    });
  }
  // Taiwan KD: RSV over n bars, K and D smoothed with 1/k and 1/d weights from 50.
  function kd(candles, n, kp, dp) {
    let k = 50, d = 50;
    return candles.map((c, i) => {
      if (i < n - 1) return null;
      let hi = -Infinity, lo = Infinity;
      for (let j = i - n + 1; j <= i; j++) { if (candles[j].high > hi) hi = candles[j].high; if (candles[j].low < lo) lo = candles[j].low; }
      const rsv = hi === lo ? 50 : (c.close - lo) / (hi - lo) * 100;
      k = ((kp - 1) * k + rsv) / kp; d = ((dp - 1) * d + k) / dp;
      return { k, d };
    });
  }
  // Wilder RSI.
  function rsi(closes, n) {
    let gain = 0, loss = 0;
    return closes.map((v, i) => {
      if (i === 0) return null;
      const ch = v - closes[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
      if (i <= n) { gain += g; loss += l; if (i < n) return null; gain /= n; loss /= n; }
      else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; }
      return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    });
  }
  // CCI = (typical price − its n-bar average) ÷ (0.015 × mean absolute deviation).
  function cci(candles, n) {
    const tp = candles.map(c => (c.high + c.low + c.close) / 3);
    return tp.map((v, i) => {
      if (i < n - 1) return null;
      let sum = 0;
      for (let j = i - n + 1; j <= i; j++) sum += tp[j];
      const avg = sum / n;
      let dev = 0;
      for (let j = i - n + 1; j <= i; j++) dev += Math.abs(tp[j] - avg);
      dev /= n;
      return dev === 0 ? 0 : (v - avg) / (0.015 * dev);
    });
  }
  // DIF = EMA(fast) − EMA(slow); MACD = EMA(DIF, signal); OSC = DIF − MACD.
  function macd(closes, fast, slow, signal) {
    const f = ema(closes, fast), s = ema(closes, slow), dif = f.map((v, i) => v === null || s[i] === null ? null : v - s[i]);
    const sig = ema(dif, signal);
    return dif.map((v, i) => v === null || sig[i] === null ? null : { dif: v, macd: sig[i], osc: v - sig[i] });
  }

  // ---- settings ----
  const defaults = id => INDICATORS[id].params.map(([, value]) => value);
  const decimal = (id, i) => id === 'bb' && i === 1;
  function validParam(id, i, value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return false;
    return decimal(id, i) ? v >= 0.1 && v <= 10 : Number.isInteger(v) && v >= 1 && v <= 500;
  }
  function cleanParam(id, i, value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return null;
    return decimal(id, i) ? Math.min(10, Math.max(0.1, Math.round(v * 10) / 10)) : Math.min(500, Math.max(1, Math.round(v)));
  }
  function normalize(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const on = {}, params = {};
    for (const id of IDS) {
      on[id] = value.on?.[id] === true;
      const list = value.params?.[id];
      if (Array.isArray(list) && list.length === INDICATORS[id].params.length && list.every((v, i) => validParam(id, i, v))) {
        const numbers = list.map(Number);
        if (numbers.some((v, i) => v !== defaults(id)[i])) params[id] = numbers;
      }
    }
    return { v: 1, on, params };
  }
  const storage = () => { try { return root.localStorage || null; } catch { return null; } };
  function read() { try { return normalize(JSON.parse(storage()?.getItem(STORAGE_KEY) || 'null')); } catch { return normalize(null); } }
  let saved = read();
  const paramsOf = (id, settings = saved) => settings.params?.[id]?.slice() || defaults(id);
  function get() { return JSON.parse(JSON.stringify(saved)); }
  function set(next) {
    const value = next && typeof next === 'object' ? next : {};
    saved = normalize({ on: { ...saved.on, ...(value.on || {}) }, params: { ...saved.params, ...(value.params || {}) } });
    for (const [id, list] of Object.entries(value.params || {})) if (list === null) delete saved.params[id];
    try { storage()?.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch {}
    controller?.apply();
    syncSettings();
    try { root.document?.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: get() })); } catch {}
    return get();
  }

  // ---- K 線／線圖 ----
  const readStyle = () => { try { return storage()?.getItem(STYLE_KEY) === 'line' ? 'line' : 'candle'; } catch { return 'candle'; } };
  let chartStyle = readStyle();
  function getStyle() { return chartStyle; }
  function setStyle(next) {
    chartStyle = next === 'line' ? 'line' : 'candle';
    try { storage()?.setItem(STYLE_KEY, chartStyle); } catch {}
    controller?.applyStyle();
    syncSettings();
    try { root.document?.dispatchEvent(new CustomEvent(STYLE_EVENT, { detail: chartStyle })); } catch {}
    return chartStyle;
  }

  // ---- helpers ----
  const light = () => !!root.document?.body?.classList.contains('theme-light');
  function palette() {
    return light()
      ? { bg: '#ffffff', lines: ['#c18a14', '#2f7fd0', '#8e5cc4'], band: '#8792a0', level: 'rgba(55,65,81,.28)', up: '#4598df', down: '#e86480' }
      : { bg: '#121417', lines: ['#f5c451', '#6ec1ff', '#c792ea'], band: '#9aa3ad', level: 'rgba(255,255,255,.2)', up: '#00b8d4', down: '#ff3078' };
  }
  // KD and RSI run 0–100; MACD follows the coin's price, so it keeps about three significant digits.
  const fmtOsc = v => Number.isFinite(v) ? v.toFixed(2) : '—';
  function fmt(v) {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a === 0) return '0';
    return v.toFixed(Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(a)))));
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paramText = (id, settings = saved) => paramsOf(id, settings).join(id === 'ma' ? ' · ' : ', ');
  const paramShort = id => paramsOf(id).join(',');

  // ---- chart controller (one main K-line chart per page) ----
  let controller = null;
  function attach(options) { controller?.destroy(); controller = createController(options); return controller; }

  function createController({ chart, container, getCandles, candleSeries = null, volumeVisible = () => true, baseMargins, onLayout = () => {}, isMobile = () => root.matchMedia?.('(max-width:720px)').matches }) {
    const lib = root.LightweightCharts, doc = root.document;
    const overlays = new Map(), panes = new Map();
    let lineSeries = null, candleColors = null;
    let candles = [], values = new Map(), dataKey = '', hoverIndex = null, reserved = 0, frame = 0, destroyed = false;
    const legend = doc.createElement('div'); legend.className = 'ox-ind-legend';
    const stack = doc.createElement('div'); stack.className = 'ox-ind-stack'; stack.hidden = true;
    container.append(stack, legend);
    const fixed = () => ({ priceRange: { minValue: 0, maxValue: 100 } });

    function makeOverlay(id) {
      const p = palette(), line = color => chart.addLineSeries({ color, lineWidth: 1, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });
      return id === 'ma' ? p.lines.map(line) : [line(p.band), line(p.lines[1]), line(p.band)];
    }
    function makePane(id) {
      const p = palette(), box = doc.createElement('div'), host = doc.createElement('div'), marks = doc.createElement('div');
      box.className = 'ox-ind-pane'; box.dataset.indicator = id; host.className = 'ox-ind-pane-chart'; marks.className = 'ox-ind-marks';
      const tag = makeTag(id); box.append(host, marks, tag); stack.append(box);
      // A pane gets its width after it is attached (late in WebKit); keep it on the main chart's bars.
      paneSize.observe(host);
      const sub = lib.createChart(host, {
        autoSize: true,
        layout: { background: { type: 'solid', color: p.bg }, textColor: light() ? '#616d7c' : '#929995', fontSize: 10, attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        rightPriceScale: { visible: false, scaleMargins: { top: .3, bottom: .1 } }, leftPriceScale: { visible: false },
        timeScale: { visible: false, lockVisibleTimeRangeOnResize: true }, handleScroll: false, handleScale: false,
        crosshair: { mode: 0, vertLine: { visible: true, labelVisible: false, style: 3, color: light() ? 'rgba(55,65,81,.35)' : 'rgba(255,255,255,.3)' }, horzLine: { visible: false, labelVisible: false } }
      });
      const line = (color, extra = {}) => sub.addLineSeries({ color, lineWidth: 1, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, ...extra });
      const series = id === 'macd'
        ? [sub.addHistogramSeries({ priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false }), line(p.lines[0]), line(p.lines[1])]
        : id === 'kd' ? [line(p.lines[0], { autoscaleInfoProvider: fixed }), line(p.lines[1], { autoscaleInfoProvider: fixed })]
          : id === 'cci' ? [line(p.lines[0])]
            : [line(p.lines[0], { autoscaleInfoProvider: fixed }), line(p.lines[2], { autoscaleInfoProvider: fixed })];
      const anchor = series[id === 'macd' ? 1 : 0];
      const levels = LEVELS[id].map(price => anchor.createPriceLine({ price, color: p.level, lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
      return { box, host, marks, tag, chart: sub, series, anchor, levels };
    }
    function makeTag(id) {
      const tag = doc.createElement('button');
      tag.type = 'button'; tag.className = 'ox-ind-tag'; tag.dataset.indicatorEdit = id;
      return tag;
    }
    function renderTag(id, tag) {
      const p = palette(), def = INDICATORS[id], v = values.get(id), at = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < candles.length ? hoverIndex : candles.length - 1;
      const point = v?.[at];
      let readout = '';
      if (id === 'ma') readout = paramsOf(id).map((n, i) => `<i style="color:${p.lines[i]}">${n}</i>`).join('');
      else if (id === 'bb') readout = `<i>${paramShort(id)}</i>`;
      else if (id === 'kd') readout = point ? `<i style="color:${p.lines[0]}">${fmtOsc(point.k)}</i><i style="color:${p.lines[1]}">${fmtOsc(point.d)}</i>` : '';
      else if (id === 'rsi') readout = point ? `<i style="color:${p.lines[0]}">${fmtOsc(point[0])}</i><i style="color:${p.lines[2]}">${fmtOsc(point[1])}</i>` : '';
      else if (id === 'macd') readout = point ? `<i style="color:${p.lines[0]}">${fmt(point.dif)}</i><i style="color:${p.lines[1]}">${fmt(point.macd)}</i><i style="color:${point.osc >= 0 ? p.up : p.down}">${fmt(point.osc)}</i>` : '';
      else if (id === 'cci') readout = Number.isFinite(point) ? `<i style="color:${p.lines[0]}">${fmtOsc(point)}</i>` : '';
      const params = def.overlay ? '' : `<small>${esc(paramShort(id))}</small>`;
      tag.innerHTML = `<span class="ox-ind-chip"><b>${def.name}</b>${params}${readout ? `<span class="ox-ind-values">${readout}</span>` : ''}</span>`;
      tag.setAttribute('aria-label', `${def.name} ${paramText(id)}，調整參數`);
    }
    function renderTags() {
      for (const [id, pane] of panes) renderTag(id, pane.tag);
      const active = ['ma', 'bb'].filter(id => saved.on[id]);
      if (legend.children.length !== active.length || [...legend.children].some((tag, i) => tag.dataset.indicatorEdit !== active[i])) legend.replaceChildren(...active.map(makeTag));
      [...legend.children].forEach(tag => renderTag(tag.dataset.indicatorEdit, tag));
    }

    // One point per bar (blank where not computed yet) keeps the panes on the main chart's bars.
    function points(list, pick) { return list.map((v, i) => { const y = v === null || v === undefined ? null : pick(v); return Number.isFinite(y) ? { time: candles[i].time, value: y } : { time: candles[i].time }; }); }
    function compute(id) {
      const closes = candles.map(c => c.close), p = paramsOf(id);
      if (id === 'ma') return p.map(n => sma(closes, n));
      if (id === 'bb') return bollinger(closes, p[0], p[1]);
      if (id === 'kd') return kd(candles, p[0], p[1], p[2]);
      if (id === 'rsi') { const a = rsi(closes, p[0]), b = rsi(closes, p[1]); return a.map((v, i) => v === null && b[i] === null ? null : [v, b[i]]); }
      if (id === 'cci') return cci(candles, p[0]);
      return macd(closes, p[0], p[1], p[2]);
    }
    function seriesData(id, list) {
      const pal = palette();
      if (id === 'ma') return list.map(line => points(line, v => v));
      if (id === 'bb') return [points(list, v => v.up), points(list, v => v.mid), points(list, v => v.low)];
      if (id === 'kd') return [points(list, v => v.k), points(list, v => v.d)];
      if (id === 'rsi') return [points(list, v => v[0]), points(list, v => v[1])];
      if (id === 'cci') return [points(list, v => v)];
      return [list.map((v, i) => v ? { time: candles[i].time, value: v.osc, color: (v.osc >= 0 ? pal.up : pal.down) + '99' } : { time: candles[i].time }), points(list, v => v.dif), points(list, v => v.macd)];
    }
    function fill(id, lastOnly = false) {
      const target = overlays.get(id) || panes.get(id)?.series;
      if (!target) return;
      if (!candles.length) { target.forEach(s => s.setData([])); values.delete(id); return; }
      const list = compute(id);
      values.set(id, id === 'ma' ? list[0].map((_, i) => list.map(line => line[i])) : list);
      seriesData(id, list).forEach((data, i) => { if (lastOnly) target[i].update(data.at(-1)); else target[i].setData(data); });
    }
    function sync() {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (range) for (const pane of panes.values()) pane.chart.timeScale().setVisibleLogicalRange(range);
    }
    function refresh(force = false) {
      if (destroyed) return;
      const next = getCandles?.() || [];
      // The same bars with only the newest one moving: update that point in place.
      const key = `${next.length}:${next[0]?.time}:${next.at(-2)?.time}:${IDS.map(id => paramText(id)).join('|')}`;
      const lastOnly = !force && key === dataKey && next.length > 1 && next.at(-1)?.time === candles.at(-1)?.time;
      candles = next; dataKey = key;
      for (const id of [...overlays.keys(), ...panes.keys()]) fill(id, lastOnly);
      fillLine(lastOnly);
      if (!lastOnly) sync();
      renderTags(); placeLevels();
    }
    function schedule(force = false) {
      if (force) scheduleForce = true;
      if (frame) return;
      frame = root.requestAnimationFrame(() => { frame = 0; const f = scheduleForce; scheduleForce = false; refresh(f); });
    }
    let scheduleForce = false;

    // Main candles on top, then volume, then the indicator panes above the time axis.
    function layout() {
      if (destroyed) return;
      const ids = PANES.filter(id => panes.has(id)), mobile = !!isMobile();
      const timeAxis = chart.timeScale().height() || 26, plot = Math.max(1, container.clientHeight - timeAxis);
      let paneH = 0;
      if (ids.length) {
        paneH = Math.round(Math.min(120, Math.max(64, plot * (mobile ? .16 : .15))));
        const cap = plot * (mobile ? .46 : .42);
        if (paneH * ids.length > cap) paneH = Math.max(48, Math.floor(cap / ids.length));
      }
      reserved = paneH * ids.length;
      stack.style.bottom = timeAxis + 'px'; stack.style.height = reserved + 'px'; stack.hidden = !ids.length;
      ids.forEach(id => { const pane = panes.get(id); pane.box.style.height = paneH + 'px'; stack.append(pane.box); });
      const m = margins();
      chart.priceScale('right').applyOptions({ scaleMargins: m.candles });
      chart.priceScale('vol').applyOptions({ scaleMargins: m.volume });
      sync(); placeLevels(); onLayout();
    }
    function margins() {
      const base = baseMargins?.() || { candles: { top: .08, bottom: .14 }, volume: { top: .88, bottom: 0 } };
      if (!reserved) return base;
      const plot = Math.max(1, container.clientHeight - (chart.timeScale().height() || 26)), panesFrac = Math.min(.6, reserved / plot);
      const volFrac = volumeVisible() ? (isMobile() ? .1 : .12) : 0;
      return {
        candles: { top: base.candles.top, bottom: Math.min(.86 - base.candles.top, panesFrac + volFrac + .03) },
        volume: { top: Math.max(0, 1 - panesFrac - volFrac), bottom: panesFrac }
      };
    }
    // Reference levels (80/20, 70/30, 0, ±100) as small labels on the right edge;
    // a label closer than 12px to the one above it is left out.
    function placeLevels() {
      cancelAnimationFrame(placeLevels.frame);
      placeLevels.frame = root.requestAnimationFrame(() => {
        for (const [id, pane] of panes) {
          const height = pane.host.clientHeight;
          let above = -Infinity;
          pane.marks.innerHTML = LABELS[id].map(level => {
            const y = pane.anchor.priceToCoordinate(level);
            if (!(Number.isFinite(y) && y > 8 && y < height - 4) || y - above < 12) return '';
            above = y;
            return `<span style="top:${Math.round(y)}px">${level}</span>`;
          }).join('');
        }
      });
    }
    // 線圖: a close-price line on the candles' scale; the candles turn invisible.
    const HIDE = 'rgba(0,0,0,0)', COLOR_KEYS = ['upColor', 'downColor', 'wickUpColor', 'wickDownColor', 'borderUpColor', 'borderDownColor'];
    function linePalette() {
      return light() ? { color: '#8d712e', top: 'rgba(141,113,46,.2)', bottom: 'rgba(141,113,46,0)' } : { color: '#ece6d8', top: 'rgba(236,230,216,.16)', bottom: 'rgba(236,230,216,0)' };
    }
    function fillLine(lastOnly = false) {
      if (!lineSeries) return;
      const data = candles.map(c => ({ time: c.time, value: c.close }));
      if (lastOnly && data.length) lineSeries.update(data.at(-1)); else lineSeries.setData(data);
    }
    function applyStyle() {
      if (destroyed) return;
      const line = chartStyle === 'line', p = linePalette();
      if (line && !lineSeries) {
        const options = { priceScaleId: 'right', lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerRadius: 3, autoscaleInfoProvider: () => null };
        lineSeries = chart.addAreaSeries ? chart.addAreaSeries({ ...options, lineColor: p.color, topColor: p.top, bottomColor: p.bottom }) : chart.addLineSeries({ ...options, color: p.color });
        fillLine();
      }
      lineSeries?.applyOptions({ visible: line, lineColor: p.color, color: p.color, topColor: p.top, bottomColor: p.bottom });
      if (candleSeries) {
        const current = candleSeries.options?.() || {};
        if (line) {
          // Keep the theme's candle colours to bring them back for K 線.
          if (current.upColor && current.upColor !== HIDE) candleColors = Object.fromEntries(COLOR_KEYS.filter(k => current[k]).map(k => [k, current[k]]));
          candleSeries.applyOptions(Object.fromEntries(COLOR_KEYS.map(k => [k, HIDE])));
        } else if (candleColors && current.upColor === HIDE) candleSeries.applyOptions(candleColors);
      }
      container.classList.toggle('is-line-chart', line);
    }
    function applyTheme() {
      const p = palette(), text = light() ? '#616d7c' : '#929995';
      for (const [id, list] of overlays) (id === 'ma' ? list.forEach((s, i) => s.applyOptions({ color: p.lines[i] })) : [p.band, p.lines[1], p.band].forEach((color, i) => list[i].applyOptions({ color })));
      for (const [id, pane] of panes) {
        pane.chart.applyOptions({ layout: { background: { type: 'solid', color: p.bg }, textColor: text }, crosshair: { vertLine: { color: light() ? 'rgba(55,65,81,.35)' : 'rgba(255,255,255,.3)' } } });
        if (id === 'macd') { pane.series[1].applyOptions({ color: p.lines[0] }); pane.series[2].applyOptions({ color: p.lines[1] }); }
        else if (id === 'cci') pane.series[0].applyOptions({ color: p.lines[0] });
        else { pane.series[0].applyOptions({ color: p.lines[0] }); pane.series[1].applyOptions({ color: id === 'kd' ? p.lines[1] : p.lines[2] }); }
        pane.levels.forEach(line => line.applyOptions({ color: p.level }));
      }
      // The theme has just recoloured the candles; 線圖 hides them again.
      applyStyle();
      refresh(true);
    }
    // Turn panes and overlays on or off to match the saved choices.
    function apply() {
      if (destroyed) return;
      for (const id of IDS) {
        const on = !!saved.on[id], overlay = INDICATORS[id].overlay;
        if (on && overlay && !overlays.has(id)) overlays.set(id, makeOverlay(id));
        if (on && !overlay && !panes.has(id)) panes.set(id, makePane(id));
        if (!on && overlays.has(id)) { for (const s of overlays.get(id)) chart.removeSeries(s); overlays.delete(id); values.delete(id); }
        if (!on && panes.has(id)) { const pane = panes.get(id); paneSize.unobserve(pane.host); pane.chart.remove(); pane.box.remove(); panes.delete(id); values.delete(id); }
      }
      layout(); refresh(true);
    }
    function crosshair(param) {
      const index = param?.logical !== undefined && param.point ? Math.round(param.logical) : null;
      setHover(index, param?.time ?? null);
    }
    function setHover(index, time) {
      hoverIndex = index !== null && index >= 0 && index < candles.length ? index : null;
      for (const [id, pane] of panes) {
        if (hoverIndex === null || time === null) { pane.chart.clearCrosshairPosition(); continue; }
        const v = values.get(id)?.[hoverIndex], price = id === 'kd' ? v?.k : id === 'rsi' ? v?.[0] ?? v?.[1] : id === 'cci' ? v : v?.dif;
        if (Number.isFinite(price)) pane.chart.setCrosshairPosition(price, time, pane.series[id === 'macd' ? 1 : 0]); else pane.chart.clearCrosshairPosition();
      }
      renderTags();
    }
    const onClick = event => { const tag = event.target.closest?.('[data-indicator-edit]'); if (tag && container.contains(tag)) { event.stopPropagation(); openSheet(tag.dataset.indicatorEdit, tag); } };
    const onData = () => schedule();
    const onTheme = () => root.requestAnimationFrame(applyTheme);
    const onInspect = event => { const d = event.detail; if (!d) { setHover(null, null); return; } const index = candles.findIndex(c => c.time === d.time); setHover(index < 0 ? null : index, d.time); };
    const onVolume = () => root.requestAnimationFrame(layout);
    const resize = new ResizeObserver(() => layout());
    let syncFrame = 0;
    const paneSize = new ResizeObserver(() => { cancelAnimationFrame(syncFrame); syncFrame = root.requestAnimationFrame(() => { sync(); placeLevels(); }); });
    container.addEventListener('click', onClick);
    container.addEventListener('ox:chart-inspect', onInspect);
    doc.addEventListener('ox:chartdata', onData);
    doc.addEventListener('ox:themechange', onTheme);
    doc.getElementById('chk-vol')?.addEventListener('change', onVolume);
    doc.addEventListener('fullscreenchange', onVolume);
    chart.timeScale().subscribeVisibleLogicalRangeChange(sync);
    chart.subscribeCrosshairMove(crosshair);
    resize.observe(container);
    apply();
    applyStyle();
    return {
      apply, applyStyle, layout, margins, refresh: () => schedule(true),
      reservedHeight: () => reserved,
      active: id => !!saved.on[id],
      destroy() {
        destroyed = true; cancelAnimationFrame(frame); cancelAnimationFrame(syncFrame); resize.disconnect(); paneSize.disconnect();
        container.removeEventListener('click', onClick); container.removeEventListener('ox:chart-inspect', onInspect);
        doc.removeEventListener('ox:chartdata', onData); doc.removeEventListener('ox:themechange', onTheme);
        doc.getElementById('chk-vol')?.removeEventListener('change', onVolume); doc.removeEventListener('fullscreenchange', onVolume);
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(sync); chart.unsubscribeCrosshairMove(crosshair);
        for (const list of overlays.values()) for (const s of list) chart.removeSeries(s);
        for (const pane of panes.values()) pane.chart.remove();
        if (lineSeries) { try { chart.removeSeries(lineSeries); } catch {} lineSeries = null; }
        if (candleSeries && candleColors && candleSeries.options?.().upColor === HIDE) candleSeries.applyOptions(candleColors);
        container.classList.remove('is-line-chart');
        stack.remove(); legend.remove(); if (controller === this) controller = null;
      }
    };
  }

  // ---- parameter sheet (bottom sheet on phones) ----
  let sheet = null, sheetId = null, returnFocus = null;
  function ensureSheet() {
    if (sheet) return sheet;
    const doc = root.document;
    sheet = doc.createElement('dialog');
    sheet.className = 'ox-ind-sheet';
    // The sheet itself takes focus on open, so no button shows a focus ring after a tap.
    sheet.autofocus = true;
    sheet.innerHTML = '<form class="ox-ind-sheet-form" method="dialog"><div class="ox-ind-sheet-head"><div class="ox-ind-sheet-title" role="heading" aria-level="2"></div><button type="button" class="ox-ind-sheet-close" data-ind-close aria-label="關閉參數設定"></button></div><div class="ox-ind-fields"></div><p class="ox-ind-defaults"></p><div class="ox-ind-sheet-foot"><button type="button" data-ind-off>關閉指標</button><button type="button" data-ind-reset>恢復預設</button><button type="submit" class="is-primary">確定</button></div></form>';
    doc.body.append(sheet);
    const form = sheet.querySelector('form');
    sheet.addEventListener('click', event => {
      if (event.target === sheet) { closeSheet(); return; }
      const step = event.target.closest('[data-step]');
      if (step) {
        const input = step.parentElement.querySelector('input'), i = Number(input.dataset.index), dec = decimal(sheetId, i);
        const next = cleanParam(sheetId, i, (Number(input.value) || 0) + Number(step.dataset.step) * (dec ? .1 : 1));
        if (next !== null) input.value = String(next);
        return;
      }
      if (event.target.closest('[data-ind-close]')) closeSheet();
      else if (event.target.closest('[data-ind-reset]')) { const id = sheetId; closeSheet(); set({ params: { [id]: null } }); }
      else if (event.target.closest('[data-ind-off]')) { const id = sheetId; closeSheet(); set({ on: { [id]: false } }); }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const id = sheetId, inputs = [...form.querySelectorAll('input')];
      const list = inputs.map((input, i) => cleanParam(id, i, input.value));
      closeSheet();
      if (list.every(v => v !== null)) set({ on: { [id]: true }, params: { [id]: list } });
    });
    sheet.addEventListener('close', () => { sheetId = null; if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); returnFocus = null; });
    return sheet;
  }
  function openSheet(id, anchor = null) {
    if (!INDICATORS[id]) return;
    const dialog = ensureSheet(), def = INDICATORS[id], current = paramsOf(id);
    sheetId = id; returnFocus = anchor || root.document.activeElement;
    dialog.setAttribute('aria-label', `${def.name} 參數`);
    dialog.querySelector('.ox-ind-sheet-title').textContent = `${def.name} 參數`;
    dialog.querySelector('.ox-ind-fields').innerHTML = def.params.map(([label], i) => {
      const dec = decimal(id, i);
      return `<div class="ox-ind-field"><label for="ox-ind-${id}-${i}">${label}</label><div class="ox-ind-stepper"><button type="button" data-step="-1" aria-label="${label}減少">−</button><input id="ox-ind-${id}-${i}" data-index="${i}" type="number" inputmode="${dec ? 'decimal' : 'numeric'}" min="${dec ? .1 : 1}" max="${dec ? 10 : 500}" step="${dec ? .1 : 1}" value="${current[i]}" enterkeyhint="done"><button type="button" data-step="1" aria-label="${label}增加">＋</button></div></div>`;
    }).join('');
    dialog.querySelector('.ox-ind-defaults').textContent = `預設 ${defaults(id).join(', ')}`;
    dialog.querySelector('[data-ind-off]').hidden = !saved.on[id];
    if (!dialog.open) dialog.showModal();
  }
  function closeSheet() { if (sheet?.open) sheet.close(); }

  // ---- 指標與篩選 settings: toggles with their parameters ----
  function mountSettings() {
    const doc = root.document, panel = doc?.querySelector('#chart-tools-overlay [data-chart-tools-panel="indicators"]');
    if (!panel || panel.querySelector('.ox-ind-settings')) return;
    const section = doc.createElement('section');
    section.className = 'ox-ind-settings'; section.setAttribute('aria-label', '技術指標');
    // K 線／線圖 sits at the top of the panel.
    const style = doc.createElement('div');
    style.className = 'ox-chart-style'; style.setAttribute('role', 'group'); style.setAttribute('aria-label', '圖表樣式');
    style.innerHTML = [['candle', 'K 線'], ['line', '線圖']].map(([id, name]) => `<button type="button" data-chart-style="${id}" aria-pressed="${chartStyle === id}" data-track="chart.style" data-track-detail="${id}">${name}</button>`).join('');
    style.addEventListener('click', event => { const button = event.target.closest('[data-chart-style]'); if (button) setStyle(button.dataset.chartStyle); });
    panel.prepend(style);
    section.innerHTML = `<h3>技術指標</h3><div class="ox-ind-options">${IDS.map(id => `<div class="ox-ind-option"><label class="chart-indicator-option"><input type="checkbox" data-indicator="${id}"><span class="chart-indicator-check" aria-hidden="true"></span><span>${INDICATORS[id].name}</span></label><button type="button" class="ox-ind-params" data-indicator-params="${id}"></button></div>`).join('')}</div><p class="ox-ind-note">點參數或圖上的指標名稱即可調整</p>`;
    const anchor = panel.querySelector('.chart-level-alert-options') || panel.querySelector('.chart-indicator-options');
    if (anchor) anchor.after(section); else panel.prepend(section);
    section.addEventListener('change', event => { const input = event.target.closest('[data-indicator]'); if (input) set({ on: { [input.dataset.indicator]: input.checked } }); });
    section.addEventListener('click', event => { const button = event.target.closest('[data-indicator-params]'); if (button) openSheet(button.dataset.indicatorParams, button); });
    syncSettings();
  }
  function syncSettings() {
    const doc = root.document;
    if (!doc) return;
    doc.querySelectorAll?.('.ox-chart-style [data-chart-style]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.chartStyle === chartStyle)));
    for (const id of IDS) {
      const input = doc.querySelector(`.ox-ind-settings [data-indicator="${id}"]`), button = doc.querySelector(`.ox-ind-settings [data-indicator-params="${id}"]`);
      if (input) input.checked = !!saved.on[id];
      if (button) { button.textContent = paramText(id); button.setAttribute('aria-label', `${INDICATORS[id].name} 參數 ${paramText(id)}，點一下調整`); }
    }
  }

  // Stylesheet next to the other chart component styles; added before the chart starts.
  function addStyles() {
    const doc = root.document;
    if (!doc?.head || doc.querySelector('link[data-ox-chart-indicators]')) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet'; link.href = 'src/styles/components/chart-indicators.css?v=20261030-board2'; link.dataset.oxChartIndicators = '';
    doc.head.append(link);
  }
  root.addEventListener?.('storage', event => {
    if (event.key === STORAGE_KEY) { saved = read(); controller?.apply(); syncSettings(); }
    if (event.key === STYLE_KEY) { chartStyle = readStyle(); controller?.applyStyle(); syncSettings(); }
  });

  root.OXChartIndicators = Object.freeze({
    STORAGE_KEY, CHANGE_EVENT, STYLE_KEY, STYLE_EVENT, INDICATORS, sma, ema, bollinger, kd, rsi, macd, cci, normalize, defaults, paramsOf: id => paramsOf(id),
    get, set, getStyle, setStyle, attach, openSheet, mountSettings,
    controller: () => controller
  });
  if (root.document) { addStyles(); if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mountSettings, { once: true }); else mountSettings(); }
})(typeof window !== 'undefined' ? window : globalThis);
