import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/components/loading-state.js',import.meta.url),'utf8');
class Node {
 constructor(){this.children=[];this.hidden=false;this.textContent='';}
 append(n){n.parent=this;this.children.push(n);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 contains(n){return this.children.includes(n);}
 set innerHTML(value){this.html=value;this.children=[];for(const cls of ['ox-loading','ox-loading-ring','ox-loading-count','ox-loading-label']){const n=new Node();n.className=cls;this.append(n);}}
 querySelector(selector){return this.children.find(n=>'.'+n.className===selector)||null;}
}
function fixture(){
 const events=new Map(),timers=new Map(),target=new Node(),body=new Node();body.dataset={market:'crypto',view:'radar'};
 const document={head:new Node(),body,createElement:()=>new Node(),querySelector:()=>null,addEventListener:(type,fn)=>events.set(type,fn)};
 const window={};let id=0;
 vm.runInNewContext(source,{window,document,Symbol,Date,setTimeout:fn=>{timers.set(++id,fn);return id;}});
 const flush=()=>{const work=[...timers.values()];timers.clear();work.forEach(f=>f());};
 return {api:window.OXLoading,document,events,flush,target,timers};
}
test('progress stays inside its owner and never restarts the same loading ring',()=>{
 const f=fixture(),first=f.api.begin('crypto','行情',{target:f.target}),second=f.api.begin('crypto','標的',{target:f.target,done:0,total:12});f.flush();
 const region=f.target.children[0],ring=region.querySelector('.ox-loading-ring');assert.equal(region.querySelector('.ox-loading-count').textContent,'0/12');assert.equal(f.document.body.children.length,0);
 for(let n=1;n<=9;n++)second.update(n,12);assert.equal(f.timers.size,1);first.finish();f.flush();
 assert.equal(f.target.children[0],region);assert.equal(region.querySelector('.ox-loading-ring'),ring);assert.equal(region.querySelector('.ox-loading-count').textContent,'9/12');
 f.document.body.dataset.market='tw';f.events.get('ox:marketchange')();assert.equal(f.target.children.length,0);
 f.document.body.dataset.market='crypto';f.events.get('ox:marketchange')();assert.equal(f.target.children.length,1);
 second.finish();f.flush();assert.equal(f.target.children.length,0);
});
test('background tasks without an owner create no popup; abort and leaving a view clear local loading',()=>{
 const f=fixture(),life=new AbortController();f.api.begin('crypto','背景載入');f.flush();assert.equal(f.document.body.children.length,0);
 f.target.hidden=true;f.api.begin('crypto','掃描',{target:f.target,signal:life.signal,views:['strength']});f.flush();assert.equal(f.target.children.length,0);
 f.document.body.dataset.view='strength';f.events.get('ox:viewchange')();assert.equal(f.target.hidden,false);assert.equal(f.target.children.length,1);
 life.abort();f.flush();assert.equal(f.target.children.length,0);assert.equal(f.target.hidden,true);
 f.api.begin('crypto','已取消',{target:f.target,signal:life.signal});f.flush();assert.equal(f.target.children.length,0);
 assert.match(f.api.markup('行情'),/ox-loading-count" hidden/);
});
test('OX LIVE starts off, restores an explicit preference and stays off when storage is unavailable',()=>{
  const code=readFileSync(new URL('../src/app/live-visibility.js',import.meta.url),'utf8');
  for(const [value,expected] of [[null,true],['0',true],['1',false],['unrecognized',true]]){
    let disabled;vm.runInNewContext(code,{localStorage:{getItem:()=>value},document:{documentElement:{classList:{toggle:(_,v)=>disabled=v}}}});assert.equal(disabled,expected);
  }
  let hidden=false;vm.runInNewContext(code,{localStorage:{getItem(){throw Error('blocked');}},document:{documentElement:{classList:{add:()=>hidden=true}}}});assert(hidden);
});
test('Crypto and Taiwan background data tasks never animate their radar lists',()=>{
 const f=fixture();f.document.querySelector=()=>f.target;
 for(const market of ['crypto','tw']){
  f.document.body.dataset.market=market;
  const task=f.api.begin(market,'更新標的',{views:['radar','home'],done:1,total:100});f.flush();
  assert.equal(f.target.children.length,0);
  if(market==='crypto'){
   f.document.body.dataset.view='home';f.events.get('ox:viewchange')();assert.equal(f.target.children.length,1);
   f.document.body.dataset.view='radar';f.events.get('ox:viewchange')();assert.equal(f.target.children.length,0);
  }
  task.finish();f.flush();
 }
});
