import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('docs/crypto-source-parity.json', root), 'utf8'));
const reviewed=JSON.parse(await readFile(new URL('performance-reviewed-changes.json',new URL('docs/',root)),'utf8'));
for(const item of reviewed.files)assert.equal(manifest.unchangedFiles.find(f=>f.path===item.path)?.sha256,item.sourceSha256,'Reviewed change must name its original digest');
for (const file of manifest.unchangedFiles) {
  const change=reviewed.files.find(f=>f.path===file.path);
  if(change?.deleted){await assert.rejects(access(new URL(file.path,root)),{code:'ENOENT'});continue;}
  const content = await readFile(new URL(file.path, root));
  assert.equal(createHash('sha256').update(content).digest('hex'), change?.sha256||file.sha256, `${file.path} differs from source baseline`);
}
for (const path of ['src/markets/tw', 'server/markets/tw', 'api/v1/tw', 'data/tw-patterns', 'data/tw-etf']) {
  await assert.rejects(access(new URL(path, root)), { code: 'ENOENT' });
}
console.log(`Verified ${manifest.unchangedFiles.length} extraction files (${reviewed.files.length} explicitly reviewed performance changes) from ${manifest.sourceCommit}; Taiwan modules absent.`);
