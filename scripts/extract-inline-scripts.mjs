import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const indexPath = resolve(root, "index.html");
const source = readFileSync(indexPath, "utf8");

const paths = {
  "inline-script-2": "src/legacy/ox-engine.js",
  "ox-v36-responsive-guard": "src/components/layout/responsive-guard.js",
  "ox-v36-motion-controller": "src/components/motion/controller.js",
  "ox-v36-nav-repair": "src/components/navigation/repair.js",
  "ox-v36-btc-mobile-interaction-refinement": "src/components/chart/mobile-interaction.js",
  "ox-v37-indicator-tooltip": "src/components/chart/indicator-tooltip.js",
  "ox-v37-account-summary": "src/components/account/summary.js",
  "ox-v38-market-glass-state": "src/app/market-glass-state.js",
  "ox-v381-liquid-glass-max-runtime": "src/components/liquid-glass/runtime.js",
  "ox-v382-short-panel-sync": "src/components/control-panel/short-panel-sync.js",
  "ox-v383-focus-viewport-fix": "src/components/chart/focus-viewport.js",
  "ox-v384-feature-search-provider-switch-runtime": "src/components/search/provider-switch.js"
};

let count = 0;
const pattern = /<script(?:\s+([^>]*))?>([\s\S]*?)<\/script>/gi;
const nextIndex = source.replace(pattern, (full, attributes = "", body) => {
  if (/\bsrc\s*=/i.test(attributes)) return full;
  count += 1;
  const id = attributes.match(/\bid=["']([^"']+)["']/i)?.[1] || `inline-script-${count}`;
  const relativePath = paths[id];
  if (!relativePath) throw new Error(`No extraction path configured for ${id}`);
  const outputPath = resolve(root, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${body.trim()}\n`, "utf8");
  return `<script src="${relativePath}"></script>`;
});

if (count !== Object.keys(paths).length) {
  throw new Error(`Expected ${Object.keys(paths).length} inline scripts, found ${count}`);
}

writeFileSync(indexPath, nextIndex, "utf8");
console.log(`Extracted ${count} inline scripts`);
