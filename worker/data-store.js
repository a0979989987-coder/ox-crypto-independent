// Public data files (news, macro results, taker history, tool snapshots) live in the
// Site's R2 bucket, so the GitHub Actions updates on main reach the Site without a redeploy.
// A release pointer is changed only after every immutable object is present.
import { DATA_FILE, REQUIRED_DATA } from './site.js';
export const DATA_POINTER = 'crypto-public/current.json';
export const dataPath = path => typeof path === 'string' && DATA_FILE.test(path) && !path.includes('..');
export const blobKey = hash => 'crypto-public/blobs/' + hash;
export async function sha256(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export async function readRelease(bucket) {
  const object = await bucket.get(DATA_POINTER); return object ? object.json() : null;
}
export async function readStoredData(path, bucket, release = undefined) {
  if (release === undefined) release = await readRelease(bucket);
  const entry = release?.files?.[path];
  if (!entry) return null;
  const object = await bucket.get(blobKey(entry.sha256));
  if (!object) throw Error('Published snapshot missing');
  return new Uint8Array(await object.arrayBuffer());
}

export async function boundedBody(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) throw Error('Body too large');
  const reader = request.body?.getReader(); if (!reader) throw Error('Missing body');
  const parts = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw Error('Body too large'); } parts.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}

export async function publishData(request, bucket, claims) {
  if (!bucket) return Response.json({ ok: false, error: { code: 'DATA_STORAGE_UNAVAILABLE' } }, { status: 503 });
  const url = new URL(request.url), operation = url.pathname.split('/').at(-1);
  const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method === 'GET' && operation === 'release') return reply({ ok: true, data: await readRelease(bucket) });
  if (request.method !== 'PUT') return reply({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }, 405);
  try {
    if (operation === 'blob') {
      const hash = url.searchParams.get('sha256'); if (!/^[a-f0-9]{64}$/.test(hash || '')) throw Error('Invalid hash');
      const bytes = await boundedBody(request, 20000000); if (!bytes.length || await sha256(bytes) !== hash) throw Error('Invalid bytes');
      await bucket.put(blobKey(hash), bytes, { customMetadata: { sha256: hash } }); return reply({ ok: true, sha256: hash });
    }
    if (operation !== 'release') return reply({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    const input = JSON.parse(new TextDecoder().decode(await boundedBody(request, 200000)));
    if (!/^[a-f0-9]{40}$/.test(input.commit || '') || !input.files || typeof input.files !== 'object' || Array.isArray(input.files)) throw Error('Invalid release');
    const paths = Object.keys(input.files); if (paths.length < REQUIRED_DATA.length || paths.length > 200) throw Error('Invalid release');
    for (const path of REQUIRED_DATA) if (!input.files[path]) throw Error('Incomplete release');
    let total = 0;
    for (const [path, entry] of Object.entries(input.files)) {
      if (!dataPath(path) || !entry || !/^[a-f0-9]{64}$/.test(entry.sha256 || '') || !Number.isInteger(entry.size) || entry.size < 1 || entry.size > 20000000) throw Error('Invalid file');
      total += entry.size; if (total > 100000000) throw Error('Invalid release size');
      const object = await bucket.head(blobKey(entry.sha256)); if (!object || object.size !== entry.size || object.customMetadata?.sha256 !== entry.sha256) throw Error('Unstaged file');
    }
    // Compare-and-swap protects concurrent collectors. The publisher reads this
    // pointer before fetching main, so a slower job cannot overwrite a newer release.
    const sequence = Number(claims.run_id); if (!Number.isSafeInteger(sequence) || sequence < 1) throw Error('Invalid run');
    const previousObject = await bucket.get(DATA_POINTER), previous = previousObject ? await previousObject.json() : null;
    if ((previous?.commit ?? null) !== input.previousCommit) return reply({ ok: false, error: { code: 'RELEASE_CHANGED' } }, 409);
    const release = { schemaVersion: 1, commit: input.commit, sequence, publishedAt: new Date().toISOString(), files: input.files };
    const stored = await bucket.put(DATA_POINTER, JSON.stringify(release), { httpMetadata: { contentType: 'application/json' },
      onlyIf: previousObject ? { etagMatches: previousObject.etag } : { etagDoesNotMatch: '*' } });
    if (!stored) return reply({ ok: false, error: { code: 'RELEASE_CHANGED' } }, 409);
    return reply({ ok: true, data: { commit: release.commit, publishedAt: release.publishedAt, fileCount: paths.length, totalBytes: total } });
  } catch { return reply({ ok: false, error: { code: 'INVALID_DATA_RELEASE' } }, 400); }
}
