import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url));
const html = read('index.html').toString();
const pngSize = path => { const b = read(path); assert.equal(b.toString('ascii', 1, 4), 'PNG', path); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('the web app manifest names OX and points at real square icons', () => {
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.name, 'OX 篩選器');
  assert.equal(manifest.short_name, 'OX');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.equal(manifest.start_url, '/');
  const sizes = new Set();
  for (const icon of manifest.icons) {
    const [w, h] = pngSize(icon.src);
    assert.equal(`${w}x${h}`, icon.sizes, icon.src);
    sizes.add(icon.sizes);
  }
  assert.ok(sizes.has('192x192') && sizes.has('512x512'));
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
});

test('home-screen and share previews are declared', () => {
  const apple = html.match(/<link rel="apple-touch-icon" href="([^"]+)">/)[1];
  assert.deepEqual(pngSize(apple), [180, 180]);
  for (const tag of ['og:title', 'og:description', 'og:image', 'og:type']) assert.match(html, new RegExp(`<meta property="${tag}" content="[^"]+">`), tag);
  for (const tag of ['twitter:card', 'twitter:title', 'twitter:image']) assert.match(html, new RegExp(`<meta name="${tag}" content="[^"]+">`), tag);
  // Link-preview crawlers need absolute URLs for the page and its image.
  assert.match(html, /<meta property="og:url" content="https:\/\/ox-crypto-independent\.vercel\.app\/">/);
  for (const tag of ['property="og:image"', 'name="twitter:image"']) assert.match(html, new RegExp(`<meta ${tag} content="https://ox-crypto-independent\\.vercel\\.app/assets/ox-icon-512\\.png">`), tag);
  assert.match(html, /<meta name="theme-color" content="#[0-9a-f]{6}">/i, 'theme-color starts with the default theme; theme-boot.js keeps it in step');
});

test('no service worker is registered (this round has no offline cache)', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).filter(f => /\.js$/.test(f) && !String(f).startsWith('generated'));
  for (const file of files) assert.doesNotMatch(read('src/' + file).toString(), /serviceWorker\s*\.\s*register/, String(file));
  assert.doesNotMatch(html, /serviceWorker/);
});
