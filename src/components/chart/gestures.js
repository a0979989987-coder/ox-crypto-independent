window.OXChartGestures = function({container,state,getRange,setRange,refreshRange,isDrawing,formatPrice=(n)=>String(n)}) {
  const life=new AbortController();
  const listen=(type,handler,options={})=>container.addEventListener(type,handler,{...(typeof options==='boolean'?{capture:options}:options),signal:life.signal});
  let gesture = null,inspectTimer=null,lastAxisTap=0,waitForRelease=false,drawingGesture=false;
  const zone = target => {
    if (target.closest('.chart-price-axis')) return 'price';
    const cell = target.closest('td');
    const table = container.querySelector('.tv-lightweight-charts table');
    if (!cell || cell.closest('table') !== table) return null;
    const row = cell.parentElement;
    // LWC retains a zero-width left scale cell even when it is hidden.
    if (row === table.rows[0]) return cell.cellIndex === 2 ? 'price' : cell.cellIndex === 1 ? 'plot' : null;
    return row === table.rows[1] && cell.cellIndex === 1 ? 'time' : null;
  };
  const mid = touches => ({ x: [...touches].reduce((n,t)=>n+t.clientX,0)/touches.length,
    y: [...touches].reduce((n,t)=>n+t.clientY,0)/touches.length });
  const distance = touches => Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY);
  const clearInspection=()=>{
    state.chart.clearCrosshairPosition();
    const label=container.querySelector('.chart-cursor-price');if(label)label.hidden=true;
  };
  const inspect=point=>{
    const rect=container.getBoundingClientRect(),x=point.x-rect.left,y=point.y-rect.top;
    const time=state.chart.timeScale().coordinateToTime(x),price=state.candleSeries.coordinateToPrice(y);
    if(time!==null&&Number.isFinite(price)){
      state.chart.setCrosshairPosition(price,time,state.candleSeries);
      // Programmatic LWC crosshairs do not emit subscribeCrosshairMove.
      const label=container.querySelector('.chart-cursor-price');
      if(label){label.hidden=false;label.textContent=formatPrice(price);label.style.top=`${y}px`;}
    }
  };
  const start = event => {
    clearTimeout(inspectTimer);gesture=null;
    if (!window.matchMedia('(pointer:coarse)').matches || event.touches.length > 2) return;
    if(waitForRelease){
      // A fresh single-touch start also proves the previous pinch ended, even
      // if the browser delivered its final release outside this container.
      if(event.touches.length===1)waitForRelease=false;else return;
    }
    // A finger may land on the compact price labels while the other is in the
    // plot. Two fingers always adjust candle density, never the price axis.
    const area = event.touches.length===2?'plot':zone(event.target);
    const drawings=container.oxDrawingController;
    if(event.touches.length===2){drawings?.cancel();drawingGesture=false;}
    else if(drawings?.touchStart(event)){drawingGesture=true;event.preventDefault();event.stopPropagation();return;}
    if (!area || (!drawings && isDrawing?.())) return;
    const range = getRange();
    const logical = state.chart.timeScale().getVisibleLogicalRange();
    if (!range || !logical) return;
    const point = mid(event.touches), rect = container.getBoundingClientRect();
    gesture = { area, count:event.touches.length, x:point.x, y:point.y, top:rect.top,left:rect.left,width:state.chart.timeScale().width(),
      height:container.clientHeight-state.chart.timeScale().height()-1, range:{...range}, logical:{...logical},
      distance:event.touches.length===2?distance(event.touches):0 };
    if(gesture.count===2){
      clearInspection();
      state.chartPriceViewport=null;state.chartPriceViewportMargins=null;
      refreshRange();
    }
    if(area==='plot'&&gesture.count===1)inspectTimer=setTimeout(()=>{if(gesture){gesture.inspect=true;inspect({x:gesture.x,y:gesture.y});}},450);
    event.preventDefault(); event.stopPropagation();
  };
  listen('touchstart', start, { passive:false, capture:true });
  listen('touchmove', event => {
    if(drawingGesture){if(event.touches.length===2){start(event);return;}if(event.touches.length===1){container.oxDrawingController?.touchMove(event);event.preventDefault();event.stopPropagation();}return;}
    if (!gesture || !event.touches.length) return;
    if (event.touches.length!==gesture.count) { start(event); return; }
    const point=mid(event.touches), dx=point.x-gesture.x, dy=point.y-gesture.y;
    if(gesture.inspect){inspect(point);event.preventDefault();event.stopPropagation();return;}
    if(Math.hypot(dx,dy)>6){clearTimeout(inspectTimer);gesture.moved=true;clearInspection();}
    const span=gesture.range.maxValue-gesture.range.minValue;
    if (!Number.isFinite(span)||span<=0) return;
    if (gesture.count===2) {
      // Bitget-style pinch: change candle width / number of visible bars.
      // Let the chart fit the highs and lows of those bars automatically.
      const factor=Math.max(.1,Math.min(10,distance(event.touches)/(gesture.distance||1)));
      const oldBars=gesture.logical.to-gesture.logical.from;
      const bars=Math.max(8,Math.min(3000,oldBars/factor));
      const anchorBar=gesture.logical.from+(gesture.x-gesture.left)/gesture.width*oldBars;
      const from=anchorBar-(point.x-gesture.left)/gesture.width*bars;
      state.chart.timeScale().setVisibleLogicalRange({from,to:from+bars});
    } else if (gesture.area==='time') {
      const factor=Math.exp(dx/Math.max(80,container.clientWidth)*2);
      const bars=Math.max(8,Math.min(3000,(gesture.logical.to-gesture.logical.from)/factor));
      state.chart.timeScale().setVisibleLogicalRange({from:gesture.logical.to-bars,to:gesture.logical.to});
    } else if (gesture.area==='price') {
      const factor=Math.exp(-dy/Math.max(80,gesture.height)*3);
      const center=(gesture.range.maxValue+gesture.range.minValue)/2;
      setRange({minValue:center-span/factor/2,maxValue:center+span/factor/2});
    } else {
      const bars=gesture.logical.to-gesture.logical.from;
      const move=-dx/gesture.width*bars;
      state.chart.timeScale().setVisibleLogicalRange({from:gesture.logical.from+move,to:gesture.logical.to+move});
      if(gesture.vertical||Math.abs(dy)>Math.max(6,Math.abs(dx)*1.1)){
        gesture.vertical=true;
        const shift=dy/gesture.height*span;
        setRange({minValue:gesture.range.minValue+shift,maxValue:gesture.range.maxValue+shift});
      }
    }
    event.preventDefault(); event.stopPropagation();
  }, {passive:false,capture:true});
  const end=event=>{
    clearTimeout(inspectTimer);
    if(drawingGesture){container.oxDrawingController?.touchEnd();drawingGesture=false;event.preventDefault();event.stopPropagation();return;}
    if(waitForRelease){if(!event.touches.length)waitForRelease=false;event.stopPropagation();return;}
    if(gesture){
      event.stopPropagation();
      if(gesture.count===2){waitForRelease=event.touches.length>0;gesture=null;return;}
      if(!gesture.moved&&gesture.count===1){
        if(gesture.area==='plot'&&!gesture.inspect&&!container.oxDrawingController?.tap({x:gesture.x,y:gesture.y}))inspect({x:gesture.x,y:gesture.y});
        if(gesture.area==='price'){
          const now=performance.now();
          if(lastAxisTap&&now-lastAxisTap<350){state.chartPriceViewport=null;refreshRange();lastAxisTap=0;}else lastAxisTap=now;
        }
      }
    }
    gesture=null;if(event.touches.length)start(event);
  };
  listen('touchend',end,{passive:false,capture:true});
  listen('touchcancel',()=>{clearTimeout(inspectTimer);container.oxDrawingController?.cancel();drawingGesture=false;gesture=null;waitForRelease=false;},{passive:true,capture:true});
  listen('dblclick',event=>{if(zone(event.target)==='price'){state.chartPriceViewport=null;refreshRange();}},true);
  return {destroy(){life.abort();clearTimeout(inspectTimer);gesture=null;}};
};
