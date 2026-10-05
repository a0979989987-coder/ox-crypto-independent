(() => {
  "use strict";
  const UP = "ox-market-up";
  const DOWN = "ox-market-down";
  let raf = 0;

  const numberFrom = value => {
    const m = String(value ?? "").replace(/,/g, "").match(/[-+]?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  };

  function setTone(el, value, threshold = 2.5) {
    if (!el) return;
    const next = Number.isFinite(value) && value >= threshold ? UP
      : Number.isFinite(value) && value <= -threshold ? DOWN
      : "";
    const hasUp = el.classList.contains(UP);
    const hasDown = el.classList.contains(DOWN);
    if ((next === UP && hasUp && !hasDown) || (next === DOWN && hasDown && !hasUp) || (!next && !hasUp && !hasDown)) return;
    el.classList.remove(UP, DOWN);
    if (next) el.classList.add(next);
  }

  function scoreTone(card, scoreEl) {
    if (!card || !scoreEl) return;
    const score = numberFrom(scoreEl.textContent);
    if (!Number.isFinite(score)) return setTone(card, NaN);
    // Strength cards use 0–100, so translate only genuinely strong/weak states.
    setTone(card, score >= 70 ? 3 : score <= 30 ? -3 : 0, 2.5);
  }

  function refresh() {
    raf = 0;
    if (document.body.dataset.market !== 'crypto') return;

    // BTC main card: strong 24H move gets the edge glass state.
    setTone(
      document.querySelector("#view-home .ox-home-chart"),
      numberFrom(document.getElementById("home-btc-change")?.textContent),
      0.001
    );

    // ETH market card.
    const ethChange = document.getElementById("home-eth-change");
    setTone(ethChange?.closest(".v34-home-side-card,.v33-market-card"), numberFrom(ethChange?.textContent), 2);

    // Existing market-state score cards (0–100), without changing how the score itself is calculated.
    scoreTone(document.getElementById("home-btc-strength")?.closest(".v34-home-side-card,.v33-market-card"), document.getElementById("home-btc-strength"));
    scoreTone(document.getElementById("home-alt-strength")?.closest(".v34-home-side-card,.v33-market-card"), document.getElementById("home-alt-strength"));
    scoreTone(document.getElementById("home-side-market-score")?.closest(".v34-home-side-card,.v33-market-card"), document.getElementById("home-side-market-score"));

    // Radar coin cards: only strong moves get red/green glass; mild moves remain normal OX glass.
    document.querySelectorAll("#view-radar .coin-card").forEach(card => {
      const change = card.querySelector(".coin-change");
      setTone(card, numberFrom(change?.textContent), 3);
    });

    // Radar / summary market cards when they expose a signed percentage.
    document.querySelector("#view-radar .market-line-card")?.classList.remove(UP, DOWN);
    document.querySelectorAll("#view-radar .metric-card:not(.market-line-card), #view-radar .benchmark-card").forEach(card => {
      const change = card.querySelector(".positive,.negative");
      if (change) setTone(card, numberFrom(change.textContent), 2);
      else setTone(card, NaN);
    });
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(refresh);
  }

  const boot = () => {
    schedule();
    // Text / list replacements are what the existing app uses for live data refreshes.
    const observer = new MutationObserver(schedule);
    ['view-home', 'view-radar'].forEach(id => {
      const root = document.getElementById(id);
      if (root) observer.observe(root, { subtree: true, childList: true, characterData: true });
    });
    document.addEventListener("ox:viewchange", schedule);
    document.addEventListener("ox:marketchange", schedule);
    document.addEventListener("ox:themechange", schedule);
    window.addEventListener("resize", schedule, { passive: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
