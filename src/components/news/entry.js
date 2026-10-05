(() => {
  'use strict';
  function bind() {
    const entries = document.querySelectorAll('.app-dock [data-view-target="data"], .ox-desktop-nav [data-view-target="data"]');
    for (const entry of entries) {
      if (entry.dataset.oxNewsEntry) continue;
      entry.dataset.oxNewsEntry = '1';
      entry.setAttribute('aria-label', '資訊');
      entry.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.OXNews.openMarket();
      }, true);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true }); else bind();
})();
