// Browser-safe live reads for the website: base58, ed25519 on-curve check, Pump.fun bonding
// curve PDA, account decoder, a getAccountInfo call and DexScreener helpers.
// No imports and no Node globals: docs/lib/chain.js is an exact copy served to the browser.
// sha256 is passed in (WebCrypto in the browser, node:crypto in tests) so this file stays pure.
// The CLI keeps using src/live.js; test/site.test.js checks both give the same answers.

export const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
/** First 8 bytes of sha256("account:BondingCurve"). */
export const BONDING_CURVE_DISCRIMINATOR = Uint8Array.from([23, 183, 248, 55, 96, 216, 172, 96]);
export const DEXSCREENER = 'https://api.dexscreener.com';

export class LiveError extends Error {
  /** kind: bad-address, not-found, not-pump, rate-limited, unreachable, rpc, bad-account */
  constructor(kind, message) {
    super(message);
    this.name = 'LiveError';
    this.kind = kind;
  }
}

const enc = (s) => new TextEncoder().encode(s);
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------- base58

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes) {
  let n = BigInt('0x' + (hex(bytes) || '0'));
  let out = '';
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}

export function base58Decode(str) {
  let n = 0n;
  for (const ch of str) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new LiveError('bad-address', `invalid base58 character "${ch}"`);
    n = n * 58n + BigInt(i);
  }
  let h = n === 0n ? '' : n.toString(16);
  if (h.length % 2) h = '0' + h;
  const lead = str.match(/^1*/)[0].length;
  const body = new Uint8Array(h.length / 2);
  for (let i = 0; i < body.length; i++) body[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return concat([new Uint8Array(lead), body]);
}

/** 32 bytes of a Solana address, or a LiveError("bad-address"). */
export function addressBytes(address) {
  const s = String(address ?? '').trim();
  let b = null;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) { try { b = base58Decode(s); } catch { b = null; } }
  if (!b || b.length !== 32) throw new LiveError('bad-address', 'that is not a Solana address. paste the mint, 32 to 44 base58 characters');
  return b;
}

export function isAddress(s) {
  try { addressBytes(s); return true; } catch { return false; }
}

// ---------------------------------------------------------------- ed25519

const P = 2n ** 255n - 19n;
const mod = (a) => { const r = a % P; return r < 0n ? r + P : r; };
function modPow(b, e) {
  let r = 1n; b = mod(b);
  while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; }
  return r;
}
const D = mod(-121665n * modPow(121666n, P - 2n));

/** True when 32 bytes decompress to a point on ed25519 (the Solana runtime rule). */
export function isOnCurve(bytes) {
  if (bytes.length !== 32) return false;
  const y = mod(BigInt('0x' + hex(Uint8Array.from(bytes).reverse())) & ((1n << 255n) - 1n));
  const u = mod(y * y - 1n);
  const v = mod(D * y * y + 1n);
  const v3 = mod(v * v * v);
  const x = mod(u * v3 * modPow(u * v3 * v3 * v, (P - 5n) / 8n));
  const vx2 = mod(v * x * x);
  return vx2 === u || vx2 === mod(-u);
}

// ---------------------------------------------------------------- PDA

/** findProgramAddress with an async sha256(Uint8Array) => Uint8Array|ArrayBuffer. */
export async function findProgramAddress(seeds, programId, sha256) {
  const program = addressBytes(programId);
  const tail = enc('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const h = new Uint8Array(await sha256(concat([...seeds, Uint8Array.of(bump), program, tail])));
    if (!isOnCurve(h)) return { address: base58Encode(h), bump };
  }
  throw new LiveError('bad-address', 'no valid program address found');
}

/** The bonding curve account of a mint: PDA of ["bonding-curve", mint] under the Pump program. */
export function bondingCurveAddress(mint, sha256, programId = PUMP_PROGRAM_ID) {
  return findProgramAddress([enc('bonding-curve'), addressBytes(mint)], programId, sha256);
}

/** WebCrypto sha256, used by the browser (and by Node 20+ if no other is passed). */
export const webSha256 = (data) => globalThis.crypto.subtle.digest('SHA-256', data);

// ---------------------------------------------------------------- decoder

export function base64Bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Same layout and fields as decodeBondingCurve in src/live.js, from a Uint8Array. */
export function decodeBondingCurve(bytes) {
  if (bytes.length < 49) throw new LiveError('bad-account', `bonding curve account is ${bytes.length} bytes, expected at least 49`);
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== BONDING_CURVE_DISCRIMINATOR[i]) throw new LiveError('bad-account', 'that account is not a pump.fun bonding curve');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u64 = (o) => dv.getBigUint64(o, true);
  const out = {
    virtualTokenReserves: u64(8),
    virtualSolReserves: u64(16),
    realTokenReserves: u64(24),
    realSolReserves: u64(32),
    tokenTotalSupply: u64(40),
    complete: bytes[48] === 1,
  };
  if (bytes.length >= 81) out.creator = base58Encode(bytes.subarray(49, 81));
  return out;
}

// ---------------------------------------------------------------- RPC

async function getJson(url, init, fetchImpl, what) {
  let res;
  try { res = await fetchImpl(url, init); } catch { throw new LiveError('unreachable', `could not reach ${what}. check your connection and try again`); }
  if (res.status === 429) throw new LiveError('rate-limited', `${what} is rate limited right now. wait a few seconds and try again`);
  if (!res.ok) throw new LiveError('unreachable', `${what} answered HTTP ${res.status}. try again in a moment`);
  try { return await res.json(); } catch { throw new LiveError('unreachable', `${what} sent something that is not JSON`); }
}

/**
 * Read a mint's bonding curve through a JSON-RPC endpoint (the site uses /api/rpc).
 * Returns { mint, address, bump, slot, account } with BigInt reserves.
 */
export async function loadBondingCurve({ mint, rpcUrl, fetchImpl = globalThis.fetch, sha256 = webSha256 }) {
  addressBytes(mint);
  const { address, bump } = await bondingCurveAddress(mint, sha256);
  const body = await getJson(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [address, { encoding: 'base64', commitment: 'confirmed' }] }),
  }, fetchImpl, 'the Solana RPC');
  if (body.error) {
    const rate = body.error.code === 429 || /rate|too many/i.test(body.error.message || '');
    throw new LiveError(rate ? 'rate-limited' : 'rpc', rate ? 'the Solana RPC is rate limited right now. wait a few seconds and try again' : `RPC error: ${body.error.message || body.error.code}`);
  }
  const value = body.result?.value;
  if (!value) throw new LiveError('not-found', 'no pump.fun bonding curve for this mint. it may come from another launchpad');
  if (value.owner && value.owner !== PUMP_PROGRAM_ID) throw new LiveError('not-pump', 'that account is not owned by the pump.fun program');
  const account = decodeBondingCurve(base64Bytes(value.data[0]));
  return { mint: String(mint).trim(), address, bump, slot: body.result.context?.slot ?? null, account };
}

/** Reserves the curve math needs, in base units, plus whole-token supply. */
export function curveInput(live) {
  const a = live.account;
  return {
    virtualSol: a.virtualSolReserves, virtualTokens: a.virtualTokenReserves, realTokens: a.realTokenReserves,
    supply: Number(a.tokenTotalSupply) / 1e6, complete: a.complete || a.realTokenReserves === 0n,
  };
}

// ---------------------------------------------------------------- DexScreener

/** First Solana mint ending in "pump" from token-profiles/latest/v1, or null. */
export function pickPumpMint(profiles) {
  if (!Array.isArray(profiles)) return null;
  const p = profiles.find((x) => x && x.chainId === 'solana' && typeof x.tokenAddress === 'string' && /pump$/.test(x.tokenAddress) && isAddress(x.tokenAddress));
  return p ? p.tokenAddress : null;
}

export async function latestPumpMint({ base = DEXSCREENER, fetchImpl = globalThis.fetch } = {}) {
  return pickPumpMint(await getJson(`${base}/token-profiles/latest/v1`, undefined, fetchImpl, 'DexScreener'));
}

/** All pairs DexScreener knows for a Solana mint (tokens/v1). */
export async function tokenPairs(mint, { base = DEXSCREENER, fetchImpl = globalThis.fetch } = {}) {
  const r = await getJson(`${base}/tokens/v1/solana/${encodeURIComponent(mint)}`, undefined, fetchImpl, 'DexScreener');
  return Array.isArray(r) ? r : (r && Array.isArray(r.pairs) ? r.pairs : []);
}

/** The pair to show: the AMM pair with the most liquidity, the pump.fun curve pair last. */
export function bestPair(pairs, { graduated = false } = {}) {
  const list = (pairs || []).filter((p) => p && p.pairAddress);
  if (!list.length) return null;
  const liq = (p) => Number(p.liquidity?.usd) || 0;
  const pool = graduated ? list.filter((p) => p.dexId !== 'pumpfun') : list;
  return [...(pool.length ? pool : list)].sort((a, b) => liq(b) - liq(a))[0];
}

/** Name, symbol and image for the coin, from any pair where it is the base token. */
export function tokenMeta(pairs, mint) {
  const p = (pairs || []).find((x) => x?.baseToken?.address === mint) || (pairs || [])[0];
  if (!p) return null;
  const t = p.baseToken?.address === mint ? p.baseToken : null;
  return { name: t?.name || null, symbol: t?.symbol || null, image: p.info?.imageUrl || null };
}

/** USD per SOL implied by a SOL-quoted pair (priceUsd / priceNative). An estimate. */
export function solUsdFrom(pairs) {
  for (const p of pairs || []) {
    const q = p?.quoteToken?.symbol;
    const usd = Number(p?.priceUsd), nat = Number(p?.priceNative);
    if ((q === 'SOL' || q === 'WSOL') && usd > 0 && nat > 0) {
      const v = usd / nat;
      if (v > 1 && v < 100000) return v;
    }
  }
  return null;
}
