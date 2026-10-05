import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/components/account/auth.js',import.meta.url),'utf8');
function fixture(fetcher,storage=new Map()){
 let now=100000;const document={dispatchEvent(){}};
 class Clock extends Date {static now(){return now;}}
 const context={window:{sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))}},document,Date:Clock,URL,location:{pathname:'/',search:'',hash:'',assign(){}},CustomEvent:class{constructor(type,detail){this.type=type;this.detail=detail;}},fetch:fetcher};
 vm.runInNewContext(source,context);return {auth:context.window.OXAuth,advance:ms=>now+=ms,storage};
}
const json=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});

test('late email verification cannot restore a logged-out member',async()=>{
 let release;const gate=new Promise(r=>release=r);
 const f=fixture(async url=>url.endsWith('/verify')?(await gate,json({ok:true,user:{id:'synthetic-member'}})):json({ok:true}));
 const stale=f.auth.verifyEmail('member@example.test','123456');await f.auth.signOut();release();await stale;assert.equal(f.auth.user,null);
});
test('late session read cannot restore a logged-out member',async()=>{
 let release;const gate=new Promise(r=>release=r);let reads=0;
 const f=fixture(async url=>url.endsWith('/config')?json({configured:true}):url.endsWith('/logout')?json({ok:true}):++reads===1?json({ok:true,user:{id:'synthetic-member'}}):(await gate,json({ok:true,user:{id:'synthetic-member'}})));
 await f.auth.initialize();const stale=f.auth.getCurrent();await f.auth.signOut();release();await stale;assert.equal(f.auth.user,null);
});
test('email pending calls are coalesced and success cooldown survives reload',async()=>{
 let release,calls=0;const gate=new Promise(r=>release=r),fetcher=async()=>{calls++;await gate;return json({ok:true,message:'sent'});};
 const f=fixture(fetcher);const first=f.auth.registerWithEmail('member@example.test'),second=await f.auth.signInWithEmail('member@example.test');assert.equal(second.code,'EMAIL_REQUEST_PENDING');assert.equal(calls,1);release();await first;
 const repeat=await f.auth.signInWithEmail('member@example.test');assert.equal(repeat.code,'EMAIL_COOLDOWN');assert.equal(calls,1);
 const reload=fixture(fetcher,f.storage);assert.equal((await reload.auth.registerWithEmail('member@example.test')).code,'EMAIL_COOLDOWN');assert.equal(calls,1);reload.advance(61000);assert.equal((await reload.auth.signInWithEmail('member@example.test')).ok,true);assert.equal(calls,2);
 assert.ok([...f.storage.values()].every(v=>/^\d+$/.test(v)),'Persist only a deadline, no email or token');
});
test('429 is explicit and never auto-retries email sending',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return json({ok:false,message:'rate limited'},429);});
 assert.equal((await f.auth.registerWithEmail('member@example.test')).code,'EMAIL_RATE_LIMITED');assert.equal((await f.auth.signInWithEmail('member@example.test')).code,'EMAIL_COOLDOWN');assert.equal(calls,1);
});
