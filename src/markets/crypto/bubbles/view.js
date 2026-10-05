import { METRICS, bubbleRows, metricText, largeTradeFlow } from './model.js?v=20261001-bubbles3';
import { fetchCaps, fetchQuotes, fetchLargeTrades, pause } from './source.js?v=20261001-bubbles3';
import { BubbleField } from './field.js?v=20261002-finance4';
import { revealStyledShadow } from '../../../components/style-ready.js?v=20261005-stable18';
const css=new URL('./bubbles.css?v=20261005-weeklist4',import.meta.url);
const DIRECTIONS=[['both','多空'],['long','看多'],['short','看空']];
const icon=(name)=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${{both:'M8 19V5m-4 4 4-4 4 4M16 5v14m-4-4 4 4 4-4',long:'M12 20V4m-6 6 6-6 6 6',short:'M12 4v16m-6-6 6 6 6-6',close:'m6 6 12 12M18 6 6 18',reset:'M3 4v6h6M4 10a8 8 0 1 1 1 8',cycle:'m7 8 3-3 3 3M10 5v9m7 2-3 3-3-3m3 3V10',filter:'M4 5h16l-6 7v6l-4 2v-8Z',chevron:'m7 9 5 5 5-5',check:'m5 12 4 4L19 6'}[name]||''}"/></svg>`;
const directionIcon=(direction)=>icon(direction==='long'?'long':direction==='short'?'short':'both');
const runtime=()=>typeof state!=='undefined'&&state.activeMarket==='crypto'?state:null;
export function mountBubbles(host,{adapter=null,quotes=null,caps:initialCaps=null,analyses=null,onOpenRadar=symbol=>window.switchSymbol?.(symbol)}={}) {
  const shadow=host.shadowRoot||host.attachShadow({mode:'open'}),life=new AbortController();
  const metrics=adapter?.metrics||METRICS,format=adapter?.format||metricText,asset=adapter?'股票':'幣種';
  let metric='change',limit=50,scope='all',direction='both',caps=initialCaps||[],localQuotes=quotes||[],rows=[],selected=null,capError='',quoteError='',flowRequest=null,quoteRequest=false,capPending=false,capAttempt=0;
  const flows=new Map(),assetButtons=new Map();
  shadow.innerHTML=`<link rel="stylesheet" href="${css}"><div class="oxb-shell" data-style-pending="true" inert style="visibility:hidden!important"><section class="oxb cfx"><div class="oxb-controls"><button class="oxb-scope" data-action="scope" data-scope="all" aria-label="${asset}範圍：全部，點擊切換自選" aria-pressed="false"><span>全部</span>${icon('cycle')}</button><div class="oxb-metric"><button class="oxb-metric-toggle" data-action="metric-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="oxb-metric-menu" aria-label="選擇泡泡篩選條件，目前漲幅">${icon('filter')}<span data-slot="metric-label">漲幅</span>${icon('chevron')}</button><div class="oxb-menu" id="oxb-metric-menu" role="menu" aria-label="泡泡篩選條件" hidden>${metrics.map(([id,label])=>`<button role="menuitemradio" data-bubble-metric="${id}" aria-checked="${id===metric}" tabindex="${id===metric?0:-1}"><span>${label}</span>${icon('check')}</button>`).join('')}</div></div><span class="oxb-loading" hidden></span><button class="oxb-direction" data-action="direction" data-direction="both" aria-label="多空篩選：多空，點擊切換看多"><span class="direction-toggle-icon" aria-hidden="true">${directionIcon('both')}</span></button></div><div class="oxb-stage"><canvas tabindex="0" aria-label="動態${adapter?.marketLabel||(adapter?'台股':'加密')}泡泡圖"></canvas><div class="oxb-empty" role="status">正在讀取即時行情…</div><div class="oxb-zoom"><select aria-label="泡泡數量"><option value="30">前 30</option><option value="50" selected>前 50</option><option value="100">前 100</option></select><button data-action="reset" aria-label="重設泡泡視野">${icon('reset')}</button><button data-action="out" aria-label="縮小泡泡圖">−</button><button data-action="in" aria-label="放大泡泡圖">＋</button></div></div><dialog class="oxb-dialog" aria-label="泡泡${asset}詳情"><header><strong data-slot="asset"></strong><button data-action="close-asset" aria-label="關閉${asset}詳情">${icon('close')}</button></header><div data-slot="detail"></div><button class="oxb-radar" data-action="radar">查看雷達 K 線 ↗</button></dialog></section><section class="oxb-assets" aria-label="泡泡${asset}列表"><div class="oxb-asset-grid"></div><p class="oxb-assets-empty" hidden>目前沒有符合條件的${asset}</p></section></div>`;
  revealStyledShadow(shadow,life.signal,'.oxb-shell');
  const q=s=>shadow.querySelector(s);
  const field=new BubbleField(q('canvas'),{onSelect:openAsset,formatMetric:format,metricNames:Object.fromEntries(metrics),assetName:asset,palette:adapter?.palette,radiusForRows:adapter?.radiusForRows,logo:base=>{if(adapter)return null;const paths=typeof OX_COIN_LOGOS!=='undefined'?OX_COIN_LOGOS:{};return paths[base.toLowerCase()]?new URL(paths[base.toLowerCase()],document.baseURI).href:null;}});
  function pool(){if(adapter)return [];const rt=runtime();const live=rt?.tickers||[];const liveTime=Math.max(0,...live.map(t=>Number(t.ts)||0)),localTime=Math.max(0,...localQuotes.map(t=>Number(t.ts)||0));return localTime>liveTime?localQuotes:live.length?live:localQuotes;}
  function watching(){if(adapter)return adapter.watching();try{return new Set((typeof getWatchlistRecords==='function'?getWatchlistRecords():[]).map(r=>r.symbol));}catch{return new Set();}}
  function paint(){if(life.signal.aborted)return;const tickers=pool(),rt=runtime();rows=adapter?adapter.rows({metric,limit,direction,watch:scope==='watch'?watching():null}):bubbleRows(tickers,{metric,limit,caps,flows,direction,watch:scope==='watch'?watching():null,analyses:analyses||rt?.analyzedCache||new Map()});field.setRows(rows,metric);
    q('.oxb-empty').hidden=rows.length>0;
    if(adapter){adapter.empty(q('.oxb-empty'),{metric,direction,scope});}
    else {let emptyText=scope==='watch'&&!watching().size?'先在雷達收藏幣種，這裡會顯示你的自選':metric==='cap'?capError||(caps.length?'目前沒有可確認的新鮮市值資料':'正在讀取市值…'):metric==='flow'?flowRequest?'正在讀取大單成交…':'目前沒有可驗證的大單取樣，稍後自動重試':metric==='score'?'雷達正在分析 OX 評分…':quoteError||'正在讀取即時行情…';

    if(!rows.length&&direction!=='both'&&bubbleRows(tickers,{metric,limit,caps,flows,watch:scope==='watch'?watching():null,analyses:analyses||rt?.analyzedCache||new Map()}).length)emptyText=`目前沒有符合${DIRECTIONS.find(d=>d[0]===direction)[1]}條件的幣種`;
    if(!rows.length&&(quoteRequest||capPending&&metric==='cap'||flowRequest&&metric==='flow')&&window.OXLoading)OXLoading.render(q('.oxb-empty'),emptyText);else if(q('.oxb-empty').textContent!==emptyText)q('.oxb-empty').textContent=emptyText;
    }
    q('canvas').dataset.direction=direction;
    renderList();if(selected)updateDetail();
  }
  function renderList(){
    const grid=q('.oxb-asset-grid'),seen=new Set();
    rows.forEach((r,i)=>{let button=assetButtons.get(r.symbol);if(!button){button=document.createElement('button');button.dataset.asset=r.symbol;button.innerHTML='<span></span><b></b>';assetButtons.set(r.symbol,button);}
      const label=format(r.value,metric),base=button.querySelector('span'),value=button.querySelector('b');const title=adapter?.displayName?adapter.displayName(r):adapter?`${r.symbol} ${r.base}`:r.base;if(base.textContent!==title)base.textContent=title;if(value.textContent!==label)value.textContent=label;
      const sign=r.sign??(metric==='flow'?r.value:r.change);button.classList.toggle('up',sign>0);button.classList.toggle('down',sign<0);button.setAttribute('aria-label',`${r.base}，${metrics.find(m=>m[0]===metric)[1]} ${label}，查看${asset}詳情`);
      if(grid.children[i]!==button)grid.insertBefore(button,grid.children[i]||null);seen.add(r.symbol);
    });
    for(const [symbol,button] of assetButtons)if(!seen.has(symbol)){button.remove();assetButtons.delete(symbol);}
    q('.oxb-assets-empty').hidden=rows.length>0;
  }
  function focusMenu(index){const buttons=[...q('.oxb-menu').querySelectorAll('button')],target=buttons[(index+buttons.length)%buttons.length];buttons.forEach(b=>b.tabIndex=b===target?0:-1);target.focus({preventScroll:true});}
  function setMenu(open,restore=false){const menu=q('.oxb-menu'),button=q('[data-action="metric-menu"]');menu.hidden=!open;button.setAttribute('aria-expanded',open);if(open)focusMenu(metrics.findIndex(m=>m[0]===metric));else if(restore)button.focus({preventScroll:true});}
  function selectMetric(id){if(!metrics.some(m=>m[0]===id))return;metric=id;q('[data-slot="metric-label"]').textContent=metrics.find(m=>m[0]===id)[1];q('[data-action="metric-menu"]').setAttribute('aria-label',`選擇泡泡篩選條件，目前${metrics.find(m=>m[0]===id)[1]}`);shadow.querySelectorAll('[data-bubble-metric]').forEach(b=>b.setAttribute('aria-checked',b.dataset.bubbleMetric===id));setMenu(false,true);refreshSelection();if(!adapter&&id==='cap')loadCaps();}
  function openAsset(r){selected=r.symbol;field.selected=r.symbol;updateDetail();q('.oxb-dialog').showModal();}
  function updateDetail(){const r=rows.find(r=>r.symbol===selected);if(!r)return;q('[data-slot="asset"]').textContent=adapter?.displayName?adapter.displayName(r):adapter?`${r.symbol} ${r.base}`:r.base;if(adapter){q('[data-slot="detail"]').innerHTML=adapter.detail(r);return;}
    q('[data-slot="detail"]').innerHTML=`<strong class="oxb-price">${r.price.toLocaleString('en-US',{maximumFractionDigits:r.price<1?8:4})}<small> USDT</small></strong><dl><div><dt>24H 漲幅</dt><dd class="${r.change>=0?'up':'down'}">${metricText(r.change,'change')}</dd></div><div><dt>24H 成交額</dt><dd>${metricText(r.volume,'volume')} USDT</dd></div><div><dt>流通市值</dt><dd>${metricText(r.cap,'cap')}</dd></div><div><dt>OX 評分</dt><dd>${metricText(r.score,'score')}</dd></div>${r.flow?`<div><dt>大單淨主買</dt><dd>${metricText(r.flow.value,'flow')} USDT</dd></div><div><dt>取樣大單</dt><dd>${r.flow.count} 筆／${r.flow.trades} 筆成交</dd></div>`:''}</dl>${r.capTime?`<small class="oxb-note">市值更新 ${new Date(r.capTime).toLocaleString('zh-TW',{hour12:false})}</small>`:''}${r.flow?'<small class="oxb-note">僅最新成交取樣，非完整 5 分鐘或入金統計</small>':''}`;
  }
  async function loadQuotes(){if(adapter)return;if(quoteRequest||life.signal.aborted||document.hidden||quotes)return;const latest=Math.max(0,...pool().map(t=>Number(t.ts)||0));if(Date.now()-latest<25000)return;quoteRequest=true;const loading=window.OXLoading?.begin('crypto','加密行情載入中',{signal:life.signal,views:['strength'],target:q('.oxb-loading')});paint();try{localQuotes=await fetchQuotes(life.signal);quoteError='';paint();if(metric==='flow')loadFlows();}catch(e){if(e.name!=='AbortError'){quoteError='行情暫時無法更新，稍後自動重試';paint();}}finally{quoteRequest=false;loading?.finish();paint();}}
  async function loadCaps(){if(adapter)return;if(capPending||life.signal.aborted||document.hidden||initialCaps)return;if(Date.now()-capAttempt<60000&&capError)return;capPending=true;capAttempt=Date.now();const loading=window.OXLoading?.begin('crypto','市值資料載入中',{signal:life.signal,views:['strength'],target:q('.oxb-loading')});paint();try{caps=await fetchCaps(life.signal);capError='';paint();}catch(e){if(e.name!=='AbortError'){capError='市值來源暫時無法更新，稍後自動重試';paint();}}finally{capPending=false;loading?.finish();paint();}}
  async function loadFlows(){if(adapter)return;if(metric!=='flow'||flowRequest||life.signal.aborted||document.hidden)return;
    const candidates=bubbleRows(pool(),{metric:'volume',limit,watch:scope==='watch'?watching():null});
    const pending=candidates.filter(r=>Date.now()-(flows.get(r.symbol)?.at||0)>30000);if(!pending.length)return;
    const request=new AbortController();flowRequest=request;let done=0;const loading=window.OXLoading?.begin('crypto','載入大單幣種',{done:0,total:pending.length,signal:request.signal,views:['strength'],target:q('.oxb-loading')});const abort=()=>request.abort();life.signal.addEventListener('abort',abort,{once:true});paint();
    let next=0;
    async function worker(){while(next<pending.length&&!request.signal.aborted){const r=pending[next++];try{const result=await fetchLargeTrades(r.symbol,request.signal),flow=largeTradeFlow(result.records,result.time);if(flow&&!request.signal.aborted)flows.set(r.symbol,{...flow,at:Date.now()});}catch(e){if(e.name==='AbortError')break;}if(request.signal.aborted)break;loading?.update(++done,pending.length);paint();await pause(300,request.signal);}}
    try{await Promise.all(Array.from({length:Math.min(4,pending.length)},worker));}
    catch(e){if(e.name!=='AbortError')console.warn('[OX Bubbles]',e.message);}
    finally{loading?.finish();life.signal.removeEventListener('abort',abort);if(flowRequest===request){flowRequest=null;paint();}}
  }
  function closeInner(){const dialog=q('.oxb-dialog');if(dialog.open){dialog.close();selected=null;return true;}if(!q('.oxb-menu').hidden){setMenu(false,true);return true;}return false;}
  function refreshSelection(){selected=null;field.selected=null;flowRequest?.abort();flowRequest=null;paint();loadFlows();}
  shadow.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
    if(d.bubbleMetric){selectMetric(d.bubbleMetric);return;}
    if(d.action==='metric-menu'){setMenu(q('.oxb-menu').hidden);return;}
    if(d.action==='scope'){scope=scope==='all'?'watch':'all';b.dataset.scope=scope;b.querySelector('span').textContent=scope==='all'?'全部':'自選';b.setAttribute('aria-pressed',scope==='watch');b.setAttribute('aria-label',`${asset}範圍：${scope==='all'?'全部，點擊切換自選':'自選，點擊切換全部'}`);refreshSelection();return;}
    if(d.action==='direction'){const i=(DIRECTIONS.findIndex(row=>row[0]===direction)+1)%DIRECTIONS.length;direction=DIRECTIONS[i][0];b.dataset.direction=direction;b.querySelector('.direction-toggle-icon').innerHTML=directionIcon(direction);b.setAttribute('aria-label',`多空篩選：${DIRECTIONS[i][1]}，點擊切換${DIRECTIONS[(i+1)%DIRECTIONS.length][1]}`);refreshSelection();return;}
    if(d.asset){const r=rows.find(r=>r.symbol===d.asset);if(r)openAsset(r);return;}
    switch(d.action){case'close-asset':closeInner();break;
      case'reset':field.reset();adapter?.refresh?.();loadQuotes();if(metric==='cap'){capAttempt=0;loadCaps();}loadFlows();break;case'in':field.setZoom(field.zoom*1.2);break;case'out':field.setZoom(field.zoom/1.2);break;
      case'radar':{const symbol=selected;closeInner();onOpenRadar(symbol);break;}
    }
  },{signal:life.signal});
  q('select').addEventListener('change',e=>{limit=Number(e.target.value);flowRequest?.abort();flowRequest=null;paint();loadFlows();},{signal:life.signal});
  shadow.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&closeInner()){e.preventDefault();e.stopPropagation();return;}
    if(e.target.closest('[data-action="metric-menu"]')&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setMenu(true);return;}
    if(e.target.closest('.oxb-menu')&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=[...q('.oxb-menu').querySelectorAll('button')],i=buttons.indexOf(e.target.closest('button'));focusMenu(e.key==='Home'?0:e.key==='End'?buttons.length-1:i+(e.key==='ArrowDown'?1:-1));return;}
    if(e.target.matches('canvas')&&['+','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0')field.reset();else field.setZoom(field.zoom*(e.key==='+'?1.2:1/1.2));}
  },{signal:life.signal});
  const outside=e=>{if(!q('.oxb-menu').hidden&&!e.composedPath().includes(q('.oxb-metric')))setMenu(false);};
  document.addEventListener('pointerdown',outside,{signal:life.signal});document.addEventListener('focusin',outside,{signal:life.signal});
  q('.oxb-dialog').addEventListener('close',()=>{selected=null;},{signal:life.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flowRequest?.abort();else{paint();loadQuotes();loadFlows();}},{signal:life.signal});
  const stopAdapter=adapter?.start({onChange:paint,signal:life.signal,target:q('.oxb-loading')});
  const paintTimer=setInterval(()=>{if(!document.hidden)paint();},2000),quoteTimer=adapter?null:setInterval(loadQuotes,15000),flowTimer=adapter?null:setInterval(loadFlows,30000),capsTimer=adapter?null:setInterval(loadCaps,300000);
  paint();if(!adapter){loadQuotes();loadCaps();}
  return {closeInner,refresh:paint,destroy(){life.abort();stopAdapter?.();flowRequest?.abort();clearInterval(paintTimer);clearInterval(quoteTimer);clearInterval(flowTimer);clearInterval(capsTimer);field.destroy();assetButtons.clear();for(const d of shadow.querySelectorAll('dialog'))d.close();shadow.innerHTML='';}};
}

// Preserve the crypto entry point while Taiwan supplies its official-data adapter.
export const mountCryptoBubbles=mountBubbles;
