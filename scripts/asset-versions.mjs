// Every local file the site loads with ?v=… may be kept by browsers for a year (vercel.json):
// its ?v= token is its version. This keeps that promise.
//   - A file whose content changed must not keep any token it had: a page asking for the old
//     address would otherwise get the old copy back, and new HTML could pair with old CSS.
//   - index.html carries the mark of all the versions it loads (<meta name="ox-build">), so a
//     copy of an older page that a phone kept can see it is old (src/app/fresh-html.js).
// docs/asset-versions.json records each versioned file's tokens and content hash (text files
// with LF line endings, as git stores them, so Windows checkouts hash the same).
//   node scripts/asset-versions.mjs           check; exits 1 and says what to fix
//   node scripts/asset-versions.mjs --write   record the current tokens, hashes and mark
//                                             (refuses while a changed file keeps an old token)
// Only references the browser really requests count: the pages' src/href, dynamic import(),
// new URL(…) and other strings. A static `import … from './x.js?v=…'` inside a file that is
// bundled into src/generated/* is resolved by esbuild and never fetched, so its token is not a
// version and is ignored (static imports of modules the pages load directly still count).
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const PAGES = ['index.html', 'admin.html'];
const SKIP_DIRS = new Set(['src/generated', 'src/vendor', 'src/assets']);
const TEXT = /\.(?:m?js|css|html|json|svg|webmanifest|txt)$/i;
// Addresses a script puts together from a suffix: style-ready.js loads each tool's palette
// as '<tool>-light.css?v=…'.
const COMPUTED = { '-light.css': ['src/markets/crypto/bubbles/bubbles-light.css', 'src/markets/crypto/analytics/flow-light.css', 'src/markets/crypto/patterns/patterns-light.css'] };
const MANIFEST = 'docs/asset-versions.json';
const META = /<meta\s+name="ox-build"\s+content="([^"]*)"\s*\/?>/i;

const posix = path => path.split(sep).join('/');
const lf = text => text.replace(/\r\n/g, '\n');
export async function digest(root, path) {
  const bytes = await readFile(resolve(root, path));
  return createHash('sha256').update(TEXT.test(path) ? lf(bytes.toString('utf8')) : bytes).digest('hex');
}
async function sourceFiles(root, dir = 'src') {
  const out = [];
  for (const entry of await readdir(resolve(root, dir), { withFileTypes: true })) {
    const path = dir + '/' + entry.name;
    if (entry.name.startsWith('.') || SKIP_DIRS.has(path)) continue;
    if (entry.isDirectory()) out.push(...await sourceFiles(root, path));
    else if (/\.(?:m?js|css)$/.test(entry.name)) out.push(path);
  }
  return out;
}
function locate(root, from, ref) {
  const base = ref.split('?')[0].split('#')[0];
  if (/^(?:[a-z]+:)?\/\//i.test(base) || base.includes('${')) return null;
  const dir = dirname(resolve(root, from));
  const tries = base.startsWith('/') ? [resolve(root, '.' + base)]
    : base.startsWith('./') || base.startsWith('../') ? [resolve(dir, base)]
    : base.startsWith('src/') ? [resolve(root, base)] : [resolve(dir, base), resolve(root, base)];
  const hit = tries.find(path => existsSync(path) && !relative(root, path).startsWith('..'));
  return hit ? posix(relative(root, hit)) : null;
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const staticImport = before => /(?:^|[;\n}])\s*(?:import|export)\b[^;'"`]*?\bfrom\s*$/.test(before) || /(?:^|[;\n}])\s*import\s*$/.test(before);

// Every versioned address the browser can request: [{ from, line, ref, path, token, computed }]
export async function collect(root = ROOT) {
  const refs = [], unresolved = [];
  const pages = PAGES.filter(page => existsSync(resolve(root, page)));
  const direct = new Set(); // modules the pages load themselves, and their static imports
  const queue = [];
  for (const page of pages) {
    const html = await readFile(resolve(root, page), 'utf8');
    for (const match of html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)) { const path = locate(root, page, match[1]); if (path) queue.push(path); }
    for (const match of html.matchAll(/\b(?:src|href)="([^"]*\?v=([A-Za-z0-9._-]+)[^"]*)"/g)) {
      const path = locate(root, page, match[1]);
      (path ? refs : unresolved).push({ from: page, line: lineOf(html, match.index), ref: match[1], path, token: match[2] });
    }
  }
  while (queue.length) {
    const path = queue.pop(); if (direct.has(path)) continue; direct.add(path);
    const code = await readFile(resolve(root, path), 'utf8');
    for (const match of code.matchAll(/\b(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)) {
      const next = locate(root, path, match[1] || match[2]); if (next && /\.m?js$/.test(next)) queue.push(next);
    }
  }
  for (const file of await sourceFiles(root)) {
    const code = await readFile(resolve(root, file), 'utf8');
    for (const match of code.matchAll(/(['"`])([^'"`\s]*?)\?v=([A-Za-z0-9._-]+)/g)) {
      const ref = match[2] + '?v=' + match[3];
      const before = code.slice(Math.max(0, code.lastIndexOf('\n', match.index) - 400), match.index);
      if (!direct.has(file) && staticImport(before)) continue; // bundled: esbuild resolves it
      const line = lineOf(code, match.index);
      if (COMPUTED[match[2]]) { for (const path of COMPUTED[match[2]]) refs.push({ from: file, line, ref, path, token: match[3], computed: true }); continue; }
      const path = locate(root, file, match[2]);
      (path ? refs : unresolved).push({ from: file, line, ref, path, token: match[3] });
    }
  }
  return { refs, unresolved };
}
export function group(refs) {
  const files = new Map();
  for (const ref of refs) {
    const item = files.get(ref.path) || { tokens: new Set(), where: [] };
    item.tokens.add(ref.token); item.where.push(`${ref.from}:${ref.line}`); files.set(ref.path, item);
  }
  return files;
}
// The mark of a build: every versioned address the site can request, in one short hash.
export const buildMark = refs => createHash('sha256').update([...new Set(refs.map(r => `${r.path}?v=${r.token}`))].sort().join('\n')).digest('hex').slice(0, 16);

// strict: the record must match exactly (npm test). Otherwise only what breaks caching fails
// (a changed file that kept a token, an address that names no file, an outdated page mark).
export async function check({ root = ROOT, strict = true, manifest } = {}) {
  manifest ??= existsSync(resolve(root, MANIFEST)) ? JSON.parse(await readFile(resolve(root, MANIFEST), 'utf8')) : { files: {} };
  const { refs, unresolved } = await collect(root), files = group(refs), problems = [];
  for (const ref of unresolved) problems.push(`${ref.from}:${ref.line} asks for ${ref.ref}, which is not a file in this repository.`);
  for (const [path, item] of files) {
    const known = manifest.files?.[path], hash = await digest(root, path), tokens = [...item.tokens].sort();
    if (!known) { if (strict) problems.push(`${path} is new to the version record: run node scripts/asset-versions.mjs --write.`); continue; }
    if (known.sha256 !== hash) {
      const stale = tokens.filter(token => known.tokens.includes(token));
      if (stale.length) problems.push(`${path} changed but is still asked for as ?v=${stale.join(', ?v=')} (${item.where.join(', ')}): give it a new ?v= there, then run node scripts/asset-versions.mjs --write.`);
      else if (strict) problems.push(`${path} has new content and a new ?v=: run node scripts/asset-versions.mjs --write to record them.`);
    } else if (strict && tokens.join() !== [...known.tokens].sort().join()) problems.push(`${path} is asked for with other tokens than recorded: run node scripts/asset-versions.mjs --write.`);
  }
  if (strict) for (const path of Object.keys(manifest.files || {})) if (!files.has(path)) problems.push(`${path} is no longer loaded with ?v=: run node scripts/asset-versions.mjs --write.`);
  const mark = buildMark(refs), html = existsSync(resolve(root, 'index.html')) ? await readFile(resolve(root, 'index.html'), 'utf8') : '';
  const meta = META.exec(html)?.[1];
  if (meta === undefined) problems.push('index.html has no <meta name="ox-build">.');
  else if (meta !== mark) problems.push(`index.html's <meta name="ox-build"> is ${meta || 'empty'}, its files make ${mark}: run node scripts/asset-versions.mjs --write.`);
  return { problems, refs, files, mark };
}
export async function write({ root = ROOT } = {}) {
  const { problems, refs, files, mark } = await check({ root, strict: false });
  const blocking = problems.filter(p => / changed but | not a file /.test(p));
  if (blocking.length) return { written: false, problems: blocking };
  const record = { note: 'Each file the site loads with ?v=: the tokens it is asked for with and its content (sha256, LF line endings). Written by node scripts/asset-versions.mjs --write; npm test checks it.', files: {} };
  for (const path of [...files.keys()].sort()) record.files[path] = { tokens: [...files.get(path).tokens].sort(), sha256: await digest(root, path) };
  await writeFile(resolve(root, MANIFEST), JSON.stringify(record, null, 1) + '\n');
  const htmlPath = resolve(root, 'index.html'), html = await readFile(htmlPath, 'utf8');
  if (META.exec(html)?.[1] !== mark) await writeFile(htmlPath, html.replace(META, `<meta name="ox-build" content="${mark}">`));
  return { written: true, files: files.size, refs: refs.length, mark };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--write')) {
    const result = await write();
    if (!result.written) { console.error(result.problems.join('\n')); process.exit(1); }
    console.log(`Recorded ${result.files} versioned files (${result.refs} addresses); build mark ${result.mark}.`);
  } else {
    const { problems, files, mark } = await check();
    if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
    console.log(`Asset versions OK: ${files.size} versioned files, build mark ${mark}.`);
  }
}
