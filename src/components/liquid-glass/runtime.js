(() => {
  "use strict";
  let radarRaf = 0;

  function decorateRadarDirection() {
    radarRaf = 0;
    document.querySelectorAll('#view-radar .coin-card').forEach(card => {
      card.classList.toggle('ox-side-long', !!card.querySelector('.badge-long'));
      card.classList.toggle('ox-side-short', !!card.querySelector('.badge-short'));
    });
  }

  function scheduleRadar() {
    if (radarRaf) return;
    radarRaf = requestAnimationFrame(decorateRadarDirection);
  }

  function boot() {
    scheduleRadar();

    document.addEventListener('click', e => {
      if (e.target.closest('.tab-btn,.coin-card')) requestAnimationFrame(scheduleRadar);
    }, { passive: true });
    document.addEventListener('ox:themechange', scheduleRadar);

    const radar = document.getElementById('screener-list') || document.getElementById('view-radar');
    if (radar) {
      const mo = new MutationObserver(scheduleRadar);
      // Class updates here must not schedule another render frame.
      mo.observe(radar, { subtree:true, childList:true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
