import {withDeadline} from './resource-deadline.js';
const state=globalThis.__OXToolLoads??={loaded:new Map(),pending:new Map(),failed:new Set(),attempt:0};
const bundles=new Map([['crypto/patterns/view.js','patterns'],['crypto/bubbles/view.js','bubbles'],['crypto/analytics/flow-view.js','analytics']].map(([p,id])=>['/src/markets/'+p,'/src/generated/tool-'+id+'.js?v=20261007-ux-replay3']));
const transient=e=>e?.name==='TimeoutError'||e?.name==='TypeError'&&/fetch|dynamically imported module|importing a module script|load.*module|module.*load/i.test(e.message);
export async function loadToolModule(url,{current=()=>true,importer=url=>import(url),pause=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=15000}={}){
  if(!current())throw new DOMException('已切換工具','AbortError');
  const parsed=new URL(String(url)),target=bundles.get(parsed.pathname),key=target?new URL(target,parsed).href:parsed.href;
  if(state.loaded.has(key))return state.loaded.get(key);
  let pending=state.pending.get(key);
  if(!pending){
    pending={readers:new Set()};state.pending.set(key,pending);
    pending.task=(async()=>{
      await Promise.resolve();
      for(let retry=0;retry<2;retry++){
        if(![...pending.readers].some(check=>check()))throw new DOMException('已切換工具','AbortError');
        const attempt=new URL(key);if(state.failed.has(key))attempt.searchParams.set('oxImportRetry',`${Date.now()}-${++state.attempt}`);
        try{const module=await withDeadline(()=>importer(attempt.href),timeoutMs,'工具下載逾時');state.loaded.set(key,module);state.failed.delete(key);return module;}
        catch(error){if(!transient(error))throw error;state.failed.add(key);if(retry)throw error;await pause(250);}
      }
    })().finally(()=>state.pending.delete(key));
  }
  pending.readers.add(current);
  try{const module=await pending.task;if(!current())throw new DOMException('已切換工具','AbortError');return module;}
  finally{pending.readers.delete(current);}
}
