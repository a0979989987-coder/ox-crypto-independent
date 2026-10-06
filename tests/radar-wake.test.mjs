import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync(new URL('../src/markets/crypto/scanner.js',import.meta.url),'utf8');
test('a returning radar wakes the existing scan sleeper immediately without creating another loop',async()=>{
 const listeners=new Map(),timers=new Map();let id=0,cancelled=0;
 const document={hidden:false,addEventListener:(event,fn)=>listeners.set(event,fn)};
 const state={activeMarket:'crypto',activeView:'strength'};
 const context={state,document,OXPublicFeed:{cancel:()=>cancelled++},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:key=>timers.delete(key)};
 const api=runInNewContext(code+'\n({waitForRadar})',context);let resolved=false;
 const work=api.waitForRadar(8000).then(()=>resolved=true);state.activeView='radar';listeners.get('ox:viewchange')();await work;
 assert.equal(resolved,true);assert.equal(timers.size,0);assert.equal(cancelled,0);
 state.activeView='strength';listeners.get('ox:viewchange')();assert.equal(cancelled,1);
 const rest=api.waitForRadar(2500);document.hidden=true;listeners.get('visibilitychange')();await rest;assert.equal(timers.size,0);
});
