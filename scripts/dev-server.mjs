// Local preview of the site as ChatGPT Sites runs it: static files first, then the Worker
// (API, /admin, /privacy, /terms and the data files) with a local D1 in .local/ox-dev.sqlite.
//   node scripts/dev-server.mjs [--port 4313] [--host 0.0.0.0]
//   OX_DEV_ADMIN=email      plays that owner signed in with ChatGPT, for /admin
//   OX_DEV_FAKE_GOOGLE=1    a fake Google sign-in for local tests (no real Google)
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from the shell enable real Google sign-in locally
//   OX_DEV_DB=path          another SQLite file (":memory:" for a throwaway one)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../worker/index.js";
import { localD1 } from "./local-d1.mjs";
import { platformHeaders, isWorkerOnly, fakeGoogle } from "./sites-platform.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portFlag = process.argv.indexOf('--port');
const hostFlag = process.argv.indexOf('--host');
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : process.env.PORT) || 4173;
const host = hostFlag >= 0 ? process.argv[hostFlag + 1] : '0.0.0.0';
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2" };

async function file(pathname) {
  const path = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`), rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.split(sep).some(part => part.startsWith('.'))) return null;
  try { if (!(await stat(path)).isFile()) return null; return { body: await readFile(path), type: types[extname(path)] || "application/octet-stream" }; } catch { return null; }
}
// The Worker's view of the client folder: on Sites the bundled data files sit under _seed/.
const ASSETS = { async fetch(request) {
  let pathname = new URL(typeof request === 'string' ? request : request.url).pathname;
  try { pathname = decodeURIComponent(pathname); } catch { return new Response('Not found', { status: 404 }); }
  if (pathname.startsWith('/_seed/')) pathname = pathname.slice(6);
  const found = await file(pathname);
  return found ? new Response(found.body, { headers: { 'Content-Type': found.type } }) : new Response('Not found', { status: 404 });
} };
const fake = process.env.OX_DEV_FAKE_GOOGLE === '1';
const env = {
  ASSETS, DB: localD1(process.env.OX_DEV_DB || resolve(root, '.local/ox-dev.sqlite')),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || (fake ? 'dev-fake-client.apps.googleusercontent.com' : undefined),
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || (fake ? 'dev-fake-secret' : undefined),
  OX_ADMIN_EMAILS: process.env.OX_ADMIN_EMAILS,
  BITGET_AFFILIATE_API_KEY: process.env.BITGET_AFFILIATE_API_KEY, BITGET_AFFILIATE_SECRET_KEY: process.env.BITGET_AFFILIATE_SECRET_KEY,
  BITGET_AFFILIATE_PASSPHRASE: process.env.BITGET_AFFILIATE_PASSPHRASE, BITGET_AFFILIATE_REFERRAL_CODE: process.env.BITGET_AFFILIATE_REFERRAL_CODE
};
const google = fake ? fakeGoogle({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }) : null;
if (google) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => String(input?.url || input).startsWith('https://oauth2.googleapis.com/token') ? Promise.resolve(google.token(init)) : realFetch(input, init);
}

async function respond(request, origin) {
  const url = new URL(request.url, origin);
  let pathname = url.pathname; try { pathname = decodeURIComponent(pathname); } catch {}
  if (google && pathname.startsWith('/__dev/google')) return google.page(url);
  // ChatGPT sign-in for the owner's /admin, played by OX_DEV_ADMIN.
  if (pathname === '/signin-with-chatgpt' || pathname === '/signout-with-chatgpt') {
    const back = url.searchParams.get('return_to') || '/';
    if (process.env.OX_DEV_ADMIN && pathname === '/signin-with-chatgpt') return Response.redirect(new URL(back.startsWith('/') && !back.startsWith('//') ? back : '/', origin), 302);
    return new Response('本機預覽：用 OX_DEV_ADMIN=你的 Email 啟動，就會以那個帳號登入 /admin。', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (['GET', 'HEAD'].includes(request.method) && !isWorkerOnly(pathname)) {
    const found = await file(pathname);
    if (found) return new Response(request.method === 'HEAD' ? null : found.body, { headers: { 'Content-Type': found.type } });
  }
  const chunks = []; if (!['GET', 'HEAD'].includes(request.method)) for await (const chunk of request) chunks.push(chunk);
  const workerRequest = new Request(url, { method: request.method, headers: platformHeaders(request.headers, { devAdmin: process.env.OX_DEV_ADMIN }), ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
  const answer = await worker.fetch(workerRequest, env, {});
  if (google && answer.headers.get('location')) {
    const headers = new Headers(answer.headers); headers.set('location', google.rewriteLocation(answer.headers.get('location'), origin));
    return new Response(answer.body, { status: answer.status, headers });
  }
  return answer;
}

createServer(async (request, response) => {
  try {
    const origin = `http://${request.headers.host || `127.0.0.1:${port}`}`;
    const answer = await respond(request, origin);
    const headers = {}; answer.headers.forEach((value, name) => { headers[name] = name === 'set-cookie' ? answer.headers.getSetCookie() : value; });
    response.writeHead(answer.status, headers);
    response.end(Buffer.from(await answer.arrayBuffer()));
  } catch (error) {
    console.error(error?.message);
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Unavailable');
  }
}).listen(port, host, () => console.log(`OX preview: http://127.0.0.1:${port}/${process.env.OX_DEV_ADMIN ? ' (admin ' + process.env.OX_DEV_ADMIN + ')' : ''}${fake ? ' (fake Google sign-in)' : ''}`));
