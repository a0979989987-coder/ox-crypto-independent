document.addEventListener("click", e => {
  const star = e.target.closest("[data-watch-symbol]");
  if (star?.dataset.watchSymbol) { e.preventDefault(); e.stopPropagation(); toggleWatchSymbol(star.dataset.watchSymbol); return; }

  const homeSymbol = e.target.closest("[data-home-symbol]");
  if (homeSymbol?.dataset.homeSymbol) {
    if (homeSymbol.dataset.homeSide) {
      setScannerDirectionFilter(homeSymbol.dataset.homeSide);
      setScannerTierFilter(homeSymbol.dataset.homeTier || 'all');
    }
    switchSymbol(homeSymbol.dataset.homeSymbol);
    return;
  }

  const viewBtn = e.target.closest("[data-view-target]");
  if (viewBtn) { switchAppView(viewBtn.dataset.viewTarget); return; }

  const bench = e.target.closest("[data-benchmark-symbol]");
  if (bench) { switchSymbol(bench.dataset.benchmarkSymbol); return; }
  if (e.target.id === "btn-alert-high") { toggleLevelAlert("high"); return; }
  if (e.target.id === "btn-alert-low") { toggleLevelAlert("low"); return; }

  const card = e.target.closest(".coin-card") || e.target.closest(".trad-row");
  if (card && card.dataset.symbol) {
    switchSymbol(card.dataset.symbol);
    return;
  }

  const tabBtn = e.target.closest(".tab-btn");
  if (tabBtn && tabBtn.dataset.tab) {
    setScannerTierFilter(tabBtn.dataset.tab);
    return;
  }

  const directionToggle = e.target.closest("#direction-toggle");
  if (directionToggle) {
    e.preventDefault();
    e.stopPropagation();
    toggleScannerDirection();
    return;
  }

  const tfBtn = e.target.closest(".btn-tf");
  if (tfBtn && tfBtn.dataset.tf) {
    state.period = tfBtn.dataset.tf;
    document.querySelectorAll(".btn-tf").forEach(b => b.classList.toggle("active", b === tfBtn));
    state.currentLevels = { high: 0, low: 0, sourcePeriod: getKeyLevelPeriod(), highTime: 0, lowTime: 0 };
    state.secondaryLevels = null;
    updateAlertButtons();
    loadSymbolCandles(true);
    return;
  }

  if (e.target.closest("#btn-chart-fullscreen")) {
    if (document.body.classList.contains("chart-focus")) {
      setChartFocus(false);
    } else if (window.matchMedia("(max-width: 900px)").matches) {
      setChartFocus(!document.body.classList.contains("chart-focus"));
    } else {
      const box = document.querySelector(".chart-box");
      if (document.fullscreenElement) document.exitFullscreen?.();
      else {
        try {
          const request = box.requestFullscreen?.();
          if (request?.catch) request.catch(() => setChartFocus(true));
          else if (!request) setChartFocus(true);
        } catch (_) { setChartFocus(true); }
      }
    }
    return;
  }

  if (e.target.id === "btn-force-rescan") {
    state.scanIndex = 0;
    refreshMarketTickers();
    return;
  }
});

document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target?.dataset?.homeSymbol) {
    e.preventDefault();
    if (e.target.dataset.homeSide) {
      setScannerDirectionFilter(e.target.dataset.homeSide);
      setScannerTierFilter(e.target.dataset.homeTier || 'all');
    }
    switchSymbol(e.target.dataset.homeSymbol); return;
  }
  if ((e.key === "Enter" || e.key === " ") && e.target?.classList?.contains("coin-card") && e.target.dataset.symbol) {
    e.preventDefault(); switchSymbol(e.target.dataset.symbol);
  }
});

document.getElementById("chk-vol").addEventListener("change", e => state.volumeSeries.applyOptions({ visible: e.target.checked }));
document.getElementById("chk-ox-markers").addEventListener("change", () => renderChartData(state.candleData, false));
