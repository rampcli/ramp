// MCP server over stdio: JSON-RPC 2.0, one JSON message per line. Logs go to stderr only.
import { createInterface } from 'node:readline';
import { CurveError, PARAM_KEYS } from './math.js';
import { api, makeCurve, fetchLive, liveSummary } from './core.js';
import { VERSION } from './cli.js';

const PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'];

const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const CURVE_PROPS = {
  preset: { type: 'string', enum: ['pumpfun', 'custom'], description: 'Parameter preset. "custom" uses the config object.' },
  config: {
    type: 'object', description: 'Curve parameters for preset "custom".',
    properties: Object.fromEntries(PARAM_KEYS.map((k) => [k, { type: 'number' }])), additionalProperties: false,
  },
  virtualSol: num('Initial virtual SOL reserves (default 30)'),
  virtualTokens: num('Initial virtual token reserves (default 1,073,000,000)'),
  curveTokens: num('Tokens sold on the curve before graduation (default 793,100,000)'),
  supply: num('Total token supply (default 1,000,000,000)'),
  fee: num('Trading fee in percent (default 1)'),
  fromRaised: num('Start from a curve that already holds this much net SOL', { minimum: 0 }),
  solPrice: num('SOL price in USD, adds USD fields', { exclusiveMinimum: 0 }),
};

export const TOOLS = [
  {
    name: 'curve_state',
    description: 'Price, market cap, curve progress, SOL left to graduate and graduation market cap of a bonding curve. With mint or curve (and rpc or RAMP_RPC_URL) it reads the live Pump.fun account.',
    inputSchema: { type: 'object', properties: { ...CURVE_PROPS, mint: { type: 'string', description: 'Token mint (live mode)' }, curve: { type: 'string', description: 'Bonding curve account (live mode)' }, rpc: { type: 'string', description: 'Solana RPC URL (live mode)' } } },
  },
  {
    name: 'quote_buy',
    description: 'Exact result of buying with a SOL amount (fee included): tokens out, share of supply, average price, price impact, market cap before and after.',
    inputSchema: { type: 'object', properties: { sol: num('SOL to spend, fee included', { exclusiveMinimum: 0 }), ...CURVE_PROPS }, required: ['sol'] },
  },
  {
    name: 'quote_sell',
    description: 'Exact SOL returned (after fee) for selling a token amount. Needs fromRaised > 0 so there is SOL in the curve.',
    inputSchema: { type: 'object', properties: { tokens: num('Tokens to sell', { exclusiveMinimum: 0 }), ...CURVE_PROPS }, required: ['tokens', 'fromRaised'] },
  },
  {
    name: 'plan_dev_buy',
    description: 'Dev-buy planner. Give exactly one of: ownPct (SOL needed to own that % of supply), targetMcap (net SOL raised needed to reach a market cap; USD when solPrice is set, else SOL), budget (what that SOL buys at launch vs later points).',
    inputSchema: {
      type: 'object',
      properties: {
        ownPct: num('Target share of total supply in percent', { exclusiveMinimum: 0, maximum: 100 }),
        targetMcap: num('Target market cap (USD with solPrice, else SOL)', { exclusiveMinimum: 0 }),
        budget: num('SOL budget to compare across the curve', { exclusiveMinimum: 0 }),
        at: { type: 'array', items: { type: 'number', minimum: 0 }, description: 'Points (net SOL raised) for budget mode, default [0,20,40,60]' },
        ...CURVE_PROPS,
      },
    },
  },
  {
    name: 'simulate_launch',
    description: 'Seeded Monte Carlo of a launch: dev buy and snipers in the first slot, then random organic buys and sells. Returns graduation probability, trades to graduate, sniper, dev and top 10 holder share distributions. Deterministic for a seed.',
    inputSchema: {
      type: 'object',
      properties: {
        runs: { type: 'integer', minimum: 1, maximum: 20000, description: 'Number of simulated launches (default 200)' },
        snipers: { type: 'integer', minimum: 0, description: 'Sniper wallets in the launch slot (default 5)' },
        sniperSol: { type: 'array', items: { type: 'number', exclusiveMinimum: 0 }, description: 'Sniper buy sizes in SOL, cycled (default [1])' },
        devBuy: num('Dev buy in SOL at creation (default 1)', { minimum: 0 }),
        maxTrades: { type: 'integer', minimum: 1, description: 'Organic trades per run (default 1000)' },
        within: { type: 'integer', minimum: 1, description: 'Report P(graduate within N trades) (default 500)' },
        minBuy: num('Smallest organic buy in SOL (default 0.05)'),
        maxBuy: num('Largest organic buy in SOL (default 3)'),
        sellRatio: num('Average share of trades that are sells (default 0.35)'),
        sellJitter: num('Per-run spread of the sell share (default 0.15)'),
        seed: { type: ['integer', 'string'], description: 'PRNG seed (default 1)' },
        ...CURVE_PROPS,
      },
    },
  },
];

const SIM_KEYS = ['runs', 'snipers', 'sniperSol', 'devBuy', 'maxTrades', 'within', 'minBuy', 'maxBuy', 'sellRatio', 'sellJitter', 'seed'];

function curveOpts(a) {
  return {
    preset: a.preset, config: a.config,
    params: { virtualSol: a.virtualSol, virtualTokens: a.virtualTokens, curveTokens: a.curveTokens, supply: a.supply, fee: a.fee },
    fromRaised: a.fromRaised, solPrice: a.solPrice,
  };
}

export async function callTool(name, a = {}, env = process.env) {
  const o = curveOpts(a);
  switch (name) {
    case 'curve_state': {
      if (a.mint || a.curve) {
        const live = await fetchLive({ rpc: a.rpc || env.RAMP_RPC_URL, mint: a.mint, curve: a.curve });
        return { ...api.state({ ...o, _curve: makeCurve({ ...o, live }), solPrice: a.solPrice }), live: liveSummary(live) };
      }
      return api.state(o);
    }
    case 'quote_buy': return api.quoteBuy({ ...o, sol: a.sol });
    case 'quote_sell': return api.quoteSell({ ...o, tokens: a.tokens });
    case 'plan_dev_buy': return api.planDevBuy({ ...o, ownPct: a.ownPct, targetMcap: a.targetMcap, budget: a.budget, at: a.at });
    case 'simulate_launch': {
      const sim = Object.fromEntries(SIM_KEYS.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
      const r = api.simulate({ ...o, sim });
      delete r.samples;
      return r;
    }
    default: return undefined;
  }
}

function validate(tool, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  const { properties, required = [] } = tool.inputSchema;
  for (const key of required) if (args[key] === undefined) return `missing required argument "${key}"`;
  for (const [key, value] of Object.entries(args)) {
    const p = properties[key];
    if (!p) return `unknown argument "${key}"`;
    const types = [].concat(p.type);
    const ok = types.some((t) => (t === 'integer' ? Number.isInteger(value) : t === 'array' ? Array.isArray(value) : t === 'object' ? value && typeof value === 'object' && !Array.isArray(value) : typeof value === t));
    if (!ok) return `argument "${key}" must be ${types.join(' or ')}`;
  }
  return null;
}

/** Handle one JSON-RPC message. Returns the response object, or null for notifications. */
export async function handle(msg, env = process.env) {
  const isReq = msg && typeof msg === 'object' && 'id' in msg && msg.id !== null;
  const reply = (result) => (isReq ? { jsonrpc: '2.0', id: msg.id, result } : null);
  const error = (code, message) => (isReq ? { jsonrpc: '2.0', id: msg.id, error: { code, message } } : null);
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'ramp', version: VERSION },
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return error(-32602, `unknown tool "${name}"`);
      const args = msg.params.arguments ?? {};
      const bad = validate(tool, args);
      if (bad) return error(-32602, bad);
      try {
        const result = await callTool(name, args, env);
        return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        if (!(err instanceof CurveError)) process.stderr.write(`ramp mcp: ${err.stack}\n`);
        return reply({ content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
      }
    }
    default:
      return msg.method.startsWith('notifications/') ? null : error(-32601, `Method not found: ${msg.method}`);
  }
}

export function startMcp({ input = process.stdin, output = process.stdout } = {}) {
  process.stderr.write(`ramp mcp ${VERSION} ready on stdio\n`);
  const rl = createInterface({ input });
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    chain = chain.then(async () => {
      let msg;
      try { msg = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return; }
      const res = await handle(msg);
      if (res) output.write(JSON.stringify(res) + '\n');
    });
  });
  return new Promise((resolve) => rl.on('close', () => chain.then(resolve)));
}
