/* OX 流動性地圖與不平衡 K（使用者定義）。純函式，不碰 DOM、網路，也不使用未來資料。
 *
 * 火箭模型的兩種東西：
 *   燃料：緩慢、密集的下跌（多單上方）／上漲（空單下方）。這段沒有爆量、K 線小又互相重疊，
 *         回頭穿過去時阻力小。以結構引擎的頂分型→底分型（或底→頂）切出每一段走勢來判斷。
 *   牆：  爆量下跌起點（多單上方）／爆量上漲起點（空單下方）、假突破高點／假跌破低點、
 *         更大級別的長上影／長下影。尚未被收盤穿過的才算。爆量起點與長影線的門檻與雷達相同。
 * 不平衡（FVG）：三根 K 中第一根與第三根之間留下缺口。缺口不是回補目標；它證明缺口前那一根
 *   （第一根）的力道，那根就是高級訂單塊：下跌缺口的訂單塊是之後的壓力／多單目標，
 *   上漲缺口的訂單塊是支撐／空單目標。之後有 K 線收盤穿過訂單塊另一側就失效。
 */
(function (root) {
  'use strict';
  const LIQUIDITY_VERSION = 1;
  const RULES = Object.freeze({
    dumpVolume: 2, dumpBodyATR: 1.2, untouchedATR: 0.25,   // 與雷達 overheadLevels 相同
    wickATR: 1, wickBody: 2,                                // 長影線：影線 ≥ 1 ATR 且 ≥ 2 倍實體（與雷達相同）
    fuelMinBars: 6, fuelBodyATR: 0.45, fuelVolume: 1.5, fuelMinATR: 2 // 緩慢密集：與雷達「緩漲」同一組門檻
  });
  const finite = Number.isFinite;
  const median = a => { const b = a.filter(finite).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const volumeOf = c => finite(c.quoteVolume) && c.quoteVolume > 0 ? c.quoteVolume : finite(c.volume) ? c.volume * c.close : 0;
  const atrsOf = bars => root.OXStructure?.rollingATR?.(bars) || bars.map(c => c.high - c.low);

  // 收盤是否穿過價位（上方的牆／燃料被收盤站上；下方的被收盤跌破）。
  function closedThrough(bars, from, level, dir, slack = 0, end = bars.length) {
    for (let j = from; j < end; j++) {
      if (bars[j].closed === false) continue;
      if (dir === 1 ? bars[j].close > level + slack : bars[j].close < level - slack) return j;
    }
    return -1;
  }

  // 不平衡 K 與高級訂單塊。
  function imbalances(bars, { lastOpen = false } = {}) {
    const out = [];
    const n = bars?.length || 0;
    const closedEnd = lastOpen ? n - 1 : n; // 第三根要收 K 才算形成缺口
    for (let i = 1; i + 1 < closedEnd; i++) {
      const a = bars[i - 1], c = bars[i + 1];
      let dir = null, top = null, bottom = null;
      if (a.high < c.low) { dir = 'up'; bottom = a.high; top = c.low; }
      else if (a.low > c.high) { dir = 'down'; top = a.low; bottom = c.high; }
      if (!dir) continue;
      // 訂單塊＝缺口前那一根（第一根）。下跌缺口→壓力；上漲缺口→支撐。
      const block = { index: i - 1, time: a.time, top: a.high, bottom: a.low };
      const brokenAt = dir === 'down' ? closedThrough(bars, i + 2, block.top, 1, 0, closedEnd) : closedThrough(bars, i + 2, block.bottom, -1, 0, closedEnd);
      out.push({ dir, role: dir === 'down' ? 'resistance' : 'support', index: i, time: bars[i].time, gap: { top, bottom, from: a.time, to: c.time },
        block, brokenAt: brokenAt < 0 ? null : brokenAt, brokenTime: brokenAt < 0 ? null : bars[brokenAt].time });
    }
    return out;
  }

  // 走勢段：用結構引擎的頂／底分型串成高低點交替的波段；反向不到 swingATR 倍 ATR 的小波動
  // 併入原本那一段（緩跌途中的小反彈不切段），才看得出整段是不是「緩慢、密集」。
  function legs(bars, fractals, { atrs = null, swingATR = 1.5 } = {}) {
    const at = atrs || atrsOf(bars);
    const swings = [];
    for (const f of [...fractals].filter(f => f.index < bars.length).sort((x, y) => x.index - y.index || (x.type === 'top' ? -1 : 1))) {
      const last = swings.at(-1);
      if (!last) { swings.push(f); continue; }
      if (last.type === f.type) { if (f.type === 'top' ? f.price >= last.price : f.price <= last.price) swings[swings.length - 1] = f; continue; }
      if (Math.abs(f.price - last.price) < swingATR * (at[f.index] || 0)) continue;
      swings.push(f);
    }
    const out = [];
    for (let k = 1; k < swings.length; k++) {
      const a = swings[k - 1], b = swings[k];
      if (b.index <= a.index || (a.type === 'top' ? a.price <= b.price : b.price <= a.price)) continue;
      out.push({ dir: a.type === 'top' ? 'down' : 'up', from: a.index, to: b.index, high: a.type === 'top' ? a.price : b.price, low: a.type === 'top' ? b.price : a.price });
    }
    return out;
  }

  /**
   * @param bars 圖表級別 K 線（由舊到新）
   * @param options.price 目前價格；options.larger：更大級別 [{frame, bars}]；options.structure：OXStructure.analyze 結果
   */
  function map(bars, { price, larger = [], structure = null, lastOpen = false, frame = '' } = {}) {
    const n = bars?.length || 0;
    const result = { version: LIQUIDITY_VERSION, walls: [], fuel: [], blocks: [], price: null };
    if (n < 20) return result;
    const live = finite(price) ? price : bars[n - 1].close;
    result.price = live;
    const closed = lastOpen ? bars.slice(0, -1) : bars;
    const atrs = atrsOf(closed), a = atrs.at(-1) || 0;
    const add = (list, item) => { if (finite(item.price) || (finite(item.top) && finite(item.bottom))) list.push(item); };
    const side = level => level > live ? 1 : level < live ? -1 : 0;

    // 牆 1：爆量下跌起點（上方）／爆量上漲起點（下方），圖表級別與更大級別都看。
    const scanDumps = (list, frameName, isLarger) => {
      const at = atrsOf(list);
      for (let i = 1; i < list.length; i++) {
        const c = list[i], body = c.close - c.open, vols = list.slice(Math.max(0, i - 40), i).map(volumeOf).filter(v => v > 0), med = median(vols);
        if (!(med > 0) || volumeOf(c) < RULES.dumpVolume * med || Math.abs(body) < RULES.dumpBodyATR * at[i]) continue;
        const dir = body < 0 ? 1 : -1, level = c.open; // 下跌爆量→上方牆（多單目標）；上漲爆量→下方牆
        if (side(level) !== dir || closedThrough(list, i + 1, level, dir, RULES.untouchedATR * at[i]) >= 0) continue;
        add(result.walls, { kind: 'dump', dir, price: level, time: c.time, frame: frameName, larger: isLarger, label: (isLarger ? frameName + ' ' : '') + (dir === 1 ? '爆量下跌起點' : '爆量上漲起點') });
      }
    };
    // 牆 2：更大級別的長上影（上方）／長下影（下方）。
    const scanWicks = (list, frameName) => {
      const at = atrsOf(list);
      for (let i = 1; i < list.length; i++) {
        const c = list[i], body = Math.abs(c.close - c.open);
        for (const dir of [1, -1]) {
          const wick = dir === 1 ? c.high - Math.max(c.open, c.close) : Math.min(c.open, c.close) - c.low, tip = dir === 1 ? c.high : c.low;
          if (wick < Math.max(RULES.wickATR * at[i], RULES.wickBody * body) || side(tip) !== dir) continue;
          if (closedThrough(list, i + 1, tip, dir, RULES.untouchedATR * at[i]) >= 0) continue;
          add(result.walls, { kind: 'wick', dir, price: tip, time: c.time, frame: frameName, larger: true, label: frameName + (dir === 1 ? ' 長上影' : ' 長下影') });
        }
      }
    };
    scanDumps(closed, frame, false);
    for (const { frame: f, bars: list } of larger) {
      const done = (list || []).filter(c => c.closed !== false);
      if (done.length < 20) continue;
      scanDumps(done, f, true);
      scanWicks(done, f);
    }
    // 牆 3：假突破高點（上方）／假跌破低點（下方），尚未被收盤穿過。
    for (const e of structure?.events || []) {
      if (e.type !== 'fake' || e.provisional) continue;
      const bar = bars[e.index]; if (!bar) continue;
      const dir = e.dir === 'up' ? 1 : -1, tip = dir === 1 ? bar.high : bar.low;
      if (side(tip) !== dir || closedThrough(closed, e.index + 1, tip, dir) >= 0) continue;
      add(result.walls, { kind: 'fake', dir, price: tip, time: bar.time, frame, larger: false, label: dir === 1 ? '假突破高點' : '假跌破低點' });
    }

    // 燃料：緩慢、密集的下跌段在上方（多單上漲時阻力小）；緩慢、密集的上漲段在下方。
    if (structure?.fractals?.length) {
      for (const leg of legs(closed, structure.fractals, { atrs })) {
        const count = leg.to - leg.from;
        if (count < RULES.fuelMinBars || leg.to >= closed.length) continue;
        const slice = closed.slice(leg.from, leg.to + 1), at = atrs[leg.from] || a;
        // 與雷達「緩漲」同一套量測：基準＝起點前 24 根平均量；只看順著這段方向、實體 > 0.3 ATR 的推進 K 有沒有爆量。
        const base = mean(closed.slice(Math.max(0, leg.from - 24), leg.from).map(volumeOf).filter(v => v > 0));
        const drive = slice.filter(c => (leg.dir === 'down' ? c.open - c.close : c.close - c.open) > 0.3 * at);
        const impulse = base > 0 ? Math.max(0, ...drive.map(c => volumeOf(c) / base)) : Infinity;
        const body = mean(slice.map(c => Math.abs(c.close - c.open))) / at;
        const move = (leg.high - leg.low) / at;
        if (!(body < RULES.fuelBodyATR && impulse < RULES.fuelVolume && move >= RULES.fuelMinATR)) continue;
        const dir = leg.dir === 'down' ? 1 : -1; // 下跌段→上方燃料；上漲段→下方燃料
        if (dir === 1 ? leg.high <= live : leg.low >= live) continue; // 要有一部分在價格前方
        const edge = dir === 1 ? leg.high : leg.low;
        if (closedThrough(closed, leg.to + 1, edge, dir) >= 0) continue; // 已經整段穿過＝燃料用掉了
        // 價格已經走進這段裡：只留還在前方的部分。
        result.fuel.push({ dir, top: dir === 1 ? leg.high : Math.min(leg.high, live), bottom: dir === 1 ? Math.max(leg.low, live) : leg.low,
          from: closed[leg.from].time, to: closed[leg.to].time, bars: count, label: dir === 1 ? '緩跌燃料' : '緩漲燃料' });
      }
    }

    // 價位重疊的燃料區併成一塊（同一方向）。
    const fuel = [];
    for (const f of result.fuel.sort((x, y) => x.bottom - y.bottom)) {
      const last = fuel.at(-1);
      if (last && last.dir === f.dir && f.bottom <= last.top) { last.top = Math.max(last.top, f.top); last.from = Math.min(last.from, f.from); last.to = Math.max(last.to, f.to); last.bars += f.bars; continue; }
      fuel.push({ ...f });
    }
    result.fuel = fuel;

    // 高級訂單塊：只留尚未失效的。
    for (const fvg of imbalances(bars, { lastOpen })) if (fvg.brokenAt == null) result.blocks.push(fvg);

    // 同一價位附近的牆合併成一道（保留較大級別的說明），只留每邊最近的幾道。
    const merged = [];
    for (const w of result.walls.sort((x, y) => Math.abs(x.price - live) - Math.abs(y.price - live))) {
      const near = merged.find(m => m.dir === w.dir && Math.abs(m.price - w.price) <= 0.15 * (a || Math.abs(live) * 0.002));
      if (near) { if (!near.sources.includes(w.label)) near.sources.push(w.label); continue; }
      merged.push({ ...w, sources: [w.label] });
    }
    result.walls = merged;
    return result;
  }

  // 火箭模型的幅度：往 dir 方向第一道牆之前，中間有多少燃料。
  function room(result, dir) {
    if (!result?.price) return null;
    const live = result.price;
    const wall = result.walls.filter(w => w.dir === dir).sort((x, y) => dir * (x.price - y.price))[0] || null;
    const fuel = result.fuel.filter(f => f.dir === dir && (!wall || (dir === 1 ? f.bottom < wall.price : f.top > wall.price)));
    return { wall, distance: wall ? Math.abs(wall.price - live) / live : null, fuel: fuel.length };
  }

  root.OXLiquidity = Object.freeze({ LIQUIDITY_VERSION, RULES, imbalances, legs, map, room });
})(globalThis);
