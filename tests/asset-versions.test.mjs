import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, write, collect } from '../scripts/asset-versions.mjs';

test('every file the site loads with ?v= has a new token whenever its content changed, and the page mark is current', async () => {
  const { problems, files } = await check();
  assert.deepEqual(problems, []);
  assert.ok(files.size > 100, 'the stylesheets, scripts and tool bundles are all covered');
  for (const path of ['src/styles/core/tokens.css', 'src/styles/components/refine.css', 'src/generated/runtime.js', 'src/generated/tool-news.js', 'src/generated/tool-patterns.js', 'src/app/fresh-html.js'])
    assert.ok(files.has(path), path);
});

test('a changed file that keeps its ?v= is caught; a new token is accepted and recorded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ox-versions-'));
  try {
    await mkdir(join(root, 'src/app'), { recursive: true });
    await mkdir(join(root, 'docs'));
    const page = v => `<!doctype html><meta name="ox-build" content=""><link rel="stylesheet" href="src/app/a.css?v=${v}"><script src="src/app/boot.js?v=1"></script>`;
    await writeFile(join(root, 'index.html'), page('1'));
    await writeFile(join(root, 'src/app/a.css'), 'a{color:red}\r\n');
    // A dynamic import is fetched by the browser; a static import in a bundled file is not.
    await writeFile(join(root, 'src/app/boot.js'), "import('./b.js?v=7');\n");
    await writeFile(join(root, 'src/app/b.js'), "import x from './c.js?v=old';\nexport default x;\n");
    await writeFile(join(root, 'src/app/c.js'), 'export default 1;\n');
    const { refs } = await collect(root);
    assert.deepEqual(refs.map(r => `${r.path}?v=${r.token}`).sort(), ['src/app/a.css?v=1', 'src/app/b.js?v=7', 'src/app/boot.js?v=1']);
    assert.equal((await write({ root })).written, true);
    assert.deepEqual((await check({ root })).problems, []);
    assert.match(await readFile(join(root, 'index.html'), 'utf8'), /<meta name="ox-build" content="[0-9a-f]{16}">/);
    // Line endings alone are not a change.
    await writeFile(join(root, 'src/app/a.css'), 'a{color:red}\n');
    assert.deepEqual((await check({ root })).problems, []);
    // New content, same token: caught in the build check too, and --write refuses.
    await writeFile(join(root, 'src/app/a.css'), 'a{color:blue}\n');
    const caught = (await check({ root, strict: false })).problems;
    assert.equal(caught.length, 1);
    assert.match(caught[0], /src\/app\/a\.css changed but is still asked for as \?v=1 \(index\.html:1\)/);
    assert.equal((await write({ root })).written, false);
    // A new token: the build check passes once the page mark follows; npm test wants it recorded.
    await writeFile(join(root, 'index.html'), (await readFile(join(root, 'index.html'), 'utf8')).replace('a.css?v=1', 'a.css?v=2'));
    const lenient = (await check({ root, strict: false })).problems;
    assert.equal(lenient.length, 1); assert.match(lenient[0], /ox-build/);
    assert.ok((await check({ root })).problems.some(p => /new content and a new \?v=/.test(p)));
    assert.equal((await write({ root })).written, true);
    assert.deepEqual((await check({ root })).problems, []);
    // A token naming no file is an error.
    await writeFile(join(root, 'src/app/boot.js'), "import('./missing.js?v=1');\n");
    assert.ok((await check({ root, strict: false })).problems.some(p => /missing\.js\?v=1, which is not a file/.test(p)));
  } finally { await rm(root, { recursive: true, force: true }); }
});
