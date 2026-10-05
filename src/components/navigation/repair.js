(() => {
  "use strict";
  const bind = () => {
    const dock = document.querySelector(".app-dock");
    if (!dock || typeof switchAppView !== "function") return;

    const ordered = ["home","strength","radar","data","media"];
    ordered.forEach((view, index) => {
      const btn = dock.querySelector(`.dock-btn[data-view-target="${view}"]`);
      if (!btn) return;
      btn.style.gridColumn = String(index + 1);
      btn.style.gridRow = "1";
      if (view === "radar" || view === "data" || btn.dataset.oxNavBound === "1") return;
      btn.dataset.oxNavBound = "1";
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        switchAppView(view);
      }, true);
    });

    const chart = document.querySelector(".btc-premium-chart-wrap");
    if (chart && chart.dataset.oxHeroBound !== "1") {
      chart.dataset.oxHeroBound = "1";
      chart.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          switchSymbol("BTCUSDT");
        }
      });
    }

    requestAnimationFrame(() => {
      try { window.OXMotionController?.syncDockIndicator?.(); } catch {}
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, {once:true});
  else bind();
})();
