(() => {
  'use strict';
  let raf = 0;
  let pendingDirection = '';
  function sync(direction = ''){
    raf = 0;
    const radar = document.getElementById('view-radar');
    if (!radar) return;
    const toggle = document.getElementById('direction-toggle');
    const resolved = direction || pendingDirection;
    pendingDirection = '';
    const isShort = resolved
      ? resolved === 'short'
      : toggle?.classList.contains('is-short') || String(toggle?.getAttribute('title')||'').includes('空頭');
    radar.classList.toggle('ox-filter-short', !!isShort);
  }
  function schedule(direction = ''){ if(direction) pendingDirection = direction; if(raf) return; raf=requestAnimationFrame(() => sync(pendingDirection)); }
  document.addEventListener('click', e=>{ if(e.target.closest('#direction-toggle,.tab-btn')) requestAnimationFrame(() => schedule()); }, {passive:true});
  document.addEventListener('ox:filterchange', e => schedule(e.detail?.direction || ''));
  document.addEventListener('ox:viewchange', () => schedule());
  document.addEventListener('ox:themechange', () => schedule());
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', schedule, {once:true}); else schedule();
})();
