import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('docs/crypto-source-parity.json', root), 'utf8'));
for (const file of manifest.unchangedFiles) {
  const content = await readFile(new URL(file.path, root));
  assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256, `${file.path} differs from source baseline`);
}
for (const path of ['src/markets/tw', 'server/markets/tw', 'api/v1/tw', 'data/tw-patterns', 'data/tw-etf']) {
  await assert.rejects(access(new URL(path, root)), { code: 'ENOENT' });
}
console.log(`Preserved ${manifest.unchangedFiles.length} original crypto/chart/account files from ${manifest.sourceCommit}; Taiwan modules absent.`);
