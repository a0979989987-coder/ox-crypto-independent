// Reproducible, atomic tool graph: a nested matcher/catalog fetch cannot poison
// Safari's module map. Crypto resources stay shared with the shell.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const entries=['crypto/patterns/view.js','crypto/bubbles/view.js','crypto/analytics/flow-view.js'];
const contents="import './src/app/app.js';\nimport './src/markets/crypto/analytics/entry.js';\n"+entries.map((p,i)=>`import * as m${i} from './src/markets/${p}';`).join('\n')+`\nexport const tools={${entries.map((p,i)=>`${JSON.stringify('/src/markets/'+p)}:m${i}`).join(',')}};`;
await mkdir(resolve(root,'src/generated'),{recursive:true});
await build({entryPoints:[resolve(root,'src/markets/crypto/patterns/worker.js')],bundle:true,format:'esm',platform:'browser',minify:true,legalComments:'eof',outfile:resolve(root,'src/generated/pattern-worker.js'),plugins:[{name:'worker-versioned-imports',setup(b){b.onResolve({filter:/^\./},args=>({path:resolve(args.resolveDir,args.path.split('?')[0])}));}}]});
await build({stdin:{contents,resolveDir:root,sourcefile:'toolkit-entry.js',loader:'js'},bundle:true,format:'iife',globalName:'OXRuntimeBundle',platform:'browser',minify:true,legalComments:'eof',outfile:resolve(root,'src/generated/runtime.js'),plugins:[{name:'original-module-urls',setup(b){
 b.onResolve({filter:/^\./},args=>{const file=resolve(args.resolveDir,args.path.split('?')[0]);return {path:file};});
 b.onLoad({filter:/\.js$/},async args=>({contents:(await readFile(args.path,'utf8')).replaceAll('import.meta.url',`new URL(${JSON.stringify('/'+relative(root,args.path).replaceAll('\\','/'))},location.href).href`),loader:'js',resolveDir:dirname(args.path)}));
}}]});
const output=resolve(root,'src/generated/runtime.js');
const code=await readFile(output,'utf8');
await writeFile(output,"if(globalThis.OXRuntimeError)throw globalThis.OXRuntimeError;\nif(!globalThis.OXRuntimeInitialized){globalThis.OXRuntimeInitialized=true;try{\n"+code+"\nglobalThis.OXToolModules=OXRuntimeBundle.tools;}catch(error){globalThis.OXRuntimeError=error;throw error;}}\n");
console.log('Built atomic runtime and toolkit');
