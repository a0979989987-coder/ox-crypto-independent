import { MARKET_IDS } from "./config.js?v=20261004-markets2";

export function createAppState(initial = {}) {
  const state = {
    activeMarket: "crypto",
    activeView: "radar",
    modules: new Map(),
    ...initial
  };

  if (!MARKET_IDS.includes(state.activeMarket)) state.activeMarket = "crypto";
  return state;
}

export const appState = createAppState();
