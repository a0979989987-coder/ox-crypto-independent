import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolWarmup } from '../src/components/tool-warmup.js';
function clock() {
 let time=0,serial=0;const timers=new Map();
 return { now:()=>time, schedule:fn=>{timers.set(++serial,fn);return serial;},unschedule:id=>timers.delete(id),
  async tick(ms=750){time+=ms;const batch=[...timers.values()];timers.clear();for(const fn of batch)fn();for(let i=0;i<8;i++)await Promise.resolve();},count:()=>timers.size };
}
test('prepares tools in order only after foreground eligibility and leaves a quiet gap',async()=>{
 const c=clock(),starts=[];let allowed=false;
 const warm=createToolWarmup({...c,eligible:()=>allowed,jobs:['bubbles','analytics','patterns'].map(id=>({id,run:async()=>starts.push(id)}))});
 await c.tick();assert.deepEqual(starts,[]);allowed=true;
 await c.tick();assert.deepEqual(starts,['bubbles']);await c.tick();assert.deepEqual(starts,['bubbles','analytics']);await c.tick();assert.deepEqual(starts,['bubbles','analytics','patterns']);
 await c.tick();assert.equal(starts.length,3);warm.destroy();assert.equal(c.count(),0);
});
test('a foreground interruption never starts a second job before the old one settles',async()=>{
 const c=clock(),starts=[];let release,signal;
 const warm=createToolWarmup({...c,eligible:()=>true,jobs:[{id:'first',run:s=>{signal=s;starts.push('first');return new Promise(r=>release=r);}},{id:'second',run:async()=>starts.push('second')}]});
 await c.tick();assert.equal(signal.aborted,false);
 warm.poke({interaction:true});assert.equal(signal.aborted,true);await c.tick();assert.deepEqual(starts,['first']);release();for(let i=0;i<8;i++)await Promise.resolve();
 await c.tick();assert.equal(starts.filter(s=>s==='second').length,0);release(); // retry the interrupted first job
 // Complete its restarted promise without leaving a pending timer.
 warm.destroy();release();
});
test('hidden pages stop the idle timer and failure retries are bounded without blocking later tools',async()=>{
 const c=clock(),starts=[];let visible=true;
 const warm=createToolWarmup({...c,enabled:()=>visible,eligible:()=>visible,jobs:[{id:'broken',run:async()=>{starts.push('broken');throw Error('download failed');}},{id:'working',run:async()=>starts.push('working')}]});
 await c.tick();await c.tick();assert.deepEqual(starts,['broken','working']);
 visible=false;warm.poke();assert.equal(c.count(),0);visible=true;warm.poke();await c.tick(60000);await c.tick(60000);
 assert.equal(starts.filter(s=>s==='broken').length,2);assert.equal(warm.stats()[0].status,'failed');warm.destroy();
});
