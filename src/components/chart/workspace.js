function getChartRightOffset() {
  const spacing = state.chart?.timeScale().options().barSpacing || 6;
  const labelSpace = (state.chartPriceAxisWidth || 44) + 16;
  // Mobile needs room for the complete last candle and its price/countdown label.
  const futureSpace = window.matchMedia('(max-width: 720px)').matches
    ? Math.max(labelSpace, Math.min(110, window.innerWidth * .25)) : labelSpace;
  return futureSpace / spacing;
}

let chartPriceOverlayFrame = 0;
function scheduleChartPriceOverlayUpdate() {
  if (chartPriceOverlayFrame) return;
  // Chart mutations queue LWC's paint first; align labels in that same frame.
  chartPriceOverlayFrame = requestAnimationFrame(() => {
    chartPriceOverlayFrame = 0;
    updatePriceTimer();
    updateKeyLevelVisualLabels();
  });
}

function renderCompactChartPriceAxis() {
  const axis=document.querySelector('#chart .chart-price-axis');
  if (!axis || !state.candleSeries || !state.candleData.length) return;
  const height=document.getElementById('chart').clientHeight-(state.chart.timeScale().height()||0);
  if (height<20) return;
  const high=state.candleSeries.coordinateToPrice(0),low=state.candleSeries.coordinateToPrice(height);
  if (!Number.isFinite(high)||!Number.isFinite(low)||high<=low) return;
  const mobile=window.matchMedia('(max-width:720px)').matches;
  const raw=(high-low)/Math.max(2,Math.floor(height/(mobile?30:34))),power=10**Math.floor(Math.log10(raw));
  const multiplier=[1,2,2.5,5,10].find(n=>n*power>=raw),step=multiplier*power;
  const digits=Math.max(0,-Math.floor(Math.log10(power))+(multiplier===2.5?1:0),Math.abs(high)<10?2:0);
  const labels=[];
  for(let index=Math.ceil(low/step);index*step<high&&labels.length<80;index++){
    const value=index*step;
    const y=state.candleSeries.priceToCoordinate(value);
    if (y>8&&y<height-8) labels.push({text:value.toFixed(Math.min(12,digits)),y});
  }
  const ctx=renderCompactChartPriceAxis.context ||= document.createElement('canvas').getContext('2d');
  ctx.font=`${mobile?9:10}px system-ui`;
  const badge=document.querySelector('#chart .chart-mobile-last-price');
  const width=Math.ceil(Math.max(24,badge?.offsetWidth || 0,...labels.map(l=>ctx.measureText(l.text).width))+6);
  state.chartPriceAxisWidth=width;
  if(axis.style.width!==`${width}px`)axis.style.width=`${width}px`;
  if(axis.style.height!==`${height}px`)axis.style.height=`${height}px`;
  const grid=document.querySelector('#chart .chart-price-grid');
  // Reuse the ticks/grid instead of allocating and removing dozens of nodes on every move.
  for (const [parent,tag] of [[axis,'span'],[grid,'i']]) {
    if(!parent)continue;
    while(parent.children.length<labels.length)parent.append(document.createElement(tag));
    while(parent.children.length>labels.length)parent.lastElementChild.remove();
    labels.forEach((label,index)=>{
      const el=parent.children[index],top=`${label.y}px`;
      if(tag==='span'&&el.textContent!==label.text)el.textContent=label.text;
      if(el.style.top!==top)el.style.top=top;
    });
  }
}

function chartAxisPrecision(price) {
  const value = Math.abs(Number(price) || 0);
  return value >= 1000 ? 2 : value >= 1 ? 4 : Math.max(6,Math.min(12,4-Math.floor(Math.log10(value||1))));
}

function formatChartAxisPrice(price) {
  const digits = state.chartAxisDigits ?? 2;
  return Number(price).toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function formatChartVolume(volume) {
  const value = Math.abs(Number(volume));
  if (value >= 1e9) return `${Number((volume / 1e9).toFixed(1))}B`;
  if (value >= 1e6) return `${Number((volume / 1e6).toFixed(0))}M`;
  if (value >= 1e3) return `${Number((volume / 1e3).toFixed(0))}k`;
  return String(Math.round(volume));
}

function refreshChartPriceViewport() {
  // Reapplying the provider invalidates the library's autoscale cache.
  state.chart?.priceScale("right").applyOptions({ autoScale: true });
  state.candleSeries?.applyOptions({ autoscaleInfoProvider: chartPriceAutoscale });
  // Vertical price pans do not emit a time-scale range change.
  scheduleChartPriceOverlayUpdate();
  document.dispatchEvent(new Event('ox:chartpriceview'));
}

function chartPriceAutoscale(original) {
  const info = original();
  if (!info) return info;
  state.chartAutoPriceRange = { ...info.priceRange };
  state.chartAutoPriceMargins = info.margins || { above:0,below:0 };
  return state.chartPriceViewport ? { ...info, priceRange: { ...state.chartPriceViewport },margins:state.chartPriceViewportMargins } : info;
}

function getChartVisiblePriceRange() {
  const height=document.getElementById('chart').clientHeight-state.chart.timeScale().height();
  const maxValue=state.candleSeries.coordinateToPrice(0),minValue=state.candleSeries.coordinateToPrice(height-1);
  return Number.isFinite(minValue)&&Number.isFinite(maxValue)&&maxValue>minValue?{minValue,maxValue}:null;
}

function setChartVisiblePriceRange(range) {
  // The provider describes the inner price range. Remove the chart's margins
  // from screen coordinates so the first movement never jumps or stretches it.
  const margins=state.chart.priceScale('right').options().scaleMargins;
  const extra=state.chartPriceViewport?state.chartPriceViewportMargins:state.chartAutoPriceMargins;
  const height=document.getElementById('chart').clientHeight-state.chart.timeScale().height();
  const span=range.maxValue-range.minValue;
  state.chartPriceViewportMargins=extra||{above:0,below:0};
  state.chartPriceViewport={minValue:range.minValue+span*(height*margins.bottom+(extra?.below||0))/(height-1),maxValue:range.maxValue-span*(height*margins.top+(extra?.above||0))/(height-1)};
  refreshChartPriceViewport();
}

window.OXChartGestures = function({container,state,getRange,setRange,refreshRange,isDrawing,formatPrice=formatChartAxisPrice}) {
  const life=new AbortController();
  const listen=(type,handler,options={})=>container.addEventListener(type,handler,{...(typeof options==='boolean'?{capture:options}:options),signal:life.signal});
  let gesture = null,inspectTimer=null,lastAxisTap=0,waitForRelease=false;
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
    if (!area || isDrawing?.()) return;
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
    if(waitForRelease){if(!event.touches.length)waitForRelease=false;event.stopPropagation();return;}
    if(gesture){
      event.stopPropagation();
      if(gesture.count===2){waitForRelease=event.touches.length>0;gesture=null;return;}
      if(!gesture.moved&&gesture.count===1){
        if(gesture.area==='plot'&&!gesture.inspect)inspect({x:gesture.x,y:gesture.y});
        if(gesture.area==='price'){
          const now=performance.now();
          if(lastAxisTap&&now-lastAxisTap<350){state.chartPriceViewport=null;refreshRange();lastAxisTap=0;}else lastAxisTap=now;
        }
      }
    }
    gesture=null;if(event.touches.length)start(event);
  };
  listen('touchend',end,{passive:false,capture:true});
  listen('touchcancel',()=>{clearTimeout(inspectTimer);gesture=null;waitForRelease=false;},{passive:true,capture:true});
  listen('dblclick',event=>{if(zone(event.target)==='price'){state.chartPriceViewport=null;refreshRange();}},true);
  return {destroy(){life.abort();clearTimeout(inspectTimer);gesture=null;}};
};

function enableMobileChartPriceGestures(container) {return window.OXChartGestures({container,state,getRange:getChartVisiblePriceRange,setRange:setChartVisiblePriceRange,refreshRange:refreshChartPriceViewport,isDrawing:()=>document.querySelector('#view-radar .chart-drawing-layer.is-editing')});}

function applyChartFutureSpace(snapToLatest = false) {
  if (!state.chart) return;
  const ts = state.chart.timeScale();
  ts.applyOptions({ rightOffset: getChartRightOffset(), fixRightEdge: false, lockVisibleTimeRangeOnResize: true });
  if (snapToLatest) requestAnimationFrame(() => {
    try { ts.scrollToPosition(getChartRightOffset(), false); } catch (e) {}
  });
}

function clearKeyLevelPriceLines() {
  for(const line of state.classicLevelSeries||[]){try{state.chart.removeSeries(line);}catch{}}
  state.classicLevelSeries=[];
  if (!state.candleSeries) return;
  for (const key of ["keyHighLine","keyLowLine","secondaryKeyHighLine","secondaryKeyLowLine"]) {
    if (state[key]) {
      try { state.candleSeries.removePriceLine(state[key]); } catch (e) {}
    }
    state[key] = null;
  }
}

function renderKeyLevelPriceLinesFromState() {
  clearKeyLevelPriceLines();
  if (!state.keyLevelsVisible || !state.candleSeries || document.body.classList.contains("chart-focus")) return;

  const primary = state.currentLevels;
  for(const levels of [primary,state.secondaryLevels]){
    for(const pressure of [levels?.highPressure,levels?.lowPressure]){
      if(pressure?.kind!=='diagonal')continue;
      const line=state.chart.addLineSeries({color:document.body.classList.contains('theme-light')?'#8d712e':'#eee7df',lineWidth:1,lineStyle:2,priceLineVisible:false,lastValueVisible:false,autoscaleInfoProvider:()=>null});
      const times=state.candleData?.filter(c=>c.time>=pressure.points[0].time&&c.time<=pressure.points[1].time)||[];
      const duration=(pressure.points[1].time-pressure.points[0].time)/(pressure.points[1].index-pressure.points[0].index);
      if(duration>0)line.setData(times.map(c=>({time:c.time,value:pressure.points[1].price+pressure.slope*(c.time-pressure.points[1].time)/duration})));
      state.classicLevelSeries.push(line);
    }
  }
  if (primary?.high && primary.highPressure?.kind!=="diagonal") {
    state.keyHighLine = state.candleSeries.createPriceLine({
      price: primary.high, color: "#f7bd52", lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false,
      title: `有效壓力 ${primary.sourcePeriod || getKeyLevelPeriod()}`
    });
  }
  if (primary?.low && primary.lowPressure?.kind!=="diagonal") {
    state.keyLowLine = state.candleSeries.createPriceLine({
      price: primary.low, color: "#5ca5ff", lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false,
      title: `有效支撐 ${primary.sourcePeriod || getKeyLevelPeriod()}`
    });
  }

  const secondary = state.secondaryLevels;
  if (secondary?.high && secondary.highPressure?.kind!=="diagonal") {
    state.secondaryKeyHighLine = state.candleSeries.createPriceLine({
      price: secondary.high, color: "rgba(247,189,82,.58)", lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: false,
      title: `有效壓力 ${secondary.sourcePeriod}`
    });
  }
  if (secondary?.low && secondary.lowPressure?.kind!=="diagonal") {
    state.secondaryKeyLowLine = state.candleSeries.createPriceLine({
      price: secondary.low, color: "rgba(92,165,255,.58)", lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: false,
      title: `有效支撐 ${secondary.sourcePeriod}`
    });
  }
}

function syncKeyLevelVisibilityUI() {
  const checkbox = document.getElementById("chk-key-levels");
  const textEl = document.getElementById("key-level-toggle-text");
  if (checkbox) checkbox.checked = !!state.keyLevelsVisible;
  if (textEl) textEl.textContent = "有效壓力有效支撐";
}

function setKeyLevelsVisible(visible, { persist = true } = {}) {
  state.keyLevelsVisible = !!visible;
  if (persist) {
    try { localStorage.setItem("ox-chart-key-levels-visible", state.keyLevelsVisible ? "1" : "0"); } catch (e) {}
  }

  const layer = document.getElementById("chart-key-labels");
  if (state.keyLevelsVisible) {
    renderKeyLevelPriceLinesFromState();
    requestAnimationFrame(updateKeyLevelVisualLabels);
  } else {
    clearKeyLevelPriceLines();
    if (layer) layer.innerHTML = "";
  }
  syncKeyLevelVisibilityUI();
}

function updateKeyLevelVisualLabels() {
  const layer = document.getElementById("chart-key-labels");
  const chartEl = document.getElementById("chart");
  if (!layer || !chartEl || !state.candleSeries) return;
  if (!state.keyLevelsVisible) { layer.innerHTML = ""; return; }
  const levels = [];
  const add = (price, type, period, secondary = false) => {
    const y = price ? state.candleSeries.priceToCoordinate(price) : null;
    if (!Number.isFinite(y)) return;
    levels.push({ price, type, period, secondary, y });
  };
  add(state.currentLevels?.high, "high", state.currentLevels?.sourcePeriod || getKeyLevelPeriod(), false);
  add(state.currentLevels?.low, "low", state.currentLevels?.sourcePeriod || getKeyLevelPeriod(), false);
  if (state.secondaryLevels) {
    add(state.secondaryLevels.high, "high", state.secondaryLevels.sourcePeriod, true);
    add(state.secondaryLevels.low, "low", state.secondaryLevels.sourcePeriod, true);
  }

  const h = chartEl.clientHeight || 0;
  const last = state.candleData?.at(-1);
  const reservedY = last ? state.candleSeries.priceToCoordinate(last.close) : null;
  const isMobile = window.matchMedia("(max-width:720px)").matches;
  const gap = isMobile ? 19 : 23;
  const minLabelY = isMobile ? 46 : 14; // 手機右上角留給小型倒數，避免標籤互撞
  levels.sort((a,b) => a.y - b.y);

  let prevY = -Infinity;
  for (const item of levels) {
    let y = Math.max(minLabelY, Math.min(h - 14, item.y));
    if (Number.isFinite(reservedY) && Math.abs(y - reservedY) < gap) y = reservedY + (y <= reservedY ? -gap : gap);
    if (y - prevY < gap) y = prevY + gap;
    item.displayY = Math.max(minLabelY, Math.min(h - 14, y));
    prevY = item.displayY;
  }
  // If the last label was pushed past the bottom edge, shift the group back upward while preserving spacing.
  if (levels.length && levels.at(-1).displayY > h - 14) {
    const shift = levels.at(-1).displayY - (h - 14);
    levels.forEach(x => x.displayY = Math.max(minLabelY, x.displayY - shift));
  }

  layer.innerHTML = levels.map(item => {
    const cls = `chart-key-label ${item.type}${item.secondary ? " secondary" : ""}`;
    const label = `${item.type === "high" ? "有效壓力" : "有效支撐"} ${item.period} ${fmtPrice(item.price)}`;
    return `<span class="${cls}" style="top:${item.displayY}px">${label}</span>`;
  }).join("");
}

function initChart() {
  const container = document.getElementById("chart");
  state.chart = LightweightCharts.createChart(container, {
    width: container.clientWidth || 820,
    height: container.clientHeight || 440,
    layout: {
      background: { type: "solid", color: "#121417" },
      textColor: "#929995",
      fontSize: window.matchMedia("(max-width:720px)").matches ? 10 : 11,
      attributionLogo: false
    },
    grid: {
      vertLines: { color: "#202725", visible: false },
      horzLines: { color: "#202725", visible: false }
    },
    rightPriceScale: {
      borderColor: "#343b37",
      visible: false,
      autoScale: true,
      scaleMargins: { top: 0.18, bottom: 0.22 }
    },
    timeScale: {
      borderColor: "#343b37",
      timeVisible: true,
      secondsVisible: false,
      rightOffset: getChartRightOffset(),
      barSpacing: window.matchMedia("(max-width: 720px)").matches ? 4.2 : 6,
      minBarSpacing: window.matchMedia("(max-width: 720px)").matches ? 2.0 : 2.5,
      fixRightEdge: false,
      lockVisibleTimeRangeOnResize: true
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal, horzLine: { labelVisible: false } },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { price: true, time: true }, axisDoubleClickReset: true },
    // Touch gestures are handled above; mouse drag/wheel remain native.
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }
  });

  // Mobile only: use a smaller scale font while preserving the full price.
  if (window.matchMedia("(max-width: 720px)").matches) {
    state.chart.applyOptions({
      layout: { fontSize: 10 },
      rightPriceScale: { borderColor: "#343b37", autoScale: true, scaleMargins: { top: 0.18, bottom: 0.22 } }
    });
  }

  // User chart reference (Display P3 converted to sRGB): cyan up, magenta down.
  state.candleSeries = state.chart.addCandlestickSeries({
    // Hidden scales do not participate in LWC's default-scale selection.
    // Bind explicitly so viewport margins and resets affect the candle scale.
    priceScaleId: 'right',
    upColor: "#00b8d4",
    downColor: "#ff3078",
    borderVisible: false,
    wickUpColor: "#00b8d4",
    wickDownColor: "#ff3078",
    // On narrow charts the native last-price badge sets the entire scale width.
    // A badge over the scale below keeps the full number without an empty column.
    lastValueVisible: false,
    priceLineVisible: false,
    priceFormat: { type: "custom", minMove: 0.01, formatter: formatChartAxisPrice },
    autoscaleInfoProvider: chartPriceAutoscale
  });

  state.volumeSeries = state.chart.addHistogramSeries({
    priceFormat: { type: "custom", minMove: 1, formatter: formatChartVolume },
    priceScaleId: "vol",
    lastValueVisible: false
  });
  state.chart.priceScale("vol").applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 }
  });

  const mobilePriceLabel = document.createElement('span');
  mobilePriceLabel.className = 'chart-mobile-last-price';
  mobilePriceLabel.setAttribute('aria-hidden', 'true');
  const priceGrid=document.createElement('div');
  priceGrid.className='chart-price-grid';
  container.append(priceGrid);
  const compactAxis=document.createElement('div');
  compactAxis.className='chart-price-axis';
  compactAxis.setAttribute('aria-label','價格軸，拖曳調整比例');
  container.append(compactAxis);
  let axisDrag=null;
  compactAxis.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='mouse'||event.button!==0)return;
    const range=getChartVisiblePriceRange();
    if(!range)return;
    axisDrag={y:event.clientY,range:{...range}};
    compactAxis.setPointerCapture(event.pointerId);event.preventDefault();
  });
  compactAxis.addEventListener('pointermove',event=>{
    if(!axisDrag)return;
    const factor=Math.exp(-(event.clientY-axisDrag.y)/Math.max(80,compactAxis.clientHeight)*3);
    const center=(axisDrag.range.minValue+axisDrag.range.maxValue)/2;
    const span=(axisDrag.range.maxValue-axisDrag.range.minValue)/factor;
    setChartVisiblePriceRange({minValue:center-span/2,maxValue:center+span/2});
  });
  const stopAxisDrag=()=>{axisDrag=null;};
  compactAxis.addEventListener('pointerup',stopAxisDrag);
  compactAxis.addEventListener('pointercancel',stopAxisDrag);
  compactAxis.addEventListener('lostpointercapture',stopAxisDrag);
  // The line and badge share one transform/layer, so they cannot drift apart.
  const currentPrice=document.createElement('div');
  currentPrice.className='chart-current-price';
  currentPrice.hidden=true;
  const currentPriceLine=document.createElement('i');
  currentPriceLine.className='chart-current-price-line';
  currentPrice.append(currentPriceLine,mobilePriceLabel);
  container.append(currentPrice);
  const cursorPrice = document.createElement('span');
  cursorPrice.className = 'chart-cursor-price';
  cursorPrice.hidden = true;
  container.append(cursorPrice);
  state.chart.subscribeCrosshairMove(param => {
    cursorPrice.hidden = !param.point;
    if (!param.point) return;
    const price = state.candleSeries.coordinateToPrice(param.point.y);
    if (!Number.isFinite(price)) { cursorPrice.hidden = true; return; }
    cursorPrice.textContent = formatChartAxisPrice(price);
    cursorPrice.style.top = `${param.point.y}px`;
  });


  state.chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    scheduleChartPriceOverlayUpdate();
    if (!range || state.isLoadingOlder || !state.hasMoreHistory || !state.candleData.length) return;
    if (range.from <= 12) loadMoreHistoricalCandles();
  });

  let mobileScale = window.matchMedia('(max-width:720px)').matches;
  new ResizeObserver(() => {
    const mobileNow = window.matchMedia('(max-width:720px)').matches;
    if (mobileNow !== mobileScale) {
      mobileScale = mobileNow;
      state.chart.applyOptions({ layout: { fontSize: mobileNow ? 10 : 11 } });
      applyChartFutureSpace();
    }
    resizeChartToContainer();
    scheduleChartPriceOverlayUpdate();
  }).observe(container);
  enableMobileChartPriceGestures(container);
}

function startChartLiveCandles(symbol, period, options = {}) {
  state.chartLiveFeed?.stop();
  const feed=CryptoLiveCandles.subscribe(symbol,period,incoming=>{
    if (state.chartLiveFeed!==feed || state.symbol!==symbol || state.period!==period || state.activeMarket!=='crypto') return;
    if (!state.candleData.length || state.chartPriceScope!==`${symbol}:${period}`) {
      state.candleData=incoming;
      state.oldestCandleTime=incoming[0]?.time || 0;
      state.hasMoreHistory=true;
      renderChartData(incoming,true);
      return;
    }
    const previous=state.candleData, lastTime=previous.at(-1)?.time;
    state.candleData=updateCryptoLiveSeries(state.candleSeries,state.volumeSeries,previous,incoming);
    const last=state.candleData.at(-1);
    if (!last) return;
    state.chartLiveQuote={symbol,period,price:last.close,received:Date.now()};
    for (const id of ['price','chart-focus-price']) {
      const el=document.getElementById(id);if(el)el.textContent=fmtPrice(last.close);
    }
    updatePriceTimer();
    if (last.time!==lastTime) {
      const visible=state.chart.timeScale().getVisibleLogicalRange();
      renderChartData(state.candleData,false,visible);
    }
    document.dispatchEvent(new Event('ox:chartdata'));
  },options);
  state.chartLiveFeed=feed;
  state.chartLiveQuote=null;
  return feed;
}

async function loadSymbolCandles(isInitial = true) {
  if (state.activeMarket && state.activeMarket !== "crypto") return;
  state.abortCtrl?.abort();
  state.abortCtrl = new AbortController();
  const symbol = state.symbol, period = state.period;
  const feed=startChartLiveCandles(symbol,period);
  const overlay = document.getElementById("chart-loading");
  if (isInitial) { overlay.innerHTML=window.OXLoading?.markup(`${symbol} K 線載入中`,0,1)||"K 線載入中…";overlay.classList.add("show"); }
  if (state.chartPriceScope !== `${symbol}:${period}`) {
    state.chartPriceViewport = null;
    state.chartAutoPriceRange = null;
    state.candleData = [];
    clearKeyLevelPriceLines();
    state.candleSeries.setData([]);
    state.volumeSeries.setData([]);
    state.chart.priceScale("right").applyOptions({ autoScale: true });
    document.querySelector('#chart .chart-price-axis')?.replaceChildren();
    document.querySelector('#chart .chart-price-grid')?.replaceChildren();
    const cursor=document.querySelector('#chart .chart-cursor-price');
    if(cursor)cursor.hidden=true;
    document.querySelector('#chart .chart-current-price')?.setAttribute('hidden','');
    document.dispatchEvent(new Event('ox:chartdata'));
  }

  try {
    const raw = await feed.load(window.matchMedia("(max-width:720px)").matches ? 160 : 100);
    if (state.symbol !== symbol || state.period !== period || state.chartLiveFeed!==feed) return;
    if (!raw.length) throw new Error("無可用 K 線");

    state.candleData = raw;
    state.oldestCandleTime = raw[0].time;
    state.hasMoreHistory = true;
    renderChartData(raw, isInitial);
  } catch (err) {
    if (err.name === "AbortError") return;
  } finally {
    if (state.symbol === symbol && state.period === period) overlay.classList.remove("show");
  }
}

async function loadMoreHistoricalCandles() {
  if (state.isLoadingOlder || !state.hasMoreHistory) return;
  state.isLoadingOlder = true;
  const symbol = state.symbol, period = state.period, oldest = state.oldestCandleTime;
  const overlay = document.getElementById("chart-loading");
  overlay.classList.add("show");

  try {
    const older = await BitgetAPI.fetchCandles(symbol, period, 200, (oldest - (periods[period] || 60)) * 1000);
    if (state.symbol !== symbol || state.period !== period || state.oldestCandleTime !== oldest) return;
    const previous = state.candleData;
    const genuinelyOlder = older.filter(c => c.time < oldest);
    if (!genuinelyOlder.length) {
      state.hasMoreHistory = false;
      return;
    }
    const visible = state.chart.timeScale().getVisibleLogicalRange();
    state.oldestCandleTime = genuinelyOlder[0].time;
    const combined = [...genuinelyOlder, ...previous];
    state.candleData = combined;
    renderChartData(combined, false, visible && {
      from: visible.from + genuinelyOlder.length,
      to: visible.to + genuinelyOlder.length
    });
  } catch (e) {
  } finally {
    state.isLoadingOlder = false;
    overlay.classList.remove("show");
  }
}

function renderChartData(candles, fitContent = false, preservedLogicalRange = null) {
  const priceScope = `${state.symbol}:${state.period}`;
  if (state.chartPriceScope !== priceScope) {
    state.chartPriceScope = priceScope;
    state.chartPriceViewport = null;
    state.chartAutoPriceRange = null;
    clearKeyLevelPriceLines();
    state.chart.priceScale("right").applyOptions({ autoScale: true, scaleMargins: { top: .18, bottom: .22 } });
  }
  const digits = chartAxisPrecision(candles.at(-1)?.close);
  if (digits !== state.chartAxisDigits) {
    state.chartAxisDigits = digits;
    state.candleSeries.applyOptions({ priceFormat: { type: "custom", minMove: 10 ** -digits, formatter: formatChartAxisPrice } });
  }
  state.candleSeries.setData(candles);

  const volData = candles.map(c => ({
    time: c.time,
    value: c.quoteVolume || c.volume,
    color: c.close >= c.open ? "#00b8d440" : "#ff307840"
  }));
  state.volumeSeries.setData(volData);

  void refreshKeyLevels(candles);

  if (!document.body.classList.contains("chart-focus") && document.getElementById("chk-ox-markers").checked) {
    const markers = [];
    for (let i = 20; i < candles.length - 1; i++) {
      const c = candles[i];
      const prev20 = candles.slice(i - 20, i);
      const prevHigh = Math.max(...prev20.map(x => x.high));
      const prevLow = Math.min(...prev20.map(x => x.low));
      const avgVol = prev20.reduce((s, x) => s + x.volume, 0) / prev20.length || 1;
      const ratio = c.volume / avgVol;
      if (c.close > prevHigh && ratio >= 1.45) {
        markers.push({ time:c.time, position:"belowBar", color:"#00b8d4", shape:"arrowUp", text:"▲", size:1 });
      } else if (c.close < prevLow && ratio >= 1.45) {
        markers.push({ time:c.time, position:"aboveBar", color:"#ff3078", shape:"arrowDown", text:"▼", size:1 });
      }
    }
    state.candleSeries.setMarkers(markers.slice(-6));
  } else {
    state.candleSeries.setMarkers([]);
  }

  if (fitContent) {
    refreshChartPriceViewport();
    state.chart.timeScale().fitContent();
    renderCompactChartPriceAxis();
    applyChartFutureSpace(true);
  } else if (preservedLogicalRange) {
    state.chart.timeScale().setVisibleLogicalRange(preservedLogicalRange);
  }
  updatePriceTimer();
  requestAnimationFrame(updateKeyLevelVisualLabels);
  updateQuickStats();
  renderOxDetail();
  document.dispatchEvent(new Event('ox:chartdata'));
}

function averageTrueRange(candles, period = 14) {
  if (!candles || candles.length < 3) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trs.slice(-period);
  return slice.length ? slice.reduce((a,b) => a + b, 0) / slice.length : 0;
}

function findStructuralPivotLevels(candles, sourcePeriod) {
  const bars=cryptoClassicBars(candles,sourcePeriod);
  const long=OXClassic.evaluateClassic(bars,{side:'long',frame:sourcePeriod});
  const short=OXClassic.evaluateClassic(bars,{side:'short',frame:sourcePeriod});
  // A live crossing remains a test until the closed bars confirm it. Keep the
  // engine's valid pressure visible even when the provisional price is across.
  const close=bars.filter(c=>!c.provisional).at(-1)?.close;
  const high=long.pressure?.state==='valid'?long.pressure:long.levels?.filter(p=>p.state==='valid'&&p.level>=close).sort((a,b)=>a.level-b.level)[0];
  const low=short.pressure?.state==='valid'?short.pressure:short.levels?.filter(p=>p.state==='valid'&&p.level<=close).sort((a,b)=>b.level-a.level)[0];
  return {high:high?.level||0,low:low?.level||0,highTime:high?.points[0].time||0,lowTime:low?.points[0].time||0,highPressure:high,lowPressure:low};
}

async function refreshKeyLevels(chartCandles) {
  if (!state.candleSeries) return;
  const symbolAtRequest = state.symbol;
  const sourcePeriods = getKeyLevelPeriods();

  clearKeyLevelPriceLines();
  state.currentLevels = { high:0, low:0, sourcePeriod:sourcePeriods[0], highTime:0, lowTime:0 };
  state.secondaryLevels = null;
  updateAlertButtons();
  updateQuickStats();

  try {
    const results = [];
    for (const sourcePeriod of sourcePeriods) {
      const sourceCandles = state.period === sourcePeriod
        ? chartCandles
        : await BitgetAPI.fetchCandles(symbolAtRequest, sourcePeriod, 180);

      if (state.symbol !== symbolAtRequest || !getKeyLevelPeriods().includes(sourcePeriod)) return;
      results.push({ sourcePeriod, levels: findStructuralPivotLevels(sourceCandles, sourcePeriod) });
    }

    const primary = results[0];
    state.currentLevels = { ...primary.levels, sourcePeriod: primary.sourcePeriod };


    if (results[1]) {
      const secondary = results[1];
      state.secondaryLevels = { ...secondary.levels, sourcePeriod: secondary.sourcePeriod };
    }

    renderKeyLevelPriceLinesFromState();
    updateAlertButtons();
    updateQuickStats();
    renderOxDetail();
    requestAnimationFrame(updateKeyLevelVisualLabels);
  } catch (e) {
    console.warn("關鍵有效壓力/有效支撐取得失敗", symbolAtRequest, sourcePeriods, e);
  }
}

function updatePriceTimer() {
  const timerEl = document.getElementById("price-timer");
  if (!state.candleData.length || !timerEl) return;
  const last = state.candleData[state.candleData.length - 1];
  renderCompactChartPriceAxis();
  const now = Math.floor(Date.now() / 1000);
  const left = Math.max(0, Math.ceil(CryptoLiveCandles.closeTime(last,state.period) - now));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const mobile = window.matchMedia("(max-width:720px)").matches;
  const countdown=`${h>0 ? `${String(h).padStart(2,'0')}:` : ''}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

  // Full last price uses an overlay; native crosshair/last-value labels otherwise
  // reserve width for invisible decimals on every tick and leave a blank column.
  const badge = document.querySelector('#chart .chart-mobile-last-price');
  const currentPrice=badge?.parentElement;
  const lastY = state.candleSeries.priceToCoordinate(last.close);
  const plotHeight=document.getElementById('chart').clientHeight-state.chart.timeScale().height();
  // Never pin only the badge to an edge: both represent the actual price coordinate.
  if(currentPrice)currentPrice.hidden=!Number.isFinite(lastY)||lastY<0||lastY>plotHeight;
  if (badge && currentPrice && Number.isFinite(lastY)) {
    badge.removeAttribute("hidden");
    let priceText=badge.querySelector('strong'),timeText=badge.querySelector('small');
    if(!priceText){priceText=document.createElement('strong');badge.append(priceText);}
    const price=formatChartAxisPrice(last.close);
    if(priceText.textContent!==price)priceText.textContent=price;
    if(mobile){
      if(!timeText){timeText=document.createElement('small');badge.append(timeText);}
      if(timeText.textContent!==countdown)timeText.textContent=countdown;
    }else timeText?.remove();
    const label=`價格 ${price}，收線倒數 ${countdown}`;
    if(badge.getAttribute('aria-label')!==label)badge.setAttribute('aria-label',label);
    const transform=`translate3d(0px, ${lastY}px, 0px)`;
    if(currentPrice.style.transform!==transform)currentPrice.style.transform=transform;
    currentPrice.classList.toggle('is-up', last.close >= last.open);
    badge.classList.toggle('is-up', last.close >= last.open);
  }
  if (mobile) {
    timerEl.hidden=true;
    return;
  }
  timerEl.hidden=false;

  const timeStr = `${h > 0 ? `${h}h ` : ''}${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  const y = state.candleSeries.priceToCoordinate(last.close);
  timerEl.style.transform = "translateY(-50%)";
  const markup=`${fmtPrice(last.close)}<small>倒數 ${timeStr}</small>`;
  if(timerEl.innerHTML!==markup)timerEl.innerHTML=markup;
  if (Number.isFinite(y)) {
    timerEl.style.top = `${Math.max(16, Math.min(document.getElementById("chart").clientHeight - 24, y))}px`;
  }
}
