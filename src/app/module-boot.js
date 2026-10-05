/* One atomic module graph, shared by every market/tool. Failed downloads get
 * two finite attempts; evaluation/mounting remains protected by one boot. */
(() => {
  if(globalThis.OXRuntimeReady)return;
  let attempt=0,pending;
  function start(){if(globalThis.OXToolModules){document.getElementById('ox-runtime-recovery')?.remove();return;}if(pending)return pending;
    const task=(async()=>{let error;for(let retry=0;retry<2;retry++){
      const url=new URL('../generated/runtime.js?v=20261005-first24',document.currentScript?.src||new URL('src/app/module-boot.js',location.href));if(attempt)url.searchParams.set('retry',String(attempt));attempt++;
      let timer;try{await Promise.race([import(url.href),new Promise((_,reject)=>timer=setTimeout(()=>reject(new DOMException('介面下載逾時','TimeoutError')),15000))]);if(!globalThis.OXToolModules)throw globalThis.OXRuntimeError||Error('介面初始化未完成');document.getElementById('ox-runtime-recovery')?.remove();document.dispatchEvent(new Event('ox:runtime-ready'));return;}
      catch(e){error=e;if(e.name!=='TimeoutError'&&!(e.name==='TypeError'&&/fetch|import|load.*module/i.test(e.message)))break;}
      finally{clearTimeout(timer);}
    }throw error;})();pending=task;globalThis.OXRuntimeReady=task;
    task.catch(error=>{pending=null;const box=document.getElementById('ox-runtime-recovery')||document.createElement('div');box.id='ox-runtime-recovery';box.setAttribute('role','status');box.style.cssText='position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:10001;max-width:calc(100vw - 24px);padding:12px;border:1px solid #8a929a;border-radius:12px;background:#171b20;color:#eee;font:14px system-ui';box.replaceChildren();const text=document.createElement('span');text.textContent='市場工具暫時未載入。';const retry=document.createElement('button');retry.textContent='重新連線';retry.style.cssText='margin-left:12px;min-height:44px;font:inherit;color:inherit;background:transparent;border:1px solid #8a929a;border-radius:8px';retry.onclick=()=>start();box.append(text,retry);document.body.append(box);console.warn('[OX runtime]',error.name,error.message);});return task;
  }
  start();
})();
