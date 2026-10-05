import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "src/styles/base.css");
const indexPath = resolve(root, "index.html");
const source = readFileSync(sourcePath, "utf8");

const sections = [
  ["src/styles/core/foundation.css", null],
  ["src/styles/components/benchmark-alert-detail.css", "    /* ===== OX v2.3 additions:"],
  ["src/styles/layout/three-view-shell.css", "    /* ===== v3.0 three-view shell ===== */"],
  ["src/styles/releases/v31-ui-refinement.css", "    /* ===== OX v3.1 UI refinement"],
  ["src/styles/layout/command-center.css", "    /* ===== OX v3.6 Market Command Center"],
  ["src/styles/navigation/compact-dock.css", "    /* ===== v3.6 compact floating bottom dock"],
  ["src/styles/navigation/final-dock.css", "    /* ===== OX v3.6 final compact floating dock"],
  ["src/styles/themes/light-system.css", "    /* ===== v3.6 refinement: OX LIVE vertical centering"],
  ["src/styles/themes/light-complete.css", "    /* ===== v3.6 refinement 2: T1 TOP10 LIVE"],
  ["src/styles/themes/light-readability.css", "    /* ===== v3.6 refinement 3: light-theme readability"],
  ["src/styles/components/control-center.css", "    /* ===== OX v3.6 · Right Control Center"],
  ["src/styles/layout/compact-header.css", "    /* ===== v3.6 refinement: compact header"],
  ["src/styles/components/feature-pack.css", "    /* ===== v3.6 feature pack:"],
  ["src/styles/mobile/watchlist-chart.css", "    /* ===== v3.6 refinement: mobile star rail"],
  ["src/styles/mobile/direction-chart.css", "    /* ===== v3.6 refinement: compact LONG/SHORT"],
  ["src/styles/releases/v361-strength-liquidation.css", "/* ===== OX v3.6.1 refinement:"],
];

const starts = sections.map(([path, marker], index) => {
  if (index === 0) return 0;
  const offset = source.indexOf(marker);
  if (offset < 0) throw new Error(`Missing boundary for ${path}: ${marker}`);
  return offset;
});

for (let index = 1; index < starts.length; index += 1) {
  if (starts[index] <= starts[index - 1]) throw new Error(`Boundary order is invalid at ${sections[index][0]}`);
}

for (const [index, [path]] of sections.entries()) {
  const output = source.slice(starts[index], starts[index + 1] ?? source.length);
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output);
}

const links = sections.map(([path]) => `  <link rel="stylesheet" href="${path}">`).join("\n");
const index = readFileSync(indexPath, "utf8");
const needle = '  <link rel="stylesheet" href="src/styles/base.css">';
if (!index.includes(needle)) throw new Error("Base stylesheet link was not found in index.html");
writeFileSync(indexPath, index.replace(needle, links));
rmSync(sourcePath);

const reconstructed = sections.map(([path]) => readFileSync(resolve(root, path), "utf8")).join("");
if (reconstructed !== source) throw new Error("Classified base styles do not reconstruct the source byte-for-byte");

console.log(`Classified ${source.length} bytes into ${sections.length} ordered base stylesheets.`);
