// Public data files come from the Site's latest R2 release, with the copy bundled
// in the deployment (dist/client/_seed) as the bootstrap fallback. Never fetch the
// Site's own public URL here: that would recurse through this same Worker.
import { readStoredData, readRelease, dataPath } from './data-store.js';
const bundledCache = new WeakMap();
export async function readSnapshotAsset(path, assets, { bucket, release } = {}) {
  if (!dataPath(path)) throw Error('Invalid snapshot path');
  if (bucket) { const bytes = await readStoredData(path, bucket, release); if (bytes) return bytes; }
  if (!assets) throw Error('Saved snapshot unavailable');
  let cache = bundledCache.get(assets); if (!cache) { cache = new Map(); bundledCache.set(assets, cache); }
  if (cache.has(path)) return cache.get(path);
  let response = await assets.fetch(new Request('https://assets.local/_seed/' + path));
  if (!response.ok) response = await assets.fetch(new Request('https://assets.local/' + path));
  if (!response.ok) throw Error('Saved snapshot unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 1000000 && cache.size < 20) cache.set(path, bytes);
  return bytes;
}
const etags = new WeakMap();
async function etagOf(bytes) {
  if (!etags.has(bytes)) { const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); etags.set(bytes, 'W/"' + [...digest.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('') + '"'); }
  return etags.get(bytes);
}
// Pre-compressed .json.gz is sent as application/gzip with no Content-Encoding, so
// a CDN cannot wrap a second gzip layer around it; the page decompresses it itself.
// no-cache keeps a copy in the browser but asks again every time (304 when unchanged).
export async function snapshotAssetResponse(path, request, assets, options) {
  const release = options?.bucket ? await readRelease(options.bucket) : null;
  const bytes = await readSnapshotAsset(path, assets, { ...options, release }), gzip = path.endsWith('.gz');
  if (gzip && (bytes[0] !== 0x1f || bytes[1] !== 0x8b)) throw Error('Invalid gzip snapshot');
  const headers = { 'Content-Type': gzip ? 'application/gzip' : 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'ETag': await etagOf(bytes),
    'X-OX-Data-Commit': release?.files?.[path] ? release.commit : 'bundled', 'X-Content-Type-Options': 'nosniff' };
  if (request.headers.get('If-None-Match') === headers.ETag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : bytes, { headers });
}
