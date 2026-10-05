/* OX 經典: price structure qualifies the opportunity before any ranking.
 * Plain script for the preserved runtime; classic.js exposes the same code to
 * modules/workers/Node. No provider, DOM, orders or future candles are consulted.
 */
(function (root) {
  'use strict';
  const CLASSIC_VERSION = 11;
  const CLASSIC_TIER_LIMITS = Object.freeze({ T1: 10, T2: 15, T3: 15 });
  // Initial, centralized defaults in ATR/bar units. These are implementation
  // thresholds, not claims of calibration or performance from trade screenshots.
  const CLASSIC_RULES = Object.freeze({
    minimumBars: 35, historyBars: 180, pivotRadius: 2, minimumTouches: 2,
    touchGap: 4, minimumSpan: 8, touchATR: 0.35, rejectionATR: 0.45,
    breakATR: 0.6, holdATR: 0.25, nearATR: 1.2, recentBreakBars: 8,
    impulseVolume: 1.35, upwardShare: 0.56, maximumRiskATR: 8
  });
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
  const sideName = side => String(side).toLowerCase() === 'short' ? 'SHORT' : 'LONG';

  function normalize(input, now) {
    const map = new Map();
    for (const bar of input || []) {
      if (!bar || ![bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) ||
          bar.time * 1000 > now || Math.min(bar.open, bar.close, bar.low) <= 0 ||
          bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high)) continue;
      map.set(bar.time, bar);
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  }
  const mirror = (bars, dir) => bars.map(c => ({
    ...c, open: c.open * dir, close: c.close * dir,
    high: (dir === 1 ? c.high : c.low) * dir,
    low: (dir === 1 ? c.low : c.high) * dir
  }));
  function trueRange(bars) {
    const start = Math.max(1, bars.length - 14), values = [];
    for (let i = start; i < bars.length; i++) values.push(Math.max(
      bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
    return mean(values);
  }
  function pivots(bars, radius) {
    const highs = [], lows = [];
    for (let i = radius; i < bars.length - radius; i++) {
      const bar = bars[i], window = bars.slice(i - radius, i + radius + 1);
      const high = window.every(c => c.high <= bar.high) && window.some(c => c.high < bar.high);
      const low = window.every(c => c.low >= bar.low) && window.some(c => c.low > bar.low);
      // The high is an observed pressure test even on an outside candle.
      // Do not infer a high-then-low reversal sequence from that candle.
      if (high) highs.push({ index: i, price: bar.high, time: bar.time, confirmedAt: bars[i + radius].time });
      if (low && !high) lows.push({ index: i, price: bar.low, time: bar.time, confirmedAt: bars[i + radius].time });
    }
    return { highs, lows };
  }
  function independentTouches(points, line, bars, a, rules) {
    const touches = [];
    for (const p of points) {
      if (Math.abs(p.price - (line.slope * p.index + line.intercept)) > rules.touchATR * a) continue;
      const prev = touches.at(-1);
      if (prev) {
        if (p.index - prev.index < rules.touchGap) continue;
        const rejected = bars.slice(prev.index + 1, p.index).some((c, j) =>
          c.close < line.slope * (prev.index + 1 + j) + line.intercept - rules.rejectionATR * a);
        if (!rejected) continue;
      }
      touches.push(p);
    }
    return touches;
  }
  function pressureLevels(bars, features, a, rules) {
    const points = features.highs.slice(-24), n = bars.length, candidates = [], seen = new Set();
    function consider(line, kind, pointsForLine) {
      const touches = independentTouches(pointsForLine, line, bars, a, rules);
      if (touches.length < rules.minimumTouches || touches.at(-1).index - touches[0].index < rules.minimumSpan) return;
      const start = touches[0].index, formed = touches[rules.minimumTouches - 1].index + rules.pivotRadius;
      if (formed >= n) return;
      const level = line.slope * (n - 1) + line.intercept;
      // A short, old sloping segment must not become an indefinitely projected
      // ceiling. Horizontal levels retain their lifecycle until consumed.
      if (kind === 'diagonal' && n-1-touches.at(-1).index > touches.at(-1).index-start) return;
      const key = kind + ':' + Math.round(level / (a * 0.15)) + ':' + start;
      if (seen.has(key)) return; seen.add(key);
      let breakIndex = null, consumedAt = null, cutBeforeFormation = false;
      for (let i = start; i < n; i++) {
        const at = line.slope * i + line.intercept, close = bars[i].close - at;
        const held = i > start && close > rules.holdATR * a &&
          bars[i - 1].close > line.slope * (i - 1) + line.intercept + rules.holdATR * a;
        if (close > rules.breakATR * a || held) {
          if (i < formed) cutBeforeFormation = true;
          if (breakIndex === null) breakIndex = i;
        }
        if (breakIndex !== null && i > breakIndex && close < -rules.rejectionATR * a && consumedAt === null) consumedAt = i;
      }
      const state = cutBeforeFormation || consumedAt !== null ? 'consumed' : breakIndex !== null ? 'broken' : 'valid';
      const error = mean(touches.map(p => Math.abs(p.price - (line.slope * p.index + line.intercept)))) / a;
      candidates.push({ kind, ...line, start, formed, end: n - 1, level, state, breakIndex, consumedAt, touches, error });
    }
    for (const p of points) {
      const cluster = points.filter(q => Math.abs(q.price - p.price) <= rules.touchATR * a);
      consider({ slope: 0, intercept: median(cluster.map(q => q.price)) }, 'horizontal', cluster);
    }
    for (let i = 0; i < points.length - 1; i++) for (let j = i + 1; j < points.length; j++) {
      const first = points[i], last = points[j], span = last.index - first.index;
      if (span < rules.minimumSpan) continue;
      const slope = (last.price - first.price) / span;
      // In mirrored coordinates this is always descending resistance.
      // Mirroring back gives rising support for SHORT. Rising high channels
      // are not descending resistance, and cannot supply a breakout score.
      if (slope > -a * 0.015 || Math.abs(slope) > a * 0.25) continue;
      consider({ slope, intercept: first.price - slope * first.index }, 'diagonal', points.slice(i));
    }
    return candidates;
  }
  function volumeEvidence(bars, a, rules) {
    const baseBars = bars.slice(-28, -8), recent = bars.slice(-8);
    const complete = baseBars.length === 20 && [...baseBars, ...recent].every(c =>
      Number.isFinite(c.volume) && c.volume >= 0);
    const baseline = complete ? mean(baseBars.map(c => c.volume)) : null;
    if (!(baseline > 0)) return { complete: false, supported: false, baseline: null, ratio: null, impulseRatio: null, upwardShare: null, distribution: false };
    let up = 0, down = 0, impulseRatio = 0, impulseAt = null;
    for (let i = 0; i < recent.length; i++) {
      const c = recent[i], body = c.close - c.open, ratio = c.volume / baseline;
      if (body > 0) up += c.volume;
      else if (body < 0) down += c.volume;
      if (body > a * 0.2 && ratio > impulseRatio) { impulseRatio = ratio; impulseAt = c.time; }
    }
    const upwardShare = up + down > 0 ? up / (up + down) : 0;
    const sustainedBars=recent.slice(-4).filter(c=>c.close>c.open+a*.1&&c.volume>=baseline*1.15).length;
    const last = bars.at(-1), ratio = last.volume / baseline;
    const distribution = last.close < last.open - a * 0.45 && ratio >= 1.4 ||
      upwardShare < 0.38 && last.close < bars.at(-3).close;
    return { complete: true, supported: !distribution && impulseRatio >= rules.impulseVolume && upwardShare >= rules.upwardShare,
      baseline, ratio, impulseRatio, impulseAt, upwardShare, distribution,
      recentRatio: mean(recent.slice(-4).map(c => c.volume)) / baseline, sustainedBars };
  }
  function directionEvidence(bars, features, a) {
    const n = bars.length, last = bars.at(-1), recent = bars.slice(-12);
    const high = Math.max(...recent.map(c => c.high)), low = Math.min(...recent.map(c => c.low));
    const position = (last.close - low) / Math.max(high - low, a);
    const advance = (last.close - bars[Math.max(0, n - 9)].close) / a;
    const lateMove = (last.close - bars.at(-3).close) / a;
    const [low1, low2] = features.lows.slice(-2), [high1, high2] = features.highs.slice(-2);
    const higherLows = !!(low1 && low2 && low2.price > low1.price + a * 0.1);
    const higherHighs = !!(high1 && high2 && high2.price > high1.price + a * 0.1);
    const lowerLows = !!(low1 && low2 && low2.price < low1.price - a * 0.1);
    const recentHigh = features.highs.filter(p => p.index >= n - 18).at(-1);
    const reclaim = !!(recentHigh && last.close > recentHigh.price + a * 0.2 && advance >= 1);
    const falling = lateMove < -0.9 || last.close < bars.at(-2).low - a * 0.3;
    // Local momentum must not relabel a rebound inside a larger decline (or,
    // after mirroring, a pullback inside a larger advance).
    const context = bars.slice(-36), previousContext = context.slice(0, -12);
    const contextAdvance = (last.close - context[0].close) / a;
    const contextMean = mean(previousContext.map(c => c.close));
    const contextCeiling = Math.max(...previousContext.map(c => c.high));
    const contextReclaimed = last.close > contextCeiling + a * 0.2 ||
      higherLows && higherHighs && recentHigh && last.close > recentHigh.price + a * 0.2;
    const opposingContext = contextAdvance < -1 && last.close < contextMean - a * 0.5 && !contextReclaimed;
    // A lone bounce at the bottom of an ongoing decline is not a reversal.
    const confirmed = !falling && !opposingContext && (higherLows && advance >= 0.25 && position >= 0.55 ||
      advance >= 1 && position >= 0.72 && (!lowerLows || reclaim) || reclaim);
    const invalidation = low2 && low2.index >= n - 20 ? low2 : {
      price: Math.min(...bars.slice(-8).map(c => c.low)), index: n - 8, time: bars[Math.max(0, n - 8)].time
    };
    return { confirmed, falling, opposingContext, contextAdvance, contextReclaimed, higherLows, higherHighs, lowerLows, reclaim, advance, lateMove, position, invalidation };
  }
  function reversalEvidence(bars, features, observed, a, volume, rules) {
    const n=bars.length,last=bars.at(-1),low=features.lows.filter(p=>p.index>=n-10).at(-1);
    const high=low&&features.highs.filter(p=>p.index<low.index&&p.index>=n-24).at(-1);
    if(!high||!volume.complete)return {candidate:false};
    // A consumed swing cannot be recycled as a fresh reversal trigger.
    if(bars.slice(high.index+1,low.index).some(c=>c.close>high.price+a*rules.holdATR))return {candidate:false};
    const recovery=bars.slice(low.index+1),up=recovery.filter(c=>c.close>c.open).reduce((n,c)=>n+c.volume,0),
      down=recovery.filter(c=>c.close<c.open).reduce((n,c)=>n+c.volume,0);
    const impulse=Math.max(0,...recovery.filter(c=>c.close-c.open>a*.2).map(c=>c.volume/volume.baseline));
    const supported=impulse>=rules.impulseVolume&&up/(up+down||1)>=rules.upwardShare&&
      last.close>=bars.at(-2).close&&(last.close-low.price)/a>=1.5;
    const confirmed=last.close>high.price+a*rules.holdATR;
    const probing=observed.provisional&&observed.close>high.price+a*rules.holdATR&&
      observed.close>last.close&&Number.isFinite(observed.volume)&&observed.volume>=volume.baseline*1.05;
    return {candidate:supported&&(confirmed||probing),confirmed,probing,level:high.price,
      high,low,impulseRatio:impulse,upwardShare:up/(up+down||1)};
  }
  function publicLevel(level, bars, dir) {
    if (!level) return null;
    return { kind: level.kind, state: level.state, level: dir * level.level,
      slope: dir * level.slope, touches: level.touches.length, errorATR: level.error,
      formedAt: bars[level.formed].time, testedAt: level.touches.at(-1).time,
      brokenAt: level.breakIndex === null ? null : bars[level.breakIndex].time,
      consumedAt: level.consumedAt === null ? null : bars[level.consumedAt].time,
      points: [{ time: bars[level.start].time, index: level.start, price: dir * (level.slope * level.start + level.intercept) },
        { time: bars[level.end].time, index: level.end, price: dir * level.level }] };
  }
  function finish(signal, eligible, phase, pressure, reasons) {
    const score = eligible ? Math.min(99,signal.qualityScore) : Math.min(79,signal.qualityScore);
    return { ...signal, qualityScore:score, eligible, tier: eligible ? score >= 82 ? 'T1' : score >= 72 ? 'T2' : 'T3' : null,
      phase, stage: phase === 'prebreakout' ? (signal.side === 'LONG' ? '帶量逼近 · 尚未突破' : '帶量逼近 · 尚未跌破') :
        phase === 'probe' ? '突破試探 · 尚未收 K' : phase === 'reversal-probe' ? '放量反轉試探 · 尚未收 K' :
        phase === 'reversal' ? '放量反轉 · 已收復近期轉折' : phase === 'breakout' ? '已收 K 確認突破' :
          phase === 'continuation' ? (signal.side === 'LONG' ? '帶量上漲 · 強勢延續' : '帶量下跌 · 弱勢延續') : '待確認',
      pressure, reasons };
  }
  function evaluateClassic(input, options = {}) {
    const side = sideName(options.side), dir = side === 'LONG' ? 1 : -1;
    const rules = { ...CLASSIC_RULES, ...options.rules }, now = options.now ?? Date.now();
    const source = normalize(input, now).slice(-rules.historyBars), observed = source.at(-1);
    const closed = source.filter(c => !c.provisional && c.closed !== false);
    const base = { version: CLASSIC_VERSION, side, frame: options.frame || null, eligible: false, tier: null,
      phase: 'watch', stage: '待確認', qualityScore: null, pressure: null, target: null, invalidation: null,
      reasons: [], rejectionReasons: [], evaluatedAt: now, closedAt: closed.at(-1)?.time ?? null,
      observedAt: observed?.time ?? null, provisional: !!observed?.provisional };
    if (closed.length < rules.minimumBars) return { ...base, rejectionReasons: ['已收 K 歷史不足'] };
    const bars = mirror(closed, dir), a = trueRange(bars);
    if (!(a > 0)) return { ...base, rejectionReasons: ['有效波動資料不足'] };
    const features = pivots(bars, rules.pivotRadius), direction = directionEvidence(bars, features, a);
    const volume = volumeEvidence(bars, a, rules), levels = pressureLevels(bars, features, a, rules);
    const last = bars.at(-1), observedPrice = observed.close * dir, n = bars.length;
    const reversal=reversalEvidence(bars,features,{...observed,open:observed.open*dir,close:observedPrice},a,volume,rules);
    const projected = p => p.level + p.slope * (observed.provisional ? 1 : 0);
    const ahead = levels.filter(p => p.state === 'valid' && projected(p) >= observedPrice - a * .15)
      .sort((x,y) => projected(x)-projected(y) || y.touches.length-x.touches.length);
    // Prefer a tested horizontal ceiling inside the same actionable area.
    // A candle moving toward the NEXT ceiling must not stay attached to an old
    // lower swing. Live proximity is observation evidence, never a closed break.
    const horizontal = ahead.find(p => p.kind === 'horizontal' && projected(p)-observedPrice <= rules.nearATR*a);
    const oldAhead = levels.filter(p => p.state === 'valid' && p.level >= last.close-a*.15)
      .sort((x,y)=>Number(y.kind==='horizontal')-Number(x.kind==='horizontal') || x.level-y.level);
    const crossedLive = observed.provisional && oldAhead.find(p => last.close <= p.level+a*.15 &&
      observedPrice > projected(p)+a*rules.holdATR && (p.level-last.close)/a <= rules.nearATR);
    const pressure = horizontal || (crossedLive?.kind==='horizontal'?crossedLive:null) ||
      ahead.find(p=>projected(p)-observedPrice<=rules.nearATR*a) || crossedLive || ahead[0] || null;
    const gap = pressure ? (projected(pressure)-observedPrice)/a : null;
    const near = !!pressure && (gap >= -.15 && gap <= rules.nearATR || pressure===crossedLive);
    const closedNear = pressure && (pressure.level-last.close)/a <= rules.nearATR;
    // A confirmed reversal establishes a new volume regime. Old selloff volume
    // must not veto a newly recovered swing attacking a separately tested
    // horizontal ceiling. Keep the full-window evidence for auditability.
    if(near && pressure.kind==='horizontal' && direction.confirmed && reversal.confirmed &&
       reversal.candidate && n-1-reversal.low.index>=2 && !volume.distribution && !volume.supported){
      volume.previousUpwardShare=volume.upwardShare;
      volume.upwardShare=reversal.upwardShare;
      volume.supported=true;
      volume.window='confirmed-recovery';
      volume.windowStart=bars[reversal.low.index+1].time;
    }
    const broken = levels.filter(p => p.state === 'broken' && n-1-p.breakIndex <= rules.recentBreakBars &&
      last.close >= p.level-a*.15).sort((x,y)=>
        Number(y.kind==='horizontal')-Number(x.kind==='horizontal') || y.breakIndex-x.breakIndex)[0] || null;
    const failed = !near && !broken && !reversal.candidate && levels.some(p => p.state === 'consumed' && p.consumedAt !== null &&
      n - 1 - p.consumedAt <= 5 && last.close < p.level - a * 0.25);
    const stop = direction.invalidation, risk = (last.close - stop.price) / a, liveRisk=(observedPrice-stop.price)/a;
    const liveFailure = observedPrice < stop.price - a * 0.2 ||
      observed.provisional && observedPrice < last.close - a * 0.9;
    const lastRange = Math.max(last.high - last.low, a * 0.1);
    const wickExhausted=(last.high-last.close)/lastRange>0.55&&last.high-last.close>a*.7;
    const wickRecovered=wickExhausted&&observed.provisional&&observedPrice>=last.high+a*.2;
    const exhausted=wickExhausted||risk>rules.maximumRiskATR;
    const breakoutDistance = broken ? (observedPrice - broken.level) / a : null;
    const chase = !near && broken && breakoutDistance > 2;
    // Activation must originate from a verified multi-test liquidity level.
    // Momentum alone, without that origin, is not an OX classic opportunity.
    let phase = near ? observed.provisional && observedPrice > projected(pressure) + a * rules.holdATR ? 'probe' : 'prebreakout' :
      broken ? 'breakout' : 'watch';
    const trigger = near ? pressure : broken;
    // Lines in the trigger zone describe confluence, not separate obstacles.
    // Rising diagonal projections above ALL their observed tests are not a
    // historical objective. Keep them as patterns, not invented price targets.
    const zoneEdge = trigger ? projected(trigger) : observedPrice;
    const target = ahead.find(p => p!==trigger && projected(p)>zoneEdge+a*.65 && projected(p)>observedPrice+a*.15 &&
      (p.kind==='horizontal' || projected(p)<=Math.max(...p.touches.map(t=>t.price))+a*.35)) || null;
    let publicTarget = publicLevel(target,bars,dir), targetPrice = target ? projected(target) : null;
    let contextVolume = null;
    if(options.contextBars?.length) {
      const context=mirror(normalize(options.contextBars,now).filter(c=>!c.provisional&&c.closed!==false).slice(-rules.historyBars),dir);
      if(context.length>=rules.minimumBars){
        const ca=trueRange(context), cf=pivots(context,rules.pivotRadius);
        contextVolume=volumeEvidence(context,ca,rules);
        // Actual higher-frame swing highs are historical references, not a
        // promise of supply or a replacement for a closer valid obstacle.
        const points=cf.highs.filter(p=>p.price>zoneEdge+a*.65 &&
          !context.slice(p.index+1).some(c=>c.close>p.price+ca*rules.holdATR)).sort((x,y)=>x.price-y.price);
        const cp=points[0];
        if(cp && (targetPrice===null||cp.price<targetPrice)){
          targetPrice=cp.price;
          publicTarget={kind:'historical-swing',state:'reference',level:dir*cp.price,slope:0,touches:1,
            frame:options.contextFrame,formedAt:cp.confirmedAt,testedAt:cp.time,brokenAt:null,consumedAt:null,
            points:[{time:cp.time,index:cp.index,price:dir*cp.price}]};
        }
      }
    }
    const space = targetPrice===null ? null : (targetPrice-observedPrice)/a;
    const spaceOK = space === null || space >= 0.65;
    // A nearby historical objective cannot justify a near-perfect score when
    // the same structure needs substantially more room to its invalidation.
    const roomRisk = space === null ? null : space / Math.max(liveRisk, .01);
    const structureReady = phase !== 'watch' && (!near || closedNear) && direction.confirmed && !failed && !liveFailure && !exhausted && !chase &&
      risk > 0 && spaceOK;
    // T2/T3 are directional observations, not miniature copies of the strict
    // entry gate. Missing activation/impulse alone must not empty those lists.
    const observationDirection = !direction.falling && (reversal.candidate||!direction.opposingContext) &&
      (direction.advance > 0 && direction.position >= 0.4 || direction.higherLows && direction.lateMove >= -0.2 && direction.position >= 0.4) &&
      (!direction.lowerLows || direction.reclaim || direction.contextReclaimed || reversal.candidate);
    const observationEvidence = { liquidity:!!pressure || !!broken,
      directionalVolume:volume.complete && !volume.distribution && volume.upwardShare >= 0.5 &&
        volume.impulseRatio >= 1.05 && direction.advance >= 0.5,
      priceStructure:direction.higherLows && direction.higherHighs || direction.reclaim || reversal.candidate,
      reversal:reversal.candidate };
    const actionableLevel=(near && trigger?.touches.length>=2 || broken && n-1-broken.breakIndex<=rules.recentBreakBars);
    const activeFlow=observationEvidence.directionalVolume && volume.recentRatio>=1.1 && direction.advance>=1;
    const observationEligible = observationDirection && (actionableLevel || activeFlow || reversal.candidate) &&
      volume.complete && !volume.distribution &&
      !failed && !liveFailure && (!exhausted||wickRecovered&&risk<=rules.maximumRiskATR) && (!chase||reversal.candidate) && risk > 0;
    // Score distinct completed evidence rather than stacking a high base with
    // volume counted twice. Multiple tests and a large impulse alone must not
    // make a flat setup look nearly perfect; right-side structure still matters.
    const testedLevel = trigger ? Math.min(4, trigger.touches.length) * 3 : 0;
    const trendQuality = (direction.higherLows ? 6 : 0) + (direction.higherHighs ? 4 : 0) +
      (direction.position >= .72 ? 3 : 0);
    const volumeQuality = volume.supported ? Math.min(9, 5 + 2 * Math.log2(Math.max(1, volume.impulseRatio))) -
      (volume.sustainedBars<2?3:0) : 0;
    const activationQuality = near ? Math.max(0, 8 * (1 - Math.max(0, gap) / rules.nearATR)) : broken ? 4 : 0;
    const confirmedBreakoutQuality = phase === 'breakout' && volume.supported && volume.impulseRatio >= 4 &&
      volume.upwardShare >= .7 ? Math.min(12, 5 + 3 * Math.log2(volume.impulseRatio / 3)) : 0;
    const pressureReadyQuality = phase === 'prebreakout' && trigger?.touches.length >= 3 && near && gap <= .6 &&
      volume.impulseRatio >= 2 && volume.upwardShare >= .75 ? 6 : 0;
    let qualityScore = Math.round(clamp(40 + testedLevel + trendQuality + volumeQuality + activationQuality +
      (broken && phase === 'breakout' ? 5 : 0) + confirmedBreakoutQuality + pressureReadyQuality +
      (publicTarget && spaceOK ? 4 : 0), 0, 100));
    const horizontalReady=trigger?.kind==='horizontal' && volume.supported &&
      (near || phase==='breakout'&&breakoutDistance<=1.2);
    const locationAdjustment=(horizontalReady?8+({'1H':0,'4H':2,'1D':4,'1W':6}[options.frame]||0):0) +
      (roomRisk!==null&&roomRisk>=1.5&&contextVolume?.supported?4:0) -
      (roomRisk!==null&&roomRisk<1?7+Math.round((1-roomRisk)*10):0) -
      (breakoutDistance>1.2&&!near&&!reversal.candidate?Math.min(14,Math.round((breakoutDistance-1.2)*7)):0);
    qualityScore=Math.max(0,qualityScore+locationAdjustment);
    if(!publicTarget)qualityScore=Math.min(84,qualityScore);
    if(volume.sustainedBars<2)qualityScore=Math.min(84,qualityScore);
    // An unfinished crossing has not held at a close and cannot enter T1.
    if (phase === 'probe') qualityScore = Math.min(79, qualityScore - 6 - Math.min(10,
      Math.round(Math.max(0, (observedPrice - pressure.level) / a - 0.45) * 4)));
    const rejectionReasons = [];
    if (!direction.confirmed) rejectionReasons.push(direction.falling ? '當下結構轉跌' : reversal.candidate?'較大級別轉向仍待確認':'右側上攻結構不足');
    if (direction.opposingContext) rejectionReasons.push(reversal.candidate?'較大跌勢尚未完全收復，近期轉折正在轉強':'較大結構仍逆向，局部反彈／回檔不算轉向');
    if (chase&&!reversal.candidate) rejectionReasons.push('突破後已離開流動性，禁止追高／追空');
    if (!volume.complete) rejectionReasons.push('成交量歷史不足');
    else if (!volume.supported) rejectionReasons.push(volume.distribution ? '下跌放量／派發' : reversal.candidate?'近八根整體同向量待確認，低點之後放量已成立':'上攻量能不足');
    if (phase === 'watch'&&!reversal.candidate) rejectionReasons.push('沒有接近有效壓力或強勢啟動');
    if (failed) rejectionReasons.push('近期突破失敗，壓力已上下貫穿');
    if (liveFailure) rejectionReasons.push('最新價格已破壞結構');
    if (exhausted) rejectionReasons.push(wickRecovered&&risk<=rules.maximumRiskATR?'最新價格已收復前一根回落，等待收 K':'上攻回落或已走離可觀察位置');
    if (!spaceOK) rejectionReasons.push('下一個目標空間不足');
    if (phase === 'probe') rejectionReasons.push('最新突破試探尚未收 K');
    const useReversal=reversal.candidate&&!structureReady&&!near;
    if(useReversal)phase=reversal.confirmed?'reversal':'reversal-probe';
    const publicPressure = useReversal?{kind:'swing',state:reversal.confirmed?'broken':'valid',level:dir*reversal.level,
      slope:0,touches:1,formedAt:reversal.high.confirmedAt,testedAt:reversal.high.time,
      brokenAt:reversal.confirmed?last.time:null,consumedAt:null,
      points:[{time:reversal.high.time,index:reversal.high.index,price:dir*reversal.level},{time:observed.time,index:n-1+(observed.provisional?1:0),price:dir*reversal.level}]}:publicLevel(trigger || pressure, bars, dir);
    const reasons = [side === 'LONG' ? '右側價格向上推進' : '右側價格向下推進'];
    if (publicPressure) reasons.push((publicPressure.kind === 'swing' ? '近期轉折' : publicPressure.kind === 'horizontal' ? '水平' : '斜線') +
      (side === 'LONG' ? '壓力' : '支撐') + ' · ' + publicPressure.touches + ' 次獨立測試 · ' +
      (publicPressure.state === 'valid' ? '尚未有效突破' : '已收 K 越過'));
    if (gap !== null && near) reasons.push('距觸發 ' + Math.max(0, gap).toFixed(2) + ' ATR');
    if(volume.window==='confirmed-recovery')reasons.push('已確認反轉後量能 · 原八根同向量 '+(volume.previousUpwardShare*100).toFixed(0)+'%');
    if (volume.complete) reasons.push((side === 'LONG' ? '上攻' : '下攻') + '量比 ' + volume.impulseRatio.toFixed(2) +
      'x · 同向量 ' + (volume.upwardShare * 100).toFixed(0) + '%');
    if(horizontalReady)reasons.push('有效水平流動性啟動 · 優先觀察');
    if(publicTarget?.frame)reasons.push(publicTarget.frame+' 歷史價格參考 · '+publicTarget.level);
    if (!publicTarget) reasons.push('下一個歷史目標尚未辨識 · 不假設無限空間');
    else if(roomRisk<1)reasons.push('目標空間僅為結構失效距離 '+roomRisk.toFixed(2)+' 倍 · 分數折減');
    // Observations display the features that actually earned their place,
    // alongside missing confirmations. A distant valid level is still evidence,
    // but it must not be described as an imminent, volume-confirmed breakout.
    const framePrefix=options.frame ? options.frame+' ' : '';
    const matchedReasons=[];
    if(volume.window==='confirmed-recovery')matchedReasons.push(framePrefix+'已確認反轉後同向量 '+(volume.upwardShare*100).toFixed(0)+'% · 原八根 '+(volume.previousUpwardShare*100).toFixed(0)+'%');
    if(horizontalReady)matchedReasons.push(framePrefix+'有效水平流動性啟動 · 優先觀察');
    if(publicTarget?.frame)matchedReasons.push(publicTarget.frame+' 歷史價格參考 · '+publicTarget.level);
    if(!publicTarget)matchedReasons.push('下一個歷史目標尚未辨識 · 不假設無限空間');
    if (observationDirection) matchedReasons.push(framePrefix+(direction.advance>0 ?
      (side==='LONG'?'價格向上推進':'價格向下推進') :
      (side==='LONG'?'低點墊高，當下未轉弱':'高點降低，當下未轉強')));
    if (observationEvidence.liquidity && publicPressure && !useReversal) matchedReasons.push(framePrefix+
      (publicPressure.kind==='horizontal'?'水平':'斜線')+(side==='LONG'?'壓力':'支撐')+' · '+
      publicPressure.touches+' 次獨立測試 · '+(publicPressure.state==='valid'?'仍有效':'已收 K 越過'));
    if (direction.higherLows&&direction.higherHighs||direction.reclaim) matchedReasons.push(framePrefix+(direction.reclaim ?
      (side==='LONG'?'已收復近期高點':'已跌破近期低點') :
      (side==='LONG'?'高低點向上移動':'高低點向下移動')));
    if(useReversal)matchedReasons.push(framePrefix+(reversal.confirmed?'已收復近期轉折':'正在突破近期轉折，等待收 K')+' · '+(dir*reversal.level),
      framePrefix+'低點之後已收 K 同向放量 · '+reversal.impulseRatio.toFixed(2)+'x');
    if(wickRecovered)matchedReasons.push(framePrefix+'最新價格已收復前一根上影線，等待收 K 確認');
    if (volume.supported || observationEvidence.directionalVolume) matchedReasons.push(framePrefix+
      (volume.supported?'同向放量已確認':'同向量能開始增加，尚未達完整放量門檻')+' · '+volume.impulseRatio.toFixed(2)+'x');
    if (near) matchedReasons.push(framePrefix+'距有效流動性 '+Math.max(0,gap).toFixed(2)+' ATR');
    const strictEligible=structureReady && volume.supported && phase !== 'probe';
    let completenessScore=strictEligible?qualityScore:qualityScore-(volume.supported?0:12)-(direction.confirmed?0:8)-(near?0:8);
    if(useReversal)completenessScore=Math.round(Math.max(completenessScore,55+Math.min(12,reversal.impulseRatio*3)+(reversal.confirmed?8:4)+(reversal.upwardShare>=.7?6:0)));
    const signal = { ...base, riskATR:risk, roomRisk, locationAdjustment, horizontalReady, contextVolume, breakoutDistanceATR:breakoutDistance, wickRecovered, qualityScore:completenessScore, atr: a, direction, volume, reversal, structureReady, observationEligible, observationEvidence, distanceATR: gap,
      invalidation: { level: dir * stop.price, time: stop.time }, target: publicTarget,
      levels: levels.map(p => publicLevel(p, bars, dir)), matchedReasons, rejectionReasons,
      priority: phase === 'prebreakout' || phase === 'probe' ? 0 : 1 };
    return finish(signal, strictEligible, phase, publicPressure, reasons);
  }
  function evaluateFrames(frames, { side = 'long', setupFrame, triggerFrame, confirmationFrame, contextFrame, now = Date.now(), rules } = {}) {
    contextFrame ||= ({'1H':'4H','4H':'1D','1D':'1W'})[setupFrame];
    const setup = evaluateClassic(frames[setupFrame] || [], { side, frame: setupFrame, now, rules,
      contextFrame,contextBars:frames[contextFrame] });
    if (!triggerFrame || triggerFrame === setupFrame) return setup;
    const trigger = evaluateClassic(frames[triggerFrame] || [], { side, frame: triggerFrame, now, rules });
    // The trigger frame need not have its own nearby ceiling, but failures,
    // distribution and exhaustion may never be waived by a larger frame.
    const triggerVeto = ['最新價格已破壞結構', '近期突破失敗，壓力已上下貫穿', '上攻回落或已走離可觀察位置'];
    const sameTriggerZone=setup.pressure&&trigger.target&&
      Math.abs(setup.pressure.level-trigger.target.level)<=Math.max(setup.atr,trigger.atr)*.65;
    const triggerSpaceBlocked = !sameTriggerZone && trigger.rejectionReasons.includes('下一個目標空間不足');
    const confirmation = confirmationFrame && confirmationFrame !== triggerFrame && confirmationFrame !== setupFrame &&
      frames[confirmationFrame]?.length ? evaluateClassic(frames[confirmationFrame], { side, frame:confirmationFrame, now, rules }) : null;
    const confirmationBlocked = !!(confirmation?.volume?.distribution || confirmation?.direction?.falling);
    const triggerOK = trigger.direction?.confirmed && trigger.volume?.supported &&
      !trigger.volume.distribution && !triggerVeto.some(reason => trigger.rejectionReasons.includes(reason));
    const eligible = setup.eligible && triggerOK && !triggerSpaceBlocked && !confirmationBlocked;
    // A daily signal from several candles ago does not make a flat or fading
    // 4H/1H market a current upward observation. A fresh swing recovery may
    // qualify through its own recent volume/structure evidence.
    const triggerObservationReady = trigger.direction?.confirmed && (
      trigger.volume?.supported || trigger.observationEvidence?.directionalVolume ||
      trigger.direction.advance >= 0.65 && trigger.volume?.upwardShare >= 0.5 && trigger.volume?.recentRatio >= 0.8
    ) || trigger.reversal?.candidate;
    // An intact, volume-supported setup can still be forming while the
    // smaller frame is flat. Keep it as low-completeness observation; do not
    // require the same trigger confirmation as a ready entry.
    const formingSetup=(setup.eligible||setup.observationEligible) && setup.direction?.confirmed && setup.volume?.supported &&
      setup.pressure?.state==='valid' && setup.pressure.touches>=2 &&
      setup.distanceATR>=-.15 && setup.distanceATR<=1.2;
    const quietTrigger=trigger.volume?.complete && trigger.direction?.advance>=-.25 &&
      trigger.direction?.lateMove>=-.3 && trigger.direction?.position>=.4 &&
      trigger.volume?.upwardShare>=.45 && trigger.volume?.recentRatio>=.6;
    const triggerClear=!trigger.direction?.falling && !trigger.direction?.opposingContext &&
      !trigger.volume?.distribution && !triggerVeto.some(reason=>trigger.rejectionReasons.includes(reason));
    // A smaller-frame pullback does not invalidate the still-confirmed setup
    // frame. It remains observation-only, with a low score and explicit reason.
    const setupStillIntact=formingSetup && setup.volume.recentRatio>=.6 &&
      trigger.volume?.complete && !trigger.direction?.opposingContext &&
      trigger.direction?.position>=.35 && trigger.direction?.advance>=-.5;
    const developingObservation=setupStillIntact && (!triggerObservationReady||!triggerClear) &&
      (quietTrigger||trigger.direction?.advance>=0);
    // Broader formation watch pool: a real, unconsumed boundary is mandatory.
    // T3 may lack the final push/volume expansion; it must not reuse the T1 gate.
    const formingBoundary=setup.pressure?.state==='valid' && setup.pressure.touches>=2 &&
      setup.distanceATR>=-.15 && setup.distanceATR<=3 &&
      setup.volume?.complete && !setup.volume.distribution && setup.volume.recentRatio>=.5 &&
      setup.volume.upwardShare>=.4 && !setup.direction?.falling && !setup.direction?.opposingContext &&
      setup.direction?.advance>=-.35 && setup.direction?.position>=.4 &&
      !setup.rejectionReasons.some(r=>['最新價格已破壞結構','近期突破失敗，壓力已上下貫穿',
       '突破後已離開流動性，禁止追高／追空','上攻回落或已走離可觀察位置'].includes(r));
    const earlyObservation=!eligible && !developingObservation &&
      !(setup.observationEligible&&triggerObservationReady&&triggerClear) && formingBoundary &&
      trigger.volume?.complete && !trigger.volume.distribution && !trigger.direction?.falling &&
      !trigger.direction?.opposingContext && trigger.direction?.advance>=-.35 &&
      trigger.direction?.position>=.4 && trigger.volume?.upwardShare>=.4;
    const partialObservation=developingObservation||earlyObservation;
    const observationEligible = !confirmationBlocked && (partialObservation ||
      setup.observationEligible && triggerObservationReady && trigger.volume?.complete &&
      !trigger.direction?.falling && (!trigger.direction?.opposingContext||trigger.reversal?.candidate) && !trigger.volume?.distribution &&
      !triggerVeto.some(reason => trigger.rejectionReasons.includes(reason)));
    const reasons = [setupFrame + ' 結構＋' + triggerFrame + (setup.side === 'LONG' ? ' 上攻確認' : ' 下攻確認'), ...setup.reasons.filter(r => !r.includes('量比')),
      ...trigger.reasons.filter(r => r.includes('量比'))];
    // Score partial observations from current evidence. Capping a 100-point
    // daily setup at 79 made very different, often weak candidates all tie at
    // 79 and pushed fresh recoveries below them by scan order.
    // Keep partial-condition scores below T1, but leave enough headroom to
    // distinguish an ordinary probe from a fresh, volume-backed reversal.
    // Previously most otherwise different observations saturated at 79.
    const reversalBonus=['reversal','reversal-probe'].includes(setup.phase) ?
      Math.min(14,4+6*Math.log2(Math.max(1,(setup.reversal?.impulseRatio||1)/1.35))) : 0;
    const observationScore=Math.round(clamp(41+Math.min(8,(setup.pressure?.touches||0)*2)+
      (setup.direction?.confirmed?4:0)+(setup.volume?.supported?4:0)+
      (trigger.direction?.confirmed?7:0)+(trigger.volume?.supported?6:0)+
      (trigger.direction?.position>=0.75?3:0)+reversalBonus+
      Math.min(4,Math.log2(Math.max(1,trigger.volume?.impulseRatio||1)))-
      (triggerSpaceBlocked?8:0)-(confirmationBlocked?8:0)+(setup.locationAdjustment||0),0,79));
    const signal = { ...setup, observationEligible:!!observationEligible,
      qualityScore:eligible?setup.qualityScore:developingObservation?Math.min(triggerClear?59:54,observationScore):earlyObservation?Math.round(
        32+Math.min(6,setup.pressure.touches*1.5)+Math.max(0,6*(1-setup.distanceATR/3))+
        (setup.volume.supported?4:0)+(trigger.direction.confirmed?3:0)+(trigger.volume.supported?3:0)):observationScore,
      developingObservation:!!partialObservation,
      observationClass:earlyObservation?'forming-boundary':developingObservation?'setup-awaits-trigger':null,
      triggerFrame, triggerClosedAt: trigger.closedAt, triggerVolume: trigger.volume,
      matchedReasons:[...(setup.matchedReasons||[]),
        ...(earlyObservation?[setupFrame+' 有效邊界 · '+setup.pressure.touches+' 次獨立測試 · 距離 '+setup.distanceATR.toFixed(2)+' ATR']:[]),
        ...(developingObservation?[setupFrame+' 型態與量能仍有效，'+triggerFrame+' 回落／確認不足，僅列低分觀察']:[]),
        ...(trigger.direction?.confirmed?[triggerFrame+' 同向結構已確認']:[]),
        ...(trigger.volume?.supported?[triggerFrame+' 同向放量已確認 · '+trigger.volume.impulseRatio.toFixed(2)+'x']:[])],
      rejectionReasons: eligible ? [] : [...setup.rejectionReasons,
        ...(triggerOK ? [] : [triggerFrame + ' 當下方向或上攻量能未確認']),
        ...(earlyObservation?['型態觀察：尚缺接近臨界點、同向放量或小級別啟動確認']:[]),
        ...(developingObservation?[triggerFrame+' '+(trigger.volume.distribution?'反向放量，等待重新上攻':triggerClear?'啟動尚未確認':'回落未完成，等待重新上攻')]:[]),
        ...(triggerSpaceBlocked ? [triggerFrame + ' 下一個目標空間不足'] : []),
        ...(confirmationBlocked ? [confirmationFrame + ' 短線方向或同向量能轉弱'] : [])] };
    return finish(signal, !!eligible, setup.phase, setup.pressure, reasons);
  }
  function qualifyClassicRow(row, side = 'long', { observations = false } = {}) {
    const key = sideName(side).toLowerCase(), signal = row?.classic?.[key] || row?.classic;
    return signal?.version === CLASSIC_VERSION && (signal.eligible && signal.tier || observations && signal.observationEligible) &&
      signal.side === sideName(side) ? signal : null;
  }
  function compareClassic(a, b) {
    const x = a.classicSignal || a, y = b.classicSignal || b;
    return (y.qualityScore || 0) - (x.qualityScore || 0) ||
      Number(!!y.reversal?.candidate)-Number(!!x.reversal?.candidate) || (x.priority ?? 1) - (y.priority ?? 1);
  }
  function compactClassic(signal) {
    if (!signal.eligible && !signal.observationEligible) return {version:signal.version,eligible:false,side:signal.side,
      frame:signal.frame,tier:null,phase:signal.phase,stage:signal.stage,qualityScore:null,
      closedAt:signal.closedAt,rejectionReasons:signal.rejectionReasons};
    const {levels,...decision}=signal;
    return decision;
  }
  function rankClassicTiers(rows, { side, limits = CLASSIC_TIER_LIMITS, compare = compareClassic } = {}) {
    const seen = new Set();
    const pool = rows.filter(row => {
      const signal = row.classicSignal;
      return signal?.version === CLASSIC_VERSION && (signal.eligible || signal.observationEligible) &&
        (!side || signal.side === sideName(side));
    }).sort(compare).filter(row => !seen.has(row.symbol) && seen.add(row.symbol));
    // Only full T1 quality can occupy T1. Its unused slots stay empty.
    // T2/T3 are the next two ranked groups, not isolated score buckets: a T1
    // overflow or a T3-quality candidate may fill the remaining ranked slots.
    const t1 = pool.filter(row => row.classicSignal.eligible && row.classicSignal.tier === 'T1').slice(0, limits.T1);
    const selected = new Set(t1.map(row => row.symbol));
    const rest = pool.filter(row => !selected.has(row.symbol));
    const t2 = rest.slice(0, limits.T2);
    const t3 = rest.slice(t2.length, t2.length + limits.T3);
    return [t1, t2, t3].flatMap((group, i) => group.map(row => ({ ...row,
      qualityTier: row.classicSignal.tier, tier: 'T' + (i + 1), displayTier: 'T' + (i + 1),
      observationOnly:!row.classicSignal.eligible,
      stage:row.classicSignal.eligible || ['reversal','reversal-probe','probe'].includes(row.classicSignal.phase) ? row.classicSignal.stage : '同向觀察 · 尚未確認',
      rankStatus: row.classicSignal.eligible || ['reversal','reversal-probe','probe'].includes(row.classicSignal.phase) ? row.classicSignal.stage : '同向觀察 · 尚未通過完整入選條件' })));
  }
  root.OXClassic = Object.freeze({ CLASSIC_VERSION, CLASSIC_TIER_LIMITS, CLASSIC_RULES, evaluateClassic, evaluateFrames, qualifyClassicRow, compareClassic, compactClassic, rankClassicTiers });
})(globalThis);
