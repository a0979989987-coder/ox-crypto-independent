/* Shared editorial UI. Market data and radar workspace remain owned by their modules. */
(() => {
  'use strict';
  const marketNames = {crypto:'Crypto'};
  document.body.dataset.uiMode = 'pro';
  function updateContext() {
    const view = document.querySelector('.app-view.active')?.dataset.appView || 'home';
    document.body.dataset.view = view;
    const market = document.body.dataset.market || window.state?.activeMarket || 'crypto';
    document.querySelectorAll('[data-terminal-view]').forEach(el => { el.textContent = marketNames[market] || marketNames.crypto; });
    document.querySelectorAll('.ox-desktop-nav [data-view-target]').forEach(el => {
      const active = el.dataset.viewTarget === view;
      el.classList.toggle('active',active);
      if(active) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-terminal-date]').forEach(el => {
      el.textContent = new Intl.DateTimeFormat('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).format(new Date());
    });
  }
  document.addEventListener('click',event => {
    const tier = event.target.closest('[data-home-tier]:not([data-home-symbol])');
    if (tier) {
      window.switchAppView?.('radar');
      document.querySelector(`#view-radar .tab-btn[data-tab="${tier.dataset.homeTier}"]`)?.click();
    }
  });
  let radarChartFade = null;
  document.addEventListener('click',event => {
    const toggle = event.target.closest('#radar-scanner-toggle');
    if (!toggle) return;
    const radar = document.getElementById('view-radar');
    const hidden = !radar.classList.contains('ox-scanner-collapsed');
    radar.classList.toggle('ox-scanner-collapsed', hidden);
    radarChartFade?.cancel();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      radarChartFade = radar.querySelector('#chart')?.animate(
        [{ opacity: .72 }, { opacity: 1 }],
        { duration: 620, easing: 'cubic-bezier(.22,.8,.22,1)' }
      );
    }
    const panel = document.getElementById('radar-scanner-panel');
    panel.setAttribute('aria-hidden', String(hidden));
    panel.inert = hidden;
    toggle.setAttribute('aria-expanded', String(!hidden));
    toggle.setAttribute('aria-label', hidden ? '展開右側雷達' : '收起右側雷達');
    toggle.title = toggle.getAttribute('aria-label');
    toggle.querySelector('path').setAttribute('d', hidden
      ? 'M15 5l-7 7 7 7'
      : 'M9 5l7 7-7 7');
    document.dispatchEvent(new CustomEvent('ox:radarvisibilitychange'));
    requestAnimationFrame(() => window.resizeChartToContainer?.(true));
  });
  document.querySelector('#view-radar .workspace')?.addEventListener('transitionend', event => {
    if (event.target === event.currentTarget) window.resizeChartToContainer?.(true);
  });
  document.addEventListener('keydown',event => {
    if (!['Enter',' '].includes(event.key)) return;
    const action = event.target.closest('[data-home-symbol][role="button"]');
    if (action) { event.preventDefault(); action.click(); }
  });
  document.addEventListener('ox:viewchange',updateContext);
  document.addEventListener('ox:marketchange',updateContext);
  document.addEventListener('DOMContentLoaded',updateContext);
  // Respond to scroll direction without measuring layout or intercepting gestures.
  const dock = document.querySelector('.app-dock.glass-nav');
  if (dock) {
    let lastY = Math.max(0, window.scrollY);
    let pending = false;
    let travel = 0;
    let lastToggle = 0;
    window.addEventListener('scroll', () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        const y = Math.max(0, window.scrollY);
        const delta = y - lastY;
        if (y < 35) { dock.classList.remove('ox-dock-compact'); travel = 0; }
        else if (!document.body.classList.contains('ox-mqs-open') && Math.abs(delta) < 90) {
          if (Math.sign(delta) !== Math.sign(travel)) travel = 0;
          travel += delta;
          if (Math.abs(travel) >= 26 && performance.now() - lastToggle > 260) {
            dock.classList.toggle('ox-dock-compact', travel > 0);
            lastToggle = performance.now();
            travel = 0;
          }
        }
        lastY = y;
        pending = false;
      });
    }, {passive:true});
  }
  updateContext();
})();
