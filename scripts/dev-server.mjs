import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portFlag = process.argv.indexOf('--port');
const hostFlag = process.argv.indexOf('--host');
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : process.env.PORT) || 4173;
const host = hostFlag >= 0 ? process.argv[hostFlag + 1] : '0.0.0.0';
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname);
    const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    const rel = relative(root, file);
    if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Outside site root");
    if (rel.split(sep).some(part => part.startsWith('.'))) throw new Error("Private file");
    if (!(await stat(file)).isFile()) throw new Error("Not a file");
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    const body = await readFile(file);
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, host, () => console.log(`OX preview: http://127.0.0.1:${port}/`));
