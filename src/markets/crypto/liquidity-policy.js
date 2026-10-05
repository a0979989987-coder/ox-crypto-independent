// Absolute USDT turnover complements relative candle volume. A tiny baseline
// can produce a large volume ratio without the money needed for a top tier.
// This policy is crypto-only; stock turnover uses different markets and units.
(function(root) {
  const BANDS = Object.freeze([
    { minimum:10000000, cap:99 },
    { minimum:3000000, cap:89 },
    { minimum:1000000, cap:79 },
    { minimum:300000, cap:69 },
    { minimum:0, cap:54 }
  ].map(Object.freeze));
  function apply(signal, turnover) {
    if (!signal) return signal;
    const value=Number(turnover), known=turnover!==null&&turnover!==undefined&&turnover!==''&&Number.isFinite(value)&&value>0;
    const cap=known?BANDS.find(b=>value>=b.minimum).cap:54;
    const rawScore=signal.money?.rawScore??signal.qualityScore;
    const rawTier=signal.money?.rawTier??signal.tier;
    const qualityScore=Number.isFinite(rawScore)?Math.min(cap,rawScore):null;
    // Liquidity never upgrades a setup or makes an unqualified shape eligible.
    const tier=signal.eligible&&qualityScore!==null?
      rawTier==='T1'&&qualityScore>=82?'T1':qualityScore>=72&&rawTier!=='T3'?'T2':'T3':null;
    const reason=!known?'24H 成交額尚未確認，不列 T1，評分上限 54':
      value<3000000?`24H 成交額未達 300 萬 USDT，不列 T1，評分上限 ${cap}`:
      rawScore>cap?`24H 成交額限制，評分上限 ${cap}`:null;
    return {...signal,qualityScore,tier,money:{quoteVol:known?value:null,rawScore,rawTier,cap,reason}};
  }
  root.OXCryptoLiquidity=Object.freeze({ BANDS, apply });
})(globalThis);
