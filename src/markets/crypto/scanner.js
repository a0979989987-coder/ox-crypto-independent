// The radar list lives on 行情 → 雷達, the chart and its quote card on the 個股 page;
// the full-market scan runs while 首頁, 行情 or 個股 is on screen.
const RADAR_SCAN_VIEWS=['home','strength','stock'];
const radarScanView=()=>RADAR_SCAN_VIEWS.includes(state.activeView);
const radarListVisible=()=>state.activeView==='strength'&&document.getElementById('ox-market-radar')?.hidden===false;
const WATCH_STAR_SVG = '<svg class="watch-star-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91Z"/></svg>';

const RADAR_RETAIN_MS=2*60*60*1000;
const RADAR_SNAPSHOT_KEY = 'ox-radar-snapshot-v8-liquidity';
// Scan active liquid markets first; eligibility and final T1/T2/T3 ranking
// still use the unchanged structural/volume engine after fetching candles.
function orderCryptoScanTickers(tickers){const sorted=[...tickers].sort((a,b)=>
  Number(['BTCUSDT','ETHUSDT'].includes(b.symbol))-Number(['BTCUSDT','ETHUSDT'].includes(a.symbol))||
  Number(num(b.usdtVolume)>=3000000)-Number(num(a.usdtVolume)>=3000000)||
  Math.abs(num(b.change24h))-Math.abs(num(a.change24h))||num(b.usdtVolume)-num(a.usdtVolume));
 const benchmarks=sorted.filter(t=>['BTCUSDT','ETHUSDT'].includes(t.symbol));
 const rest=sorted.filter(t=>!['BTCUSDT','ETHUSDT'].includes(t.symbol));
 const up=rest.filter(t=>num(t.change24h)>=0),down=rest.filter(t=>num(t.change24h)<0),balanced=[];
 for(let i=0;i<Math.max(up.length,down.length);i++){if(up[i])balanced.push(up[i]);if(down[i])balanced.push(down[i]);}
 return [...benchmarks,...balanced];}
// The next pass. With saved rows (the hourly snapshot or this device's last
// results) radar-snapshot.js re-checks their candidates first; after a fresh
// complete evaluation only the candidates and the most traded coins.
function cryptoScanPlan() {
  const eligible=state.tickers.filter(t=>num(t.usdtVolume)>0);
  return globalThis.OXRadarSnapshot?.plan(eligible)||orderCryptoScanTickers(eligible).map(t=>t.symbol);
}

// Refill a completed slot immediately; a slow symbol must not hold the next
// liquid candidates behind an entire fixed batch.
async function scanCryptoPool(next,scan,limit=3){
 await Promise.allSettled(Array.from({length:limit},async()=>{let symbol;while((symbol=next())!==null){await scan(symbol);await new Promise(resolve=>setTimeout(resolve,0));}}));
}
// Saved rows (the hourly snapshot or this device's last scan) come back with
// the current quote. A row never replaces a newer analysis of the same coin.
function restoreRadarRows(rows,tickers=new Map(state.tickers.map(t=>[t.symbol,t]))) {
  let restored=0;
  for (const row of rows) {
    const ticker=tickers.get(row.symbol),current=state.analyzedCache.get(row.symbol);
    if (!ticker || !isCryptoSymbolAllowed(row.symbol) || current?.at>=row.at || Date.now()-row.at>RADAR_RETAIN_MS) continue;
    state.analyzedCache.set(row.symbol,OXEngine.withTurnover({...row,ticker,change24h:num(ticker.change24h)},ticker.usdtVolume));
    restored++;
  }
  return restored;
}
function restoreRadarSnapshot() {
  if (state.radarSnapshotChecked) return;
  state.radarSnapshotChecked = true;
  try { localStorage.removeItem(RADAR_SNAPSHOT_KEY); } catch (_) {}
  globalThis.OXRadarSnapshot?.restore();
}
function saveRadarSnapshot() { globalThis.OXRadarSnapshot?.save(); }

function closedTierCandles(candles,frame,now=Date.now()) {
 const duration=({m:60,H:3600,D:86400,W:604800})[frame.slice(-1)]*Number(frame.slice(0,-1));
 return candles.filter(c=>{
  const local=new Date(c.time*1000+8*3600000);
  const end=frame.endsWith('M')?Date.UTC(local.getUTCFullYear(),local.getUTCMonth()+Number(frame.slice(0,-1)),1)/1000-8*3600:c.time+duration;
  return Number.isFinite(end)&&end<=now/1000;
 });
}
function cryptoClassicBars(candles,frame,now=Date.now()) {
 const sorted=[...new Map(candles.filter(c=>[c.time,c.open,c.high,c.low,c.close].every(Number.isFinite)&&c.time<=now/1000&&
   Math.min(c.open,c.low,c.close)>0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)).map(c=>[c.time,c])).values()].sort((a,b)=>a.time-b.time);
 const duration=({m:60,H:3600,D:86400,W:604800})[frame.slice(-1)]*Number(frame.slice(0,-1));
 let start=0;
 for(let i=1;i<sorted.length;i++)if(Number.isFinite(duration)&&sorted[i].time-sorted[i-1].time!==duration)start=i;
 const tail=sorted.slice(start);
 if(Number.isFinite(duration)&&(!tail.length||now/1000-tail.at(-1).time>duration*2))return [];
 const closed=new Set(closedTierCandles(tail,frame,now).map(c=>c.time));
 return tail.map(c=>({...c,...(!closed.has(c.time)?{provisional:true}:{})}));
}
function classifyTierFrame(candles,frame) {
 const row=OXEngine.analyzeCandles(cryptoClassicBars(candles,frame),{frame});
 return {...row,at:Date.now(),closedAt:row.classicSignal.closedAt};
}
// An emerging 1H level can be relevant before the 4H / daily setup has
// completed. It needs a same-direction 4H trend and real 1H volume, and can
// only enter the observation tiers, never the fully confirmed T1 tier.
function intradayClassicObservation(frames,side) {
 const fast=OXClassic.evaluateClassic(frames['1H'],{side,frame:'1H',contextFrame:'1D',contextBars:frames['1D']});
 const anchor=OXClassic.evaluateClassic(frames['4H'],{side,frame:'4H'});
 const active4H=anchor.direction?.advance>=1.5 && anchor.direction?.position>=.7;
 const forming4H=anchor.pressure?.state==='valid'&&anchor.pressure.touches>=2&&
   anchor.distanceATR!==null&&anchor.distanceATR<=.8&&anchor.volume?.recentRatio>=1.1;
 if(!(fast.eligible||fast.observationEligible)||!fast.volume?.supported||
    !anchor.direction?.confirmed||!anchor.volume?.complete||anchor.volume.distribution||
    !active4H&&!forming4H||fast.direction?.falling||fast.direction?.position<.6)return null;
 const sharedHorizontal=fast.horizontalReady&&anchor.pressure?.kind==='horizontal'&&
   anchor.pressure.state==='valid'&&Math.abs(anchor.pressure.level-fast.pressure.level)<=anchor.atr*.35;
 return {...fast,eligible:false,tier:null,observationEligible:true,horizontalFrame:sharedHorizontal?'4H':fast.frame,
   qualityScore:Math.min(fast.horizontalReady?79:74,fast.qualityScore),triggerFrame:'4H',
   stage:'短線帶量觀察 · 4H '+(active4H?'資金推進':'新型態確認'),
   matchedReasons:['1H 有效壓力／支撐與同向放量',active4H?'4H 近期明顯推進':'4H 新壓力／支撐形成',...(fast.matchedReasons||[])]};
}
// One coin's radar row from its 1H / 4H / 1D candles. The page's scan and the
// hourly snapshot job (scripts/collect-crypto-radar.mjs) both run exactly this.
function fetchCryptoRadarCandles(symbol,options={owner:'radar-scan',priority:0}) {
  // Another view may have fetched the same series moments ago (盤面's levels,
  // 幣種詳情): within the same hour its newest 180 candles are this request.
  const series=frame=>{
    const seen=BitgetAPI.peekCandles?.(symbol,frame),now=Date.now();
    if(seen&&Math.abs(now-seen.serverTime)<15000&&Math.floor(seen.serverTime/3600000)===Math.floor(now/3600000)&&seen.candles.length>=180)return Promise.resolve(seen.candles.slice(-180));
    return BitgetAPI.fetchCandles(symbol,frame,180,null,options);
  };
  return Promise.all([series('1H'),series('4H'),series('1D').catch(()=>[])]).then(([hour,fourHour,day])=>({'1H':hour,'4H':fourHour,'1D':day}));
}
function cryptoRadarRow(symbol,ticker,raw,{tickers=state.tickers,btcTicker=state.btcTicker}={}) {
  const candles=raw['1H'];
  const frames={'1H':cryptoClassicBars(raw['1H'],'1H'),'4H':cryptoClassicBars(raw['4H'],'4H'),'1D':cryptoClassicBars(raw['1D'],'1D')};
  // A rate-limit or malformed candle response must not replace a valid
  // prior scan with a neutral row and make the symbol disappear.
  if(frames['1H'].length<OXClassic.CLASSIC_RULES.minimumBars||
     frames['4H'].length<OXClassic.CLASSIC_RULES.minimumBars)throw Error('核心級別 K 線不足');
  const classic=Object.fromEntries(['long','short'].map(side=>{
    const signals=[['4H','1H'],['1D','4H']].map(([setupFrame,triggerFrame])=>OXClassic.evaluateFrames(frames,{side,setupFrame,triggerFrame,
      ...(setupFrame==='1D'?{confirmationFrame:'1H'}:{})}));
    const fast=intradayClassicObservation(frames,side);
    if(fast)signals.push(fast);
    const qualified=signals.filter(s=>s.eligible||s.observationEligible).sort(OXClassic.compareClassic);
    return [side,qualified[0]||signals[0]];
  }));
  const candidates=Object.values(classic).filter(s=>s.eligible||s.observationEligible).sort(OXClassic.compareClassic);
  const signal=candidates[0]||classic.long;
  const row=OXEngine.describe(signal,classic),liq=OXEngine.computeLiquidity(ticker,tickers),rs=OXEngine.computeRelativeStrength(ticker,btcTicker);
  const timeframeTiers=Object.fromEntries(Object.entries(frames).map(([frame,bars])=>[frame,classifyTierFrame(bars,frame)]));
  return {row:OXEngine.withTurnover({
    ...row,timeframeTiers,symbol,ticker,at:Date.now(),lastPrice:candles.at(-1)?.close,
    signalFrame:signal.frame||'4H',triggerFrame:signal.triggerFrame||'1H',sparkline:candles.slice(-24).map(c=>c.close),
    liqScore:liq.score,rsScore:rs.score,quoteVol:liq.quoteVol,liqPercentile:liq.percentileStr,
    reasons:row.reasons,
    change24h:num(ticker.change24h),ret1h:candleReturn(candles,1),ret4h:candleReturn(candles,4),
    ret24h:candleReturn(candles,24),
  },ticker.usdtVolume),signal};
}
// The Bitget contract catalog and the crypto quotes the radar ranks.
function applyCryptoCatalog(contractList,instrumentMetadata) {
  const metaBySymbol = new Map((instrumentMetadata || []).map(m => [m.symbol, m]));
  state.instrumentCatalog.clear();
  state.contracts.clear();
  state.assetClassCounts = { crypto: 0, stock: 0, etf: 0, commodity: 0, index: 0, other: 0 };

  contractList.forEach(c => {
    const meta = metaBySymbol.get(c.symbol) || {};
    const merged = {
      ...c,
      assetSymbolType: meta.symbolType || "",
      isRwa: meta.isRwa ?? c.isRwa,
      assetClass: undefined
    };
    const assetClass = classifyInstrument(merged);
    const tagged = { ...merged, assetClass };
    state.instrumentCatalog.set(tagged.symbol, tagged);
    state.assetClassCounts[assetClass] = (state.assetClassCounts[assetClass] || 0) + 1;
    if (assetClass === ASSET_CLASS.CRYPTO) state.contracts.set(tagged.symbol, tagged);
  });
}
function selectCryptoTickers(rawTickers) {
  return rawTickers.filter(t =>
    state.contracts.has(t.symbol) &&
    isCryptoSymbolAllowed(t.symbol) &&
    [t.lastPr, t.change24h, t.usdtVolume].every(v => Number.isFinite(num(v)))
  );
}
function cryptoFrameTier(row,frame,side) {
 const data=row.timeframeTiers?.[frame];
 return data&&data.eligible&&Date.now()-data.at<=RADAR_RETAIN_MS&&(!side||data.side?.toLowerCase()===side.toLowerCase())?data:null;
}
let refreshingMarketTickers=false;
async function refreshMarketTickers() {
  if (state.activeMarket && state.activeMarket !== "crypto") return;
  if(refreshingMarketTickers)return;
  refreshingMarketTickers=true;state.radarLoadError=false;
  const loading=window.OXLoading?.begin('crypto','加密行情載入中',{views:['home','strength']});
  try {
    // Independent metadata must not wait for the ticker response first.
    const [rawTickers,catalog] = await Promise.all([BitgetAPI.fetchTickers(),!state.contracts.size?Promise.all([
      BitgetAPI.fetchContracts(),BitgetAPI.fetchInstrumentMetadata()
    ]):null]);
    if(state.activeMarket!=="crypto")return;
    if (!state.contracts.size) {
      const [contractList, instrumentMetadata] = catalog;
      if(state.activeMarket!=="crypto")return;
      applyCryptoCatalog(contractList, instrumentMetadata);
    }

    state.tickers = selectCryptoTickers(rawTickers);
    state.tickersSource = 'live';

    // Purge any stale non-crypto records before rebuilding ranking / scanner state.
    for (const symbol of Array.from(state.analyzedCache.keys())) {
      if (!isCryptoSymbolAllowed(symbol)) state.analyzedCache.delete(symbol);
    }
    state.scanQueue = state.scanQueue.filter(isCryptoSymbolAllowed);

    state.btcTicker = state.tickers.find(t => t.symbol === "BTCUSDT") || null;
    state.ethTicker = state.tickers.find(t => t.symbol === "ETHUSDT") || null;
    captureStrengthSnapshot();

    // Rank the whole active crypto universe. The former 3m turnover cutoff
    // silently removed genuine lower-turnover setups before they were scored.
    restoreRadarSnapshot();
    // Saved rows take the newest quote; a fresh snapshot needs only a re-check.
    globalThis.OXRadarSnapshot?.onTickers();
    if (!state.scanQueue.length) {
      state.scanQueue = cryptoScanPlan();
      state.scanIndex = 0;
    }

    rebuildTierLists();
    if (radarListVisible()) renderCurrentTab();
    if (state.activeView === 'stock') { updateHeaderHUD(); renderBenchmarkBar(); }
    checkLevelAlerts();

    if (!state.isQueueRunning) {
      state.isQueueRunning = true;
      runScanQueueLoop();
    }
  } catch (e) {
    state.radarLoadError=true;
    document.getElementById("scan-status").textContent = `行情取得失敗：${e.message}`;
    document.getElementById("dot").style.background = "#ee617c";
  } finally { refreshingMarketTickers=false;loading?.finish();if(state.activeMarket==='crypto'&&radarListVisible())renderCurrentTab(); }
}

let radarPaintTimer=0, initialScanLoading=null, passCompleted=0, passFailed=0, radarWake=null;
function waitForRadar(ms){return new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);if(radarWake===done)radarWake=null;resolve();};radarWake=done;timer=setTimeout(done,ms);});}
function publishRadarProgress(immediate=false) {
  if (!immediate) {
    if (!radarPaintTimer) radarPaintTimer=setTimeout(()=>publishRadarProgress(true),100);
    return;
  }
  clearTimeout(radarPaintTimer);radarPaintTimer=0;
  if (state.activeMarket !== 'crypto') return;
  rebuildTierLists();
  if (radarListVisible()) renderCurrentTab();
  if (state.activeView === 'stock') { updateHeaderHUD();renderBenchmarkBar(); }
}
async function runScanQueueLoop() {
  while (true) {
    // Keep the ranking data, but do not spend CPU scanning Crypto in the
    // background while another market, page, or browser tab is visible.
    if (document.hidden || state.activeMarket !== 'crypto' || !radarScanView()) {
      await waitForRadar(document.hidden ? 15000 : 8000);
      continue;
    }
    if (!state.scanQueue.length) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    if(!state.radarSnapshotReady&&!initialScanLoading)initialScanLoading=window.OXLoading?.begin('crypto','掃描幣種',{done:0,total:state.scanQueue.length,views:['home','strength']});
    const batchSymbols = [];
    const remaining = state.scanQueue.length-state.scanIndex;
    const extraFrames=globalThis.OXTierFilters?.get('crypto').enabled?globalThis.OXTierFilters.get('crypto').rules.filter(r=>!['1H','4H','1D'].includes(r.frame)).length:0;
    const batchLimit=Math.min(CONFIG.queueBatchSize,Math.max(1,Math.floor(20/(3+extraFrames))));
    const nextScan=()=>{
      if(document.hidden||state.activeMarket!=='crypto'||!radarScanView()||state.scanIndex>=state.scanQueue.length)return null;
      const symbol=state.scanQueue[state.scanIndex++];batchSymbols.push(symbol);
      document.getElementById("scan-status").textContent=`輪巡 ${state.scanIndex}/${state.scanQueue.length}`;
      return symbol;
    };

    document.getElementById("scan-status").textContent = `輪巡 ${state.scanIndex}/${state.scanQueue.length}`;
    document.getElementById("dot").style.background = "#38c99b";

    await scanCryptoPool(nextScan,async symbol => {
      const ticker = state.tickers.find(t => t.symbol === symbol);
      if (!ticker) return;

      try {
        const raw = await fetchCryptoRadarCandles(symbol);
        if(state.activeMarket!=='crypto'||!radarScanView())return;
        const {row,signal}=cryptoRadarRow(symbol,ticker,raw);
        const timeframeTiers=row.timeframeTiers;
        const tierConfig=globalThis.OXTierFilters?.get('crypto');
        if(tierConfig?.enabled)await Promise.all(tierConfig.rules.filter(r=>!timeframeTiers[r.frame]).map(async rule=>{
          try {timeframeTiers[rule.frame]=classifyTierFrame(await BitgetAPI.fetchCandles(symbol,rule.frame,180,null,{owner:'radar-scan',priority:0}),rule.frame);}
          catch {timeframeTiers[rule.frame]=null;}
        }));
        state.analyzedCache.set(symbol, row);
        passCompleted++;
        const firstCandidate=(signal.eligible||signal.observationEligible)&&
          !['t1','t2','t3'].some(tier=>['long','short'].some(side=>state.tierMapBySide?.[side]?.[tier]?.length));
        publishRadarProgress(firstCandidate);
      } catch (e) {if(state.activeMarket==='crypto'&&radarScanView())passFailed++;} finally { const n=(initialScanLoading?.done||0)+1;if(initialScanLoading){initialScanLoading.done=n;initialScanLoading.update(n,state.scanQueue.length);} }
    },Math.min(3,batchLimit));

    if(document.hidden||state.activeMarket!=='crypto'||!radarScanView()){state.scanIndex=Math.max(0,state.scanIndex-Math.min(3,batchSymbols.length));continue;}
    const completed = state.scanIndex >= state.scanQueue.length;
    // A completed pass persists the snapshot; visible rows are published as
    // their own analysis completes, even while another request is pending.
    if (completed) {
      initialScanLoading?.finish();initialScanLoading=null;
      globalThis.OXRadarSnapshot?.onPass({completed:passCompleted,failed:passFailed});
      // Refresh the universe between full passes so newly listed contracts
      // can enter the radar without a page reload.
      state.scanQueue=cryptoScanPlan();
      state.scanIndex = 0;
      // Rows from the hourly snapshot stay a valid ranking when a few coins fail.
      state.radarSnapshotReady = passCompleted>0&&(passFailed===0||!!globalThis.OXRadarSnapshot?.loaded());
      state.radarScanFailed = passFailed>0||passCompleted===0;
      if(passCompleted>0)saveRadarSnapshot();
      passCompleted=0;passFailed=0;
    }
    publishRadarProgress(true);
    // All tools share the public-feed scheduler and its 429 cooldown.
    // Rate limiting belongs to public-feed. Do not add 2.5 seconds of idle
    // time to every batch; only rest between complete passes and yield CPU.
    await waitForRadar(completed?Math.max(CONFIG.batchIntervalMs,1000,globalThis.OXRadarSnapshot?.restMs()||0):0);
  }
}

function radarSideRows(row) {
  return ['long','short'].flatMap(side=>{
    const signal=OXClassic.qualifyClassicRow(row,side,{observations:true});
    if(!signal)return [];
    if(row.side===signal.side&&row.classicSignal?.frame===signal.frame)return [row];
    const described=OXEngine.describe(signal,row.classic);
    return [{...row,...described,side:signal.side,signalFrame:signal.frame,
      triggerFrame:signal.triggerFrame,reasons:described.reasons}];
  });
}
function rebuildTierLists() {
  const tierConfig=globalThis.OXTierFilters?.get('crypto');
  const rankedPool=Array.from(state.analyzedCache.values())
    .filter(c=>isCryptoSymbolAllowed(c.symbol))
    .map(c=>OXEngine.withTurnover(c,state.tickers.find(t=>t.symbol===c.symbol)?.usdtVolume??c.quoteVol))
    .flatMap(c=>tierConfig?.enabled?[c]:radarSideRows(c)).filter(c=>{
    if(benchmarkSymbols.has(c.symbol)||(!tierConfig?.enabled&&!OXClassic.qualifyClassicRow(c,c.side,{observations:true})))return false;
    const signal=c.classicSignal,price=num(state.tickers.find(t=>t.symbol===c.symbol)?.lastPr)||c.lastPrice;
    if(!tierConfig?.enabled&&price&&signal?.invalidation?.level){const dir=c.side==='SHORT'?-1:1;
      if(dir*(price-signal.invalidation.level)<-.2*signal.atr||c.lastPrice&&dir*(price-c.lastPrice)<-.9*signal.atr)return false;}
    return !c.at||Date.now()-c.at<=RADAR_RETAIN_MS;
  });
  const allAnalyzed=tierConfig?.enabled?rankedPool.flatMap(c=>{
    const match=globalThis.OXTierFilters.resolve(c,tierConfig,cryptoFrameTier);
    if(!match)return [];
    // All requested frames must agree with the selected setup's direction.
    const directional=globalThis.OXTierFilters.resolve(c,tierConfig,cryptoFrameTier,match.value.side);
    if(!directional)return [];
    const selected=OXEngine.withTurnover({...c,...directional.value,reasons:[`${directional.frame} 時間組合`,...(directional.value.reasons||[])]},c.quoteVol);
    const price=num(state.tickers.find(t=>t.symbol===c.symbol)?.lastPr)||c.lastPrice,signal=selected.classicSignal,dir=selected.side==='SHORT'?-1:1;
    if(price&&signal?.invalidation?.level&&dir*(price-signal.invalidation.level)<-.2*signal.atr)return [];
    return [selected];
  }):rankedPool;
  const buildTierSet = pool => {
    // Money and actual directional candles break nearby setup scores. Daily
    // price change is supporting context, never a replacement for volume.
    const evidence = row => {
      const dir=row.side==='SHORT'?-1:1;
      const daily=dir*(Number(row.change24h)||0)*100;
      const recent=dir*(Number(row.ret4h)||0)*100;
      const turnover=Number(row.quoteVol)||0;
      const volume=row.classicSignal.triggerVolume||row.classicSignal.volume;
      const sustained=Number(volume?.sustainedBars)||0;
      const activeVolume=Number(volume?.recentRatio)||0;
      return Math.max(-2,Math.min(2,daily*.08))+
        Math.max(-3,Math.min(3,recent*.3))+
        Math.max(-6,Math.min(8,5*Math.log10(Math.max(1,turnover)/1e6)))+
        Math.max(-3,Math.min(4,(sustained-1)*2+Math.log2(Math.max(.5,activeVolume))));
    };
    const ranked = OXClassic.rankClassicTiers(pool, { compare: (a,b) =>
      (b.classicSignal.qualityScore+evidence(b))-(a.classicSignal.qualityScore+evidence(a)) ||
      OXClassic.compareClassic(a,b) || a.symbol.localeCompare(b.symbol) });
    return Object.fromEntries(['t1','t2','t3'].map(tier => [tier, ranked
      .filter(row => row.tier.toLowerCase() === tier).map(row => ({...row,tier,displayTier:tier}))]));
  };

  // 保留原本 combined tierMap 供首頁、OX LIVE、其他既有模組讀取。
  const combined = buildTierSet(allAnalyzed.filter(c => c.side === "LONG"));
  const longPool = allAnalyzed.filter(c => String(c.side || "").toUpperCase() === "LONG");
  const shortPool = allAnalyzed.filter(c => String(c.side || "").toUpperCase() === "SHORT");
  // 雷達則使用獨立六榜：LONG T1/T2/T3 與 SHORT T1/T2/T3，各自從全市場符合方向者重新排名。
  state.tierMapBySide = {
    long: buildTierSet(longPool),
    short: buildTierSet(shortPool)
  };

  const surge = allAnalyzed.filter(c => c.isSurge).sort((a, b) => b.flowScore - a.flowScore).slice(0, 15);
  const gainers = state.tickers.filter(t => num(t.change24h) > 0 && !benchmarkSymbols.has(t.symbol))
    .sort((a, b) => num(b.change24h) - num(a.change24h)).slice(0, 15);
  const losers = state.tickers.filter(t => num(t.change24h) < 0 && !benchmarkSymbols.has(t.symbol))
    .sort((a, b) => num(a.change24h) - num(b.change24h)).slice(0, 15);

  state.tierMap = { ...combined, surge, gainers, losers };
  syncDirectionalBadges();
  syncWatchBadge();
  if (state.activeView === 'strength') renderMarketStrength();
  if (state.activeView === 'home') renderHomeOverview();
  renderOxLive();
}

// 行情 → 雷達: the radar list, one full-width row per coin (logo, name with the tier,
// OX score and 24H 量, price, a solid change block, a star), T1／T2／T3 headings in
// the combined list. 熱門 is the 50 largest 24H 成交額; 自選 the starred coins.
// A tap opens the coin's 個股 page (runtime-actions.js). Class names the live
// quote painter patches stay: .coin-change, .turnover-price, .coin-volume-value.
function radarRowLogo(symbol) {
  const base = String(symbol).replace(/USDT$/, ""), key = base.replace(/^1000(?=[A-Z])/, "").toLowerCase();
  const src = typeof OX_COIN_LOGOS !== "undefined" ? OX_COIN_LOGOS[key] : null;
  return `<span class="ox-rl-logo" aria-hidden="true">${base.slice(0, 2)}${src ? `<img src="${src}" alt="" width="30" height="30" decoding="async" loading="lazy" onerror="this.remove()">` : ""}</span>`;
}
function radarRow(symbol, { sub, star = true, tier = "", extra = "" } = {}) {
  const t = state.tickers.find(x => x.symbol === symbol), coin = symbol.replace(/USDT$/, "");
  const change = num(t?.change24h), starred = isWatchlisted(symbol);
  return `<div class="coin-card ox-rl-row ${symbol === state.symbol ? "selected" : ""}" data-symbol="${symbol}"${tier ? ` data-tier="${tier}"` : ""} role="button" tabindex="0" aria-label="${coin}，打開個股頁">
    ${radarRowLogo(symbol)}<span class="ox-rl-name"><b>${coin}</b><small>${sub}${extra}</small></span>
    <span class="turnover-price">${t ? fmtPrice(t.lastPr) : "—"}</span>
    <span class="coin-change ${change >= 0 ? "positive" : "negative"}">${t ? fmtPct(t.change24h) : "—"}</span>
    ${star ? `<button class="watch-star ${starred ? "is-starred" : ""}" type="button" data-watch-symbol="${symbol}" aria-pressed="${starred}" aria-label="${starred ? "移出" : "加入"}自選 ${coin}">${WATCH_STAR_SVG}</button>` : "<span></span>"}
  </div>`;
}
const radarEmpty = (title, text) => `<div class="ox-rl-empty"><b>${title}</b>${text ? `<p>${text}</p>` : ""}</div>`;
const radarVolume = v => `<span class="coin-volume-value">${fmtCryptoVolume(v).replaceAll(",", "")}</span>`;

function renderCurrentTab() {
  const container = document.getElementById("screener-list");
  const tab = state.currentTab;
  if (!container) return;
  syncScannerFilterUI();

  if (tab === "surge") {
    const top = state.tickers
      .filter(t => Number.isFinite(num(t.usdtVolume)) && num(t.usdtVolume) > 0 && (state.activeMarket !== "crypto" || isCryptoSymbolAllowed(t.symbol)))
      .sort((a, b) => num(b.usdtVolume) - num(a.usdtVolume))
      .slice(0, 50);
    document.getElementById("pool-count").textContent = `24H 成交額前 ${top.length} 個`;
    container.innerHTML = top.length
      ? top.map((t, index) => radarRow(t.symbol, { sub: `#${index + 1}・24H 成交額 ${radarVolume(t.usdtVolume)}` })).join("")
      : radarEmpty("正在取得合約成交額…");
    return;
  }

  if (tab === "watch") {
    const savedAll = getWatchlistRecords().filter(rec => state.activeMarket !== "crypto" || isCryptoSymbolAllowed(rec.symbol));
    const saved = savedAll.filter(rec => {
      const analyzed = state.analyzedCache.get(rec.symbol);
      return passesDirectionFilter(analyzed?.side || rec.side || "—");
    });
    const dir = state.directionFilter === "long" ? "多頭" : "空頭";
    document.getElementById("pool-count").textContent = `${saved.length} 個${dir}自選`;
    syncWatchBadge();
    if (!saved.length) {
      container.innerHTML = radarEmpty(savedAll.length ? `自選裡目前沒有${dir}的幣種` : "還沒有自選", "在 T1／T2／T3 點 ☆ 就能加入自選。");
      return;
    }
    container.innerHTML = saved.map(rec => {
      const analyzed = state.analyzedCache.get(rec.symbol);
      const current = analyzed && OXClassic.qualifyClassicRow(analyzed, analyzed.side);
      const tier = current?.tier ? current.tier.toUpperCase() : "待確認";
      const score = analyzed?.oxScore ?? rec.oxScore;
      return radarRow(rec.symbol, { sub: `${tier}${score != null ? `・OX <em>${score}</em>` : ""}`, tier: current?.tier?.toLowerCase() || "" });
    }).join("");
    return;
  }

  const isTierTab = ["t1","t2","t3"].includes(tab);
  // The all entry opens the combined radar. Reuse the already
  // ranked directional results; never rebuild, sort or mutate them here.
  const combinedRadar = tab === "all";
  const sideTiers = state.tierMapBySide?.[state.directionFilter] || {};
  const tierGroups = combinedRadar ? ["t1", "t2", "t3"].map(tier => sideTiers[tier] || []) : [];
  const sourceList = combinedRadar ? tierGroups.flat() : isTierTab
    ? (sideTiers[tab] || [])
    : (state.tierMap[tab] || []).filter(c => passesDirectionFilter(c.side));
  const list = window.OXChartToolbar?.filterList(sourceList) || sourceList;
  const directionLabel = state.directionFilter === "long" ? "多頭" : "空頭";
  document.getElementById("pool-count").textContent = `${list.length} 個${directionLabel}${!state.radarSnapshotReady&&state.isQueueRunning?` · 已分析 ${state.analyzedCache.size}/${state.scanQueue.length}`:''}`;
  syncWatchBadge();
  if (!list.length) {
    if(state.radarLoadError||state.radarScanFailed||!state.radarSnapshotReady){
      const failed=state.radarLoadError||state.radarScanFailed;
      container.innerHTML=radarEmpty(failed?'行情資料尚未取得':'正在載入與分析行情',failed?'目前無法判斷入選幣種，連線恢復後會自動重試。':`已處理 ${state.scanIndex||0} / ${state.scanQueue.length||'—'} 個`);
      if(failed){const retry=document.createElement('button');retry.type='button';retry.textContent='重新連線';retry.onclick=()=>{state.radarScanFailed=false;state.radarSnapshotReady=false;refreshMarketTickers();};container.firstElementChild.append(retry);}
      return;
    }
    container.innerHTML = radarEmpty(`目前沒有符合 OX 經典的${directionLabel}幣種`, `符合條件後會依${combinedRadar ? " T1 → T2 → T3 順序" : `目前 T${isTierTab ? tab.slice(1) : ""} 排名`}顯示。`);
    return;
  }

  const counts = {};
  for (const c of list) { const t = c.displayTier || c.tier || "t3"; counts[t] = (counts[t] || 0) + 1; }
  container.innerHTML = list.map((c, idx) => {
    const displayTier = c.displayTier || c.tier || "t3";
    const previousTier = idx > 0 ? (list[idx-1].displayTier || list[idx-1].tier || "t3") : null;
    const heading = (combinedRadar || idx === 0) && displayTier !== previousTier ? `<div class="ox-rl-sec" data-tier="${displayTier}">${displayTier.toUpperCase()}<small>${counts[displayTier]} 個</small></div>` : "";
    const stale = c.at && Date.now() - c.at > 300000 ? "・更新中" : "";
    return heading + radarRow(c.symbol, { tier: displayTier, sub: `OX <em class="coin-ox-value">${c.oxScore}</em>・24H 量 ${radarVolume(c.quoteVol)}${stale}`, extra: c.setupName ? `<span class="ox-rl-setup">・${c.setupName}</span>` : "" });
  }).join("");
}

if(typeof document!=='undefined')document.addEventListener('ox:timeframe-tier-change',event=>{
 if(event.detail.market!=='crypto')return;
 state.scanIndex=0;rebuildTierLists();if(state.activeMarket==='crypto'&&radarListVisible())renderCurrentTab();
});

function cancelHiddenCryptoScan(){if(document.hidden||state.activeMarket!=='crypto'||!radarScanView())globalThis.OXPublicFeed.cancel('radar-scan');radarWake?.();}
if(typeof document!=='undefined')for(const event of ['ox:viewchange','ox:marketchange','visibilitychange'])document.addEventListener(event,cancelHiddenCryptoScan);
