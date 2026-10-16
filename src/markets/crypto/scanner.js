const WATCH_STAR_SVG = '<svg class="watch-star-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91Z"/></svg>';

const RADAR_RETAIN_MS=2*60*60*1000;
const RADAR_SNAPSHOT_KEY = 'ox-radar-snapshot-v9-strategy';
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

// Refill a completed slot immediately; a slow symbol must not hold the next
// liquid candidates behind an entire fixed batch.
async function scanCryptoPool(next,scan,limit=3){
 await Promise.allSettled(Array.from({length:limit},async()=>{let symbol;while((symbol=next())!==null){await scan(symbol);await new Promise(resolve=>setTimeout(resolve,0));}}));
}
function restoreRadarSnapshot() {
  if (state.radarSnapshotChecked) return;
  state.radarSnapshotChecked = true;
  try {
    const snapshot = JSON.parse(localStorage.getItem(RADAR_SNAPSHOT_KEY));
    if (!snapshot || Date.now()-snapshot.savedAt > RADAR_RETAIN_MS || !Array.isArray(snapshot.rows)) return;
    const tickers = new Map(state.tickers.map(t=>[t.symbol,t]));
    for (const row of snapshot.rows) {
      const ticker=tickers.get(row.symbol);
      const strategyListed=!!row.radar&&row.radar.version===globalThis.OXRadarStrategy?.RADAR_STRATEGY_VERSION&&
        ['long','short'].some(side=>row.radar[side]?.listed||row.radar[side]?.fillable);
      if (!ticker || !isCryptoSymbolAllowed(row.symbol) || !strategyListed&&!['long','short'].some(side=>
        OXClassic.qualifyClassicRow(row,side,{observations:true}))) continue;
      state.analyzedCache.set(row.symbol,OXEngine.withTurnover({...row,ticker,change24h:num(ticker.change24h)},ticker.usdtVolume));
    }
    state.radarSnapshotReady = state.analyzedCache.size > 0;
  } catch (_) {}
}
function saveRadarSnapshot() {
  try { localStorage.setItem(RADAR_SNAPSHOT_KEY,JSON.stringify({savedAt:Date.now(),rows:[...state.analyzedCache.values()]})); } catch (_) {}
}

function closedTierCandles(candles,frame,now=Date.now()) {
 const duration=({m:60,H:3600,D:86400,W:604800})[frame.slice(-1)]*Number(frame.slice(0,-1));
 return candles.filter(c=>{
  // Bitget 1Dutc/1Wutc/1Mutc bars open at 00:00 UTC; a month closes at the next UTC month start.
  const open=new Date(c.time*1000);
  const end=frame.endsWith('M')?Date.UTC(open.getUTCFullYear(),open.getUTCMonth()+Number(frame.slice(0,-1)),1)/1000:c.time+duration;
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
// One symbol index per ticker refresh. Ranking used to call
// state.tickers.find() for every analysed row (O(rows x tickers)).
let tickerIndexSource=null,tickerIndexMap=new Map();
function tickerIndex(){
 if(tickerIndexSource!==state.tickers){tickerIndexSource=state.tickers;tickerIndexMap=new Map((state.tickers||[]).map(t=>[t.symbol,t]));}
 return tickerIndexMap;
}
// Keyed list patching: unchanged cards keep their DOM node (and any live quote
// text patched into it); only changed, added or moved cards touch the DOM.
const radarCardCache={container:null,byKey:new Map(),placeholder:null,placeholderHost:null};
function resetRadarCards(container,html){
 radarCardCache.container=null;radarCardCache.byKey.clear();
 if(radarCardCache.placeholderHost===container&&radarCardCache.placeholder===html&&container.firstElementChild)return;
 radarCardCache.placeholder=html;radarCardCache.placeholderHost=container;container.innerHTML=html;
}
function renderRadarCards(container,items){
 radarCardCache.placeholder=null;radarCardCache.placeholderHost=null;
 if(radarCardCache.container!==container){radarCardCache.container=container;radarCardCache.byKey.clear();container.replaceChildren();}
 const next=new Map(),nodes=[];
 for(const [key,html] of items){
  let entry=radarCardCache.byKey.get(key);
  if(!entry||entry.html!==html||entry.node.parentNode&&entry.node.parentNode!==container){
   const template=document.createElement('template');template.innerHTML=html.trim();
   entry={html,node:template.content.firstElementChild};
  }
  next.set(key,entry);nodes.push(entry.node);
 }
 // Remove nodes that are no longer listed (including non-card placeholders).
 for(const child of [...container.children])if(!nodes.includes(child))child.remove();
 for(let i=0;i<nodes.length;i++)if(container.children[i]!==nodes[i])container.insertBefore(nodes[i],container.children[i]||null);
 radarCardCache.byKey=next;
}
function setTextIfChanged(id,text){const el=document.getElementById(id);if(el&&el.textContent!==text)el.textContent=text;}
function cryptoFrameTier(row,frame,side) {
 const data=row.timeframeTiers?.[frame];
 return data&&data.eligible&&Date.now()-data.at<=RADAR_RETAIN_MS&&(!side||data.side?.toLowerCase()===side.toLowerCase())?data:null;
}
// Contracts below the lowest turnover band never enter the scan pool or the
// ranking. liquidity-policy.js keeps the band caps for everything above it.
const scanTurnoverOK=turnover=>{const value=Number(turnover);return Number.isFinite(value)&&value>=(OXCryptoLiquidity.MIN_SCAN_TURNOVER??300000);};
// Stablecoins and gold-backed tokens are separate products: they never share
// the crypto radar ranking. BTC/ETH stay benchmarks (see benchmarkSymbols).
const radarProductOK=symbol=>{const cls=globalThis.OXRadarStrategy?.productClass(symbol,state.instrumentCatalog?.get(symbol));return cls!=='stablecoin'&&cls!=='gold-token';};
// A missing frame is marked on the row and its setups cannot be T1. The
// liquidity policy keeps the lowered tier as rawTier, so turnover can never
// promote it back.
function markDataGap(signal,reason){
 if(!signal)return signal;
 const note=reason+' · 不列 T1';
 return {...signal,tier:signal.tier==='T1'?'T2':signal.tier,dataGap:reason,
  reasons:[...(signal.reasons||[]),note],rejectionReasons:signal.eligible?(signal.rejectionReasons||[]):[...(signal.rejectionReasons||[]),note]};
}
// Weekly bars only add the higher-frame overhead check to daily setups. They
// are fetched for daily candidates only (Bitget 1Wutc, Monday 00:00 UTC) and
// kept until the next weekly open, because closed weekly bars cannot change.
const WEEK_SECONDS=604800,WEEK_ANCHOR=345600,weeklyContext=new Map();
const nextUtcWeek=(nowMs=Date.now())=>(Math.floor((nowMs/1000-WEEK_ANCHOR)/WEEK_SECONDS)+1)*WEEK_SECONDS+WEEK_ANCHOR;
// Weekly bars already in memory for this week (any coin, any pass). Coins that
// are not candidates get theirs fetched quietly in the background, so from the
// next pass every coin has weekly structure and the 1W setup can be checked.
function weeklyReady(symbol,now=Date.now()){
 const cached=weeklyContext.get(symbol);
 return cached&&now/1000<cached.until&&cached.value?cached.value:null;
}
function fetchWeeklyContext(symbol,now=Date.now(),priority=0){
 const cached=weeklyContext.get(symbol);
 if(cached&&now/1000<cached.until)return cached.promise;
 const options={owner:'radar-scan',priority},needed=OXClassic.CLASSIC_RULES.minimumBars+5;
 const promise=(async()=>{
  let rows=await BitgetAPI.fetchCandles(symbol,'1W',200,null,options);
  // The recent endpoint returns only a few months of weekly bars; page the
  // history endpoint (at most three requests) until enough closed weeks exist.
  for(let page=0;page<3&&rows.length&&rows.filter(c=>c.time+WEEK_SECONDS<=now/1000).length<needed;page++){
   const earliest=rows[0].time,older=(await BitgetAPI.fetchCandles(symbol,'1W',200,earliest*1000,options)).filter(c=>c.time<earliest);
   if(!older.length)break;rows=[...older,...rows];
  }
  return cryptoClassicBars(rows,'1W',now);
 })();
 const entry={until:nextUtcWeek(now),promise};weeklyContext.set(symbol,entry);
 promise.then(value=>{entry.value=value;},()=>{});
 // A cancelled request (leaving the radar, background tab) is not a data gap:
 // drop it so the next scan fetches again. Real failures retry after 5 minutes.
 promise.catch(error=>{if(weeklyContext.get(symbol)!==entry)return;if(error?.name==='AbortError')weeklyContext.delete(symbol);else entry.until=now/1000+300;});
 if(weeklyContext.size>600)weeklyContext.delete(weeklyContext.keys().next().value);
 return promise;
}
// Daily bars: Bitget's recent endpoint returns about 90 days. The page before
// the earliest of those never changes, so it is fetched once per coin in the
// background (lowest priority) and kept for the session; from the next pass the
// daily setups, daily structure and overhead walls see about 180 days.
const dailyHistory=new Map();
function dailyHistoryFor(symbol,earliest){
 const cached=dailyHistory.get(symbol);
 if(cached?.value)return cached.value.filter(c=>c.time<earliest);
 if(cached||!earliest)return null;
 const entry={};
 entry.promise=BitgetAPI.fetchCandles(symbol,'1D',200,earliest*1000,{owner:'radar-scan',priority:-1})
  .then(rows=>{entry.value=rows.filter(c=>c.time<earliest);return entry.value;});
 entry.promise.catch(()=>{if(dailyHistory.get(symbol)===entry)dailyHistory.delete(symbol);});
 dailyHistory.set(symbol,entry);
 if(dailyHistory.size>800)dailyHistory.delete(dailyHistory.keys().next().value);
 return null;
}
let refreshingMarketTickers=false;
async function refreshMarketTickers() {
  if (state.activeMarket && state.activeMarket !== "crypto") return;
  // Background tabs keep the last snapshot; runtime-boot refreshes on return.
  if (typeof document !== "undefined" && document.hidden && state.tickers?.length) return;
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

    state.tickers = rawTickers.filter(t => 
      state.contracts.has(t.symbol) && 
      isCryptoSymbolAllowed(t.symbol) &&
      [t.lastPr, t.change24h, t.usdtVolume].every(v => Number.isFinite(num(v)))
    );

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
    const eligible = state.tickers.filter(t => scanTurnoverOK(t.usdtVolume)&&radarProductOK(t.symbol));
    const scanOrder=orderCryptoScanTickers(eligible);
    
    if (!state.scanQueue.length) {
      state.scanQueue = scanOrder.map(t => t.symbol);
      state.scanIndex = 0;
    }

    restoreRadarSnapshot();
    rebuildTierLists();
    if (state.activeView === 'radar') {
      renderCurrentTab();
      updateHeaderHUD();
      renderBenchmarkBar();
    }
    checkLevelAlerts();

    if (!state.isQueueRunning) {
      state.isQueueRunning = true;
      runScanQueueLoop();
    }
  } catch (e) {
    state.radarLoadError=true;
    document.getElementById("scan-status").textContent = `行情取得失敗：${e.message}`;
    document.getElementById("dot").style.background = "#ee617c";
  } finally { refreshingMarketTickers=false;loading?.finish();if(state.activeMarket==='crypto'&&state.activeView==='radar')renderCurrentTab(); }
}

let radarPaintTimer=0, radarPaintedAt=0, initialScanLoading=null, passCompleted=0, passFailed=0, radarWake=null, radarRestUntil=0;
// A qualifying symbol is still published as soon as it is analysed (the first
// one immediately); later updates are coalesced to at most one ranking/render
// per second instead of one every 100 ms during a 480-symbol pass.
const RADAR_PAINT_MS=1000, RADAR_PASS_REST_MS=60000;
let radarRankDirty=true,radarPassId=0;
const RADAR_FAILED_REST_MS=10000;
// User-initiated refresh / reconnect: drop the between-pass rest and wake the
// sleeping scan loop so a new pass starts now instead of after the rest.
function restartRadarScan(){
  radarRestUntil=0;state.scanIndex=0;radarRankDirty=true;radarPassId++;
  radarWake?.();
  return refreshMarketTickers();
}
function waitForRadar(ms){return new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);if(radarWake===done)radarWake=null;resolve();};radarWake=done;timer=setTimeout(done,ms);});}
function publishRadarProgress(immediate=false) {
  if (!immediate) {
    if (!radarPaintTimer) radarPaintTimer=setTimeout(()=>publishRadarProgress(true),Math.max(0,RADAR_PAINT_MS-(Date.now()-radarPaintedAt)));
    return;
  }
  clearTimeout(radarPaintTimer);radarPaintTimer=0;radarPaintedAt=Date.now();
  if (state.activeMarket !== 'crypto') return;
  // Rank again only when a scan result or the ticker snapshot changed.
  if (!radarRankDirty && tickerIndexSource === state.tickers) return;
  radarRankDirty=false;
  rebuildTierLists();
  if (state.activeView === 'radar') {
    renderCurrentTab();updateHeaderHUD();renderBenchmarkBar();
  }
}
async function runScanQueueLoop() {
  while (true) {
    // Keep the ranking data, but do not spend CPU scanning Crypto in the
    // background while another market, page, or browser tab is visible.
    if (document.hidden || state.activeMarket !== 'crypto' || !['home','radar'].includes(state.activeView)) {
      await waitForRadar(document.hidden ? 15000 : 8000);
      continue;
    }
    if (!state.scanQueue.length) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    // Rest after a complete pass. Waking (view/visibility change) re-checks
    // the deadline instead of starting the next 480-symbol pass early.
    if (Date.now() < radarRestUntil) {
      await waitForRadar(radarRestUntil - Date.now());
      continue;
    }

    if(!state.radarSnapshotReady&&!initialScanLoading)initialScanLoading=window.OXLoading?.begin('crypto','掃描幣種',{done:0,total:state.scanQueue.length,views:['home','strength']});
    const batchSymbols = [];
    const remaining = state.scanQueue.length-state.scanIndex;
    const extraFrames=globalThis.OXTierFilters?.get('crypto').enabled?globalThis.OXTierFilters.get('crypto').rules.filter(r=>!['1H','4H','1D'].includes(r.frame)).length:0;
    const batchLimit=Math.min(CONFIG.queueBatchSize,Math.max(1,Math.floor(20/(3+extraFrames))));
    const nextScan=()=>{
      if(document.hidden||state.activeMarket!=='crypto'||!['home','radar'].includes(state.activeView)||state.scanIndex>=state.scanQueue.length)return null;
      const symbol=state.scanQueue[state.scanIndex++];batchSymbols.push(symbol);
      document.getElementById("scan-status").textContent=`輪巡 ${state.scanIndex}/${state.scanQueue.length}`;
      return symbol;
    };

    document.getElementById("scan-status").textContent = `輪巡 ${state.scanIndex}/${state.scanQueue.length}`;
    document.getElementById("dot").style.background = "#38c99b";

    await scanCryptoPool(nextScan,async symbol => {
      const ticker = tickerIndex().get(symbol);
      if (!ticker) return;
      const pass=radarPassId,current=()=>!document.hidden&&state.activeMarket==='crypto'&&['home','radar'].includes(state.activeView)&&pass===radarPassId;

      try {
        const [candles,contextBars,dailyResult] = await Promise.all([
          BitgetAPI.fetchCandles(symbol, '1H', 180,null,{owner:'radar-scan',priority:0}), BitgetAPI.fetchCandles(symbol, '4H', 180,null,{owner:'radar-scan',priority:0}),
          BitgetAPI.fetchCandles(symbol,'1D',180,null,{owner:'radar-scan',priority:0}).then(bars=>({bars}),error=>({error}))
        ]);
        if(state.activeMarket!=='crypto'||!['home','radar'].includes(state.activeView))return;
        // A failed daily request is a data gap, not an empty market: the row is
        // marked and none of its setups (all use daily context) can be T1.
        const dailyGap=!!dailyResult.error;
        const recentDaily=dailyGap?[]:dailyResult.bars,olderDaily=recentDaily.length?dailyHistoryFor(symbol,recentDaily[0].time):null;
        const frames={'1H':cryptoClassicBars(candles,'1H'),'4H':cryptoClassicBars(contextBars,'4H'),'1D':cryptoClassicBars(olderDaily?.length?[...olderDaily,...recentDaily]:recentDaily,'1D')};
        const cachedWeekly=weeklyReady(symbol);
        if(cachedWeekly)frames['1W']=cachedWeekly;
        // A rate-limit or malformed candle response must not replace a valid
        // prior scan with a neutral row and make the symbol disappear.
        if(frames['1H'].length<OXClassic.CLASSIC_RULES.minimumBars||
           frames['4H'].length<OXClassic.CLASSIC_RULES.minimumBars)throw Error('核心級別 K 線不足');
        const dailySetup=side=>OXClassic.evaluateFrames(frames,{side,setupFrame:'1D',triggerFrame:'4H',confirmationFrame:'1H'});
        const fourHour=side=>OXClassic.evaluateFrames(frames,{side,setupFrame:'4H',triggerFrame:'1H'});
        let daily={long:dailySetup('long'),short:dailySetup('short')},weeklyGap=false;
        // Weekly bars give daily setups their overhead check and give any long
        // candidate the weekly structure / remaining-space context.
        const fourHourLong=fourHour('long');
        // Each setup frame on its own (with its larger context): a qualifying
        // setup stays visible as "smaller frame pending" in the strategy layer.
        // 1W setups (weekly pressure / pattern / reversal) confirmed on 1D, once weekly bars are in memory.
        const weeklyEnough=()=>(frames['1W']?.length||0)>=OXClassic.CLASSIC_RULES.minimumBars;
        const standalone=side=>[OXClassic.evaluateClassic(frames['4H'],{side,frame:'4H',contextFrame:'1D',contextBars:frames['1D']}),
          ...(frames['1D'].length?[OXClassic.evaluateClassic(frames['1D'],{side,frame:'1D',contextFrame:'1W',contextBars:frames['1W']})]:[]),
          ...(side==='long'&&weeklyEnough()?[OXClassic.evaluateClassic(frames['1W'],{side,frame:'1W'})]:[])];
        const qualifies=s=>s.eligible||s.observationEligible;
        if(!frames['1W']&&!dailyGap&&(Object.values(daily).some(qualifies)||qualifies(fourHourLong)||standalone('long').some(qualifies))){
          try {frames['1W']=await fetchWeeklyContext(symbol);}
          catch (error) {if(error?.name==='AbortError')throw error;weeklyGap=true;}
          // The weekly request can outlive the view or the pass that started it.
          if(!current())return;
          if(frames['1W'])daily={long:dailySetup('long'),short:dailySetup('short')};
        } else if(!frames['1W'])fetchWeeklyContext(symbol,Date.now(),-1).catch(()=>{});
        const weeklySetup=!dailyGap&&weeklyEnough()?OXClassic.evaluateFrames(frames,{side:'long',setupFrame:'1W',triggerFrame:'1D',confirmationFrame:'4H'}):null;
        const dataGaps=[...(dailyGap?['1D']:[]),...(weeklyGap?['1W']:[])];
        const sideSignals=Object.fromEntries(['long','short'].map(side=>{
          const signals=[side==='long'?fourHourLong:fourHour('short'),
            weeklyGap?markDataGap(daily[side],'週線 K 線暫缺，未確認週線上方空間'):daily[side],
            ...(side==='long'&&weeklySetup?[weeklySetup]:[])];
          const fast=intradayClassicObservation(frames,side);
          if(fast)signals.push(fast);
          return [side,signals];
        }));
        const classic=Object.fromEntries(Object.entries(sideSignals).map(([side,signals])=>{
          const ranked=signals.map(s=>dailyGap?markDataGap(s,'日線 K 線暫缺'):s);
          const qualified=ranked.filter(s=>s.eligible||s.observationEligible).sort(OXClassic.compareClassic);
          return [side,qualified[0]||ranked[0]];
        }));
        // 雷達策略層：入選途徑、資金、扣分、四要素與頂部確認空單。
        const radar=globalThis.OXRadarStrategy?.evaluateSymbol({symbol,contract:state.instrumentCatalog?.get(symbol),ticker,frames,
          longSignals:sideSignals.long,setupSignals:standalone('long'),dataGaps,price:num(ticker.lastPr)})||null;
        const candidates=Object.values(classic).filter(s=>s.eligible||s.observationEligible).sort(OXClassic.compareClassic);
        const signal=candidates[0]||classic.long;
        const row=OXEngine.describe(signal,classic),liq=OXEngine.computeLiquidity(ticker,state.tickers),rs=OXEngine.computeRelativeStrength(ticker,state.btcTicker);
        const timeframeTiers=Object.fromEntries(['1H','4H','1D'].map(frame=>[frame,classifyTierFrame(frames[frame],frame)]));
        const tierConfig=globalThis.OXTierFilters?.get('crypto');
        if(tierConfig?.enabled&&frames['1W']&&tierConfig.rules.some(r=>r.frame==='1W'))timeframeTiers['1W']=classifyTierFrame(frames['1W'],'1W');
        if(tierConfig?.enabled)await Promise.all(tierConfig.rules.filter(r=>!timeframeTiers[r.frame]&&!['1H','4H','1D'].includes(r.frame)).map(async rule=>{
          try {timeframeTiers[rule.frame]=classifyTierFrame(await BitgetAPI.fetchCandles(symbol,rule.frame,180,null,{owner:'radar-scan',priority:0}),rule.frame);}
          catch {timeframeTiers[rule.frame]=null;}
        }));
        state.analyzedCache.set(symbol, OXEngine.withTurnover({
          ...row,timeframeTiers,dataGaps,radar,symbol,ticker,at:Date.now(),lastPrice:candles.at(-1)?.close,
          signalFrame:signal.frame||'4H',triggerFrame:signal.triggerFrame||'1H',sparkline:candles.slice(-24).map(c=>c.close),
          liqScore:liq.score,rsScore:rs.score,quoteVol:liq.quoteVol,liqPercentile:liq.percentileStr,
          reasons:row.reasons,
          change24h:num(ticker.change24h),ret1h:candleReturn(candles,1),ret4h:candleReturn(candles,4),
          ret24h:candleReturn(candles,24),
        },ticker.usdtVolume));
        passCompleted++;radarRankDirty=true;
        const firstCandidate=(radar?['long','short'].some(side=>radar[side]?.listed||radar[side]?.fillable):(signal.eligible||signal.observationEligible))&&
          !['t1','t2','t3'].some(tier=>['long','short'].some(side=>state.tierMapBySide?.[side]?.[tier]?.length));
        publishRadarProgress(firstCandidate);
      } catch (e) {if(e?.name!=='AbortError'&&state.activeMarket==='crypto'&&['home','radar'].includes(state.activeView))passFailed++;} finally { const n=(initialScanLoading?.done||0)+1;if(initialScanLoading){initialScanLoading.done=n;initialScanLoading.update(n,state.scanQueue.length);} }
    },Math.min(3,batchLimit));

    if(document.hidden||state.activeMarket!=='crypto'||!['home','radar'].includes(state.activeView)){state.scanIndex=Math.max(0,state.scanIndex-Math.min(3,batchSymbols.length));continue;}
    const completed = state.scanIndex >= state.scanQueue.length;
    // A completed pass persists the snapshot; visible rows are published as
    // their own analysis completes, even while another request is pending.
    let passFailedEntirely=false;
    if (completed) {
      initialScanLoading?.finish();initialScanLoading=null;
      passFailedEntirely=passCompleted===0;radarPassId++;
      // Refresh the universe between full passes so newly listed contracts
      // can enter the radar without a page reload.
      state.scanQueue=orderCryptoScanTickers(state.tickers.filter(t=>scanTurnoverOK(t.usdtVolume)&&radarProductOK(t.symbol))).map(t=>t.symbol);
      state.scanIndex = 0;
      state.radarSnapshotReady = passCompleted>0&&passFailed===0;
      state.radarScanFailed = passFailed>0||passCompleted===0;
      if(passCompleted>0)saveRadarSnapshot();
      passCompleted=0;passFailed=0;
      // The pass outcome changes the list state (ready / error), so repaint it now.
      radarRankDirty=true;
    }
    publishRadarProgress(true);
    // All tools share the public-feed scheduler and its 429 cooldown.
    // Rate limiting belongs to public-feed. Batches continue back to back; a
    // completed pass rests before the next one so an idle radar stays quiet.
    // A pass that produced nothing retries after a short pause instead of the full rest.
    if(completed)radarRestUntil=Date.now()+(passFailedEntirely?RADAR_FAILED_REST_MS:Math.max(CONFIG.batchIntervalMs,RADAR_PASS_REST_MS));
    await waitForRadar(0);
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
// A strategy row for one side: the radar decision decides membership, score
// and wording. Live price beyond the structure invalidation drops the row.
// Fill candidates (only soft rejections) may take the T2／T3 places the
// selected rows leave empty, never T1, and never on the side opposite to a
// side where the coin is actually selected.
function radarRowFor(c,side,tickers){
  const r=c.radar?.[side],other=c.radar?.[side==='long'?'short':'long'];
  if(!(r?.listed||r?.fillable)||!r.elements||!r.pathway)return null;
  // One coin, one direction: a fill never sits opposite a selection, and a
  // coin selected on both sides stays only where it scores higher (score,
  // then certainty, then strength; an exact tie stays on the long side).
  const edge=other?.listed&&r.listed?(other.score-r.score)||((other.elements?.certainty??0)-(r.elements?.certainty??0))||
    ((other.elements?.strength??0)-(r.elements?.strength??0)):0;
  if(other?.listed&&(!r.listed||edge>0||edge===0&&side==='short'))return null;
  const price=num(tickers.get(c.symbol)?.lastPr)||c.lastPrice;
  if(price&&Number.isFinite(r.stop)&&(side==='long'?price<r.stop:price>r.stop))return null;
  const deductions=(r.deductions||[]).filter(d=>d.points>0),fill=!r.listed;
  return {...c,side:side.toUpperCase(),radarSide:r,radarFill:fill,oxScore:r.score,signalFrame:r.frame,triggerFrame:r.triggerFrame,
    setupName:'OX 雷達 · '+(fill?'補位':r.pathway.group),statusText:r.pathway.name,rankStatus:r.pathway.name,
    reasons:[...(fill?['補位（未完全入選）：'+(r.fillReason||'條件不足')]:[]),...(r.matched||[]).slice(0,fill?3:4),
      ...deductions.slice(0,2).map(d=>d.text+' −'+d.points)],observationOnly:!r.t1};
}
function rebuildTierLists() {
  const tierConfig=globalThis.OXTierFilters?.get('crypto');
  const tickers=tickerIndex();
  const strategy=globalThis.OXRadarStrategy,useStrategy=!tierConfig?.enabled&&!!strategy;
  const rankedPool=Array.from(state.analyzedCache.values())
    .filter(c=>isCryptoSymbolAllowed(c.symbol)&&radarProductOK(c.symbol))
    .map(c=>OXEngine.withTurnover(c,tickers.get(c.symbol)?.usdtVolume??c.quoteVol))
    // Known turnover below the scan floor drops out (e.g. a restored snapshot
    // row whose live 24H turnover has since fallen under 300,000 USDT).
    .filter(c=>c.quoteVol===null||c.quoteVol===undefined||scanTurnoverOK(c.quoteVol))
    .flatMap(c=>tierConfig?.enabled||useStrategy?[c]:radarSideRows(c)).filter(c=>{
    if(useStrategy)return !benchmarkSymbols.has(c.symbol)&&c.radar?.version===strategy.RADAR_STRATEGY_VERSION&&(!c.at||Date.now()-c.at<=RADAR_RETAIN_MS);
    if(benchmarkSymbols.has(c.symbol)||(!tierConfig?.enabled&&!OXClassic.qualifyClassicRow(c,c.side,{observations:true})))return false;
    const signal=c.classicSignal,price=num(tickers.get(c.symbol)?.lastPr)||c.lastPrice;
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
    const price=num(tickers.get(c.symbol)?.lastPr)||c.lastPrice,signal=selected.classicSignal,dir=selected.side==='SHORT'?-1:1;
    if(price&&signal?.invalidation?.level&&dir*(price-signal.invalidation.level)<-.2*signal.atr)return [];
    return [selected];
  }):rankedPool;
  const buildTierSet = pool => {
    // Setup quality plus money (turnover and sustained same-direction volume)
    // decides the order: a setup at its critical level with volume ranks above
    // a plain price move. 24H change and the 4H return only break exact ties.
    const evidence = row => {
      const turnover=Number(row.quoteVol)||0;
      const volume=row.classicSignal.triggerVolume||row.classicSignal.volume;
      const sustained=Number(volume?.sustainedBars)||0;
      const activeVolume=Number(volume?.recentRatio)||0;
      return Math.max(-6,Math.min(8,5*Math.log10(Math.max(1,turnover)/1e6)))+
        Math.max(-3,Math.min(4,(sustained-1)*2+Math.log2(Math.max(.5,activeVolume))));
    };
    const momentum = row => {
      const dir=row.side==='SHORT'?-1:1;
      return Math.max(-2,Math.min(2,dir*(Number(row.change24h)||0)*100*.08))+
        Math.max(-3,Math.min(3,dir*(Number(row.ret4h)||0)*100*.3));
    };
    const ranked = OXClassic.rankClassicTiers(pool, { compare: (a,b) =>
      (b.classicSignal.qualityScore+evidence(b))-(a.classicSignal.qualityScore+evidence(a)) ||
      OXClassic.compareClassic(a,b) || momentum(b)-momentum(a) || a.symbol.localeCompare(b.symbol) });
    return Object.fromEntries(['t1','t2','t3'].map(tier => [tier, ranked
      .filter(row => row.tier.toLowerCase() === tier).map(row => ({...row,tier,displayTier:tier}))]));
  };

  const strategyTierSet=side=>{
    const ranked=strategy.rankRadar(allAnalyzed.map(c=>radarRowFor(c,side,tickers)).filter(Boolean));
    return Object.fromEntries(['t1','t2','t3'].map(tier=>[tier,ranked[tier].map(row=>({...row,tier,displayTier:tier,
      qualityTier:row.radarSide.t1?'T1':null}))]));
  };
  if(useStrategy){
    // 雷達策略：多單依入選途徑與四要素排名，空單改用頂部確認，各自獨立成榜。
    state.tierMapBySide={long:strategyTierSet('long'),short:strategyTierSet('short')};
    // 雷達成績單：進榜的幣自動記下（只記這台裝置看到的、30 分鐘內的分析）。
    try{globalThis.OXRadarReport?.record(state.tierMapBySide,{priceOf:symbol=>num(tickers.get(symbol)?.lastPr)||null});}catch{}
  } else {
    // 雷達則使用獨立六榜：LONG T1/T2/T3 與 SHORT T1/T2/T3，各自從全市場符合方向者重新排名。
    state.tierMapBySide = {
      long: buildTierSet(allAnalyzed.filter(c => String(c.side || "").toUpperCase() === "LONG")),
      short: buildTierSet(allAnalyzed.filter(c => String(c.side || "").toUpperCase() === "SHORT"))
    };
  }
  // 保留原本 combined tierMap 供首頁、OX LIVE、其他既有模組讀取。
  const combined = useStrategy ? state.tierMapBySide.long : buildTierSet(allAnalyzed.filter(c => c.side === "LONG"));

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

// 四要素：確定性、盈虧比、幅度、強度（使用者的進場要素）。未知空間顯示「—」，不假設無限空間。
function radarElementPills(r){
  const e=r.elements||{},sign=r.side==='SHORT'?'−':'+';
  const room=e.room===null||e.room===undefined?'—':sign+(e.room*100).toFixed(e.room>=.1?0:1)+'%';
  const rr=e.rr===null||e.rr===undefined?'—':e.rr.toFixed(1);
  return `<span class="score-pill" title="確定性：途徑、壓力測試次數、級別與結構">確定性 ${e.certainty??'—'}</span>`+
    `<span class="score-pill" title="盈虧比：到目標的距離 ÷ 到結構失效的距離">盈虧比 ${rr}</span>`+
    `<span class="score-pill" title="幅度：到下一個目標的剩餘空間">幅度 ${room}</span>`+
    `<span class="score-pill" title="強度：成交額、相對 7 日平均的放大倍數與量價配合">強度 ${e.strength??'—'}</span>`;
}

function renderCurrentTab() {
  const container = document.getElementById("screener-list");
  const tab = state.currentTab;
  if (!container) return;
  syncScannerFilterUI();

  if (tab === "surge") {
    const top = state.tickers
      .filter(t => Number.isFinite(num(t.usdtVolume)) && num(t.usdtVolume) > 0)
      .sort((a, b) => num(b.usdtVolume) - num(a.usdtVolume))
      .slice(0, 50);
    setTextIfChanged("pool-count", `24H 成交額前 ${top.length} 檔`);
    if (!top.length) {
      resetRadarCards(container, '<div class="turnover-empty">正在取得合約成交額…</div>');
      return;
    }
    renderRadarCards(container, top.map((t, index) => ['surge:'+t.symbol, `<div class="coin-card turnover-card ${t.symbol === state.symbol ? 'selected' : ''}" data-symbol="${escapeHtml(t.symbol)}" role="button" tabindex="0" aria-label="第 ${index + 1} 名 ${escapeHtml(t.symbol)}，24 小時成交額 ${fmtCryptoVolumeUSDT(t.usdtVolume)}，最新價格 ${fmtPrice(t.lastPr)}，漲跌 ${fmtPct(t.change24h)}">
      <div class="turnover-name"><span class="turnover-rank">#${index + 1}</span><span class="turnover-symbol" title="${escapeHtml(t.symbol)}">${escapeHtml(t.symbol.replace(/USDT$/, ''))}</span></div>
      <div class="turnover-volume">24H ${fmtCryptoVolumeUSDT(t.usdtVolume)}</div>
      <div class="turnover-price">${fmtPrice(t.lastPr)}</div>
      <div class="turnover-change ${num(t.change24h) >= 0 ? 'positive' : 'negative'}">${fmtPct(t.change24h)}</div>
    </div>`]));
    return;
  }

  if (tab === "watch") {
    const savedAll = getWatchlistRecords().filter(rec => state.activeMarket !== "crypto" || isCryptoSymbolAllowed(rec.symbol));
    const saved = savedAll.filter(rec => {
      const analyzed = state.analyzedCache.get(rec.symbol);
      return passesDirectionFilter(analyzed?.side || rec.side || "—");
    });
    setTextIfChanged("pool-count", `${saved.length} 檔${state.directionFilter === "long" ? "多頭" : "空頭"}收藏`);
    syncWatchBadge();
    if (!saved.length) {
      const dir = state.directionFilter === "long" ? "LONG" : "SHORT";
      resetRadarCards(container, `<div style="padding:30px 16px;text-align:center;color:var(--muted)"><b>${savedAll.length ? `觀察列表目前沒有 ${dir} 標的` : "還沒有收藏標的"}</b><p style="font-size:11px">在 T1 / T2 / T3 點 ☆ 即可加入 ⭐觀察。</p></div>`);
      return;
    }
    renderRadarCards(container, saved.map((rec, idx) => {
      const analyzed = state.analyzedCache.get(rec.symbol);
      const ticker = tickerIndex().get(rec.symbol);
      const c = analyzed || rec;
      const current=analyzed&&OXClassic.qualifyClassicRow(analyzed,analyzed.side);
      const tier = current?.tier?.toLowerCase() || "待確認";
      const side = c.side || rec.side || "—";
      const price = ticker ? ticker.lastPr : (c.lastPr || rec.lastPr);
      const change = ticker ? ticker.change24h : (c.change24h ?? rec.change24h);
      return ['watch:'+rec.symbol, `<div class="coin-card watch-list-card ${rec.symbol === state.symbol ? 'selected' : ''}" data-symbol="${escapeHtml(rec.symbol)}" role="button" tabindex="0">
        <div class="watch-card-main">
          <div class="watch-card-copy">
            <div class="coin-title watch-coin-title"><span class="coin-rank">#${idx+1}</span><span class="watch-symbol" title="${escapeHtml(rec.symbol)}">${escapeHtml(rec.symbol.replace(/USDT$/, ""))}</span><span class="badge badge-${side === 'SHORT' ? 'short' : 'long'}">${escapeHtml(side)}</span><span class="badge badge-${['t1','t2','t3'].includes(tier)?tier:'t3'}">${tier.toUpperCase()}</span></div>
            <div class="watch-metrics">
              <span class="watch-metric"><label>最新價格</label><strong>${fmtPrice(price)}</strong></span>
              <span class="watch-metric"><label>24H 漲跌</label><strong class="${num(change)>=0?'positive':'negative'}">${fmtPct(change)}</strong></span>
              <span class="watch-metric"><label>OX 分數</label><strong style="color:var(--gold)">${c.oxScore ?? rec.oxScore ?? '—'}</strong></span>
            </div>
          </div>
          <button class="watch-star is-starred" type="button" data-watch-symbol="${escapeHtml(rec.symbol)}" aria-pressed="true" aria-label="移除 ${escapeHtml(rec.symbol)} 收藏">${WATCH_STAR_SVG}</button>
        </div>
      </div>`];
    }));
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
  setTextIfChanged("pool-count", `${list.length} 檔${directionLabel}${!state.radarSnapshotReady&&state.isQueueRunning?` · 已分析 ${state.analyzedCache.size}/${state.scanQueue.length}`:''}`);
  syncWatchBadge();
  if (!list.length) {
    if(state.radarLoadError||state.radarScanFailed||!state.radarSnapshotReady){
      const failed=state.radarLoadError||state.radarScanFailed;
      if(!failed){
        // Skeleton cards stay mounted while only the progress note changes, so the sheen never restarts.
        const note=`已處理 ${state.scanIndex||0} / ${state.scanQueue.length||'—'} 檔`,current=container.querySelector(':scope > .ox-radar-loading .ox-state-progress');
        if(current&&radarCardCache.placeholderHost===container){if(current.textContent!==note)current.textContent=note;return;}
        resetRadarCards(container,`<div class="ox-radar-loading" role="status">${'<span class="ox-skeleton-card" aria-hidden="true"></span>'.repeat(3)}<p class="ox-state-note"><b>正在載入與分析行情</b><span class="ox-state-progress">${note}</span></p></div>`);
        return;
      }
      resetRadarCards(container,`<div class="ox-state ox-state--error" role="alert"><b>行情資料尚未取得</b><p>目前無法判斷入選標的，連線恢復後會自動重試。</p></div>`);
      if(!container.querySelector('button')){const retry=document.createElement('button');retry.type='button';retry.className='ox-state-retry';retry.textContent='重新連線';retry.onclick=()=>{state.radarScanFailed=false;state.radarSnapshotReady=false;restartRadarScan();};container.firstElementChild.append(retry);}
      return;
    }
    resetRadarCards(container, `<div class="ox-state ox-state--empty"><b>目前沒有符合 OX 經典的${directionLabel}標的</b><p>符合條件後會依${combinedRadar ? " T1 → T2 → T3 順序" : `目前 T${isTierTab ? tab.slice(1) : ""} 排名`}顯示。</p></div>`);
    return;
  }

  renderRadarCards(container, list.map((c, idx) => {
    const displayTier = tab === "surge" ? (c.tier !== "none" ? c.tier : "t3") : (c.displayTier || c.tier || "t3");
    const status = c.at&&Date.now()-c.at>300000 ? "上次結果 · 更新中" : tab === "surge" ? "SURGE" : (c.rankStatus || c.statusText || "WATCH");
    const fit = displayTier === "t1" ? c.t1Fit : displayTier === "t2" ? c.t2Fit : c.t3Fit;
    const allowStar = combinedRadar || isTierTab;
    const starred = isWatchlisted(c.symbol);
    const previousTier=idx>0?(list[idx-1].displayTier||list[idx-1].tier||'t3'):null;
    const startsTier=displayTier!==previousTier;
    // Follow real group boundaries even while a scan or custom filter has fewer results.
    const nextTier=list[idx+1] && (list[idx+1].displayTier||list[idx+1].tier||'t3');
    const endsTier=combinedRadar && nextTier && nextTier!==displayTier;
    return [tab+':'+c.symbol+':'+c.side, `<div class="coin-card ${startsTier?'is-tier-start ':''}${endsTier?'is-tier-end ':''}${c.radarFill?'is-fill ':''}${c.symbol === state.symbol ? 'selected' : ''}" data-symbol="${escapeHtml(c.symbol)}" data-tier="${displayTier}" role="button" tabindex="0"${c.radarFill?' title="補位：T2／T3 依序補滿名額，這檔沒有完全入選"':''}>
      ${startsTier?`<small class="coin-tier-heading">${displayTier.toUpperCase()}</small>`:''}
      <div class="coin-top">
        <span class="coin-title">
          <span class="coin-rank">#${idx + 1}</span>
          <span class="coin-symbol-full">${escapeHtml(c.symbol)}</span><span class="coin-symbol-mobile" title="${escapeHtml(c.symbol.replace(/USDT$/, ""))}">${escapeHtml(c.symbol.replace(/USDT$/, ""))}</span>
          <span class="badge badge-${c.side === 'SHORT' ? 'short' : 'long'}">${escapeHtml(c.side)}</span>
          <span class="badge badge-${displayTier}">${displayTier.toUpperCase()}</span>
          ${c.radarFill ? '<span class="badge badge-fill" title="T2／T3 依序補滿名額：這檔沒有完全入選，原因見下方">補位</span>' : ''}
          ${c.isSurge ? '<span class="badge badge-surge">🔥</span>' : ''}
        </span>
        <span class="coin-top-right"><span class="coin-ox" aria-label="OX 分數 ${c.oxScore}"><span class="coin-ox-label">OX</span> <strong class="coin-ox-value">${c.oxScore}</strong></span>${allowStar ? `<button class="watch-star watch-star-desktop ${starred?'is-starred':''}" type="button" data-watch-symbol="${escapeHtml(c.symbol)}" aria-pressed="${starred}" aria-label="${starred?'移除':'加入'} ${escapeHtml(c.symbol)} 收藏">${WATCH_STAR_SVG}</button>` : ''}</span>
      </div>
      <div class="coin-mid">
        <span class="meta desktop-coin-meta">${escapeHtml(status)}${c.radarSide?'':` · Fit ${fit ?? '—'}`} · 24H 量 ${fmtCryptoVolumeUSDT(c.quoteVol)}</span>
        <span class="mobile-coin-volume" title="24H 成交量 ${fmtCryptoVolumeUSDT(c.quoteVol)}" aria-label="24 小時成交量 ${fmtCryptoVolumeUSDT(c.quoteVol)}"><span class="coin-volume-label">24H 量</span><span class="coin-volume-value">${fmtCryptoVolume(c.quoteVol).replaceAll(",", "")}</span></span>
        <span class="coin-change desktop-coin-change ${c.change24h >= 0 ? 'positive' : 'negative'}" style="font-weight:700">${fmtPct(c.change24h)}</span>
      </div>
      <div class="coin-mobile-bottom">
        ${allowStar ? `<button class="watch-star watch-star-mobile ${starred?'is-starred':''}" type="button" data-watch-symbol="${escapeHtml(c.symbol)}" aria-pressed="${starred}" aria-label="${starred?'移除':'加入'} ${escapeHtml(c.symbol)} 收藏">${WATCH_STAR_SVG}</button>` : '<span></span>'}
        ${c.radarFill ? '<span class="coin-fill-mark">補位</span>' : ''}
        <span class="coin-change ${c.change24h >= 0 ? 'positive' : 'negative'}" style="font-weight:700">${fmtPct(c.change24h)}</span>
      </div>
      <div class="coin-reason"><div class="setup-head">${escapeHtml(c.setupName)}</div><div>• ${(c.reasons||[]).map(fmtSignalReason).map(escapeHtml).join('</div><div>• ')}</div></div>
      <div class="score-pills">${c.radarSide?radarElementPills(c.radarSide):`
        <span class="score-pill">流動 ${c.liqScore}</span><span class="score-pill">資金 ${c.flowScore}</span>
        <span class="score-pill">結構 ${c.structScore}</span><span class="score-pill">RS ${c.rsScore}</span>
        <span class="score-pill">Progress ${c.setupProgress ?? '—'}%</span>`}
      </div>
    </div>`];
  }));
}

if(typeof document!=='undefined')document.addEventListener('ox:timeframe-tier-change',event=>{
 if(event.detail.market!=='crypto')return;
 state.scanIndex=0;rebuildTierLists();if(state.activeMarket==='crypto'&&state.activeView==='radar')renderCurrentTab();
});

function cancelHiddenCryptoScan(){if(document.hidden||state.activeMarket!=='crypto'||!['home','radar'].includes(state.activeView))globalThis.OXPublicFeed.cancel('radar-scan');radarWake?.();}
if(typeof document!=='undefined')for(const event of ['ox:viewchange','ox:marketchange','visibilitychange'])document.addEventListener(event,cancelHiddenCryptoScan);
