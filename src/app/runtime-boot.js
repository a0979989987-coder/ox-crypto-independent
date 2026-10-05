const keyLevelVisibilityToggle = document.getElementById("chk-key-levels");
syncKeyLevelVisibilityUI();
keyLevelVisibilityToggle?.addEventListener("change", e => setKeyLevelsVisible(e.target.checked));

window.addEventListener("DOMContentLoaded", () => {
  // Start at the market cover; a saved light-theme choice remains available.
  const unlockAudioFromGesture = async () => {
    const ok = await primeAlertAudio(true);
    if (ok) {
      document.removeEventListener("click", unlockAudioFromGesture, true);
    }
  };
  // Initial touch gestures are usually scrolls; do not start audio work on them.
  document.addEventListener("click", unlockAudioFromGesture, true);
  window.addEventListener("focus", syncNotificationPermissionUI);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNotificationPermissionUI(); });
  updateChartExpandButton();
  document.addEventListener("fullscreenchange", updateChartExpandButton);
  initSettings();
  OXControlPanel.init();
  OXFeaturePack.init();
  syncScannerFilterUI();
  const oxMarkerToggle = document.getElementById("chk-ox-markers");
  if (oxMarkerToggle) oxMarkerToggle.checked = false;
  setKeyLevelsVisible(false, { persist: true });
  initChart();
  applyTheme(getSavedThemeMode());
  if(!window.OXFeatures?.returning&&state.activeView==="radar")switchAppView("radar");
  if (state.activeMarket === "crypto") {
    loadSymbolCandles(true);
    refreshMarketTickers();
  }
  renderBenchmarkBar();
  // Offscreen summaries are calculated when their view opens, so startup can paint sooner.
  renderOxLive();
  updateAlertButtons();
  setInterval(refreshMarketTickers, CONFIG.tickerRefreshMs);
  setInterval(renderOxLive, CONFIG.tickerRefreshMs);
  setInterval(updatePriceTimer, 1000);
  setInterval(checkLevelAlerts, 5000);
});

window.addEventListener("resize", () => {
  if (state.activeView === "radar" || document.body.classList.contains("chart-focus")) {
    setTimeout(resizeChartToContainer, 60);
  }
});

// Safari changes visualViewport height while hiding its toolbar on every
// vertical swipe. The chart's ResizeObserver handles actual container changes.

window.addEventListener("orientationchange", () => {
  [80, 220, 420].forEach(ms => setTimeout(resizeChartToContainer, ms));
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.body.classList.contains("chart-focus")) setChartFocus(false);
});
