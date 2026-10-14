// POST /api/rpc: a small Solana JSON-RPC proxy for the website's live mode.
// Browsers get 403 from the public mainnet RPC, so the page reads the bonding curve through here.
// Only getAccountInfo with a base58 address is forwarded. Body capped, 8s timeout per upstream,
// identical requests cached in memory for 15s. SOLANA_RPC_URL (optional) is tried first.

export const ALLOWED_METHODS = Object.freeze(['getAccountInfo']);
export const MAX_BODY = 2048;
export const TIMEOUT_MS = 8000;
export const CACHE_MS = 15000;
const PUBLIC_UPSTREAMS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'];

export function upstreams(env = process.env) {
  const list = env.SOLANA_RPC_URL ? [env.SOLANA_RPC_URL, ...PUBLIC_UPSTREAMS] : [...PUBLIC_UPSTREAMS];
  return [...new Set(list)];
}

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Validate a JSON-RPC request. Returns { error } or { method, params }. */
export function checkRequest(msg) {
  if (Array.isArray(msg)) return { error: 'batch requests are not supported' };
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return { error: 'expected a JSON-RPC 2.0 request' };
  if (!ALLOWED_METHODS.includes(msg.method)) return { error: `method not allowed, this proxy only serves: ${ALLOWED_METHODS.join(', ')}` };
  const params = msg.params;
  if (!Array.isArray(params) || params.length < 1 || params.length > 2 || typeof params[0] !== 'string' || !ADDRESS.test(params[0])) {
    return { error: 'params must be [address, config]' };
  }
  const cfg = params[1] ?? {};
  if (typeof cfg !== 'object' || Array.isArray(cfg)) return { error: 'config must be an object' };
  const clean = {};
  if (cfg.encoding !== undefined) {
    if (cfg.encoding !== 'base64') return { error: 'only base64 encoding is allowed' };
    clean.encoding = 'base64';
  }
  if (cfg.commitment !== undefined) {
    if (!['processed', 'confirmed', 'finalized'].includes(cfg.commitment)) return { error: 'bad commitment' };
    clean.commitment = cfg.commitment;
  }
  return { method: msg.method, params: [params[0], clean] };
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body;
    if (req.body instanceof Uint8Array) return Buffer.from(req.body).toString('utf8');
    return JSON.stringify(req.body);
  }
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res, status, obj, cache = 'no-store') {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', cache);
  res.end(JSON.stringify(obj));
}

/**
 * Build a handler. Options for tests: { upstreams: [...], fetchImpl, now, timeoutMs }.
 * The default export uses process.env and global fetch.
 */
export function createRpcHandler(opts = {}) {
  const cache = new Map();
  const fetchImpl = opts.fetchImpl || ((...a) => globalThis.fetch(...a));
  const now = opts.now || Date.now;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  async function forward(url, payload) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, signal: ctl.signal });
      if (!r.ok) return { fail: r.status };
      const j = await r.json();
      if (j && j.error && (j.error.code === 429 || j.error.code === -32429 || /rate|too many/i.test(j.error.message || ''))) return { fail: 429 };
      if (!j || (j.result === undefined && !j.error)) return { fail: 502 };
      return { body: j };
    } catch {
      return { fail: 504 };
    } finally {
      clearTimeout(t);
    }
  }

  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      return send(res, 405, { error: 'POST a JSON-RPC getAccountInfo request' });
    }
    const len = Number(req.headers?.['content-length'] || 0);
    if (len > MAX_BODY) return send(res, 413, { error: 'request body too large' });
    const raw = await readBody(req);
    if (raw === null || raw.length > MAX_BODY) return send(res, 413, { error: 'request body too large' });
    let msg;
    try { msg = JSON.parse(raw); } catch { return send(res, 400, { error: 'body is not JSON' }); }
    const check = checkRequest(msg);
    if (check.error) return send(res, 400, { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32601, message: check.error } });

    const key = JSON.stringify([check.method, check.params]);
    const hit = cache.get(key);
    const id = msg.id ?? 1;
    if (hit && now() - hit.at < CACHE_MS) {
      res.setHeader('x-ramp-cache', 'hit');
      return send(res, 200, { ...hit.body, id }, 'private, max-age=5');
    }
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: check.method, params: check.params });
    let lastFail = 502;
    for (const url of opts.upstreams || upstreams()) {
      const r = await forward(url, payload);
      if (r.body) {
        if (!r.body.error) {
          if (cache.size > 500) cache.clear();
          cache.set(key, { at: now(), body: r.body });
        }
        res.setHeader('x-ramp-cache', 'miss');
        return send(res, 200, { ...r.body, id }, 'private, max-age=5');
      }
      lastFail = r.fail === 429 || lastFail === 429 ? 429 : r.fail;
    }
    const message = lastFail === 429 ? 'every Solana RPC we tried is rate limited, try again in a few seconds' : 'could not reach a Solana RPC, try again in a moment';
    return send(res, lastFail === 429 ? 429 : 502, { jsonrpc: '2.0', id, error: { code: lastFail === 429 ? 429 : -32000, message } });
  };
}

export default createRpcHandler();
