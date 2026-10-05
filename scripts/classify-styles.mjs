import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "src/styles/legacy.css");
const indexPath = resolve(root, "index.html");
const source = readFileSync(sourcePath, "utf8");

const sections = [
  ["src/styles/base.css", "/* ===== inline-style-1 ===== */"],
  ["src/styles/themes/premium-glass.css", "/* ===== ox-premium-glass-design-system ===== */"],
  ["src/styles/themes/liquid-glass.css", "/* ===== ox-liquid-glass-design-system ===== */"],
  ["src/styles/components/strength-liquidation.css", "/* ===== ox-strength-liquidation-upgrade ===== */"],
  ["src/styles/motion.css", "/* ===== ox-v36-motion-system ===== */"],
  ["src/styles/mobile/btc-hero.css", "/* ===== ox-v36-btc-hero-mobile-refinement ===== */"],
  ["src/styles/layout/current-uiux.css", "/* ===== ox-v36-current-main-uiux-optimization ===== */"],
  ["src/styles/layout/responsive.css", "/* ===== ox-v36-final-responsive-ux ===== */"],
  ["src/styles/releases/v37-existing-fixes.css", "/* ===== ox-v37-existing-ui-fixes ===== */"],
  ["src/styles/themes/ios-liquid-glass.css", "/* ===== ox-v381-ios-liquid-glass-max ===== */"],
  ["src/styles/releases/v37-last-mile.css", "/* ===== ox-v37-last-mile-fixes ===== */"],
  ["src/styles/releases/v38-fluid-refinement.css", "/* ===== ox-v38-ui-glass-fluid-refinement ===== */"],
  ["src/styles/components/radar-light-tune.css", "/* ===== ox-v382-light-radar-tune ===== */"],
  ["src/styles/components/fullscreen-lightglass.css", "/* ===== ox-v383-fullscreen-lightglass-fix ===== */"],
  ["src/styles/components/feature-search-provider.css", "/* ===== ox-v384-feature-search-provider-switch-styles ===== */"],
];

const starts = sections.map(([path, marker]) => {
  const offset = source.indexOf(marker);
  if (offset < 0) throw new Error(`Missing boundary for ${path}: ${marker}`);
  return offset;
});

for (let index = 1; index < starts.length; index += 1) {
  if (starts[index] <= starts[index - 1]) throw new Error(`Boundary order is invalid at ${sections[index][0]}`);
}

const prefix = source.slice(0, starts[0]);
for (const [index, [path]] of sections.entries()) {
  const output = (index === 0 ? prefix : "") + source.slice(starts[index], starts[index + 1] ?? source.length);
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output);
}

const links = sections.map(([path]) => `  <link rel="stylesheet" href="${path}">`).join("\n");
const index = readFileSync(indexPath, "utf8");
const needle = '  <link rel="stylesheet" href="src/styles/legacy.css">';
if (!index.includes(needle)) throw new Error("Legacy stylesheet link was not found in index.html");
writeFileSync(indexPath, index.replace(needle, links));

for (const path of [
  sourcePath,
  resolve(root, "src/styles/components.css"),
  resolve(root, "src/styles/layout.css"),
  resolve(root, "src/styles/mobile.css"),
  resolve(root, "src/styles/tokens.css"),
]) rmSync(path, { force: true });

const reconstructed = sections.map(([path]) => readFileSync(resolve(root, path), "utf8")).join("");
if (reconstructed !== source) throw new Error("Classified styles do not reconstruct the original byte-for-byte");

console.log(`Classified ${source.length} bytes into ${sections.length} ordered stylesheets.`);
