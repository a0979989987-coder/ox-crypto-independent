(()=>{
  'use strict';
  const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const hero=()=>document.querySelector('#view-home .btc-premium-hero');

  // Desktop: subtle shine + emblem parallax only. No large 3D tilt.
  function bindDesktopHero(){
    const el=hero(); if(!el||!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    el.addEventListener('pointermove',e=>{
      if(reduced()) return;
      const r=el.getBoundingClientRect();
      const x=clamp((e.clientX-r.left)/Math.max(1,r.width),0,1);
      const y=clamp((e.clientY-r.top)/Math.max(1,r.height),0,1);
      el.style.setProperty('--glass-pointer-x',`${(x*100).toFixed(1)}%`);
      el.style.setProperty('--glass-pointer-y',`${(y*100).toFixed(1)}%`);
      el.style.setProperty('--btc-parallax-x',`${((x-.5)*4).toFixed(2)}px`);
      el.style.setProperty('--btc-parallax-y',`${((y-.5)*3).toFixed(2)}px`);
    },{passive:true});
    el.addEventListener('pointerleave',()=>{
      el.style.removeProperty('--glass-pointer-x'); el.style.removeProperty('--glass-pointer-y');
      el.style.setProperty('--btc-parallax-x','0px'); el.style.setProperty('--btc-parallax-y','0px');
    },{passive:true});
  }

  // Mobile: touch position briefly becomes the local liquid-glass light source.
  const mobileTargets=()=>document.querySelectorAll('#view-home .btc-premium-hero,#view-home .v33-home-hero,.app-dock,.ox-control-panel');
  function bindMobileGlass(){
    if(!window.matchMedia('(max-width:720px)').matches) return;
    // Touch-linked geometry reads on the fixed dock stall native scrolling.
    if(window.matchMedia('(pointer:coarse)').matches) return;
    mobileTargets().forEach(el=>{
      if(el.dataset.mobileGlassBound==='1') return; el.dataset.mobileGlassBound='1';
      const update=t=>{
        if(reduced()) return;
        const r=el.getBoundingClientRect();
        const x=clamp((t.clientX-r.left)/Math.max(1,r.width)*100,0,100);
        const y=clamp((t.clientY-r.top)/Math.max(1,r.height)*100,0,100);
        el.style.setProperty('--glass-pointer-x',`${x.toFixed(1)}%`);
        el.style.setProperty('--glass-pointer-y',`${y.toFixed(1)}%`);
        el.classList.add('ox-touch-lit');
      };
      el.addEventListener('touchstart',e=>{const t=e.touches?.[0];if(t)update(t);},{passive:true});
      el.addEventListener('touchmove',e=>{const t=e.touches?.[0];if(t)update(t);},{passive:true});
      const clear=()=>setTimeout(()=>{el.classList.remove('ox-touch-lit');el.style.removeProperty('--glass-pointer-x');el.style.removeProperty('--glass-pointer-y');},220);
      el.addEventListener('touchend',clear,{passive:true}); el.addEventListener('touchcancel',clear,{passive:true});
    });
  }

  // Mobile page changes get a short native-app-like entrance; no desktop-only bias.
  document.addEventListener('ox:viewchange',e=>{
    if(!window.matchMedia('(max-width:720px)').matches||reduced()) return;
    const view=e.detail?.view || window.state?.activeView;
    const el=document.querySelector(`[data-app-view="${view}"]`); if(!el) return;
    // Avoid forced layout and page-wide transform during the first touch scroll.
    requestAnimationFrame(bindMobileGlass);
  });

  const init=()=>{bindDesktopHero();bindMobileGlass();};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
  window.addEventListener('resize',()=>requestAnimationFrame(bindMobileGlass),{passive:true});
})();
