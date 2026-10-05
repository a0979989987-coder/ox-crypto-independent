import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "src/legacy/ox-engine.js");
const indexPath = resolve(root, "index.html");
const source = readFileSync(sourcePath, "utf8");

const sections = [
  ["src/core/runtime-config.js", null],
  ["src/components/strength/snapshots.js", "const BTC_ALT_STRENGTH_CONFIG = Object.freeze({"],
  ["src/components/alerts/level-alerts.js", "const getKeyLevelPeriods = () =>"],
  ["src/components/strength/market-strength.js", "function classifyStrength(raw) {"],
  ["src/app/view-home-theme.js", "function resizeChartToContainer() {"],
  ["src/markets/crypto/api.js", "const ASSET_CLASS = Object.freeze({"],
  ["src/markets/crypto/engine.js", "const OXEngine = {"],
  ["src/markets/crypto/scanner.js", "async function refreshMarketTickers() {"],
  ["src/components/chart/workspace.js", "function getChartRightOffset() {"],
  ["src/markets/crypto/presentation.js", "function renderBenchmarkBar() {"],
  ["src/components/account/store.js", "const OX_GUEST_PREFS_KEY ="],
  ["src/components/control-panel/feature-pack.js", "const OXFeaturePack = (()=>{"],
  ["src/components/navigation/runtime-actions.js", "const LiquidationService = (() => {"],
  ["src/app/runtime-boot.js", "const keyLevelVisibilityToggle ="],
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

const tags = sections.map(([path]) => `<script src="${path}"></script>`).join("\n");
const index = readFileSync(indexPath, "utf8");
const needle = '<script src="src/legacy/ox-engine.js"></script>';
if (!index.includes(needle)) throw new Error("Legacy runtime tag was not found in index.html");
writeFileSync(indexPath, index.replace(needle, tags));
rmSync(sourcePath);

const reconstructed = sections.map(([path]) => readFileSync(resolve(root, path), "utf8")).join("");
if (reconstructed !== source) throw new Error("Classified runtime does not reconstruct the original byte-for-byte");

console.log(`Classified ${source.length} bytes into ${sections.length} ordered runtime modules.`);
