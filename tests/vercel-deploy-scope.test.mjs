import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
const routes = config.routes || [];
const filesystemIndex = routes.findIndex(route => route.handle === 'filesystem');
// Legacy routes run before Vercel's filesystem phase; only those can hide a static file.
const preFilesystem = filesystemIndex === -1 ? routes : routes.slice(0, filesystemIndex);
const blocked = path => preFilesystem.some(route => route.status === 404 && !route.continue && new RegExp(route.src).test(path));

const ignorePatterns = readFileSync(resolve(root, '.vercelignore'), 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
const ignored = file => ignorePatterns.some(pattern => pattern.endsWith('/') ? `/${file}`.startsWith(pattern) : `/${file}` === pattern);

function functionGraph() {
  const entries = readdirSync(resolve(root, 'api'), { recursive: true }).filter(file => /\.[cm]?js$/.test(file)).map(file => resolve(root, 'api', file));
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = readFileSync(file, 'utf8');
    for (const match of code.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const target = resolve(dirname(file), (match[1] || match[2]).split('?')[0]);
      assert.ok(existsSync(target), `${relative(root, file)} imports missing ${relative(root, target)}`);
      visit(target);
    }
  };
  entries.forEach(visit);
  return [...seen].map(file => relative(root, file).replaceAll('\\', '/'));
}

test('.vercelignore patterns are anchored so they cannot hide nested public files', () => {
  assert.ok(ignorePatterns.length > 0);
  for (const pattern of ignorePatterns) assert.match(pattern, /^\//, `${pattern} must start with /`);
});

test('Vercel function dependencies and build scripts are never excluded from the upload', () => {
  const graph = functionGraph();
  assert.ok(graph.includes('server/account/handler.js'), 'the account function imports server/');
  for (const file of graph) {
    assert.match(file, /^(?:api|server)\//, `${file} is outside api/ and server/`);
    assert.equal(ignored(file), false, `${file} is required by the function`);
  }
  for (const file of ['scripts/build-toolkit.mjs', 'scripts/check-build.mjs', 'package.json', 'package-lock.json', 'vercel.json', 'index.html']) {
    assert.equal(ignored(file), false, `${file} is required by the build`);
  }
  for (const script of config.buildCommand.match(/npm run [\w:-]+/g)) {
    const name = script.slice('npm run '.length);
    const command = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts[name];
    for (const file of command.match(/scripts\/[\w./-]+/g) || []) assert.equal(ignored(file), false, `${file} runs in buildCommand`);
  }
});

test('source, tooling and repository files return 404 on the public site', () => {
  for (const path of ['/server/account/handler.js', '/server/integrations/bitget/http-handler.js', '/server/account/schema.sql', '/scripts/build-toolkit.mjs', '/scripts', '/docs/account/bitget-affiliate.md', '/tests/radar-gestures.test.mjs', '/supabase/migrations/x.sql', '/package.json', '/package-lock.json', '/vercel.json', '/README.md', '/.env.example', '/.github/workflows/update-news.yml', '/previews/crypto-flow.html', '/previews/crypto-replay-layout-check.html']) {
    assert.equal(blocked(path), true, `${path} must not be served`);
  }
});

test('every live page asset, data snapshot, admin page and API route stays reachable', () => {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="((?:src|assets|data)\/[^"?#]+)/g)].map(match => '/' + match[1]);
  assert.ok(refs.length > 50);
  const publicFiles = ['src', 'assets', 'data', 'previews/data', 'previews/account-admin']
    .flatMap(dir => readdirSync(resolve(root, dir), { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => '/' + relative(root, resolve(entry.parentPath ?? entry.path, entry.name)).replaceAll('\\', '/')));
  for (const path of ['/', '/index.html', '/ox-logo.png', '/manifest.webmanifest', '/previews/account-admin/', '/api/v1/account/session', '/api/v1/account/bitget-status', '/api/v1/account/bitget-admin-lookup', ...refs, ...publicFiles]) {
    assert.equal(blocked(path), false, `${path} must stay public`);
    assert.equal(ignored(path.slice(1)), false, `${path} must be uploaded`);
  }
});

const headersFor = path => Object.assign({}, ...preFilesystem.filter(route => route.headers && new RegExp(route.src).test(path)).map(route => route.headers));

test('security headers apply to every page and static asset', () => {
  for (const path of ['/', '/index.html', '/src/app/app.js', '/previews/account-admin/', '/data/news.json']) {
    const headers = headersFor(path);
    assert.equal(headers['X-Frame-Options'], 'DENY', path);
    assert.equal(headers['X-Content-Type-Options'], 'nosniff', path);
    assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin', path);
    assert.equal(headers['Strict-Transport-Security'], 'max-age=63072000; includeSubDomains', path);
    assert.match(headers['Permissions-Policy'], /camera=\(\)/);
    assert.doesNotMatch(headers['Permissions-Policy'], /fullscreen/, 'chart fullscreen must keep working');
    assert.equal(headers['Content-Security-Policy'], "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  }
  assert.ok(preFilesystem.filter(route => route.headers).every(route => route.continue === true), 'header routes must not stop routing');
});

test('the conservative CSP never restricts scripts, styles or exchange connections', () => {
  const csp = headersFor('/')['Content-Security-Policy'];
  assert.doesNotMatch(csp, /default-src|script-src|style-src|connect-src|img-src/);
});

test('API responses keep the stricter headers set by each function', () => {
  const headers = headersFor('/api/v1/account/bitget-status');
  assert.equal(headers['Content-Security-Policy'], undefined, 'operator page sets its own CSP');
  assert.equal(headers['Referrer-Policy'], undefined, 'operator page sets no-referrer');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
});
