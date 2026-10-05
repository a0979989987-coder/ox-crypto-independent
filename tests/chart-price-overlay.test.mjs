import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/components/chart/workspace.js',import.meta.url),'utf8');
const scheduler=source.slice(source.indexOf('let chartPriceOverlayFrame'),source.indexOf('\nfunction renderCompactChartPriceAxis'));
const refresh=source.slice(source.indexOf('function refreshChartPriceViewport'),source.indexOf('\nfunction chartPriceAutoscale'));
function harness(){
 const frames=[],calls=[];
 const api=runInNewContext(scheduler+'\n'+refresh+'\n({scheduleChartPriceOverlayUpdate,refreshChartPriceViewport})',{
  requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},
  updatePriceTimer:()=>calls.push('price/countdown'),updateKeyLevelVisualLabels:()=>calls.push('levels'),chartPriceAutoscale(){},
  state:{chart:{priceScale:()=>({applyOptions:()=>calls.push('chart paint queued')})},candleSeries:{applyOptions(){}}},
  document:{dispatchEvent:e=>calls.push(e.type)},Event,
 });
 return {...api,calls,frames};
}
test('vertical price changes update the price/countdown in the next paint without waiting for the one-second timer',()=>{
 const h=harness();h.refreshChartPriceViewport();assert.equal(h.frames.length,1);assert(!h.calls.includes('price/countdown'));
 h.frames[0]();assert(h.calls.includes('price/countdown'));assert(h.calls.indexOf('chart paint queued')<h.calls.indexOf('price/countdown'));
 h.refreshChartPriceViewport();assert.equal(h.frames.length,2,'the next movement queues another paint');
});
test('multiple price and time changes share one overlay update per frame',()=>{
 const h=harness();for(let i=0;i<30;i++){h.refreshChartPriceViewport();h.scheduleChartPriceOverlayUpdate();}
 assert.equal(h.frames.length,1);h.frames[0]();assert.equal(h.calls.filter(c=>c==='price/countdown').length,1);assert.equal(h.calls.filter(c=>c==='levels').length,1);
});
