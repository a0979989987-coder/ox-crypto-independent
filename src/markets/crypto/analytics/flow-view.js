import {mergeFlowHistory} from './flow-history.js';
import {REPLAY_RANGES,replayWindow,replayCoverage,replayStages} from './replay-ranges.js';
import { buildFlow, buildFlowHistory, flowPeriodSnapshot, cryptoUniverse, PERIODS, STATES, signed, compact, dateLabel } from './flow-model.js';
import { buildRotation, heatmapRows, ROTATION_STATES, TOOL_PERIODS } from './tools-model.js?v=20261001-loading1';
import { createFlowChart } from './flow-chart.js?v=20261001-loading1';
import { createToolChart } from './tools-charts.js?v=20261005-graytop5';
import { refreshFlow } from './flow-source.js';
import { revealStyledShadow, preloadToolStyles } from '../../../components/style-ready.js?v=20261005-stable18';
import { refreshMarket, refreshDailyCandles, refreshPeriodCandles, freshPeriodCandles } from './market-live.js';
import { createMarketRefreshCache } from './market-cache.js';
import { withSectorCatalog, verifiedSectorUniverse, sectorCoinLabel } from './sector-taxonomy.js';
import { replayVisualRows, createFlowReplayPlayer } from './replay-motion.js';
import { freshDaily } from './daily-cache.js';
import { candleChart } from '../patterns/charts.js';
import { ASSET_PERIODS, createAssetCandleSource } from './asset-candles.js';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={close:'<path d="m6 6 12 12M18 6 6 18"/>',back:'<path d="m10 5-7 7 7 7M3 12h18"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',reset:'<path d="M3 4v6h6M4 10a8 8 0 1 1 1 8"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',play:'<path d="M6 4 18 12 6 20Z"/>',pause:'<path d="M8 4v16M16 4v16"/>',settings:'<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',refresh:'<path d="M4 4v6h6M4 10a8 8 0 1 1 1 8"/>',plus:'<path d="M5 12h14M12 5v14"/>',minus:'<path d="M5 12h14"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||''}</svg>`;
const snapshotURL=new URL('../../../../previews/data/crypto-flow-snapshot.json',import.meta.url);
const marketURL=new URL('../../../../previews/data/crypto-tools-snapshot.json',import.meta.url);
const cssURL=new URL('./flow.css?v=20261007-readable-replay9',import.meta.url);
const replayDateFormatter=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'});
const replayDateLabel=ts=>replayDateFormatter.format(new Date(ts));
const numPrice=v=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:v<1?6:2}):'—';
const pct=v=>Number.isFinite(v)?signed(v,2)+'%':'—';
const pp=v=>Number.isFinite(v)?signed(v,2)+'pp':'—';
const color=v=>v>=0?'positive':'negative';
const time=t=>new Date(t).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false});
const TABS=[['heatmap','熱力圖'],['rotation','板塊輪動'],['flow','主動買賣']];
const FLOW_MODES=[['volume','成交量前 50'],['gain','漲幅前 50'],['net','資金異動（量前 50）'],['score','OX 評分前 50']];
// The radar owns the OX algorithm. Reuse its analyzed results; never invent a substitute score.
const radarAnalyses=()=>typeof state!=='undefined'&&state.activeMarket==='crypto'?state.analyzedCache||new Map():new Map();
let cachedMarket=null,cachedFlow=null,latestDaily=null;const latestFlows=new Map(),latestPeriods=new Map();
const marketRefresh=createMarketRefreshCache(refreshMarket,{
 keyFor:()=> 'ox-crypto-31-topics-20261007-v6',
 validate(value){
  const pool=verifiedSectorUniverse(value.instruments,value.tickers);
  if(value.scan?.complete!==true||value.scan.done!==value.scan.total||value.scan.total!==pool.symbols.length||
     pool.symbols.some(symbol=>!value.candles[symbol]||!value.tickers.some(t=>t.symbol===symbol))||
     !value.candles.BTCUSDT?.response?.data?.length)throw Error('板塊更新未完整嘗試所有可驗證合約');
 },
 isFresh:(value,now,age)=>value?.scan?.complete===true&&now-Number(value.requestTime)>=-10000&&
   now-Number(value.requestTime)<(Object.values(value.candles||{}).some(row=>row.error)?60000:age)
});
const flowTime=value=>Math.min(...Object.values(value?.flows?.[value?.period]||{}).map(e=>Number(e.response?.requestTime)||0));
const flowRefresh=createMarketRefreshCache((seed,options)=>refreshFlow(seed.period,{...options,mode:seed.mode,analyses:seed.analyses}).then(value=>({...value,period:seed.period})),{
 maxPools:4,keyFor:seed=>seed.period+':'+seed.mode,
 isFresh:(value,now,maxAge)=>value?.scan?.complete===true&&value.scan.done===value.scan.total&&now-flowTime(value)>=-10000&&now-flowTime(value)<maxAge,
 validate(value){if(!value.scan?.complete||value.scan.done!==value.scan.total||value.scan.total!==value.tickers.length)throw Error('主動成交更新未涵蓋完整觀察池');if(!buildFlow(value,value.period).rows.length)throw Error('沒有可用共同期別');}
});
const dailyRefresh=createMarketRefreshCache(refreshDailyCandles,{
 keyFor:snapshot=>'ox-crypto-daily-rotation:'+snapshot.historyDays+':'+snapshot.sectors.flatMap(s=>s.members).sort().join(','),maxPools:1,
 isFresh:freshDaily,
 validate(value){if(!value.scan?.complete||value.scan.done!==value.scan.total||!value.dailyCandles.BTCUSDT?.response?.data?.length)throw Error('日線板塊掃描不完整');}
});
const periodRefresh=createMarketRefreshCache(refreshPeriodCandles,{
 keyFor:snapshot=>snapshot.period+':'+snapshot.sectors.flatMap(s=>s.members).sort().join(','),maxPools:8,
 isFresh:freshPeriodCandles,
 validate(value){if(!value.scan?.complete||!value.candles.BTCUSDT?.response?.data?.length)throw Error('此級別資料暫時無法取得');}
});
export async function preloadFlowMarket(signal){const next=await flowRefresh.refresh({period:'1h',mode:'volume'},{signal,owner:'analytics-preload',priority:-20});latestFlows.set('1h:volume',next);}
export const preloadAnalyticsStyles=()=>preloadToolStyles(cssURL.href);
export const preloadFlowSnapshot=()=>loadCached(snapshotURL,'flow','low');
export async function preloadAnalyticsMarket(signal) {
 const snapshot=await loadCached(marketURL,'market','low');
 const next=await marketRefresh.refresh(snapshot,{signal,owner:'analytics-preload',priority:-20});
 cachedMarket=Promise.resolve(next);
}
function loadCached(url,kind,priority='high'){
 const current=kind==='market'?cachedMarket:cachedFlow;
 if(current)return current;
 const next=fetch(url,{signal:AbortSignal.timeout(12000),priority}).then(async r=>{if(!r.ok)throw Error('HTTP '+r.status);const value=await r.json();return kind==='market'?withSectorCatalog(value):value;}).catch(e=>{if(kind==='market')cachedMarket=null;else cachedFlow=null;throw e;});
 if(kind==='market')cachedMarket=next;else cachedFlow=next;
 return next;
}
export function mountCryptoFlow(host,{onExit=()=>{},snapshot=null,marketSnapshot=null,initialTab='rotation',autoRefresh=false,restore=null}={}) {
 const shadow=host.shadowRoot||host.attachShadow({mode:'open'}),life=new AbortController();
 const state={tab:TABS.some(([id])=>id===initialTab)?initialTab:'rotation',period:'1h',heatPeriod:'24h',flowMode:'volume',selected:'',filter:'',sector:'',search:'',frame:7,equal:false,trails:false,table:false,weight:matchMedia('(max-width:600px)').matches?'equal':'volume',grouped:false,focus:false,symbol:'BTCUSDT',sort:'relative',watch:false,density:'all',selectedIds:null,replayOpen:false,replaySpeed:1,replayRange:'current'};
 let market=marketSnapshot?withSectorCatalog(marketSnapshot):null,flowSnapshot=snapshot,rotation=null,plot=null,otherPlot=null,replay=null,replayButtonState=null,request=null,marketRequest=null,lastMarketAttempt=0,lastPressureAttempt=0,marketTimer=null;
 let partialMarket=null,partialFlow=null,dailyMarket=latestDaily,dailyRequest=null,periodRequest=null;
 const nativePeriods=new Map(latestPeriods),lastPeriodAttempts=new Map();let nativeCombined=null,nativeCombinedMarket=null,nativeCombinedData=null;
 let historyArchive=null,historyPending=false,historySource=null,historyCombined=null;
 let suspended=false,viewport=restore?.viewport||null,modelSource=null,modelPeriod=null,flowHistory=null,domain=null,paintedFrame=null,dailyCombined=null,dailyCombinedMarket=null,dailyCombinedData=null,lastDailyAttempt=0;
 let layoutKey='',layoutRaf=0,stageKey='',derivedPressureSource=null,derivedPressurePeriod='',derivedPressure=null;
 const periodProgress=new Map();
 if(restore?.state)Object.assign(state,restore.state,{tab:initialTab,focus:false});
 const pressureSnapshots=new Map(),assetCandles=createAssetCandleSource();
 let assetChart=null,assetRequest=null,assetSession=null,assetTimer=null,assetQuotes=null,assetVersion=0;
 async function refreshCurrentMarket(){if(!autoRefresh||!market||marketRequest||suspended||document.hidden)return;
  if(Date.now()-Number(market.requestTime)<5*60000)return;
  marketRequest=new AbortController();let updated=false;lastMarketAttempt=Date.now();notice('正在更新 Bitget 觀察池…');
  const loading=window.OXLoading?.begin('crypto','更新熱力圖與板塊',{signal:marketRequest.signal,total:market.tickers.length,done:0,views:['strength'],target:q('[data-slot="loading"]')});
  try{const next=await marketRefresh.refresh(market,{signal:marketRequest.signal,onPartial:next=>{if(life.signal.aborted||suspended||marketRequest?.signal.aborted)return;partialMarket=next;if(next.scan.done===1||next.scan.done%5===0)render();},onProgress:(n,total)=>{loading?.update(n,total);if(n===total||n%5===0)notice('更新市場資料…');}});
   if(!life.signal.aborted&&!suspended){market=next;partialMarket=null;cachedMarket=Promise.resolve(next);updated=true;}
  }catch(e){if(e.name!=='AbortError'&&!life.signal.aborted){partialMarket=null;render();notice(`即時更新失敗：${e.message}；目前顯示有時間戳的快照。`);};}
  finally{const cancelled=marketRequest?.signal.aborted;marketRequest=null;loading?.finish();if(updated&&!suspended&&!life.signal.aborted)render();if(cancelled&&!suspended&&!document.hidden&&!life.signal.aborted)queueMicrotask(maybeRefreshMarket);}
 }
 async function refreshNativePeriod(){
  if(!market||periodRequest||suspended||document.hidden||state.period==='1d')return;
  const period=state.period,controller=periodRequest=new AbortController(),signal=controller.signal;let updated=false;
  lastPeriodAttempts.set(period,Date.now());
  try{
   const next=await periodRefresh.refresh({...market,period},{signal,owner:'analytics-period',priority:70,onPartial:part=>{
    if(signal.aborted||life.signal.aborted||suspended||state.period!==period)return;
    // Stage a whole cohort before publishing it. Recomputing sector averages
    // after each coin response moves existing bubbles and rescales the axes.
    periodProgress.set(period,part.scan);loadingProgress(period,part.scan);if(part.scan.done===1)render();
   }});
   if(signal.aborted||life.signal.aborted)return;nativePeriods.set(period,next);latestPeriods.set(period,next);updated=true;
  }catch(e){if(e.name!=='AbortError'&&!life.signal.aborted){lastPeriodAttempts.set(period,Date.now()-280000);notice('此級別正在重新連線，已取得的資料會保留。');}}
  finally{if(periodRequest===controller)periodRequest=null;if(updated&&!suspended&&!life.signal.aborted)render();if(signal.aborted){lastPeriodAttempts.delete(period);if(!suspended&&!document.hidden&&!life.signal.aborted)queueMicrotask(maybeRefreshMarket);}}
 }
 async function refreshDaily(){if(!market||dailyRequest||suspended||document.hidden)return;
  lastDailyAttempt=Date.now();dailyRequest=new AbortController();const signal=dailyRequest.signal;let updated=false;
  try{const next=await dailyRefresh.refresh({...market,historyDays:replayWindow(state.replayRange).days},{signal,owner:'analytics-daily',priority:70,onPartial:part=>{
   if(signal.aborted||life.signal.aborted||suspended||state.period!=='1d')return;
   // A daily cohort is committed together, including its BTC benchmark.
   periodProgress.set('1d',part.scan);loadingProgress('1d',part.scan);if(part.scan.done===1)render();
  }});
   if(signal.aborted||life.signal.aborted)return;latestDaily=dailyMarket=next;updated=true;
  }catch(e){if(e.name!=='AbortError'&&!life.signal.aborted)notice('日線下載失敗；保留已取得的資料，可切換週期後再試。');}
  finally{if(signal.aborted)lastDailyAttempt=0;dailyRequest=null;if(updated&&!suspended&&!life.signal.aborted)render();if(signal.aborted&&!suspended&&!document.hidden&&!life.signal.aborted)queueMicrotask(maybeRefreshMarket);}
 }
 const maybeRefreshMarket=()=>{if(suspended||document.hidden)return;
  if(state.tab==='rotation'&&state.period==='1d'&&Date.now()-lastDailyAttempt>20000&&(!dailyMarket?.scan?.complete||dailyMarket.historyDays<replayWindow(state.replayRange).days||Date.now()>=Math.floor(Date.parse(dailyMarket.captureCompletedAt)/86400000)*86400000+86400000+120000))void refreshDaily();
  if(!autoRefresh)return;
  if(state.tab==='rotation'&&state.period!=='1d'&&(!['15m','1h'].includes(state.period)||!frames().some(f=>f.rows.length))&&Date.now()-(lastPeriodAttempts.get(state.period)||0)>(Object.values(nativePeriods.get(state.period)?.candles||{}).some(e=>e.error)?20000:300000))void refreshNativePeriod();
  if(['heatmap','rotation'].includes(state.tab)&&Date.now()-lastMarketAttempt>5*60000)void refreshCurrentMarket();
  if(state.tab==='flow'&&Date.now()-lastPressureAttempt>5*60000&&Date.now()-pressureTime()>5*60000)void refreshPressure();};
 const pressureKey=()=>state.period+':'+state.flowMode;
 // Partials report loading progress; only complete batches become observations.
 const pressureSnapshot=()=>{
  const source=pressureSnapshots.get(pressureKey())||latestFlows.get(pressureKey())||(state.flowMode==='volume'?flowSnapshot:null);
  if(source!==derivedPressureSource||state.period!==derivedPressurePeriod){derivedPressureSource=source;derivedPressurePeriod=state.period;derivedPressure=flowPeriodSnapshot(source,state.period);}
  return derivedPressure;
 };
 const pressureTime=()=>{const entries=Object.values(pressureSnapshot()?.flows?.[state.period]||{});return entries.length?Math.min(...entries.map(e=>Number(e.response?.requestTime)||0)):0;};
 const watchKey='ox-crypto-sector-watch:'+encodeURIComponent(window.OXAuth?.user?.id||'guest');
 const watched=new Set();try{for(const s of JSON.parse(localStorage.getItem(watchKey)||'[]'))watched.add(s);}catch{}
 shadow.innerHTML=`<link rel="stylesheet" data-ox-href="${cssURL.href}"><main class="cfx"><header class="cfx-top"><button class="cfx-icon cfx-back" data-action="exit" aria-label="返回指標">${icon('back')}</button><span class="cfx-brand">OX<span>CRYPTO</span></span><span class="cfx-source-badge">BITGET · USDT 永續</span><div class="cfx-top-actions"><button class="cfx-icon" data-action="help" aria-label="資料與計算說明">${icon('info')}</button><button class="cfx-exit" data-action="fullscreen">${icon('expand')}<span data-slot="exit-label">全螢幕</span></button></div></header><nav class="cfx-tabs" aria-label="Crypto 工具">${TABS.map(([id,label])=>`<button data-tab="${id}" aria-pressed="${id===state.tab}">${label}</button>`).join('')}</nav><section class="cfx-content" aria-label="工具內容"></section><footer class="cfx-status" role="status"><span data-slot="loading" hidden></span><span data-slot="source">讀取來源資料…</span><span data-slot="period"></span></footer><div class="cfx-notice" role="status" hidden></div><dialog class="cfx-dialog" aria-label="資料與計算說明"><div class="cfx-dialog-head"><span>資料與計算</span><button class="cfx-close" data-action="close-help" aria-label="關閉說明">${icon('close')}</button></div><div data-slot="help"></div></dialog><dialog class="cfx-settings-dialog cfx-dialog" aria-label="圖表設定"><div class="cfx-dialog-head"><span>圖表設定</span><button class="cfx-close" data-action="close-settings" aria-label="關閉圖表設定">${icon('close')}</button></div><div data-slot="settings"></div></dialog><dialog class="cfx-picker-dialog cfx-dialog" aria-label="選擇觀察項目"><div class="cfx-dialog-head"><span>選擇觀察項目</span><button class="cfx-close" data-action="close-picker" aria-label="關閉選擇">${icon('close')}</button></div><div data-slot="picker"></div></dialog><dialog class="cfx-sector-dialog cfx-dialog" aria-label="板塊詳情"><div class="cfx-dialog-head"><span data-slot="sector-title"></span><div class="cfx-row"><button class="cfx-watch" data-slot="sector-watch"></button><button class="cfx-close" data-action="close-sector" aria-label="關閉板塊詳情">${icon('close')}</button></div></div><div data-slot="sector"></div></dialog><dialog class="cfx-asset-dialog" aria-label="標的詳情"><div class="cfx-dialog-head"><span data-slot="asset-title"></span><button class="cfx-close" data-action="close-asset" aria-label="關閉標的詳情">${icon('close')}</button></div><div data-slot="asset"></div></dialog></main>`;
 revealStyledShadow(shadow,life.signal);
 const q=s=>shadow.querySelector(s),qa=s=>[...shadow.querySelectorAll(s)];
 const notice=text=>{q('.cfx-notice').textContent=text;q('.cfx-notice').hidden=!text;};
 function loadingProgress(period,scan){
  const message='正在載入 '+period.toUpperCase()+' 資料… '+scan.done+'/'+scan.total;
  notice(message);const loading=q('.cfx-plot-loading');if(loading&&!loading.hidden)loading.textContent=message;
 }
 function fitResearchLayout(force=false){
  const panel=q('.cfx-research-panel');if(!panel)return;
  const height=window.visualViewport?.height||window.innerHeight;
  const key=[window.innerWidth,Math.round(height),state.replayOpen,state.table,state.focus,state.tab,state.period,frames().some(f=>f.rows.length)].join(':');
  if(!force&&key===layoutKey)return;layoutKey=key;cancelAnimationFrame(layoutRaf);
  layoutRaf=requestAnimationFrame(()=>{
   if(life.signal.aborted||suspended)return;
   if(!state.replayOpen){panel.style.removeProperty('--cfx-plot-height');return;}
   const chart=q('.cfx-plot'),table=q('.cfx-rotation-table'),replayBar=q('.cfx-replay');
   const top=Math.max(0,(state.table?table:chart).getBoundingClientRect().top);
   const dock=state.focus?null:document.querySelector('.app-dock'),dockRect=dock?.getBoundingClientRect();
   const bottom=dockRect?.height&&dockRect.top>top?Math.min(height,dockRect.top):height-12;
   const symbols=state.tab==='flow'?q('.cfx-flow-symbols')?.getBoundingClientRect().height||0:0;
   const available=bottom-top-replayBar.getBoundingClientRect().height-symbols-12;
   panel.style.setProperty('--cfx-plot-height',Math.round(Math.max(220,Math.min(620,available)))+'px');
  });
 }
 window.addEventListener('resize',()=>fitResearchLayout(true),{signal:life.signal});
 window.visualViewport?.addEventListener('resize',()=>fitResearchLayout(true),{signal:life.signal});
 function showDialog(selector){const dialog=q(selector),head=dialog.querySelector('.cfx-dialog-head');head.tabIndex=-1;head.setAttribute('autofocus','');dialog.showModal();head.focus({preventScroll:true});}
 function cleanup(){closeAsset();q('.cfx-sector-dialog').close();viewport=otherPlot?.getViewport?.()||plot?.getViewport?.()||viewport;plot?.destroy();otherPlot?.destroy();plot=otherPlot=null;stopReplay();}
 function replayButton(playing){if(replayButtonState===playing)return;replayButtonState=playing;const b=q('[data-action="play"]');if(b){b.innerHTML=icon(playing?'pause':'play');b.setAttribute('aria-label',(playing?'暫停':'播放')+(state.tab==='flow'?'主動買賣':'輪動')+'回放');}}
 function stopReplay(){const player=replay;replay=null;player?.destroy();replayButton(false);}
 function startReplay(){if(frames().length<2||!frames().some(f=>f.rows.length))return;if(!replay)replay=createFlowReplayPlayer({length:frames().length,position:state.frame,speed:state.replaySpeed,
  isActive:()=>!suspended&&!document.hidden&&!life.signal.aborted,
  render:position=>{state.frame=position;paintRotation();},onState:({playing})=>replayButton(playing)});
  replay.play();}
 function toolbar(period, heat = false, refresh = false) {
  return `<div class="cfx-toolbar cfx-toolbar-compact"><select class="cfx-period-select" data-control="period" aria-label="時間級別">${Object.keys(TOOL_PERIODS).filter(t=>t!=='1d'&&(heat||t!=='24h')).map(t=>`<option value="${t}" ${period===t?'selected':''}>${t.toUpperCase()}</option>`).join('')}</select>${search()}<button class="cfx-icon" data-action="settings" aria-label="圖表設定" title="圖表設定">${icon('settings')}</button><button class="cfx-icon" data-action="fullscreen" aria-label="全螢幕" title="全螢幕">${icon('expand')}</button>${refresh?`<button class="cfx-icon" data-action="refresh-flow" aria-label="更新資料" title="更新資料">${icon('refresh')}</button>`:''}</div>`;
 }
 function renderSettings() {
  const body=q('[data-slot="settings"]');
  const toggle=(action,text,pressed)=>`<button data-action="${action}" aria-pressed="${pressed}">${text}</button>`;
  let options='';
  if(['rotation','flow'].includes(state.tab))options=toggle('watch-only','只看自選',state.watch)+toggle('toggle-table','顯示列表',state.table)+toggle('trails','顯示軌跡',state.trails)+toggle('equal-size','泡泡等大',state.equal);
  if(state.tab==='heatmap')options=`<label>面積<select data-control="weight" aria-label="熱力圖面積">${[['volume','本期成交額'],['cap','市值'],['equal','等大']].map(([id,text])=>`<option value="${id}" ${state.weight===id?'selected':''}>${text}</option>`).join('')}</select></label>${toggle('group','依板塊排列',state.grouped)}<label>板塊<select data-control="heat-sector" aria-label="熱力圖板塊"><option value="">全部</option>${(market?.sectors||[]).map(row=>`<option value="${row.id}" ${state.sector===row.id?'selected':''}>${row.name}</option>`).join('')}</select></label>`;
  body.innerHTML=`<div class="cfx-settings-options cfx-controls">${options}<button data-action="help">資料與計算說明</button></div>`;
 }

 const search=()=>`<label class="cfx-search">${icon('search')}<input aria-label="搜尋板塊或幣種" placeholder="搜尋" value="${escape(state.search)}"></label>`;
 const empty=text=>`<div class="cfx-empty">${text}</div>`;
 function status(text,stamp){q('[data-slot="source"]').textContent=text;q('[data-slot="period"]').textContent=stamp?dateLabel(stamp)+' UTC+8':'';}
 function chartButton(symbol){return `<button class="cfx-open-chart" data-open-chart="${escape(symbol)}" aria-label="開啟 ${escape(symbol.replace(/USDT$/,''))} K 線圖">查看 K 線圖 ↗</button>`;}
 function closeAsset(){assetQuotes?.stop();assetQuotes=null;assetVersion++;assetRequest?.abort();assetRequest=null;clearInterval(assetTimer);assetTimer=null;assetChart?.destroy();assetChart=null;assetSession=null;q('.cfx-asset-dialog').close();}
 function openChart(symbol){if(!/^[A-Z0-9]+USDT$/.test(symbol))return;closeAsset();q('.cfx-sector-dialog').close();window.switchSymbol?.(symbol);}
 function assetChartMarkup(){return `<section class="cfx-asset-chart"><div class="cfx-asset-chart-head"><label>K 線 <select data-control="asset-period" aria-label="幣種詳情 K 線級別">${Object.keys(ASSET_PERIODS).map(p=>`<option value="${p}" ${assetSession.period===p?'selected':''}>${p.toUpperCase()}</option>`).join('')}</select></label><button class="cfx-icon" data-action="asset-reset" aria-label="重設詳情 K 線">${icon('reset')}</button></div><canvas role="img" aria-label="${escape(assetSession.symbol)} 實際 K 線，可拖曳及雙指縮放" hidden></canvas><div class="cfx-asset-chart-status" role="status">正在取得 K 線…</div><button class="cfx-button" data-action="retry-asset" hidden>重新讀取 K 線</button></section>`;}
 function presentAsset(symbol,information){
  if(!/^[A-Z0-9]+USDT$/.test(symbol))return;
  stopReplay();closeAsset();assetSession={symbol,period:ASSET_PERIODS[state.period]?state.period:'1h'};
  const base=symbol.replace(/USDT$/,''),ticker=[...(market?.tickers||[]),...(pressureSnapshot()?.tickers||[])].find(t=>t.symbol===symbol);
  q('[data-slot="asset-title"]').innerHTML=`<button class="cfx-asset-name" data-open-chart="${escape(symbol)}" aria-label="${escape(base)} 直接開啟圖表">${escape(base)} ↗</button>`;
  q('[data-slot="asset"]').innerHTML=`<div class="cfx-reading"><span>價格 · USDT</span><strong data-slot="asset-price">${numPrice(Number(ticker?.lastPr))}</strong></div>${assetChartMarkup()}${information}${chartButton(symbol)}`;
  q('.cfx-asset-dialog').dataset.symbol=symbol;showDialog('.cfx-asset-dialog');assetQuotes=globalThis.OXCryptoQuotes?.subscribe([symbol],quotes=>{const quote=quotes.find(q=>q.symbol===symbol);if(quote&&assetSession?.symbol===symbol&&!suspended&&!document.hidden)q('[data-slot="asset-price"]').textContent=numPrice(quote.lastPr);});void updateAssetChart();
  assetTimer=setInterval(()=>{if(!suspended&&!document.hidden&&assetSession&&!assetRequest)void updateAssetChart(true);},15000);
 }
 async function updateAssetChart(background=false){
  if(!assetSession||suspended||document.hidden)return;
  assetRequest?.abort();const controller=assetRequest=new AbortController(),version=++assetVersion,{symbol,period}=assetSession;
  const area=q('.cfx-asset-chart'),canvas=area.querySelector('canvas'),stamp=area.querySelector('[role="status"]'),retry=area.querySelector('[data-action="retry-asset"]');
  if(!background)stamp.textContent='正在取得 K 線…';retry.hidden=true;
  try{
   const data=await assetCandles.load(symbol,period,controller.signal);
   if(controller.signal.aborted||version!==assetVersion||!q('.cfx-asset-dialog').open)return;
   assetSession.serverTime=data.serverTime;const liveQuote=globalThis.OXCryptoQuotes?.get(symbol);q('[data-slot="asset-price"]').textContent=numPrice(liveQuote?.lastPr??data.candles.at(-1).close);
   canvas.hidden=false;canvas.dataset.symbol=symbol;canvas.dataset.period=period;canvas.dataset.candles=String(data.candles.length);if(assetChart)assetChart.update(data);else assetChart=candleChart(canvas,data,{interactive:true});
   if(!assetTimer)assetTimer=setInterval(()=>{if(!suspended&&!document.hidden&&assetSession&&!assetRequest)void updateAssetChart(true);},15000);
   stamp.textContent=`Bitget · ${period.toUpperCase()} · 更新 ${dateLabel(data.serverTime)} UTC+8 · 末根 K 線可能未收盤`;
  }catch(error){if(controller.signal.aborted||version!==assetVersion)return;clearInterval(assetTimer);assetTimer=null;stamp.textContent=`K 線讀取失敗：${error.message}${assetChart?'；保留 '+dateLabel(assetSession.serverTime)+' UTC+8 的圖表':''}`;retry.hidden=false;}
  finally{if(assetRequest===controller)assetRequest=null;}
 }
 function openAsset(symbol){const r=heatmapRows(market,state.heatPeriod).find(x=>x.symbol===symbol);presentAsset(symbol,`<dl class="cfx-detail-metrics"><div><dt>${state.heatPeriod.toUpperCase()} 漲跌</dt><dd>${pct(r?.returnPct)}</dd></div><div><dt>本期成交額</dt><dd>${compact(r?.volume)} USDT</dd></div></dl>`);}
 function openMember(symbol){if(state.tab==='flow'){state.selected=symbol;showFlowDetail(symbol);paintRotation();return;}const member=sourceFrame()?.rows.find(r=>r.id===state.selected)?.members.find(m=>m.symbol===symbol);if(!member)return;presentAsset(symbol,`<dl class="cfx-detail-metrics"><div><dt>${state.period.toUpperCase()} 漲跌</dt><dd>${pct(member.returnPct)}</dd></div><div><dt>相對 BTC</dt><dd>${pp(member.relative)}</dd></div><div><dt>本期成交額</dt><dd>${compact(member.volume)} USDT</dd></div></dl><div class="cfx-data-note">板塊數值期別：${dateLabel(sourceFrame().ts)} UTC+8；上方 K 線獨立顯示目前選取級別。</div>`);}
 function openSector(id){
  stopReplay();state.selected=id;paintRotation();const row=sourceFrame()?.rows.find(r=>r.id===id);if(!row)return;
  q('[data-slot="sector-title"]').textContent=row.name;const watch=q('[data-slot="sector-watch"]');watch.dataset.watch=id;watch.setAttribute('aria-label',`${watched.has(id)?'取消':'加入'} ${row.name} 自選`);watch.setAttribute('aria-pressed',String(watched.has(id)));watch.textContent=watched.has(id)?'★':'☆';
  q('[data-slot="sector"]').innerHTML=sectorMarkup(row);q('.cfx-sector-dialog').dataset.sector=id;showDialog('.cfx-sector-dialog');
 }
 function frames(){return state.tab==='flow'?flowHistory?.frames||[]:rotation?.frames||[];}
 function sourceFrame(){const list=frames();return list[Math.max(0,Math.min(list.length-1,Math.floor(state.frame)))];}
 function visibleRotation(){const frame=sourceFrame();if(!frame)return null;
  let rows=frame.rows.filter(r=>(!state.search||r.base.toUpperCase().includes(state.search)||r.members?.some(m=>m.base.includes(state.search)))&&(!state.watch||watched.has(r.symbol))&&(state.selectedIds===null||state.selectedIds.includes(r.symbol)));
  if(state.density==='top'){const latest=frames().at(-1)?.rows||[];const allowed=new Set([...latest].sort((a,b)=>b.turnover-a.turnover).slice(0,10).map(r=>r.symbol));rows=rows.filter(r=>allowed.has(r.symbol));}
  return {...frame,rows};
 }
 const defs=()=>state.tab==='flow'?STATES:ROTATION_STATES;
 function timeSelection(){return state.replayRange==='current'?state.period:'range:'+state.replayRange;}
 function timeOptions(){const periods=state.tab==='flow'?Object.keys(PERIODS):Object.keys(TOOL_PERIODS).filter(p=>p!=='24h');return `<optgroup label="時間級別">${periods.map(period=>`<option value="${period}" ${timeSelection()===period?'selected':''}>${period.toUpperCase()}</option>`).join('')}</optgroup><optgroup label="回放範圍">${REPLAY_RANGES.filter(([id])=>id!=='current').map(([id,label])=>`<option value="range:${id}" ${state.replayRange===id?'selected':''}>${label}</option>`).join('')}</optgroup>`;}
 function researchToolbar(){return `<div class="cfx-research-toolbar"><div class="cfx-segment"><button data-action="scope-all" aria-pressed="${!state.watch}">${state.tab==='flow'?'幣種':'板塊'}</button><button data-action="scope-watch" aria-pressed="${state.watch}">自選</button></div><div class="cfx-segment"><button data-action="view-bubbles" aria-pressed="${!state.table}">泡泡圖</button><button data-action="view-rank" aria-pressed="${state.table}">排行</button></div><button class="cfx-picker" data-action="picker">已選 <span data-slot="selected-count"></span> ▾</button><select class="cfx-period-select" data-control="period" aria-label="時間級別">${timeOptions()}</select><button class="cfx-replay-toggle" data-action="replay-toggle" aria-pressed="${state.replayOpen}">${state.replayOpen?'結束':'回放'}</button></div>${state.tab==='flow'?`<label class="cfx-flow-mode">觀察模式 <select data-control="flow-mode" aria-label="主動買賣觀察模式">${FLOW_MODES.map(([id,name])=>`<option value="${id}" ${state.flowMode===id?'selected':''}>${name}</option>`).join('')}</select></label>`:''}`;}
 function mountResearch(){
  if(q('.cfx-content').dataset.mode===state.tab&&q('.cfx-research-panel'))return;
  cleanup();q('.cfx-content').dataset.mode=state.tab;
  q('.cfx-content').innerHTML=`<section class="cfx-research-panel">${researchToolbar()}<div class="cfx-plot"><canvas role="img" aria-label="${state.tab==='flow'?'Crypto 主動買賣泡泡圖':'加密板塊相對 BTC 輪動圖'}，可雙指縮放與拖曳"></canvas><div class="cfx-plot-loading" role="status" hidden></div></div><div class="cfx-rotation-table" hidden></div>${state.tab==='flow'?'<div class="cfx-flow-symbols" aria-label="主動買賣圖上幣種"></div>':''}<div class="cfx-replay" hidden><div data-slot="replay-stage"></div><input type="range" aria-label="${state.tab==='flow'?'主動買賣':'輪動'}歷史期別" data-control="frame" min="0" max="0" step="0.01" value="0"><div class="cfx-replay-controls"><button data-action="frame-prev" aria-label="前一期">‹</button><button class="cfx-icon" data-action="play" aria-label="${state.tab==='flow'?'播放主動買賣回放':'播放輪動回放'}">${icon('play')}</button><button data-action="frame-next" aria-label="後一期">›</button><select data-control="replay-speed" aria-label="回放速度">${[.5,1,2].map(n=>`<option value="${n}" ${state.replaySpeed===n?'selected':''}>${n}×</option>`).join('')}</select><button data-action="latest">最新</button></div><span data-slot="replay-coverage"></span></div><div class="cfx-bottom-actions"><div class="cfx-segment"><button data-action="density-all" aria-pressed="${state.density==='all'}">全部</button><button data-action="density-top" aria-pressed="${state.density==='top'}">成交前 10</button></div><div class="cfx-bottom-tools"><button data-action="zoom-out" aria-label="縮小">${icon('minus')}</button><button data-action="reset" aria-label="重設圖表"><span data-slot="zoom">100%</span></button><button data-action="zoom-in" aria-label="放大">${icon('plus')}</button><button data-action="fullscreen" aria-label="全螢幕">${icon('expand')}</button><button data-action="settings" aria-label="圖表設定">${icon('settings')}</button><button data-action="help" aria-label="資料與計算說明">${icon('info')}</button>${state.tab==='flow'?`<button data-action="refresh-flow" aria-label="更新資料">${icon('refresh')}</button>`:''}</div></div></section><div class="cfx-states">${defs().map(def=>`<button data-state="${def.id}" aria-pressed="false"></button>`).join('')}</div><div class="cfx-research-search">${search()}<span data-slot="research-hint">點泡泡查看詳情</span></div>`;
  plot=createFlowChart(q('canvas'),{signal:life.signal,onZoom:zoom=>{const label=q('[data-slot="zoom"]');if(label)label.textContent=Math.round(zoom*100)+'%';},onSelect:id=>{state.selected=id;if(state.tab==='flow'){stopReplay();showFlowDetail(id);paintRotation();}else openSector(id);}});
  plot.setInteractive(true);if(viewport)plot.restoreViewport(viewport);
  paintedFrame=null;replayButtonState=null;layoutKey=stageKey='';
 }
 function pickerItems(){const pool=state.tab==='flow'&&partialFlow?.mode===state.flowMode?partialFlow:pressureSnapshot();return state.tab==='flow'?cryptoUniverse(pool?.instruments||[],pool?.tickers||[],50,state.flowMode,radarAnalyses()).map(r=>({symbol:r.symbol,base:r.baseCoin,change24h:Number(r.change24h)*100,volume:Number(r.usdtVolume),score:radarAnalyses().get(r.symbol)?.oxScore})):(market?.sectors||[]).map(r=>({symbol:r.id,base:r.name,members:r.members,topics:(r.topics||[]).filter(t=>t.members.length),requested:r.members.map(sectorCoinLabel),expected:r.requestedBases?.length||r.members.length}));}
 function renderPicker(){
  const items=pickerItems(), selected=items.filter(r=>state.selectedIds===null||state.selectedIds.includes(r.symbol)).length;
  const header=`<p class="cfx-data-note">${state.tab==='flow'?'依目前觀察模式選出的有效 Bitget 合約；更換模式會重新取得對應資料。':'Bitget · USDT 永續觀察池；幣種可跨板塊與題材。'}</p><label class="cfx-search"><input data-control="picker-search" aria-label="搜尋觀察項目" placeholder="搜尋板塊、題材或幣種"></label><div class="cfx-picker-actions"><span data-slot="picker-count">已選 ${selected}/${items.length}</span><button data-action="select-all">全部</button><button data-action="select-none">清除選取</button></div>`;
  q('[data-slot="picker"]').innerHTML=header+`<div class="cfx-picker-list">${items.map(r=>{
   const item=`<label><input type="checkbox" data-item="${escape(r.symbol)}" ${state.selectedIds===null||state.selectedIds.includes(r.symbol)?'checked':''}><span>${escape(r.base)}</span><small>${r.members?'':state.flowMode==='score'?`OX ${Number.isFinite(r.score)?r.score:'—'}`:state.flowMode==='volume'||state.flowMode==='net'?`${compact(r.volume)} USDT`:pct(r.change24h)}</small></label>`;
   if(!r.members)return `<div data-picker-row="${escape(r.base.toUpperCase())}">${item}</div>`;
   return `<div class="cfx-picker-group" data-picker-row="${escape((r.base+' '+r.topics.map(t=>t.name).join(' ')+' '+r.requested.join(' ')).toUpperCase())}">${item}<details data-topic-group="${escape(r.symbol)}"><summary>二級題材 ${r.topics.length} 類 · 查看成分</summary><div class="cfx-topic-list" data-topic-list></div></details></div>`;
  }).join('')}</div>`;
 }
 function renderTopics(groupId,container){const group=pickerItems().find(r=>r.symbol===groupId);if(!group?.topics||container.dataset.ready)return;
  container.dataset.ready='true';container.innerHTML=group.topics.filter(topic=>topic.members.length).map(topic=>
   `<div class="cfx-topic"><b>${escape(topic.name)}</b><div>${topic.members.map(symbol=>`<span>${escape(sectorCoinLabel(symbol))}</span>`).join('、')}</div></div>`
  ).join('');
 }
 shadow.addEventListener('toggle',e=>{if(e.target.open&&e.target.dataset.topicGroup)renderTopics(e.target.dataset.topicGroup,e.target.querySelector('[data-topic-list]'));}, {capture:true,signal:life.signal});
 function rankMarkup(frame){const rows=[...(frame?.rows||[])].filter(r=>!state.filter||r.state.id===state.filter).sort((a,b)=>state.sort==='share'?(b.shareChange??-Infinity)-(a.shareChange??-Infinity):state.sort==='momentum'?b.y-a.y:b.x-a.x);return `<div class="cfx-side-head"><span>板塊排名</span><select aria-label="板塊排名方式" data-control="sort"><option value="relative" ${state.sort==='relative'?'selected':''}>相對 BTC</option><option value="momentum" ${state.sort==='momentum'?'selected':''}>動能變化</option><option value="share" ${state.sort==='share'?'selected':''}>成交占比變化</option></select></div><div class="cfx-rank-head"><span>板塊</span><span>相對 BTC</span><span>${state.sort==='share'?'占比變化':'動能變化'}</span></div>${rows.map((r,i)=>`<button class="cfx-rank-row" data-sector="${r.id}"><span><i style="background:${r.state.color}"></i>${r.name}<small>${r.state.name} · ${r.members.length} 幣</small></span><span class="${color(r.x)}">${pp(r.x)}</span><span class="${color(state.sort==='share'?r.shareChange:r.y)}">${pp(state.sort==='share'?r.shareChange:r.y)}</span></button>`).join('')}${!rows.length?empty('沒有符合篩選的板塊'):''}`;}
 function sectorMarkup(row){const trail=rotation.frames.slice(Math.max(0,state.frame-5),state.frame+1).map(f=>({ts:f.ts,row:f.rows.find(r=>r.id===row.id)})).filter(t=>t.row);return `<div class="cfx-selected-state" style="color:${row.state.color}">${row.state.name}<span>${row.members.length} 個成分幣</span></div><dl class="cfx-detail-metrics"><div><dt>相對 BTC</dt><dd>${pp(row.x)}</dd></div><div><dt>動能變化</dt><dd>${pp(row.y)}</dd></div><div><dt>成交占比</dt><dd>${row.share?.toFixed(1)||'—'}% <small>${pp(row.shareChange)}</small></dd></div><div><dt>領先 BTC</dt><dd>${row.members.filter(m=>m.relative>0).length} / ${row.members.length} 幣</dd></div></dl><div class="cfx-trail-history">${trail.map(t=>`<button data-frame-time="${t.ts}" title="${dateLabel(t.ts)} ${t.row.state.name}"><i style="background:${t.row.state.color}"></i><span>${time(t.ts)}</span><small>${t.row.state.name}</small></button>`).join('')}</div><div class="cfx-member-title"><span>成分幣</span><span>${state.period.toUpperCase()} · 依相對強弱</span></div><p class="cfx-member-hint">點數值列查看幣種詳情；點幣種名稱直接進圖表。</p><div class="cfx-sector-members"><table class="cfx-table compact"><thead><tr><th>幣種</th><th>漲跌</th><th>相對 BTC</th><th>成交額</th></tr></thead><tbody>${[...row.members].sort((a,b)=>b.relative-a.relative).map(m=>`<tr data-member-detail="${escape(m.symbol)}" tabindex="0" aria-label="查看 ${escape(m.base)} 幣種詳情"><td><button data-open-chart="${escape(m.symbol)}" aria-label="${escape(m.base)} 查看 K 線圖">${escape(m.base)} ↗</button></td><td class="${color(m.returnPct)}">${pct(m.returnPct)}</td><td>${pp(m.relative)}</td><td>${compact(m.volume)}</td></tr>`).join('')}</tbody></table></div><div class="cfx-data-note">期別 ${dateLabel(sourceFrame().ts)} UTC+8 · 等權觀察池 · 本期 ${compact(row.turnover)} USDT</div>`;}
 function paintRotation(){
  const frame=visibleRotation();if(!frame||!q('.cfx-research-panel'))return;
  q('canvas').dataset.period=state.period;q('canvas').dataset.points=String(frame.rows.length);
  const list=frames(),index=Math.floor(state.frame),fraction=state.frame-index;
  const interpolated=replayVisualRows(list,state.frame,frame.rows);
  const trails=state.trails?frame.rows.map(r=>({symbol:r.symbol,color:r.state.color,points:[...list.slice(Math.max(0,index-5),index+1).flatMap(f=>{const p=f.rows.find(x=>x.symbol===r.symbol);return p?[{x:p.x,y:p.y}]:[]}),...(fraction>.001?interpolated.filter(p=>p.symbol===r.symbol).map(p=>({x:p.x,y:p.y})):[])]})):[];
  plot?.update(interpolated,{selected:state.selected,filter:state.filter,rotation:state.tab==='rotation',equalSize:state.equal,domain,trails,axisX:state.tab==='rotation'?'相對 BTC 報酬（pp）':'主動買賣占比（%）',axisY:state.tab==='rotation'?'相對表現變化（pp）':'占比變化（百分點）',quadrants:state.tab==='rotation'?['落後改善','領先擴大','落後擴大','領先降溫']:null});
  const coverage=replayCoverage(list,state.replayRange,list.at(-1)?.ts||Date.now());q('[data-slot="replay-coverage"]').textContent=list.length?`可回放 ${replayDateLabel(list[0].ts)}～${replayDateLabel(list.at(-1).ts)} · ${list.length} 期${state.period==='1d'&&!coverage.complete?' · 此範圍歷史資料未齊':''}`:'尚無可回放資料';
  const nextStageKey=state.period+':'+index+':'+list[0]?.ts+':'+list.length;
  if(nextStageKey!==stageKey){stageKey=nextStageKey;
   q('[data-slot="replay-stage"]').innerHTML=`<span class="cfx-stage-caption">目前第 ${index+1}/${list.length} 期 · UTC+8</span><div class="cfx-stage-times">${replayStages(list,state.frame,state.period).map(stage=>`<time datetime="${new Date(stage.ts).toISOString()}" ${stage.current?'aria-current="step"':''}>${stage.label}</time>`).join('<span aria-hidden="true">›</span>')}</div>`;
  }
  q('.cfx-plot').hidden=state.table;q('.cfx-rotation-table').hidden=!state.table;q('.cfx-replay').hidden=!state.replayOpen;
  fitResearchLayout();
  q('[data-action="replay-toggle"]').textContent=state.replayOpen?'結束':'回放';q('[data-action="replay-toggle"]').setAttribute('aria-pressed',state.replayOpen);
  if(state.tab==='flow'&&(!replay?.playing||paintedFrame!==sourceFrame()))q('.cfx-flow-symbols').innerHTML=frame.rows.map(r=>`<button data-open-chart="${escape(r.symbol)}" aria-pressed="${state.selected===r.symbol}" title="${escape(r.base)} ${pct(r.x)}"><i style="background:${r.state.color}"></i>${escape(r.base)}</button>`).join('');
  const range=q('[data-control="frame"]');range.max=String(list.length-1);range.value=String(state.frame);range.disabled=list.length<2;
  q('[data-action="play"]').disabled=list.length<2;
  q('[data-action="frame-prev"]').disabled=index===0;q('[data-action="frame-next"]').disabled=index>=list.length-1;q('[data-action="latest"]').disabled=false;
  if(paintedFrame!==sourceFrame() || !replay?.playing){
   q('.cfx-rotation-table').innerHTML=state.tab==='rotation'?rankMarkup(frame):`<div class="cfx-side-head"><span>主動買賣排行</span><select data-control="sort" aria-label="主動買賣排名方式"><option value="relative" ${state.sort==='relative'?'selected':''}>買賣占比</option><option value="momentum" ${state.sort==='momentum'?'selected':''}>占比變化</option><option value="volume" ${state.sort==='volume'?'selected':''}>24H 成交額</option><option value="net" ${state.sort==='net'?'selected':''}>主動淨買額估算</option></select></div><table class="cfx-table"><thead><tr><th>幣種</th><th>占比</th><th>變化</th><th>自選</th></tr></thead><tbody>${frame.rows.filter(r=>!state.filter||r.state.id===state.filter).sort((a,b)=>state.sort==='net'?(b.netNotional??-Infinity)-(a.netNotional??-Infinity):state.sort==='volume'?b.turnover-a.turnover:state.sort==='momentum'?b.y-a.y:b.x-a.x).map(r=>`<tr data-member-detail="${r.symbol}" tabindex="0" aria-label="查看 ${r.base} 主動買賣詳情"><td><button data-open-chart="${r.symbol}">${r.base} ↗<small style="color:${r.state.color}">${r.state.name}</small></button></td><td>${pct(r.x)}</td><td>${pp(r.y)}</td><td><button data-watch="${r.symbol}" aria-label="${watched.has(r.symbol)?'取消':'加入'} ${r.base} 自選" aria-pressed="${watched.has(r.symbol)}">${watched.has(r.symbol)?'★':'☆'}</button></td></tr>`).join('')}</tbody></table>`;
   qa('[data-state]').forEach(b=>{const def=defs().find(d=>d.id===b.dataset.state);b.innerHTML=`<i style="background:${def.color}"></i>${def.name}<strong>${frame.rows.filter(r=>r.state.id===def.id).length}</strong>`;b.setAttribute('aria-pressed',String(state.filter===def.id));});
   q('[data-slot="selected-count"]').textContent=String(pickerItems().filter(r=>state.selectedIds===null||state.selectedIds.includes(r.symbol)).length);
   qa('[data-action="scope-all"],[data-action="scope-watch"],[data-action="view-bubbles"],[data-action="view-rank"],[data-action="density-all"],[data-action="density-top"]').forEach(b=>b.setAttribute('aria-pressed',String(({ 'scope-all':!state.watch,'scope-watch':state.watch,'view-bubbles':!state.table,'view-rank':state.table,'density-all':state.density==='all','density-top':state.density==='top'})[b.dataset.action])));
   const total=sourceFrame().rows.length;
   q('[data-slot="research-hint"]').textContent=frame.rows.length?`顯示 ${frame.rows.length}/${total} · 點泡泡查看詳情`:state.watch?'尚未加入自選，可在排行或詳情加入。':'沒有符合篩選的結果';
   paintedFrame=sourceFrame();
  }
  status(state.tab==='rotation'?`Bitget ${market.kind==='foreground-refresh'?'更新':'快照'} · OX 板塊分類 · 目前觀察池回看`:'Bitget 主動成交',frame.ts);
 }
 function researchModel(acceptUpdate=false){let source=state.tab==='flow'?(pressureSnapshot()||{instruments:[],tickers:[],flows:{}}):market;
  if(state.tab==='flow'&&state.period==='1d'){
   if(!historyArchive&&!historyPending){historyPending=true;fetch(new URL('../../../../previews/data/crypto-flow-history.json',import.meta.url),{signal:AbortSignal.timeout(12000)}).then(r=>{if(!r.ok)throw Error('History unavailable');return r.json();}).then(data=>{historyArchive=data;historySource=null;modelSource=null;if(!life.signal.aborted&&!suspended&&state.tab==='flow')render();}).catch(()=>{historyArchive={symbols:{}};if(!life.signal.aborted&&!suspended&&state.tab==='flow')render();}).finally(()=>historyPending=false);}
   if(historyArchive){if(historySource!==source){historyCombined=mergeFlowHistory(source,historyArchive);historySource=source;}source=historyCombined;}
   else source={...source,flows:{...source.flows,'1d':{}}};
  }
  if(state.tab==='rotation'&&state.period==='1d'&&dailyMarket){
   const historyDays=replayWindow(state.replayRange).days;
   if(dailyCombinedMarket!==market||dailyCombinedData!==dailyMarket||dailyCombined?.historyDays!==historyDays){dailyCombined={...market,historyDays,dailyCandles:dailyMarket.historyDays>=historyDays?dailyMarket.dailyCandles:{}};dailyCombinedMarket=market;dailyCombinedData=dailyMarket;}
   source=dailyCombined;
  }
  const native=state.tab==='rotation'&&state.period!=='1d'?nativePeriods.get(state.period):null;
  if(native?.scan?.complete){
   if(nativeCombinedMarket!==market||nativeCombinedData!==native||nativeCombined?.nativePeriod!==state.period){nativeCombined={...market,nativePeriod:state.period,periodCandles:{[state.period]:native.candles},scan:native.scan};nativeCombinedMarket=market;nativeCombinedData=native;}
   source=nativeCombined;
  }
  if(modelSource===source&&modelPeriod===state.period+':'+state.replayRange)return;
  // Keep a replay's cohort, domain and fractional cursor stable even while
  // paused. The latest button or ending replay explicitly accepts new data.
  if(state.replayOpen&&!acceptUpdate&&modelPeriod===state.period+':'+state.replayRange&&frames().some(f=>f.rows.length))return;
  const oldTime=sourceFrame()?.ts,atLatest=!state.replayOpen&&(!frames().length||state.frame>=frames().length-1);
  const wanted=state.period==='1d'&&state.replayRange!=='current'?replayWindow(state.replayRange).days:8;
  let next=state.tab==='flow'?buildFlowHistory(source,state.period,wanted):buildRotation(source,state.period,wanted);
  if(state.tab==='rotation'&&native&&state.period!=='1d'&&!next.frames.some(f=>f.rows.length))next=buildRotation(market,state.period,wanted);
  if(modelPeriod===state.period+':'+state.replayRange&&frames().some(f=>f.rows.length)&&!next.frames.some(f=>f.rows.length))return;
  if(state.tab==='flow')flowHistory=next;else rotation=next;
  const list=frames();
  state.frame=atLatest?Math.max(0,list.length-1):Math.max(0,Math.min(list.length-1,list.findIndex(f=>f.ts===oldTime)>=0?list.findIndex(f=>f.ts===oldTime):Math.floor(state.frame)));
  const all=list.flatMap(f=>f.rows);domain={x:state.tab==='flow'?100:Math.max(.1,...all.map(r=>Math.abs(r.x)))*1.12,y:Math.max(.1,...all.map(r=>Math.abs(r.y)))*1.12};
  modelSource=source;modelPeriod=state.period+':'+state.replayRange;paintedFrame=null;
 }
 function renderRotation(){
  researchModel();mountResearch();q('.cfx-replay').hidden=!state.replayOpen;q('[data-control="period"]').value=timeSelection();q('[data-control="period"]').dataset.range=state.replayRange==='current'?'current':'history';
  fitResearchLayout();
  const emptyPlot=q('.cfx-plot-loading');
  if(!frames().some(f=>f.rows.length)){
   const complete=state.tab==='flow'?(state.period==='1d'&&!historyArchive?false:pressureSnapshot()?.scan?.complete):state.period==='1d'?dailyMarket?.historyDays>=replayWindow(state.replayRange).days&&dailyMarket?.scan?.complete:nativePeriods.get(state.period)?.scan?.complete;
   const progress=periodProgress.get(state.period);
   const message=complete?'此級別目前沒有完整期別資料':'正在載入 '+state.period.toUpperCase()+' 資料…'+(progress?' '+progress.done+'/'+progress.total:'');
   stageKey='';q('[data-slot="replay-stage"]').textContent=message;
   const range=q('[data-control="frame"]');range.max=range.value='0';range.disabled=true;
   for(const action of ['frame-prev','frame-next','latest'])q('[data-action="'+action+'"]').disabled=true;
   q('.cfx-plot').hidden=state.table;q('.cfx-rotation-table').hidden=!state.table;q('.cfx-rotation-table').innerHTML=empty(message);
   emptyPlot.hidden=false;emptyPlot.textContent=message;q('canvas').dataset.period=state.period;q('canvas').dataset.points='0';q('[data-slot="replay-coverage"]').textContent='正在確認可回放日期；缺資料的期別不補零';status(message);q('[data-action="play"]').disabled=true;plot.update([]);return;
  }
  emptyPlot.hidden=true;paintRotation();
 }
 function renderFlow(){renderRotation();}
 function renderHeatmap(){const rows=heatmapRows(market,state.heatPeriod).filter(r=>(!state.sector||r.sectorId===state.sector)&&(!state.search||r.base.includes(state.search)));
  if(q('.cfx-content').dataset.mode!=='heatmap'||!otherPlot){cleanup();q('.cfx-content').dataset.mode='heatmap';q('.cfx-content').innerHTML=`${toolbar(state.heatPeriod,true)}<div class="cfx-chart-meta"><span data-slot="heat-coverage"></span><span>負值 ← 顏色 → 正值</span></div><div class="cfx-heatmap"><canvas role="img" aria-label="加密市場熱力圖，可雙指縮放、滑鼠滾輪縮放與拖曳，面積依選定權重，顏色依漲跌幅"></canvas><div class="cfx-zoom"><button data-action="heat-out" aria-label="縮小熱力圖">−</button><button data-action="heat-reset" aria-label="重設熱力圖">${icon('reset')}</button><button data-action="heat-in" aria-label="放大熱力圖">＋</button></div></div><div class="cfx-heat-list"></div>`;otherPlot=createToolChart(q('canvas'),{signal:life.signal,onSelect:openAsset});if(viewport)otherPlot.restoreViewport(viewport);}
  q('[data-slot="heat-coverage"]').textContent=`${rows.length} 幣 · ${state.heatPeriod.toUpperCase()} · ${state.weight==='equal'?'等大':state.weight==='cap'?'市值面積':'成交額面積'}`;
  q('.cfx-heat-list').innerHTML=rows.map(r=>`<button data-asset="${r.symbol}"><b>${r.base}</b><span class="${color(r.returnPct)}">${pct(r.returnPct)}</span></button>`).join('');
  otherPlot.update({type:'heatmap',rows,weight:state.weight,grouped:state.grouped});status(`Bitget 行情${market.kind==='foreground-refresh'?'更新':'快照'}${state.weight==='cap'?' · 市值：CoinGecko 各幣時間見說明':''} · 觀察池`,rows[0]?.end);
 }
 function showFlowDetail(symbol){const r=sourceFrame()?.rows.find(r=>r.symbol===symbol);if(!r)return;presentAsset(symbol,`<span style="color:${r.state.color}">${r.state.name}</span><dl class="cfx-detail-metrics"><div><dt>主動買賣占比</dt><dd>${pct(r.x)}</dd></div><div><dt>占比變化</dt><dd>${pp(r.y)}</dd></div><div><dt>主動買量 · ${r.base}</dt><dd>${compact(r.buy)}</dd></div><div><dt>主動賣量 · ${r.base}</dt><dd>${compact(r.sell)}</dd></div><div><dt>主動淨買額估算</dt><dd>${compact(r.netNotional)} USDT</dd></div></dl><button class="cfx-watch" data-watch="${r.symbol}" aria-pressed="${watched.has(r.symbol)}">${watched.has(r.symbol)?'★ 已加入自選':'☆ 加入自選'}</button><div class="cfx-balance"><i style="width:${(r.x+100)/2}%"></i></div><div class="cfx-data-note">主動成交期別 ${dateLabel(sourceFrame().ts)} UTC+8 · 淨買額為估算。</div>`);}
 function render(){renderSettings();q('.cfx-source-badge').textContent='BITGET · USDT 永續';qa('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===state.tab)));q('.cfx').classList.toggle('focused',state.focus);q('.cfx').classList.toggle('cfx-edge-layout',['rotation','flow'].includes(state.tab));q('[data-slot="exit-label"]').textContent=state.focus?'退出全螢幕':'全螢幕';if(state.tab==='flow'?!flowSnapshot:!market){cleanup();q('.cfx-content').dataset.mode='';q('.cfx-content').innerHTML=empty(window.OXLoading?.markup('讀取市場資料')||'讀取市場資料…');return;}const completeMarket=market;if(partialMarket&&state.tab==='heatmap'&&!market.scan?.complete)market=partialMarket;switch(state.tab){case'rotation':renderRotation();break;case'heatmap':renderHeatmap();break;case'flow':renderFlow();break;default:renderRotation();}market=completeMarket;const coverage=state.tab==='flow'?partialFlow?.scan:partialMarket?.scan;if(coverage)notice('更新市場資料…');else if(!request&&!marketRequest&&!periodRequest&&!dailyRequest)notice('');q('.cfx').dataset.scanState=coverage?'partial':(state.tab==='flow'?pressureSnapshot()?.scan?.complete:market?.scan?.complete)?'complete':'snapshot';maybeRefreshMarket();}
 function help(){q('[data-slot="help"]').innerHTML=`<details open><summary>板塊輪動如何閱讀</summary><p>橫軸＝成分幣等權平均報酬 − BTC 同期報酬，單位 pp。縱軸＝本期相對報酬 − 上一期相對報酬。右上為領先擴大、右下為領先降溫、左上為落後改善、左下為落後擴大。</p><p>可在圖表設定開關軌跡；軌跡連接同一板塊的真實歷史期別。回放使用目前固定觀察池，不代表當時全市場的可投資範圍。每個板塊至少兩個成分幣，且回放所需 K 線完整才納入。</p><p>成交占比＝板塊本期成交額／所有納入板塊本期成交額。占比上升只代表本觀察池的交易活躍度提高，不證明資金從另一板塊轉入。泡泡預設依強弱調整大小，弱勢泡泡保留可讀的最小尺寸；可在設定切換為等大。板塊依相對 BTC 表現，主動買賣依買賣占比絕對值；位置仍由真實占比及變化決定。</p></details><details><summary>板塊分類與涵蓋範圍</summary><p>31 個一級板塊、226 個二級題材是 OX 擴充候選名單，非全市場窮盡名單或 Bitget 上架保證；幣可跨一級及二級。點「已選」查看各級題材與成分幣。</p><p>只把已上線的 Bitget 加密 USDT 永續、baseCoin 相符及有成交行情的合約納入；成分幣依交易所合約資料核對後納入。每個一級板塊至少兩個成分有完整共同 K 線才顯示泡泡。BTC 是 BTC／PoW 成分也是相對報酬基準。重複歸類的成交占比不能解讀為去重後市場資金流。</p><p><a href="https://www.bitget.com/docs/catalog/market/market-data" target="_blank" rel="noopener">Bitget 公開合約與行情來源</a></p></details><details><summary>主動買賣與回放</summary><p>横軸＝100 ×（主動買量 − 主動賣量）／兩者總量；縱軸＝相較上一個完整期別的占比變化。這是買賣力道占比，單位為百分比／百分點，不是資金淨流入金額。主動買賣可依 24H 漲幅、成交額或既有雷達 OX 評分選取最多 50 個已驗證 USDT 永續合約；資金異動模式先取成交額前 50，再按主動淨買額估算排序。主動淨買額＝（本期主動買量－主動賣量）× 當前價格；不是實際入金、大單逐筆統計或市場全體排名。每個合約的主動成交 API 需依交易所限速逐一取得，期間保留已完成的資料。</p><p>回放只使用相鄰、已結束的真實期別；泡泡的位置、大小、顏色連續過渡，標示與排行使用該期原始數值。全部與成交前 10 只改變顯示，完整更新範圍不變；缺資料的標的不補零。</p></details><details><summary>Footprint／CVD／Volume Profile</summary><p>使用 Bitget fills-history 的真實逐筆成交，依 tradeId 去重。Ask＝主動買、Bid＝主動賣；Delta＝Ask−Bid。價格依設定分桶，時間為 1 分鐘。首尾 K 線標為不完整。完整性僅限取得的 REST 頁面，不宣稱交易所全量歷史。</p><p>CVD 自已載入首筆交易歸零。Volume Profile 加總同價位已載入成交。POC 為最大量價位。斜向不平衡條件：Ask(k) ≥ 3 × Bid(k−1) 或 Bid(k) ≥ 3 × Ask(k＋1)，並達到該根 1% 成交量；分母為零不計比率。門檻只是標記規則，不是買賣訊號。</p></details>`;showDialog('.cfx-dialog');}
 async function refreshPressure(){if(request||suspended||document.hidden)return;lastPressureAttempt=Date.now();const period=state.period,mode=state.flowMode,key=pressureKey(),analyses=radarAnalyses();let updated=false;if(mode==='score'&&!analyses.size){notice('OX 雷達評分尚未產生；雷達分析完成後再更新此模式。');return;}request=new AbortController();const loading=window.OXLoading?.begin('crypto','更新主動成交標的',{signal:request.signal,views:['strength'],target:q('[data-slot="loading"]')});notice('依序取得 Bitget 主動成交資料…');try{const next=await flowRefresh.refresh({period,mode,analyses},{signal:request.signal,onPartial:next=>{if(life.signal.aborted||suspended||request?.signal.aborted||pressureKey()!==key)return;partialFlow=next;if(next.scan.done===1||next.scan.done%3===0)render();},onProgress:(n,total)=>{loading?.update(n,total);notice('更新市場資料…');}});if(!buildFlow(next,period).rows.length)throw new Error('沒有可用共同期別');if(life.signal.aborted||suspended||request?.signal.aborted||pressureKey()!==key)return;pressureSnapshots.set(key,next);latestFlows.set(key,next);partialFlow=null;updated=true;}catch(e){if(e.name!=='AbortError'&&!life.signal.aborted){partialFlow=null;lastPressureAttempt=Date.now()-280000;render();notice('主動成交更新失敗，保留有時間戳的原資料；可按更新重試。');}}finally{const cancelled=request?.signal.aborted;request=null;loading?.finish();if(updated&&!suspended&&!life.signal.aborted&&state.tab==='flow'&&pressureKey()===key)render();if(cancelled&&!suspended&&!document.hidden&&!life.signal.aborted)queueMicrotask(maybeRefreshMarket);}}
 function changeTab(tab){cleanup();modelSource=null;modelPeriod=null;state.tab=tab;state.search='';state.selected='';state.filter='';if(tab==='flow'&&!PERIODS[state.period])state.period='1h';if(tab==='rotation'&&(!TOOL_PERIODS[state.period]||state.period==='24h'))state.period='15m';render();}
 shadow.addEventListener('click',e=>{const b=e.target.closest('button'),member=e.target.closest('[data-member-detail]');if(!b&&member){openMember(member.dataset.memberDetail);return;}if(!b||b.disabled)return;const d=b.dataset;
  if(d.tab){changeTab(d.tab);return;}if(d.period){if(state.tab==='heatmap')state.heatPeriod=d.period;else state.period=d.period;state.frame=7;state.selected='';render();return;}
  if(d.state){state.filter=state.filter===d.state?'':d.state;paintRotation();return;}if(d.sector){openSector(d.sector);return;}
  if(d.openChart){openChart(d.openChart);return;}if(d.asset){openAsset(d.asset);return;}if(d.flowDetail){state.selected=d.flowDetail;showFlowDetail(d.flowDetail);paintRotation();return;}if(d.flowSymbol){state.selected=d.flowSymbol;showFlowDetail(d.flowSymbol);paintRotation();return;}
  if(d.heatSector!==undefined){state.sector=d.heatSector;render();return;}
  if(d.watch){watched.has(d.watch)?watched.delete(d.watch):watched.add(d.watch);b.setAttribute('aria-pressed',String(watched.has(d.watch)));b.textContent=watched.has(d.watch)?'★':'☆';try{localStorage.setItem(watchKey,JSON.stringify([...watched]));}catch{}paintRotation();return;}
  if(d.frameTime){stopReplay();state.frame=rotation.frames.findIndex(f=>f.ts===Number(d.frameTime));openSector(state.selected);return;}
  switch(d.action){case'retry-data':void loadData();break;case'settings':renderSettings();showDialog('.cfx-settings-dialog');break;case'close-settings':q('.cfx-settings-dialog').close();break;case'exit':onExit();break;case'help':q('.cfx-settings-dialog').close();help();break;case'close-help':q('.cfx-dialog').close();break;case'close-asset':closeAsset();break;case'retry-asset':void updateAssetChart();break;case'asset-reset':assetChart?.reset();break;case'close-sector':q('.cfx-sector-dialog').close();state.selected='';paintRotation();break;case'fullscreen':state.focus=!state.focus;q('.cfx').classList.toggle('focused',state.focus);q('[data-slot="exit-label"]').textContent=state.focus?'退出全螢幕':'全螢幕';plot?.setInteractive(true);fitResearchLayout(true);break;
   case'scope-all':state.watch=false;paintRotation();break;case'scope-watch':state.watch=true;paintRotation();break;
   case'view-bubbles':state.table=false;paintRotation();break;case'view-rank':state.table=true;paintRotation();break;
   case'density-all':state.density='all';paintRotation();break;case'density-top':state.density='top';paintRotation();break;
   case'picker':renderPicker();showDialog('.cfx-picker-dialog');break;case'close-picker':q('.cfx-picker-dialog').close();break;
   case'select-all':state.selectedIds=null;renderPicker();paintRotation();break;case'select-none':state.selectedIds=[];renderPicker();paintRotation();break;
   case'replay-toggle':stopReplay();state.replayOpen=!state.replayOpen;if(state.replayOpen){state.frame=0;paintRotation();startReplay();}else{state.frame=frames().length-1;researchModel();paintRotation();}break;
   case'watch-only':state.watch=!state.watch;paintRotation();renderSettings();break;case'toggle-table':state.table=!state.table;paintRotation();renderSettings();break;
   case'trails':state.trails=!state.trails;b.setAttribute('aria-pressed',state.trails);paintRotation();break;case'equal-size':state.equal=!state.equal;b.setAttribute('aria-pressed',state.equal);paintRotation();break;
   case'group':state.grouped=!state.grouped;render();break;case'heat-in':otherPlot?.zoom(1.3);break;case'heat-out':otherPlot?.zoom(1/1.3);break;case'heat-reset':otherPlot?.reset();break;
   case'zoom-in':plot?.zoom(.5);break;case'zoom-out':plot?.zoom(-.5);break;case'reset':plot?.reset();break;
   case'latest':stopReplay();researchModel(true);state.frame=frames().length-1;paintRotation();break;
   case'frame-prev':case'frame-next':stopReplay();state.frame=Math.max(0,Math.min(frames().length-1,Math.floor(state.frame)+(d.action==='frame-prev'?-1:1)));paintRotation();break;
   case'play':if(replay?.playing)replay.pause();else startReplay();break;
   case'refresh-flow':lastPressureAttempt=0;void refreshPressure();break;}

 },{signal:life.signal});
 shadow.addEventListener('input',e=>{
  if(e.target.matches('.cfx-research-search input,.cfx-toolbar .cfx-search input')){state.search=e.target.value.trim().toUpperCase();if(state.tab==='heatmap')renderHeatmap();else paintRotation();}
  if(e.target.dataset.control==='picker-search'){const query=e.target.value.trim().toUpperCase();qa('[data-picker-row]').forEach(row=>row.hidden=!row.dataset.pickerRow.includes(query));}
  if(e.target.dataset.control==='frame'){if(replay)replay.seek(Number(e.target.value));else{state.frame=Number(e.target.value);paintRotation();}}
 },{signal:life.signal});
 shadow.addEventListener('change',e=>{
  if(e.target.dataset.item){const items=pickerItems();const selected=new Set(state.selectedIds===null?items.map(r=>r.symbol):state.selectedIds);e.target.checked?selected.add(e.target.dataset.item):selected.delete(e.target.dataset.item);state.selectedIds=[...selected];q('[data-slot="picker-count"]').textContent=`已選 ${selected.size}/${items.length}`;paintRotation();return;}
  switch(e.target.dataset.control){
   case'asset-period':if(!assetSession||!ASSET_PERIODS[e.target.value])return;assetSession.period=e.target.value;assetChart?.destroy();assetChart=null;q('.cfx-asset-chart canvas').hidden=true;void updateAssetChart();return;
   case'period':{
    const value=e.target.value,range=value.startsWith('range:')?value.slice(6):null;
    if(range&&!REPLAY_RANGES.some(([id])=>id!=='current'&&id===range))return;
    stopReplay();periodRequest?.abort();dailyRequest?.abort();request?.abort();partialFlow=null;lastPressureAttempt=0;modelSource=null;state.selected='';
    if(range){state.replayRange=range;state.period='1d';state.replayOpen=true;state.frame=366;lastDailyAttempt=0;}
    else{state.replayRange='current';if(state.tab==='heatmap')state.heatPeriod=value;else state.period=value;state.frame=7;}
    break;
   }
   case'flow-mode':if(!FLOW_MODES.some(([id])=>id===e.target.value))return;stopReplay();request?.abort();partialFlow=null;state.flowMode=e.target.value;state.sort=state.flowMode==='net'?'net':'relative';state.selectedIds=null;state.selected='';state.frame=7;modelSource=null;lastPressureAttempt=0;break;
   case'replay-speed':state.replaySpeed=Number(e.target.value);replay?.setSpeed(state.replaySpeed);return;
   case'heat-sector':state.sector=e.target.value;break;case'sort':state.sort=e.target.value;paintRotation();return;case'weight':state.weight=e.target.value;break;default:return;
  }render();
 },{signal:life.signal});
 function closeInner(){if(q('.cfx-picker-dialog').open){q('.cfx-picker-dialog').close();return true;}if(q('.cfx-settings-dialog').open){q('.cfx-settings-dialog').close();return true;}if(q('.cfx-dialog').open){q('.cfx-dialog').close();return true;}if(q('.cfx-asset-dialog').open){closeAsset();return true;}if(q('.cfx-sector-dialog').open){q('.cfx-sector-dialog').close();state.selected='';paintRotation();return true;}if(state.selected){state.selected='';if(state.tab==='rotation')paintRotation();return true;}if(state.focus){state.focus=false;q('.cfx').classList.remove('focused');q('[data-slot="exit-label"]').textContent='全螢幕';plot?.setInteractive(true);fitResearchLayout(true);return true;}return false;}
 shadow.addEventListener('keydown',e=>{const member=e.target.closest('[data-member-detail]');if(member&&e.target===member&&['Enter',' '].includes(e.key)){e.preventDefault();openMember(member.dataset.memberDetail);return;}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!closeInner())onExit();}},{signal:life.signal});
 q('.cfx-asset-dialog').addEventListener('close',()=>{if(!q('.cfx-asset-dialog').open)closeAsset();},{signal:life.signal});
 q('.cfx-sector-dialog').addEventListener('cancel',e=>{e.preventDefault();closeInner();},{signal:life.signal});
 q('.cfx-asset-dialog').addEventListener('cancel',e=>{e.preventDefault();closeInner();},{signal:life.signal});
  let dataPending=false;
 async function loadData(){if(dataPending||life.signal.aborted)return;dataPending=true;render();try{const values=await Promise.all([market||state.tab==='flow'?Promise.resolve(market):loadCached(marketURL,'market'),flowSnapshot||state.tab!=='flow'?Promise.resolve(flowSnapshot):loadCached(snapshotURL,'flow')]);if(life.signal.aborted)return;[market,flowSnapshot]=values;if(!suspended)render();}catch(e){if(!life.signal.aborted){q('.cfx-content').innerHTML=empty('資料暫時無法取得')+'<button class="cfx-button" data-action="retry-data">重試</button>';notice('');}}finally{dataPending=false;}}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){stopReplay();assetRequest?.abort();request?.abort();marketRequest?.abort();periodRequest?.abort();dailyRequest?.abort();lastMarketAttempt=lastPressureAttempt=lastDailyAttempt=0;}else if(!suspended){maybeRefreshMarket();if(assetSession)void updateAssetChart(true);}},{signal:life.signal});
 window.addEventListener('online',()=>{lastMarketAttempt=lastPressureAttempt=0;if(!suspended){if(state.tab==='flow'?!flowSnapshot:!market)void loadData();else maybeRefreshMarket();if(assetSession&&!assetRequest)void updateAssetChart(true);}},{signal:life.signal});
 render();if(autoRefresh)marketTimer=setInterval(()=>{if(!life.signal.aborted)maybeRefreshMarket();},15000);if(state.tab==='flow'?!flowSnapshot:!market)void loadData();
 return {closeInner,getState:()=>({state:{...state},viewport:otherPlot?.getViewport?.()||plot?.getViewport?.()||viewport}),suspend(){suspended=true;closeAsset();plot?.setActive?.(false);lastMarketAttempt=lastPressureAttempt=lastDailyAttempt=0;stopReplay();request?.abort();marketRequest?.abort();periodRequest?.abort();dailyRequest?.abort();for(const d of qa('dialog'))d.close();},resume(){suspended=false;plot?.setActive?.(true);fitResearchLayout(true);if(!plot&&!otherPlot||partialMarket||partialFlow)render();else maybeRefreshMarket();},destroy(){life.abort();cancelAnimationFrame(layoutRaf);request?.abort();marketRequest?.abort();periodRequest?.abort();dailyRequest?.abort();clearInterval(marketTimer);cleanup();q('.cfx-settings-dialog')?.close();q('.cfx-dialog')?.close();q('.cfx-asset-dialog')?.close();shadow.innerHTML='';}};
}
