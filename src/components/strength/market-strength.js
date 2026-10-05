function classifyStrength(raw) {
  const v = clamp(Math.round(raw));
  if (v < 40) return { display: v, label: "弱", pos: v };
  if (v < 65) return { display: v, label: "中", pos: v };
  return { display: v, label: "強", pos: v };
}

function qualitative(v, low = 45, high = 65) {
  if (!Number.isFinite(v)) return "等待";
  if (v < low) return "偏弱";
  if (v >= high) return "強";
  return "普通";
}

function calculateBTCvsAltStrength() {
  const cfg = BTC_ALT_STRENGTH_CONFIG;
  const btcA = state.analyzedCache.get("BTCUSDT");
  const btcTicker = state.btcTicker;
  const alts = Array.from(state.analyzedCache.values()).filter(c =>
    !benchmarkSymbols.has(c.symbol) &&
    isCryptoSymbolAllowed(c.symbol) &&
    num(c.quoteVol || c.ticker?.usdtVolume) >= cfg.liquidityFloor
  );

  const btcRet = {
    h1: num(btcA?.ret1h),
    h4: num(btcA?.ret4h),
    h24: Number.isFinite(Number(btcA?.ret24h)) ? num(btcA?.ret24h) : num(btcTicker?.change24h)
  };
  const w = cfg.momentumWeights;
  const composite = r => num(r.h1)*w.h1 + num(r.h4)*w.h4 + num(r.h24)*w.h24;
  const btcMomentum = composite(btcRet);

  const altRows = alts.map(c => ({
    c,
    h1: num(c.ret1h),
    h4: num(c.ret4h),
    h24: Number.isFinite(Number(c.ret24h)) ? num(c.ret24h) : num(c.change24h)
  }));
  altRows.forEach(r => { r.composite = composite(r); });
  const altMedian = {
    h1: median(altRows.map(r=>r.h1)),
    h4: median(altRows.map(r=>r.h4)),
    h24: median(altRows.map(r=>r.h24))
  };
  const altMomentum = composite(altMedian);
  const relativeMomentum = btcMomentum - altMomentum;

  const totalAlt = Math.max(1, altRows.length);
  const positiveBreadth = altRows.filter(r => r.h24 > 0).length / totalAlt * 100;
  const outperformBTC = altRows.filter(r => r.composite > btcMomentum).length / totalAlt * 100;
  const longStructureBreadth = alts.filter(c => String(c.side || "").toUpperCase() === "LONG" || num(c.structScore) >= 62).length / totalAlt * 100;
  const setupBreadth = alts.filter(c => num(c.setupScore) >= 65 || ["t1","t2"].includes(String(c.tier||"").toLowerCase())).length / totalAlt * 100;
  const altParticipation = clamp(
    positiveBreadth * .30 +
    outperformBTC * .30 +
    longStructureBreadth * .20 +
    setupBreadth * .20
  );

  const absoluteScore = c => clamp(
    num(c?.structScore) * .35 +
    num(c?.flowScore) * .30 +
    num(c?.setupScore) * .20 +
    num(c?.liqScore) * .15
  );
  const btcAbsolute = btcA ? absoluteScore(btcA) : clamp(50 + num(btcTicker?.change24h) * 350);
  const altAbsolute = alts.length ? median(alts.map(absoluteScore)) : 50;

  // Relative momentum: ~5 percentage points of composite outperformance is already meaningful.
  const btcMomentumScore = clamp(50 + relativeMomentum * 700);
  const altMomentumScore = 100 - btcMomentumScore;

  const altBreadthScore = clamp(outperformBTC * .60 + positiveBreadth * .40);
  const btcBreadthScore = 100 - altBreadthScore;

  // Rolling change in BTC's share of total crypto USDT-futures turnover.
  const d15 = nearestSnapshotDelta(15);
  const d60 = nearestSnapshotDelta(60);
  const d240 = nearestSnapshotDelta(240);
  const availableDeltas = [[d15,.20],[d60,.35],[d240,.45]].filter(([v]) => Number.isFinite(v));
  const shareDelta = availableDeltas.length
    ? availableDeltas.reduce((sum,[v,weight])=>sum+v*weight,0) / availableDeltas.reduce((sum,[,weight])=>sum+weight,0)
    : 0;
  const btcConcentration = clamp(50 + shareDelta * cfg.volumeShareScalePerPctPoint);
  const altConcentration = 100 - btcConcentration;

  const sw = cfg.scoreWeights;
  const btcStrength = clamp(Math.round(
    btcAbsolute * sw.absolute +
    btcMomentumScore * sw.relativeMomentum +
    btcBreadthScore * sw.breadth +
    btcConcentration * sw.capitalConcentration +
    (100 - altParticipation) * sw.participation
  ));
  const altStrength = clamp(Math.round(
    altAbsolute * sw.absolute +
    altMomentumScore * sw.relativeMomentum +
    altBreadthScore * sw.breadth +
    altConcentration * sw.capitalConcentration +
    altParticipation * sw.participation
  ));

  const spread = btcStrength - altStrength;
  let leadership = "BALANCED";
  if (spread >= cfg.leadershipSpread) leadership = "BTC";
  else if (spread <= -cfg.leadershipSpread) leadership = "ALT";

  const reasons = [];
  const relPct = relativeMomentum * 100;
  if (Math.abs(relPct) >= .15) reasons.push(relPct > 0
    ? `BTC 綜合動能領先小幣中位數 ${relPct.toFixed(2)}%`
    : `小幣中位數動能領先 BTC ${Math.abs(relPct).toFixed(2)}%`);
  reasons.push(`${outperformBTC.toFixed(0)}% 小幣跑贏 BTC`);
  reasons.push(`${positiveBreadth.toFixed(0)}% 小幣 24H 上漲`);
  if (availableDeltas.length) reasons.push(shareDelta >= 0
    ? `BTC 成交量佔比提高 ${shareDelta.toFixed(2)} 個百分點`
    : `BTC 成交量佔比下降 ${Math.abs(shareDelta).toFixed(2)} 個百分點`);
  if (reasons.length > 3) reasons.length = 3;

  const marketRegime = btcMomentum < 0 && altMomentum < 0 ? "RISK_OFF" : btcMomentum > 0 && altMomentum > 0 ? "RISK_ON" : "MIXED";

  const avgLiq = alts.length ? alts.reduce((a,c)=>a+num(c.liqScore),0)/alts.length : 50;
  const moneyBreadth = alts.length ? alts.filter(c => num(c.flowScore)>=60 || c.isSurge).length/alts.length*100 : 0;
  const structureBreadth = alts.length ? alts.filter(c => num(c.structScore)>=60).length/alts.length*100 : 0;

  return {
    btcStrength, altStrength, leadership, spread, reason: reasons,
    marketRegime,
    btcMomentum, altMomentum, relativeMomentum,
    altPositiveBreadth: positiveBreadth,
    altOutperformBTC: outperformBTC,
    altParticipation,
    btcVolumeShareChange: shareDelta,
    btcA,
    sampleSize: alts.length,
    altParts: { avgLiq, setupBreadth, structureBreadth, moneyBreadth, positiveBreadth, outperformBTC, altParticipation }
  };
}

function computeMarketStrength() {
  const v2 = calculateBTCvsAltStrength();
  return {
    btcRaw: v2.btcStrength,
    altRaw: v2.altStrength,
    btcA: v2.btcA,
    altParts: v2.altParts,
    sampleSize: v2.sampleSize,
    relative: v2
  };
}

function renderMarketStrength() {
  const data = computeMarketStrength();
  const btcS = classifyStrength(data.btcRaw);
  const altS = classifyStrength(data.altRaw);

  const setGauge = (prefix, s) => {
    const value = document.getElementById(`${prefix}-strength-value`);
    const stateEl = document.getElementById(`${prefix}-strength-state`);
    const needle = document.getElementById(`${prefix}-strength-needle`);
    if (value) value.textContent = s.display;
    if (stateEl) stateEl.textContent = s.label;
    if (needle) needle.style.transform = `translateX(-50%) rotate(${-90 + (s.pos / 100) * 180}deg)`;
  };
  setGauge("btc", btcS);
  setGauge("alt", altS);

  const btcNote = document.getElementById("btc-strength-note");
  if (btcNote) {
    if (data.btcA) {
      btcNote.innerHTML = `<strong>目前判讀：</strong>結構 ${qualitative(data.btcA.structScore)} · 資金 ${qualitative(data.btcA.flowScore)} · Setup ${qualitative(data.btcA.setupScore)}。`;
    } else {
      btcNote.textContent = "正在累積 BTC 結構與資金資料。";
    }
  }

  const altNote = document.getElementById("alt-strength-note");
  if (altNote) {
    if (data.altParts) {
      altNote.innerHTML = `<strong>目前判讀：</strong>${Math.round(data.altParts.positiveBreadth || 0)}% 小幣上漲 · ${Math.round(data.altParts.outperformBTC || 0)}% 跑贏 BTC · 市場參與 ${Math.round(data.altParts.altParticipation || 0)}。`;
    } else {
      altNote.textContent = `目前已分析 ${data.sampleSize} 檔，樣本還不夠，等待全市場輪巡。`;
    }
  }

  const btcCompare = document.getElementById("strength-compare-btc");
  const altCompare = document.getElementById("strength-compare-alt");
  const gapEl = document.getElementById("strength-compare-gap");
  const leaderEl = document.getElementById("strength-compare-leader");
  const noteEl = document.getElementById("strength-compare-note");
  const btcBar = document.getElementById("strength-compare-btc-bar");
  const altBar = document.getElementById("strength-compare-alt-bar");
  const btcScore = btcS.display;
  const altScore = altS.display;
  const rel = data.relative || calculateBTCvsAltStrength();
  const gap = Math.round(rel.spread ?? (btcScore - altScore));
  if (btcCompare) btcCompare.textContent = btcScore;
  if (altCompare) altCompare.textContent = altScore;
  if (gapEl) { gapEl.textContent = `${gap > 0 ? "+" : ""}${gap}`; gapEl.className = gap > 0 ? "btc-lead" : gap < 0 ? "alt-lead" : ""; }
  if (btcBar) btcBar.style.width = `${clamp(btcScore)}%`;
  if (altBar) altBar.style.width = `${clamp(altScore)}%`;
  const leader = rel.leadership === "BTC" ? "BTC 主導" : rel.leadership === "ALT" ? "小幣擴散" : "市場均衡";
  const leaderClass = rel.leadership === "BTC" ? "btc" : rel.leadership === "ALT" ? "alt" : "balanced";
  if (leaderEl) { leaderEl.textContent = leader; leaderEl.dataset.leader = leaderClass; }
  if (noteEl) {
    const regime = rel.marketRegime === "RISK_OFF" ? "Risk Off" : rel.marketRegime === "RISK_ON" ? "Risk On" : "Mixed";
    const chips = (rel.reason || []).map(x => `<span class="strength-reason-chip">${x}</span>`).join("");
    noteEl.innerHTML = `<span class="strength-reason-chip"><strong>${leader}</strong> · ${regime}</span>${chips}<span class="strength-reason-chip">樣本 ${rel.sampleSize || 0}</span>`;
  }
}

