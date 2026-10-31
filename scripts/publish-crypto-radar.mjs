// Publishes a radar snapshot written by scripts/collect-crypto-radar.mjs without adding
// it to main's history:
//   - branch: force-pushes it as the only file of the orphan branch live-data (one
//     commit, no history), read by the page from raw.githubusercontent.com while the
//     site is on Vercel;
//   - sites: into the ChatGPT Sites data release (same origin /data/crypto-radar.json).
// An older snapshot never replaces a newer one at either place.
//   node scripts/publish-crypto-radar.mjs --file crypto-radar.json [--to branch,sites] [--branch live-data]
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { publishSiteData, SITE_ORIGIN } from './publish-site-data.mjs';

export const LIVE_BRANCH = 'live-data', LIVE_FILE = 'crypto-radar.json', SITE_PATH = 'data/crypto-radar.json';
export const MIN_ROWS = 50;

// Only a complete snapshot of this schema with enough coins may be published.
export function checkSnapshot(snapshot, { minRows = MIN_ROWS } = {}) {
  if (snapshot?.schema !== 'ox-crypto-radar/1' || !Number.isFinite(snapshot.generatedAt) || !Number.isFinite(snapshot.closes?.['1H']) ||
    !Array.isArray(snapshot.rows) || snapshot.rows.length < minRows || !Array.isArray(snapshot.strings) || !Number.isInteger(snapshot.engine) || snapshot.complete !== true) throw Error('Not a complete radar snapshot');
  return snapshot;
}
// Newer means a later 1H close, or the same close collected later.
export const isNewer = (next, current) => !current || !Number.isFinite(current.generatedAt) ||
  next.closes['1H'] > (current.closes?.['1H'] ?? -Infinity) || next.closes['1H'] === current.closes?.['1H'] && next.generatedAt > current.generatedAt;

const parse = text => { try { return JSON.parse(text); } catch { return null; } };
export function publishBranch({ bytes, snapshot, branch = LIVE_BRANCH, remote = 'origin', git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }) }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let previous = '';
    try { previous = git(['ls-remote', '--heads', remote, branch]).trim().split(/\s+/)[0] || ''; } catch { previous = ''; }
    if (previous) {
      git(['fetch', '--quiet', '--depth=1', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
      let published = null; try { published = parse(git(['show', `refs/remotes/${remote}/${branch}:${LIVE_FILE}`], { maxBuffer: 64 << 20 })); } catch {}
      if (!isNewer(snapshot, published)) return { status: 'kept', reason: 'newer snapshot already on ' + branch, previous };
    }
    const blob = git(['hash-object', '-w', '--stdin'], { input: bytes }).trim();
    const tree = git(['mktree'], { input: `100644 blob ${blob}\t${LIVE_FILE}\n` }).trim();
    const close = new Date(snapshot.closes['1H']).toISOString().replace('.000', '');
    const commit = git(['commit-tree', tree, '-m', `data: crypto radar ${close}`], { env: { ...process.env,
      GIT_AUTHOR_NAME: 'github-actions[bot]', GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'github-actions[bot]', GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com' } }).trim();
    // The lease fails when another run moved the branch since it was read: read it again.
    try { git(['push', '--quiet', `--force-with-lease=refs/heads/${branch}:${previous}`, remote, `${commit}:refs/heads/${branch}`]); return { status: 'published', commit, previous }; }
    catch (error) { if (attempt === 2) throw error; }
  }
}

export async function publishSites({ bytes, snapshot, origin = SITE_ORIGIN, fetcher = fetch, publish = publishSiteData }) {
  let published = null;
  try { const response = await fetcher(origin + '/' + SITE_PATH, { cache: 'no-store', signal: AbortSignal.timeout(20000) }); if (response.ok) published = parse(await response.text()); } catch {}
  if (!isNewer(snapshot, published)) return { status: 'kept', reason: 'newer snapshot already on the Site' };
  return { status: 'published', ...await publish({ live: { [SITE_PATH]: bytes } }) };
}

async function main() {
  const option = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const file = option('--file') || LIVE_FILE, bytes = await readFile(file), snapshot = checkSnapshot(parse(bytes.toString('utf8')));
  const targets = (option('--to') || 'branch').split(','), results = {};
  if (targets.some(t => !['branch', 'sites'].includes(t))) throw Error('--to takes branch and/or sites');
  if (targets.includes('branch')) results.branch = publishBranch({ bytes, snapshot, branch: option('--branch') || LIVE_BRANCH });
  if (targets.includes('sites')) results.sites = await publishSites({ bytes, snapshot });
  console.log(JSON.stringify(results));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
