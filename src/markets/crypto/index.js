import { CRYPTO_MODULE_CONFIG } from "./config.js";
import { cryptoHomeBoundary } from "./home.js";
import { cryptoStrengthBoundary } from "./strength.js";
import { cryptoRadarBoundary } from "./radar.js";

let activeView = "radar";
const boundaries = Object.freeze({ home: cryptoHomeBoundary, strength: cryptoStrengthBoundary, radar: cryptoRadarBoundary });

export const cryptoModule = Object.freeze({
  id: CRYPTO_MODULE_CONFIG.id,
  label: CRYPTO_MODULE_CONFIG.label,
  architecture: CRYPTO_MODULE_CONFIG.architecture,
  activate({ view = activeView } = {}) { activeView = view; return boundaries[activeView] || null; },
  deactivate() {},
  view(view) { activeView = view; return boundaries[activeView] || null; },
  refresh() { return boundaries[activeView] || null; }
});
