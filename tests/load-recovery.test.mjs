import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {loadToolModule} from '../src/components/load-tool-module.js';

test('a second manual attempt escapes both rejected module URLs and reuses success',async()=>{
  const seen=[];let recover=false;
  const options={pause:async()=>{},importer:async url=>{seen.push(url);if(!recover)throw new TypeError('Importing a module script failed.');return {ready:true};}};
  const url='https://test.invalid/recovery.js';
  await assert.rejects(loadToolModule(url,options));
  recover=true;const module=await loadToolModule(url,options);
  assert.equal(module.ready,true);assert.equal(new Set(seen).size,3);
  assert.equal(await loadToolModule(url,options),module);assert.equal(seen.length,3);
});
test('stalled imports expire and stale navigation does not retry',async()=>{
  let calls=0;const url='https://test.invalid/stalled.js';
  await assert.rejects(loadToolModule(url,{timeoutMs:10,pause:async()=>{},importer:()=>{calls++;return new Promise(()=>{});}}),{name:'TimeoutError'});
  assert.equal(calls,2);
  await assert.rejects(loadToolModule('https://test.invalid/cancelled.js',{current:()=>false,importer:()=>{throw Error('must not run');}}),{name:'AbortError'});
});
test('programming errors are reported instead of retried as network failures',async()=>{
  let calls=0;
  await assert.rejects(loadToolModule('https://test.invalid/bug.js',{importer:()=>{calls++;throw new TypeError('Cannot read properties of null');}}),/null/);
  assert.equal(calls,1);
});
const apiSource=await readFile(new URL('../src/markets/crypto/api.js',import.meta.url),'utf8');
test('Bitget fetch and body stalls time out without AbortSignal.timeout, and later requests recover',async()=>{
  for(const phase of ['fetch','body']){
    let recover=false,signal;
    const context=vm.createContext({AbortController,DOMException,setTimeout,clearTimeout,URL,fetch:async(_url,options)=>{signal=options.signal;
      if(recover)return {ok:true,json:async()=>({code:'00000',data:[1]})};
      if(phase==='fetch')return new Promise(()=>{});
      return {ok:true,json:()=>new Promise(()=>{})};
    }});
    vm.runInContext(await readFile(new URL('../src/core/public-feed.js',import.meta.url),'utf8'),context);
    vm.runInContext('OXPublicFeed=OXPublicFeed.create({intervalMs:1})',context);
    vm.runInContext(apiSource,context);
    await assert.rejects(vm.runInContext('fetchBitgetJSON("https://test.invalid",10)',context),{name:'TimeoutError'});
    assert.equal(signal.aborted,true);recover=true;
    assert.equal((await vm.runInContext('fetchBitgetJSON("https://test.invalid",10)',context)).data[0],1);
  }
});

const {withDeadline}=await import('../src/components/resource-deadline.js');
test('departed view releases a stalled body immediately, without waiting for its deadline',async()=>{
 const controller=new AbortController();let inner;
 const pending=withDeadline(signal=>{inner=signal;return new Promise(()=>{});},60000,'stall',{signal:controller.signal});
 await Promise.resolve();controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(inner.aborted,true);
});
