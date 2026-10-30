/* Drawing objects use time/price anchors; navigation and selection share one cursor. */
window.OXChartDrawings = function mountChartDrawings({box,chartEl,state,market='crypto',isExpanded}={}) {
  if (!box || !chartEl || !state) return;
  const prefix=market==='crypto'?'ox-chart':`ox-tw-independent:${market}-chart`;
  const legacyKey=`${prefix}-drawings-v1`,drawingKey=`${prefix}-drawings-v2`,prefsKey=`${prefix}-drawing-preferences-v1`;
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
  const clone=value=>JSON.parse(JSON.stringify(value));
  const epoch=time=>typeof time==='number'?time:typeof time==='string'?Date.parse(time)/1000:time&&Date.UTC(time.year,time.month-1,time.day)/1000;
  const validPoint=p=>p&&Number.isFinite(epoch(p.time))&&Number.isFinite(p.price);
  let sequence=0;
  const id=()=>globalThis.crypto?.randomUUID?.()||`ox-${Date.now()}-${++sequence}`;
  const stored=read(drawingKey,null),symbols=stored?.version===2&&stored.symbols&&typeof stored.symbols==='object'?stored.symbols:{};
  const prefs=Object.assign({color:'#f3f1e9',width:2,fill:12,magnet:false,emoji:'🚀',fib:[0,.236,.382,.5,.618,.786,1],collapsed:false,keepDrawing:false,tools:{}},read(prefsKey,{}));
  prefs.tools ||= {};
  const write=()=>{try{localStorage.setItem(drawingKey,JSON.stringify({version:2,symbols}));}catch{announce('畫線儲存空間不足，請保留此頁並整理圖形。');}};
  const savePrefs=()=>{try{localStorage.setItem(prefsKey,JSON.stringify(prefs));}catch{}};
  if(!stored?.version){
    const legacy=read(legacyKey,{});
    for(const [scope,items] of Object.entries(legacy)){
      if(!Array.isArray(items))continue;
      const split=scope.lastIndexOf(':'),symbol=split<0?scope:scope.slice(0,split),period=split<0?'1D':scope.slice(split+1);
      for(const old of items)if(validPoint(old?.a)&&validPoint(old?.b)){
        (symbols[symbol] ||= []).push({...old,id:id(),a:{time:epoch(old.a.time),price:old.a.price},b:{time:epoch(old.b.time),price:old.b.price},originPeriod:period,visibility:'all'});
      }
    }
    // The original v1 object remains intact as a migration backup.
    try{localStorage.setItem(drawingKey,JSON.stringify({version:2,symbols}));}catch{}
  }
  for(const [key,items] of Object.entries(symbols))symbols[key]=Array.isArray(items)?items.filter(d=>validPoint(d?.a)&&validPoint(d?.b)).map(d=>({...d,id:d.id||id()})):[];
  const life=new AbortController(),history=new Map();
  const listen=(target,type,fn,options={})=>target.addEventListener(type,fn,{...(typeof options==='boolean'?{capture:options}:options),signal:life.signal});
  const expanded=isExpanded||(()=>document.body.classList.contains('chart-focus')||document.fullscreenElement===box||document.webkitFullscreenElement===box);
  const radar=box.closest(market==='tw'?'.tw-chart-radar':'#view-radar');
  const toolsVisible=()=>expanded()||!!radar?.classList.contains(market==='tw'?'is-folded':'ox-scanner-collapsed');
  const TYPES={trend:'趨勢線',ray:'射線',horizontal:'水平線',horizontalRay:'水平射線',vertical:'垂直線',arrow:'箭頭',rectangle:'矩形區間',ellipse:'橢圓',fib:'斐波那契回撤',measure:'測量',longPosition:'多單盈虧比',shortPosition:'空單盈虧比',highlighter:'螢光筆',brush:'畫筆',emoji:'表情符號'};
  const EMOJIS=['🚀','🔥','🐂','🐻','📈','📉','⚠️','⭐','🙂','😂','💎','🚩'];
  const position=d=>d.type==='longPosition'||d.type==='shortPosition';
  const freehand=d=>d.type==='brush'||d.type==='highlighter';
  const direction=d=>d.type==='shortPosition'?-1:1;
  const strokePoints=d=>Array.isArray(d.points)?d.points.filter(validPoint):[d.a,d.b];
  function riskReward(d){const sign=direction(d),risk=(d.a.price-d.stopPrice)*sign,reward=(d.b.price-d.a.price)*sign;return d.a.price>0&&d.b.price>0&&d.stopPrice>0&&risk>0&&reward>0?{risk,reward,ratio:reward/risk}:null;}
  const icon=(paths)=>`<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const icons={cursor:icon('<path d="m5 3 14 9-7 1-3 7Z"/>'),line:icon('<path d="m4 19 16-14"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="5" r="2"/>'),magnet:icon('<path d="M6 3v10a6 6 0 0 0 12 0V3h-4v10a2 2 0 0 1-4 0V3Z"/><path d="M6 3h4v4H6Z" style="fill:#ef6077;stroke:none"/><path d="M14 3h4v4h-4Z" style="fill:#5ca5ff;stroke:none"/>'),repeat:icon('<path d="M4 8h15l-4-4M20 16H5l4 4"/>'),undo:icon('<path d="m9 5-5 5 5 5M4 10h9a7 7 0 0 1 7 7"/>'),redo:icon('<path d="m15 5 5 5-5 5M20 10h-9a7 7 0 0 0-7 7"/>'),list:icon('<path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1"/>'),fold:icon('<path d="m9 5 7 7-7 7"/>'),lock:icon('<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),copy:icon('<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>'),remove:icon('<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>'),settings:icon('<path d="M4 5h16M4 12h16M4 19h16"/><circle cx="8" cy="5" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="19" r="2"/>')};
  const btn=(action,label,glyph)=>`<button type="button" data-action="${action}" aria-label="${label}" title="${label}">${glyph}</button>`;
  const toolbar=document.createElement('div');toolbar.className='chart-drawing-tools';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','圖表畫線工具');
  const toolMenu=[['線條／區域',Object.keys(TYPES).slice(0,10)],['交易規劃',['longPosition','shortPosition']],['註記',['highlighter','brush','emoji']]].map(([title,types])=>`<strong>${title}</strong>${types.map(type=>`<button type="button" role="menuitem" data-draw="${type}">${TYPES[type]}</button>`).join('')}`).join('');
  toolbar.innerHTML=btn('cursor','游標／退出畫線（Esc）',icons.cursor)+`<div class="drawing-tools-content">${btn('menu','畫線工具',icons.line)}${btn('magnet','磁鐵吸附：停用（M）',icons.magnet)}${btn('repeat','連續畫線',icons.repeat)}${btn('undo','復原（Ctrl／⌘ Z）',icons.undo)}${btn('redo','重做（Ctrl／⌘ Shift Z）',icons.redo)}${btn('objects','圖形清單',icons.list)}</div>`+btn('fold','收合／展開工具列',icons.fold)+`<div class="drawing-tool-menu" role="menu" hidden>${toolMenu}</div><div class="drawing-emoji-menu" role="menu" aria-label="選擇表情符號" hidden>${EMOJIS.map(emoji=>`<button type="button" data-emoji="${emoji}" aria-label="${emoji}">${emoji}</button>`).join('')}</div><div class="drawing-object-list" aria-label="已儲存圖形" hidden></div>`;
  box.append(toolbar);
  const editor=document.createElement('div');editor.className='chart-drawing-editor';editor.hidden=true;editor.setAttribute('role','toolbar');editor.setAttribute('aria-label','所選圖形編輯');
  editor.innerHTML=`<label class="drawing-color" title="顏色"><input type="color" data-setting="color" aria-label="所選圖形顏色"></label>${btn('width','線條粗細','<span data-width-label>2</span>')}${btn('dash','實線／虛線／點線','<span data-dash-label>━</span>')}${btn('lock','鎖定／解鎖圖形',icons.lock)}${btn('copy','複製所選圖形',icons.copy)}${btn('delete','刪除所選圖形',icons.remove)}${btn('settings','更多圖形設定',icons.settings)}<div class="drawing-width-menu" hidden>${[1,2,3,4,6,8,12,16].map(n=>`<button type="button" data-width="${n}" aria-label="${n} 像素"><i style="border-top-width:${Math.min(n,8)}px"></i></button>`).join('')}</div>`;
  box.append(editor);
  const inspector=document.createElement('div');inspector.className='drawing-tool-inspector';inspector.hidden=true;inspector.setAttribute('role','dialog');inspector.setAttribute('aria-label','圖形設定');
  inspector.innerHTML=`<div class="drawing-inspector-heading"><strong data-inspector-title>圖形設定</strong>${btn('close','關閉圖形設定','×')}</div><div class="drawing-coordinates"><label><span data-price-label="a">起點價格</span><input type="number" step="any" data-setting="a-price" aria-label="起點價格"></label><label><span data-price-label="b">終點價格</span><input type="number" step="any" data-setting="b-price" aria-label="終點價格"></label><label class="drawing-stop">止損價格<input type="number" step="any" data-setting="stopPrice" aria-label="止損價格"></label></div><output class="drawing-rr" aria-live="polite" hidden></output><label class="drawing-emoji-setting">表情符號<select data-setting="emoji" aria-label="表情符號">${EMOJIS.map(emoji=>`<option>${emoji}</option>`).join('')}</select></label><label class="drawing-emoji-setting">大小<input type="range" min="16" max="48" data-setting="emojiSize" aria-label="表情大小"></label><details class="drawing-advanced"><summary>時間與其他設定</summary><label>名稱<input type="text" data-setting="name" maxlength="60" aria-label="圖形名稱"></label><div class="drawing-coordinates"><label>起點時間（台北）<input type="datetime-local" step="1" data-setting="a-time" aria-label="起點時間"></label><label>終點時間（台北）<input type="datetime-local" step="1" data-setting="b-time" aria-label="終點時間"></label></div><label>顯示週期<select data-setting="visibility" aria-label="顯示週期"><option value="all">所有週期</option><option value="period">僅繪製週期</option></select></label><div class="drawing-extend"><label><input type="checkbox" data-setting="extendLeft">向左延伸</label><label><input type="checkbox" data-setting="extendRight">向右延伸</label></div><label class="drawing-fill">填色透明度<input type="range" min="0" max="70" step="1" data-setting="fill" aria-label="填色透明度"></label><label class="fib-setting">斐波那契級別<input type="text" data-setting="levels" aria-label="斐波那契級別"></label></details>`;
  box.append(inspector);
  const status=document.createElement('span');status.className='drawing-sr-status';status.setAttribute('role','status');box.append(status);
  function announce(message){status.textContent=message;}
  const layer=document.createElement('canvas');layer.className='chart-drawing-layer';layer.setAttribute('aria-hidden','true');chartEl.append(layer);
  const hint=document.createElement('output');hint.className='drawing-drag-hint';hint.hidden=true;chartEl.append(hint);
  let tool=null,selectedId=null,panel=null,preview=null,awaiting=false,gesture=null,styleEdit=null,raf=0,width=0,height=0,bindTimer=0,activeSymbol=state.symbol,activePeriod=state.period,cacheRows=null,cacheTimes=[];
  const current=(symbol=state.symbol)=>Array.isArray(symbols[symbol])?symbols[symbol]:[];
  const selected=()=>current().find(d=>d.id===selectedId)||null;
  const visible=d=>!d.hidden&&(d.visibility!=='period'||d.originPeriod===state.period);
  const stack=(symbol=state.symbol)=>{if(!history.has(symbol))history.set(symbol,{past:[],future:[]});return history.get(symbol);};
  function commit(before,symbol=state.symbol){
    if(before!==JSON.stringify(current(symbol))){const h=stack(symbol);h.past.push(before);if(h.past.length>80)h.past.shift();h.future=[];write();}
    syncUI();schedule();
  }
  function flushStyle(){if(styleEdit){const {before,symbol}=styleEdit;styleEdit=null;commit(before,symbol);}}
  function change(fn){flushStyle();const before=JSON.stringify(current());fn();commit(before);}
  function undo(redo=false){flushStyle();cancel();const h=stack(),from=redo?h.future:h.past,to=redo?h.past:h.future;if(!from.length)return;to.push(JSON.stringify(current()));symbols[state.symbol]=JSON.parse(from.pop());selectedId=null;panel=null;write();syncUI();schedule();announce(redo?'已重做':'已復原');}
  function schedule(){if(!life.signal.aborted&&!raf)raf=requestAnimationFrame(draw);}
  const colorOf=d=>document.body.classList.contains('theme-light')&&['#f3f1e9','#f4f0e8'].includes(d.color||prefs.color)?'#397eae':d.color||prefs.color;
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const formatPrice=n=>Number(n.toPrecision(10)).toLocaleString('zh-TW',{maximumFractionDigits:10});
  function times(){if(cacheRows!==state.candleData){cacheRows=state.candleData;cacheTimes=(cacheRows||[]).map(d=>epoch(d.time));}return cacheTimes;}
  function step(){const t=times(),ds=[];for(let i=Math.max(1,t.length-24);i<t.length;i++)if(t[i]>t[i-1])ds.push(t[i]-t[i-1]);ds.sort((a,b)=>a-b);return ds[Math.floor(ds.length/2)]||86400;}
  function indexOfTime(t){const rows=times();let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>1;if(rows[m]<t)lo=m+1;else hi=m;}return lo;}
  function timeToLogical(t){const rows=times();if(!rows.length)return null;t=epoch(t);const i=indexOfTime(t);if(rows[i]===t)return i;if(i===0)return (t-rows[0])/step();if(i===rows.length)return rows.length-1+(t-rows.at(-1))/step();return i-1+(t-rows[i-1])/(rows[i]-rows[i-1]);}
  function logicalToTime(logical){const rows=times();if(!rows.length||!Number.isFinite(logical))return null;const i=Math.floor(logical),f=logical-i;if(i<0)return Math.round(rows[0]+logical*step());if(i>=rows.length-1)return Math.round(rows.at(-1)+(logical-rows.length+1)*step());return Math.round(rows[i]+f*(rows[i+1]-rows[i]));}
  function xOf(time){return state.chart.timeScale().logicalToCoordinate(timeToLogical(time));}
  function pointXY(p){return {x:xOf(p.time),y:state.candleSeries.priceToCoordinate(p.price)};}
  function pointAt(x,y,event={},snap=true){
    const ts=state.chart.timeScale(),logical=ts.coordinateToLogical(x);let time=logicalToTime(logical),price=state.candleSeries.coordinateToPrice(y);
    if(time===null||!Number.isFinite(price))return null;
    let mode=prefs.magnet===true?'weak':prefs.magnet;
    if(event.ctrlKey||event.metaKey)mode=mode?false:'weak';
    if(mode&&snap){const row=state.candleData[Math.max(0,Math.min(state.candleData.length-1,Math.round(logical)))];if(row){const cx=xOf(row.time),choices=[row.open,row.high,row.low,row.close].filter(Number.isFinite);let best=null,distance=Infinity;for(const value of choices){const dy=Math.abs(state.candleSeries.priceToCoordinate(value)-y);if(dy<distance){distance=dy;best=value;}}if(best!==null&&(mode==='strong'||Math.hypot(cx-x,distance)<=16)){time=epoch(row.time);price=best;}}}
    return {time,price};
  }
  function rgba(hex,alpha){const c=/^#[a-f0-9]{6}$/i.test(hex)?hex:'#f3f1e9';return `rgba(${parseInt(c.slice(1,3),16)},${parseInt(c.slice(3,5),16)},${parseInt(c.slice(5,7),16)},${alpha/100})`;}
  const distance=(x,y,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-a.x-t*dx,y-a.y-t*dy);};
  function segment(d){let a=pointXY(d.a),b=pointXY(d.b);if(Math.abs(b.x-a.x)>0.01){const y=x=>a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);if(d.type==='ray'){const x=b.x>a.x?width:0;b={x,y:y(x)};}else{const aa=a;if(d.extendLeft)a={x:0,y:y(0)};if(d.extendRight)b={x:width,y:aa.y+(b.y-aa.y)*(width-aa.x)/(b.x-aa.x)};}}return [a,b];}
  function hit(d,x,y){
    const a=pointXY(d.a),b=pointXY(d.b);if(!Number.isFinite(a.x)||!Number.isFinite(a.y))return Infinity;
    if(freehand(d)){const points=strokePoints(d).map(pointXY);return Math.min(...points.map((p,i)=>i?distance(x,y,points[i-1],p):Math.hypot(x-p.x,y-p.y)))-Math.min(8,(d.width||2)/2);}
    if(d.type==='emoji')return Math.max(0,Math.hypot(x-a.x,y-a.y)-(d.emojiSize||28)/2);
    if(position(d)){const stopY=state.candleSeries.priceToCoordinate(d.stopPrice);if(!Number.isFinite(stopY))return Infinity;const l=Math.min(a.x,b.x),r=Math.max(a.x,b.x),top=Math.min(a.y,b.y,stopY),bottom=Math.max(a.y,b.y,stopY);return Math.hypot(Math.max(l-x,0,x-r),Math.max(top-y,0,y-bottom));}
    if(d.type==='horizontal')return Math.abs(y-a.y);
    if(d.type==='horizontalRay')return x>=a.x-10?Math.abs(y-a.y):Infinity;
    if(d.type==='vertical')return Math.abs(x-a.x);
    if(!Number.isFinite(b.x)||!Number.isFinite(b.y))return Infinity;
    const l=Math.min(a.x,b.x),r=Math.max(a.x,b.x),t=Math.min(a.y,b.y),bt=Math.max(a.y,b.y);
    if(d.type==='rectangle'||d.type==='measure')return Math.min(distance(x,y,{x:l,y:t},{x:r,y:t}),distance(x,y,{x:l,y:bt},{x:r,y:bt}),distance(x,y,{x:l,y:t},{x:l,y:bt}),distance(x,y,{x:r,y:t},{x:r,y:bt}));
    if(d.type==='ellipse'){const rx=Math.max(1,(r-l)/2),ry=Math.max(1,(bt-t)/2);return Math.abs(Math.hypot((x-(l+r)/2)/rx,(y-(t+bt)/2)/ry)-1)*Math.min(rx,ry);}
    if(d.type==='fib')return x>=l-8&&x<=r+8?Math.min(...(d.levels||prefs.fib).map(n=>Math.abs(y-(a.y+(b.y-a.y)*n)))):Infinity;
    return distance(x,y,...segment(d));
  }
  function nearest(x,y,touch=false){let best=null,min=touch?20:9;for(const d of [...current()].reverse()){if(!visible(d))continue;const dist=hit(d,x,y);if(dist<min){min=dist;best=d;}if(d.id===selectedId){const a=pointXY(d.a),b=pointXY(d.b);if(Math.min(Math.hypot(x-a.x,y-a.y),Math.hypot(x-b.x,y-b.y))<(touch?22:11))return d;}}return best;}
  function label(ctx,text,x,y){ctx.font='11px system-ui';const w=ctx.measureText(text).width+12;x=Math.max(4,Math.min(width-w-4,x));y=Math.max(17,Math.min(height-5,y));ctx.fillStyle=document.body.classList.contains('theme-light')?'#ffffffee':'#171b22ee';ctx.fillRect(x,y-15,w,20);ctx.fillStyle=document.body.classList.contains('theme-light')?'#25374a':'#f3f1e9';ctx.fillText(text,x+6,y);}
  function render(ctx,d,ghost=false){
    const a=pointXY(d.a),b=pointXY(d.b);if(![a.x,a.y,b.x,b.y].every(Number.isFinite))return;
    ctx.strokeStyle=colorOf(d);ctx.fillStyle=colorOf(d);ctx.lineWidth=d.width||2;ctx.setLineDash(d.dash==='dashed'?[8,5]:d.dash==='dotted'?[2,4]:[]);
    const l=Math.min(a.x,b.x),t=Math.min(a.y,b.y),w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);
    if(freehand(d)){const points=strokePoints(d).map(pointXY).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));ctx.lineCap='round';ctx.lineJoin='round';if(d.type==='highlighter')ctx.globalAlpha*=.32;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));if(points.length===1){ctx.arc(points[0].x,points[0].y,(d.width||2)/2,0,Math.PI*2);ctx.fill();}else ctx.stroke();}
    else if(d.type==='emoji'){ctx.font=`${d.emojiSize||28}px system-ui,"Apple Color Emoji","Segoe UI Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(EMOJIS.includes(d.emoji)?d.emoji:'🚀',a.x,a.y);ctx.textAlign='start';ctx.textBaseline='alphabetic';}
    else if(position(d)){const stopY=state.candleSeries.priceToCoordinate(d.stopPrice);if(!Number.isFinite(stopY))return;const rr=riskReward(d);ctx.setLineDash([]);ctx.fillStyle=rgba('#36bca3',22);ctx.fillRect(l,Math.min(a.y,b.y),w,Math.abs(a.y-b.y));ctx.fillStyle=rgba('#ef6077',22);ctx.fillRect(l,Math.min(a.y,stopY),w,Math.abs(a.y-stopY));for(const [y,color]of [[b.y,'#36bca3'],[stopY,'#ef6077'],[a.y,colorOf(d)]]){ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(l+w,y);ctx.stroke();}label(ctx,`${direction(d)>0?'多單':'空單'} · 盈虧比 ${rr?rr.ratio.toFixed(2)+' : 1':'—'}`,l,a.y-7);if(d.id===selectedId&&!ghost){label(ctx,`目標 ${formatPrice(d.b.price)}`,l,b.y-7);label(ctx,`止損 ${formatPrice(d.stopPrice)}`,l,stopY+20);}}
    else if(d.type==='horizontal'||d.type==='horizontalRay'){ctx.beginPath();ctx.moveTo(d.type==='horizontal'?0:a.x,a.y);ctx.lineTo(width,a.y);ctx.stroke();}
    else if(d.type==='vertical'){ctx.beginPath();ctx.moveTo(a.x,0);ctx.lineTo(a.x,height);ctx.stroke();}
    else if(d.type==='rectangle'||d.type==='measure'){ctx.fillStyle=rgba(colorOf(d),d.fill??12);ctx.fillRect(l,t,w,h);ctx.strokeRect(l,t,w,h);if(d.type==='measure'){const diff=d.b.price-d.a.price,pct=d.a.price?diff/d.a.price*100:0,bars=Math.round(Math.abs(timeToLogical(d.b.time)-timeToLogical(d.a.time)));label(ctx,`${diff>=0?'+':''}${formatPrice(diff)} (${pct.toFixed(2)}%) · ${bars} 根`,l,t-7);}}
    else if(d.type==='ellipse'){ctx.beginPath();ctx.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.max(1,w/2),Math.max(1,h/2),0,0,Math.PI*2);ctx.fillStyle=rgba(colorOf(d),d.fill??12);ctx.fill();ctx.stroke();}
    else if(d.type==='fib'){ctx.font='10px system-ui';for(const n of d.levels||prefs.fib){const y=a.y+(b.y-a.y)*n;ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(l+w,y);ctx.stroke();ctx.fillText(`${n} · ${formatPrice(d.a.price+(d.b.price-d.a.price)*n)}`,l+4,y-4);}}
    else{const [s,e]=segment(d);ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(e.x,e.y);ctx.stroke();if(d.type==='arrow'){const angle=Math.atan2(b.y-a.y,b.x-a.x);for(const sign of [-1,1]){ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-12*Math.cos(angle+sign*.5),b.y-12*Math.sin(angle+sign*.5));ctx.stroke();}}}
    if(d.id===selectedId&&!ghost){ctx.setLineDash([]);const handles=position(d)?[a,b,{x:b.x,y:state.candleSeries.priceToCoordinate(d.stopPrice)}]:freehand(d)?[]:['horizontal','vertical','emoji'].includes(d.type)?[a]:[a,b];for(const p of handles){ctx.beginPath();ctx.arc(p.x,p.y,matchMedia('(pointer:coarse)').matches?6:5,0,2*Math.PI);ctx.fillStyle=d.locked?'#777':colorOf(d);ctx.fill();ctx.strokeStyle=document.body.classList.contains('theme-light')?'#fff':'#111';ctx.lineWidth=2;ctx.stroke();}}
  }
  function draw(){
    raf=0;if(life.signal.aborted||!state.chart||!state.candleSeries)return;
    width=Math.max(0,chartEl.clientWidth-(state.chartPriceAxisWidth||state.chart.priceScale('right').width?.()||0));height=Math.max(0,chartEl.clientHeight-(state.chart.timeScale().height?.()||0));
    box.style.setProperty('--drawing-tool-top',`${Math.max(4,chartEl.offsetTop+5)}px`);
    const dpr=window.devicePixelRatio||1;layer.style.width=`${width}px`;layer.style.height=`${height}px`;if(layer.width!==Math.round(width*dpr)||layer.height!==Math.round(height*dpr)){layer.width=Math.round(width*dpr);layer.height=Math.round(height*dpr);}
    inspector.style.maxHeight=`${Math.max(100,box.clientHeight-(matchMedia('(max-width:900px)').matches?150:90))}px`;
    const ctx=layer.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);for(const d of current())if(visible(d)){ctx.save();render(ctx,d);ctx.restore();}if(preview){ctx.save();ctx.globalAlpha=.75;render(ctx,preview,true);ctx.restore();}
  }
  const localPoint=e=>{const r=chartEl.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
  const inPlot=p=>p.x>=0&&p.x<width&&p.y>=0&&p.y<height;
  function showHint(p,screen){hint.textContent=`${formatPrice(p.price)} · ${new Date(p.time*1000).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}`;hint.hidden=false;hint.style.left=`${Math.max(4,Math.min(width-240,screen.x-110))}px`;hint.style.top=`${Math.max(4,Math.min(height-28,screen.y-46))}px`;}
  function choose(d){flushStyle();if(selectedId!==d?.id)inspector.querySelector('.drawing-advanced').open=false;selectedId=d?.id||null;panel=null;syncUI();schedule();}
  function begin(p,event,touch=false){
    if(!toolsVisible()||!state.chart||!state.candleData?.length||!inPlot(p))return false;
    syncScope();
    if(tool){const point=pointAt(p.x,p.y,event,!freehand({type:tool}));if(!point)return false;const style={color:tool==='highlighter'?'#ffe66d':prefs.color,width:tool==='highlighter'?12:prefs.width,fill:prefs.fill,dash:'solid',...(prefs.tools[tool]||{})};
      if(!awaiting){preview={type:tool,a:point,b:{...point},...style,levels:tool==='fib'?[...prefs.fib]:undefined};if(freehand(preview))preview.points=[point];if(preview.type==='emoji'){preview.emoji=EMOJIS.includes(prefs.emoji)?prefs.emoji:'🚀';preview.emojiSize=style.emojiSize||28;panel=null;}if(position(preview)){const sign=direction(preview);preview.b=pointAt(Math.min(width-5,p.x+Math.min(140,width*.35)),p.y-sign*height*.12,{},false)||point;preview.stopPrice=pointAt(p.x,p.y+sign*height*.06,{},false)?.price;}}
      else preview.b=point;
      gesture={kind:'draw',start:p,touch,moved:false,second:awaiting,symbol:state.symbol};syncUI();return true;
    }
    const d=nearest(p.x,p.y,touch);
    if(touch&&(!d||d.id!==selectedId||d.locked))return false;
    if(!d){choose(null);return false;}
    choose(d);if(d.locked)return !touch;
    const a=pointXY(d.a),b=pointXY(d.b),radius=touch?22:11;
    const stopY=position(d)?state.candleSeries.priceToCoordinate(d.stopPrice):null;
    const handle=freehand(d)?'move':position(d)&&Math.hypot(p.x-b.x,p.y-stopY)<radius?'stop':Math.hypot(p.x-a.x,p.y-a.y)<radius?'a':!['horizontal','vertical','emoji'].includes(d.type)&&Math.hypot(p.x-b.x,p.y-b.y)<radius?'b':'move';
    gesture={kind:'edit',id:d.id,handle,start:p,original:clone(d),xy:{a,b,points:freehand(d)?strokePoints(d).map(pointXY):null},before:JSON.stringify(current()),symbol:state.symbol,touch,moved:false};syncUI();return true;
  }
  function move(p,event={}){
    if(!gesture){if(preview&&awaiting){preview.b=pointAt(p.x,p.y,event)||preview.b;schedule();}return;}
    if(gesture.symbol!==state.symbol){cancel();return;}
    const dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;if(Math.hypot(dx,dy)>3)gesture.moved=true;
    if(gesture.kind==='draw'){const point=pointAt(p.x,p.y,event,!freehand(preview));if(point){preview.b=point;if(freehand(preview)){const previous=pointXY(preview.points.at(-1));if(Math.hypot(p.x-previous.x,p.y-previous.y)>2){if(preview.points.length>=2000)preview.points=preview.points.filter((_,i)=>i%2===0);preview.points.push(point);}}else if(position(preview)){const delta=Math.max(Math.abs(point.price-preview.a.price),Math.abs(preview.a.price)*.00001);preview.b.price=preview.a.price+direction(preview)*delta;preview.stopPrice=preview.a.price-direction(preview)*delta/2;}else if(event.shiftKey){if(Math.abs(dx)>Math.abs(dy))preview.b.price=preview.a.price;else preview.b.time=preview.a.time;}showHint(preview.b,p);}}
    else{const d=current().find(n=>n.id===gesture.id);if(!d)return;
      if(gesture.handle==='move'){const a=pointAt(gesture.xy.a.x+dx,gesture.xy.a.y+dy,event,!freehand(d));if(a){const snapped=pointXY(a),deltaX=snapped.x-gesture.xy.a.x,deltaY=snapped.y-gesture.xy.a.y;d.a=a;d.b=pointAt(gesture.xy.b.x+deltaX,gesture.xy.b.y+deltaY,{},false)||gesture.original.b;if(position(d))d.stopPrice=gesture.original.stopPrice+a.price-gesture.original.a.price;if(freehand(d)){d.points=gesture.xy.points.map((p,i)=>pointAt(p.x+deltaX,p.y+deltaY,{},false)||gesture.original.points?.[i]).filter(validPoint);d.a=d.points[0];d.b=d.points.at(-1);}}}
      else if(gesture.handle==='stop')d.stopPrice=pointAt(p.x,p.y,event)?.price??d.stopPrice;
      else{d[gesture.handle]=pointAt(p.x,p.y,event)||d[gesture.handle];if(d.type==='emoji')d.b={...d.a};}
      if(gesture.moved)showHint(gesture.handle==='stop'?{time:d.b.time,price:d.stopPrice}:d[gesture.handle==='b'?'b':'a'],p);
    }
    schedule();
  }
  function finish(){
    if(!gesture)return;const g=gesture;gesture=null;hint.hidden=true;
    if(g.kind==='draw'&&preview){
      if(freehand(preview)){preview.a=preview.points[0];preview.b=preview.points.at(-1);}
      const one=['horizontal','horizontalRay','vertical','emoji'].includes(preview.type)||position(preview)||freehand(preview);
      if(!one&&!g.moved&&!g.second){awaiting=true;syncUI();schedule();return;}
      const a=pointXY(preview.a),b=pointXY(preview.b);
      if(one||Math.hypot(a.x-b.x,a.y-b.y)>3){const before=JSON.stringify(current());const d={...preview,id:id(),originPeriod:state.period,visibility:'all'};(symbols[state.symbol] ||= []).push(d);preview=null;awaiting=false;panel=null;inspector.querySelector('.drawing-advanced').open=false;selectedId=prefs.keepDrawing?null:d.id;if(!prefs.keepDrawing)tool=null;commit(before);announce(`${TYPES[d.type]}已儲存`);}
      else{preview=null;awaiting=false;}
    }else if(g.kind==='edit')commit(g.before,g.symbol);
    syncUI();schedule();
  }
  function cancel({exit=false}={}){
    if(gesture?.kind==='edit'){const d=current(gesture.symbol).find(n=>n.id===gesture.id);if(d)Object.assign(d,gesture.original);}
    gesture=null;preview=null;awaiting=false;hint.hidden=true;if(exit)tool=null;syncUI();schedule();
  }
  function syncScope(){if(activeSymbol!==state.symbol||activePeriod!==state.period){flushStyle();cancel({exit:true});selectedId=null;panel=null;activeSymbol=state.symbol;activePeriod=state.period;cacheRows=null;}}
  const dateValue=t=>new Date(t*1000+8*3600000).toISOString().slice(0,19);
  function syncUI(){
    const active=toolsVisible();toolbar.hidden=!active;
    toolbar.classList.toggle('is-folded',!!prefs.collapsed);toolbar.dataset.mode=tool?'draw':'cursor';toolbar.dataset.tool=tool||'';
    toolbar.querySelector('[data-action="cursor"]').setAttribute('aria-pressed',String(!tool));toolbar.querySelector('[data-action="menu"]').setAttribute('aria-pressed',String(!!tool));toolbar.querySelector('[data-action="menu"]').setAttribute('aria-expanded',String(panel==='menu'));
    const magnet=toolbar.querySelector('[data-action="magnet"]'),magnetMode=prefs.magnet===true?'weak':prefs.magnet;magnet.setAttribute('aria-pressed',String(!!magnetMode));magnet.dataset.magnet=magnetMode||'off';magnet.setAttribute('aria-label',`磁鐵吸附：${magnetMode==='strong'?'強':magnetMode?'弱':'停用'}（M）`);magnet.title=magnet.getAttribute('aria-label');toolbar.querySelector('[data-action="repeat"]').setAttribute('aria-pressed',String(prefs.keepDrawing));
    toolbar.querySelector('[data-action="undo"]').disabled=!stack().past.length;toolbar.querySelector('[data-action="redo"]').disabled=!stack().future.length;
    toolbar.querySelector('.drawing-tool-menu').hidden=panel!=='menu';toolbar.querySelector('.drawing-object-list').hidden=panel!=='objects';toolbar.querySelectorAll('[data-draw]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.draw===tool)));
    toolbar.querySelector('.drawing-emoji-menu').hidden=panel!=='emoji';
    if(panel==='objects')renderList();
    const d=selected();editor.hidden=!active||!d||!visible(d);inspector.hidden=!active||!d||panel!=='settings';editor.querySelector('.drawing-width-menu').hidden=!d||panel!=='width';
    layer.classList.toggle('is-editing',!!tool||!!gesture);chartEl.dataset.drawingMode=tool?'draw':gesture?'edit':'cursor';chartEl.dataset.selectedDrawing=d?.id||'';
    if(d){
      const color=editor.querySelector('[data-setting="color"]');color.value=d.color||prefs.color;editor.querySelector('[data-width-label]').textContent=d.width||2;editor.querySelector('[data-dash-label]').textContent=d.dash==='dashed'?'┄':d.dash==='dotted'?'┈':'━';editor.querySelector('[data-action="lock"]').setAttribute('aria-pressed',String(!!d.locked));
      inspector.querySelector('[data-inspector-title]').textContent=TYPES[d.type]||'圖形設定';
      const priceValue=n=>Number.isFinite(n)?Number(n.toPrecision(10)):'';
      const values={name:d.name||'',visibility:d.visibility||'all',fill:d.fill??12,levels:(d.levels||prefs.fib).join(', '),'a-price':priceValue(d.a.price),'b-price':priceValue(d.b.price),'a-time':dateValue(d.a.time),'b-time':dateValue(d.b.time),stopPrice:priceValue(d.stopPrice),emoji:d.emoji||'🚀',emojiSize:d.emojiSize||28,extendLeft:!!d.extendLeft,extendRight:!!d.extendRight};
      for(const input of inspector.querySelectorAll('[data-setting]'))if(document.activeElement!==input){const value=values[input.dataset.setting];if(input.type==='checkbox')input.checked=value;else input.value=value;}
      inspector.querySelector('.fib-setting').hidden=d.type!=='fib';inspector.querySelector('.drawing-fill').hidden=!['rectangle','ellipse','measure'].includes(d.type);inspector.querySelector('.drawing-extend').hidden=!['trend','arrow'].includes(d.type);
      inspector.querySelector('.drawing-stop').hidden=!position(d);inspector.querySelectorAll('.drawing-emoji-setting').forEach(el=>el.hidden=d.type!=='emoji');
      const rr=inspector.querySelector('.drawing-rr'),stats=position(d)?riskReward(d):null;rr.hidden=!position(d);rr.textContent=stats?`盈虧比 ${stats.ratio.toFixed(2)} : 1 · 目標 ${((stats.reward/Math.abs(d.a.price))*100).toFixed(2)}% · 風險 ${((stats.risk/Math.abs(d.a.price))*100).toFixed(2)}%`:direction(d)>0?'多單價格需符合：止損 < 進場 < 目標':'空單價格需符合：目標 < 進場 < 止損';rr.dataset.invalid=String(!stats);
      for(const p of ['a','b']){const label=position(d)?p==='a'?'進場價格':'目標價格':p==='a'?'起點價格':'終點價格';inspector.querySelector(`[data-price-label="${p}"]`).textContent=label;inspector.querySelector(`[data-setting="${p}-price"]`).setAttribute('aria-label',label);}
      inspector.querySelector('[data-setting="a-price"]').parentElement.hidden=freehand(d)||d.type==='emoji';inspector.querySelector('[data-setting="a-time"]').parentElement.hidden=freehand(d);
      const single=['horizontal','horizontalRay','vertical','emoji'].includes(d.type)||freehand(d);inspector.querySelector('[data-setting="b-price"]').parentElement.hidden=single;inspector.querySelector('[data-setting="b-time"]').parentElement.hidden=single;
      editor.querySelector('.drawing-color').hidden=d.type==='emoji';editor.querySelector('[data-action="width"]').hidden=d.type==='emoji';editor.querySelector('[data-action="dash"]').hidden=d.type==='emoji'||freehand(d)||position(d);
    }
  }
  function renderList(){const list=toolbar.querySelector('.drawing-object-list');list.innerHTML=`<strong>圖形清單</strong>`+(current().length?current().map(d=>`<div class="drawing-object-row"><button type="button" data-object="${escape(d.id)}" aria-pressed="${d.id===selectedId}"><i style="background:${/^#[a-f0-9]{6}$/i.test(d.color)?d.color:prefs.color}"></i><span>${escape(d.name||TYPES[d.type]||'圖形')}<small>${escape(d.originPeriod||'')} ${d.visibility==='period'?'· 僅此週期':''}</small></span></button><button type="button" data-hide="${escape(d.id)}" aria-label="${d.hidden?'顯示':'隱藏'}圖形">${d.hidden?'○':'◉'}</button><button type="button" data-lock="${escape(d.id)}" aria-label="${d.locked?'解鎖':'鎖定'}圖形">${d.locked?'▣':'□'}</button></div>`).join(''):'<small>此標的尚無畫線</small>');}
  function action(event){
    const button=event.target.closest('button');if(!button)return;event.stopPropagation();
    if(button.dataset.draw){flushStyle();cancel();tool=tool===button.dataset.draw?null:button.dataset.draw;selectedId=null;panel=tool==='emoji'?'emoji':null;}
    else if(button.dataset.emoji){prefs.emoji=button.dataset.emoji;savePrefs();panel=null;}
    else if(button.dataset.object){const d=current().find(d=>d.id===button.dataset.object);if(d){if(d.hidden)change(()=>d.hidden=false);choose(d);panel='settings';}}
    else if(button.dataset.hide){const d=current().find(d=>d.id===button.dataset.hide);if(d)change(()=>{d.hidden=!d.hidden;if(d.hidden&&selectedId===d.id)selectedId=null;});}
    else if(button.dataset.lock){const d=current().find(d=>d.id===button.dataset.lock);if(d)change(()=>d.locked=!d.locked);}
    else if(button.dataset.width){const d=selected();if(d)change(()=>{d.width=Number(button.dataset.width);remember(d);});panel=null;}
    else{const a=button.dataset.action,d=selected();
      if(a==='cursor'){flushStyle();cancel({exit:true});selectedId=null;panel=null;}
      else if(a==='fold'){prefs.collapsed=!prefs.collapsed;panel=null;savePrefs();}
      else if(a==='menu'||a==='objects'){panel=panel===a?null:a;}
      else if(a==='magnet'){prefs.magnet=!prefs.magnet?'weak':prefs.magnet==='strong'?false:'strong';savePrefs();}
      else if(a==='repeat'){prefs.keepDrawing=!prefs.keepDrawing;savePrefs();}
      else if(a==='undo'||a==='redo')undo(a==='redo');
      else if(a==='settings'||a==='width')panel=panel===a?null:a;
      else if(a==='close')panel=null;
      else if(a==='lock'&&d)change(()=>d.locked=!d.locked);
      else if(a==='dash'&&d)change(()=>{d.dash=({solid:'dashed',dashed:'dotted',dotted:'solid'})[d.dash||'solid'];remember(d);});
      else if(a==='delete'&&d)change(()=>{symbols[state.symbol]=current().filter(n=>n.id!==d.id);selectedId=null;panel=null;});
      else if(a==='copy'&&d)change(()=>{const copy={...clone(d),id:id(),locked:false};const offset=(state.candleSeries.coordinateToPrice(100)-state.candleSeries.coordinateToPrice(116))||0;copy.a.price+=offset;copy.b.price+=offset;if(position(copy))copy.stopPrice+=offset;if(freehand(copy))copy.points=strokePoints(copy).map(p=>({...p,price:p.price+offset}));current().push(copy);selectedId=copy.id;});
    }
    syncUI();schedule();
  }
  function remember(d){prefs.tools[d.type]={color:d.color,width:d.width,fill:d.fill,dash:d.dash,emojiSize:d.emojiSize};if(d.type==='emoji')prefs.emoji=d.emoji;savePrefs();}
  for(const el of [toolbar,editor,inspector])listen(el,'click',action);
  for(const el of [editor,inspector]){
    listen(el,'input',event=>{
      const input=event.target,name=input.dataset.setting,d=selected();if(!name||!d)return;
      if(!styleEdit)styleEdit={before:JSON.stringify(current()),symbol:state.symbol};
      if(name==='color'){if(/^#[0-9a-f]{6}$/i.test(input.value))d.color=input.value;}
      else if(name==='fill')d.fill=Number(input.value);
      else if(name==='name')d.name=input.value;
      else if(name==='visibility')d.visibility=input.value;
      else if(name==='stopPrice'){if(Number.isFinite(input.valueAsNumber))d.stopPrice=input.valueAsNumber;}
      else if(name==='emoji'&&EMOJIS.includes(input.value))d.emoji=input.value;
      else if(name==='emojiSize')d.emojiSize=Math.max(16,Math.min(48,Number(input.value)));
      else if(name.startsWith('extend'))d[name]=input.checked;
      else if(name==='levels'){const values=input.value.split(/[,，\s]+/).map(Number).filter(n=>Number.isFinite(n)&&n>=-5&&n<=10).slice(0,30);if(values.length)d.levels=values;}
      else if(name.endsWith('-price')){const p=name[0],price=input.valueAsNumber;if(Number.isFinite(price)){d[p].price=price;if(['horizontal','horizontalRay'].includes(d.type))d.b.price=price;}}
      else if(name.endsWith('-time')&&input.value){const time=Date.parse(input.value+'+08:00')/1000;if(Number.isFinite(time)){d[name[0]].time=time;if(d.type==='vertical'||d.type==='emoji')d.b.time=time;}}
      remember(d);syncUI();schedule();
    });
    listen(el,'change',()=>{flushStyle();syncUI();});
    listen(el,'focusout',()=>{flushStyle();});
  }
  listen(document,'pointerdown',event=>{if(!box.contains(event.target)){flushStyle();panel=null;syncUI();}});
  listen(document,'keydown',event=>{
    if(!box.isConnected||!box.getClientRects().length||!toolsVisible()||(!expanded()&&!box.contains(document.activeElement)&&!selectedId&&!tool))return;
    const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;
    if(key==='escape'&&(tool||selectedId||panel||gesture||preview)){flushStyle();cancel({exit:true});selectedId=null;panel=null;syncUI();event.preventDefault();event.stopImmediatePropagation();}
    else if(event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
    else if(mod&&(key==='z'||key==='y')){undo(key==='y'||event.shiftKey);event.preventDefault();event.stopImmediatePropagation();}
    else if((key==='delete'||key==='backspace')&&selected()){const d=selected();change(()=>{symbols[state.symbol]=current().filter(n=>n.id!==d.id);selectedId=null;panel=null;});event.preventDefault();event.stopImmediatePropagation();}
    else if(key==='m'&&!mod&&!event.altKey){prefs.magnet=!prefs.magnet?'weak':prefs.magnet==='strong'?false:'strong';savePrefs();syncUI();event.preventDefault();}
  },{capture:true});
  const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
  let mousePointer=null;
  listen(chartEl,'pointerdown',event=>{if(event.pointerType==='touch'||event.button!==0)return;const p=localPoint(event);if(begin(p,event)){mousePointer=event.pointerId;chartEl.setPointerCapture?.(event.pointerId);stop(event);}}, {capture:true});
  listen(chartEl,'pointermove',event=>{if(event.pointerType==='touch')return;if(event.buttons)schedule();const p=localPoint(event);if(gesture||awaiting){move(p,event);if(gesture)stop(event);}else chartEl.style.cursor=inPlot(p)&&nearest(p.x,p.y)?'pointer':'';},{capture:true});
  listen(chartEl,'pointerup',event=>{if(event.pointerType==='touch'||mousePointer!==event.pointerId)return;mousePointer=null;finish();if(chartEl.hasPointerCapture?.(event.pointerId))chartEl.releasePointerCapture(event.pointerId);stop(event);},{capture:true});
  listen(chartEl,'pointercancel',()=>{mousePointer=null;cancel();},{capture:true});
  listen(chartEl,'dblclick',event=>{if(event.pointerType==='touch'||!toolsVisible())return;const p=localPoint(event),d=inPlot(p)?nearest(p.x,p.y):null;if(d){choose(d);panel='settings';syncUI();stop(event);}},{capture:true});
  const controller={
    touchStart(event){return begin(localPoint(event.touches[0]),{},true);},
    touchMove(event){if(gesture){move(localPoint(event.touches[0]));return true;}return false;},
    touchEnd(){if(gesture){finish();return true;}return false;},
    tap(point){const p=localPoint({clientX:point.x,clientY:point.y});if(!toolsVisible()||!inPlot(p))return false;const d=nearest(p.x,p.y,true);choose(d);return !!d;},
    cancel(){cancel({exit:true});},isActive(){return !!tool||!!gesture||!!preview;}
  };
  chartEl.oxDrawingController=controller;
  function sync(){syncScope();if(selected()&&!visible(selected()))selectedId=null;syncUI();schedule();}
  const observer=new ResizeObserver(schedule);observer.observe(chartEl);
  const mutation=new MutationObserver(()=>{if(!toolsVisible()){flushStyle();cancel({exit:true});selectedId=null;panel=null;}sync();});mutation.observe(document.body,{attributes:true,attributeFilter:['class']});if(radar)mutation.observe(radar,{attributes:true,attributeFilter:['class']});
  for(const type of ['ox:chartdata','ox:chartpriceview','ox:themechange','ox:marketchange','fullscreenchange','webkitfullscreenchange'])listen(document,type,sync);
  listen(chartEl,'wheel',schedule,{passive:true});listen(chartEl,'dblclick',schedule,{capture:true,passive:true});listen(window,'resize',sync,{passive:true});listen(window,'pagehide',flushStyle);
  let boundChart=null;
  function bind(){if(life.signal.aborted)return;if(!state.chart){bindTimer=setTimeout(bind,50);return;}boundChart=state.chart;boundChart.timeScale().subscribeVisibleLogicalRangeChange(sync);sync();}
  bind();
  return {sync,destroy(){flushStyle();cancel({exit:true});life.abort();clearTimeout(bindTimer);cancelAnimationFrame(raf);observer.disconnect();mutation.disconnect();boundChart?.timeScale().unsubscribeVisibleLogicalRangeChange?.(sync);if(chartEl.oxDrawingController===controller)delete chartEl.oxDrawingController;delete chartEl.dataset.drawingMode;delete chartEl.dataset.selectedDrawing;box.style.removeProperty('--drawing-tool-top');chartEl.style.cursor='';for(const el of [toolbar,editor,inspector,layer,hint,status])el.remove();}};
};
window.OXChartDrawings({box:document.querySelector('#view-radar .chart-box'),chartEl:document.getElementById('chart'),state});
