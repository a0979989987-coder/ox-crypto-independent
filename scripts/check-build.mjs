import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const errors = [];

const localRefs = [...html.matchAll(/(?:src|href)="(src\/[^"]+)"/g)].map(match => match[1]);
for (const ref of localRefs) {
  if (!existsSync(resolve(root, ref.split('?')[0]))) errors.push(`Missing local asset: ${ref}`);
}

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) errors.push(`Duplicate HTML ids: ${duplicateIds.join(", ")}`);
if (/<style(?:\s|>)/i.test(html)) errors.push("Inline style blocks remain in index.html");
if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html)) errors.push("Inline script blocks remain in index.html");
if (!html.includes("v4.0-modular-classified-rc2")) errors.push("Build marker is missing");
if (!/src="src\/app\/module-boot\.js(?:\?[^"]*)?"/.test(html)) errors.push("Modular entry is missing");
if (/src\/(?:legacy\/|styles\/legacy\.css)/.test(html)) errors.push("Legacy bundle references remain");

// The production Vercel Hobby project counts each JavaScript file under api/ as a function.
const apiFiles = readdirSync(resolve(root, "api"), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && /\.[cm]?js$/.test(entry.name));
if (apiFiles.length > 12) errors.push(`Vercel Hobby function limit exceeded: ${apiFiles.length}/12 API files`);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Build check passed: ${localRefs.length} local assets, ${ids.length} unique ids`);
