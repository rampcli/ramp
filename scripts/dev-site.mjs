// Local copy of the Vercel deployment: serves docs/ and routes /api/<name> to the default export
// of api/<name>.js, the way Vercel does. Usage:
//   node scripts/dev-site.mjs [--port 4179] [--mock]
// --mock starts fixtures/mock-site.js and points /api/rpc at it; open the printed URL (it carries
// ?dex=... so DexScreener calls go to the mock too). Without --mock the real upstreams are used.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRpcHandler } from '../api/rpc.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const docs = join(root, 'docs');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

/** Load api/*.js default exports. `overrides` maps name -> handler (tests use it to inject upstreams). */
export async function loadHandlers(overrides = {}) {
  const out = {};
  for (const f of await readdir(join(root, 'api'))) {
    if (!f.endsWith('.js')) continue;
    out[f.slice(0, -3)] = (await import(pathToFileURL(join(root, 'api', f)).href)).default;
  }
  return { ...out, ...overrides };
}

export async function startDevSite({ port = 4179, host = '127.0.0.1', rpcUpstreams } = {}) {
  const handlers = await loadHandlers(rpcUpstreams ? { rpc: createRpcHandler({ upstreams: rpcUpstreams }) } : {});
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      const api = url.pathname.match(/^\/api\/([\w-]+)\/?$/);
      if (api) {
        const h = handlers[api[1]];
        if (!h) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"no such function"}'); }
        req.query = Object.fromEntries(url.searchParams);
        return await h(req, res);
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = normalize(join(docs, rel));
      if (!file.startsWith(docs + sep)) { res.writeHead(404); return res.end('not found'); }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch (err) {
      if (!res.headersSent) res.writeHead(err.code === 'ENOENT' || err.code === 'EISDIR' ? 404 : 500, { 'content-type': 'text/plain' });
      res.end(err.code === 'ENOENT' || err.code === 'EISDIR' ? 'not found' : String(err.message));
    }
  });
  await new Promise((r) => server.listen(port, host, r));
  const url = `http://${host}:${server.address().port}`;
  return { server, url, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
  let mock = null;
  if (process.argv.includes('--mock')) {
    const { startMockSite } = await import('../fixtures/mock-site.js');
    mock = await startMockSite();
  }
  const site = await startDevSite({ port: Number(arg('--port', 4179)), rpcUpstreams: mock ? [mock.rpcUrl] : undefined });
  console.log(`ramp site on ${site.url}/${mock ? `?dex=${encodeURIComponent(mock.dexUrl)}` : ''}`);
}
