(() => {
  'use strict';
  const root = document.documentElement;
  let raf = 0;
  function sync(){
    raf = 0;
    if (!document.body.classList.contains('chart-focus')) return;
    const vv = window.visualViewport;
    const w = Math.max(1, Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth));
    const h = Math.max(1, Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight));
    root.style.setProperty('--ox-focus-vw', `${w}px`);
    root.style.setProperty('--ox-focus-vh', `${h}px`);
    requestAnimationFrame(() => {
      try { resizeChartToContainer?.(true); } catch (_) {}
    });
  }
  function schedule(){ if(raf) return; raf=requestAnimationFrame(sync); }
  new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize', schedule, {passive:true});
  window.addEventListener('orientationchange', () => { schedule(); setTimeout(schedule,120); setTimeout(schedule,320); }, {passive:true});
  window.visualViewport?.addEventListener('resize', schedule, {passive:true});
  document.addEventListener('click', e => {
    if (e.target.closest('#btn-chart-exit-overlay')) {
      e.preventDefault();
      document.getElementById('btn-chart-fullscreen')?.click();
      return;
    }
    if (e.target.closest('#btn-chart-fullscreen')) {
      requestAnimationFrame(schedule);
      setTimeout(schedule,80);
    }
  }, {passive:false});
})();
