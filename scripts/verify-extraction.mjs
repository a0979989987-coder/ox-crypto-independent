import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const original = execFileSync("git", ["show", "main:index.html"], { cwd: root, encoding: "utf8", maxBuffer: 2_000_000 });
const extractionCommit = "ed8df7a";
const extractedIndex = execFileSync("git", ["show", `${extractionCommit}:index.html`], { cwd: root, encoding: "utf8", maxBuffer: 2_000_000 });
const legacyCss = execFileSync("git", ["show", `${extractionCommit}:src/styles/legacy.css`], { cwd: root, encoding: "utf8", maxBuffer: 2_000_000 });

const originalStyles = [...original.matchAll(/<style(?:\s+[^>]*)?>([\s\S]*?)<\/style>/gi)].map(match => match[1].trim());
for (const [index, css] of originalStyles.entries()) {
  if (!legacyCss.includes(css)) throw new Error(`Extracted CSS block ${index + 1} differs from v3.8.4`);
}

const originalScripts = [...original.matchAll(/<script(?:\s+([^>]*))?>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\bsrc\s*=/i.test(match[1] || ""))
  .map(match => match[2].trim());
const currentPaths = [...extractedIndex.matchAll(/<script src="(src\/[^"]+\.js)"><\/script>/g)].map(match => match[1]);
if (currentPaths.length !== originalScripts.length) throw new Error("Extracted script count differs from v3.8.4");
for (const [index, path] of currentPaths.entries()) {
  const extracted = execFileSync("git", ["show", `${extractionCommit}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 2_000_000 }).trim();
  if (extracted !== originalScripts[index]) throw new Error(`Extracted script ${path} differs from v3.8.4`);
}

console.log(`Extraction verified: ${originalStyles.length} CSS blocks and ${originalScripts.length} scripts match v3.8.4`);

const classifiedFrom = "c11fdcb";
const runtimePaths = [
  "src/core/runtime-config.js",
  "src/components/strength/snapshots.js",
  "src/components/alerts/level-alerts.js",
  "src/components/strength/market-strength.js",
  "src/app/view-home-theme.js",
  "src/markets/crypto/api.js",
  "src/markets/crypto/engine.js",
  "src/markets/crypto/scanner.js",
  "src/components/chart/workspace.js",
  "src/markets/crypto/presentation.js",
  "src/components/account/store.js",
  "src/components/control-panel/feature-pack.js",
  "src/components/navigation/runtime-actions.js",
  "src/app/runtime-boot.js",
];
const stylePaths = [
  "src/styles/core/foundation.css",
  "src/styles/components/benchmark-alert-detail.css",
  "src/styles/layout/three-view-shell.css",
  "src/styles/releases/v31-ui-refinement.css",
  "src/styles/layout/command-center.css",
  "src/styles/navigation/compact-dock.css",
  "src/styles/navigation/final-dock.css",
  "src/styles/themes/light-system.css",
  "src/styles/themes/light-complete.css",
  "src/styles/themes/light-readability.css",
  "src/styles/components/control-center.css",
  "src/styles/layout/compact-header.css",
  "src/styles/components/feature-pack.css",
  "src/styles/mobile/watchlist-chart.css",
  "src/styles/mobile/direction-chart.css",
  "src/styles/releases/v361-strength-liquidation.css",
  "src/styles/themes/premium-glass.css",
  "src/styles/themes/liquid-glass.css",
  "src/styles/components/strength-liquidation.css",
  "src/styles/motion.css",
  "src/styles/mobile/btc-hero.css",
  "src/styles/layout/current-uiux.css",
  "src/styles/layout/responsive.css",
  "src/styles/releases/v37-existing-fixes.css",
  "src/styles/themes/ios-liquid-glass.css",
  "src/styles/releases/v37-last-mile.css",
  "src/styles/releases/v38-fluid-refinement.css",
  "src/styles/components/radar-light-tune.css",
  "src/styles/components/fullscreen-lightglass.css",
  "src/styles/components/feature-search-provider.css",
];
const reconstruct = paths => paths.map(path => readFileSync(resolve(root, path), "utf8")).join("");
const priorRuntime = execFileSync("git", ["show", `${classifiedFrom}:src/legacy/ox-engine.js`], { cwd: root, encoding: "utf8", maxBuffer: 2_000_000 });
const priorStyles = execFileSync("git", ["show", `${classifiedFrom}:src/styles/legacy.css`], { cwd: root, encoding: "utf8", maxBuffer: 2_000_000 });
const stripGateFixes = value => value
  .replace(/\n(?:[ \t]*\n)*[ \t]*\/\* STEP 4\.5 REGRESSION FIX START[\s\S]*?\/\* STEP 4\.5 REGRESSION FIX END \*\/\n?/g, "\n");
const stripApprovedAuditFixes = value => stripGateFixes(value)
  .replace(/\nfunction escapeHtml\(value\) \{\n  return String\(value \?\? ""\)\.replace\(\/\[&<>"'\]\/g, character => \(\{\n    "&": "&amp;",\n    "<": "&lt;",\n    ">": "&gt;",\n    "\\\"": "&quot;",\n    "'": "&#39;"\n  \}\)\[character\]\);\n\}\n/g, "")
  .replace(/\n  const escapeHtml = value => String\(value \?\? ""\)\.replace\(\/\[&<>"'\]\/g, character => \(\{ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\\"": "&quot;", "'": "&#39;" \}\)\[character\]\);/g, "")
  .replace(/\$\{result\.primaryError \? `暫不可用（\$\{escapeHtml\(result\.primaryError\)\}）` : "尚未接通"\}/g, '${result.primaryError ? `暫不可用（${result.primaryError}）` : "尚未接通"}');
if (stripApprovedAuditFixes(reconstruct(runtimePaths)) !== priorRuntime) throw new Error("Classified runtime differs from the verified pre-classification bundle outside approved Step 4.5 and Step 7 fixes");
if (stripGateFixes(reconstruct(stylePaths)) !== priorStyles) throw new Error("Classified styles differ from the verified pre-classification bundle outside approved Step 4.5 fixes");
console.log(`Classification verified: ${runtimePaths.length} runtime modules and ${stylePaths.length} stylesheets reconstruct ${classifiedFrom}`);
