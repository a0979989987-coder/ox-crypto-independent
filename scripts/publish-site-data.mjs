// Publishes the data files on main (data/*.json, previews/data/*.json: news, macro
// results, taker history, tool snapshots) to the Site's R2 release, so the scheduled
// GitHub Actions updates reach ChatGPT Sites without redeploying the site.
// Runs in GitHub Actions only (it signs in with the job's short-lived OIDC identity).
// OX_SITE_ORIGIN can point it at the Site's chatgpt.site address before the custom domain works.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PUBLIC_ORIGIN, PUBLISH_AUDIENCE, DATA_FILE, REQUIRED_DATA, LIVE_DATA } from '../worker/site.js';

export const SITE_ORIGIN = (process.env.OX_SITE_ORIGIN || PUBLIC_ORIGIN).replace(/\/$/, '');
export function collectPublicData(ref = 'origin/main') {
  const git = (args, encoding) => execFileSync('git', args, { encoding, maxBuffer: 40000000 });
  const commit = git(['rev-parse', ref], 'utf8').trim(); if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid source revision');
  const paths = git(['ls-tree', '-r', '--name-only', commit, '--', 'data', 'previews/data'], 'utf8').trim().split('\n').filter(Boolean);
  const files = new Map();
  for (const path of paths) {
    if (!/\.json(?:\.gz)?$/.test(path)) continue;
    if (!DATA_FILE.test(path) || path.includes('..')) throw Error('Unexpected public data file: ' + path);
    files.set(path, git(['show', commit + ':' + path]));
  }
  for (const path of REQUIRED_DATA) if (!files.has(path)) throw Error('Missing required data file: ' + path);
  const manifest = Object.fromEntries([...files].map(([path, bytes]) => [path, { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }]));
  return { commit, files, manifest };
}
// The release for a commit: its committed data files, plus the hourly live files (the
// radar snapshot) — the bytes given in `live`, otherwise the copy already published.
export function releaseFiles({ files, manifest }, current, live = {}) {
  const out = new Map(files), entries = { ...manifest };
  for (const path of LIVE_DATA) {
    if (live[path]) { const bytes = Buffer.from(live[path]); out.set(path, bytes); entries[path] = { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }; }
    else if (current?.files?.[path]) { out.delete(path); entries[path] = current.files[path]; }
  }
  for (const path of Object.keys(live)) if (!LIVE_DATA.includes(path)) throw Error('Not a live data file: ' + path);
  return { files: out, manifest: entries };
}
export async function publishSiteData({ ref = 'origin/main', origin = SITE_ORIGIN, fetcher = fetch, live = {}, identity = async () => {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL); if (url.protocol !== 'https:' || !url.hostname.endsWith('.actions.githubusercontent.com')) throw Error('Unexpected identity endpoint');
  url.searchParams.set('audience', PUBLISH_AUDIENCE);
  const response = await fetcher(url, { headers: { Authorization: 'Bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error('GitHub identity request failed'); const token = (await response.json()).value; if (typeof token !== 'string' || !token) throw Error('Missing GitHub identity'); return token;
}, fetchMain = () => execFileSync('git', ['fetch', 'origin', 'main'], { stdio: 'pipe', timeout: 60000 }) } = {}) {
  let token = await identity(), issuedAt = Date.now();
  const request = async (path, options = {}) => {
    if (Date.now() - issuedAt > 180000) { token = await identity(); issuedAt = Date.now(); }
    const response = await fetcher(origin + '/api/v1/crypto/data-upload/' + path, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) });
    if (!response.ok && !(path === 'release' && options.method === 'PUT' && response.status === 409)) throw Error('Site data ' + path.split('?')[0] + ' HTTP ' + response.status);
    return response;
  };
  publication: for (let attempt = 0; attempt < 3; attempt++) {
    const current = (await (await request('release')).json()).data;
    fetchMain();
    const { commit, ...committed } = collectPublicData(ref), { files, manifest } = releaseFiles(committed, current, live); let uploaded = 0;
    for (const [path, bytes] of files) {
      const file = manifest[path]; if (current?.files?.[path]?.sha256 === file.sha256) continue;
      await request('blob?sha256=' + file.sha256, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } }); uploaded++;
    }
    const published = await request('release', { method: 'PUT', body: JSON.stringify({ commit, files: manifest, previousCommit: current?.commit ?? null, previousRevision: current?.revision ?? 0 }), headers: { 'Content-Type': 'application/json' } });
    if (published.status === 409) continue;
    const result = await published.json();
    const readback = (await (await request('release')).json()).data;
    if (readback?.commit !== commit || JSON.stringify(readback.files) !== JSON.stringify(manifest)) continue;
    // The public addresses must now serve exactly these bytes from this commit.
    for (const path of [...REQUIRED_DATA, ...Object.keys(live)]) {
      const response = await fetcher(origin + '/' + path, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const actualHash = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
      if (!response.ok || actualHash !== manifest[path].sha256 || response.headers.get('X-OX-Data-Commit') !== commit) {
        const latest = (await (await request('release')).json()).data;
        if (latest?.commit !== commit) continue publication;
        throw Error('Public data readback mismatch: ' + path + ' expected=' + manifest[path].sha256 + ' actual=' + actualHash + ' release=' + (response.headers.get('X-OX-Data-Commit') || 'missing'));
      }
    }
    return { ...result.data, uploaded };
  }
  throw Error('Data release changed during all three bounded publication attempts');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await publishSiteData(), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
