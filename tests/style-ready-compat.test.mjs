import test from 'node:test';
import assert from 'node:assert/strict';

test('guard preserves stylesheet nodes used by existing tools and releases styled content',async()=>{
  const saved={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch,raf:globalThis.requestAnimationFrame};
  const element=()=>Object.assign(new EventTarget(),{style:{},dataset:{},children:[],setAttribute(){},removeAttribute(){},append(...nodes){this.children.push(...nodes);},remove(){this.removed=true;}});
  const doc=new EventTarget();doc.body={classList:{contains:()=>false}};doc.createElement=element;
  globalThis.document=doc;globalThis.window=new EventTarget();globalThis.requestAnimationFrame=fn=>fn();
  globalThis.fetch=async()=>({ok:true,text:async()=>'.tool{display:flex}'});
  const life=new AbortController();
  try{
    const {guardStyledContent}=await import('../src/components/style-ready.js');
    const main=element(),link=element(),container=element();container.prepend=n=>container.children.unshift(n);
    link.href='https://example.test/compat.css';link.before=style=>{link.previous=style;};
    guardStyledContent(container,main,[link],life.signal,'.tool');
    // Old tool initializers subscribe after calling the guard. Removing this
    // node used to throw before navigation or data loading could complete.
    assert.equal(link.removed,undefined);link.addEventListener('load',()=>{});
    assert.equal(main.inert,true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(link.previous.textContent,'.tool{display:flex}');assert.equal(main.inert,false);
    assert(container.children.find(node=>node.className==='ox-style-loading').removed);
  }finally{life.abort();globalThis.document=saved.document;globalThis.window=saved.window;globalThis.fetch=saved.fetch;globalThis.requestAnimationFrame=saved.raf;}
});
