import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPublisher } from '../worker/github-identity.js';
import { publishData, DATA_POINTER, sha256, readStoredData } from '../worker/data-store.js';
import { snapshotAssetResponse } from '../worker/snapshots.js';
import { REQUIRED_DATA } from '../worker/site.js';
import { collectPublicData, publishSiteData } from '../scripts/publish-site-data.mjs';
import { buildSites } from '../scripts/build-sites.mjs';
import worker from '../worker/index.js';

const origin = 'https://crypto.oxpattern.com';
const encoder = new TextEncoder(), base64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

test('publisher identity checks the signature and binds audience, repository IDs, workflow, main and expiry', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-data-key', use: 'sig' };
  const now = Date.now(), seconds = Math.floor(now / 1000);
  const claims = { iss: 'https://token.actions.githubusercontent.com', aud: origin, sub: 'repo:a0979989987-coder/ox-crypto-independent:ref:refs/heads/main', repository: 'a0979989987-coder/ox-crypto-independent', repository_id: '1406048637', repository_owner_id: '327283790', ref: 'refs/heads/main', ref_type: 'branch', workflow_ref: 'a0979989987-coder/ox-crypto-independent/.github/workflows/update-news.yml@refs/heads/main', event_name: 'schedule', iat: seconds, nbf: seconds - 5, exp: seconds + 300, run_id: '100' };
  const token = async value => { const input = base64({ alg: 'RS256', typ: 'JWT', kid: jwk.kid }) + '.' + base64(value); return input + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, encoder.encode(input))).toString('base64url'); };
  const request = token => new Request(origin + '/api/v1/crypto/data-upload/release', { headers: { Authorization: 'Bearer ' + token } });
  const options = { now, fetcher: async url => { assert.equal(url, 'https://token.actions.githubusercontent.com/.well-known/jwks'); return Response.json({ keys: [jwk] }); } };
  assert.deepEqual(await verifyPublisher(request(await token(claims)), options), claims);
  for (const workflow of ['deploy-sites-data.yml', 'update-macro-results.yml', 'flow-history.yml', 'record-crypto-breakouts.yml', 'update-crypto-radar.yml'])
    assert.ok(await verifyPublisher(request(await token({ ...claims, workflow_ref: claims.workflow_ref.replace('update-news.yml', workflow) })), options), workflow);
  for (const mutation of [{ aud: 'https://ox-tw-independent.btcfly.chatgpt.site' }, { repository: 'a0979989987-coder/ox-tw-independent' }, { repository_id: '1405941562' }, { repository_owner_id: '1' }, { ref: 'refs/heads/feature' },
    { workflow_ref: claims.workflow_ref.replace('update-news.yml', 'verify-independent.yml') }, { exp: seconds - 1 }, { exp: seconds + 3600 }, { event_name: 'pull_request' }])
    assert.equal(await verifyPublisher(request(await token({ ...claims, ...mutation })), options), null, JSON.stringify(mutation));
  const valid = await token(claims), parts = valid.split('.'); parts[1] = base64({ ...claims, run_id: '999' });
  assert.equal(await verifyPublisher(request(parts.join('.')), options), null, 'valid claims cannot borrow another signature');
  assert.equal(await verifyPublisher(new Request(origin, { headers: { Authorization: 'Bearer abc' } }), options), null);
});

function memoryBucket() {
  const values = new Map(); let serial = 0;
  return { values, async get(key) { const saved = values.get(key); return saved ? { ...saved, json: async () => JSON.parse(new TextDecoder().decode(saved.bytes)), arrayBuffer: async () => saved.bytes.slice().buffer } : null; },
    async head(key) { const saved = values.get(key); return saved ? { size: saved.bytes.length, customMetadata: saved.customMetadata } : null; },
    async put(key, value, options = {}) {
      const old = values.get(key); if (options.onlyIf?.etagMatches !== undefined && old?.etag !== options.onlyIf.etagMatches || options.onlyIf?.etagDoesNotMatch === '*' && old) return null;
      const saved = { bytes: typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value), customMetadata: options.customMetadata, etag: String(++serial) }; values.set(key, saved); return saved;
    } };
}

test('a data release needs every file staged and the required files; errors keep the old release; stale writers lose', async () => {
  const bucket = memoryBucket(), bytes = encoder.encode('{"generatedAt":"2026-10-28T00:00:00Z"}'), hash = await sha256(bytes);
  const call = (operation, body) => publishData(new Request(origin + '/api/v1/crypto/data-upload/' + operation, { method: 'PUT', body }), bucket, { run_id: '100' });
  const files = Object.fromEntries(REQUIRED_DATA.map(path => [path, { sha256: hash, size: bytes.length }]));
  const release = { commit: 'a'.repeat(40), previousCommit: null, files };
  assert.equal((await call('release', JSON.stringify(release))).status, 400, 'nothing staged yet'); assert.equal(await bucket.get(DATA_POINTER), null);
  assert.equal((await call('blob?sha256=' + hash, bytes)).status, 200);
  assert.equal((await call('release', JSON.stringify({ ...release, files: { 'data/news.json': files['data/news.json'] } }))).status, 400, 'required files');
  assert.equal((await call('release', JSON.stringify(release))).status, 200);
  assert.deepEqual(await readStoredData('data/news.json', bucket), bytes);
  assert.equal((await call('release', JSON.stringify({ ...release, commit: 'b'.repeat(40) }))).status, 409, 'stale previous commit');
  assert.equal((await (await bucket.get(DATA_POINTER)).json()).commit, release.commit);
  for (const path of ['src/app/app.js', 'data/../worker/index.js', 'server/app/auth.js', 'previews/crypto-flow.html', 'data/x.js'])
    assert.equal((await call('release', JSON.stringify({ ...release, previousCommit: release.commit, files: { ...files, [path]: files['data/news.json'] } }))).status, 400, path);
  assert.equal((await call('blob?sha256=' + hash, encoder.encode('changed'))).status, 400, 'bytes must match their hash');
  assert.equal((await (await bucket.get(DATA_POINTER)).json()).commit, release.commit);
});

test('anonymous requests cannot write data; the public data set is only data files', async () => {
  const response = await worker.fetch(new Request(origin + '/api/v1/crypto/data-upload/release', { method: 'PUT', body: '{}' }), { BUCKET: memoryBucket() }, {});
  assert.equal(response.status, 401); assert.equal((await response.json()).error.code, 'PUBLISHER_UNAUTHORIZED');
  const snapshot = collectPublicData('HEAD');
  for (const path of REQUIRED_DATA) assert.ok(snapshot.files.has(path), path);
  for (const path of snapshot.files.keys()) assert.match(path, /^(?:data|previews\/data)\/[A-Za-z0-9_.-]+\.json$/);
});

test('the publisher uploads only changed files, moves the pointer last and verifies the public bytes', async () => {
  const bucket = memoryBucket(), assets = { fetch: async () => new Response('missing', { status: 404 }) };
  const requests = [];
  const site = async (url, init = {}) => {
    const request = new Request(url, init); requests.push(request.method + ' ' + new URL(url).pathname);
    if (new URL(url).pathname.startsWith('/api/v1/crypto/data-upload/')) { assert.equal(request.headers.get('Authorization'), 'Bearer gh-oidc'); return publishData(request, bucket, { run_id: '7' }); }
    return snapshotAssetResponse(new URL(url).pathname.slice(1), request, assets, { bucket });
  };
  const first = await publishSiteData({ ref: 'HEAD', origin, fetcher: site, identity: async () => 'gh-oidc', fetchMain: () => {} });
  const expected = collectPublicData('HEAD');
  assert.equal(first.commit, expected.commit); assert.equal(first.fileCount, expected.files.size);
  assert.equal(first.uploaded, expected.files.size);
  for (const path of REQUIRED_DATA) assert.ok(requests.includes('GET /' + path), 'read back ' + path);
  const again = await publishSiteData({ ref: 'HEAD', origin, fetcher: site, identity: async () => 'gh-oidc', fetchMain: () => {} });
  assert.equal(again.uploaded, 0, 'unchanged files are not uploaded twice');
  const news = await site(origin + '/data/news.json');
  assert.equal(news.headers.get('X-OX-Data-Commit'), expected.commit);
  assert.equal(await sha256(new Uint8Array(await news.arrayBuffer())), expected.manifest['data/news.json'].sha256);
});

test('the Sites build serves data only through the Worker, keeps source and secrets out, and the release wins over the bundle', async () => {
  const out = await mkdtemp(join(tmpdir(), 'ox-sites-build-'));
  try {
    await buildSites({ out, log: () => {} });
    const client = join(out, 'client');
    await assert.rejects(stat(join(client, 'data/news.json')), { code: 'ENOENT' });
    await assert.rejects(stat(join(client, 'previews/data/crypto-flow-history.json')), { code: 'ENOENT' });
    assert.ok((await stat(join(client, '_seed/data/news.json'))).isFile());
    assert.ok((await stat(join(client, '_seed/previews/data/crypto-tools-snapshot.json'))).isFile());
    for (const name of ['index.html', 'admin.html', 'privacy.html', 'terms.html', 'src/app/account.js', 'src/app/usage.js', 'src/generated/runtime.js']) assert.ok((await stat(join(client, name))).isFile(), name);
    const top = await readdir(client);
    for (const name of ['server', 'worker', 'scripts', 'tests', 'docs', 'api', 'supabase', 'package.json', '.env.example', 'vercel.json', 'node_modules']) assert.ok(!top.includes(name), name + ' is not public');
    assert.deepEqual(JSON.parse(await readFile(join(out, '.openai/hosting.json'), 'utf8')), JSON.parse(await readFile(new URL('../.openai/hosting.json', import.meta.url), 'utf8')));
    const bundle = await readFile(join(out, 'server/index.js'), 'utf8');
    assert.ok(bundle.length > 10000 && !/from\s*["']node:/.test(bundle), 'the Worker bundle has no Node-only imports');
    // Asset-first hosting: /data/news.json is not a file, so the Worker answers from the release.
    const assets = { async fetch(request) { const path = new URL(request.url).pathname; try { return new Response(await readFile(join(client, decodeURIComponent(path)))); } catch { return new Response('missing', { status: 404 }); } } };
    const bucket = memoryBucket(), bytes = encoder.encode('{"marker":"newly-published"}'), hash = await sha256(bytes), commit = 'c'.repeat(40);
    await bucket.put('crypto-public/blobs/' + hash, bytes);
    await bucket.put(DATA_POINTER, JSON.stringify({ commit, files: { 'data/news.json': { sha256: hash, size: bytes.length } } }));
    const request = new Request(origin + '/data/news.json'), assetFirst = await assets.fetch(request);
    const response = assetFirst.ok ? assetFirst : await worker.fetch(request, { BUCKET: bucket, ASSETS: assets }, {});
    assert.equal(await response.text(), '{"marker":"newly-published"}');
    assert.equal(response.headers.get('X-OX-Data-Commit'), commit);
    const bundled = await worker.fetch(new Request(origin + '/previews/data/crypto-flow-history.json'), { BUCKET: bucket, ASSETS: assets }, {});
    assert.equal(bundled.status, 200); assert.equal(bundled.headers.get('X-OX-Data-Commit'), 'bundled');
    const again = await worker.fetch(new Request(origin + '/data/news.json', { headers: { 'If-None-Match': response.headers.get('ETag') } }), { BUCKET: bucket, ASSETS: assets }, {});
    assert.equal(again.status, 304);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('data workflows publish to Sites only once switched on, and keep their schedules', async () => {
  const read = name => readFile(new URL('../.github/workflows/' + name, import.meta.url), 'utf8').then(text => text.replace(/\r\n/g, '\n'));
  for (const [name, cron] of [['update-news.yml', ['23 */6 * * *']], ['update-macro-results.yml', ['7,22,37,52 12-21 * * 1-5']], ['flow-history.yml', ['17 1 * * *']], ['record-crypto-breakouts.yml', ['7 * * * *']]]) {
    const text = await read(name);
    assert.deepEqual([...text.matchAll(/cron: '([^']+)'/g)].map(m => m[1]), cron, name);
    assert.match(text, /id-token: write/);
    assert.match(text, /if: \$\{\{ always\(\) && !cancelled\(\) && github\.ref == 'refs\/heads\/main' && vars\.OX_SITES_DATA == 'on' \}\}\n(?:.*\n)*?\s+node scripts\/publish-site-data\.mjs/);
  }
  const manual = await read('deploy-sites-data.yml');
  assert.match(manual, /github\.event_name == 'workflow_dispatch' \|\| vars\.OX_SITES_DATA == 'on'/);
  assert.doesNotMatch(manual, /contents: write/);
});
