/* OX 雷達策略層（加密）。
 *
 * OX 經典引擎（src/core/classic-engine.js）負責找出有效壓力、量能與結構證據；
 * 這一層依使用者的選幣規格決定：
 *   1. 商品分類：真正的加密資產、BTC／ETH 基準、穩定幣、黃金代幣分開，後兩類不進雷達排名。
 *   2. 入選途徑（各自獨立，不要求同時具備）：壓力突破、型態突破、結構反轉／結構突破、
 *      帶量接近有效壓力（突破前準備）。沒有途徑的標的不算入選。
 *   3. 資金：24H 成交額是否足夠＋相對 7 日平均是否放大＋放量是否帶動價格。
 *      低成交額不能只靠量比拿高分或進 T1。
 *   4. 扣分與排除：過度拉升、明顯回吐、緩漲、突破後頂分型、小級別待確認、資料缺漏。
 *   5. 四要素：確定性、盈虧比、幅度、強度；綜合成 OX 分數排名。
 *   6. 空單：改用頂部確認（急漲後頂分型、裸 K 低跌破、結構第一次跌破）。
 *   7. 名額：多、空各自 T1 最多 10（不補）、T2 15、T3 15（補滿）。T2／T3 先排入選，
 *      不夠再用只有軟性排除的「補位」候選；結構失效等硬性排除永不上榜。
 *
 * 每一檔都保留入選、扣分、T1 未通過與未入選原因，方便查出漏選發生在哪一步。
 * 不按幣名加分或排除；所有門檻集中在 RADAR_RULES，屬於可調整的初始值，尚未經勝率校準。
 */
(function (root) {
  'use strict';
  const RADAR_STRATEGY_VERSION = 2;
  const RADAR_RULES = Object.freeze({
    historyBars: 180,
    minScanTurnover: 300000,      // 低於 30 萬 USDT 不掃描、不排名
    t1Turnover: 1000000,          // T1：24H 成交額至少 100 萬 USDT
    t1Expansion: 2,               // T1：24H 成交額至少為 7 日平均的 2 倍
    lowTurnoverScoreCap: 62,      // 成交額未達 100 萬：綜合分上限（排在成交額足夠、品質相近的標的之後）
    lowTurnoverStrengthCap: 60,   // 成交額未達 100 萬：強度上限
    noExpansionScoreCap: 81,      // 成交額足夠但沒有放大：綜合分上限（低於 T1 門檻）
    t1Score: 70,                  // T1 綜合分門檻
    minRR: 1.5,                   // T1 盈虧比門檻
    minRiskATR: 1,                // 盈虧比的風險距離至少 1 ATR：比一根 K 的正常波動還近的停損會被雜訊掃掉，不能拿來誇大盈虧比
    extendedATR: 1.2,             // 離觸發位超過 1.2 ATR 開始扣分、不列 T1
    chaseATR: 2,                  // 離觸發位超過 2 ATR：過度拉升，不入選
    parabolicATR: 6,              // 近 12 根漲幅超過 6 ATR：短期漲幅過大
    giveBackShare: 0.5,           // 回吐一半漲幅：扣分、不列 T1
    giveBackExclude: 0.75,        // 回吐四分之三：不入選
    slowAdvanceATR: 2, slowImpulse: 1.5, slowBodyATR: 0.45,
    rallyMinPct: 0.15, rallyMinATR: 5, rallyMaxBars: 30, nakedRun: 3,
    topWindow: 24, topFreshBars: 8, topStaleBars: 16, lateRetrace: 0.618, lateDropATR: 3,
    priorityScore: 35             // T2／T3：入選且綜合分 ≥ 35 排最前；其餘（低分入選與補位）依綜合分接續
  });

  // ---------- 商品分類 ----------
  const STABLECOIN_BASES = new Set(['USDC','USDE','FDUSD','TUSD','DAI','USD1','PYUSD','RLUSD','USDD','BUSD','USDP',
    'GUSD','LUSD','SUSD','USDS','FRXUSD','EURC','EURT','USDQ','USDG','USD0','AUSD']);
  const GOLD_TOKEN_BASES = new Set(['PAXG','XAUT','DGX','XAUM','KAU']);
  const MAJOR_BASES = new Set(['BTC','ETH']);
  // The contract's base coin is used as-is (USDC is the base of USDCUSDT);
  // only a bare symbol has its quote suffix removed.
  function baseOf(symbol, contract) {
    if (contract?.baseCoin) return String(contract.baseCoin).toUpperCase();
    const s = String(symbol || '').toUpperCase();
    return s.length > 4 ? s.replace(/USDT$/, '') : s;
  }
  function productClass(symbol, contract) {
    const base = baseOf(symbol, contract);
    if (STABLECOIN_BASES.has(base)) return 'stablecoin';
    if (GOLD_TOKEN_BASES.has(base) || String(contract?.assetSymbolType || '').toLowerCase() === 'metal') return 'gold-token';
    if (MAJOR_BASES.has(base)) return 'major';
    return 'crypto';
  }
  const PRODUCT_LABEL = Object.freeze({ crypto: '加密資產', major: '大型加密資產（基準）', stablecoin: '穩定幣', 'gold-token': '黃金代幣' });

  // ---------- 小工具 ----------
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const pct = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(x >= 0.1 || x <= -0.1 ? 0 : 1) + '%';
  const fmt = x => { if (!finite(x)) return '—'; const d = x >= 100 ? 2 : x >= 1 ? 4 : x >= 0.01 ? 5 : 8; return String(Number(x.toFixed(d))); };
  const money = x => !finite(x) ? '—' : x >= 1e8 ? (x / 1e8).toFixed(2) + ' 億' : x >= 1e4 ? (x / 1e4).toFixed(x >= 1e6 ? 0 : 1) + ' 萬' : x.toFixed(0);

  // Same validity rules and 180-bar window as the classic engine, so bar
  // indices from engine levels line up with the arrays used here.
  function normalizeBars(input, now = Date.now()) {
    const map = new Map();
    for (const bar of input || []) {
      if (!bar || ![bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) || bar.time * 1000 > now ||
        Math.min(bar.open, bar.close, bar.low) <= 0 || bar.high < Math.max(bar.open, bar.close, bar.low) ||
        bar.low > Math.min(bar.open, bar.close, bar.high)) continue;
      map.set(bar.time, bar);
    }
    return [...map.values()].sort((a, b) => a.time - b.time).slice(-RADAR_RULES.historyBars);
  }
  function frameData(input, now) {
    const source = normalizeBars(input, now);
    const closed = source.filter(c => !c.provisional && c.closed !== false);
    const live = source.at(-1) || null;
    return { closed, live, provisional: !!live && (live.provisional || live.closed === false), atr: atr(closed) };
  }
  function atr(bars, length = 14) {
    const start = Math.max(1, bars.length - length), values = [];
    for (let i = start; i < bars.length; i++) values.push(Math.max(bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
    return mean(values);
  }
  function pivots(bars, radius = 2) {
    const highs = [], lows = [];
    for (let i = radius; i < bars.length - radius; i++) {
      const bar = bars[i], w = bars.slice(i - radius, i + radius + 1);
      const high = w.every(c => c.high <= bar.high) && w.some(c => c.high < bar.high);
      const low = w.every(c => c.low >= bar.low) && w.some(c => c.low > bar.low);
      if (high) highs.push({ index: i, price: bar.high, time: bar.time });
      if (low && !high) lows.push({ index: i, price: bar.low, time: bar.time });
    }
    return { highs, lows };
  }
  const indexOfTime = (bars, time) => time == null ? -1 : bars.findIndex(c => c.time === time);
  const volumeOf = c => finite(c.quoteVolume) && c.quoteVolume > 0 ? c.quoteVolume : finite(c.volume) ? c.volume * c.close : 0;

  // ---------- 資金 ----------
  // 24H 成交額（Bitget usdtVolume）對比前 7 個已收日 K 的平均成交額。
  function moneyEvidence(ticker, dailyBars) {
    const turnover = Number(ticker?.usdtVolume);
    const known = Number.isFinite(turnover) && turnover > 0;
    const days = (dailyBars || []).filter(c => !c.provisional && c.closed !== false && volumeOf(c) > 0).slice(-7);
    const average = days.length >= 3 ? mean(days.map(volumeOf)) : null;
    const expansion = known && average > 0 ? turnover / average : null;
    return { turnover: known ? turnover : null, average7: average, days: days.length, expansion };
  }
  function strengthScore(moneyInfo, volume, { driven, held }) {
    const t = moneyInfo.turnover;
    const absolute = t ? clamp(20 + 18 * Math.log10(t / 3e5), 0, 50) : 0;
    const expansion = finite(moneyInfo.expansion) ? clamp(20 * Math.log2(Math.max(moneyInfo.expansion, 0.25)), -15, 30) : 0;
    let flow = 0;
    if (volume?.complete) {
      if (volume.impulseRatio >= 1.35 && volume.upwardShare >= 0.56) flow += 10;
      if ((volume.sustainedBars || 0) >= 2) flow += 5;
      if ((volume.recentRatio || 0) >= 1.3) flow += 5;
    }
    let score = absolute + expansion + flow + (held ? 5 : 0) - (driven ? 0 : 10);
    if (!t || t < RADAR_RULES.t1Turnover) score = Math.min(score, RADAR_RULES.lowTurnoverStrengthCap);
    return Math.round(clamp(score));
  }

  // ---------- 盈虧比與幅度 ----------
  const rrScore = rr => rr === null ? 45 : rr <= 0 ? 0 : Math.round(clamp(50 + 30 * Math.log2(rr)));
  const roomScore = room => room === null ? 45 : room <= 0 ? 0 : Math.round(clamp(35 + 25 * Math.log2(room / 0.05)));

  // Obstacles that have not been closed through since they formed. Includes
  // swing highs, the open of a high-volume selloff bar (supply left before a
  // dump) and long upper wicks, on the daily and weekly frames. Pivots need two
  // bars on each side, so the highs at both ends of the window (the oldest two
  // bars, the latest two closed bars and today's / this week's live bar) are
  // added separately: price already traded there. With these, "no target"
  // always means price is above every unbroken high in the window. The live
  // bar's extreme only counts once price has pulled back at least `liveGap`
  // (one setup-frame ATR) from it; closer than that it is the impulse still in
  // progress, not supply, and would make the ranking flicker intraday.
  function overheadLevels(frames, price, dir, liveGap = 0) {
    const out = [];
    for (const frame of ['1D', '1W']) {
      const { closed: bars, live, provisional } = frameData(frames?.[frame]);
      if (bars.length < 12) continue;
      const a = atr(bars), piv = pivots(bars, 2), vols = bars.slice(-40).map(volumeOf).filter(v => v > 0), med = median(vols);
      const untouched = (i, level) => !bars.slice(i + 1).some(c => dir === 1 ? c.close > level + 0.25 * a : c.close < level - 0.25 * a);
      for (const p of dir === 1 ? piv.highs : piv.lows) {
        if ((dir === 1 ? p.price > price : p.price < price) && untouched(p.index, p.price))
          out.push({ level: p.price, frame, atr: a, label: frame + (dir === 1 ? ' 前高' : ' 前低') });
      }
      for (let i = 0; i < bars.length; i++) {
        const c = bars[i], body = c.close - c.open, v = volumeOf(c);
        // 強力爆量下跌之前的區域（多單目標）／爆量上漲起點（空單目標）
        if (med > 0 && v >= 2 * med && Math.abs(body) >= 1.2 * a && Math.sign(body) === -dir) {
          const level = c.open;
          if ((dir === 1 ? level > price : level < price) && untouched(i, level))
            out.push({ level, frame, atr: a, label: frame + (dir === 1 ? ' 爆量下跌起點' : ' 爆量上漲起點') });
        }
        // 更大級別長上（下）影線
        const wick = dir === 1 ? c.high - Math.max(c.open, c.close) : Math.min(c.open, c.close) - c.low;
        const tip = dir === 1 ? c.high : c.low;
        if (wick >= Math.max(a, 2 * Math.abs(body)) && (dir === 1 ? tip > price : tip < price) && untouched(i, tip))
          out.push({ level: tip, frame, atr: a, label: frame + (dir === 1 ? ' 長上影' : ' 長下影') });
      }
      const beyond = level => dir === 1 ? level > price : level < price;
      for (const i of new Set([0, 1, bars.length - 2, bars.length - 1])) {
        const tip = dir === 1 ? bars[i].high : bars[i].low;
        if (beyond(tip) && untouched(i, tip)) out.push({ level: tip, frame, atr: a,
          label: frame + (i >= bars.length - 2 ? (dir === 1 ? ' 近期高點' : ' 近期低點') : (dir === 1 ? ' 區間高點' : ' 區間低點')) });
      }
      const liveTip = provisional && live ? (dir === 1 ? live.high : live.low) : null;
      if (finite(liveTip) && beyond(liveTip) && dir * (liveTip - price) >= liveGap) out.push({ level: liveTip, frame, atr: a,
        label: frame + (frame === '1W' ? ' 本週' : ' 今日') + (dir === 1 ? '高點' : '低點') });
    }
    return out;
  }
  function nearestTarget(candidates, price, minGap, dir) {
    return candidates.filter(c => finite(c.level) && dir * (c.level - price) >= minGap)
      .sort((x, y) => dir * (x.level - y.level))[0] || null;
  }

  // ---------- 型態辨識（多單） ----------
  function patternOf(signal, bars, a) {
    const p = signal.pressure;
    if (!p || p.kind === 'swing') return null;
    const start = indexOfTime(bars, p.points?.[0]?.time);
    const lows = pivots(bars, 2).lows.filter(x => x.index > Math.max(0, start));
    const rising = lows.length >= 2 && lows.slice(-3).every((x, i, arr) => i === 0 || x.price > arr[i - 1].price + 0.1 * a);
    if (p.kind === 'horizontal' && rising) return { kind: 'pattern', name: '上升三角（收斂）' };
    if (p.kind === 'diagonal' && rising) return { kind: 'pattern', name: '對稱收斂' };
    // 名稱只描述型態本身；「突破」「突破試探」「帶量接近」由途徑階段補上。
    if (p.kind === 'horizontal' && p.touches === 2) return { kind: 'pattern', name: '雙頂' };
    if (p.kind === 'horizontal') return { kind: 'pressure', name: '水平壓力（' + p.touches + ' 次測試）' };
    return { kind: 'pressure', name: '斜向壓力（趨勢線）' };
  }
  // 結構反轉需要先有下跌結構：反轉低點之前出現降低的高點且跌幅足夠。
  function hadDowntrend(signal, bars, a) {
    const lowIndex = indexOfTime(bars, signal.reversal?.low?.time);
    if (lowIndex < 0) return false;
    const before = pivots(bars, 2).highs.filter(h => h.index < lowIndex && h.index >= lowIndex - 40);
    const descending = before.length >= 2 && before.at(-1).price < before.at(-2).price - 0.1 * a;
    const top = Math.max(...bars.slice(Math.max(0, lowIndex - 40), lowIndex + 1).map(c => c.high));
    return descending && (top - bars[lowIndex].low) / a >= 3;
  }
  function longPathway(signal, bars, a) {
    const phase = signal.phase, volumeOK = signal.volume?.supported;
    if (phase === 'reversal' || phase === 'reversal-probe') {
      const down = hadDowntrend(signal, bars, a);
      return { key: down ? 'reversal' : 'structure-break', name: down ? '結構反轉：突破下跌中最後一個反彈高點' : '結構突破：收復近期結構高點',
        group: down ? '結構反轉' : '壓力突破', closed: phase === 'reversal', level: signal.reversal?.level ?? signal.pressure?.level };
    }
    const pattern = patternOf(signal, bars, a);
    if (phase === 'breakout' || phase === 'probe') return { key: pattern?.kind || 'pressure', name: (pattern?.name || '有效壓力') + (phase === 'probe' ? '突破試探（未收 K）' : '突破'),
      group: pattern?.kind === 'pattern' ? '型態突破' : '壓力突破', closed: phase === 'breakout', level: signal.pressure?.level };
    if (phase === 'prebreakout') return { key: volumeOK ? 'prebreakout' : 'forming', name: (volumeOK ? '帶量接近' : '接近（量能待確認）') + (pattern?.name || '有效壓力'),
      group: '突破前準備', closed: false, level: signal.pressure?.level };
    if (signal.observationClass === 'forming-boundary' && signal.pressure?.state === 'valid')
      return { key: 'forming', name: '形成中：接近' + (pattern?.name || '有效壓力'), group: '突破前準備', closed: false, level: signal.pressure.level };
    return null;
  }

  // ---------- 扣分偵測（多單） ----------
  function slowGrind(bars, a) {
    const win = bars.slice(-24), base = bars.slice(-48, -24);
    if (win.length < 24 || base.length < 12) return false;
    const baseline = mean(base.map(c => c.volume || 0));
    if (!(baseline > 0)) return false;
    const advance = (win.at(-1).close - win[0].close) / a;
    const impulse = Math.max(0, ...win.filter(c => c.close - c.open > 0.3 * a).map(c => (c.volume || 0) / baseline));
    const body = mean(win.map(c => Math.abs(c.close - c.open))) / a;
    return advance >= RADAR_RULES.slowAdvanceATR && impulse < RADAR_RULES.slowImpulse && body < RADAR_RULES.slowBodyATR;
  }
  function giveBack(bars, a, price) {
    const n = bars.length; if (n < 24) return null;
    let h = n - 12; for (let i = n - 12; i < n; i++) if (bars[i].high >= bars[h].high) h = i;
    let l = Math.max(0, h - 24); for (let i = l; i < h; i++) if (bars[i].low <= bars[l].low) l = i;
    const leg = bars[h].high - bars[l].low;
    if (leg < 3 * a) return null;
    const share = (bars[h].high - price) / leg;
    return share >= RADAR_RULES.giveBackShare && bars[h].high - price > 1.5 * a ? share : null;
  }
  // 頂分型（使用者定義）：最高那根 K 之後，有 K 線跌破它的低點，而且之後沒有再創高。
  function topFractalAfter(bars, from) {
    if (from < 0 || from >= bars.length - 1) return null;
    let k = from; for (let i = from; i < bars.length; i++) if (bars[i].high >= bars[k].high) k = i;
    for (let j = k + 1; j < bars.length; j++) if (bars[j].low < bars[k].low) return { top: bars[k], index: k, brokeAt: j };
    return null;
  }

  // ---------- 多單評估 ----------
  // 未入選分兩種：硬性（結構已失效、突破失敗、派發、價格在失效位之下、資料不足），
  // 這類絕不上榜；軟性（過度拉升、明顯回吐、沒有入選途徑但仍有同向觀察證據），
  // 這類不算入選、不進 T1，只在 T2／T3 名額不足時依綜合分補位，並標明原因。
  const ENGINE_HARD = ['最新價格已破壞結構', '近期突破失敗，壓力已上下貫穿', '下跌放量／派發'];
  // 雙極結構延續（使用者的結構規則）：4H 極陽、日線也極陽，4H 剛在 3 根內突破頂分型高點
  // （結構上移／延續／轉多），而且那根不是假突破。經典引擎找不到途徑的強勢趨勢幣靠這條入選；
  // 停損＝4H 結構底（跌破＝多空平衡）。
  function structureTrend(structure, frame = '4H') {
    const sf = structure?.[frame], sd = structure?.['1D'];
    const ev = sf?.current?.lastEvent;
    if (sf?.current?.state !== 'bull' || sd?.current?.state !== 'bull' || !ev || ev.dir !== 'up') return null;
    if (!['bos', 'continue', 'reversal', 'start'].includes(ev.type) || !(sf.lastEventAge <= 3)) return null;
    if (sf.current.lastFake && sf.current.lastFake.index === ev.index) return null;
    return { key: 'structure-trend', group: '結構延續', closed: !ev.provisional, level: ev.level, stop: sf.current.structureLow,
      name: '雙極結構' + (ev.type === 'reversal' ? '轉多' : ev.type === 'continue' ? '延續' : '上移') + '：突破頂分型高點 ' + fmt(ev.level) +
        (sf.lastEventAge ? '（' + sf.lastEventAge + ' 根前）' : ev.provisional ? '（未收 K）' : '（本根）') };
  }
  // The engine feature that earned an observation without an entry pathway.
  function watchFeature(signal) {
    const pick = (signal.matchedReasons || []).find(text => /高低點|推進|同向量|放量|收復|壓力|支撐/.test(text));
    return pick ? pick.replace(/^\d+[HDWM]\s+/, '') : '同向結構仍成立';
  }
  function evaluateLong({ signal, frames, money: moneyInfo, price, dailyContext, weeklyContext, dataGaps = [], structure = null }) {
    const setupFrame = signal.frame || '4H';
    const { closed: bars, atr: a } = frameData(frames?.[setupFrame]);
    const result = { side: 'LONG', frame: setupFrame, triggerFrame: signal.triggerFrame || null, listed: false, t1: false, fillable: false, hard: false,
      pathway: null, elements: null, score: null, matched: [], deductions: [], gates: [], rejections: [], stop: null, target: null };
    const deduct = (text, points) => result.deductions.push({ text, points });
    const blockT1 = text => result.gates.push(text);
    const exclude = (text, soft = false) => { result.rejections.push(text); if (!soft) result.hard = true; };
    if (!(a > 0) || bars.length < 35) { exclude(setupFrame + ' 已收 K 歷史不足'); return result; }
    let path = signal.structureTrend || longPathway(signal, bars, a);
    if (!path) {
      // 沒有入選途徑：仍有引擎的同向觀察證據時只當補位，名稱寫明證據，不冒充突破。
      exclude('沒有入選途徑：未帶量接近有效壓力、未突破、也沒有結構反轉', true);
      for (const reason of (signal.rejectionReasons || []).filter(r => !ENGINE_HARD.includes(r)).slice(0, 2)) deduct(reason, 0);
      path = { key: 'watch', name: '同向觀察：' + watchFeature(signal), group: '觀察補位', closed: false, level: null, fillOnly: true };
    }
    result.pathway = path;
    const watch = path.key === 'watch';
    const last = bars.at(-1), live = finite(price) ? price : last.close;
    const trend = path.key === 'structure-trend';
    const stop = trend ? path.stop : signal.invalidation?.level ?? null;
    result.stop = stop;

    // 結構失效、派發與舊壓力被貫穿：引擎已判定，直接沿用。結構延續以雙極結構為準，
    // 經典引擎自己的「價格已破壞結構」不適用（結構底沒破就是極陽）。
    for (const r of signal.rejectionReasons || []) if (ENGINE_HARD.includes(r) && !(trend && r === '最新價格已破壞結構')) exclude(r);
    if (!finite(stop) || live <= stop) exclude('價格已在結構失效位之下');

    // 過度拉升：所有途徑一律檢查（包含結構反轉）；超過 2 ATR 不算入選，只能補位且扣分照算。
    const ext = finite(path.level) && path.key !== 'prebreakout' && path.key !== 'forming' ? (live - path.level) / a : 0;
    if (ext > RADAR_RULES.extendedATR) {
      deduct('離觸發位 ' + ext.toFixed(1) + ' ATR，追價風險', Math.round((ext - RADAR_RULES.extendedATR) * 12) + 3);
      blockT1('離觸發位超過 1.2 ATR');
      if (ext > RADAR_RULES.chaseATR) exclude('已拉離觸發位 ' + ext.toFixed(1) + ' ATR（過度拉升，禁止追高）', true);
    }
    const run12 = (last.close - Math.min(...bars.slice(-12).map(c => c.low))) / a;
    if (run12 > RADAR_RULES.parabolicATR) { deduct('近 12 根漲幅 ' + run12.toFixed(1) + ' ATR，短期拉升過大', 10); blockT1('短期漲幅過大'); }
    const back = giveBack(bars, a, live);
    if (back !== null) {
      const heavy = back >= RADAR_RULES.giveBackExclude;
      deduct('已回吐 ' + Math.round(back * 100) + '% 漲幅', heavy ? 20 : 12);
      blockT1('明顯回吐');
      if (heavy) exclude('已回吐 ' + Math.round(back * 100) + '% 漲幅（明顯回吐）', true);
    }
    if (slowGrind(bars, a)) { deduct('緩漲：近 24 根沒有放量推進', 12); blockT1('緩漲不列 T1'); }
    const breakIndex = path.closed ? indexOfTime(bars, signal.pressure?.brokenAt ?? null) : -1;
    const topAfter = path.closed && (path.key === 'pressure' || path.key === 'pattern' || path.key === 'reversal' || path.key === 'structure-break') ?
      topFractalAfter(bars, breakIndex >= 0 ? breakIndex : Math.max(0, bars.length - 8)) : null;
    if (topAfter && topAfter.brokeAt > topAfter.index) { deduct('突破後出現頂分型（裸 K 低已跌破），動能轉弱', 10); blockT1('突破後頂分型'); }
    if (!path.closed && (path.key === 'prebreakout' || path.key === 'forming')) {
      const near = topFractalAfter(bars, Math.max(0, bars.length - 8));
      if (near && finite(path.level) && path.level - near.top.high <= 0.3 * a) { deduct('臨界處出現頂分型（被壓回）', 8); blockT1('臨界處被壓回'); }
    }
    if (path.key === 'forming') { deduct('尚未帶量，型態形成中', 10); blockT1('尚未帶量'); }
    if (!path.closed && (path.key === 'pressure' || path.key === 'pattern' || path.key === 'structure-break' || path.key === 'reversal' || trend)) blockT1('突破尚未收 K');

    // 小級別待確認：大級別機會保留，但不能進 T1。（觀察補位本來就不是入選，不再重複扣）
    const pending = !signal.eligible && !watch;
    if (pending) {
      const tf = signal.triggerFrame || '小級別';
      deduct(tf + (signal.pendingTrigger ? ' 啟動待確認（' + setupFrame + ' 機會保留）' : ' 待確認'), 6);
      blockT1(tf + ' 啟動尚未確認');
    }
    for (const gap of dataGaps) { deduct(gap + ' K 線暫缺', 10); blockT1(gap + ' 資料缺漏'); }

    // 資金
    const volume = signal.volume || {};
    const driven = !!(volume.complete && !volume.distribution && volume.upwardShare >= 0.56 && (signal.direction?.advance ?? 0) >= 0.5) ||
      (path.key === 'reversal' || path.key === 'structure-break') && (signal.reversal?.upwardShare ?? 0) >= 0.56;
    if (!driven) { deduct('放量沒有明顯帶動價格上行', 8); blockT1('放量未帶動價格'); }
    const held = path.closed && !topAfter && !result.rejections.length;
    const strength = strengthScore(moneyInfo, signal.triggerVolume?.complete ? signal.triggerVolume : volume, { driven, held });
    if (!moneyInfo.turnover) blockT1('24H 成交額未確認');
    else if (moneyInfo.turnover < RADAR_RULES.t1Turnover) blockT1('24H 成交額 ' + money(moneyInfo.turnover) + '，未達 T1 的 100 萬');
    if (!finite(moneyInfo.expansion)) blockT1('成交額歷史不足，無法判斷是否放大');
    else if (moneyInfo.expansion < RADAR_RULES.t1Expansion) blockT1('今日成交額為 7 日平均 ' + moneyInfo.expansion.toFixed(1) + ' 倍，未達 2 倍');

    // 雙極結構：設定級別的極陽／平衡／極陰（日線、週線由 dailyContext／weeklyContext 計入）。
    const sf = structure?.[setupFrame];
    let structureBonus = 0;
    if (sf?.current?.state && setupFrame !== '1D') {
      const st = sf.current;
      if (st.state === 'bull') structureBonus += 6;
      else if (st.state === 'balance' && st.from === 'bull') { deduct(setupFrame + ' 跌破結構底（多空平衡），多方結構待重建', 6); blockT1(setupFrame + ' 結構平衡'); }
      else if (st.state === 'balance') structureBonus += 2;
      else if (st.state === 'bear') { deduct(setupFrame + ' 雙極結構仍為極陰', 10); blockT1(setupFrame + ' 結構極陰'); }
    }
    if (sf?.current?.state === 'bear' && setupFrame === '1D') blockT1('日線結構極陰');
    // 1H 機會看上一級、1D 機會看啟動級別：4H 極陰＝逆向，扣分且不列 T1；4H 極陽小加分。
    const s4 = (setupFrame === '1H' || setupFrame === '1D') ? structure?.['4H']?.current : null;
    if (s4?.state === 'bear') { deduct('4H 雙極結構極陰（' + (setupFrame === '1D' ? '啟動級別' : '上一級') + '逆向）', 6); blockT1('4H 結構極陰'); }
    else if (s4?.state === 'bull') structureBonus += 3;
    if (setupFrame === '4H' && structure?.['1D']?.current?.state === 'bear') blockT1('日線結構極陰');
    // 週線機會由日線啟動：日線極陰＝還沒轉強，只能補位；日線跌破結構底扣分；4H 極陰扣分。都不列 T1。
    if (setupFrame === '1W') {
      const d = structure?.['1D']?.current, h4 = structure?.['4H']?.current;
      if (d?.state === 'bear') exclude('日線雙極結構極陰：週線機會等日線轉強', true);
      else if (d?.state === 'balance' && d.from === 'bull') { deduct('日線跌破結構底（平衡）', 4); blockT1('日線結構平衡'); }
      if (h4?.state === 'bear') { deduct('4H 雙極結構極陰', 6); blockT1('4H 結構極陰'); }
    }
    const freshTurn = sf?.current?.lastEvent && ['reversal', 'continue'].includes(sf.current.lastEvent.type) && sf.current.lastEvent.dir === 'up' && sf.lastEventAge <= 3;
    if (freshTurn) structureBonus += 4;

    // 目標、盈虧比、幅度：引擎的下一個有效壓力＋日線／週線的前高、近期與今日高點、
    // 區間高點、爆量下跌起點、長上影；取最近的一個，當作第一個要面對的賣壓。
    // 火箭模型：設定級別的爆量下跌起點、假突破高點也是牆（日線、週線的長上影已在上面）。
    const candidates = [...overheadLevels(frames, live, 1, a)];
    const rocket = sf?.liquidity;
    for (const w of rocket?.walls || []) if (w.dir === 1 && !w.larger) candidates.push({ level: w.price, label: setupFrame + ' ' + w.sources.join('＋'), frame: setupFrame, atr: a });
    if (signal.target && finite(signal.target.level)) candidates.push({ level: signal.target.level,
      label: signal.target.kind === 'historical-swing' ? (signal.target.frame || '') + ' 歷史前高' : setupFrame + ' 下一個有效壓力', frame: signal.target.frame || setupFrame });
    // 正在攻擊的壓力帶（觸發位附近、以及價格與觸發位之間的大級別壓力）屬於同一個區域，
    // 不能當成「下一個目標」；目標要在這個壓力帶之外。區域寬度依各自級別的 ATR。
    const triggerAbove = finite(path.level) && path.level > live;
    const zone = c => Math.max(0.65 * a, 0.35 * (c.atr || 0));
    const target = nearestTarget(candidates.filter(c => !(triggerAbove && c.level <= path.level + zone(c))), live, 0.5 * a, 1);
    result.target = target;
    const risk = finite(stop) && live > stop ? Math.max(live - stop, RADAR_RULES.minRiskATR * a) : null;
    const rr = target && risk > 0 ? (target.level - live) / risk : null;
    const room = target ? target.level / live - 1 : null;
    // 日線、週線都找不到上方壓力：價格已高於資料範圍內所有未突破高點（N 週新高），
    // 空間以中性計算；週線資料不足才視為無法評估。只說「N 週新高」，不宣稱歷史新高。
    const weeks = frameData(frames?.['1W']).closed.length;
    const openSky = !target && weeks >= 12 && frameData(frames?.['1D']).closed.length >= 35;
    if (!target && !openSky) blockT1('上方目標未辨識，空間無法評估');
    else if (rr !== null && rr < RADAR_RULES.minRR) blockT1('盈虧比 ' + rr.toFixed(2) + '，不足 1.5');

    // 確定性
    const p = signal.pressure || {};
    let certainty = { reversal: 26, 'structure-break': 22, pattern: 28, pressure: 26, prebreakout: 24, forming: 12, watch: 6, 'structure-trend': 24 }[path.key] ?? 10;
    if (!path.closed && (path.key === 'pattern' || path.key === 'pressure' || path.key === 'reversal' || path.key === 'structure-break')) certainty -= 8;
    certainty += p.touches >= 4 ? 18 : p.touches === 3 ? 14 : p.touches === 2 ? 8 : 0;
    if (p.kind === 'horizontal') certainty += 4;
    // 週線機會的級別加分要等日線啟動確認；還在等的先只算一般 4H 的加分，不讓未啟動的大級別擠掉現在就強的幣。
    certainty += { '1W': signal.eligible ? 14 : 6, '1D': 10, '4H': 6, '1H': 0 }[setupFrame] || 0;
    if (path.key === 'pattern') certainty += 6;
    const d = signal.direction || {};
    certainty += (d.higherLows ? 6 : 0) + (d.higherHighs ? 3 : 0) + (d.confirmed ? 6 : 0);
    if (signal.eligible) certainty += 8;
    if (dailyContext === 'aligned') certainty += 6; else if (dailyContext === 'opposing') { certainty -= 8; result.deductions.push({ text: '日線結構仍逆向', points: 0 }); }
    if (weeklyContext === 'aligned') certainty += 4; else if (weeklyContext === 'opposing') certainty -= 4;
    certainty += structureBonus;
    certainty = Math.round(clamp(certainty));

    // 火箭模型：第一道牆之前若有緩跌燃料（上次下跌沒有量、K 線小又密），上去阻力小，幅度加分。
    const fuel = (rocket?.fuel || []).filter(f => f.dir === 1 && (!target || f.bottom < target.level));
    const elements = { certainty, strength, rr: rr === null ? null : Number(rr.toFixed(2)), room: room === null ? null : Number(room.toFixed(4)),
      rrScore: rrScore(rr), roomScore: Math.min(100, roomScore(room) + 8 * Math.min(2, fuel.length)), fuel: fuel.length };
    result.elements = elements;
    let score = 0.35 * certainty + 0.30 * strength + 0.20 * elements.rrScore + 0.15 * elements.roomScore;
    score -= result.deductions.reduce((s, x) => s + x.points, 0);
    if (!moneyInfo.turnover || moneyInfo.turnover < RADAR_RULES.t1Turnover) score = Math.min(score, RADAR_RULES.lowTurnoverScoreCap);
    else if (!(moneyInfo.expansion >= RADAR_RULES.t1Expansion)) score = Math.min(score, RADAR_RULES.noExpansionScoreCap);
    result.score = Math.round(clamp(score, 0, 99));
    if (result.score < RADAR_RULES.t1Score) blockT1('綜合分 ' + result.score + '，未達 T1 的 ' + RADAR_RULES.t1Score);

    // 入選原因（給卡片與詳情）
    result.matched.push('途徑 · ' + path.group + ' · ' + setupFrame + ' ' + path.name);
    if (watch) for (const text of (signal.matchedReasons || []).filter(t => !/歷史|目標/.test(t)).slice(0, 2)) result.matched.push(text);
    if (p.touches) result.matched.push((p.kind === 'horizontal' ? '水平' : p.kind === 'diagonal' ? '斜向' : '轉折') + '壓力 ' + fmt(p.level) + ' · ' + p.touches + ' 次獨立測試');
    if (moneyInfo.turnover) result.matched.push('24H 成交額 ' + money(moneyInfo.turnover) + (finite(moneyInfo.expansion) ? ' · 7 日均 ' + moneyInfo.expansion.toFixed(1) + ' 倍' : ''));
    if (driven) result.matched.push('放量帶動價格上行 · 同向量 ' + Math.round((volume.upwardShare ?? signal.reversal?.upwardShare ?? 0) * 100) + '%');
    if (signal.eligible && signal.triggerFrame) result.matched.push(signal.triggerFrame + ' 啟動已確認');
    if (sf?.current?.state && setupFrame !== '1D') result.matched.push(setupFrame + ' 雙極結構 ' + stateText(sf.current) + (freshTurn ? ' · ' + sf.current.lastEvent.label + (sf.lastEventAge ? '（' + sf.lastEventAge + ' 根前）' : '（本根）') : ''));
    if (dailyContext === 'aligned') result.matched.push(structure?.['1D'] ? '日線雙極結構 ' + stateText(structure['1D'].current) : '日線結構同向');
    if (weeklyContext === 'aligned') result.matched.push(structure?.['1W'] ? '週線雙極結構 ' + stateText(structure['1W'].current) : '週線結構同向');
    if (fuel.length) result.matched.push('火箭燃料 · 第一道牆前有 ' + fuel.length + ' 段緩跌（' + fuel.map(f => fmt(f.bottom) + '–' + fmt(f.top)).join('、') + '）');
    if (target) result.matched.push('目標 ' + target.label + ' ' + fmt(target.level) + '（' + pct(room) + '）' + (rr !== null ? ' · 盈虧比 ' + rr.toFixed(1) : ''));
    else result.matched.push(openSky ? '上方日線、週線已無未突破高點（約 ' + weeks + ' 週新高）· 空間以中性計算' : '上方歷史目標未辨識 · 不假設無限空間');
    if (finite(stop)) result.matched.push('結構失效 ' + fmt(stop));
    return settle(result);
  }
  // 入選＝有途徑且沒有任何排除；補位＝只有軟性排除（T2／T3 名額不足時才用）；
  // 硬性排除永不上榜。T1 只從入選裡挑，而且不能有任何 T1 閘門。
  function settle(result) {
    result.listed = !result.rejections.length && !result.pathway?.fillOnly;
    result.fillable = !result.listed && !result.hard && !!result.elements;
    const watchReason = result.side === 'SHORT' ? '沒有急漲段，只有高點降低＋頂分型' : '沒有入選途徑，只有同向觀察';
    result.fillReason = !result.fillable ? null : result.pathway?.key === 'watch' ? watchReason : result.rejections[0] || null;
    result.t1 = result.listed && !result.gates.length;
    return result;
  }

  // ---------- 空單：頂部確認 ----------
  // ---------- 雙極結構與火箭模型（src/core/structure-engine.js、liquidity-engine.js） ----------
  // 每個級別各自的極陽／平衡／極陰、結構底／頂與最近事件；設定級別另外算流動性（牆與燃料）。
  // 兩個引擎沒載入時（例如舊快照或獨立測試）回傳 null，雷達照原本規則運作。
  const STATE_CONTEXT = { bull: 'aligned', bear: 'opposing', balance: 'neutral' };
  function structureContext(frames, { now } = {}) {
    const engine = root.OXStructure;
    if (!engine) return null;
    const out = {};
    for (const frame of ['1H', '4H', '1D', '1W']) {
      const { closed, live, provisional } = frameData(frames?.[frame], now);
      if (closed.length < 20) continue;
      const bars = provisional && live ? [...closed, live] : closed;
      const analysis = engine.analyze(bars, { lastOpen: !!provisional });
      const lastIndex = bars.length - 1, ev = analysis.current.lastEvent;
      out[frame] = { bars, analysis, current: analysis.current, lastEventAge: ev ? lastIndex - ev.index : null,
        liquidity: root.OXLiquidity ? root.OXLiquidity.map(bars, { structure: analysis, lastOpen: !!provisional, frame }) : null };
    }
    return out;
  }
  const stateText = c => c?.label ? c.label + (c.state === 'bull' && finite(c.structureLow) ? '（結構底 ' + fmt(c.structureLow) + '）' :
    c.state === 'bear' && finite(c.structureHigh) ? '（結構頂 ' + fmt(c.structureHigh) + '）' : '') : '';

  function topStructure(input, { now } = {}) {
    const { closed: bars, live, provisional, atr: a } = frameData(input, now);
    const n = bars.length;
    if (n < 35 || !(a > 0)) return null;
    const win = Math.min(RADAR_RULES.topWindow, n);
    let h = n - win; for (let i = n - win; i < n; i++) if (bars[i].high >= bars[h].high) h = i;
    const H = bars[h].high;
    let l = Math.max(0, h - RADAR_RULES.rallyMaxBars); for (let i = l; i < h; i++) if (bars[i].low <= bars[l].low) l = i;
    const L = bars[l].low;
    let run = 0, nakedRun = 0;
    for (let i = l + 1; i <= h; i++) { if (bars[i].low >= bars[i - 1].low) { run++; nakedRun = Math.max(nakedRun, run); } else run = 0; }
    const rallyPct = H / L - 1, rallyATR = (H - L) / a;
    const strongRally = rallyPct >= RADAR_RULES.rallyMinPct && rallyATR >= RADAR_RULES.rallyMinATR && nakedRun >= RADAR_RULES.nakedRun && h - l <= RADAR_RULES.rallyMaxBars;
    const liveNewHigh = provisional && live.high > H;
    let confirmedAt = -1; for (let i = h + 1; i < n; i++) if (bars[i].low < bars[h].low) { confirmedAt = i; break; }
    const liveBreak = confirmedAt < 0 && provisional && live.low < bars[h].low;
    const piv = pivots(bars, 2);
    let structureLow = piv.lows.filter(p => p.index > l && p.index < h).at(-1) || null;
    const after = bars.slice(h + 1);
    // 跌破與突破一樣，影線碰到就算（使用者定義）。
    let structureBroken = !!structureLow && (after.some(c => c.low < structureLow.price) || provisional && live.low < structureLow.price);
    // 有雙極結構引擎時，結構底改用使用者定義（頂分型後的回調低點，突破頂分型高點時成立），
    // 與圖表上的雙極結構指標一致：頂部之後跌破結構底＝已跌破；仍是極陽＝目前的結構底。
    if (root.OXStructure) {
      const all = provisional && live ? [...bars, live] : bars;
      const s = root.OXStructure.analyze(all, { lastOpen: !!provisional });
      const brk = s.events.find(e => e.type === 'balance' && e.dir === 'down' && e.index > h);
      if (brk) { structureLow = { index: brk.index, price: brk.level, time: all[brk.index].time }; structureBroken = true; }
      else if (s.current.state === 'bull') { const seg = s.segments.find(g => g.kind === 'low' && g.endIndex == null); structureLow = seg ? { index: seg.index, price: seg.price, time: seg.time } : null; structureBroken = false; }
      else { structureLow = null; structureBroken = s.current.state === 'bear'; }
    }
    const price = provisional && live ? live.close : bars.at(-1).close;
    const retrace = (H - price) / Math.max(H - L, a);
    const dropATR = (bars[h].low - price) / a;
    const up = after.filter(c => c.close > c.open).reduce((s, c) => s + (c.volume || 0), 0);
    const down = after.filter(c => c.close < c.open).reduce((s, c) => s + (c.volume || 0), 0);
    const downShare = up + down > 0 ? down / (up + down) : 0;
    return { bars, a, n, h, l, H, L, top: bars[h], rallyPct, rallyATR, nakedRun, strongRally, liveNewHigh, confirmedAt, liveBreak,
      fresh: confirmedAt >= 0 && n - 1 - confirmedAt <= RADAR_RULES.topFreshBars, structureLow, structureBroken, price, retrace, dropATR, downShare };
  }
  function evaluateShort({ frames, money: moneyInfo, price, dataGaps = [], structure = null }) {
    const result = { side: 'SHORT', frame: '4H', triggerFrame: '1H', listed: false, t1: false, fillable: false, hard: false, pathway: null, elements: null, score: null,
      matched: [], deductions: [], gates: [], rejections: [], stop: null, target: null };
    const t4 = topStructure(frames?.['4H']), t1h = topStructure(frames?.['1H']), t1d = topStructure(frames?.['1D']);
    const deduct = (text, points) => result.deductions.push({ text, points });
    const blockT1 = text => result.gates.push(text);
    const exclude = (text, soft = false) => { result.rejections.push(text); if (!soft) result.hard = true; };
    if (!t4) { exclude('4H 已收 K 歷史不足'); return result; }
    if (t4.liveNewHigh) { exclude('4H 仍在創新高，頂部尚未形成'); return result; }
    const noRally = '4H 近期沒有急漲段（需漲幅 ≥15%、≥5 ATR、裸 K 低連續 ≥3 根未破）';
    let path = null;
    if (t4.strongRally) {
      if (t4.confirmedAt >= 0 && t4.structureBroken) path = { key: 'structure-break', name: '結構第一次跌破（急漲後）', group: '結構反轉', closed: true };
      else if (t4.confirmedAt >= 0) path = { key: 'top-confirmed', name: '頂分型確認：最高 K 的低點已跌破', group: '頂部確認', closed: true };
      else if (t4.liveBreak) path = { key: 'top-probe', name: '頂分型試探：正在跌破最高 K 低點（未收 K）', group: '頂部確認', closed: false };
      else if (t1h && t1h.confirmedAt >= 0 && t1h.fresh && t1h.H >= t4.H - 0.5 * t4.a) path = { key: 'early', name: '1H 頂分型已確認 · 4H 待確認', group: '頂部確認', closed: false };
      if (!path) { exclude('4H 急漲後尚未出現頂分型（最高 K 低點未跌破）'); return result; }
    } else {
      // 沒有急漲段：只有「高點降低＋最高 K 低點已跌破、價格仍在其下」才當補位觀察，不算入選。
      const [h1, h2] = pivots(t4.bars, 2).highs.slice(-2);
      const lowerHigh = !!h1 && !!h2 && h2.price < h1.price - 0.1 * t4.a;
      const live0 = finite(price) ? price : t4.price;
      if (!(t4.confirmedAt >= 0 && lowerHigh && live0 < t4.top.low)) { exclude(noRally); return result; }
      exclude(noRally, true);
      path = { key: 'watch', name: '高點降低＋頂分型確認（非急漲後）', group: '觀察補位', closed: true, fillOnly: true };
    }
    result.pathway = path;
    const watch = path.key === 'watch';
    const live = finite(price) ? price : t4.price, a = t4.a;
    const age = path.closed ? t4.n - 1 - t4.confirmedAt : 0;
    if (path.closed && !t4.fresh) {
      const stale = age > RADAR_RULES.topStaleBars;
      deduct('頂分型確認已 ' + age + ' 根 4H', stale ? 16 : 8);
      blockT1('頂部確認不新鮮');
      if (stale) exclude('頂部確認已過時（' + age + ' 根 4H 前）', true);
    }
    const late = t4.retrace >= RADAR_RULES.lateRetrace || t4.dropATR >= RADAR_RULES.lateDropATR;
    if (t4.dropATR > 1.5) { deduct('離頂部確認位 ' + t4.dropATR.toFixed(1) + ' ATR', Math.round((t4.dropATR - 1.5) * 8)); blockT1('離確認位過遠'); }
    else if (late) { deduct('已回落 ' + Math.round(t4.retrace * 100) + '% 漲幅', 12); blockT1('已大幅回落'); }
    if (late) exclude('已回落 ' + Math.round(t4.retrace * 100) + '% 漲幅（已大幅回落，禁止追空）', true);
    if (!path.closed) blockT1('頂部確認尚未收 K');
    if (path.key === 'early') deduct('4H 待確認', 6);
    for (const gap of dataGaps) { deduct(gap + ' K 線暫缺', 10); blockT1(gap + ' 資料缺漏'); }
    const dailyStrong = t1d && t1d.liveNewHigh || t1d && t1d.nakedRun >= 3 && t1d.h >= t1d.n - 2 && t1d.confirmedAt < 0;
    if (dailyStrong) { deduct('日線仍強勢（裸 K 低未破），4H 可能只是回調', 8); blockT1('日線仍強勢'); }
    const dailyTop = !!t1d && t1d.confirmedAt >= 0 && t1d.n - 1 - t1d.confirmedAt <= 3 && t1d.h >= t1d.n - 8;
    const driven = t4.downShare >= 0.55 && t4.dropATR >= 0.3 || path.key === 'early' && t1h?.downShare >= 0.55;
    if (!driven) { deduct('下跌量能沒有占優', 8); blockT1('下跌未帶量'); }
    if (!(t4.structureBroken || dailyTop || t4.downShare >= 0.6)) blockT1('需要結構跌破、日線頂分型或明顯下跌量能其中之一');
    const strength = strengthScore(moneyInfo, null, { driven, held: path.closed && t4.fresh }) + (t4.downShare >= 0.6 ? 10 : 0);
    if (!moneyInfo.turnover) blockT1('24H 成交額未確認');
    else if (moneyInfo.turnover < RADAR_RULES.t1Turnover) blockT1('24H 成交額 ' + money(moneyInfo.turnover) + '，未達 T1 的 100 萬');
    if (!finite(moneyInfo.expansion)) blockT1('成交額歷史不足，無法判斷是否放大');
    else if (moneyInfo.expansion < RADAR_RULES.t1Expansion) blockT1('今日成交額為 7 日平均 ' + moneyInfo.expansion.toFixed(1) + ' 倍，未達 2 倍');

    const stop = t4.H;
    result.stop = stop;
    const candidates = [...overheadLevels(frames, live, -1, a)];
    const s4 = structure?.['4H'], rocket = s4?.liquidity;
    for (const w of rocket?.walls || []) if (w.dir === -1 && !w.larger) candidates.push({ level: w.price, label: '4H ' + w.sources.join('＋'), frame: '4H', atr: a });
    if (t4.structureLow && !t4.structureBroken) candidates.push({ level: t4.structureLow.price, label: '4H 結構底', frame: '4H' });
    candidates.push({ level: t4.L, label: watch ? '4H 前段低點' : '4H 急漲起點', frame: '4H' });
    const target = nearestTarget(candidates, live, 0.5 * a, -1);
    result.target = target;
    const risk = stop > live ? Math.max(stop - live, RADAR_RULES.minRiskATR * a) : null;
    const rr = target && risk > 0 ? (live - target.level) / risk : null;
    const room = target ? 1 - target.level / live : null;
    if (!target) blockT1('下方目標未辨識');
    else if (rr !== null && rr < RADAR_RULES.minRR) blockT1('盈虧比 ' + rr.toFixed(2) + '，不足 1.5');

    let certainty = { 'structure-break': 34, 'top-confirmed': 30, 'top-probe': 16, early: 14, watch: 8 }[path.key];
    if (!watch) certainty += t4.nakedRun >= 5 ? 10 : 6;
    if (!watch && t4.rallyATR >= 8) certainty += 6;
    if (t4.downShare >= 0.6) certainty += 8;
    if (t4.structureBroken) certainty += 6;
    if (dailyTop) certainty += 8;
    const dailyStructureBreak = !!t1d && t1d.strongRally && t1d.structureBroken;
    if (dailyStructureBreak) certainty += 8;
    if (t4.fresh && t4.n - 1 - t4.confirmedAt <= 3) certainty += 4;
    if (dailyStrong) certainty -= 8;
    // 雙極結構：4H、日線已是極陰＝下跌結構成立；日線仍極陽則扣分（大級別多方結構未破）。
    const s1d = structure?.['1D']?.current;
    if (s4?.current?.state === 'bear') certainty += 4;
    if (s1d?.state === 'bear') certainty += 4;
    else if (s1d?.state === 'bull' && !dailyStrong) deduct('日線雙極結構仍為極陽', 4);
    certainty = Math.round(clamp(certainty));
    const fuel = (rocket?.fuel || []).filter(f => f.dir === -1 && (!target || f.top > target.level));
    const elements = { certainty, strength: Math.round(clamp(strength)), rr: rr === null ? null : Number(rr.toFixed(2)),
      room: room === null ? null : Number(room.toFixed(4)), rrScore: rrScore(rr), roomScore: Math.min(100, roomScore(room) + 8 * Math.min(2, fuel.length)), fuel: fuel.length };
    result.elements = elements;
    let score = 0.35 * certainty + 0.30 * elements.strength + 0.20 * elements.rrScore + 0.15 * elements.roomScore;
    score -= result.deductions.reduce((s, x) => s + x.points, 0);
    if (!moneyInfo.turnover || moneyInfo.turnover < RADAR_RULES.t1Turnover) score = Math.min(score, RADAR_RULES.lowTurnoverScoreCap);
    else if (!(moneyInfo.expansion >= RADAR_RULES.t1Expansion)) score = Math.min(score, RADAR_RULES.noExpansionScoreCap);
    result.score = Math.round(clamp(score, 0, 99));
    if (result.score < RADAR_RULES.t1Score) blockT1('綜合分 ' + result.score + '，未達 T1 的 ' + RADAR_RULES.t1Score);

    result.matched.push('途徑 · ' + path.group + ' · 4H ' + path.name);
    result.matched.push(watch ? '4H 高點降低 · 價格仍在最高 K 低點之下' :
      '急漲段 ' + pct(t4.rallyPct) + ' · ' + t4.rallyATR.toFixed(1) + ' ATR · 裸 K 低連續 ' + t4.nakedRun + ' 根未破');
    result.matched.push('頂部 ' + fmt(t4.H) + ' · 最高 K 低點 ' + fmt(t4.top.low));
    if (t4.structureBroken && t4.structureLow) result.matched.push('4H 結構底 ' + fmt(t4.structureLow.price) + ' 已跌破');
    if (dailyTop) result.matched.push('日線頂分型已確認');
    if (s4?.current?.state) result.matched.push('4H 雙極結構 ' + stateText(s4.current));
    if (s1d?.state) result.matched.push('日線雙極結構 ' + stateText(s1d));
    if (fuel.length) result.matched.push('火箭燃料 · 下方第一道牆前有 ' + fuel.length + ' 段緩漲（' + fuel.map(f => fmt(f.bottom) + '–' + fmt(f.top)).join('、') + '）');
    if (dailyStructureBreak) result.matched.push('日線結構第一次跌破（大級別結構反轉）');
    if (moneyInfo.turnover) result.matched.push('24H 成交額 ' + money(moneyInfo.turnover) + (finite(moneyInfo.expansion) ? ' · 7 日均 ' + moneyInfo.expansion.toFixed(1) + ' 倍' : ''));
    if (driven) result.matched.push('下跌量能占 ' + Math.round(t4.downShare * 100) + '%');
    if (target) result.matched.push('目標 ' + target.label + ' ' + fmt(target.level) + '（' + pct(-room) + '）' + (rr !== null ? ' · 盈虧比 ' + rr.toFixed(1) : ''));
    result.matched.push('結構失效（頂部）' + fmt(stop));
    return settle(result);
  }

  // ---------- 大級別背景 ----------
  // aligned：價格在已確認低點之上且高低點墊高；opposing：低點降低且價格在近期均價之下。
  function frameContext(input) {
    const { closed: bars, atr: a } = frameData(input);
    if (bars.length < 20 || !(a > 0)) return null;
    const piv = pivots(bars, 2), [l1, l2] = piv.lows.slice(-2), [h1, h2] = piv.highs.slice(-2), last = bars.at(-1);
    const higherLows = l1 && l2 && l2.price > l1.price, lowerLows = l1 && l2 && l2.price < l1.price;
    const lowerHighs = h1 && h2 && h2.price < h1.price;
    const avg = mean(bars.slice(-20).map(c => c.close));
    if (higherLows && last.close > (l2?.price ?? 0)) return 'aligned';
    if (lowerLows && lowerHighs && last.close < avg) return 'opposing';
    return 'neutral';
  }

  // ---------- 每一檔的入口 ----------
  // A setup that qualifies on its own frame (4H or 1D) must not vanish just
  // because the smaller trigger frame has not confirmed yet: it is kept as a
  // pending observation (never T1) with the missing confirmation stated.
  function pendingSetups(longSignals, setupSignals) {
    const covered = new Set(longSignals.filter(Boolean).filter(s => s.eligible || s.observationEligible).map(s => s.frame));
    return setupSignals.filter(Boolean).filter(s => (s.eligible || s.observationEligible) && !covered.has(s.frame))
      .map(s => ({ ...s, eligible: false, observationEligible: true, pendingTrigger: true,
        triggerFrame: s.frame === '1W' ? '1D' : s.frame === '1D' ? '4H' : '1H' }));
  }
  function evaluateSymbol({ symbol, contract, ticker, frames, longSignals = [], setupSignals = [], dataGaps = [], price }) {
    const product = productClass(symbol, contract);
    const base = { version: RADAR_STRATEGY_VERSION, product, productLabel: PRODUCT_LABEL[product] };
    if (product === 'stablecoin' || product === 'gold-token')
      return { ...base, excluded: PRODUCT_LABEL[product] + '不參與加密雷達排名', long: null, short: null };
    const moneyInfo = moneyEvidence(ticker, frames?.['1D']);
    const live = finite(price) ? price : Number(ticker?.lastPr);
    // 日線、週線背景：有雙極結構引擎時直接用它的狀態（極陽＝同向、極陰＝逆向、平衡＝中性），
    // 與圖表指標一致；沒有時沿用高低點判斷。
    const structure = structureContext(frames);
    const contextOf = frame => structure ? (structure[frame] ? STATE_CONTEXT[structure[frame].current.state] || 'neutral' : null) : frameContext(frames?.[frame]);
    const dailyContext = contextOf('1D'), weeklyContext = contextOf('1W');
    const evaluated = [...longSignals.filter(Boolean).filter(s => s.eligible || s.observationEligible), ...pendingSetups(longSignals, setupSignals)]
      .map(signal => evaluateLong({ signal, frames, money: moneyInfo, price: live, dailyContext, weeklyContext, dataGaps, structure }));
    // 經典引擎沒有入選途徑、但雙極結構是強勢延續的幣：用 4H 的引擎資料（量能、方向）加上結構途徑評估。
    const trend = !evaluated.some(r => r.listed) ? structureTrend(structure, '4H') : null;
    if (trend) {
      const base = longSignals.find(s => s?.frame === '4H') || setupSignals.find(s => s?.frame === '4H') || { frame: '4H' };
      const confirmed = trend.closed && structure['1H']?.current?.state !== 'bear';
      evaluated.push(evaluateLong({ signal: { ...base, frame: '4H', triggerFrame: '1H', structureTrend: trend, eligible: confirmed, pendingTrigger: false },
        frames, money: moneyInfo, price: live, dailyContext, weeklyContext, dataGaps, structure }));
    }
    // 同一檔取最好的一組：完整入選（T1 優先）→ 補位候選 → 其他有途徑的結果。
    const rank = r => r.listed ? (r.t1 ? 0 : 1) : r.fillable ? 2 : r.pathway ? 3 : 4;
    let long = evaluated.sort((x, y) => rank(x) - rank(y) || (y.score ?? -1) - (x.score ?? -1))[0] || null;
    if (!long) long = { side: 'LONG', listed: false, t1: false, fillable: false, hard: true, pathway: null, elements: null, score: null, matched: [], deductions: [], gates: [],
      rejections: ['沒有入選途徑：未帶量接近有效壓力、未突破、也沒有結構反轉', ...(longSignals.find(Boolean)?.rejectionReasons || []).slice(0, 3)] };
    const short = evaluateShort({ frames, money: moneyInfo, price: live, dataGaps, structure });
    const states = structure ? Object.fromEntries(Object.entries(structure).map(([frame, x]) => [frame, { state: x.current.state, label: x.current.label,
      structureLow: x.current.structureLow, structureHigh: x.current.structureHigh, since: x.current.bars }])) : null;
    return { ...base, money: moneyInfo, dailyContext, weeklyContext, structure: states, long, short };
  }

  // ---------- 排名 ----------
  // 多、空各自一份：T1 最多 10 檔、只收完整條件，不足不補，可以是 0；
  // T2、T3 各補滿 15 檔：先排綜合分 ≥ 35 的入選，接著把低分入選與補位候選
  // 一起依綜合分接上（補位的扣分照算，分數自然偏低）；同一檔只占一個位置。
  // 可用的候選本身不足 30 檔時如實少列，不造資料。
  const TIER_LIMITS = Object.freeze({ T1: 10, T2: 15, T3: 15 });
  function rankRadar(rows, { limits = TIER_LIMITS } = {}) {
    const group = r => r.radarSide.listed && r.radarSide.score >= RADAR_RULES.priorityScore ? 0 : 1;
    const ordered = [...rows].filter(r => r.radarSide.listed || r.radarSide.fillable).sort((a, b) => group(a) - group(b) ||
      b.radarSide.score - a.radarSide.score ||
      b.radarSide.elements.certainty - a.radarSide.elements.certainty || b.radarSide.elements.strength - a.radarSide.elements.strength ||
      String(a.symbol).localeCompare(String(b.symbol)));
    const seen = new Set(), unique = ordered.filter(r => !seen.has(r.symbol) && seen.add(r.symbol));
    const t1 = unique.filter(r => r.radarSide.t1).slice(0, limits.T1);
    const chosen = new Set(t1.map(r => r.symbol)), rest = unique.filter(r => !chosen.has(r.symbol));
    return { t1, t2: rest.slice(0, limits.T2), t3: rest.slice(limits.T2, limits.T2 + limits.T3) };
  }

  root.OXRadarStrategy = Object.freeze({ RADAR_STRATEGY_VERSION, RADAR_RULES, TIER_LIMITS, productClass, PRODUCT_LABEL, moneyEvidence,
    evaluateLong, evaluateShort, topStructure, evaluateSymbol, rankRadar, frameContext, structureContext, structureTrend });
})(globalThis);
