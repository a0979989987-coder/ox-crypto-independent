// Loading belongs to the data region. Keep the same ring through progress
// updates so the compositor animation never restarts when counts change.
(() => {
 const tasks=new Map(),regions=new Map();let timer;
 const css=`.ox-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;color:#dcded7;font:11px/1.4 Inter,system-ui,sans-serif;text-align:center}.ox-loading-ring{display:block;flex:none;width:18px;height:18px;border:2px solid #ffffff24;border-top-color:#eceee8;border-radius:50%;will-change:transform;animation:ox-loading-turn .85s linear infinite;backface-visibility:hidden}.ox-loading-count{font-size:10px;font-variant-numeric:tabular-nums;color:#b5beb8}.ox-loading-label{max-width:190px}.ox-region-loading{grid-column:1/-1;min-width:0;position:static;display:grid;place-items:center;padding:8px;pointer-events:none}.ox-region-loading[hidden],.ox-tool-loading[hidden]{display:none}.ox-tool-loading{min-height:220px;display:grid;place-items:center}@keyframes ox-loading-turn{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.ox-loading-ring{animation-duration:2s}}`;
 const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const count=(done,total)=>`${Math.max(0,Math.min(total,done||0))}/${total}`;
 const markup=(label='資料載入中',done,total)=>`<span class="ox-loading" role="status"><i class="ox-loading-ring" aria-hidden="true"></i><span class="ox-loading-count"${Number.isFinite(total)&&total>0?'':' hidden'}>${Number.isFinite(total)&&total>0?count(done,total):''}</span><span class="ox-loading-label">${escape(label)}</span></span>`;
 function render(target,label,done,total){
  if(!target)return;
  if(!target.querySelector('.ox-loading'))target.innerHTML=markup(label,done,total);
  const text=target.querySelector('.ox-loading-label'),counter=target.querySelector('.ox-loading-count');
  if(text.textContent!==String(label))text.textContent=label;
  counter.hidden=!(Number.isFinite(total)&&total>0);const next=counter.hidden?'':count(done,total);if(counter.textContent!==next)counter.textContent=next;
 }
 const style=document.createElement('style');style.textContent=css;document.head.append(style);
 function defaultTarget(market,view){
  // Radar lists publish available rows during scans. Background data tasks
  // must not append a loading animation to those lists.
  if(view==='radar'&&['crypto','tw'].includes(market))return null;
  if(market==='crypto')return document.querySelector(view==='radar'?'#radar-scanner-panel':view==='home'?'.ox-home-t1':':not(*)');
  if(market==='tw')return document.querySelector(view==='radar'?'.twcr-scanner':':not(*)');
  return null;
 }
 function paint(){
  timer=null;if(!document.body)return;
  const market=document.body.dataset.market||'crypto',view=document.body.dataset.view||'radar',active=new Map();
  for(const task of [...tasks.values()].sort((a,b)=>Number(Boolean(b.total))-Number(Boolean(a.total))||b.at-a.at)){
   if(task.market!==market||task.views&&!task.views.includes(view))continue;
   const target=typeof task.target==='function'?task.target():task.target||defaultTarget(market,view);
   if(target&&!active.has(target))active.set(target,task);
  }
  for(const [target,region]of regions)if(!active.has(target)){region.node.remove();if(region.wasHidden)target.hidden=true;regions.delete(target);}
  for(const [target,task]of active){
   let region=regions.get(target);
   if(!region){const node=document.createElement('span');node.className='ox-region-loading';region={node,wasHidden:target.hidden};regions.set(target,region);target.append(node);}
   else if(!target.contains(region.node))target.append(region.node);
   if(region.wasHidden)target.hidden=false;
   render(region.node,task.label,task.done,task.total);
  }
 }
 function schedule(){if(!timer)timer=setTimeout(paint,80);}
 window.OXLoading=Object.freeze({css,markup,render,
  begin(market,label,options={}){
   const token=Symbol(label),task={market,label,at:Date.now(),...options};tasks.set(token,task);schedule();
   const finish=()=>{tasks.delete(token);options.signal?.removeEventListener('abort',finish);schedule();};
   if(options.signal){if(options.signal.aborted)finish();else options.signal.addEventListener('abort',finish,{once:true});}
   return {update(done,total){if(tasks.has(token)){task.done=done;task.total=total;schedule();}},finish};
  }
 });
 document.addEventListener('DOMContentLoaded',paint,{once:true});document.addEventListener('ox:marketchange',paint);document.addEventListener('ox:viewchange',paint);
})();
