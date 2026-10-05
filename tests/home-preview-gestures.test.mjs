import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function harness() {
  const source=readFileSync(new URL('../src/components/chart/home-preview.js',import.meta.url),'utf8');
  const listeners=new Map(),timers=new Map(),opened=[],routes=[];
  let now=0,nextId=0;
  const row={dataset:{homeSymbol:'ASTERUSDT',homeTier:'t2',homeSide:'long'}};
  const target={closest:()=>row};
  const document={hidden:false,addEventListener(type,fn,options){const list=listeners.get(type)||[];list.push({fn,options});listeners.set(type,list);}};
  const gesture=source.slice(source.indexOf('  let press=null'),source.lastIndexOf('})();'));
  runInNewContext(`(()=>{${gesture}})()`,{document,performance:{now:()=>now},open:r=>opened.push({...r.dataset}),setScannerDirectionFilter(){},setScannerTierFilter(){},switchSymbol:s=>routes.push(s),setTimeout(fn,delay){const id=++nextId;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)});
  const touch={identifier:9,clientX:40,clientY:50};
  const emit=(type,extra={})=>{for(const {fn} of listeners.get(type)||[])fn({type,target,preventDefault(){},stopImmediatePropagation(){},...extra});};
  return {row,opened,routes,listeners,emit,
    start(){emit('pointerdown',{isPrimary:true,button:0,pointerId:9,clientX:40,clientY:50});emit('touchstart',{touches:[touch],changedTouches:[touch]});},
    move(dx){emit('touchmove',{touches:[{...touch,clientX:40+dx}]});},
    end(type='touchend'){emit(type,{changedTouches:[touch]});},
    elapse(ms){now+=ms;},
    advance(ms){now+=ms;for(const [id,timer] of timers)if(timer.at<=now){timers.delete(id);timer.fn();}}
  };
}

test('home touch hold survives Safari pointer cancel and retains the pressed candidate during updates',()=>{
  const h=harness();h.start();h.advance(1000);h.emit('pointercancel',{pointerId:9});h.move(7);
  h.row.dataset.homeTier='t3';h.advance(999);assert.equal(h.opened.length,0);h.advance(1);
  assert.deepEqual(h.opened,[{homeSymbol:'ASTERUSDT',homeTier:'t2',homeSide:'long'}]);
  h.end();h.emit('click');h.advance(500);assert.equal(h.routes.length,0,'release never navigates away');
  for(const [type,entries] of h.listeners)if(type.startsWith('touch'))assert(entries.every(e=>e.options.passive===true));
});

test('list dragging, touch cancellation, and a second finger outside the row cancel preview',()=>{
  for(const cancel of [h=>h.move(18),h=>h.end('touchcancel'),h=>h.emit('touchstart',{target:{closest:()=>null},touches:[{},{}]})]){
    const h=harness();h.start();h.advance(1000);cancel(h);h.advance(2000);assert.equal(h.opened.length,0);
  }
});

test('a delayed two-second timer is recovered on release; double tap and single tap retain their actions',()=>{
  const hold=harness();hold.start();hold.elapse(2100);hold.end();assert.equal(hold.opened.length,1);hold.emit('click');hold.advance(500);assert.equal(hold.routes.length,0);
  const twice=harness();for(let i=0;i<2;i++){twice.start();twice.advance(60);twice.end();twice.emit('click');}twice.advance(500);assert.equal(twice.opened.length,1);assert.equal(twice.routes.length,0);
  const once=harness();once.start();once.advance(60);once.end();once.emit('click');once.advance(340);assert.deepEqual(once.routes,['ASTERUSDT']);
});
