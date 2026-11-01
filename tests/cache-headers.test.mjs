import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import worker, { cacheRule, PAGE_CACHE, VERSIONED_CACHE } from '../worker/index.js';
import { localD1 } from '../scripts/local-d1.mjs';
import { SITE_HEADERS } from '../scripts/build-sites.mjs';

const root = new URL('../', import.meta.url);
const vercel = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));
const cacheOf = rule => rule.headers.find(h => h.key.toLowerCase() === 'cache-control')?.value;
const PAGES = ['/', '/index.html', '/admin.html', '/privacy.html', '/terms.html', '/manifest.webmanifest'];

test('Vercel: every page is checked with the server on each visit; only ?v= files are kept for a year', () => {
  for (const path of PAGES) {
    const rule = vercel.headers.find(r => r.source === path);
    assert.ok(rule, `${path} has its own cache rule`);
    assert.match(cacheOf(rule), /no-cache/, path);
    assert.doesNotMatch(cacheOf(rule), /max-age=[1-9]|immutable/, path);
  }
  const long = vercel.headers.filter(r => /max-age=[1-9]|immutable/.test(cacheOf(r) || ''));
  assert.equal(long.length, 1, 'one long-cache rule');
  assert.equal(long[0].source, '/(src|assets)/(.*)', 'only the versioned asset folders');
  assert.deepEqual(long[0].has, [{ type: 'query', key: 'v' }], 'and only when the address carries ?v=');
  assert.equal(cacheOf(long[0]), 'public, max-age=31536000, immutable');
  const security = vercel.headers.find(r => r.source === '/(.*)');
  assert.deepEqual(security.headers.map(h => h.key).sort(), ['Permissions-Policy', 'Referrer-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options']);
  assert.equal(cacheOf(security), undefined, 'the catch-all rule never sets caching');
});

test('Sites: the Worker serves pages fresh and ?v= files for a year; _headers covers the static pages', async () => {
  const at = path => new URL('https://crypto.oxpattern.com' + path);
  const ok = type => new Response('x', { headers: { 'Content-Type': type } });
  assert.equal(cacheRule(at('/'), ok('text/html; charset=utf-8')), PAGE_CACHE);
  assert.equal(cacheRule(at('/index.html'), ok('text/html')), PAGE_CACHE);
  assert.equal(cacheRule(at('/src/styles/components/refine.css?v=20261101-v7'), ok('text/css')), VERSIONED_CACHE);
  assert.equal(cacheRule(at('/src/styles/components/refine.css'), ok('text/css')), null, 'no version, no long cache');
  assert.equal(cacheRule(at('/data/news.json?v=1'), ok('application/json')), null, 'data follows its own release');
  assert.equal(cacheRule(at('/src/app/x.js?v=1'), new Response('', { status: 404 })), null);
  const files = { '/index.html': ['<!doctype html><meta name="ox-build" content="abc">', 'text/html; charset=utf-8'], '/src/app/fresh-html.js': ['//', 'text/javascript'] };
  const ASSETS = { async fetch(request) { const path = new URL(request.url).pathname, file = files[path === '/' ? '/index.html' : path]; return file ? new Response(file[0], { headers: { 'Content-Type': file[1], 'Cache-Control': 'public, max-age=0, must-revalidate' } }) : new Response('missing', { status: 404 }); } };
  const env = { DB: localD1(':memory:'), ASSETS };
  const home = await worker.fetch(new Request('https://crypto.oxpattern.com/'), env, {});
  assert.equal(home.headers.get('Cache-Control'), PAGE_CACHE);
  assert.equal(home.headers.get('X-Content-Type-Options'), 'nosniff', 'security headers stay');
  const script = await worker.fetch(new Request('https://crypto.oxpattern.com/src/app/fresh-html.js?v=20261101-v7'), env, {});
  assert.equal(script.headers.get('Cache-Control'), VERSIONED_CACHE);
  for (const path of PAGES) assert.match(SITE_HEADERS, new RegExp(`^${path.replace(/\./g, '\\.')}\\n  Cache-Control: no-cache, must-revalidate$`, 'm'), path);
});

test('index.html carries its build mark and asks for the fresh-page check before any other script', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /<meta name="ox-build" content="[0-9a-f]{16}">/);
  const first = /<script\b[^>]*>/.exec(head)[0];
  assert.match(first, /src="src\/app\/fresh-html\.js\?v=[\w.-]+" async/);
  assert.ok(head.indexOf('name="ox-build"') < head.indexOf('src="src/app/fresh-html.js'), 'the mark is there before the check reads it');
});

// A small stand-in for the browser around src/app/fresh-html.js.
async function runFresh({ mine, live, tried = null, ok = true }) {
  const code = await readFile(new URL('src/app/fresh-html.js', root), 'utf8');
  const store = new Map(tried ? [['ox-build-reload', tried]] : []);
  let reloads = 0, fetched = null;
  const ctx = {
    document: { querySelector: () => (mine == null ? null : { content: mine }), addEventListener() {}, hidden: false },
    location: { protocol: 'https:', pathname: '/', reload: () => reloads++ },
    sessionStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    addEventListener() {},
    fetch: async (url, options) => { fetched = { url, options }; return { ok, text: async () => `<!doctype html><meta name="ox-build" content="${live}">` }; }
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(code, ctx);
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  return { reloads, fetched, store };
}

test('fresh-page check: an old page reloads once, the current page and a failed check do nothing', async () => {
  const stale = await runFresh({ mine: 'aaaa', live: 'bbbb' });
  assert.equal(stale.reloads, 1);
  assert.equal(stale.fetched.url, '/');
  assert.equal(stale.fetched.options.cache, 'no-cache', 'past the browser cache');
  assert.equal(stale.store.get('ox-build-reload'), 'bbbb');
  assert.equal((await runFresh({ mine: null, live: 'bbbb' })).reloads, 1, 'a page from before the mark existed reloads too');
  assert.equal((await runFresh({ mine: 'bbbb', live: 'bbbb', tried: 'bbbb' })).reloads, 0);
  assert.equal((await runFresh({ mine: 'aaaa', live: 'bbbb', tried: 'bbbb' })).reloads, 0, 'no reload loop when the browser keeps handing back the old page');
  assert.equal((await runFresh({ mine: 'aaaa', live: 'bbbb', ok: false })).reloads, 0);
});
