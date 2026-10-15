import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
const code=readFileSync(new URL('../src/components/account/feature-access.js',import.meta.url),'utf8');
const defaultsCode=readFileSync(new URL('../src/generated/feature-defaults.js',import.meta.url),'utf8');
const policy=(locked=[])=>({ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:locked.includes(f.id)?'login':'public',version:'fixture'}))});

function element(tagName){
 const node={tagName,id:'',style:{},hidden:false,dataset:{},children:[],attributes:{},isConnected:true,textContent:'',value:'',
  append(...items){this.children.push(...items);},replaceChildren(...items){this.children=[...items];},setAttribute(k,v){this.attributes[k]=v;},
  querySelector(selector){const all=[];const walk=n=>{for(const c of n.children){all.push(c);walk(c);}};walk(this);
   return all.find(c=>selector.startsWith('#')?c.id===selector.slice(1):c.tagName===selector)||null;}};
 return node;
}
function browser({storage=new Map(),fetcher,defaults=null}){
 const listeners=new Map(),classes=new Set(),appended=[];
 const body={...element('body'),dataset:{view:'radar',market:'crypto'},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},append(...n){appended.push(...n);}};
 const document={readyState:'complete',hidden:false,head:{append(){}},body,createElement:element,
  addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
  dispatchEvent:event=>{for(const fn of listeners.get(event.type)||[])fn(event);return true;}};
 const context={document,location:{href:'https://ox.test/'},history:{state:null,replaceState(){}},URL,CustomEvent,AbortController,Promise,Error,JSON,Map,Set,Date,Math,Number,Array,
  sessionStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v))},
  fetch:fetcher,addEventListener(){},
  setTimeout:(fn,ms)=>{if(ms<=0)return setImmediate(fn);timers.push({fn,ms});return timers.length;},clearTimeout:id=>{if(typeof id==='number'&&timers[id-1])timers[id-1].fn=null;},setInterval:()=>0};
 const timers=[];context.window=context;context.globalThis=context;
 if(defaults)context.OXFeatureDefaults=defaults;else runInNewContext(defaultsCode,context);
 runInNewContext(code,context);
 const fire=ms=>{for(const t of timers)if(t.ms===ms&&t.fn){const fn=t.fn;t.fn=null;fn();}};
 return {context,storage,fire,blocked:()=>classes.has('ox-feature-blocked'),gate:()=>appended.find(n=>n.id==='ox-feature-gate'),settle:async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));}};
}
const respond=(status,body)=>async()=>({ok:status===200,status,json:async()=>body});

test('the frontend defaults are generated from the shared catalog and never infer public',()=>{
 const context={};context.globalThis=context;runInNewContext(defaultsCode,context);
 assert.deepEqual(Object.keys(context.OXFeatureDefaults).sort(),FEATURE_CATALOG.map(f=>f.id).sort());
 for(const f of FEATURE_CATALOG){assert.equal(context.OXFeatureDefaults[f.id].mode,f.defaultMode);assert.equal(context.OXFeatureDefaults[f.id].label,f.label);}
 assert.ok(FEATURE_CATALOG.every(f=>['public','login'].includes(f.defaultMode)));
});

test('first visit with an unavailable policy API uses the provisional defaults: login products get a retryable gate, not public',async()=>{
 const page=browser({fetcher:respond(503,{ok:false})});await page.settle();
 assert.equal(page.context.OXFeatures.state,'provisional');assert.equal(page.context.OXFeatures.ready,true);
 assert.equal(page.blocked(),true,'a login-default product is not shown as public');
 const gate=page.gate();assert.ok(gate.querySelector('#ox-feature-retry'));assert.equal(gate.querySelector('#ox-feature-login').hidden,false);
 assert.match(gate.querySelector('p').textContent,/仍在確認/);
 assert.equal(page.context.OXFeatures.canPreload('crypto.patterns'),false,'an unverified policy never starts speculative work');
});

test('a slow first answer lifts the page block at the deadline without cancelling the request; the late answer is adopted',async()=>{
 let resolve,signal;const page=browser({fetcher:(url,options)=>{signal=options.signal;return new Promise(r=>resolve=r);}});await page.settle();
 assert.equal(page.context.OXFeatures.state,'pending');assert.equal(page.gate(),undefined);
 page.fire(4000);await page.settle();
 assert.equal(page.context.OXFeatures.state,'provisional');assert.ok(page.gate(),'the deadline shows the retryable gate instead of an endless block');
 assert.equal(signal.aborted,false,'the deadline never aborts the policy request');
 resolve({ok:true,status:200,json:async()=>policy()});await page.settle();
 assert.equal(page.context.OXFeatures.state,'ready');assert.equal(page.blocked(),false,'the verified public policy reveals the page');
});

test('a provisional public default renders while provisional login defaults stay gated',async()=>{
 const defaults=Object.fromEntries(FEATURE_CATALOG.map(f=>[f.id,{mode:f.id==='crypto.radar'?'public':'login',label:f.label}]));
 const page=browser({defaults,fetcher:respond(503,{ok:false})});await page.settle();
 assert.equal(page.context.OXFeatures.state,'provisional');assert.equal(page.blocked(),false);
 assert.equal(page.context.OXFeatures.enterTool('patterns','data-crypto-tool',()=>{}),false);assert.equal(page.blocked(),true);
});

test('a failed refresh keeps the last verified policy and the tab cache',async()=>{
 let fail=false;const page=browser({fetcher:async()=>fail?Promise.reject(Error('offline')):respond(200,policy())()});await page.settle();
 assert.equal(page.context.OXFeatures.state,'ready');assert.equal(page.blocked(),false);
 const saved=JSON.parse(page.storage.get('ox-feature-policy-v1'));assert.equal(saved.features.length,11);
 fail=true;await page.context.OXFeatures.refresh();await page.settle();
 assert.equal(page.context.OXFeatures.state,'stale');assert.equal(page.context.OXFeatures.ready,true);
 assert.equal(page.blocked(),false,'one failed poll must not remove the page');
 assert.equal(page.context.OXFeatures.canPreload('crypto.radar'),true);
 assert.ok(page.storage.has('ox-feature-policy-v1'));
});

test('a cached policy renders public products before the API answers',async()=>{
 const storage=new Map([['ox-feature-policy-v1',JSON.stringify({at:Date.now(),...policy()})]]);
 const page=browser({storage,fetcher:()=>new Promise(()=>{})});await page.settle();
 assert.equal(page.context.OXFeatures.state,'stale');assert.equal(page.blocked(),false);
 const expired=browser({storage:new Map([['ox-feature-policy-v1',JSON.stringify({at:Date.now()-13*3600000,...policy()})]]),fetcher:()=>new Promise(()=>{})});await expired.settle();
 assert.equal(expired.context.OXFeatures.state,'pending','an expired cache is not trusted');assert.equal(expired.blocked(),true);
});

test('only a login product shows the retryable gate while the policy check fails',async()=>{
 const storage=new Map([['ox-feature-policy-v1',JSON.stringify({at:Date.now(),...policy(['crypto.radar'])})]]);
 const page=browser({storage,fetcher:respond(503,{ok:false})});await page.settle();
 assert.equal(page.context.OXFeatures.state,'stale');assert.equal(page.blocked(),true);
 const gate=page.gate();assert.ok(gate);assert.ok(gate.querySelector('#ox-feature-retry'));assert.match(gate.querySelector('p').textContent,/需要註冊登入/);
 assert.equal(page.context.OXFeatures.enterView('home'),true);assert.equal(page.blocked(),false,'public products remain usable');
});
