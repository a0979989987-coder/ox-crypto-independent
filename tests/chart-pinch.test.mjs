import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function harness(){
  const source=readFileSync(new URL('../src/components/chart/workspace.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('window.OXChartGestures ='),source.indexOf('\nfunction applyChartFutureSpace('));
  const listeners=new Map(),prices=[],table={rows:[{},{}]};
  let logical={from:0,to:100};
  const ts={getVisibleLogicalRange:()=>({...logical}),setVisibleLogicalRange:r=>{logical={...r};},width:()=>300,height:()=>26};
  const state={chartPriceViewport:{minValue:-10,maxValue:10},chartPriceViewportMargins:{above:0,below:0},chart:{timeScale:()=>ts,clearCrosshairPosition(){}}};
  const container={clientWidth:300,clientHeight:426,querySelector:selector=>selector.includes('table')?table:null,getBoundingClientRect:()=>({left:0,top:0}),addEventListener(type,fn,options){listeners.set(type,fn);options?.signal?.addEventListener('abort',()=>listeners.delete(type));}};
  const target=area=>({closest:selector=>selector==='.chart-price-axis'?(area==='price'?{}:null):selector==='td'?{cellIndex:1,parentElement:table.rows[area==='time'?1:0],closest:()=>table}:null});
  const bind=runInNewContext(`${fn}\nenableMobileChartPriceGestures`,{AbortController,formatChartAxisPrice:String,state,document:{querySelector:()=>null},window:{matchMedia:()=>({matches:true})},performance:{now:()=>1000},setTimeout:()=>1,clearTimeout(){},getChartVisiblePriceRange:()=>({minValue:0,maxValue:10}),setChartVisiblePriceRange:r=>prices.push(r),refreshChartPriceViewport(){}});
  const instance=bind(container);
  const emit=(type,points,area='plot')=>listeners.get(type)({target:target(area),touches:points.map(([clientX,clientY])=>({clientX,clientY})),preventDefault(){},stopPropagation(){}});
  return {state,prices,emit,logical:()=>logical,instance,listeners};
}

test('pinch changes visible candle count and restores price autoscale instead of stretching the price range',()=>{
  const h=harness();h.emit('touchstart',[[80,100],[180,200]]);h.emit('touchmove',[[30,50],[230,250]]);
  assert.equal(h.state.chartPriceViewport,null);
  assert.equal(h.state.chartPriceViewportMargins,null);
  assert.equal(h.prices.length,0,'no manual price range may be written by a pinch');
  assert.equal(h.logical().to-h.logical().from,50);
});

test('a finger landing on price labels cannot turn a two-finger pinch into axis scaling',()=>{
  const h=harness();h.emit('touchstart',[[280,120]],'price');h.emit('touchstart',[[280,120],[80,160]],'price');h.emit('touchmove',[[280,80],[40,200]],'price');
  assert.equal(h.state.chartPriceViewport,null);assert.equal(h.prices.length,0);assert(h.logical().to-h.logical().from<100);
});

test('releasing fingers separately cannot shift prices, and the next axis drag still works',()=>{
  const h=harness();h.emit('touchstart',[[80,100],[180,200]]);h.emit('touchmove',[[30,50],[230,250]]);
  h.emit('touchend',[[30,50]]);h.emit('touchmove',[[30,150]]);h.emit('touchend',[]);
  assert.equal(h.prices.length,0);assert.equal(h.state.chartPriceViewport,null);
  h.emit('touchstart',[[280,100]],'price');h.emit('touchmove',[[280,180]],'price');h.emit('touchend',[]);
  assert.equal(h.prices.length,1,'one-finger price-axis ratio control is preserved');
});

test('shared gesture instance releases touch listeners when Taiwan radar leaves the page',()=>{
 const h=harness();assert.ok(h.listeners.size>0);h.instance.destroy();assert.equal(h.listeners.size,0);
});
