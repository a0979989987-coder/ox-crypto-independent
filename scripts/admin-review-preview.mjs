import {initializeFeatureFixture} from './lib/feature-access-fixtures.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fixtureIDs } from './lib/admin-review-fixtures.mjs';
import { candidateFixtureDatabase,candidateService } from './lib/admin-review-candidate-fixtures.mjs';
import { createPreviewHTTP } from '../server/account/admin-review-preview-http.js';
if(process.env.VERCEL || process.env.NODE_ENV==='production') throw Error('Local preview only');
const port=Number(process.env.OX_REVIEW_PREVIEW_PORT||4199);
if(!Number.isInteger(port)||port<1024||port>65535) throw Error('Invalid preview port');
const ordinaryCapabilities=process.argv.includes('--ordinary-fixture')?['fixture_partial_feature']:[];
const origin=`http://127.0.0.1:${port}`,db=await candidateFixtureDatabase({ordinaryFixture:ordinaryCapabilities.length>0,seedAdmin:true});
await initializeFeatureFixture(db);
const api=createPreviewHTTP({db,origin,fixtureIDs,ordinaryCapabilities,serviceFactory:candidateService});
const files={'/':'index.html','/index.html':'index.html','/preview.js':'preview.js','/model.js':'model.js','/feature-admin.js':'feature-admin.js'};
const server=createServer(async(req,res)=>{
  if(req.url?.startsWith('/preview-api/')) return api(req,res);
  if(req.headers.host!==new URL(origin).host||req.method!=='GET') {res.writeHead(403);res.end();return;}
  const file=files[new URL(req.url,origin).pathname];if(!file){res.writeHead(404);res.end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
  res.end(await readFile(new URL('../previews/account-admin/'+file,import.meta.url)));
});
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic admin review preview: ${origin} (in-memory database, no production connection; ordinary policy: ${ordinaryCapabilities.length?'explicit synthetic fixture':'UNCONFIGURED'})`));
async function stop(){server.close();await db.close();process.exit(0);}process.on('SIGINT',stop);process.on('SIGTERM',stop);
