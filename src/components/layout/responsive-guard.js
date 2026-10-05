/*
  Runtime guard:
  - does NOT resize/reconfigure Lightweight Charts
  - only reports accidental page-width regressions in console
  - never changes candle visible range / bar spacing / rightOffset
*/
(() => {
  'use strict';

  const auditOverflow = () => {
    if (!window.matchMedia('(max-width: 720px)').matches) return;

    const viewport = document.documentElement.clientWidth;
    const offenders = [];

    document.querySelectorAll('body *').forEach(el => {
      if (el.closest('body.chart-focus')) return;
      const style = getComputedStyle(el);
      if (style.position === 'fixed' && el.classList.contains('toast')) return;

      const r = el.getBoundingClientRect();
      if (r.width > viewport + 2 || r.right > viewport + 2 || r.left < -2) {
        offenders.push({
          element: el,
          className: el.className || '',
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          viewport
        });
      }
    });

    if (offenders.length) {
      console.warn('[OX Responsive Audit] Elements outside mobile viewport:', offenders.slice(0, 20));
    }
  };

  // Diagnostic only. Safari resizes the visual viewport while its toolbar
  // retracts on a swipe; a full computed-style and geometry walk at that
  // point blocks the next gesture even when no layout change is needed.
  window.OXAuditMobileOverflow = auditOverflow;
})();
