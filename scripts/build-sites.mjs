// Builds what ChatGPT Sites publishes, into dist/:
//   dist/client          the public site: index.html, admin/privacy/terms pages, src/, images,
//                        and _seed/ with the data files as the first copy (live data then
//                        follows the R2 release that GitHub Actions publishes)
//   dist/server/index.js the Worker: API, /admin, /privacy, /terms and the data files
//   dist/.openai/hosting.json
// Run `npm run build:tools` first (it refreshes the browser bundles in src/generated);
// `npm run build:sites` does both. Vercel keeps serving the repository as before.
import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '..');
const PAGES = ['index.html', 'admin.html', 'privacy.html', 'terms.html', 'ox-logo.png'];
const DATA_DIRS = ['data', 'previews/data'];

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(path)); else if (entry.isFile()) out.push(path);
  }
  return out;
}
export async function buildSites({ out = resolve(root, 'dist'), log = console.log } = {}) {
  await rm(out, { recursive: true, force: true });
  const client = resolve(out, 'client');
  await mkdir(client, { recursive: true });
  for (const name of PAGES) await cp(resolve(root, name), resolve(client, name));
  for (const dir of ['src', 'assets']) await cp(resolve(root, dir), resolve(client, dir), { recursive: true, filter: source => !relative(root, source).split(sep).some(part => part.startsWith('.')) });
  // Data files are not static files on the Site: the Worker serves them from the latest
  // release, so a static copy at /data/… must not exist (it would shadow new data).
  let seeded = 0;
  for (const dir of DATA_DIRS) for (const path of await files(resolve(root, dir))) {
    if (!/\.json(?:\.gz)?$/.test(path)) continue;
    const target = resolve(client, '_seed', relative(root, path));
    await mkdir(resolve(target, '..'), { recursive: true }); await cp(path, target); seeded++;
  }
  await build({ entryPoints: [resolve(root, 'worker/index.js')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'none', outfile: resolve(out, 'server/index.js'), logLevel: 'warning' });
  await mkdir(resolve(out, '.openai'), { recursive: true });
  await cp(resolve(root, '.openai/hosting.json'), resolve(out, '.openai/hosting.json'));
  const hosting = JSON.parse(await readFile(resolve(root, '.openai/hosting.json'), 'utf8'));
  if (!/^appgprj_[a-f0-9]+$/.test(hosting.project_id || '')) log('Note: .openai/hosting.json still has a placeholder project_id; set the crypto Site\'s project id before publishing.');
  const size = (await Promise.all((await files(client)).map(async path => (await stat(path)).size))).reduce((a, b) => a + b, 0);
  log(`Built Sites client (${(size / 1e6).toFixed(1)} MB, ${seeded} data files under _seed) and Worker`);
  return { out, client, seeded };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildSites();
