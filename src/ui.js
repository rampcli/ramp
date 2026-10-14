// `ramp ui`: local dashboard over node:http with a small JSON API.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { CurveError } from './math.js';
import { api, makeCurve, liveSummary } from './core.js';
import { buildDashboard, FONT_FILES } from './web.js';
import { VERSION } from './cli.js';

const FONTS = new Set(FONT_FILES);
const num = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v));
const int = (v) => (v === null || v === undefined || v === '' ? undefined : Number.parseInt(v, 10));

/** Routes for the JSON API. `q` is URLSearchParams. Exported for tests. */
export function apiRoute(path, q, base) {
  const opts = { ...base, params: { ...base.params, ...(q.get('fee') !== null ? { fee: q.get('fee') } : {}) }, fromRaised: num(q.get('raised')), solPrice: num(q.get('solPrice')) ?? base.solPrice };
  switch (path) {
    case '/api/health': return { ok: true, name: 'ramp', version: VERSION };
    case '/api/state': return api.state(opts);
    case '/api/quote': return q.get('side') === 'sell' ? api.quoteSell({ ...opts, tokens: q.get('amount') }) : api.quoteBuy({ ...opts, sol: q.get('amount') ?? q.get('sol') });
    case '/api/plan': return api.planDevBuy({ ...opts, ownPct: num(q.get('own')), targetMcap: num(q.get('targetMcap')), budget: num(q.get('budget')) });
    case '/api/bundle': return api.bundle({ ...opts, wallets: int(q.get('wallets')), each: num(q.get('each')), gapSol: num(q.get('gap')) });
    case '/api/simulate': {
      const sniperSol = q.get('sniperSol') ? q.get('sniperSol').split(',').map(Number) : undefined;
      return api.simulate({
        ...opts,
        samples: true,
        sim: {
          runs: int(q.get('runs')), snipers: int(q.get('snipers')), sniperSol, devBuy: num(q.get('devBuy')), maxTrades: int(q.get('maxTrades')),
          within: int(q.get('within')), sellRatio: num(q.get('sellRatio')), seed: q.get('seed') || undefined,
        },
      });
    }
    default: return undefined;
  }
}

export async function startUi({ port = 4178, host = '127.0.0.1', curveOpts = {}, solPrice } = {}) {
  const base = { ...curveOpts, solPrice };
  const curve = makeCurve(base); // validates parameters before serving
  const source = curveOpts.live ? `live ${liveSummary(curveOpts.live).address}` : `preset ${curveOpts.preset || (curveOpts.configPath || curveOpts.config ? 'custom' : 'pumpfun')}`;
  const page = () => buildDashboard({
    version: VERSION,
    boot: {
      params: curve.params, solPrice: solPrice ?? 150, source,
      raised: curveOpts.live ? Math.min(curve.state().solRaised, 85) : 0,
      sim: api.simulate({ ...base, samples: true, sim: { runs: 200 } }),
    },
  });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, type, body) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(body);
    };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'application/json', JSON.stringify({ error: 'method not allowed' }));
      if (url.pathname === '/' || url.pathname === '/index.html') return send(200, 'text/html; charset=utf-8', page());
      if (url.pathname.startsWith('/fonts/')) {
        const name = url.pathname.slice(7);
        if (!FONTS.has(name)) return send(404, 'text/plain', 'not found');
        try { return send(200, 'font/woff2', await readFile(new URL(`../assets/fonts/${name}`, import.meta.url))); } catch { return send(404, 'text/plain', 'font not bundled'); }
      }
      if (url.pathname.startsWith('/api/')) {
        const result = apiRoute(url.pathname, url.searchParams, base);
        if (result === undefined) return send(404, 'application/json', JSON.stringify({ error: 'unknown endpoint' }));
        return send(200, 'application/json', JSON.stringify(result));
      }
      return send(404, 'text/plain', 'not found');
    } catch (err) {
      if (err instanceof CurveError) return send(400, 'application/json', JSON.stringify({ error: err.message }));
      process.stderr.write(`ramp ui: ${err.stack}\n`);
      return send(500, 'application/json', JSON.stringify({ error: 'internal error' }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const addr = server.address();
  return { server, url: `http://${host}:${addr.port}/` };
}
