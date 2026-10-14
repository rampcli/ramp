// Ramp math: an exact constant-product bonding curve with virtual reserves.
// Pure ESM with no imports and no Node built-ins, so this exact file runs in Node
// and is inlined into the browser playground (docs/index.html and `ramp ui`).
// Reserves are BigInt in base units (lamports, token base units) so trades never drift.

export class CurveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CurveError';
  }
}

export const SOL_DECIMALS = 9;
export const TOKEN_DECIMALS = 6;
const PPM = 1_000_000n; // fee precision: parts per million (1% = 10,000)

/** Parse a decimal string or number into BigInt base units (truncates extra decimals). */
export function parseUnits(value, decimals, name = 'value') {
  let s;
  if (typeof value === 'bigint') return value * 10n ** BigInt(decimals);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new CurveError(`${name} must be a non-negative number, got ${value}`);
    s = value.toFixed(Math.min(decimals, 20));
  } else {
    s = String(value ?? '').trim().replace(/[_,]/g, '');
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) throw new CurveError(`${name} must be a non-negative number, got "${value}"`);
  let [int, frac = ''] = s.split('.');
  frac = frac.slice(0, decimals).padEnd(decimals, '0');
  return BigInt((int || '0') + frac);
}

/** Format BigInt base units as an exact decimal string. */
export function formatUnits(value, decimals) {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (abs / base).toString() + (frac ? '.' + frac : '');
}

export const toNumber = (value, decimals) => Number(formatUnits(value, decimals));
export const ceilDiv = (a, b) => (a + b - 1n) / b;

/** Integer square root (floor) of a non-negative BigInt. */
export function bigSqrt(n) {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x = (x + n / x) / 2n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}

const sol = (v) => toNumber(v, SOL_DECIMALS);
const tok = (v) => toNumber(v, TOKEN_DECIMALS);
const lamports = (n) => BigInt(Math.round(n * 1e9));

/** Commonly cited Pump.fun launch parameters. All of them can be overridden. */
export const DEFAULTS = Object.freeze({
  supply: 1_000_000_000,
  virtualTokens: 1_073_000_000,
  virtualSol: 30,
  curveTokens: 793_100_000,
  fee: 1,
});

export const PRESETS = Object.freeze({ pumpfun: DEFAULTS });
export const PARAM_KEYS = Object.freeze(['virtualSol', 'virtualTokens', 'curveTokens', 'supply', 'fee']);

/**
 * Resolve curve parameters: preset, then config (for preset "custom"), then explicit overrides.
 * `config` is a plain object with any of PARAM_KEYS.
 */
export function resolveParams({ preset = 'pumpfun', config = null, overrides = {} } = {}) {
  let base;
  if (preset === 'custom') {
    if (!config) throw new CurveError('preset "custom" needs a config (JSON with virtualSol, virtualTokens, curveTokens, supply, fee)');
    base = { ...DEFAULTS };
  } else if (PRESETS[preset]) {
    base = { ...PRESETS[preset] };
  } else {
    throw new CurveError(`unknown preset "${preset}", use one of: ${[...Object.keys(PRESETS), 'custom'].join(', ')}`);
  }
  for (const src of [config || {}, overrides]) {
    for (const [key, value] of Object.entries(src)) {
      if (value === undefined || value === null) continue;
      if (!PARAM_KEYS.includes(key)) throw new CurveError(`unknown curve parameter "${key}", expected one of: ${PARAM_KEYS.join(', ')}`);
      base[key] = value;
    }
  }
  return base;
}

/**
 * Constant-product bonding curve with virtual reserves.
 * Instances are immutable: buy() and sell() return the next curve in `result.curve`.
 */
export class Curve {
  constructor(params = {}, state = null) {
    const p = { ...DEFAULTS };
    for (const [key, value] of Object.entries(params)) if (value !== undefined) p[key] = value;
    this.params = Object.freeze(p);
    this.supply = parseUnits(p.supply, TOKEN_DECIMALS, 'supply');
    this.initialVirtualTokens = parseUnits(p.virtualTokens, TOKEN_DECIMALS, 'virtual tokens');
    this.initialVirtualSol = parseUnits(p.virtualSol, SOL_DECIMALS, 'virtual SOL');
    this.curveTokens = parseUnits(p.curveTokens, TOKEN_DECIMALS, 'curve tokens');
    this.feePpm = parseUnits(p.fee, 4, 'fee');
    if (this.supply === 0n) throw new CurveError('supply must be greater than 0');
    if (this.initialVirtualSol === 0n) throw new CurveError('virtual SOL must be greater than 0');
    if (this.curveTokens === 0n) throw new CurveError('curve tokens must be greater than 0');
    if (this.curveTokens >= this.initialVirtualTokens) throw new CurveError('curve tokens must be less than virtual tokens');
    if (this.curveTokens > this.supply) throw new CurveError('curve tokens cannot exceed supply');
    if (this.feePpm >= PPM) throw new CurveError('fee must be below 100%');
    this.k = this.initialVirtualSol * this.initialVirtualTokens;
    this.virtualSol = state ? state.virtualSol : this.initialVirtualSol;
    this.virtualTokens = state ? state.virtualTokens : this.initialVirtualTokens;
    this.realTokens = state ? state.realTokens : this.curveTokens;
    Object.freeze(this);
  }

  // Fast path: copy validated parameters, swap reserves. Used for every trade.
  _next(state) {
    const c = Object.create(Curve.prototype);
    for (const key of ['params', 'supply', 'initialVirtualTokens', 'initialVirtualSol', 'curveTokens', 'feePpm', 'k']) c[key] = this[key];
    c.virtualSol = state.virtualSol;
    c.virtualTokens = state.virtualTokens;
    c.realTokens = state.realTokens;
    return Object.freeze(c);
  }

  clone() {
    return this._next({ virtualSol: this.virtualSol, virtualTokens: this.virtualTokens, realTokens: this.realTokens });
  }

  /** Curve with explicit reserves in base units (BigInt), for example from an on-chain account. */
  withReserves({ virtualSol, virtualTokens, realTokens }) {
    if (virtualTokens <= realTokens) throw new CurveError('virtual token reserves must exceed real token reserves');
    return this._next({ virtualSol, virtualTokens, realTokens });
  }

  /** Curve after `amount` SOL (net of fees) has gone into it from launch. */
  withRaised(amount) {
    const net = parseUnits(amount, SOL_DECIMALS, 'raised SOL');
    const v0 = this.initialVirtualSol;
    const t0 = this.initialVirtualTokens;
    const out = (t0 * net) / (v0 + net);
    if (out > this.curveTokens) {
      throw new CurveError(`raised SOL exceeds the graduation amount (${fmt(sol(ceilDiv(v0 * this.curveTokens, t0 - this.curveTokens)))} SOL)`);
    }
    return this._next({ virtualSol: v0 + net, virtualTokens: t0 - out, realTokens: this.curveTokens - out });
  }

  /** Curve after `amount` tokens have been bought from launch. */
  withSold(amount) {
    const sold = parseUnits(amount, TOKEN_DECIMALS, 'sold tokens');
    if (sold > this.curveTokens) throw new CurveError(`sold tokens exceed the tokens on the curve (${fmt(tok(this.curveTokens))})`);
    const vt = this.initialVirtualTokens - sold;
    return this._next({ virtualSol: ceilDiv(this.k, vt), virtualTokens: vt, realTokens: this.curveTokens - sold });
  }

  get solRaised() { return this.virtualSol - this.initialVirtualSol; }
  get tokensSold() { return this.curveTokens - this.realTokens; }
  get complete() { return this.realTokens === 0n; }
  /** Spot price in SOL per whole token. */
  get price() { return sol(this.virtualSol) / tok(this.virtualTokens); }
  get marketCap() { return this.price * tok(this.supply); }

  _grossFor(net) { return ceilDiv(net * PPM, PPM - this.feePpm); }
  _netToGraduate() {
    return this.realTokens === 0n ? 0n : ceilDiv(this.virtualSol * this.realTokens, this.virtualTokens - this.realTokens);
  }

  state() {
    const netLamports = this._netToGraduate();
    const gradPrice = sol(this.virtualSol + netLamports) / tok(this.virtualTokens - this.realTokens);
    return {
      solRaised: sol(this.solRaised),
      tokensSold: tok(this.tokensSold),
      soldPctOfSupply: pct(this.tokensSold, this.supply),
      progressPct: pct(this.tokensSold, this.curveTokens),
      price: this.price,
      marketCap: this.marketCap,
      solToGraduate: sol(netLamports),
      solToGraduateWithFee: sol(this._grossFor(netLamports)),
      graduationPrice: gradPrice,
      graduationMarketCap: gradPrice * tok(this.supply),
      complete: this.complete,
      virtualSol: sol(this.virtualSol),
      virtualTokens: tok(this.virtualTokens),
      tokensLeftOnCurve: tok(this.realTokens),
      feePct: Number(this.feePpm) / 10_000,
    };
  }

  /** Core buy on base units. Returns raw BigInt amounts and the next curve. */
  _buyRaw(gross) {
    let used = gross;
    let fee = (gross * this.feePpm) / PPM;
    let net = gross - fee;
    let out = (this.virtualTokens * net) / (this.virtualSol + net);
    let capped = false;
    if (out >= this.realTokens) {
      capped = true;
      out = this.realTokens;
      net = ceilDiv(this.virtualSol * out, this.virtualTokens - out);
      used = this._grossFor(net);
      if (used > gross) used = gross;
      fee = used - net;
    }
    const next = this._next({ virtualSol: this.virtualSol + net, virtualTokens: this.virtualTokens - out, realTokens: this.realTokens - out });
    return { used, fee, net, out, capped, next };
  }

  /** Core sell on base units. */
  _sellRaw(amt) {
    const gross = (this.virtualSol * amt) / (this.virtualTokens + amt);
    const fee = (gross * this.feePpm) / PPM;
    const next = this._next({ virtualSol: this.virtualSol - gross, virtualTokens: this.virtualTokens + amt, realTokens: this.realTokens + amt });
    return { gross, fee, next };
  }

  /** Spend `amount` SOL (fee included). Buys past graduation are capped. */
  buy(amount) {
    const gross = parseUnits(amount, SOL_DECIMALS, 'SOL amount');
    if (gross === 0n) throw new CurveError('SOL amount must be greater than 0');
    if (this.complete) throw new CurveError('curve is complete (graduated), there are no tokens left to buy');
    const { used, fee, net, out, capped, next } = this._buyRaw(gross);
    if (out === 0n) throw new CurveError('SOL amount is too small to buy any tokens');
    const avgPrice = sol(used) / tok(out);
    return {
      type: 'buy',
      solIn: sol(used),
      fee: sol(fee),
      solNet: sol(net),
      unusedSol: sol(gross - used),
      tokensOut: tok(out),
      supplyPct: pct(out, this.supply),
      avgPrice,
      priceBefore: this.price,
      priceAfter: next.price,
      priceImpactPct: (avgPrice / this.price - 1) * 100,
      priceChangePct: (next.price / this.price - 1) * 100,
      marketCapBefore: this.marketCap,
      marketCapAfter: next.marketCap,
      progressPctAfter: pct(next.tokensSold, next.curveTokens),
      capped,
      graduated: next.complete,
      curve: next,
    };
  }

  /** Sell `amount` tokens back into the curve. SOL out is after fee. */
  sell(amount) {
    const amt = parseUnits(amount, TOKEN_DECIMALS, 'token amount');
    if (amt === 0n) throw new CurveError('token amount must be greater than 0');
    if (amt > this.tokensSold) {
      throw new CurveError(`cannot sell ${fmt(tok(amt))} tokens, only ${fmt(tok(this.tokensSold))} have been bought on this curve`);
    }
    const { gross, fee, next } = this._sellRaw(amt);
    const avgPrice = sol(gross - fee) / tok(amt);
    return {
      type: 'sell',
      tokensIn: tok(amt),
      solGross: sol(gross),
      fee: sol(fee),
      solOut: sol(gross - fee),
      avgPrice,
      priceBefore: this.price,
      priceAfter: next.price,
      priceImpactPct: (1 - avgPrice / this.price) * 100,
      priceChangePct: (next.price / this.price - 1) * 100,
      marketCapBefore: this.marketCap,
      marketCapAfter: next.marketCap,
      curve: next,
    };
  }
}

/** Simulate `buyers` sequential buys of `each` SOL. Stops early if the curve graduates. */
export function snipe(curve, buyers, each) {
  if (!Number.isInteger(buyers) || buyers < 1) throw new CurveError('buyers must be a positive integer');
  const rows = [];
  let c = curve;
  let cumulative = 0;
  for (let i = 1; i <= buyers && !c.complete; i++) {
    const r = c.buy(each);
    cumulative += r.supplyPct;
    rows.push({
      buyer: i, solIn: r.solIn, tokens: r.tokensOut, supplyPct: r.supplyPct, cumulativePct: cumulative,
      entryMarketCap: r.marketCapBefore, avgMarketCap: r.avgPrice * tok(c.supply),
    });
    c = r.curve;
  }
  return {
    rows,
    totalSol: rows.reduce((s, r) => s + r.solIn, 0),
    totalTokens: rows.reduce((s, r) => s + r.tokens, 0),
    totalSupplyPct: cumulative,
    graduated: c.complete,
    curve: c,
  };
}

/** Sample price and market cap against net SOL raised, from the curve's current state to graduation. */
export function chartPoints(curve, samples = 60) {
  const start = sol(curve.solRaised);
  const end = start + curve.state().solToGraduate;
  const v0 = sol(curve.initialVirtualSol);
  const k = v0 * tok(curve.initialVirtualTokens);
  const supply = tok(curve.supply);
  const points = [];
  for (let i = 0; i < samples; i++) {
    const raised = start + ((end - start) * i) / Math.max(1, samples - 1);
    const vs = v0 + raised;
    const price = (vs * vs) / k; // price = vS / vT = vS^2 / k
    points.push({ raised, price, marketCap: price * supply });
  }
  return points;
}

// ---------------------------------------------------------------- planner

/** How much SOL a buy at the current point needs to receive `ownPct` percent of total supply. */
export function planOwn(curve, ownPct) {
  const p = Number(ownPct);
  if (!Number.isFinite(p) || p <= 0 || p > 100) throw new CurveError(`ownership must be a percent between 0 and 100, got "${ownPct}"`);
  if (curve.complete) throw new CurveError('curve is complete (graduated)');
  const want = (curve.supply * BigInt(Math.round(p * 1e6))) / 100_000_000n;
  if (want >= curve.realTokens) {
    throw new CurveError(`${p}% of supply is more than the ${fmt(pct(curve.realTokens, curve.supply))}% left on the curve`);
  }
  const net = ceilDiv(curve.virtualSol * want, curve.virtualTokens - want);
  const gross = curve._grossFor(net);
  const r = curve.buy(formatUnits(gross, SOL_DECIMALS));
  return {
    targetPct: p,
    solToSpend: r.solIn,
    solNet: sol(net),
    fee: r.fee,
    tokensOut: r.tokensOut,
    supplyPct: r.supplyPct,
    avgPrice: r.avgPrice,
    priceImpactPct: r.priceImpactPct,
    marketCapBefore: r.marketCapBefore,
    marketCapAfter: r.marketCapAfter,
    progressPctAfter: r.progressPctAfter,
  };
}

/**
 * Net SOL that must be in the curve for its market cap (in SOL) to reach `targetMcapSol`.
 * mcap_lamports = vS^2 * supply / k, so vS = sqrt(mcap_lamports * k / supply).
 */
export function planTargetMcap(curve, targetMcapSol) {
  const target = Number(targetMcapSol);
  if (!Number.isFinite(target) || target <= 0) throw new CurveError(`target market cap must be a positive number, got "${targetMcapSol}"`);
  const st = curve.state();
  const base = { targetMarketCap: target, currentMarketCap: st.marketCap, graduationMarketCap: st.graduationMarketCap };
  const vs = bigSqrt((lamports(target) * curve.k) / curve.supply);
  const raisedNet = vs - curve.initialVirtualSol;
  if (target <= st.marketCap) return { ...base, reachable: true, alreadyReached: true, solRaisedNeeded: sol(curve.solRaised), solToAdd: 0, solToAddWithFee: 0 };
  if (target > st.graduationMarketCap) return { ...base, reachable: false, alreadyReached: false, solRaisedNeeded: null, solToAdd: null, solToAddWithFee: null };
  const add = vs - curve.virtualSol;
  const soldAt = curve.initialVirtualTokens - curve.k / vs;
  return {
    ...base,
    reachable: true,
    alreadyReached: false,
    solRaisedNeeded: sol(raisedNet),
    solToAdd: sol(add),
    solToAddWithFee: sol(curve._grossFor(add)),
    progressPctAt: pct(soldAt, curve.curveTokens),
    tokensSoldAt: tok(soldAt),
  };
}

/** What `budget` SOL buys at launch versus later points on the curve (net SOL raised). */
export function planBudget(curve, budget, points = [0, 20, 40, 60]) {
  const rows = [];
  for (const raised of points) {
    let c;
    try { c = curve.withRaised(raised); } catch { continue; }
    if (c.complete) continue;
    const r = c.buy(budget);
    rows.push({
      raised, tokensOut: r.tokensOut, supplyPct: r.supplyPct, avgPrice: r.avgPrice,
      entryMarketCap: r.marketCapBefore, avgEntryMarketCap: r.avgPrice * tok(c.supply), priceImpactPct: r.priceImpactPct,
      capped: r.capped,
    });
  }
  const first = rows[0]?.tokensOut;
  for (const row of rows) row.vsFirst = first ? row.tokensOut / first : null;
  return { budget: Number(budget), rows };
}

// ---------------------------------------------------------------- bundles

/**
 * Compare N wallets buying `each` SOL in the launch slot (a bundle) against the same buys
 * spread over time with `gapSol` of organic buying between each of them.
 */
export function bundleCompare(curve, wallets, each, { gapSol = 2 } = {}) {
  if (!Number.isInteger(wallets) || wallets < 1) throw new CurveError('wallets must be a positive integer');
  const g = Number(gapSol);
  if (!Number.isFinite(g) || g < 0) throw new CurveError('gap SOL must be zero or more');
  const bundled = snipe(curve, wallets, each);
  const spreadRows = [];
  let c = curve;
  let organic = 0;
  for (let i = 0; i < wallets && !c.complete; i++) {
    if (i > 0 && g > 0) {
      const o = c.buy(g);
      organic += o.solIn;
      c = o.curve;
      if (c.complete) break;
    }
    const r = c.buy(each);
    spreadRows.push({ buyer: i + 1, solIn: r.solIn, tokens: r.tokensOut, supplyPct: r.supplyPct, entryMarketCap: r.marketCapBefore });
    c = r.curve;
  }
  const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
  const summary = (rows) => ({
    wallets: rows.length,
    sol: sum(rows, 'solIn'),
    tokens: sum(rows, 'tokens'),
    supplyPct: sum(rows, 'supplyPct'),
    largestWalletPct: Math.max(...rows.map((r) => r.supplyPct)),
    smallestWalletPct: Math.min(...rows.map((r) => r.supplyPct)),
  });
  const b = summary(bundled.rows);
  const s = summary(spreadRows);
  return {
    each: Number(each),
    gapSol: g,
    bundled: { ...b, rows: bundled.rows.map(({ buyer, solIn, tokens, supplyPct, entryMarketCap }) => ({ buyer, solIn, tokens, supplyPct, entryMarketCap })) },
    spread: { ...s, organicSol: organic, rows: spreadRows },
    concentration: b.supplyPct / s.supplyPct,
    extraPct: b.supplyPct - s.supplyPct,
  };
}

// ---------------------------------------------------------------- simulator

/** Hash a seed (number or string) into a 32 bit integer. */
export function seedFrom(seed) {
  const s = String(seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic PRNG returning floats in [0, 1). */
export function mulberry32(a) {
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SIM_DEFAULTS = Object.freeze({
  runs: 200, snipers: 5, sniperSol: [1], devBuy: 1, maxTrades: 1000, within: 500,
  minBuy: 0.05, maxBuy: 3, sellRatio: 0.35, sellJitter: 0.15, newWalletRatio: 0.7, seed: 1,
});

function quantile(sorted, q) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return { mean: null, p10: null, p50: null, p90: null, min: null, max: null };
  return {
    mean: v.reduce((s, x) => s + x, 0) / v.length,
    p10: quantile(v, 0.1), p50: quantile(v, 0.5), p90: quantile(v, 0.9), min: v[0], max: v[v.length - 1],
  };
}

/**
 * Monte Carlo launch simulation. Launch slot: dev buy, then `snipers` buys sized from `sniperSol`
 * (cycled). Then up to `maxTrades` organic trades: buys are log-uniform between minBuy and maxBuy,
 * a share of trades are sells of 25 to 100% of a random non-dev holder's bag. That share is drawn per run,
 * uniformly within sellRatio +/- sellJitter, so some launches find demand and some stall.
 * Fully deterministic for a given seed.
 */
export function simulateLaunch(curve, options = {}) {
  const o = { ...SIM_DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) };
  const sizes = (Array.isArray(o.sniperSol) ? o.sniperSol : [o.sniperSol]).map(Number);
  const checks = [
    [Number.isInteger(o.runs) && o.runs >= 1 && o.runs <= 100_000, 'runs must be an integer from 1 to 100000'],
    [Number.isInteger(o.snipers) && o.snipers >= 0, 'snipers must be a non-negative integer'],
    [sizes.length > 0 && sizes.every((x) => Number.isFinite(x) && x > 0), 'sniper sizes must be positive numbers'],
    [Number.isFinite(o.devBuy) && o.devBuy >= 0, 'dev buy must be zero or more'],
    [Number.isInteger(o.maxTrades) && o.maxTrades >= 1, 'max trades must be a positive integer'],
    [Number.isInteger(o.within) && o.within >= 1, 'within must be a positive integer'],
    [o.minBuy > 0 && o.maxBuy >= o.minBuy, 'buy range must satisfy 0 < min-buy <= max-buy'],
    [o.sellRatio >= 0 && o.sellRatio < 1, 'sell ratio must be at least 0 and below 1'],
    [o.sellJitter >= 0 && o.sellJitter < 1, 'sell jitter must be at least 0 and below 1'],
    [o.newWalletRatio >= 0 && o.newWalletRatio <= 1, 'new wallet ratio must be between 0 and 1'],
  ];
  for (const [ok, msg] of checks) if (!ok) throw new CurveError(msg);
  if (curve.complete) throw new CurveError('curve is complete (graduated)');

  const rand = mulberry32(seedFrom(o.seed));
  const lnMin = Math.log(o.minBuy);
  const lnSpan = Math.log(o.maxBuy) - lnMin;
  const supply = curve.supply;
  const runs = [];

  for (let run = 0; run < o.runs; run++) {
    let c = curve;
    const sellP = Math.min(0.95, Math.max(0, o.sellRatio + (rand() * 2 - 1) * o.sellJitter));
    const bal = new Map();
    const add = (id, amt) => bal.set(id, (bal.get(id) || 0n) + amt);
    const buy = (id, lam) => {
      if (c.complete || lam <= 0n) return;
      const r = c._buyRaw(lam);
      if (r.out > 0n) { add(id, r.out); c = r.next; }
    };
    if (o.devBuy > 0) buy('dev', lamports(o.devBuy));
    for (let i = 0; i < o.snipers; i++) buy(`s${i}`, lamports(sizes[i % sizes.length]));

    const sellers = [...bal.keys()].filter((id) => id !== 'dev');
    const organic = [];
    let trades = 0;
    let wallets = 0;
    while (trades < o.maxTrades && !c.complete) {
      trades++;
      if (sellers.length && rand() < sellP) {
        const idx = Math.floor(rand() * sellers.length);
        const id = sellers[idx];
        const have = bal.get(id);
        const amt = rand() < 0.4 ? have : (have * BigInt(Math.floor((0.25 + 0.75 * rand()) * 1e6))) / 1_000_000n;
        if (amt > 0n) {
          c = c._sellRaw(amt).next;
          const left = have - amt;
          if (left > 0n) bal.set(id, left);
          else { bal.delete(id); sellers[idx] = sellers[sellers.length - 1]; sellers.pop(); }
        }
      } else {
        let id;
        if (!organic.length || rand() < o.newWalletRatio) { id = `w${wallets++}`; organic.push(id); }
        else id = organic[Math.floor(rand() * organic.length)];
        const had = bal.has(id);
        buy(id, lamports(Math.exp(lnMin + rand() * lnSpan)));
        if (!had && bal.has(id)) sellers.push(id);
      }
    }
    let snip = 0n;
    for (const [id, v] of bal) if (id[0] === 's') snip += v;
    const top = [...bal.values()].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0)).slice(0, 10).reduce((s, v) => s + v, 0n);
    runs.push({
      graduated: c.complete,
      trades,
      sniperPct: pct(snip, supply),
      devPct: pct(bal.get('dev') || 0n, supply),
      top10Pct: pct(top, supply),
      holders: bal.size,
      solRaised: sol(c.solRaised),
    });
  }

  const grad = runs.filter((r) => r.graduated);
  return {
    options: { ...o, sniperSol: sizes },
    runs: o.runs,
    graduated: grad.length,
    graduationRate: grad.length / o.runs,
    graduatedWithin: { trades: o.within, probability: grad.filter((r) => r.trades <= o.within).length / o.runs },
    tradesToGraduate: stats(grad.map((r) => r.trades)),
    sniperSharePct: stats(runs.map((r) => r.sniperPct)),
    devSharePct: stats(runs.map((r) => r.devPct)),
    top10SharePct: stats(runs.map((r) => r.top10Pct)),
    holders: stats(runs.map((r) => r.holders)),
    samples: runs,
  };
}

/** Histogram helper for charts: `bins` equal-width buckets over the values. */
export function histogram(values, bins = 12, lo = null, hi = null) {
  const v = values.filter((x) => Number.isFinite(x));
  const min = lo ?? (v.length ? Math.min(...v) : 0);
  const max = hi ?? (v.length ? Math.max(...v) : 1);
  const width = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const x of v) counts[Math.min(bins - 1, Math.max(0, Math.floor((x - min) / width)))]++;
  return counts.map((count, i) => ({ from: min + i * width, to: min + (i + 1) * width, count }));
}

function pct(part, whole) {
  return Number((part * 100_000_000n) / whole) / 1_000_000;
}

function fmt(n) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}
