import { buildFlow, buildFlowHistory, cryptoUniverse, STATES, signed, compact, dateLabel } from './flow-model.js';
import { buildRotation, heatmapRows, ROTATION_STATES, TOOL_PERIODS } from './tools-model.js?v=20261001-loading1';
import { createFlowChart } from './flow-chart.js?v=20261001-loading1';
import { createToolChart } from './tools-charts.js?v=20261005-graytop5';
import { refreshFlow } from './flow-source.js';
import { revealStyledShadow, preloadToolStyles } from '../../../components/style-ready.js?v=20261005-stable18';
import { refreshMarket } from './market-live.js';
import { createMarketRefreshCache } from './market-cache.js';
import { withSectorCatalog, verifiedSectorUniverse } from './sector-taxonomy.js';
import { replayVisualRows, createFlowReplayPlayer } from './replay-motion.js';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={close:'<path d="m6 6 12 12M18 6 6 18"/>',back:'<path d="m10 5-7 7 7 7M3 12h18"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',reset:'<path d="M3 4v6h6M4 10a8 8 0 1 1 1 8"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',play:'<path d="m8 4 12 8-12 8Z"/>',pause:'<path d="M8 4v16M16 4v16"/>',settings:'<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',refresh:'<path d="M4 4v6h6M4 10a8 8 0 1 1 1 8"/>',plus:'<path d="M5 12h14M12 5v14"/>',minus:'<path d="M5 12h14"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||''}</svg>`;
const snapshotURL=new URL('../../../../previews/data/crypto-flow-snapshot.json',import.meta.url);
const marketURL=new URL('../../../../previews/data/crypto-tools-snapshot.json',import.meta.url);
const cssURL=new URL('./flow.css?v=20261006-news4',import.meta.url);
const numPrice=v=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:v<1?6:2}):'—';
const pct=v=>Number.isFinite(v)?signed(v,2)+'%':'—';
const pp=v=>Number.isFinite(v)?signed(v,2)+'pp':'—';
const color=v=>v>=0?'positive':'negative';
const time=t=>new Date(t).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false});
const TABS=[['heatmap','熱力圖'],['rotation','板塊輪動'],['flow','主動買賣']];
let cachedMarket=null,cachedFlow=null;const latestFlows=new Map();
const marketRefresh=createMarketRefreshCache(refreshMarket,{
 keyFor:()=> 'ox-crypto-24-20261007',
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
const flowRefresh=createMarketRefreshCache((seed,options)=>refreshFlow(seed.period,options).then(value=>({...value,period:seed.period})),{
 maxPools:3,keyFor:seed=>seed.period,
 isFresh:(value,now,maxAge)=>value?.scan?.complete===true&&value.scan.done===value.scan.total&&now-flowTime(value)>=-10000&&now-flowTime(value)<maxAge,
 validate(value){if(!value.scan?.complete||value.scan.done!==value.scan.total||value.scan.total!==value.tickers.length)throw Error('主動成交更新未涵蓋完整觀察池');if(!buildFlow(value,value.period).rows.length)throw Error('沒有可用共同期別');}
});
export async function preloadFlowMarket(signal){const next=await flowRefresh.refresh({period:'1h'},{signal,owner:'analytics-preload',priority:-20});latestFlows.set('1h',next);}
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
 const state={tab:TABS.some(([id])=>id===initialTab)?initialTab:'rotation',period:'1h',heatPeriod:'24h',selected:'',filter:'',sector:'',search:'',frame:7,equal:initialTab!=='flow',trails:false,table:false,weight:matchMedia('(max-width:600px)').matches?'equal':'volume',grouped:false,focus:false,symbol:'BTCUSDT',sort:'relative',watch:false,density:'all',selectedIds:null,replayOpen:false,replaySpeed:1};
 let market=marketSnapshot?withSectorCatalog(marketSnapshot):null,flowSnapshot=snapshot,rotation=null,plot=null,otherPlot=null,replay=null,replayButtonState=null,request=null,marketRequest=null,lastMarketAttempt=0,lastPressureAttempt=0,marketTimer=null;
 let partialMarket=null,partialFlow=null;
 let suspended=false,viewport=restore?.viewport||null,modelSource=null,modelPeriod=null,flowHistory=null,domain=null,paintedFrame=null;
 if(restore?.state)Object.assign(state,restore.state,{tab:initialTab,focus:false});
 const pressureSnapshots=new Map();
 async function refreshCurrentMarket(){if(!autoRefresh||!market||marketRequest||suspended||document.hidden)return;
  if(Date.now()-Number(market.requestTime)<5*60000)return;
  marketRequest=new AbortController();lastMarketAttempt=Date.now();notice('正在更新 Bitget 觀察池…');
  const loading=window.OXLoading?.begin('crypto','更新熱力圖與板塊',{signal:marketRequest.signal,total:market.tickers.length,done:0,views:['strength'],target:q('[data-slot="loading"]')});
  try{const next=await marketRefresh.refresh(market,{signal:marketRequest.signal,onPartial:next=>{if(life.signal.aborted||suspended||marketRequest?.signal.aborted)return;partialMarket=next;if(next.scan.done===1||next.scan.done%5===0)render();},onProgress:(n,total)=>{loading?.update(n,total);if(n===total||n%5===0)notice(`Bitget 更新 ${n}/${total} 幣…`);}});
   if(!life.signal.aborted&&!suspended){market=next;partialMarket=null;cachedMarket=Promise.resolve(next);render();}
  }catch(e){if(e.name!=='AbortError'&&!life.signal.aborted){partialMarket=null;render();notice(`即時更新失敗：${e.message}；目前顯示有時間戳的快照。`);};}
  finally{const cancelled=marketRequest?.signal.aborted;marketRequest=null;loading?.finish();if(cancelled&&!suspended&&!document.hidden&&!life.signal.aborted)queueMicrotask(maybeRefreshMarket);}
 }
 const maybeRefreshMarket=()=>{if(!autoRefresh||suspended||document.hidden)return;if(['heatmap','rotation'].includes(state.tab)&&Date.now()-lastMarketAttempt>5*60000)void refreshCurrentMarket();if(state.tab==='flow'&&Date.now()-lastPressureAttempt>5*60000&&Date.now()-pressureTime()>5*60000)void refreshPressure();};
 const pressureSnapshot=()=>partialFlow?.flows?.[state.period]?partialFlow:pressureSnapshots.get(state.period)||latestFlows.get(state.period)||flowSnapshot;
 const pressureTime=()=>{const entries=Object.values(pressureSnapshot()?.flows?.[state.period]||{});return entries.length?Math.min(...entries.map(e=>Number(e.response?.requestTime)||0)):0;};
 const watchKey='ox-crypto-sector-watch:'+encodeURIComponent(window.OXAuth?.user?.id||'guest');
 const watched=new Set();try{for(const s of JSON.parse(localStorage.getItem(watchKey)||'[]'))watched.add(s);}catch{}
 shadow.innerHTML=`<link rel="stylesheet" data-ox-href="${cssURL.href}"><main class="cfx"><header class="cfx-top"><button class="cfx-icon cfx-back" data-action="exit" aria-label="返回指標">${icon('back')}</button><span class="cfx-brand">OX<span>CRYPTO</span></span><span class="cfx-source-badge">BITGET · USDT 永續</span><div class="cfx-top-actions"><button class="cfx-icon" data-action="help" aria-label="資料與計算說明">${icon('info')}</button><button class="cfx-exit" data-action="fullscreen">${icon('expand')}<span data-slot="exit-label">全螢幕</span></button></div></header><nav class="cfx-tabs" aria-label="Crypto 工具">${TABS.map(([id,label])=>`<button data-tab="${id}" aria-pressed="${id===state.tab}">${label}</button>`).join('')}</nav><section class="cfx-content" aria-label="工具內容"></section><footer class="cfx-status" role="status"><span data-slot="loading" hidden></span><span data-slot="source">讀取來源資料…</span><span data-slot="period"></span></footer><div class="cfx-notice" role="status" hidden></div><dialog class="cfx-dialog" aria-label="資料與計算說明"><div class="cfx-dialog-head"><span>資料與計算</span><button class="cfx-close" data-action="close-help" aria-label="關閉說明">${icon('close')}</button></div><div data-slot="help"></div></dialog><dialog class="cfx-settings-dialog cfx-dialog" aria-label="圖表設定"><div class="cfx-dialog-head"><span>圖表設定</span><button class="cfx-close" data-action="close-settings" aria-label="關閉圖表設定">${icon('close')}</button></div><div data-slot="settings"></div></dialog><dialog class="cfx-picker-dialog cfx-dialog" aria-label="選擇觀察項目"><div class="cfx-dialog-head"><span>選擇觀察項目</span><button class="cfx-close" data-action="close-picker" aria-label="關閉選擇">${icon('close')}</button></div><div data-slot="picker"></div></dialog><dialog class="cfx-asset-dialog" aria-label="標的詳情"><div class="cfx-dialog-head"><span data-slot="asset-title"></span><button class="cfx-close" data-action="close-asset" aria-label="關閉標的詳情">${icon('close')}</button></div><div data-slot="asset"></div></dialog></main>`;
 revealStyledShadow(shadow,life.signal);
 const q=s=>shadow.querySelector(s),qa=s=>[...shadow.querySelectorAll(s)];
 const notice=text=>{q('.cfx-notice').textContent=text;q('.cfx-notice').hidden=!text;};
 function cleanup(){viewport=otherPlot?.getViewport?.()||plot?.getViewport?.()||viewport;plot?.destroy();otherPlot?.destroy();plot=otherPlot=null;stopReplay();}
 function replayButton(playing){if(replayButtonState===playing)return;replayButtonState=playing;const b=q('[data-action="play"]');if(b){b.innerHTML=icon(playing?'pause':'play');b.setAttribute('aria-label',(playing?'暫停':'播放')+(state.tab==='flow'?'主動買賣':'輪動')+'回放');}}
 function stopReplay(){const player=replay;replay=null;player?.destroy();replayButton(false);}
 function startReplay(){if(frames().length<2)return;if(!replay)replay=createFlowReplayPlayer({length:frames().length,position:state.frame,speed:state.replaySpeed,
  isActive:()=>!suspended&&!document.hidden&&!life.signal.aborted,
  render:position=>{state.frame=position;paintRotation();},onState:({playing})=>replayButton(playing)});
  replay.play();}
 function toolbar(period, heat = false, refresh = false) {
  return `<div class="cfx-toolbar cfx-toolbar-compact"><select class="cfx-period-select" data-control="period" aria-label="時間級別">${Object.keys(TOOL_PERIODS).filter(t=>heat||t!=='24h').map(t=>`<option value="${t}" ${period===t?'selected':''}>${t.toUpperCase()}</option>`).join('')}</select>${search()}<button class="cfx-icon" data-action="settings" aria-label="圖表設定" title="圖表設定">${icon('settings')}</button><button class="cfx-icon" data-action="fullscreen" aria-label="全螢幕" title="全螢幕">${icon('expand')}</button>${refresh?`<button class="cfx-icon" data-action="refresh-flow" aria-label="更新資料" title="更新資料">${icon('refresh')}</button>`:''}</div>`;
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
 function openAsset(symbol){const r=heatmapRows(market,state.heatPeriod).find(x=>x.symbol===symbol);q('[data-slot="asset-title"]').textContent=symbol.replace(/USDT$/,'');q('[data-slot="asset"]').innerHTML=`<div class="cfx-reading"><span>價格 · USDT</span><strong>${numPrice(r?.price)}</strong></div><dl class="cfx-detail-metrics"><div><dt>${state.heatPeriod.toUpperCase()} 漲跌</dt><dd>${pct(r?.returnPct)}</dd></div><div><dt>本期成交額</dt><dd>${compact(r?.volume)} USDT</dd></div></dl>`;q('.cfx-asset-dialog').showModal();}
 function frames(){return state.tab==='flow'?flowHistory?.frames||[]:rotation?.frames||[];}
 function sourceFrame(){const list=frames();return list[Math.max(0,Math.min(list.length-1,Math.floor(state.frame)))];}
 function visibleRotation(){const frame=sourceFrame();if(!frame)return null;
  let rows=frame.rows.filter(r=>(!state.search||r.base.toUpperCase().includes(state.search)||r.members?.some(m=>m.base.includes(state.search)))&&(!state.watch||watched.has(r.symbol))&&(state.selectedIds===null||state.selectedIds.includes(r.symbol)));
  if(state.density==='top'){const latest=frames().at(-1)?.rows||[];const allowed=new Set([...latest].sort((a,b)=>b.turnover-a.turnover).slice(0,10).map(r=>r.symbol));rows=rows.filter(r=>allowed.has(r.symbol));}
  return {...frame,rows};
 }
 const defs=()=>state.tab==='flow'?STATES:ROTATION_STATES;
 function researchToolbar(){return `<div class="cfx-research-toolbar"><div class="cfx-segment"><button data-action="scope-all" aria-pressed="${!state.watch}">${state.tab==='flow'?'幣種':'板塊'}</button><button data-action="scope-watch" aria-pressed="${state.watch}">自選</button></div><div class="cfx-segment"><button data-action="view-bubbles" aria-pressed="${!state.table}">泡泡圖</button><button data-action="view-rank" aria-pressed="${state.table}">排行</button></div><button class="cfx-picker" data-action="picker">已選 <span data-slot="selected-count"></span> ▾</button><select class="cfx-period-select" data-control="period" aria-label="時間級別">${['15m','1h','4h'].map(period=>`<option value="${period}" ${state.period===period?'selected':''}>${period.toUpperCase()}</option>`).join('')}</select><button class="cfx-replay-toggle" data-action="replay-toggle" aria-pressed="${state.replayOpen}">${state.replayOpen?'結束':'回放'}</button></div>`;}
 function mountResearch(){
  if(q('.cfx-content').dataset.mode===state.tab&&q('.cfx-research-panel'))return;
  cleanup();q('.cfx-content').dataset.mode=state.tab;
  q('.cfx-content').innerHTML=`<section class="cfx-research-panel">${researchToolbar()}<div class="cfx-chart-meta"><span data-slot="rotation-coverage"></span><time data-slot="rotation-time"></time></div><div class="cfx-plot"><canvas role="img" aria-label="${state.tab==='flow'?'Crypto 主動買賣泡泡圖':'加密板塊相對 BTC 輪動圖'}，可雙指縮放與拖曳"></canvas></div><div class="cfx-rotation-table" hidden></div><div class="cfx-replay" hidden><div class="cfx-replay-controls"><button data-action="frame-prev" aria-label="前一期">‹</button><button class="cfx-icon" data-action="play" aria-label="${state.tab==='flow'?'播放主動買賣回放':'播放輪動回放'}">${icon('play')}</button><button data-action="frame-next" aria-label="後一期">›</button><select data-control="replay-speed" aria-label="回放速度">${[.5,1,2].map(n=>`<option value="${n}" ${state.replaySpeed===n?'selected':''}>${n}×</option>`).join('')}</select><button data-action="latest">最新</button></div><input type="range" aria-label="${state.tab==='flow'?'主動買賣':'輪動'}歷史期別" data-control="frame" min="0" max="0" step="0.01" value="0"></div><div class="cfx-bottom-actions"><div class="cfx-segment"><button data-action="density-all" aria-pressed="${state.density==='all'}">全部</button><button data-action="density-top" aria-pressed="${state.density==='top'}">成交前 10</button></div><div class="cfx-bottom-tools"><button data-action="zoom-out" aria-label="縮小">${icon('minus')}</button><button data-action="reset" aria-label="重設圖表"><span data-slot="zoom">100%</span></button><button data-action="zoom-in" aria-label="放大">${icon('plus')}</button><button data-action="fullscreen" aria-label="全螢幕">${icon('expand')}</button><button data-action="settings" aria-label="圖表設定">${icon('settings')}</button><button data-action="help" aria-label="資料與計算說明">${icon('info')}</button>${state.tab==='flow'?`<button data-action="refresh-flow" aria-label="更新資料">${icon('refresh')}</button>`:''}</div></div></section><div class="cfx-states">${defs().map(def=>`<button data-state="${def.id}" aria-pressed="false"></button>`).join('')}</div><div class="cfx-research-search">${search()}<span data-slot="research-hint">點泡泡查看詳情</span></div><aside class="cfx-sidebar" aria-label="${state.tab==='flow'?'幣種':'板塊'}分析" hidden></aside>`;
  plot=createFlowChart(q('canvas'),{signal:life.signal,onZoom:zoom=>{const label=q('[data-slot="zoom"]');if(label)label.textContent=Math.round(zoom*100)+'%';},onSelect:id=>{state.selected=id;if(state.tab==='flow')showFlowDetail(id);else paintRotation();}});
  plot.setInteractive(true);if(viewport)plot.restoreViewport(viewport);
  paintedFrame=null;replayButtonState=null;
 }
 function pickerItems(){return state.tab==='flow'?cryptoUniverse(pressureSnapshot()?.instruments||[],pressureSnapshot()?.tickers||[]).map(r=>({symbol:r.symbol,base:r.baseCoin,change24h:Number(r.change24h)*100})):(market?.sectors||[]).map(r=>({symbol:r.id,base:r.name,members:r.members,requested:r.requestedBases||[],expected:r.requestedBases?.length||r.members.length}));}
 function renderPicker(){const items=pickerItems();q('[data-slot="picker"]').innerHTML=`<p class="cfx-data-note">Bitget · USDT 永續觀察池；分類可重疊</p><label class="cfx-search"><input data-control="picker-search" aria-label="搜尋觀察項目" placeholder="搜尋板塊或幣種"></label><div class="cfx-picker-actions"><span data-slot="picker-count">已選 ${items.filter(r=>state.selectedIds===null||state.selectedIds.includes(r.symbol)).length}/${items.length}</span><button data-action="select-all">全部</button><button data-action="select-none">清除選取</button></div><div class="cfx-picker-list">${items.map(r=>`<label data-picker-row="${escape((r.base+' '+(r.requested?.join(' ')||'')).toUpperCase())}"><input type="checkbox" data-item="${escape(r.symbol)}" ${(state.selectedIds===null||state.selectedIds.includes(r.symbol))?'checked':''}><span>${escape(r.base)}</span><small>${r.members?`${r.members.length}/${r.expected} 幣已驗證`:pct(r.change24h)}</small></label>`).join('')}</div>`;}
 function rankMarkup(frame){const rows=[...(frame?.rows||[])].filter(r=>!state.filter||r.state.id===state.filter).sort((a,b)=>state.sort==='share'?(b.shareChange??-Infinity)-(a.shareChange??-Infinity):state.sort==='momentum'?b.y-a.y:b.x-a.x);return `<div class="cfx-side-head"><span>板塊排名</span><select aria-label="板塊排名方式" data-control="sort"><option value="relative" ${state.sort==='relative'?'selected':''}>相對 BTC</option><option value="momentum" ${state.sort==='momentum'?'selected':''}>動能變化</option><option value="share" ${state.sort==='share'?'selected':''}>成交占比變化</option></select></div><div class="cfx-rank-head"><span>板塊</span><span>相對 BTC</span><span>${state.sort==='share'?'占比變化':'動能變化'}</span></div>${rows.map((r,i)=>`<button class="cfx-rank-row" data-sector="${r.id}"><span><i style="background:${r.state.color}"></i>${r.name}<small>${r.state.name} · ${r.members.length}/${r.expectedMembers} 幣</small></span><span class="${color(r.x)}">${pp(r.x)}</span><span class="${color(state.sort==='share'?r.shareChange:r.y)}">${pp(state.sort==='share'?r.shareChange:r.y)}</span></button>`).join('')}${!rows.length?empty('沒有符合篩選的板塊'):''}`;}
 function sectorMarkup(row){const trail=rotation.frames.slice(Math.max(0,state.frame-5),state.frame+1).map(f=>({ts:f.ts,row:f.rows.find(r=>r.id===row.id)})).filter(t=>t.row);return `<div class="cfx-side-head"><span>${row.name}</span><div class="cfx-row"><button class="cfx-watch" data-watch="${row.id}" aria-label="${watched.has(row.id)?'取消':'加入'} ${row.name} 自選" aria-pressed="${watched.has(row.id)}">${watched.has(row.id)?'★':'☆'}</button><button class="cfx-close" data-action="close-sector" aria-label="關閉板塊詳情">${icon('close')}</button></div></div><div class="cfx-selected-state" style="color:${row.state.color}">${row.state.name}<span>${row.members.length} / ${row.expectedMembers} 個成分幣</span></div><dl class="cfx-detail-metrics"><div><dt>相對 BTC</dt><dd>${pp(row.x)}</dd></div><div><dt>動能變化</dt><dd>${pp(row.y)}</dd></div><div><dt>成交占比</dt><dd>${row.share?.toFixed(1)||'—'}% <small>${pp(row.shareChange)}</small></dd></div><div><dt>領先 BTC</dt><dd>${row.members.filter(m=>m.relative>0).length} / ${row.members.length} 幣</dd></div></dl><div class="cfx-trail-history">${trail.map(t=>`<button data-frame-time="${t.ts}" title="${dateLabel(t.ts)} ${t.row.state.name}"><i style="background:${t.row.state.color}"></i><span>${time(t.ts)}</span><small>${t.row.state.name}</small></button>`).join('')}</div><div class="cfx-member-title"><span>成分幣</span><span>${state.period.toUpperCase()} · 依相對強弱</span></div><table class="cfx-table compact"><thead><tr><th>幣種</th><th>漲跌</th><th>相對 BTC</th><th>成交額</th></tr></thead><tbody>${[...row.members].sort((a,b)=>b.relative-a.relative).map(m=>`<tr><td><button data-asset="${m.symbol}">${m.base}</button></td><td class="${color(m.returnPct)}">${pct(m.returnPct)}</td><td>${pp(m.relative)}</td><td>${compact(m.volume)}</td></tr>`).join('')}</tbody></table><div class="cfx-data-note">等權觀察池 · 本期 ${compact(row.turnover)} USDT</div>`;}
 function paintRotation(){
  const frame=visibleRotation();if(!frame||!q('.cfx-research-panel'))return;
  const list=frames(),index=Math.floor(state.frame),fraction=state.frame-index;
  const interpolated=replayVisualRows(list,state.frame,frame.rows);
  const trails=(state.trails?frame.rows:frame.rows.filter(r=>r.symbol===state.selected)).map(r=>({symbol:r.symbol,color:r.state.color,points:list.slice(Math.max(0,index-5),index+1).flatMap(f=>{const p=f.rows.find(x=>x.symbol===r.symbol);return p?[{x:p.x,y:p.y}]:[]})}));
  plot?.update(interpolated,{selected:state.selected,filter:state.filter,rotation:state.tab==='rotation',equalSize:state.equal,domain,trails,axisX:state.tab==='rotation'?'相對 BTC 報酬（pp）':'主動買賣占比（%）',axisY:state.tab==='rotation'?'相對表現變化（pp）':'占比變化（百分點）',quadrants:state.tab==='rotation'?['落後改善','領先擴大','落後擴大','領先降溫']:null});
  q('.cfx-plot').hidden=state.table;q('.cfx-rotation-table').hidden=!state.table;q('.cfx-replay').hidden=!state.replayOpen;
  q('[data-action="replay-toggle"]').textContent=state.replayOpen?'結束':'回放';q('[data-action="replay-toggle"]').setAttribute('aria-pressed',state.replayOpen);
  q('[data-slot="rotation-time"]').textContent=dateLabel(frame.ts)+' UTC+8'+(fraction>.001?' · 回放過渡':'');
  const range=q('[data-control="frame"]');range.max=String(list.length-1);range.value=String(state.frame);
  q('[data-action="play"]').disabled=list.length<2;
  if(paintedFrame!==sourceFrame() || !replay?.playing){
   const row=frame.rows.find(r=>r.symbol===state.selected);
   q('.cfx-sidebar').hidden=state.tab==='flow'||!row;
   if(row&&state.tab==='rotation')q('.cfx-sidebar').innerHTML=sectorMarkup(row);
   q('.cfx-rotation-table').innerHTML=state.tab==='rotation'?rankMarkup(frame):`<div class="cfx-side-head"><span>主動買賣排行</span><select data-control="sort" aria-label="主動買賣排名方式"><option value="relative" ${state.sort==='relative'?'selected':''}>買賣占比</option><option value="momentum" ${state.sort==='momentum'?'selected':''}>占比變化</option><option value="volume" ${state.sort==='volume'?'selected':''}>24H 成交額</option></select></div><table class="cfx-table"><thead><tr><th>幣種</th><th>占比</th><th>變化</th><th>自選</th></tr></thead><tbody>${frame.rows.filter(r=>!state.filter||r.state.id===state.filter).sort((a,b)=>state.sort==='volume'?b.turnover-a.turnover:state.sort==='momentum'?b.y-a.y:b.x-a.x).map(r=>`<tr><td><button data-flow-detail="${r.symbol}">${r.base}<small style="color:${r.state.color}">${r.state.name}</small></button></td><td>${pct(r.x)}</td><td>${pp(r.y)}</td><td><button data-watch="${r.symbol}" aria-label="${watched.has(r.symbol)?'取消':'加入'} ${r.base} 自選" aria-pressed="${watched.has(r.symbol)}">${watched.has(r.symbol)?'★':'☆'}</button></td></tr>`).join('')}</tbody></table>`;
   qa('[data-state]').forEach(b=>{const def=defs().find(d=>d.id===b.dataset.state);b.innerHTML=`<i style="background:${def.color}"></i>${def.name}<strong>${frame.rows.filter(r=>r.state.id===def.id).length}</strong>`;b.setAttribute('aria-pressed',String(state.filter===def.id));});
   q('[data-slot="selected-count"]').textContent=String(pickerItems().filter(r=>state.selectedIds===null||state.selectedIds.includes(r.symbol)).length);
   q('[data-slot="rotation-coverage"]').textContent=state.tab==='rotation'?`${frame.rows.length}/${market.sectors.length} 板塊 · ${new Set(frame.rows.flatMap(r=>r.members.map(m=>m.symbol))).size} 幣 · BTC ${pct(frame.benchmark)}`:`${frame.rows.length}/${flowHistory.current.expected} 幣 · 主動買賣占比`;
   qa('[data-action="scope-all"],[data-action="scope-watch"],[data-action="view-bubbles"],[data-action="view-rank"],[data-action="density-all"],[data-action="density-top"]').forEach(b=>b.setAttribute('aria-pressed',String(({ 'scope-all':!state.watch,'scope-watch':state.watch,'view-bubbles':!state.table,'view-rank':state.table,'density-all':state.density==='all','density-top':state.density==='top'})[b.dataset.action])));
   const total=sourceFrame().rows.length;
   q('[data-slot="research-hint"]').textContent=frame.rows.length?`顯示 ${frame.rows.length}/${total} · 點泡泡查看詳情`:state.watch?'尚未加入自選，可在排行或詳情加入。':'沒有符合篩選的結果';
   paintedFrame=sourceFrame();
  }
  status(state.tab==='rotation'?`Bitget ${market.kind==='foreground-refresh'?'更新':'快照'} · OX 板塊分類 · 目前觀察池回看`:`Bitget 主動成交 · ${flowHistory.current.excluded.length} 幣資料未齊`,frame.ts);
 }
 function researchModel(){const source=state.tab==='flow'?pressureSnapshot():market;
  if(modelSource===source&&modelPeriod===state.period)return;
  if(replay?.playing&&modelPeriod===state.period&&frames().length)return;
  const oldTime=sourceFrame()?.ts,atLatest=!state.replayOpen&&(!frames().length||state.frame>=frames().length-1);
  const next=state.tab==='flow'?buildFlowHistory(source,state.period):buildRotation(source,state.period);
  if(source?.scan?.complete===false && modelPeriod===state.period && frames().some(f=>f.rows.length) && !next.frames.some(f=>f.rows.length))return;
  if(state.tab==='flow')flowHistory=next;else rotation=next;
  const list=frames();
  state.frame=atLatest?Math.max(0,list.length-1):Math.max(0,Math.min(list.length-1,list.findIndex(f=>f.ts===oldTime)>=0?list.findIndex(f=>f.ts===oldTime):Math.floor(state.frame)));
  const all=list.flatMap(f=>f.rows);domain={x:state.tab==='flow'?100:Math.max(.1,...all.map(r=>Math.abs(r.x)))*1.12,y:Math.max(.1,...all.map(r=>Math.abs(r.y)))*1.12};
  modelSource=source;modelPeriod=state.period;paintedFrame=null;
 }
 function renderRotation(){researchModel();mountResearch();if(!frames().length){q('[data-slot="rotation-coverage"]').textContent='缺少相鄰期別的完整資料';q('[data-slot="rotation-time"]').textContent='';q('[data-action="play"]').disabled=true;plot.update([]);return;}paintRotation();}
 function renderFlow(){renderRotation();}
 function renderHeatmap(){const rows=heatmapRows(market,state.heatPeriod).filter(r=>(!state.sector||r.sectorId===state.sector)&&(!state.search||r.base.includes(state.search)));
  if(q('.cfx-content').dataset.mode!=='heatmap'||!otherPlot){cleanup();q('.cfx-content').dataset.mode='heatmap';q('.cfx-content').innerHTML=`${toolbar(state.heatPeriod,true)}<div class="cfx-chart-meta"><span data-slot="heat-coverage"></span><span>負值 ← 顏色 → 正值</span></div><div class="cfx-heatmap"><canvas role="img" aria-label="加密市場熱力圖，可雙指縮放、滑鼠滾輪縮放與拖曳，面積依選定權重，顏色依漲跌幅"></canvas><div class="cfx-zoom"><button data-action="heat-out" aria-label="縮小熱力圖">−</button><button data-action="heat-reset" aria-label="重設熱力圖">${icon('reset')}</button><button data-action="heat-in" aria-label="放大熱力圖">＋</button></div></div><div class="cfx-heat-list"></div>`;otherPlot=createToolChart(q('canvas'),{signal:life.signal,onSelect:openAsset});if(viewport)otherPlot.restoreViewport(viewport);}
  q('[data-slot="heat-coverage"]').textContent=`${rows.length} 幣 · ${state.heatPeriod.toUpperCase()} · ${state.weight==='equal'?'等大':state.weight==='cap'?'市值面積':'成交額面積'}`;
  q('.cfx-heat-list').innerHTML=rows.map(r=>`<button data-asset="${r.symbol}"><b>${r.base}</b><span class="${color(r.returnPct)}">${pct(r.returnPct)}</span></button>`).join('');
  otherPlot.update({type:'heatmap',rows,weight:state.weight,grouped:state.grouped});status(`Bitget 行情${market.kind==='foreground-refresh'?'更新':'快照'}${state.weight==='cap'?' · 市值：CoinGecko 各幣時間見說明':''} · 觀察池`,rows[0]?.end);
 }
 function showFlowDetail(symbol){const r=sourceFrame()?.rows.find(r=>r.symbol===symbol);if(!r)return;q('[data-slot="asset-title"]').textContent=r.base;q('[data-slot="asset"]').innerHTML=`<span style="color:${r.state.color}">${r.state.name}</span><dl class="cfx-detail-metrics"><div><dt>主動買賣占比</dt><dd>${pct(r.x)}</dd></div><div><dt>占比變化</dt><dd>${pp(r.y)}</dd></div><div><dt>主動買量 · ${r.base}</dt><dd>${compact(r.buy)}</dd></div><div><dt>主動賣量 · ${r.base}</dt><dd>${compact(r.sell)}</dd></div></dl><button class="cfx-watch" data-watch="${r.symbol}" aria-pressed="${watched.has(r.symbol)}">${watched.has(r.symbol)?'★ 已加入自選':'☆ 加入自選'}</button><div class="cfx-balance"><i style="width:${(r.x+100)/2}%"></i></div>`;q('.cfx-asset-dialog').showModal();}
 function render(){renderSettings();q('.cfx-source-badge').textContent='BITGET · USDT 永續';qa('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===state.tab)));q('.cfx').classList.toggle('focused',state.focus);q('[data-slot="exit-label"]').textContent=state.focus?'退出全螢幕':'全螢幕';if(state.tab==='flow'?!flowSnapshot:!market){cleanup();q('.cfx-content').dataset.mode='';q('.cfx-content').innerHTML=empty(window.OXLoading?.markup('讀取市場資料')||'讀取市場資料…');return;}const completeMarket=market;if(partialMarket&&state.tab!=='flow')market=partialMarket;switch(state.tab){case'rotation':renderRotation();break;case'heatmap':renderHeatmap();break;case'flow':renderFlow();break;default:renderRotation();}market=completeMarket;const coverage=state.tab==='flow'?partialFlow?.scan:partialMarket?.scan;if(coverage)notice(`部分結果 ${coverage.done}/${coverage.total}，其餘標的仍在更新…`);else if(!request&&!marketRequest)notice('');q('.cfx').dataset.scanState=coverage?'partial':(state.tab==='flow'?pressureSnapshot()?.scan?.complete:market?.scan?.complete)?'complete':'snapshot';maybeRefreshMarket();}
 function help(){q('[data-slot="help"]').innerHTML=`<details open><summary>板塊輪動如何閱讀</summary><p>橫軸＝成分幣等權平均報酬 − BTC 同期報酬，單位 pp。縱軸＝本期相對報酬 − 上一期相對報酬。右上為領先擴大、右下為領先降溫、左上為落後改善、左下為落後擴大。</p><p>軌跡連接同一板塊的真實歷史期別；回放使用目前固定觀察池，不代表當時全市場的可投資範圍。每個板塊至少兩個成分幣，且回放所需 K 線完整才納入。</p><p>成交占比＝板塊本期成交額／所有納入板塊本期成交額。占比上升只代表本觀察池的交易活躍度提高，不證明資金從另一板塊轉入。泡泡面積依本期成交額；可切等大。</p></details><details><summary>板塊分類與涵蓋範圍</summary>${market?.sectors.map(s=>`<p><b>${escape(s.name)}</b>：已驗證 ${s.members.length}/${s.requestedBases.length} · ${s.members.map(m=>escape(m.replace(/USDT$/,''))).join('、')||'目前沒有可驗證合約與行情'}<br><small>候選：${s.requestedBases.map(escape).join('、')}</small></p>`).join('')||''}<p>24 組 OX 觀察清單允許一個幣重複屬於不同板塊。成分需通過 Bitget 加密 USDT 永續合約、上線狀態與成交行情驗證，且 K 線完整才計入計算。清單不是交易所官方板塊指數；BTC 也是 BTC／PoW 的候選，圖表的相對報酬仍以 BTC 為基準。部分板塊因無合約或資料不足不會產生泡泡。成交占比對重疊成分會按板塊各自計算，不能解讀為全市場去重後資金流向。</p></details><details><summary>主動買賣與回放</summary><p>横軸＝100 ×（主動買量 − 主動賣量）／兩者總量；縱軸＝相較上一個完整期別的占比變化。這是買賣力道占比，單位為百分比／百分點，不是資金淨流入金額。主動買賣使用經 Bitget 合約資料驗證的成交額前 20 個加密 USDT 永續合約。</p><p>回放只使用相鄰、已結束的真實期別；泡泡的位置、大小、顏色連續過渡，標示與排行使用該期原始數值。全部與成交前 10 只改變顯示，完整更新範圍不變；缺資料的標的不補零。</p></details><details><summary>Footprint／CVD／Volume Profile</summary><p>使用 Bitget fills-history 的真實逐筆成交，依 tradeId 去重。Ask＝主動買、Bid＝主動賣；Delta＝Ask−Bid。價格依設定分桶，時間為 1 分鐘。首尾 K 線標為不完整。完整性僅限取得的 REST 頁面，不宣稱交易所全量歷史。</p><p>CVD 自已載入首筆交易歸零。Volume Profile 加總同價位已載入成交。POC 為最大量價位。斜向不平衡條件：Ask(k) ≥ 3 × Bid(k−1) 或 Bid(k) ≥ 3 × Ask(k＋1)，並達到該根 1% 成交量；分母為零不計比率。門檻只是標記規則，不是買賣訊號。</p></details>`;q('.cfx-dialog').showModal();}
 async function refreshPressure(){if(request||suspended||document.hidden)return;lastPressureAttempt=Date.now();const period=state.period;request=new AbortController();const loading=window.OXLoading?.begin('crypto','更新主動成交標的',{signal:request.signal,views:['strength'],target:q('[data-slot="loading"]')});notice('依序取得 Bitget 主動成交資料…');try{const next=await flowRefresh.refresh({period},{signal:request.signal,onPartial:next=>{if(life.signal.aborted||suspended||request?.signal.aborted||state.period!==period)return;partialFlow=next;if(next.scan.done===1||next.scan.done%3===0)render();},onProgress:(n,total)=>{loading?.update(n,total);notice(`更新 ${n}/${total} 個標的…`);}});if(!buildFlow(next,period).rows.length)throw new Error('沒有可用共同期別');if(life.signal.aborted||suspended||request?.signal.aborted||state.period!==period)return;pressureSnapshots.set(period,next);latestFlows.set(period,next);partialFlow=null;if(state.tab==='flow'&&state.period===period)render();}catch(e){if(e.name!=='AbortError'&&!life.signal.aborted){partialFlow=null;render();notice('主動成交更新失敗，保留有時間戳的原資料；可按更新重試。');}}finally{const cancelled=request?.signal.aborted;request=null;loading?.finish();if(cancelled&&!suspended&&!document.hidden&&!life.signal.aborted)queueMicrotask(maybeRefreshMarket);}}
 function changeTab(tab){cleanup();modelSource=null;modelPeriod=null;state.tab=tab;state.search='';state.selected='';state.filter='';if(tab==='flow'&&state.period==='24h')state.period='1h';render();}
 shadow.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;const d=b.dataset;
  if(d.tab){changeTab(d.tab);return;}if(d.period){if(state.tab==='heatmap')state.heatPeriod=d.period;else state.period=d.period;state.frame=7;state.selected='';render();return;}
  if(d.state){state.filter=state.filter===d.state?'':d.state;paintRotation();return;}if(d.sector){state.selected=d.sector;paintRotation();return;}
  if(d.asset){openAsset(d.asset);return;}if(d.flowDetail){showFlowDetail(d.flowDetail);return;}
  if(d.heatSector!==undefined){state.sector=d.heatSector;render();return;}
  if(d.watch){watched.has(d.watch)?watched.delete(d.watch):watched.add(d.watch);b.setAttribute('aria-pressed',String(watched.has(d.watch)));b.textContent=watched.has(d.watch)?'★':'☆';try{localStorage.setItem(watchKey,JSON.stringify([...watched]));}catch{}paintRotation();return;}
  if(d.frameTime){stopReplay();state.frame=rotation.frames.findIndex(f=>f.ts===Number(d.frameTime));paintRotation();return;}
  switch(d.action){case'retry-data':void loadData();break;case'settings':renderSettings();q('.cfx-settings-dialog').showModal();break;case'close-settings':q('.cfx-settings-dialog').close();break;case'exit':onExit();break;case'help':q('.cfx-settings-dialog').close();help();break;case'close-help':q('.cfx-dialog').close();break;case'close-asset':q('.cfx-asset-dialog').close();break;case'close-sector':state.selected='';paintRotation();break;case'fullscreen':state.focus=!state.focus;q('.cfx').classList.toggle('focused',state.focus);q('[data-slot="exit-label"]').textContent=state.focus?'退出全螢幕':'全螢幕';plot?.setInteractive(true);break;
   case'scope-all':state.watch=false;paintRotation();break;case'scope-watch':state.watch=true;paintRotation();break;
   case'view-bubbles':state.table=false;paintRotation();break;case'view-rank':state.table=true;paintRotation();break;
   case'density-all':state.density='all';paintRotation();break;case'density-top':state.density='top';paintRotation();break;
   case'picker':renderPicker();q('.cfx-picker-dialog').showModal();break;case'close-picker':q('.cfx-picker-dialog').close();break;
   case'select-all':state.selectedIds=null;renderPicker();paintRotation();break;case'select-none':state.selectedIds=[];renderPicker();paintRotation();break;
   case'replay-toggle':stopReplay();state.replayOpen=!state.replayOpen;if(!state.replayOpen){state.frame=frames().length-1;researchModel();}else state.frame=0;paintRotation();if(state.replayOpen)startReplay();break;
   case'watch-only':state.watch=!state.watch;paintRotation();renderSettings();break;case'toggle-table':state.table=!state.table;paintRotation();renderSettings();break;
   case'trails':state.trails=!state.trails;b.setAttribute('aria-pressed',state.trails);paintRotation();break;case'equal-size':state.equal=!state.equal;b.setAttribute('aria-pressed',state.equal);paintRotation();break;
   case'group':state.grouped=!state.grouped;render();break;case'heat-in':otherPlot?.zoom(1.3);break;case'heat-out':otherPlot?.zoom(1/1.3);break;case'heat-reset':otherPlot?.reset();break;
   case'zoom-in':plot?.zoom(.5);break;case'zoom-out':plot?.zoom(-.5);break;case'reset':plot?.reset();break;
   case'latest':stopReplay();state.frame=frames().length-1;paintRotation();break;
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
   case'period':stopReplay();if(state.tab==='heatmap')state.heatPeriod=e.target.value;else{state.period=e.target.value;request?.abort();partialFlow=null;lastPressureAttempt=0;modelSource=null;state.frame=7;}state.selected='';break;
   case'replay-speed':state.replaySpeed=Number(e.target.value);replay?.setSpeed(state.replaySpeed);return;
   case'heat-sector':state.sector=e.target.value;break;case'sort':state.sort=e.target.value;paintRotation();return;case'weight':state.weight=e.target.value;break;default:return;
  }render();
 },{signal:life.signal});
 function closeInner(){if(q('.cfx-picker-dialog').open){q('.cfx-picker-dialog').close();return true;}if(q('.cfx-settings-dialog').open){q('.cfx-settings-dialog').close();return true;}if(q('.cfx-dialog').open){q('.cfx-dialog').close();return true;}if(q('.cfx-asset-dialog').open){q('.cfx-asset-dialog').close();return true;}if(state.selected){state.selected='';if(state.tab==='rotation')paintRotation();return true;}if(state.focus){state.focus=false;q('.cfx').classList.remove('focused');q('[data-slot="exit-label"]').textContent='全螢幕';plot?.setInteractive(true);return true;}return false;}
 shadow.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!closeInner())onExit();}},{signal:life.signal});
  let dataPending=false;
 async function loadData(){if(dataPending||life.signal.aborted)return;dataPending=true;render();try{const values=await Promise.all([market||state.tab==='flow'?Promise.resolve(market):loadCached(marketURL,'market'),flowSnapshot||state.tab!=='flow'?Promise.resolve(flowSnapshot):loadCached(snapshotURL,'flow')]);if(life.signal.aborted)return;[market,flowSnapshot]=values;if(!suspended)render();}catch(e){if(!life.signal.aborted){q('.cfx-content').innerHTML=empty('資料暫時無法取得')+'<button class="cfx-button" data-action="retry-data">重試</button>';notice('');}}finally{dataPending=false;}}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){stopReplay();request?.abort();marketRequest?.abort();lastMarketAttempt=lastPressureAttempt=0;}else if(!suspended)maybeRefreshMarket();},{signal:life.signal});
 window.addEventListener('online',()=>{lastMarketAttempt=lastPressureAttempt=0;if(!suspended){if(state.tab==='flow'?!flowSnapshot:!market)void loadData();else maybeRefreshMarket();}},{signal:life.signal});
 render();if(autoRefresh)marketTimer=setInterval(()=>{if(!life.signal.aborted)maybeRefreshMarket();},60000);if(state.tab==='flow'?!flowSnapshot:!market)void loadData();
 return {closeInner,getState:()=>({state:{...state},viewport:otherPlot?.getViewport?.()||plot?.getViewport?.()||viewport}),suspend(){suspended=true;plot?.setActive?.(false);lastMarketAttempt=lastPressureAttempt=0;stopReplay();request?.abort();marketRequest?.abort();for(const d of qa('dialog'))d.close();},resume(){suspended=false;plot?.setActive?.(true);if(!plot&&!otherPlot||partialMarket||partialFlow)render();else maybeRefreshMarket();},destroy(){life.abort();request?.abort();marketRequest?.abort();clearInterval(marketTimer);cleanup();q('.cfx-settings-dialog')?.close();q('.cfx-dialog')?.close();q('.cfx-asset-dialog')?.close();shadow.innerHTML='';}};
}
