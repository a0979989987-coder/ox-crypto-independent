function renderBenchmarkBar() {
  if (!document.getElementById("bench-btc-price")) return;
  const btc = globalThis.OXCryptoQuotes?.get("BTCUSDT") || state.btcTicker;
  const eth = globalThis.OXCryptoQuotes?.get("ETHUSDT") || state.ethTicker;
  if (btc) {
    document.getElementById("bench-btc-price").textContent = fmtPrice(btc.lastPr);
    const e = document.getElementById("bench-btc-change"); e.textContent = fmtPct(btc.change24h); e.className = num(btc.change24h) >= 0 ? "positive" : "negative";
  }
  if (eth) {
    document.getElementById("bench-eth-price").textContent = fmtPrice(eth.lastPr);
    const e = document.getElementById("bench-eth-change"); e.textContent = fmtPct(eth.change24h); e.className = num(eth.change24h) >= 0 ? "positive" : "negative";
  }
  const btcA = state.analyzedCache.get("BTCUSDT");
  const ethA = state.analyzedCache.get("ETHUSDT");
  const trendText = x => !x ? "等待分析" : x.side === "LONG" ? "結構偏多" : x.side === "SHORT" ? "結構偏空" : "中性";
  document.getElementById("bench-btc-trend").textContent = trendText(btcA);
  document.getElementById("bench-eth-trend").textContent = trendText(ethA);
  const bias = document.getElementById("market-bias");
  if (btcA?.side === "LONG" && ethA?.side === "LONG") { bias.textContent = "Risk On"; bias.className = "positive"; }
  else if (btcA?.side === "SHORT" && ethA?.side === "SHORT") { bias.textContent = "Risk Off"; bias.className = "negative"; }
  else { bias.textContent = "Neutral"; bias.className = ""; }
}

function updateQuickStats() {
  const ticker = globalThis.OXCryptoQuotes?.get(state.symbol) || state.tickers.find(t => t.symbol === state.symbol);
  if (!ticker) return;
  const chg = document.getElementById("quick-change");
  chg.textContent = fmtPct(ticker.change24h); chg.className = num(ticker.change24h) >= 0 ? "positive" : "negative";
  document.getElementById("quick-volume").textContent = fmtCryptoVolumeUSDT(ticker.usdtVolume);
  const secondaryHigh = state.secondaryLevels?.high ? ` / ${fmtPrice(state.secondaryLevels.high)} · ${state.secondaryLevels.sourcePeriod}` : "";
  const secondaryLow = state.secondaryLevels?.low ? ` / ${fmtPrice(state.secondaryLevels.low)} · ${state.secondaryLevels.sourcePeriod}` : "";
  document.getElementById("quick-high").textContent = state.currentLevels.high ? `${fmtPrice(state.currentLevels.high)} · ${state.currentLevels.sourcePeriod || getKeyLevelPeriod()}${secondaryHigh}` : "—";
  document.getElementById("quick-low").textContent = state.currentLevels.low ? `${fmtPrice(state.currentLevels.low)} · ${state.currentLevels.sourcePeriod || getKeyLevelPeriod()}${secondaryLow}` : "—";
}

function renderOxDetail() {
  const symbol = state.symbol;
  const ticker = state.tickers.find(t => t.symbol === symbol);
  const scored = state.analyzedCache.get(symbol);
  const isBenchmark = benchmarkSymbols.has(symbol);
  document.getElementById("detail-symbol").textContent = symbol;
  document.getElementById("detail-volume").textContent = ticker ? fmtCryptoVolumeUSDT(ticker.usdtVolume) : "—";
  const primaryLevelText = `${state.currentLevels.sourcePeriod || getKeyLevelPeriod()}｜${state.currentLevels.high ? fmtPrice(state.currentLevels.high) : '—'} / ${state.currentLevels.low ? fmtPrice(state.currentLevels.low) : '—'}`;
  const secondaryLevelText = state.secondaryLevels
    ? ` · ${state.secondaryLevels.sourcePeriod}｜${state.secondaryLevels.high ? fmtPrice(state.secondaryLevels.high) : '—'} / ${state.secondaryLevels.low ? fmtPrice(state.secondaryLevels.low) : '—'}`
    : "";
  document.getElementById("detail-levels").textContent = primaryLevelText + secondaryLevelText;

  if (!scored) {
    setDetailLabels(globalThis.OXTierFilters?.get('crypto')?.enabled ? 'classic' : 'radar', '前高 / 前低');
    document.getElementById("detail-tier").textContent = isBenchmark ? "Benchmark" : "等待分析";
    for (const id of ["detail-ox","detail-liq","detail-flow","detail-structure","detail-rs","detail-setup","detail-side","detail-progress-text","detail-confidence","detail-trigger"]) {
      document.getElementById(id).textContent = isBenchmark && id === "detail-side" ? "Benchmark" : "—";
    }
    document.getElementById("detail-progress-bar").style.width = "0%";
    document.getElementById("detail-reasons-list").innerHTML = `<div class="detail-reason wait">${isBenchmark ? 'BTC / ETH 作為市場基準，不參與 T1 / T2 / T3 排名。' : '等待全市場輪巡完成這顆幣的分析。'}</div>`;
    updateAlertButtons();
    return;
  }

  const shownMap=state.tierMapBySide?.[state.directionFilter]||state.tierMap;
  const ranked = [...(shownMap.t1||[]), ...(shownMap.t2||[]), ...(shownMap.t3||[])].find(x => x.symbol === symbol);
  if(scored.radar&&!globalThis.OXTierFilters?.get('crypto')?.enabled){renderRadarDetail(scored,ranked,isBenchmark);return;}
  setDetailLabels('classic','觸發 / 目標 / 失效');
  const displayed=ranked||OXEngine.withTurnover(scored,ticker?.usdtVolume??scored.quoteVol);
  const shownTier = ranked?.displayTier || displayed.tier;
  const status = ranked?.rankStatus || displayed.classicSignal?.stage || '待確認';
  const classic=displayed.classicSignal;
  document.getElementById('detail-levels').textContent=`觸發 ${classic?.pressure?fmtPrice(classic.pressure.level):'—'} · 下一目標 ${classic?.target?fmtPrice(classic.target.level):'尚未辨識'} · 結構失效 ${classic?.invalidation?fmtPrice(classic.invalidation.level):'—'}`;
  document.getElementById("detail-tier").textContent = isBenchmark ? "Benchmark" : `${shownTier.toUpperCase()} ${displayed.signalFrame||classic?.frame||'—'}＋${displayed.triggerFrame||classic?.triggerFrame||'—'} ${status}`;
  document.getElementById("detail-ox").textContent = displayed.oxScore;
  document.getElementById("detail-liq").textContent = `${displayed.liqScore} / 100`;
  document.getElementById("detail-flow").textContent = `${displayed.flowScore} / 100`;
  document.getElementById("detail-structure").textContent = displayed.structureLabel || displayed.side;
  document.getElementById("detail-rs").textContent = `${displayed.rsScore} / 100`;
  document.getElementById("detail-setup").textContent = displayed.setupName;
  document.getElementById("detail-side").textContent = displayed.side;
  document.getElementById("detail-progress-text").textContent = `${displayed.setupProgress ?? 0}%`;
  document.getElementById("detail-progress-bar").style.width = `${displayed.setupProgress ?? 0}%`;
  document.getElementById("detail-progress-bar").style.setProperty("--meter-color", (displayed.setupProgress ?? 0) < 40 ? "var(--meter-weak)" : (displayed.setupProgress ?? 0) < 70 ? "var(--meter-mid)" : "var(--meter-strong)");
  document.getElementById("detail-confidence").textContent = classic?.eligible ? "完整條件" : "條件觀察";
  document.getElementById("detail-trigger").textContent = classic?.eligible ? classic.stage : "條件觀察 · 等待完整確認";

  const reasons = classic?.eligible ? (classic.reasons||[]).map(text=>({ok:true,text})) : [
    ...(classic?.matchedReasons||[]).map(text=>({ok:true,text})),
    ...(classic?.rejectionReasons||[]).map(text=>({ok:false,text}))];
  if(classic?.money?.reason)reasons.push({ok:false,text:classic.money.reason});
  document.getElementById("detail-reasons-list").innerHTML = reasons.map(r => `<div class="detail-reason ${r.ok ? 'ok' : 'wait'}">${r.ok ? '✓' : '△'} ${escapeHtml(fmtSignalReason(r.text))}</div>`).join('');
  updateAlertButtons();
}

// The same eight cells show the radar's four elements or, with a custom
// timeframe filter (or before a coin is analysed), the classic scores; the
// labels follow whichever mode filled them.
const DETAIL_LABEL_IDS=['detail-ox','detail-liq','detail-flow','detail-structure','detail-rs','detail-setup','detail-progress-text','detail-trigger'];
const DETAIL_LABELS={
  radar:['OX 綜合分','確定性','強度','盈虧比','幅度','入選途徑','綜合分進度','途徑類型'],
  classic:['OX Score','流動性','資金活躍','結構','Relative Strength','Setup','Setup Progress','Trigger']
};
function setDetailLabels(mode,levels){
  const label=(id,text)=>{const el=document.getElementById(id)?.previousElementSibling;if(el?.tagName==='LABEL'&&el.textContent!==text)el.textContent=text;};
  DETAIL_LABEL_IDS.forEach((id,i)=>label(id,DETAIL_LABELS[mode][i]));
  label('detail-levels',levels);
}

// 雷達策略詳情：四要素、入選途徑，以及入選、扣分、T1 未通過與未入選原因。
function renderRadarDetail(scored,ranked,isBenchmark){
  setDetailLabels('radar','目標 / 結構失效');
  const side=state.directionFilter==='short'?'short':'long';
  const radar=scored.radar,r=ranked?.radarSide||radar[side]||null,e=r?.elements||{};
  const set=(id,text)=>{const el=document.getElementById(id);if(el)el.textContent=text;};
  const sign=side==='short'?'−':'+';
  const tier=ranked?.displayTier?ranked.displayTier.toUpperCase()+(ranked.radarFill?' 補位':''):r?.listed||r?.fillable?'候補':'未入選';
  set('detail-tier',isBenchmark?'Benchmark':radar.excluded?radar.productLabel:`${tier} · ${r?.frame||'—'}${r?.triggerFrame?'＋'+r.triggerFrame:''}`);
  set('detail-ox',r?.score??'—');
  set('detail-liq',e.certainty??'—');
  set('detail-flow',e.strength??'—');
  set('detail-structure',e.rr===null||e.rr===undefined?'—':e.rr.toFixed(2));
  set('detail-rs',e.room===null||e.room===undefined?'—':sign+(e.room*100).toFixed(1)+'%');
  set('detail-setup',radar.excluded||(r?.pathway?.name||'沒有入選途徑'));
  set('detail-side',isBenchmark?'Benchmark':side.toUpperCase());
  const score=r?.score??0;
  set('detail-progress-text',r?.score===null||r?.score===undefined?'—':score+' / 99');
  const bar=document.getElementById('detail-progress-bar');
  if(bar){bar.style.width=Math.max(0,Math.min(100,score))+'%';bar.style.setProperty('--meter-color',score<40?'var(--meter-weak)':score<70?'var(--meter-mid)':'var(--meter-strong)');}
  set('detail-confidence',r?.t1?'T1 完整條件':r?.listed?'入選 · 待完整確認':r?.fillable?'補位（未完全入選）':'未入選');
  set('detail-trigger',r?.pathway?.group||'—');
  set('detail-levels',`目標 ${r?.target?(r.target.label+' '+fmtPrice(r.target.level)):'尚未辨識'} · 結構失效 ${Number.isFinite(r?.stop)?fmtPrice(r.stop):'—'}`);
  const rows=[];
  if(radar.excluded)rows.push({cls:'no',text:'× '+radar.excluded});
  if(r?.fillable)rows.push({cls:'wait',text:'△ 補位：T2／T3 名額依序補滿，這檔沒有完全入選，原因見下方 ×'});
  for(const text of r?.matched||[])rows.push({cls:'ok',text:'✓ '+text});
  for(const d of r?.deductions||[])rows.push(d.points>0?{cls:'minus',text:'− '+d.text+'（−'+d.points+'）'}:{cls:'wait',text:'△ '+d.text});
  if(r?.listed&&!r.t1)for(const text of r.gates||[])rows.push({cls:'wait',text:'△ T1 未通過：'+text});
  for(const text of r?.rejections||[])rows.push({cls:'no',text:'× 未入選：'+text});
  if(!rows.length)rows.push({cls:'wait',text:'△ 等待全市場輪巡完成這顆幣的分析。'});
  document.getElementById('detail-reasons-list').innerHTML=rows.map(x=>`<div class="detail-reason ${x.cls}">${escapeHtml(fmtSignalReason(x.text))}</div>`).join('');
  updateAlertButtons();
}

function updateRadarMarketGlow() {
  const radar = document.getElementById("view-radar");
  if (!radar) return;
  if (radar.dataset.selectedSymbol !== state.symbol) {
    delete radar.dataset.priceDirection;
    delete radar.dataset.glowLevel;
    return;
  }
  const ticker = globalThis.OXCryptoQuotes?.get(state.symbol) || state.tickers.find(t => t.symbol === state.symbol);
  if (!ticker) {
    delete radar.dataset.priceDirection;
    delete radar.dataset.glowLevel;
    return;
  }
  const change = num(ticker.change24h);
  const magnitude = Math.abs(change);
  radar.dataset.priceDirection = change < 0 ? "down" : "up";
  // Down moves are typically smaller than upside spikes; use calibrated
  // bearish thresholds so all three red strengths occur in live candidates.
  radar.dataset.glowLevel = change < 0
    ? (magnitude >= 0.08 ? "3" : magnitude >= 0.03 ? "2" : "1")
    : (magnitude >= 0.25 ? "3" : magnitude >= 0.10 ? "2" : "1");
}

function updateHeaderHUD() {
  const ticker = globalThis.OXCryptoQuotes?.get(state.symbol) || state.tickers.find(t => t.symbol === state.symbol);
  updateRadarMarketGlow();
  if (!ticker) return;

  document.getElementById("ticker-pair").textContent = `${ticker.symbol} · Bitget`;
  const live=state.chartLiveQuote;
  const price=live?.symbol===state.symbol && live.period===state.period && Date.now()-live.received<15000 && live.received>=(ticker.ts||0) ? live.price : ticker.lastPr;
  document.getElementById("price").textContent = fmtPrice(price);
  const focusPrice = document.getElementById("chart-focus-price");
  if (focusPrice) focusPrice.textContent = fmtPrice(price);
  
  const chgEl = document.getElementById("change");
  chgEl.textContent = fmtPct(ticker.change24h);
  chgEl.className = num(ticker.change24h) >= 0 ? "positive" : "negative";

  document.getElementById("quote").textContent = fmtCryptoVolumeUSDT(ticker.usdtVolume);
  document.getElementById("chart-head-title").children[0].textContent = `${ticker.symbol} 永續合約`;

  const map=state.tierMapBySide?.[state.directionFilter];
  const scored=[...(map?.t1||[]),...(map?.t2||[]),...(map?.t3||[])].find(row=>row.symbol===state.symbol)||state.analyzedCache.get(state.symbol);
  if (scored) {
    document.getElementById("ox-score").textContent = scored.oxScore;
    document.getElementById("ox-tier-label").textContent = `${scored.statusText} · 結構:${scored.structScore}`;
    document.getElementById("ox-setup").textContent = scored.setupName;
    document.getElementById("ox-rs-desc").textContent = `RS: ${scored.rsScore} (${scored.side})`;
    document.getElementById("quote-rank").textContent = `全市場前 ${scored.liqPercentile}%`;
  } else {
    document.getElementById("ox-score").textContent = "—";
    document.getElementById("ox-tier-label").textContent = "全市場輪巡佇列中";
    document.getElementById("ox-setup").textContent = "等待分析";
    document.getElementById("ox-rs-desc").textContent = "—";
    document.getElementById("quote-rank").textContent = "評估中…";
  }

  if (state.btcTicker) {
    const diff = num(ticker.change24h) - num(state.btcTicker.change24h);
    document.getElementById("btc-rel").textContent = `相對 BTC: ${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(2)}%`;
  }
  updateQuickStats();
  renderOxDetail();
  renderBenchmarkBar();
  renderHomeOverview();
}

function switchSymbol(symbol) {
  if (state.activeView !== "radar") switchAppView("radar");
  document.getElementById("view-radar")?.setAttribute("data-selected-symbol", symbol);
  if (symbol === state.symbol) { updateHeaderHUD(); return; }
  state.symbol = symbol;
  state.currentLevels = { high: 0, low: 0, sourcePeriod: getKeyLevelPeriod(), highTime: 0, lowTime: 0 };
  state.secondaryLevels = null;
  updateHeaderHUD();
  renderCurrentTab();
  document.querySelector('#screener-list .coin-card.selected')?.classList.add('ox-coin-new-selection');
  updateAlertButtons();
  loadSymbolCandles(true);
}




/* ===== v3.6 feature pack: watchlist / local account / market architecture / home BTC mini chart ===== */


// Observe card membership once, reuse one stream, and patch numbers only.
// Rankings, chart instances and filter results are unaffected by quote pushes.
document.addEventListener('DOMContentLoaded',()=>{
  const list=document.getElementById('screener-list');if(!list)return;
  let subscription=null,observer=null;
  const visible=new Set();
  const change=(el,value)=>{if(!el)return;el.textContent=fmtPct(value);el.classList.toggle('positive',value>=0);el.classList.toggle('negative',value<0);};
  function paint(quotes){
    if(state.activeView!=='radar'&& !document.body.classList.contains('chart-focus'))return;
    const bySymbol=new Map(quotes.map(q=>[q.symbol,q]));
    for(const card of visible){const q=bySymbol.get(card.dataset.symbol);if(!q)continue;
      card.querySelectorAll('.coin-change,.turnover-change').forEach(el=>change(el,q.change24h));
      const price=card.querySelector('.turnover-price,.watch-metric:first-child strong');if(price)price.textContent=fmtPrice(q.lastPr);
      change(card.querySelector('.watch-metric:nth-child(2) strong'),q.change24h);
      const volume=card.querySelector('.coin-volume-value');if(volume)volume.textContent=fmtCryptoVolume(q.usdtVolume).replaceAll(',','');
      const turnover=card.querySelector('.turnover-volume');if(turnover)turnover.textContent='24H '+fmtCryptoVolumeUSDT(q.usdtVolume);
    }
    if(bySymbol.has('BTCUSDT')||bySymbol.has('ETHUSDT'))renderBenchmarkBar();
    if(bySymbol.has(state.symbol)){updateHeaderHUD();updateQuickStats();}
  }
  function sync(){
    const enabled=window.OXFeatures?.ready&&!document.body.classList.contains('ox-feature-blocked')&&state.activeMarket==='crypto'&&(state.activeView==='radar'||document.body.classList.contains('chart-focus'));
    if(!enabled){subscription?.stop();subscription=null;return;}
    const symbols=[state.symbol,'BTCUSDT','ETHUSDT',...[...visible].map(c=>c.dataset.symbol)];
    if(subscription)subscription.update(symbols);else subscription=globalThis.OXCryptoQuotes?.subscribe(symbols,paint);
  }
  // One long-lived observer. Keyed list updates keep unchanged cards, so only
  // added cards are observed; no synchronous layout read on every list change.
  const observed=new Set();
  function cards(){
    observer||=new IntersectionObserver(entries=>{for(const e of entries)e.isIntersecting?visible.add(e.target):visible.delete(e.target);sync();},{rootMargin:'150px'});
    const current=new Set(list.querySelectorAll('.coin-card[data-symbol]'));
    for(const card of observed)if(!current.has(card)){observer.unobserve(card);observed.delete(card);visible.delete(card);}
    for(const card of current)if(!observed.has(card)){observed.add(card);observer.observe(card);}
    sync();
  }
  new MutationObserver(cards).observe(list,{childList:true});
  new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['data-view','data-market','class']});
  document.addEventListener('ox:feature-policy-ready',sync);document.addEventListener('ox:viewchange',sync);document.addEventListener('ox:marketchange',sync);cards();
});
