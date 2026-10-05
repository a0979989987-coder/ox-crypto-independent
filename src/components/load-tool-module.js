import { withDeadline } from './resource-deadline.js';
const failed = new Set();
const loaded = new Map();
const bundledTools=new Set(["crypto/patterns/view.js","crypto/bubbles/view.js","crypto/analytics/flow-view.js","tw/patterns/source.js","tw/patterns/index-cache.js","tw/bubbles/view.js","tw/etf/view.js","tw/etf/savings.js"].map(p=>"/src/markets/"+p));
let attempt = 0;
const transient = error => error?.name === 'TimeoutError' ||
  error?.name === 'TypeError' && /fetch|dynamically imported module|importing a module script|load.*module|module.*load/i.test(error.message);
function freshURL(url) {
  const retry = new URL(url);
  retry.searchParams.set('oxImportRetry', `${Date.now()}-${++attempt}`);
  return retry.href;
}
// Bound stalled imports too. Each manual retry must escape the rejected entry
// from the previous automatic retry, not repeatedly import oxImportRetry=1.
async function loadModule(url,{current=()=>true,importer=url=>import(url),pause=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=15000}={}){
  url=String(url);
  if(loaded.has(url))return loaded.get(url);
  for(let retry=0;retry<2;retry++){
    if(!current())throw new DOMException('已切換工具','AbortError');
    const target=failed.has(url)?freshURL(url):url;
    try{const module=await withDeadline(()=>importer(target),timeoutMs,'工具下載逾時');loaded.set(url,module);failed.delete(url);return module;}
    catch(error){
      if(!transient(error)||!current())throw error;
      failed.add(url);
      if(retry)throw error;
      await pause(250);
    }
  }
}

export async function loadToolModule(url,options={}) {
  if(options.current&&!options.current())throw new DOMException('已切換工具','AbortError');
  const original=String(url),parsed=new URL(original),bundle=bundledTools.has(parsed.pathname);
  if(!bundle)return loadModule(original,options);
  if(globalThis.OXToolModules)return globalThis.OXToolModules[parsed.pathname];
  if(globalThis.OXRuntimeReady){await globalThis.OXRuntimeReady;if(options.current&&!options.current())throw new DOMException('已切換工具','AbortError');return globalThis.OXToolModules[parsed.pathname];}
  throw Error('市場介面尚未載入，請重新連線');
}
