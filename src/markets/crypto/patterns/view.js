import { PATTERNS, patternById, TIMEFRAMES as CRYPTO_TIMEFRAMES } from './catalog.js?v=patterns5d-20260929';
import { revealStyledShadow } from '../../../components/style-ready.js?v=20261005-stable18';
import { queryFromStrokes, normalize, sortMatches, patternCounts, prepareCandles, indexPrepared, matchPrepared, rankPatternMatches, browsePatternEntries, classificationCurrent } from './matcher.js?v=20261002-rank8';
import * as cryptoSource from './source.js?v=20261002-rank8';
import * as cryptoCache from './index-cache.js?v=20261002-rank8';
import { candleChart } from './charts.js?v=20261005-graytop5';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={down:'<path d="m6 9 6 6 6-6"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',undo:'<path d="m9 5-5 5 5 5M4 10h10a5 5 0 1 1 0 10"/>',refresh:'<path d="M4 4v6h6M4 10a8 8 0 1 1 1 8"/>',scan:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12 18 6"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||''}</svg>`;
const volume=n=>!Number.isFinite(n)?'—':n>=1e8?(n/1e8).toFixed(2)+'億':n>=1e4?(n/1e4).toFixed(1)+'萬':n.toFixed(0);
const signed=n=>Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(2)}%`:'—';
const stamp=ms=>new Date(ms).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false});
const preferencesByMarket=new Map();
const sessionsByMarket=new Map();
export function storePatternSession(cache,market,sessionKey,value){
  if(sessionKey===market){cache.set(market,value);return;}
  // A personal-file replacement or new snapshot has a distinct access scope.
  // Retain only the two most recent scoped sessions; large raw-candle sets
  // must not accumulate with every refresh on a phone. Legacy market keys
  // used by Crypto and Taiwan retain their existing lifecycle unchanged.
  cache.delete(sessionKey);
  cache.set(sessionKey,{...value,sessionMarket:market});
  const scoped=[...cache].filter(([key,session])=>key!==market&&session.sessionMarket===market);
  for(const [key] of scoped.slice(0,-2))cache.delete(key);
}
// Warm real observations without mounting a hidden UI or competing with live charts.
let warmController=null,warmTask=null,warmAt=0;
export function stopPatternPreload(){warmController?.abort();}
export function preloadPatternSearch(){
  if(warmTask)return warmTask;
  if(document.hidden||document.body.dataset.market!=='crypto'||!window.OXFeatures?.canPreload?.('crypto.patterns')||Date.now()-warmAt<60000)return Promise.resolve();
  let worker;try{worker=new Worker(new URL('../../../generated/pattern-worker.js?v=20261005-first24',import.meta.url),{type:'module'});}catch{return Promise.resolve();}
  const controller=warmController=new AbortController(),signal=controller.signal;
  let serial=0,pending=new Map();
  const rejectAll=error=>{for(const job of pending.values())job.reject(error);pending.clear();};
  worker.onmessage=({data})=>{const job=pending.get(data.id);pending.delete(data.id);if(job)data.error?job.reject(Error(data.error)):job.resolve(data.result);};
  worker.onerror=()=>{rejectAll(Error('型態預載計算失敗'));controller.abort();};
  signal.addEventListener('abort',()=>{rejectAll(new DOMException('Aborted','AbortError'));worker.terminate();},{once:true});
  const transport={owner:'patterns-preload',priority:-10};
  warmTask=(async()=>{try{
    const pool=await cryptoSource.fetchUniverse(signal,80,transport);
    await cryptoSource.scanUniverse(pool,['4H','1H'],{signal,concurrency:1,transport,onProgress:()=>{},onSeries:async data=>{
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      const indexed=await new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{controller.abort();},8000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});worker.postMessage({type:'index',id,key:data.symbol+':'+data.frame,candles:data.candles});});
      if(!signal.aborted)await cryptoCache.saveIndex({...data,classic:indexed.classic},indexed.matches);
    }});warmAt=Date.now();
  }catch(error){if(error.name!=='AbortError')warmAt=Date.now();}finally{worker.terminate();rejectAll(new DOMException('Aborted','AbortError'));if(warmController===controller)warmController=null;warmTask=null;}})();
  return warmTask;
}
export function mountPatternSearch(host,options={}){
  if(!options.source)stopPatternPreload();
  const source=options.source||cryptoSource,cache=options.cache||cryptoCache;
  const {fetchUniverse,scanUniverse,primeCandleCache,fetchSeries}=source;
  const {readIndex,saveIndex,pruneIndex,entryCurrent,INDEX_VERSION}=cache;
  const TIMEFRAMES=source.TIMEFRAMES||CRYPTO_TIMEFRAMES,market=source.id||'crypto',sessionKey=source.sessionKey||market;
  let saved=preferencesByMarket.get(market)||{frames:source.defaultFrames||['4H','1H'],limit:source.defaultLimit??0,query:null,strokes:[]};
  const sourceLabel=source.label||'Bitget',asset=source.asset||'幣種',currency=source.currency||'U',period=source.period||'24H';
  const displayName=source.displayName||((row)=>row.symbol.replace(/USDT$/,''));
  const turnoverLabel=source.turnoverLabel||`${period} 成交額`;
  const shadow=host.shadowRoot||host.attachShadow({mode:'open'}),life=new AbortController();
  let frames=[...saved.frames],limit=saved.limit,query=saved.query,strokes=structuredClone(saved.strokes),universe=null,controller=null,version=0,busy=false,lastScan=0,resumePending=false;
  let rows=new Map(),shown=24,tierFilter='all',progress={done:0,total:0,failed:0,coinsDone:0,coinsTotal:0},paintTimer=0,drawTimer=0,boardRAF=0,scanFinishTimer=0,lastSignature='',selectedRow=null,detailChart=null,detailController=null,detailVersion=0,detailFrame=null;
  let chartInstances=[],chartObserver=null,worker=null,workerFailed=false,workerId=0,jobs=new Map(),fallback=new Map();
  let glowEnded=0,moreObserver=null;const reducedMotion=matchMedia('(prefers-reduced-motion:reduce)').matches;
  let entries=new Map(),queryVersion=0,searchRunning=false,searchPending=false,disposed=false,lastError='',backgroundScan=false;
  const hydrated=new Set();
  const session=sessionsByMarket.get(sessionKey);
  if(session){entries=new Map(session.entries);rows=new Map(session.rows);universe=session.universe;lastScan=session.lastScan;progress={...session.progress};shown=session.shown;tierFilter=session.tierFilter;}
  let searchSignature=session?JSON.stringify([query,frames,limit]):'';
  shadow.innerHTML=`<link rel="stylesheet" href="${new URL('./patterns.css?v=20261005-first24',import.meta.url)}"><main class="px" data-style-pending="true" inert style="visibility:hidden!important"><section class="px-board" aria-label="型態畫板"><canvas tabindex="0" aria-label="在整個畫板由左向右畫走勢，完成後自動比對；亦可使用型態選單"></canvas><div class="px-controls"><button class="px-control" data-action="timeframes" aria-haspopup="dialog" aria-expanded="false"><span data-frame-label></span>${icon('down')}</button><button class="px-control" data-action="patterns" aria-haspopup="dialog" aria-expanded="false"><span data-pattern-label>型態</span>${icon('down')}</button></div><span class="px-hint">畫出走勢，或選擇型態</span><div class="px-board-bottom"><button class="px-mode-toggle" data-action="toggle-mode" hidden aria-label="切換搜尋模式" title="切換搜尋模式"><span class="px-mode-glyph" aria-hidden="true">⌁</span><span data-mode-label></span></button><button class="px-icon" data-action="undo" aria-label="清除上一筆" title="清除上一筆">${icon('undo')}</button><div class="px-tier-filters" role="group" aria-label="OX 品質分級"><button data-tier-filter="all" aria-pressed="true">全部</button><button data-tier-filter="1" aria-pressed="false">T1</button><button data-tier-filter="2" aria-pressed="false">T2</button><button data-tier-filter="3" aria-pressed="false">T3</button></div></div></section><button class="px-refresh-pill" data-action="refresh" aria-label="重新掃描" title="重新掃描"><svg class="px-pill-progress" viewBox="0 0 40 40" aria-hidden="true"><circle class="px-pill-track" cx="20" cy="20" r="17"/><circle class="px-pill-arc" cx="20" cy="20" r="17"/></svg><span class="px-refresh-glyph">${icon('scan')}</span></button><div class="px-results"><div class="px-status-row"><span class="px-local-loading" hidden></span><span class="px-status" role="status" aria-live="polite">${esc(source.label||'Bitget · USDT 永續')}</span></div><section class="px-grid" aria-label="依 T1 T2 T3 排列的${asset}"><div class="px-empty">等待畫入型態</div></section></div><button class="px-more" data-action="more" hidden>顯示更多</button><dialog class="px-dialog px-presets" aria-label="選擇型態"><div class="px-dialog-head"><span>型態</span><button class="px-icon" data-action="close" aria-label="關閉型態選單">${icon('close')}</button></div><div class="px-dialog-body"><input class="px-search" aria-label="搜尋型態" placeholder="搜尋型態"><div class="px-count-status" aria-live="polite"></div><div class="px-options"></div></div></dialog><dialog class="px-dialog px-settings" aria-label="時間級別"><div class="px-dialog-head"><span>時間級別</span><button class="px-icon" data-action="close" aria-label="關閉時間級別">${icon('close')}</button></div><div class="px-dialog-body"><div class="px-frames">${Object.keys(TIMEFRAMES).map(f=>`<button class="px-frame-option" data-frame="${f}">${f}</button>`).join('')}</div><label class="px-setting"><span>成交額觀察池</span><select data-limit aria-label="掃描${asset}數"><option value="80">前 80 ${asset}</option><option value="160">前 160 ${asset}</option><option value="0">全部合資格${asset}</option></select></label><details class="px-help"></details></div></dialog><dialog class="px-dialog px-detail" aria-label="型態 K 線詳情"><div class="px-dialog-head"><span class="px-detail-title"></span><div class="px-detail-tools"><button class="px-to-radar" data-action="open-radar" aria-label="在雷達查看這個${asset}">前往雷達</button><button class="px-icon" data-action="reset-chart" aria-label="重設圖表範圍">${icon('refresh')}</button><button class="px-icon" data-action="close" aria-label="關閉圖表">${icon('close')}</button></div></div><div class="px-detail-frames" role="group" aria-label="K 線時間級別">${Object.keys(TIMEFRAMES).map(f=>`<button data-detail-frame="${f}" aria-pressed="false">${f}</button>`).join('')}</div><div class="px-detail-stage"><canvas aria-label="可拖曳及雙指縮放的 K 線圖"></canvas><div class="px-detail-loading" role="status" hidden></div></div><div class="px-detail-footer"></div></dialog></main>`;
 revealStyledShadow(shadow,life.signal);
 document.addEventListener('ox:themechange',()=>requestAnimationFrame(drawBoard),{signal:life.signal});
 if(market==='tw'){host.style.setProperty('--ox-light-up','#ce3c4d');host.style.setProperty('--ox-light-down','#168366');}
  const q=s=>shadow.querySelector(s),qa=s=>[...shadow.querySelectorAll(s)],board=q('.px-board canvas');
  if(source.help)q('.px-help').innerHTML='<summary>比對與資料</summary>'+source.help;
  else q('.px-help').innerHTML='<summary>比對與資料</summary><p>畫板可瀏覽整個正常交易的加密觀察池，選擇型態或手繪後以實際 K 線結構、轉折比例及路徑比對。有效水平／斜線須有分開的測試；已明顯上下貫穿的線失效。</p><p>型態形成中的候選仍會保留，標示「尚待量價確認」。T1 要求完整量價條件，T2／T3 表示型態的確認程度，搜尋結果沒有雷達 15＋15 的名額限制。型態相似度不是勝率，也不等於已入選雷達。</p><p>已取得的真實行情及分類會直接重用。切換型態或手繪不重新下載行情，資料缺漏不補造 K 線。</p>';
  if(market==='tw'){const style=document.createElement('style');style.textContent='.px-up{color:#f16a70}.px-down{color:#48b78e}';shadow.append(style);}
  if(source.palette&&[source.palette.up,source.palette.down].every(color=>/^#[\da-f]{6}$/i.test(color))){const style=document.createElement('style');style.textContent=`.px-up{color:${source.palette.up}}.px-down{color:${source.palette.down}}`;shadow.append(style);}
  function preferences(){saved={frames:[...frames],limit,query,strokes:structuredClone(strokes)};preferencesByMarket.set(market,saved);}
  function labels(){
    q('[data-frame-label]').textContent=frames.join(' + ');q('[data-pattern-label]').textContent=patternById(query?.id)?.name||'型態';
    const toggle=q('.px-mode-toggle'),hasModes=!!strokes.length&&!!query?.points&&!!query?.id;
    toggle.hidden=!hasModes;
    if(hasModes){const sketch=query.mode==='sketch';q('[data-mode-label]').textContent=sketch?'相似路徑':'型態條件';q('.px-mode-glyph').textContent=sketch?'⌁':'◇';toggle.setAttribute('aria-label',`${sketch?'相似路徑':'型態條件'}，點擊切換為${sketch?'型態條件':'相似路徑'}`);toggle.title=toggle.getAttribute('aria-label');}
    q('.px-hint').hidden=strokes.length>0||!!query;q('[data-action="undo"]').disabled=!strokes.length&&!query;
    qa('[data-frame]').forEach(b=>b.setAttribute('aria-pressed',frames.includes(b.dataset.frame)));q('[data-limit]').value=String(limit);
  }
  function templatePath(p){return p.points.every(v=>v.y===p.points[0].y)?p.points:normalize(p.points);}
  function drawBoard(){
    boardRAF=0;const w=board.clientWidth,h=board.clientHeight,dpr=Math.min(devicePixelRatio||1,2);if(!w||!h)return;if(board.width!==w*dpr||board.height!==h*dpr){board.width=w*dpr;board.height=h*dpr;}const c=board.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
    const light=document.body.classList.contains('theme-light');
    c.fillStyle=light?'#a38b5838':'#e0e7ef13';for(let x=22;x<w-10;x+=24)for(let y=18;y<h-12;y+=24)c.fillRect(x,y,1,1);
    const paths=strokes.length?strokes:(query?.id?[templatePath(patternById(query.id))]:query?.points?[normalize(query.points)]:[]);
    const glow=reducedMotion?0:activePointer!==null?1:Math.max(0,1-(performance.now()-glowEnded)/1400);
    c.shadowColor=`rgba(255,255,255,${.15+glow*.8})`;c.shadowBlur=1+glow*15;c.lineWidth=2+glow*.35;c.lineJoin=c.lineCap='round';c.strokeStyle=light?'#4598df':'#f7f7f2';paths.forEach(path=>{c.beginPath();path.forEach((p,i)=>{const x=8+p.x*(w-16),y=8+(1-p.y)*(h-16);if(i)c.lineTo(x,y);else c.moveTo(x,y);});c.stroke();});
    if(paths[0]?.length){const p=paths.at(-1).at(-1);c.fillStyle=light?'#4598df':'#f3efde';c.beginPath();c.arc(8+p.x*(w-16),8+(1-p.y)*(h-16),3,0,Math.PI*2);c.fill();}
    if(activePointer===null&&glow>0&&!document.hidden)boardRAF=requestAnimationFrame(drawBoard);
  }
  const scheduleBoard=()=>{if(!boardRAF)boardRAF=requestAnimationFrame(drawBoard);};const resize=new ResizeObserver(scheduleBoard);resize.observe(board);
  function resetWorker(){worker?.terminate();worker=null;for(const j of jobs.values())j.reject(new DOMException('Aborted','AbortError'));jobs.clear();fallback.clear();hydrated.clear();}
  function computeFallback(message){
    return new Promise((resolve,reject)=>setTimeout(()=>{
      if(disposed)return reject(new DOMException('Aborted','AbortError'));
      try{
        if(message.type==='index'){const context=prepareCandles(message.candles);fallback.set(message.key,context);resolve(indexPrepared(context,message.matches));}
        else if(message.type==='prepare'){for(const entry of message.entries)fallback.set(entry.key,prepareCandles(entry.candles));resolve(true);}
        else resolve(message.keys.flatMap(key=>{let context=fallback.get(key);if(!context&&entries.has(key)){context=prepareCandles(entries.get(key).data.candles);fallback.set(key,context);}const match=context&&matchPrepared(context,message.query);return match?[{key,match}]:[];}));
      }catch(error){reject(error);}
    },0));
  }
  function failWorker(){
    workerFailed=true;worker?.terminate();worker=null;hydrated.clear();
    for(const job of jobs.values())job.reject(Error('型態計算改用備援'));jobs.clear();
  }
  function compute(message){
    if(!worker&&!workerFailed){try{
      worker=new Worker(new URL('../../../generated/pattern-worker.js?v=20261005-first24',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{const job=jobs.get(data.id);jobs.delete(data.id);if(job)data.error?job.reject(Error(data.error)):job.resolve(data.result);};
      worker.onerror=event=>{event.preventDefault();failWorker();};
    }catch{workerFailed=true;}}
    if(!worker)return computeFallback(message);
    return new Promise((resolve,reject)=>{
      const id=++workerId,timer=setTimeout(failWorker,8000);
      jobs.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
      try{worker.postMessage({...message,id});}catch{failWorker();}
    }).catch(error=>{if(error.name==='AbortError'||disposed)throw error;return computeFallback(message);});
  }
  function activeEntries(){
    let list=[...entries.values()].filter(e=>frames.includes(e.data.frame)&&(entryCurrent(e)||backgroundScan&&classificationCurrent(e,INDEX_VERSION)));
    const symbols=new Set(universe?universe.tickers.map(t=>t.symbol):[...new Map(list.sort((a,b)=>b.data.turnover-a.data.turnover).map(e=>[e.data.symbol,e])).keys()].slice(0,limit||Infinity));
    return list.filter(e=>symbols.has(e.data.symbol));
  }
  function counts(){return patternCounts(activeEntries(),frames);}
  function updateCounts(){
    const totals=counts();qa('[data-count]').forEach(e=>{e.textContent=totals[e.dataset.count]?String(totals[e.dataset.count]):busy&&!backgroundScan?'…':'0';});
    q('.px-count-status').textContent=busy&&!backgroundScan?`預先分類 ${progress.done}/${progress.total||'…'} 組`:`${frames.join(' + ')} · 不重複${asset}${progress.failed?' · 部分資料缺漏':''}`;
  }
  function hasBaseline(list=[...entries.values()]){return frames.every(frame=>list.some(entry=>entry.data.frame===frame&&classificationCurrent(entry,INDEX_VERSION)));}
  function updateStatus(){
    q('.px-status-row').hidden=busy?backgroundScan:hasBaseline();
    q('.px').dataset.indexState=busy?'loading':lastError||progress.failed?'partial':'ready';
    const amount=activeEntries().length,matched=new Set([...rows.values()].map(r=>r.symbol)).size;
    status(busy?`${progress.coinsTotal?`${progress.coinsDone}/${progress.coinsTotal}`:'取得清單'} · ${progress.total?Math.round(progress.done/progress.total*100):0}% · ${sourceLabel} 掃描`:`${lastError?lastError+' · ':''}${sourceLabel}${source.dataDate?.()?' · '+source.dataDate():''} · ${amount} 組${query?' · '+matched+' 符合':''}${progress.failed?' · '+progress.failed+' 缺漏':''}`);
    const percent=progress.total?Math.min(100,Math.max(0,progress.done/progress.total*100)):0;
    q('.px-pill-arc').style.strokeDashoffset=String(107*(1-percent/100));
    updateCounts();
  }
  function setRows(matches){
    const qualified=rankPatternMatches(matches);
    rows=new Map(qualified.map(({entry,match})=>[entry.key,{...entry.data,classicSignal:match.classicSignal,oxScore:match.classicSignal.qualityScore,match:entry.classifying?{...match,stage:'走勢已取得 · 型態分類中'}:match,similarity:match.similarity}]));renderResults(!rows.size);updateStatus();
  }

  async function search(){
    if(disposed||document.hidden||activePointer!==null)return;
    const signature=JSON.stringify([query,frames,limit]);if(signature!==searchSignature){searchSignature=signature;queryVersion++;rows.clear();}
    const run=queryVersion,target=query&&structuredClone(query),list=activeEntries();
    if(!target){
      setRows(browsePatternEntries(list));return;
    }
    if(target.mode!=='sketch'&&target.id){setRows(list.flatMap(entry=>entry.matches[target.id]?[{entry,match:entry.matches[target.id]}]:[]));return;}
    if(searchRunning){searchPending=true;return;}
    searchRunning=true;searchPending=false;
    try{
      const matches=[];
      for(let i=0;i<list.length;i+=25){
        if(run!==queryVersion||disposed)return;
        const batch=list.slice(i,i+25),missing=batch.filter(e=>!hydrated.has(e.key));
        if(missing.length){await compute({type:'prepare',entries:missing.map(e=>({key:e.key,candles:e.data.candles}))});missing.forEach(e=>hydrated.add(e.key));}
        const result=await compute({type:'search',keys:batch.map(e=>e.key),query:target});
        if(run!==queryVersion||disposed)return;
        const byKey=new Map(batch.map(e=>[e.key,e]));matches.push(...result.filter(r=>byKey.has(r.key)).map(r=>({entry:byKey.get(r.key),match:r.match})));
        // Keep already matched cards while extending the same query's search.
        const pendingKeys=new Set(list.slice(i+25).map(e=>e.key));
        const retained=[...rows.values()].filter(r=>pendingKeys.has(r.symbol+':'+r.frame)).flatMap(r=>{const entry=entries.get(r.symbol+':'+r.frame);return entry?[{entry,match:r.match}]:[];});
        setRows([...matches,...retained]);await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(!list.length)setRows([]);
    }catch(e){if(!disposed&&e.name!=='AbortError')status(e.message);}
    finally{searchRunning=false;if(searchPending&&!disposed){searchPending=false;search();}}
  }
  function clearCharts(){chartObserver?.disconnect();chartObserver=null;chartInstances.forEach(c=>c.destroy());chartInstances=[];}
  function renderResults(force=false){
    q('.px-tier-filters').hidden=!rows.size;
    const displayTier=r=>r.match.tier;
    const totals=[1,2,3].map(t=>[...rows.values()].filter(r=>displayTier(r)===t).length);
    qa('[data-tier-filter]').forEach(b=>{const filter=b.dataset.tierFilter;b.setAttribute('aria-pressed',filter===tierFilter);b.textContent=filter==='all'?`全部 ${rows.size}`:`T${filter} ${totals[Number(filter)-1]}`;});
    const sorted=sortMatches([...rows.values()].filter(r=>tierFilter==='all'||String(displayTier(r))===tierFilter).map(r=>({...r,displayTier:displayTier(r),rankPriority:null}))),visible=sorted.slice(0,shown),signature=sorted.length+'|'+visible.map(r=>`${r.symbol}:${r.frame}:${r.similarity}:${r.match.tier}:${r.match.radarTier}:${r.match.stage}:${r.oxScore}:${r.serverTime}`).join('|');
    q('.px-more').hidden=sorted.length<=shown;
    if(!force&&signature===lastSignature)return;lastSignature=signature;clearCharts();
    if(!visible.length){q('.px-grid').innerHTML=`<div class="px-empty">${tierFilter!=='all'&&rows.size?`此階段暫無符合的${asset}`:!query?(busy&&!backgroundScan?'載入走勢與型態…':'行情資料暫無可用資料，可重新掃描'):busy&&!backgroundScan?'正在加入已分類結果…':progress.failed===progress.total&&progress.total?'行情未取得，請重新掃描':'目前沒有符合的型態，可切換級別或重畫'}</div>`;return;}
    let lastTier=null;
    q('.px-grid').innerHTML=visible.map(r=>{const tier=displayTier(r),group=tierFilter==='all'&&lastTier!==tier?`<div class="px-tier-heading" data-tier-heading="${tier}">${query?'型態 ':'觀察 '}T${tier}<span>${tier===1?'結構與量能完整':tier===2?'部分確認':'型態／走勢觀察'}</span></div>`:'';lastTier=tier;return `${group}<button class="px-card" data-tier="${tier}" data-result="${esc(r.symbol+':'+r.frame)}" aria-label="${esc(r.symbol)} ${r.frame} ${query?'型態':'走勢'} T${tier} ${esc(r.match.stage)}，開啟 K 線"><div class="px-card-top"><span class="px-symbol">${esc(displayName(r))}<span class="px-frame">${r.frame}${r.candles.at(-1).provisional?' · 未收':''}</span></span><span class="px-card-right"><b class="px-tier-badge">T${tier}</b><span class="px-change ${r.change>=0?'px-up':'px-down'}">${signed(r.change)}</span></span></div><div class="px-match"><span>${esc(query?r.match.stage:r.match.stage)}</span><span>${query?'相似 '+r.similarity.toFixed(1):esc(r.match.label.replace(/・.*$/,''))}</span></div><canvas aria-label="${esc(r.symbol)} 實際型態 K 線"></canvas><div class="px-energy"><span>OX</span><strong>${r.oxScore??'—'}</strong><span class="px-track" role="meter" aria-label="OX 強度" aria-valuemin="0" aria-valuemax="100" ${r.oxScore===null?'':`aria-valuenow="${Math.min(100,r.oxScore)}"`}><i style="width:${Math.max(0,Math.min(100,r.oxScore??0))}%"></i></span></div><div class="px-turnover"><span>${esc(turnoverLabel)}</span><b>${volume(r.turnover)} ${currency}</b></div></button>`;}).join('');
    const mountCard=card=>{if(card.dataset.chartMounted)return;const row=rows.get(card.dataset.result);if(row){card.dataset.chartMounted='true';chartInstances.push(candleChart(card.querySelector('canvas'),row,{palette:source.palette}));}chartObserver?.unobserve(card);};
    chartObserver=new IntersectionObserver(items=>{for(const e of items)if(e.isIntersecting)mountCard(e.target);},{rootMargin:'150px'});
    // Draw visible cards immediately. Incremental indexing must not repeatedly
    // cancel a deferred observer before the first frame is painted.
    qa('.px-card').forEach(card=>{const r=card.getBoundingClientRect();if(r.bottom>-150&&r.top<innerHeight+150)mountCard(card);else chartObserver.observe(card);});
    moreObserver?.disconnect();moreObserver=new IntersectionObserver(items=>{if(items.some(e=>e.isIntersecting)&&!q('.px-more').hidden){shown+=24;renderResults(true);}},{rootMargin:'180px'});if(!q('.px-more').hidden)moreObserver.observe(q('.px-more'));
  }
  function queueRender(){
    // Publish the first available match before waiting for another series.
    // Subsequent arrivals share a short paint window while the scan continues.
    if(!rows.size&&!searchRunning){clearTimeout(paintTimer);paintTimer=0;void search();return;}
    if(!paintTimer)paintTimer=setTimeout(()=>{paintTimer=0;void search();},100);
  }
  function status(text){q('.px-status').textContent=text;}
  function stop(){version++;controller?.abort();controller=null;busy=false;clearTimeout(paintTimer);paintTimer=0;clearTimeout(scanFinishTimer);q('.px-board').classList.remove('is-scanning');q('.px-refresh-pill').classList.remove('is-scanning','is-complete');}
  async function hydrate(entry){
    if(!classificationCurrent(entry,INDEX_VERSION)){
      const indexed=await compute({type:'index',key:entry.key,candles:entry.data.candles});
      entry={...entry,version:INDEX_VERSION,matches:indexed.matches,data:{...entry.data,classic:indexed.classic}};
      hydrated.add(entry.key);saveIndex(entry.data,entry.matches);
    }
    entries.set(entry.key,entry);primeCandleCache(entry.data);
  }
  async function scan(){
    stop();if(document.hidden||disposed)return;
    resumePending=false;lastError='';const run=version;controller=new AbortController();const signal=controller.signal;let loading;busy=true;progress={done:0,total:0,failed:0,coinsDone:0,coinsTotal:0};
    backgroundScan=lastScan>0&&hasBaseline();updateStatus();
    try{
      const cached=entries.size?[]:await readIndex(frames);if(run!==version)return;
      backgroundScan=backgroundScan||cached.length>0&&hasBaseline([...entries.values(),...cached]);
      if(!backgroundScan){loading=window.OXLoading?.begin(market,`掃描${asset}`,{signal,views:['strength'],target:q('.px-local-loading')});q('.px-pill-arc').style.strokeDashoffset='107';q('.px-board').classList.add('is-scanning');q('.px-refresh-pill').classList.add('is-scanning');}updateStatus();
      for(let i=0;i<cached.length;i++){if(run!==version)return;await hydrate(cached[i]);queueRender();if(i%10===9)await new Promise(resolve=>setTimeout(resolve,0));}
      search();
      if(!universe||market==='tw'||market!=='tw'&&(Date.now()-universe.serverTime>60000||frames.some(f=>Math.floor(Date.now()/1000/TIMEFRAMES[f])!==Math.floor(universe.serverTime/1000/TIMEFRAMES[f]))))universe=await fetchUniverse(signal,limit);
      if(run!==version)return;const pool=universe;progress.total=pool.tickers.length*frames.length;progress.coinsTotal=pool.tickers.length;loading?.update(0,progress.coinsTotal);updateStatus();
      await scanUniverse(pool,frames,{signal,onSeries:async data=>{
        if(run!==version)return;const key=data.symbol+':'+data.frame,existing=entries.get(key),same=existing&&entryCurrent(existing,data.serverTime)&&existing.data.candles.at(-1).time===data.candles.at(-1).time&&(!data.candles.at(-1).provisional||existing.data.serverTime===data.serverTime);
        const reuse=same&&classificationCurrent(existing,INDEX_VERSION);
        const preclassified=data.preclassified&&classificationCurrent({version:INDEX_VERSION,data,matches:data.preclassified},INDEX_VERSION);
        if(!preclassified&&!reuse){entries.set(key,{key,data,matches:{},version:INDEX_VERSION,classifying:true});queueRender();await new Promise(resolve=>setTimeout(resolve,0));}
        const indexed=preclassified?{matches:data.preclassified,classic:data.classic}:reuse?
          {matches:existing.matches,classic:existing.data.classic}:await compute({type:'index',key,candles:data.candles});
        if(run!==version)return;if(!data.preclassified&&!reuse)hydrated.add(key);
        const fresh={...data,classic:indexed.classic},entry={key,data:fresh,matches:indexed.matches,version:INDEX_VERSION};
        if(data.preclassified)hydrated.delete(key);entries.set(key,entry);saveIndex(fresh,indexed.matches);queueRender();
      },onProgress:p=>{if(run!==version)return;progress=p;loading?.update(p.coinsDone,p.coinsTotal);updateStatus();}});
      if(run!==version)return;lastScan=Date.now();
      const keys=activeEntries().map(e=>e.key);worker?.postMessage({type:'retain',keys});for(const key of hydrated)if(!keys.includes(key))hydrated.delete(key);
      pruneIndex();
    }catch(e){if(run===version&&e.name!=='AbortError')lastError=e.message||'行情取得失敗';}
    finally{loading?.finish();if(run===version){busy=false;controller=null;q('.px-refresh-pill').classList.remove('is-scanning');q('.px-board').classList.remove('is-scanning');if(!lastError&&!backgroundScan){q('.px-pill-arc').style.strokeDashoffset='0';q('.px-refresh-pill').classList.add('is-complete');}scanFinishTimer=setTimeout(()=>q('.px-refresh-pill').classList.remove('is-complete'),900);search();}}
  }
  function openDialog(selector,button){const d=q(selector);d.classList.remove('px-closing');qa('.px-control').forEach(b=>b.setAttribute('aria-expanded',b===button));d.showModal();}
  function closeDialogs(immediate=false){qa('dialog[open]').forEach(d=>{if(immediate||matchMedia('(prefers-reduced-motion:reduce)').matches)d.close();else{d.classList.add('px-closing');setTimeout(()=>{if(d.classList.contains('px-closing')){d.close();d.classList.remove('px-closing');}},180);}});qa('.px-control').forEach(b=>b.setAttribute('aria-expanded','false'));detailController?.abort();detailController=null;detailVersion++;detailChart?.destroy();detailChart=null;detailFrame=null;selectedRow=null;}
  function presetOptions(search=''){
    let group='';const totals=counts();q('.px-options').innerHTML=PATTERNS.filter(p=>p.name.toLowerCase().includes(search.toLowerCase())).map(p=>{const heading=p.group!==group?`<div class="px-group">${p.group}</div>`:'';group=p.group;return `${heading}<button class="px-option" data-preset="${p.id}" aria-pressed="${query?.id===p.id}"><svg viewBox="0 0 50 28" fill="none" stroke="currentColor" stroke-width="1.3"><polyline points="${templatePath(p).map(v=>`${2+v.x*46},${25-v.y*22}`).join(' ')}"/></svg><span>${p.name}</span><b class="px-count" data-count="${p.id}">${totals[p.id]||0}</b></button>`;}).join('')||'<div class="px-empty">沒有此型態</div>';updateCounts();
  }
  function displayDetail(row){
    detailFrame=row.frame;
    qa('[data-detail-frame]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.detailFrame===row.frame));
    q('.px-detail-title').textContent=`${displayName(row)} · ${row.frame}${row.match?.radar?` · 雷達 T${row.match.radarTier}`:row.match?` · 型態 T${row.match.tier} · 相似 ${row.match.similarity.toFixed(1)}`:''}`;
    q('.px-detail-footer').innerHTML=`<span>${row.match?.radar?`雷達 T${row.match.radarTier} · ${row.match.unconfirmed?'型態未確認':`型態 T${row.match.tier} · ${esc(row.match.stage)} · ${esc(row.match.label)}`}`:row.match?`型態 T${row.match.tier} · ${esc(row.match.stage)} · ${esc(row.match.label)}`:'此級別無符合型態 · 僅顯示 K 線'}</span><span>OX ${row.oxScore??'—'}</span><span>${period} ${signed(row.change)}</span><span>${esc(source.turnoverLabel||'成交額')} ${volume(row.turnover)} ${market==='crypto'?'USDT':currency}</span><div>${sourceLabel} · ${source.detailStamp?esc(source.detailStamp(row)):row.candles.at(-1).provisional?'本週 K 尚未收盤 · 更新 '+new Date(row.serverTime).toLocaleString('zh-TW',{hour12:false}):'已收盤 '+new Date(row.candles.at(-1).time*1000).toLocaleString('zh-TW',{hour12:false})} · 拖曳／雙指縮放</div>${row.match?.ratios?`<div class="px-detail-ratios">${Object.entries(row.match.ratios).map(([k,v])=>`${({ab:'AB/XA',bc:'BC/AB',cd:'CD/BC',ad:'AD/XA',equal:'CD/AB'})[k]} ${v.toFixed(3)}`).join(' · ')}</div>`:''}`;
    q('.px-detail-loading').hidden=true;detailChart?.destroy();detailChart=candleChart(q('.px-detail canvas'),row,{interactive:true,palette:source.palette});
  }
  async function selectDetailFrame(frame){
    if(!selectedRow||!TIMEFRAMES[frame])return;
    if(detailFrame===frame){detailController?.abort();detailController=null;detailVersion++;q('.px-detail-loading').hidden=true;return;}
    detailController?.abort();const run=++detailVersion;detailController=new AbortController();
    const loading=q('.px-detail-loading');loading.innerHTML=window.OXLoading?.markup(`載入 ${frame} K 線`,0,1)||`載入 ${frame} K 線…`;loading.hidden=false;
    try{
      const original=selectedRow,entry=entries.get(original.symbol+':'+frame);
      const data=entry&&entryCurrent(entry)?entry.data:await fetchSeries(original.symbol,frame,detailController.signal);
      if(run!==detailVersion||!selectedRow)return;
      const match=frame===original.frame?original.match:entry&&entryCurrent(entry)&&query?.id&&query.mode!=='sketch'?entry.matches[query.id]||null:query?matchPrepared(prepareCandles(data.candles),query):null;
      displayDetail({...original,...data,match,frame});
    }catch(e){if(run===detailVersion&&e.name!=='AbortError'){loading.textContent=e.message||`${frame} K 線未取得`;}}
    finally{if(run===detailVersion)detailController=null;}
  }
  function openResult(key){
    const row=rows.get(key);if(!row)return;selectedRow=row;q('.px-detail').showModal();displayDetail(row);
  }
  shadow.addEventListener('click',e=>{
    const preset=e.target.closest('[data-preset]'),frame=e.target.closest('[data-frame]'),tierChoice=e.target.closest('[data-tier-filter]'),detailChoice=e.target.closest('[data-detail-frame]'),result=e.target.closest('[data-result]'),button=e.target.closest('[data-action]');
    if(e.type==='click'&&suppressControlClick){suppressControlClick=false;e.preventDefault();e.stopPropagation();return;}
    if(tierChoice){tierFilter=tierChoice.dataset.tierFilter;shown=24;renderResults(true);return;}
    if(preset){clearTimeout(drawTimer);query={id:preset.dataset.preset};strokes=[];shown=24;labels();scheduleBoard();closeDialogs();preferences();search();return;}
    if(frame){const f=frame.dataset.frame;if(frames.includes(f)){if(frames.length===1)return;frames=frames.filter(x=>x!==f);}else frames.push(f);frames.sort((a,b)=>TIMEFRAMES[b]-TIMEFRAMES[a]);labels();preferences();search();clearTimeout(drawTimer);drawTimer=setTimeout(scan,300);return;}
    if(detailChoice){selectDetailFrame(detailChoice.dataset.detailFrame);return;}
    if(result){openResult(result.dataset.result);return;}
    if(!button)return;
    switch(button.dataset.action){
      case 'patterns':presetOptions();q('.px-search').value='';openDialog('.px-presets',button);break;
      case 'timeframes':labels();openDialog('.px-settings',button);break;
      case 'close':closeDialogs();break;
      case 'undo':clearTimeout(drawTimer);glowEnded=0;strokes=[];query=strokes.length?queryFromStrokes(strokes):null;labels();scheduleBoard();preferences();search();break;
      case 'toggle-mode':if(query?.points&&query?.id){query={...query,mode:query.mode==='sketch'?'pattern':'sketch'};shown=24;labels();preferences();search();}break;
      case 'refresh':universe=null;scan();break;
      case 'open-radar':{const symbol=selectedRow?.symbol,frame=detailFrame||selectedRow?.frame;if(!symbol)break;closeDialogs(true);if(options.onOpenRadar){options.onOpenRadar(symbol,frame);break;}window.switchSymbol?.(symbol);requestAnimationFrame(()=>{const toggle=document.getElementById('radar-scanner-toggle');if(toggle?.getAttribute('aria-expanded')==='true')toggle.click();});break;}
      case 'more':shown+=24;renderResults(true);break;
      case 'reset-chart':detailChart?.reset();break;
    }
  },{signal:life.signal});
  q('.px-search').addEventListener('input',e=>presetOptions(e.target.value),{signal:life.signal});
  q('[data-limit]').addEventListener('change',e=>{limit=Number(e.target.value);universe=null;preferences();scan();},{signal:life.signal});
  qa('dialog').forEach(d=>{d.addEventListener('cancel',e=>{e.preventDefault();closeDialogs();},{signal:life.signal});d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialogs();}},{signal:life.signal});});
  let activePointer=null,currentStroke=null,pendingControl=null,suppressControlClick=false;
  const position=e=>{const r=board.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left-8)/(r.width-16))),y:Math.max(0,Math.min(1,1-(e.clientY-r.top-8)/(r.height-16)))};};
  const startStroke=(e,initial=e)=>{clearTimeout(drawTimer);queryVersion++;rows.clear();query=null;strokes=[];glowEnded=0;activePointer=e.pointerId;currentStroke=[position(initial)];strokes=[currentStroke];q('.px-board').classList.add('is-drawing');q('.px-board').setPointerCapture(e.pointerId);labels();scheduleBoard();};
  q('.px-board').addEventListener('pointerdown',e=>{if(activePointer!==null||e.button>0)return;if(e.target.closest('button')){pendingControl={pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY};return;}startStroke(e);},{signal:life.signal});
  document.addEventListener('pointermove',e=>{if(pendingControl?.pointerId===e.pointerId&&Math.hypot(e.clientX-pendingControl.clientX,e.clientY-pendingControl.clientY)>7){const initial=pendingControl;pendingControl=null;suppressControlClick=true;startStroke(e,initial);}if(e.pointerId!==activePointer)return;const p=position(e),last=currentStroke.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)>.003){currentStroke.push(p);if(currentStroke.length>1200)currentStroke.splice(1,1);scheduleBoard();}},{signal:life.signal});
  const finish=e=>{if(e.pointerId!==activePointer)return;activePointer=null;glowEnded=performance.now();q('.px-board').classList.remove('is-drawing');if(e.type==='pointercancel')strokes.pop();if(currentStroke?.length<2&&strokes.at(-1)===currentStroke)strokes.pop();currentStroke=null;query=queryFromStrokes(strokes);shown=24;labels();scheduleBoard();preferences();renderResults(true);status(query?'正在搜尋已分類資料…':'請由左向右畫一段走勢');clearTimeout(drawTimer);drawTimer=setTimeout(search,100);};
  document.addEventListener('pointerup',e=>{if(pendingControl?.pointerId===e.pointerId)pendingControl=null;finish(e);if(suppressControlClick)setTimeout(()=>{suppressControlClick=false;},0);},{signal:life.signal});document.addEventListener('pointercancel',e=>{if(pendingControl?.pointerId===e.pointerId)pendingControl=null;finish(e);suppressControlClick=false;},{signal:life.signal});
  board.addEventListener('keydown',e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();q('[data-action="undo"]').click();}},{signal:life.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){queryVersion++;if(busy){resumePending=true;stop();}clearTimeout(drawTimer);}else if(resumePending||!lastScan||(source.scanCurrent?!source.scanCurrent(universe):Date.now()-lastScan>60000))scan();else search();},{signal:life.signal});
  const timer=setInterval(()=>{const cadence=Math.min(300000,...frames.map(f=>TIMEFRAMES[f]*1000));if(!busy&&!document.hidden&&(source.scanCurrent?!source.scanCurrent(universe):Date.now()-lastScan>=cadence))scan();},15000);
  const dock=document.querySelector('.app-dock.glass-nav');
  const syncPill=()=>q('.px-refresh-pill').classList.toggle('is-compact',!!dock?.classList.contains('ox-dock-compact'));
  const dockObserver=dock?new MutationObserver(syncPill):null;dockObserver?.observe(dock,{attributes:true,attributeFilter:['class']});syncPill();
  labels();scheduleBoard();if(session){renderResults(true);updateStatus();}if(!session||!lastScan||progress.done!==progress.total||!source.scanCurrent?.(universe))scan();
  return {closeInner:closeDialogs,refresh(){universe=null;scan();},destroy(){storePatternSession(sessionsByMarket,market,sessionKey,{entries:new Map(entries),rows:new Map(rows),universe,lastScan,progress:{...progress},shown,tierFilter});disposed=true;queryVersion++;preferences();stop();resetWorker();life.abort();resize.disconnect();dockObserver?.disconnect();clearCharts();moreObserver?.disconnect();detailChart?.destroy();closeDialogs(true);clearInterval(timer);clearTimeout(drawTimer);cancelAnimationFrame(boardRAF);shadow.replaceChildren();}};
}
