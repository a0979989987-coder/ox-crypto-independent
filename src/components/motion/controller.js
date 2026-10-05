(() => {
  'use strict';
  const root = document.documentElement;
  const reducedMq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const finePointerMq = window.matchMedia?.('(hover:hover) and (pointer:fine)');
  // Scroll-linked glass repaints are especially costly on mobile Safari.
  const reduced = () => !!reducedMq?.matches || !!window.matchMedia?.('(pointer:coarse)')?.matches;
  const isFinePointer = () => !!finePointerMq?.matches;
  const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
  const esc = value => window.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g,'\$&');

  /* ---- one global GlassLightController: scroll / pointer / resize ---- */
  let targetScroll = window.scrollY || 0;
  let smoothScroll = targetScroll;
  let targetPointerX = 20;
  let smoothPointerX = 20;
  let raf = 0;

  function motionFrame() {
    raf = 0;
    smoothScroll += (targetScroll - smoothScroll) * .085;
    smoothPointerX += (targetPointerX - smoothPointerX) * .10;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const progress = clamp(smoothScroll / maxScroll, 0, 1);
    const lightY = 11 + progress * 76;
    const mobile = matchMedia('(max-width:720px)').matches;
    const parallax = mobile ? 0 : clamp(smoothScroll * .012, 0, 9);

    root.style.setProperty('--global-light-x', `${smoothPointerX.toFixed(2)}%`);
    root.style.setProperty('--global-light-y', `${lightY.toFixed(2)}%`);
    root.style.setProperty('--global-scroll-progress', progress.toFixed(4));
    root.style.setProperty('--global-glass-shift', `${(progress * 10 - 5).toFixed(2)}px`);
    root.style.setProperty('--ox-bg-shift', `${parallax.toFixed(2)}px`);
    root.style.setProperty('--ox-bg-shift-neg', `${(-parallax).toFixed(2)}px`);

    if (Math.abs(targetScroll - smoothScroll) > .25 || Math.abs(targetPointerX - smoothPointerX) > .15) scheduleFrame();
  }
  function scheduleFrame(){ if (!raf && !reduced()) raf = requestAnimationFrame(motionFrame); }
  // Keep the large background and glass surfaces static while scrolling.
  // Repainting them on every scroll frame delayed gestures on every view.
  window.addEventListener('resize', () => { targetScroll = window.scrollY || 0; scheduleFrame(); syncDockIndicator(); }, {passive:true});
  if (isFinePointer()) window.addEventListener('pointermove', e => { targetPointerX = 12 + (e.clientX / Math.max(1,innerWidth)) * 76; scheduleFrame(); }, {passive:true});

  /* ---- decorate only important glass surfaces, never every small card ---- */
  const glassTargets = [
    ['.v33-home-hero',1.0,-7],
    ['.v34-home-btc-primary',1.0,2],
    ['#strength-liquidations .ox-liquidation-card',.78,7],
    ['.strength-compare-panel',.72,-2],
    ['.ox-control-panel',.86,5],
    ['.app-dock',.58,9],
    ['#view-home .v33-split > .v33-card',.62,4]
  ];
  function decorateGlassTargets(){
    glassTargets.forEach(([selector,depth,offset]) => {
      document.querySelectorAll(selector).forEach((el,idx) => {
        if (el.classList.contains('ox-glass-dynamic')) return;
        el.classList.add('ox-glass-dynamic');
        el.dataset.glassDepth = String(depth);
        el.style.setProperty('--glass-depth-offset', `${offset + (idx%3-1)*2}%`);
        if (!el.querySelector(':scope > .ox-motion-shine')) {
          const shine = document.createElement('span');
          shine.className = 'ox-motion-shine';
          shine.setAttribute('aria-hidden','true');
          el.appendChild(shine);
        }
        if (isFinePointer() && !reduced() && !root.classList.contains('ox-motion-lite') && !el.matches('.app-dock')) {
          el.addEventListener('pointermove', ev => {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const x = clamp((ev.clientX-r.left)/r.width*100,0,100);
            const y = clamp((ev.clientY-r.top)/r.height*100,0,100);
            el.style.setProperty('--glass-pointer-x', `${x.toFixed(1)}%`);
            el.style.setProperty('--glass-pointer-y', `${y.toFixed(1)}%`);
          }, {passive:true});
          el.addEventListener('pointerleave', () => {
            el.style.removeProperty('--glass-pointer-x');
            el.style.removeProperty('--glass-pointer-y');
          }, {passive:true});
        }
      });
    });
  }

  /* ---- bottom navigation shared active bubble ---- */
  let dockIndicator;
  function ensureDockIndicator(){
    const dock = document.querySelector('.app-dock');
    if (!dock) return null;
    dockIndicator = dock.querySelector('.ox-dock-indicator');
    if (!dockIndicator) {
      dockIndicator = document.createElement('span');
      dockIndicator.className = 'ox-dock-indicator';
      dockIndicator.setAttribute('aria-hidden','true');
      dock.prepend(dockIndicator);
    }
    return dockIndicator;
  }
  function syncDockIndicator(){
    const dock = document.querySelector('.app-dock');
    const indicator = ensureDockIndicator();
    const active = dock?.querySelector('.dock-btn.active');
    if (!dock || !indicator || !active) return;
    const dr = dock.getBoundingClientRect(), br = active.getBoundingClientRect();
    const scale = dr.width / Math.max(1, dock.offsetWidth);
    const buttonWidth = br.width / scale;
    const width = Math.max(38, Math.min(buttonWidth * .94, 86));
    const x = (br.left - dr.left) / scale + (buttonWidth - width)/2;
    indicator.style.width = `${width.toFixed(1)}px`;
    indicator.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
    indicator.style.opacity='1';
  }

  /* ---- star pop after the existing renderCurrentTab replaces DOM ---- */
  let pendingStarSymbol='';
  document.addEventListener('click', e => {
    const star=e.target.closest?.('[data-watch-symbol]');
    if (star?.dataset.watchSymbol) {
      pendingStarSymbol=star.dataset.watchSymbol;
      setTimeout(() => {
        document.querySelectorAll(`[data-watch-symbol="${esc(pendingStarSymbol)}"]`).forEach(btn => {
          btn.classList.remove('ox-star-pop');
          void btn.offsetWidth;
          btn.classList.add('ox-star-pop');
          setTimeout(()=>btn.classList.remove('ox-star-pop'),290);
        });
        pendingStarSymbol='';
      },0);
    }
  }, true);

  /* ---- first-time page card stagger ---- */
  const seenViews=new Set();
  function revealView(view){
    if (reduced() || seenViews.has(view)) return;
    seenViews.add(view);
    const rootView=document.querySelector(`[data-app-view="${view}"]`);
    if (!rootView) return;
    const cards=[...rootView.querySelectorAll(':scope > *, .v33-card, .strength-card, .panel, .media-card, .settings-card')]
      .filter((el,i,a)=>a.indexOf(el)===i && el.offsetParent!==null)
      .slice(0,10);
    cards.forEach((el,i)=>{
      el.style.setProperty('--ox-stagger',`${Math.min(i*26,180)}ms`);
      el.classList.add('ox-motion-card-in');
      setTimeout(()=>el.classList.remove('ox-motion-card-in'),520+i*26);
    });
  }

  /* ---- subtle numeric updates, no whole-card flash ---- */
  const numberIds=['price','ox-score','home-btc-price','home-market-score','home-t1-count','home-t2-count','home-surge-count','strength-btc-value','strength-alt-value','strength-compare-btc','strength-compare-alt'];
  function initNumberObservers(){
    numberIds.forEach(id=>{
      const el=document.getElementById(id); if(!el) return;
      let last=el.textContent;
      new MutationObserver(()=>{
        const next=el.textContent; if(next===last) return; last=next;
        if(reduced()) return;
        el.classList.remove('ox-number-refresh'); void el.offsetWidth; el.classList.add('ox-number-refresh');
        setTimeout(()=>el.classList.remove('ox-number-refresh'),250);
      }).observe(el,{childList:true,characterData:true,subtree:true});
    });
  }

  /* ---- liquidation rows: animate only changed/new rows ---- */
  function initLiquidationObserver(){
    ['liquidation-table-body','liquidation-mobile'].forEach(id=>{
      const el=document.getElementById(id); if(!el) return;
      new MutationObserver(()=>{
        if(reduced()) return;
        [...el.children].slice(0,12).forEach((row,i)=>{
          row.classList.add('ox-liq-row-enter');
          row.style.animationDelay=`${Math.min(i*18,120)}ms`;
          setTimeout(()=>row.classList.remove('ox-liq-row-enter'),380+i*18);
        });
      }).observe(el,{childList:true});
    });
  }

  /* ---- control drawer open: one glass highlight impulse ---- */
  function initControlObserver(){
    const overlay=document.getElementById('ox-control-overlay');
    const panel=document.getElementById('ox-control-panel');
    if(!overlay||!panel) return;
    new MutationObserver(()=>{
      if(overlay.classList.contains('is-open')&&!reduced()){
        panel.animate([
          {filter:'brightness(.985)'},{filter:'brightness(1.025)',offset:.56},{filter:'brightness(1)'}
        ],{duration:430,easing:'cubic-bezier(.22,1,.36,1)'});
      }
    }).observe(overlay,{attributes:true,attributeFilter:['class']});
  }

  /* ---- low-performance probe: automatically quiet secondary effects ---- */
  function probePerformance(){
    if (reduced()) return;
    if ((navigator.hardwareConcurrency && navigator.hardwareConcurrency<=4) || (navigator.deviceMemory && navigator.deviceMemory<=4)) root.classList.add('ox-motion-lite');
    let frames=0,total=0,last=performance.now();
    const sample=t=>{
      const d=t-last; last=t;
      if(d<80){total+=d;frames++;}
      if(frames<50) requestAnimationFrame(sample);
      else if(total/Math.max(1,frames)>22) root.classList.add('ox-motion-lite');
    };
    requestAnimationFrame(sample);
  }

  function init(){
    decorateGlassTargets();
    ensureDockIndicator();
    syncDockIndicator();
    initNumberObservers();
    initLiquidationObserver();
    initControlObserver();
    probePerformance();
    // Avoid animating ten cards while the first Radar chart and feed initialize.
    seenViews.add('radar');
    targetScroll=window.scrollY||0; smoothScroll=targetScroll; scheduleFrame();
  }

  document.addEventListener('ox:viewchange', e => {
    requestAnimationFrame(()=>{ syncDockIndicator(); revealView(e.detail?.to || ''); decorateGlassTargets(); });
  });
  document.addEventListener('click', e => {
    if(e.target.closest?.('.dock-btn')) requestAnimationFrame(syncDockIndicator);
  });

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
