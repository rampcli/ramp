// Shared entry points for the CLI, the MCP server and the dashboard API.
// Inputs are plain JSON-friendly objects, outputs are plain objects (no BigInt, no Curve).
import { readFileSync } from 'node:fs';
import {
  Curve, CurveError, resolveParams, planOwn, planTargetMcap, planBudget, bundleCompare, simulateLaunch, snipe, TOKEN_DECIMALS,
} from './math.js';
import { fetchBondingCurve } from './live.js';

export function loadConfig(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (err) { throw new CurveError(`cannot read config ${path}: ${err.code || err.message}`); }
  try { return JSON.parse(text); } catch { throw new CurveError(`config ${path} is not valid JSON`); }
}

/**
 * Build a curve. opts: { preset, config (object), configPath, params: {virtualSol,...}, fromRaised, live }
 * `live` is a decoded account from fetchBondingCurve().
 */
export function makeCurve(opts = {}) {
  if (opts._curve) return opts._curve; // already built by the caller
  const config = opts.config ?? (opts.configPath ? loadConfig(opts.configPath) : null);
  const preset = opts.preset ?? (config ? 'custom' : 'pumpfun');
  const params = resolveParams({ preset, config, overrides: opts.params || {} });
  if (opts.live) {
    const a = opts.live.account;
    const supply = Number(a.tokenTotalSupply) / 10 ** TOKEN_DECIMALS;
    return new Curve({ ...params, supply }).withReserves({ virtualSol: a.virtualSolReserves, virtualTokens: a.virtualTokenReserves, realTokens: a.realTokenReserves });
  }
  const c = new Curve(params);
  return opts.fromRaised !== undefined && opts.fromRaised !== null && Number(opts.fromRaised) !== 0 ? c.withRaised(opts.fromRaised) : c;
}

export async function fetchLive({ rpc, mint, curve }) {
  return fetchBondingCurve({ rpc, mint, curve });
}

/** JSON view of a live account (BigInt to strings and SOL numbers). */
export function liveSummary(live) {
  const a = live.account;
  return {
    address: live.address, mint: live.mint, slot: live.slot, complete: a.complete, creator: a.creator ?? null,
    virtualTokenReserves: a.virtualTokenReserves.toString(), virtualSolReserves: a.virtualSolReserves.toString(),
    realTokenReserves: a.realTokenReserves.toString(), realSolReserves: a.realSolReserves.toString(),
    tokenTotalSupply: a.tokenTotalSupply.toString(), realSol: Number(a.realSolReserves) / 1e9,
  };
}

const strip = ({ curve, ...rest }) => rest;
const usd = (obj, sp, keys) => {
  if (!sp) return obj;
  const out = { ...obj, solPrice: sp };
  for (const k of keys) if (typeof obj[k] === 'number') out[`${k}Usd`] = obj[k] * sp;
  return out;
};

export const api = {
  state: (o = {}) => usd(makeCurve(o).state(), o.solPrice, ['marketCap', 'graduationMarketCap']),
  quoteBuy: (o) => usd(strip(makeCurve(o).buy(o.sol)), o.solPrice, ['marketCapBefore', 'marketCapAfter']),
  quoteSell: (o) => {
    const c = makeCurve(o);
    if (c.tokensSold === 0n) throw new CurveError('nothing has been bought at this point, set fromRaised to start from a later point');
    return usd(strip(c.sell(o.tokens)), o.solPrice, ['solOut', 'marketCapBefore', 'marketCapAfter']);
  },
  planDevBuy: (o) => {
    const c = makeCurve(o);
    const modes = ['ownPct', 'targetMcap', 'budget'].filter((k) => o[k] !== undefined && o[k] !== null);
    if (modes.length !== 1) throw new CurveError('give exactly one of: own percent, target market cap, budget');
    if (o.ownPct !== undefined && o.ownPct !== null) return { mode: 'own', ...usd(planOwn(c, o.ownPct), o.solPrice, ['solToSpend', 'marketCapAfter']) };
    if (o.targetMcap !== undefined && o.targetMcap !== null) {
      const inSol = o.solPrice ? Number(o.targetMcap) / o.solPrice : Number(o.targetMcap);
      return { mode: 'target-mcap', unit: o.solPrice ? 'USD' : 'SOL', targetInput: Number(o.targetMcap), ...usd(planTargetMcap(c, inSol), o.solPrice, ['currentMarketCap', 'graduationMarketCap']) };
    }
    return { mode: 'budget', ...planBudget(c, o.budget, o.at || [0, 20, 40, 60]) };
  },
  bundle: (o) => bundleCompare(makeCurve(o), o.wallets ?? 8, o.each ?? 0.5, { gapSol: o.gapSol ?? 2 }),
  snipe: (o) => strip(snipe(makeCurve(o), o.buyers ?? 10, o.each ?? 1)),
  simulate: (o = {}) => {
    const r = simulateLaunch(makeCurve(o), o.sim || {});
    return o.samples ? r : { ...r, samples: undefined };
  },
};
