import { loadToolModule } from '../../../components/load-tool-module.js?v=20261005-recovery20';
import { showToolLoadError } from '../../../components/tool-load-error.js?v=20261005-recovery20';
import { createToolsRail } from "../../../components/strength/tools-rail.js?v=20261005-stable18";
// Crypto-only inline tools. Preserve the existing strength calculations and DOM.
const section = document.querySelector('#view-strength .strength-page');
if (section) {
  const tabs = [['patterns','型態搜尋'],['bubbles','泡泡圖'],['strength','強弱對比'],['heatmap','熱力圖'],['rotation','板塊輪動'],['flow','主動買賣']];
  let selected = globalThis.OXFeatures?.selectedTool?.('crypto')||'patterns';
  const rail = createToolsRail({ tabs, selected, label:'Crypto 指標分類', attribute:'data-crypto-tool', equal:true, mobileCompact:true, onSelect(id){if(id===selected)return;unmount();selected=id;sync();} });
  const nav = rail.element; nav.id='ox-crypto-tools-nav'; nav.hidden=true;
  const ns = rail.shadow;
  section.prepend(nav);
  const boundaryStyle=document.createElement('style');
  boundaryStyle.textContent='body[data-view="strength"] .ox-live-shell{margin-bottom:14px!important}#view-strength .strength-page{padding-top:8px!important}#view-strength .strength-page[data-crypto-tool]:not([data-crypto-tool="strength"]) > :not(#ox-crypto-tools-nav):not(#ox-crypto-tools-inline){display:none!important}#view-strength .strength-page > [hidden]{display:none!important}#view-strength .strength-page[data-crypto-tool="strength"] .strength-compare-top .page-kicker,#view-strength .strength-page[data-crypto-tool="strength"] .strength-compare-top h2,#view-strength .strength-page[data-crypto-tool="strength"] .strength-compare-top p,#view-strength .strength-page[data-crypto-tool="strength"] .strength-compare-side span,#view-strength .strength-page[data-crypto-tool="strength"] .strength-head p,#view-strength .strength-page[data-crypto-tool="strength"] .strength-explain{display:none!important}#view-strength .strength-page[data-crypto-tool="strength"] .strength-compare-top{justify-content:flex-end;margin-bottom:8px}';
  section.append(boundaryStyle);
  boundaryStyle.textContent+='#view-strength .strength-page[data-crypto-tool]{row-gap:4px!important}#view-strength #ox-crypto-tools-inline{margin-top:0!important}';
  const positionIndicator = rail.position;
  const slot = document.createElement('section');
  slot.id = 'ox-crypto-tools-inline';
  slot.setAttribute('aria-label', '加密市場工具');
  slot.style.cssText = 'grid-column:1/-1;min-width:0;margin:8px 0 18px;';
  slot.hidden = true;
  const anchor = section.querySelector('.strength-compare-panel');
  if (anchor) anchor.after(slot); else section.prepend(slot);
  let host = document.createElement('div');const loading = document.createElement('div');loading.className='ox-tool-loading';loading.hidden=true;slot.append(host,loading);
  const retained=new Map(),savedStates=new Map(),scrolls=new Map();
  let mountedTool=null;
  let instance = null, pending = false, generation = 0, observer = null, scrollObserver=null, dialog = null;
  let previousOverflow = '';
  const active = () => (document.body.dataset.market || 'crypto') === 'crypto' && document.body.dataset.view === 'strength';
  function exitFocus() {
    if (!dialog) return;
    slot.append(host); dialog.close(); dialog.remove(); dialog = null;
    document.body.style.overflow = previousOverflow;
  }
  function syncFocus() {
    const focused = host.shadowRoot?.querySelector('.cfx')?.classList.contains('focused');
    if (!focused) { exitFocus(); return; }
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Crypto 全螢幕圖表');
    dialog.style.cssText = 'inset:0;width:100vw;max-width:none;height:100dvh;max-height:none;margin:0;padding:0;border:0;background:var(--ox-light-bg,#0d1215);';
    dialog.append(host); document.body.append(dialog);
    previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    dialog.addEventListener('cancel', e => { e.preventDefault(); instance?.closeInner(); });
    dialog.showModal();
  }
  function evict(id,clearPrivate=false){const entry=retained.get(id);if(!entry)return;savedStates.set(id,entry.instance.getState?.());entry.instance.destroy();if(clearPrivate)entry.instance.clearPrivateState?.();entry.host.remove();retained.delete(id);}
  function trim(){const cap=matchMedia('(max-width:700px)').matches?2:3;for(const [id,entry] of retained){if(id!==mountedTool&&(retained.size>cap||Date.now()-entry.at>120000))evict(id);}}
  function unmount() {
    generation++; pending=false;observer?.disconnect();observer=null;scrollObserver?.disconnect();scrollObserver=null;exitFocus();
    if(instance&&mountedTool){if(active())scrolls.set(mountedTool,window.scrollY);instance.suspend?.();retained.set(mountedTool,{host,instance,at:Date.now()});host.hidden=true;host.style.display='none';}
    instance=null;mountedTool=null;loading.hidden=true;slot.hidden=true;trim();
  }
  setInterval(trim,30000);
  document.addEventListener('scroll',()=>{if(mountedTool&&instance&&active())scrolls.set(mountedTool,window.scrollY);},{passive:true});
  function restoreScroll(id){const token=generation,root=host.shadowRoot?.querySelector('main,.oxb-shell');const restore=()=>{if(token===generation&&mountedTool===id&&active())window.scrollTo(0,scrolls.get(id)||0);};requestAnimationFrame(restore);if(root?.hasAttribute('aria-busy')){scrollObserver=new MutationObserver(()=>{if(!root.hasAttribute('aria-busy')){scrollObserver?.disconnect();scrollObserver=null;requestAnimationFrame(restore);}});scrollObserver.observe(root,{attributes:true,attributeFilter:['aria-busy']});}}

  async function sync() {
    nav.hidden = !active();
    if (!active()) { delete section.dataset.cryptoTool; unmount(); return; }
    if(window.OXFeatures&&!window.OXFeatures.enterTool(selected,'data-crypto-tool',sync)){unmount();return;}
    if(section.dataset.cryptoTool!==selected)document.dispatchEvent(new CustomEvent('ox:crypto-toolchange',{detail:{tool:selected}}));
    section.dataset.cryptoTool=selected; positionIndicator();requestAnimationFrame(positionIndicator);
    if(selected==='strength'){unmount();return;}
    slot.hidden = false;
    if (instance || pending) return;
    const retainedEntry=retained.get(selected);
    if(retainedEntry){host=retainedEntry.host;instance=retainedEntry.instance;mountedTool=selected;host.hidden=false;host.style.removeProperty('display');retainedEntry.at=Date.now();instance.resume?.();const focusedRoot=host.shadowRoot?.querySelector('.cfx');if(focusedRoot){observer=new MutationObserver(syncFocus);observer.observe(focusedRoot,{attributes:true,attributeFilter:['class']});}restoreScroll(selected);return;}
    host=document.createElement('div');slot.insertBefore(host,loading);const mountHost=host,id=selected;
    const restore=savedStates.get(id);

    pending = true;loading.hidden=false;loading.innerHTML=window.OXLoading?.markup('工具載入中')||'工具載入中…';const token = ++generation;
    try {
      if(selected==='bubbles'){
        const { mountCryptoBubbles } = await loadToolModule(new URL('../bubbles/view.js?v=20261005-stable18',import.meta.url).href,{current:()=>token===generation&&active()});
        if(token!==generation||!active())return;
        instance=mountCryptoBubbles(mountHost,{restore});
        return;
      }
      if(selected==='patterns'){
        const { mountPatternSearch } = await loadToolModule(new URL('../patterns/view.js?v=20261005-stable18',import.meta.url).href,{current:()=>token===generation&&active()});
        if(token!==generation||!active())return;
        instance=mountPatternSearch(mountHost,{restore});
        return;
      }
      const { mountCryptoFlow } = await loadToolModule(new URL('./flow-view.js?v=20261005-stable18',import.meta.url).href,{current:()=>token===generation&&active()});
      if (token !== generation || !active()) return;
      instance = mountCryptoFlow(mountHost, { initialTab:id,restore, autoRefresh:true, onExit() { ns.querySelector('[data-crypto-tool="strength"]').click(); } });
      const style = document.createElement('style');
      style.textContent = ':host{display:block}.cfx{min-height:0;border:1px solid #344248;border-radius:14px;overflow:hidden}.cfx-top{display:none}.cfx.focused .cfx-top{display:flex;height:38px;padding:0 12px}.cfx-back,.cfx-brand,.cfx-source-badge,.cfx-tabs{display:none}.cfx-tabs{padding:0 12px;gap:18px}.cfx-content{padding:12px 10px}.cfx.focused{border:0;border-radius:0}.cfx.focused .cfx-brand{display:flex}';
      host.shadowRoot.append(style);
      observer = new MutationObserver(syncFocus);
      observer.observe(host.shadowRoot.querySelector('.cfx'), {attributes:true,attributeFilter:['class']});
    } catch (error) {
      console.warn('[OX Crypto tool]',error);
      if (token === generation) showToolLoadError(loading,error,()=>{unmount();sync();});
    } finally { if(token!==generation)mountHost.remove();if (token === generation) { pending = false;if(instance){mountedTool=id;retained.set(id,{host:mountHost,instance,at:Date.now()});loading.hidden=true;trim();restoreScroll(id);}else if(token!==generation)mountHost.remove(); } }
  }
  let accountId=window.OXAuth?.user?.id||null;
  document.addEventListener('ox:accountchange',()=>{const next=window.OXAuth?.user?.id||null;if(next===accountId)return;accountId=next;unmount();for(const id of [...retained.keys()])evict(id,true);savedStates.clear();scrolls.clear();sync();});
  document.addEventListener('ox:feature-policy-ready',sync);
  document.addEventListener('ox:marketchange', sync);
  document.addEventListener('ox:viewchange', sync);
  sync();
}
