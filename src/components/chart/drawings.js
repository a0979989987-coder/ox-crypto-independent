/* Shared chart drawings. Each market supplies its own chart state and storage scope. */
window.OXChartDrawings = function mountChartDrawings({box,chartEl,state,market='crypto',isExpanded}={}) {
  if (!box || !chartEl) return;
  const drawingKey = market==='crypto'?'ox-chart-drawings-v1':`ox-${market}-chart-drawings-v1`;
  const prefsKey = market==='crypto'?'ox-chart-drawing-preferences-v1':`ox-${market}-chart-drawing-preferences-v1`;
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; } };
  const drawings = read(drawingKey, {});
  const prefs = Object.assign({ color: '#f3f1e9', width: 2, fill: 12, magnet: false, fib: [0, .236, .382, .5, .618, .786, 1], x: null, y: null, collapsed: false }, read(prefsKey, {}));
  const save = () => { try { localStorage.setItem(drawingKey, JSON.stringify(drawings)); } catch (_) {} };
  const savePrefs = () => { try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch (_) {} };
  const life=new AbortController();let bindTimer=0;
  const listen=(target,type,handler,options={})=>target.addEventListener(type,handler,{...(typeof options==='boolean'?{capture:options}:options),signal:life.signal});
  const toolbar = document.createElement('div');
  toolbar.className = 'chart-drawing-tools';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '圖表畫線工具');
  toolbar.innerHTML = `
    <button type="button" data-action="fold" aria-label="收合畫線工具" title="收合／展開工具列">≡</button>
    <span class="drawing-grip" title="拖動工具列" aria-label="拖動工具列">⋮⋮</span>
    <div class="drawing-tools-content">
      <button type="button" data-action="none" aria-label="不畫圖／拖動圖表" title="不畫圖／拖動圖表">↖</button>
      <button type="button" data-action="select" aria-label="選取與移動畫線" title="選取與移動畫線">⌖</button>
      <button type="button" data-action="menu" aria-label="選擇畫線工具" aria-haspopup="true" aria-expanded="false" title="畫線工具">╱<small>▾</small></button>
      <button type="button" data-action="magnet" aria-label="磁鐵吸附（M）" title="磁鐵吸附 K 線開高低收；M 切換，按住 Ctrl 暫時反轉">⋃</button>
      <button type="button" data-action="settings" aria-label="編輯畫線樣式" title="編輯所選畫線">⚙</button>
      <button type="button" data-action="delete" aria-label="刪除所選畫線" title="刪除所選畫線" hidden>⌫</button>
      <button type="button" data-action="undo" aria-label="復原上一條畫線" title="復原上一條">↶</button>
    </div>
    <div class="drawing-tool-menu" role="menu" hidden>
      <span>線條</span>
      <button type="button" role="menuitem" data-draw="trend">趨勢線</button>
      <button type="button" role="menuitem" data-draw="ray">射線</button>
      <button type="button" role="menuitem" data-draw="horizontal">水平線</button>
      <button type="button" role="menuitem" data-draw="vertical">垂直線</button>
      <button type="button" role="menuitem" data-draw="arrow">箭頭</button>
      <span>圖形與測量</span>
      <button type="button" role="menuitem" data-draw="rectangle">矩形</button>
      <button type="button" role="menuitem" data-draw="ellipse">橢圓</button>
      <button type="button" role="menuitem" data-draw="fib">斐波那契回撤</button>
    </div>
    <div class="drawing-tool-inspector" hidden>
      <label>顏色 <input type="color" data-setting="color" aria-label="畫線顏色"></label>
      <label>粗度 <input type="range" data-setting="width" min="1" max="8" step="1" aria-label="畫線粗度"><output data-value="width"></output></label>
      <label>填色 <input type="range" data-setting="fill" min="0" max="70" step="1" aria-label="圖形填色透明度"><output data-value="fill"></output></label>
      <label class="fib-setting">斐波那契級別（逗號分隔） <input type="text" data-setting="fib" aria-label="斐波那契級別" inputmode="decimal"></label>
      <small>選取圖形後拖動；端點可調整形狀。設定保存在此裝置。</small>
    </div>`;
  box.append(toolbar);
  const layer = document.createElement('canvas');
  layer.className = 'chart-drawing-layer';
  layer.setAttribute('aria-label', '圖表畫線區');
  chartEl.append(layer);
  let tool = null, selected = null, panel = null, preview = null, gesture = null, raf = 0, width = 0, height = 0;
  const expanded = isExpanded || (() => document.body.classList.contains('chart-focus') || document.fullscreenElement === box || document.webkitFullscreenElement === box);
  const scope = () => `${state.symbol}:${state.period}`;
  const current = () => Array.isArray(drawings[scope()]) ? drawings[scope()] : [];
  const schedule = () => { if (!life.signal.aborted && !raf) raf = requestAnimationFrame(draw); };
  const colorOf = item => {const color=item.color||prefs.color;return document.body.classList.contains('theme-light')&&['#f3f1e9','#f4f0e8'].includes(color)?'#4598df':color;};
  listen(document,'ox:themechange',schedule);
  const points = item => {
    const ts = state.chart.timeScale(), series = state.candleSeries;
    return [ts.timeToCoordinate(item.a.time), series.priceToCoordinate(item.a.price),
      ts.timeToCoordinate(item.b.time), series.priceToCoordinate(item.b.price)];
  };
  const levelsOf = item => Array.isArray(item.levels) && item.levels.length ? item.levels : prefs.fib;
  const rgba = (hex, alpha) => {
    const v = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#f3f1e9';
    return `rgba(${parseInt(v.slice(1,3),16)},${parseInt(v.slice(3,5),16)},${parseInt(v.slice(5,7),16)},${alpha / 100})`;
  };
  function renderItem(ctx, item) {
    const [x1,y1,x2,y2] = points(item);
    if (![x1,y1,x2,y2].every(Number.isFinite)) return;
    ctx.strokeStyle = colorOf(item);
    ctx.fillStyle = colorOf(item);
    ctx.lineWidth = item.width || prefs.width;
    ctx.shadowColor = colorOf(item);
    ctx.shadowBlur = item === selected ? 9 : 3;
    const left = Math.min(x1,x2), top = Math.min(y1,y2), w = Math.abs(x2-x1), h = Math.abs(y2-y1);
    if (item.type === 'vertical') { ctx.beginPath(); ctx.moveTo(x1,0); ctx.lineTo(x1,height); ctx.stroke(); }
    else if (item.type === 'horizontal') { ctx.beginPath(); ctx.moveTo(0,y1); ctx.lineTo(width,y1); ctx.stroke(); }
    else if (item.type === 'rectangle') { ctx.fillStyle = rgba(colorOf(item), item.fill ?? prefs.fill); ctx.fillRect(left,top,w,h); ctx.strokeRect(left,top,w,h); }
    else if (item.type === 'ellipse') { ctx.beginPath(); ctx.ellipse((x1+x2)/2,(y1+y2)/2,Math.max(1,w/2),Math.max(1,h/2),0,0,Math.PI*2); ctx.fillStyle = rgba(colorOf(item),item.fill ?? prefs.fill); ctx.fill(); ctx.stroke(); }
    else if (item.type === 'fib') {
      ctx.save(); ctx.font = '10px system-ui'; ctx.textAlign = 'right';
      for (const level of levelsOf(item)) {
        const y = y1+(y2-y1)*level;
        ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(left+w,y); ctx.stroke();
        ctx.fillText(`${Number((level*100).toFixed(2))}%`,left+w-3,y-3);
      }
      ctx.restore();
    } else {
      let endX = x2, endY = y2;
      if (item.type === 'ray' && Math.abs(x2-x1)>1) {
        endX = x2>x1 ? width : 0;
        endY = y1+(y2-y1)*(endX-x1)/(x2-x1);
      }
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(endX,endY); ctx.stroke();
      if (item.type === 'arrow') {
        const angle = Math.atan2(y2-y1,x2-x1);
        for (const sign of [-1,1]) { ctx.beginPath(); ctx.moveTo(x2,y2); ctx.lineTo(x2-13*Math.cos(angle+sign*.5),y2-13*Math.sin(angle+sign*.5)); ctx.stroke(); }
      }
    }
    if (item === selected && !['horizontal','vertical'].includes(item.type)) {
      ctx.shadowBlur=0;
      for (const [x,y] of [[x1,y1],[x2,y2]]) { ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill(); }
    }
  }
  function draw() {
    raf=0;
    if (life.signal.aborted || !state.chart || !state.candleSeries) return;
    width=Math.max(0,chartEl.clientWidth-(state.chartPriceAxisWidth||state.chart.priceScale('right').width?.()||0));
    height=Math.max(0,chartEl.clientHeight-(state.chart.timeScale().height?.()||0));
    layer.style.width=`${width}px`; layer.style.height=`${height}px`;
    const dpr=window.devicePixelRatio||1, pxW=Math.round(width*dpr), pxH=Math.round(height*dpr);
    if (layer.width!==pxW || layer.height!==pxH) {layer.width=pxW;layer.height=pxH;}
    const ctx=layer.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    current().forEach(item=>{ctx.save();renderItem(ctx,item);ctx.restore();});
    if (preview) {ctx.save();ctx.globalAlpha=.7;renderItem(ctx,preview);ctx.restore();}
  }
  function segmentDistance(x,y,x1,y1,x2,y2) {
    const dx=x2-x1,dy=y2-y1,t=Math.max(0,Math.min(1,((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(x-x1-t*dx,y-y1-t*dy);
  }
  function hit(item,x,y) {
    const [x1,y1,x2,y2]=points(item);
    if (item.type==='horizontal') return Number.isFinite(y1)?Math.abs(y-y1):Infinity;
    if (item.type==='vertical') return Number.isFinite(x1)?Math.abs(x-x1):Infinity;
    if (![x1,y1,x2,y2].every(Number.isFinite)) return Infinity;
    const left=Math.min(x1,x2),right=Math.max(x1,x2),top=Math.min(y1,y2),bottom=Math.max(y1,y2);
    if (item.type==='fib') return x>=left-8&&x<=right+8 ? Math.min(...levelsOf(item).map(n=>Math.abs(y-(y1+(y2-y1)*n)))) : Infinity;
    if (item.type==='rectangle' && x>=left&&x<=right&&y>=top&&y<=bottom) return 0;
    if (item.type==='rectangle') return Math.min(segmentDistance(x,y,left,top,right,top),segmentDistance(x,y,left,bottom,right,bottom),segmentDistance(x,y,left,top,left,bottom),segmentDistance(x,y,right,top,right,bottom));
    if (item.type==='ellipse') {const rx=Math.max(1,(right-left)/2),ry=Math.max(1,(bottom-top)/2),r=Math.hypot((x-(left+right)/2)/rx,(y-(top+bottom)/2)/ry); return Math.abs(r-1)*Math.min(rx,ry);}
    if (item.type==='ray' && Math.abs(x2-x1)>1) {const endX=x2>x1?width:0;return segmentDistance(x,y,x1,y1,endX,y1+(y2-y1)*(endX-x1)/(x2-x1));}
    return segmentDistance(x,y,x1,y1,x2,y2);
  }
  const nearest = (x,y) => {
    let best=null, distance=window.matchMedia('(max-width:900px)').matches?20:12;
    for (const item of [...current()].reverse()) {
      const d=hit(item,x,y);
      if (d<=distance) {best=item;distance=d;}
    }
    return best;
  };
  function pointAt(x,y,event) {
    const ts=state.chart.timeScale();
    let time=ts.coordinateToTime(Math.max(0,Math.min(width-1,x))) ?? state.candleData?.at(-1)?.time;
    let price=state.candleSeries.coordinateToPrice(Math.max(0,Math.min(height-1,y)));
    if (time==null || !Number.isFinite(price)) return null;
    // TradingView-like magnet: closest OHLC value on the nearest candle.
    if (Boolean(prefs.magnet) !== Boolean(event?.ctrlKey || event?.metaKey) && state.candleData?.length) {
      let bar=null, dx=Infinity;
      for (const row of state.candleData) {
        const cx=ts.timeToCoordinate(row.time);
        if (cx!=null && Math.abs(cx-x)<dx) {bar=row;dx=Math.abs(cx-x);}
      }
      if (bar) {
        time=bar.time;
        price=[bar.open,bar.high,bar.low,bar.close].reduce((a,b)=>Math.abs(b-price)<Math.abs(a-price)?b:a);
      }
    }
    return {time,price};
  }
  function sync() {
    if (!expanded()) {tool=null;selected=null;panel=null;gesture=null;preview=null;}
    if (selected && !current().includes(selected)) selected=null;
    toolbar.classList.toggle('is-folded',!!prefs.collapsed);
    toolbar.querySelector('[data-action="fold"]').setAttribute('aria-label',prefs.collapsed?'展開畫線工具':'收合畫線工具');
    toolbar.querySelector('[data-action="menu"]').setAttribute('aria-expanded',String(panel==='menu'));
    toolbar.querySelector('.drawing-tool-menu').hidden=panel!=='menu'||prefs.collapsed;
    toolbar.querySelector('.drawing-tool-inspector').hidden=panel!=='settings'||prefs.collapsed;
    toolbar.querySelector('[data-action="delete"]').hidden=!selected;
    toolbar.querySelector('[data-action="select"]').setAttribute('aria-pressed',String(tool==='select'));
    toolbar.querySelector('[data-action="none"]').setAttribute('aria-pressed',String(!tool));
    toolbar.querySelector('[data-action="magnet"]').setAttribute('aria-pressed',String(!!prefs.magnet));
    toolbar.querySelector('[data-action="menu"]').setAttribute('aria-pressed',String(!!tool&&tool!=='select'));
    toolbar.querySelectorAll('[data-draw]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.draw===tool)));
    layer.classList.toggle('is-editing',!!tool&&expanded());
    const settings=selected||prefs;
    toolbar.querySelector('[data-setting="color"]').value=/^#[0-9a-f]{6}$/i.test(settings.color)?settings.color:prefs.color;
    for (const name of ['width','fill']) {
      toolbar.querySelector(`[data-setting="${name}"]`).value=settings[name]??prefs[name];
      toolbar.querySelector(`[data-value="${name}"]`).textContent=String(settings[name]??prefs[name]);
    }
    toolbar.querySelector('.fib-setting').hidden=!!selected&&selected.type!=='fib';
    const input=toolbar.querySelector('[data-setting="fib"]');
    if (document.activeElement!==input) input.value=levelsOf(settings).join(', ');
    schedule();
  }
  listen(toolbar,'click', event=>{
    const button=event.target.closest('[data-draw],[data-action]');
    if (!button||!expanded()) return;
    const action=button.dataset.action||button.dataset.draw;
    if (action==='fold') {prefs.collapsed=!prefs.collapsed;panel=null;savePrefs();}
    else if (action==='menu') panel=panel==='menu'?null:'menu';
    else if (action==='settings') panel=panel==='settings'?null:'settings';
    else if (action==='magnet') {prefs.magnet=!prefs.magnet;savePrefs();}
    else if (action==='none') {tool=null;selected=null;panel=null;}
    else if (action==='select') {tool='select';panel=null;}
    else if (action==='undo') {const removed=current().pop();if (removed===selected) selected=null;save();panel=null;}
    else if (action==='delete') {const i=current().indexOf(selected);if(i>=0) {current().splice(i,1);save();}selected=null;panel=null;}
    else {tool=action;selected=null;panel=null;}
    sync();
  });
  listen(toolbar,'input',event=>{
    const name=event.target.dataset.setting;
    if (!name||name==='fib') return;
    const value=name==='color'?event.target.value:Number(event.target.value);
    if (selected) {selected[name]=value;save();}
    else {prefs[name]=value;savePrefs();}
    sync();
  });
  listen(toolbar,'change',event=>{
    if (event.target.dataset.setting!=='fib') return;
    const values=event.target.value.split(/[,，\s]+/).map(Number).filter(n=>Number.isFinite(n)&&n>=-5&&n<=10).slice(0,30);
    if (!values.length) {sync();return;}
    if (selected?.type==='fib') {selected.levels=values;save();}
    else {prefs.fib=values;savePrefs();}
    sync();
  });
  let railDrag=null;
  listen(toolbar.querySelector('.drawing-grip'),'pointerdown',event=>{
    if (!expanded()) return;
    const rect=toolbar.getBoundingClientRect(),parent=box.getBoundingClientRect();
    railDrag={id:event.pointerId,dx:event.clientX-rect.left,dy:event.clientY-rect.top,parent};
    event.target.setPointerCapture(event.pointerId);event.preventDefault();
  });
  listen(toolbar.querySelector('.drawing-grip'),'pointermove',event=>{
    if (!railDrag||railDrag.id!==event.pointerId) return;
    prefs.x=Math.max(0,Math.min(railDrag.parent.width-toolbar.offsetWidth-4,event.clientX-railDrag.parent.left-railDrag.dx));
    prefs.y=Math.max(42,Math.min(railDrag.parent.height-toolbar.offsetHeight-4,event.clientY-railDrag.parent.top-railDrag.dy));
    positionRail();
  });
  for (const name of ['pointerup','pointercancel']) listen(toolbar.querySelector('.drawing-grip'),name,()=>{if(railDrag){railDrag=null;savePrefs();}});
  function positionRail() {
    if (Number.isFinite(prefs.x)&&Number.isFinite(prefs.y)) {
      const x=Math.max(0,Math.min(box.clientWidth-toolbar.offsetWidth-4,prefs.x));
      const y=Math.max(42,Math.min(box.clientHeight-toolbar.offsetHeight-4,prefs.y));
      toolbar.style.left=`${x}px`;
      toolbar.style.top=`${y}px`;
      toolbar.classList.toggle('near-right',x>box.clientWidth-240);
      toolbar.classList.toggle('near-bottom',y>box.clientHeight-440);
    }
  }
  listen(document,'pointerdown',event=>{if(panel&&!toolbar.contains(event.target)){panel=null;sync();}});
  listen(document,'keydown',event=>{
    if (!expanded()||['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (event.key.toLowerCase()==='m'&&!event.altKey&&!event.ctrlKey&&!event.metaKey) {prefs.magnet=!prefs.magnet;savePrefs();sync();event.preventDefault();}
    if (event.key==='Escape') {panel=null;selected=null;tool=null;sync();}
    if ((event.key==='Delete'||event.key==='Backspace')&&selected) {const i=current().indexOf(selected);if(i>=0){current().splice(i,1);save();}selected=null;sync();event.preventDefault();}
  });
  listen(layer,'pointerdown',event=>{
    if (!tool||!expanded()||gesture||event.button>0) return;
    const rect=layer.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
    if (tool==='select') {
      const item=nearest(x,y);
      selected=item;panel=null;
      if (item) {
        const [x1,y1,x2,y2]=points(item),handle=!['horizontal','vertical'].includes(item.type)&&Math.hypot(x-x1,y-y1)<13?'a':!['horizontal','vertical'].includes(item.type)&&Math.hypot(x-x2,y-y2)<13?'b':'move';
        gesture={id:event.pointerId,item,handle,start:{x,y},original:{a:{...item.a},b:{...item.b}}};
        layer.setPointerCapture(event.pointerId);
      }
      sync();event.preventDefault();return;
    }
    const a=pointAt(x,y,event);if(!a)return;
    gesture={id:event.pointerId,handle:'draw'};preview={type:tool,a,b:{...a},color:prefs.color,width:prefs.width,fill:prefs.fill,levels:tool==='fib'?[...prefs.fib]:undefined};
    layer.setPointerCapture(event.pointerId);schedule();event.preventDefault();
  });
  listen(layer,'pointermove',event=>{
    if(!gesture||event.pointerId!==gesture.id)return;
    const rect=layer.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
    if(gesture.handle==='draw'){preview.b=pointAt(x,y,event)||preview.b;schedule();return;}
    const {item,original,start,handle}=gesture;
    const point=(p)=> {
      const tx=state.chart.timeScale().timeToCoordinate(p.time),py=state.candleSeries.priceToCoordinate(p.price);
      return pointAt((tx??start.x)+x-start.x,py+y-start.y,event)||p;
    };
    if(handle==='move'){item.a=point(original.a);item.b=point(original.b);}
    else item[handle]=pointAt(x,y,event)||item[handle];
    schedule();event.preventDefault();
  });
  function finish(event) {
    if(!gesture||event.pointerId!==gesture.id)return;
    if(gesture.handle==='draw'&&preview&&event.type!=='pointercancel'){
      if(['horizontal','vertical'].includes(preview.type)||preview.a.time!==preview.b.time||Math.abs(preview.a.price-preview.b.price)>0) {
        drawings[scope()] ||= []; drawings[scope()].push(preview);save();
      }
    } else if(gesture.handle!=='draw'&&event.type==='pointercancel') {
      gesture.item.a=gesture.original.a;gesture.item.b=gesture.original.b;
    } else if(gesture.handle!=='draw') save();
    gesture=null;preview=null;schedule();
  }
  listen(layer,'pointerup',finish);listen(layer,'pointercancel',finish);
  const mutation=new MutationObserver(sync);mutation.observe(document.body,{attributes:true,attributeFilter:['class']});
  listen(document,'fullscreenchange',sync);
  listen(document,'webkitfullscreenchange',sync);
  listen(document,'ox:marketchange',sync);
  listen(document,'ox:chartpriceview',schedule);
  listen(window,'resize',()=>{positionRail();schedule();},{passive:true});
  listen(chartEl,'pointermove',schedule,{passive:true});
  listen(chartEl,'touchmove',schedule,{passive:true});
  listen(chartEl,'wheel',schedule,{passive:true});
  const resize=new ResizeObserver(schedule);resize.observe(chartEl);
  const bind=()=>{if(life.signal.aborted)return;if(!state.chart){bindTimer=setTimeout(bind,50);return;}state.chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);listen(document,'ox:chartdata',schedule);positionRail();sync();};
  bind();
  return {sync,destroy(){life.abort();clearTimeout(bindTimer);cancelAnimationFrame(raf);mutation.disconnect();resize.disconnect();state.chart?.timeScale().unsubscribeVisibleLogicalRangeChange?.(schedule);toolbar.remove();layer.remove();}};
};
window.OXChartDrawings({box:document.querySelector('#view-radar .chart-box'),chartEl:document.getElementById('chart'),state});
