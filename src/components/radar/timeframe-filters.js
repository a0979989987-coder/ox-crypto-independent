// Market-specific preferences; unavailable classifications never count as a match.
(() => {
 const key=market=>'ox-timeframe-tiers-v1:'+market;
 const tier=value=>{const t=String(value??'').toUpperCase();return /^[T]?[123]$/.test(t)?'T'+t.replace('T',''):null;};
 function normalize(value={}){
  value=value&&typeof value==='object'?value:{};
  const seen=new Set(),rules=(Array.isArray(value.rules)?value.rules:[]).filter(r=>r&&/^\d+(m|H|D|W|M)$/.test(r.frame)&&tier(r.tier)&&!seen.has(r.frame)&&seen.add(r.frame)).slice(0,3).map(r=>({frame:r.frame,tier:tier(r.tier)}));
  return {enabled:value.enabled===true,match:value.match==='any'?'any':'all',rules};
 }
 function resolve(row,config,getTier,side){
  if(!config.enabled||!config.rules.length)return null;
  const matches=config.rules.map(rule=>{const value=getTier(row,rule.frame,side);return tier(value?.tier??value)===rule.tier?{...rule,value}:null;});
  if(config.match==='any')return matches.find(Boolean)||null;
  return matches.every(Boolean)?matches[0]:null;
 }
 function get(market){try{return normalize(JSON.parse(localStorage.getItem(key(market)))||{});}catch{return normalize();}}
 function set(market,value){const next=normalize(value);try{localStorage.setItem(key(market),JSON.stringify(next));}catch{}document.dispatchEvent(new CustomEvent('ox:timeframe-tier-change',{detail:{market,config:next}}));return next;}
 function apply(rows,market,getTier,side){
  const config=get(market);if(!config.enabled||!config.rules.length)return rows;
  return rows.filter(row=>resolve(row,config,getTier,side));
 }
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function mount(host,{market,frames,signal,controls=true,onChange=()=>{}}){
  const life=new AbortController();signal?.addEventListener('abort',()=>life.abort(),{once:true});
  const options=frames.map(f=>typeof f==='string'?{id:f,label:f}:f);
  const supported=new Set(options.map(f=>f.id));
  let config=get(market);config.rules=config.rules.filter(r=>supported.has(r.frame));
  if(!config.rules.length&&options.length)config.rules=[{frame:options.find(f=>f.id==='1H'||f.id==='1D')?.id||options[0].id,tier:'T1'}];
  function paint(){
   host.innerHTML=`${controls?'<h3>篩選模式</h3><div class="chart-filter-mode"><button type="button" data-tier-mode="classic" aria-pressed="'+!config.enabled+'">經典</button><button type="button" data-tier-mode="combined" aria-pressed="'+config.enabled+'">時間組合</button></div>':''}<div class="chart-tier-combination" ${config.enabled?'':'hidden'}><div class="chart-tier-combination-head"><span>時間級別 × T 分級</span><select data-tier-match aria-label="時間組合匹配方式"><option value="all" ${config.match==='all'?'selected':''}>全部符合</option><option value="any" ${config.match==='any'?'selected':''}>任一符合</option></select></div><div class="chart-tier-rules">${config.rules.map((r,i)=>`<div class="chart-tier-rule"><select data-tier-frame="${i}" aria-label="第 ${i+1} 個時間級別">${options.filter(f=>f.id===r.frame||!config.rules.some(x=>x.frame===f.id)).map(f=>`<option value="${esc(f.id)}" ${f.id===r.frame?'selected':''}>${esc(f.label)}</option>`).join('')}</select><select data-tier-value="${i}" aria-label="第 ${i+1} 個 T 分級">${['T1','T2','T3'].map(t=>`<option ${r.tier===t?'selected':''}>${t}</option>`).join('')}</select><button type="button" data-tier-remove="${i}" aria-label="移除第 ${i+1} 個條件" ${config.rules.length===1?'disabled':''}>−</button></div>`).join('')}</div><button type="button" data-tier-add ${config.rules.length>=Math.min(3,options.length)?'disabled':''}>＋加入級別</button><small>依各級別已收線資料判斷；尚無分級的標的不列入。</small></div>`;
  }
  function changed(){config=set(market,config);paint();onChange(config);}
  host.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
   if(b.dataset.tierMode){config.enabled=b.dataset.tierMode==='combined';changed();}
   if(b.hasAttribute('data-tier-add')){const f=options.find(f=>!config.rules.some(r=>r.frame===f.id));if(f&&config.rules.length<3){config.rules.push({frame:f.id,tier:'T1'});changed();}}
   if(b.hasAttribute('data-tier-remove')&&config.rules.length>1){config.rules.splice(Number(b.dataset.tierRemove),1);changed();}
  },{signal:life.signal});
  host.addEventListener('change',e=>{const el=e.target;if(el.hasAttribute('data-tier-match'))config.match=el.value;
   else if(el.hasAttribute('data-tier-frame'))config.rules[Number(el.dataset.tierFrame)].frame=el.value;
   else if(el.hasAttribute('data-tier-value'))config.rules[Number(el.dataset.tierValue)].tier=el.value;else return;changed();
  },{signal:life.signal});
  document.addEventListener('ox:timeframe-tier-change',e=>{if(e.detail.market===market){config=e.detail.config;paint();}},{signal:life.signal});paint();
  return {setEnabled(enabled){config.enabled=enabled;changed();},destroy(){life.abort();host.replaceChildren();}};
 }
 window.OXTierFilters={normalize,get,set,apply,resolve,mount};
})();
