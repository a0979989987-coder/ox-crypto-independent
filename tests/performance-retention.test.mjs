import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
import {preparation} from './classic-fixtures.mjs';
test('prepared worker eviction reconstructs every requested series without reducing coverage',async()=>{
 const code=await readFile(new URL('../src/generated/pattern-worker.js',import.meta.url),'utf8'),messages=[],context=vm.createContext({self:{postMessage:message=>messages.push(message)},console});vm.runInContext(code,context);
 const entries=Array.from({length:90},(_,i)=>({key:'SERIES'+i,candles:preparation()}));
 for(const entry of entries)context.self.onmessage({data:{type:'index',id:entry.key,...entry}});
 assert.equal(messages.length,90);assert.equal(messages.some(m=>m.error),false);messages.length=0;
 for(let i=0;i<entries.length;i+=25){const batch=entries.slice(i,i+25);context.self.onmessage({data:{type:'search',id:i,entries:batch,keys:batch.map(e=>e.key),query:{id:'horizontal-resistance'}}});}
 assert.equal(messages.some(m=>m.error),false);const found=messages.flatMap(m=>m.result.map(r=>r.key));assert.deepEqual(new Set(found),new Set(entries.map(e=>e.key)));
});
test('account watchlist scope switches immediately without copying guest or other-user data',async()=>{
 const source=await readFile(new URL('../src/components/account/store.js',import.meta.url),'utf8'),prefix=source.slice(0,source.indexOf('// Identity'));
 const storage=new Map([['ox-watchlist',JSON.stringify([{symbol:'GUESTUSDT'}])],['ox-watchlist:user:a',JSON.stringify([{symbol:'AUSDT'}])]]);
 const window={OXAuth:{user:null}},context=vm.createContext({window,localStorage:{getItem:key=>storage.get(key)},console});vm.runInContext(prefix,context);
 assert.equal(context.getWatchlistRecords()[0].symbol,'GUESTUSDT');window.OXAuth.user={id:'a'};assert.equal(context.getWatchlistRecords()[0].symbol,'AUSDT');window.OXAuth.user={id:'b'};assert.equal(context.getWatchlistRecords().length,0);window.OXAuth.user=null;assert.equal(context.getWatchlistRecords()[0].symbol,'GUESTUSDT');
});
