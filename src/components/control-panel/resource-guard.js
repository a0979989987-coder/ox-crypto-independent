(() => {
  const rules=document.createElement('style');rules.textContent='#ox-control-overlay:not(.is-open){visibility:hidden!important;pointer-events:none!important}#ox-control-overlay.is-open[data-resource-state]{position:fixed!important;inset:0!important;z-index:10000!important;display:flex!important;justify-content:flex-end!important;background:#0008!important}#ox-control-overlay[data-resource-state] #ox-control-panel{visibility:hidden!important}#ox-control-resource-shell{position:absolute;right:12px;top:12px;max-width:calc(100vw - 24px);width:300px;padding:20px;box-sizing:border-box;border:1px solid #889097;border-radius:16px;background:#15191d;color:#eee;font:15px/1.5 system-ui}#ox-control-resource-shell button{font:inherit;min-height:44px;margin:8px 8px 0 0;padding:6px 12px;border:1px solid #889097;border-radius:9px;background:transparent;color:inherit}';document.head.append(rules);
  const tasks=new Map();
  const critical=/\/(foundation|control-center|feature-pack|control-menu-compact|editorial-terminal|light-compat|light-platinum|simple-close)\.css(?:\?|$)/;
  function ready(link){if(link.dataset.oxRecovered)return true;try{return !!link.sheet?.cssRules?.length;}catch{return false;}}
  async function load(link){if(ready(link))return;
    const href=link.href;if(tasks.has(href))return tasks.get(href);
    const task=(async()=>{let error;for(let attempt=0;attempt<2;attempt++){const controller=new AbortController();let timer;
      try {const css=await Promise.race([(async()=>{const r=await fetch(href,{signal:controller.signal,cache:attempt?'reload':'default'});if(!r.ok)throw Error(`樣式 HTTP ${r.status}`);return r.text();})(),new Promise((_,reject)=>timer=setTimeout(()=>{controller.abort();reject(Error('樣式讀取逾時'));},8000))]);
        if(!css.trim()||/<(?:!doctype|html)\b/i.test(css))throw Error('樣式格式錯誤');
        const style=document.createElement('style');style.textContent=css.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,(m,q,p)=>/^(data:|blob:|#)/i.test(p)?m:`url("${new URL(p,href).href}")`);link.after(style);link.dataset.oxRecovered='true';return;
      }catch(e){error=e;}finally{clearTimeout(timer);}}
      throw error;
    })();tasks.set(href,task);task.catch(()=>tasks.delete(href));return task;
  }
  async function ensure(overlay,onClose){overlay.dataset.resourceState='pending';let shell=overlay.querySelector('#ox-control-resource-shell');if(!shell){shell=document.createElement('div');shell.id='ox-control-resource-shell';shell.setAttribute('role','status');overlay.append(shell);}
    shell.replaceChildren();const message=document.createElement('div');message.textContent='正在載入選單樣式…';const close=document.createElement('button');close.textContent='關閉';close.onclick=onClose;shell.append(message,close);
    try{await Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].filter(l=>critical.test(l.href)).map(load));shell.remove();delete overlay.dataset.resourceState;return true;}
    catch(error){overlay.dataset.resourceState='error';message.textContent='選單樣式暫時未載入，請重新連線。';const retry=document.createElement('button');retry.textContent='重新連線';retry.onclick=()=>ensure(overlay,onClose);shell.append(retry);return false;}
  }
  globalThis.OXControlResources=Object.freeze({ensure});
})();
