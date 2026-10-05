// Compatibility boundary for the native OX runtime. Eligibility and tiers are
// calculated by the shared OX 經典 engine, then constrained by crypto turnover.
const OXEngine = {
  withTurnover(row, turnover) {
    const classic=Object.fromEntries(Object.entries(row.classic||{}).map(([side,s])=>[side,OXCryptoLiquidity.apply(s,turnover)]));
    const signal=OXCryptoLiquidity.apply(row.classicSignal,turnover);
    return signal?{...row,...this.describe(signal,classic),quoteVol:signal.money.quoteVol}:row;
  },
  analyzeCandles(candles, options = {}) {
    const classic = {
      long: OXClassic.evaluateClassic(candles, { ...options, side: 'long' }),
      short: OXClassic.evaluateClassic(candles, { ...options, side: 'short' })
    };
    const eligible = Object.values(classic).filter(s => s.eligible || s.observationEligible).sort(OXClassic.compareClassic);
    const signal = eligible[0] || Object.values(classic).find(s => s.direction?.confirmed) || classic.long;
    return this.describe(signal, classic);
  },
  describe(signal, classic = { [signal.side.toLowerCase()]: signal }) {
    const volume = signal.volume || {}, direction = signal.direction || {}, score = signal.qualityScore;
    const side = signal.eligible || signal.observationEligible ? signal.side : direction.confirmed ? signal.side : 'NEUTRAL';
    return {
      classic:Object.fromEntries(Object.entries(classic).map(([key,s])=>[key,OXClassic.compactClassic(s)])),
      classicSignal: OXClassic.compactClassic(signal), eligible: signal.eligible, side, oxScore: score,
      setupName: 'OX 經典 · ' + (signal.eligible ? signal.stage : '同向觀察'), statusText: signal.eligible ? signal.stage : '同向觀察 · 尚未通過完整條件',
      tier: signal.tier?.toLowerCase() || 'none',
      triggerActive: signal.eligible && ['breakout', 'continuation'].includes(signal.phase),
      triggerType: signal.phase === 'breakout' ? '有效突破' : signal.phase === 'continuation' ? '強勢延續' : '',
      reasons: signal.eligible ? signal.reasons : [...(signal.matchedReasons||[]),...signal.rejectionReasons],
      flowScore: volume.supported ? Math.round(Math.min(100, 45 + 7*Math.log2(Math.max(1,volume.recentRatio||1)) + 7*(volume.sustainedBars||0) + 15*(volume.upwardShare||0))) : 0,
      structScore: direction.confirmed ? score : 0, setupScore: signal.structureReady ? score : 0,
      volRatio1h: volume.ratio ?? null, volRatio4h: volume.recentRatio ?? null,
      isSurge: signal.eligible && volume.supported,
      swingHigh: signal.side === 'LONG' ? signal.pressure?.level || signal.target?.level || 0 : signal.invalidation?.level || 0,
      swingLow: signal.side === 'SHORT' ? signal.pressure?.level || signal.target?.level || 0 : signal.invalidation?.level || 0,
      structureLabel: direction.higherLows ? (signal.side==='LONG'?'右側低點墊高':'右側高點降低') :
        direction.reclaim ? (signal.side==='LONG'?'右側轉強':'右側轉弱') : signal.stage,
      t1Fit: score ?? 0, t2Fit: score ?? 0, t3Fit: score ?? 0,
      setupProgress: score ?? 0, signalConfidence: signal.eligible ? score : 0
    };
  },
  computeLiquidity(ticker, allTickers = []) {
    // Turnover is a tradability/display measure, not pressure liquidity.
    const quoteVol = num(ticker?.usdtVolume), sorted = allTickers.map(t => num(t.usdtVolume)).sort((a, b) => b - a);
    const rank = sorted.indexOf(quoteVol), percentile = sorted.length ? (1 - Math.max(0, rank) / sorted.length) * 100 : 0;
    return { score: Math.round(percentile), percentileStr: (100 - percentile).toFixed(1), quoteVol, penaltyApplied: false };
  },
  computeRelativeStrength(ticker, btcTicker) {
    const diff = num(ticker?.change24h) - num(btcTicker?.change24h);
    return { score: clamp(Math.round(50 + diff * 200)), diffBtcPct: (diff * 100).toFixed(2),
      isOutperforming: diff > 0.02, isUnderperforming: diff < -0.02 };
  },
  computeMoneyFlow(candles) {
    const row = this.analyzeCandles(candles), volume = row.classicSignal.volume || {};
    return { score: row.flowScore, volRatio1h: row.volRatio1h, volRatio4h: row.volRatio4h,
      isSurge: row.isSurge, healthyLongVol: row.classic.long.volume?.supported === true,
      healthyShortVol: row.classic.short.volume?.supported === true, classic: row.classic, volume };
  },
  computeStructure(candles) {
    const row = this.analyzeCandles(candles), d = row.classicSignal.direction || {};
    return { score: row.structScore, side: row.side, swingHigh: row.swingHigh, swingLow: row.swingLow,
      isHHHL: row.side === 'LONG' && d.higherLows && d.higherHighs,
      isLHLL: row.side === 'SHORT' && d.higherLows && d.higherHighs, classic: row.classic, classicSignal: row.classicSignal };
  },
  evaluateSetupMatch(candles, structure) {
    const row = structure?.classicSignal ? this.describe(structure.classicSignal, structure.classic) : this.analyzeCandles(candles);
    return { setupName: row.setupName, setupScore: row.setupScore, side: row.side, reasons: row.reasons, classicSignal: row.classicSignal };
  },
  detectTrigger(candles, structure) {
    const signal = structure?.classicSignal || this.analyzeCandles(candles).classicSignal;
    return { active: signal.eligible && ['breakout', 'continuation'].includes(signal.phase), type: signal.stage, classicSignal: signal };
  },
  computeTierFits(liq, flow, structure, setup) {
    const signal = setup?.classicSignal, score = signal?.qualityScore ?? 0;
    return { t1Fit: score, t2Fit: score, t3Fit: score, setupProgress: score, signalConfidence: signal?.eligible ? score : 0 };
  },
  classifyLifecycle(liq, flow, structure, setup) {
    const signal = setup?.classicSignal;
    return { tier: signal?.eligible ? signal.tier.toLowerCase() : 'none', statusText: signal?.stage || '待確認' };
  }
};
