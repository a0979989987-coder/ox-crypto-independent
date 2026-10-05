import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const read = path => readFile(resolve(root, path), 'utf8');
const css = await read('src/markets/crypto/analytics/flow.css');
const [snapshot, market, liquidations] = await Promise.all(['crypto-flow','crypto-tools','crypto-liquidations'].map(async f=>JSON.parse(await read(`previews/data/${f}-snapshot.json`))));
const modules=['flow-model.js','tools-model.js','flow-source.js','market-live.js','flow-chart.js','tools-charts.js','flow-view.js'];
const sources = await Promise.all(modules.map(f => read('src/markets/crypto/analytics/' + f)));
const combined = sources.map(s => s.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''))
  .join('\n').replace(/^const (snapshotURL|marketURL|liquidationURL|cssURL)\s*=.*;$/gm, 'const $1 = null;')
  .replace('<link rel="stylesheet" href="${cssURL.href}">', '<style>${PREVIEW_CSS}</style>');
let html = await read('previews/crypto-flow.html');
html = html.replace('<a href="../index.html">返回 OX</a>', '');
const bootstrap = `const PREVIEW_CSS=${JSON.stringify(css)};\n${combined}\nconst recorded=${JSON.stringify(snapshot)},marketRecorded=${JSON.stringify(market)},liquidationRecorded=${JSON.stringify(liquidations)};\nconst host=document.getElementById('crypto-flow'),exit=document.getElementById('exit-screen');let controller;function open(){exit.hidden=true;host.hidden=false;controller=mountCryptoFlow(host,{snapshot:recorded,marketSnapshot:marketRecorded,liquidationSnapshot:liquidationRecorded,onExit(){controller?.destroy();host.hidden=true;exit.hidden=false;document.getElementById('reopen').focus();}});}document.getElementById('reopen').addEventListener('click',open);open();`;
html = html.replace(/<script type="module">[\s\S]*?<\/script>/, '<script type="module">' + bootstrap.replaceAll('</script', '<\\/script') + '</script>');
const destination = resolve(process.argv[2] || '/workspace/scratch/6827c8da6e73/crypto-flow-review/OX-Crypto-Flow.html');
await writeFile(destination, html);
console.log(destination);
