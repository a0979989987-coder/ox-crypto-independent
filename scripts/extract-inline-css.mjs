import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const indexPath = resolve(root, "index.html");
const cssPath = resolve(root, "src/styles/legacy.css");
const source = readFileSync(indexPath, "utf8");
const blocks = [];

const stylePattern = /<style(?:\s+([^>]*))?>([\s\S]*?)<\/style>/gi;
let first = true;
const nextIndex = source.replace(stylePattern, (_full, attributes = "", css) => {
  const id = attributes.match(/\bid=["']([^"']+)["']/i)?.[1] || `inline-style-${blocks.length + 1}`;
  blocks.push(`/* ===== ${id} ===== */\n${css.trim()}\n`);
  if (first) {
    first = false;
    return '<link rel="stylesheet" href="src/styles/legacy.css">';
  }
  return `<!-- CSS moved: ${id} -->`;
});

if (!blocks.length) throw new Error("No inline style blocks found");
mkdirSync(dirname(cssPath), { recursive: true });
writeFileSync(cssPath, `/* OX v3.8.4 styles extracted without rule changes. */\n\n${blocks.join("\n")}`, "utf8");
writeFileSync(indexPath, nextIndex, "utf8");

console.log(`Extracted ${blocks.length} style blocks to ${cssPath}`);
