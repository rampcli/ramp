// Live mode: read a Pump.fun bonding curve account over Solana JSON-RPC.
// Implements base58, ed25519 on-curve checks and program derived addresses (PDA)
// with node:crypto only, plus a decoder for the BondingCurve account layout.
import { createHash } from 'node:crypto';
import { CurveError } from './math.js';

export const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();

/** Anchor account discriminator: first 8 bytes of sha256("account:BondingCurve"). */
export const BONDING_CURVE_DISCRIMINATOR = sha256('account:BondingCurve').subarray(0, 8);

// ---------------------------------------------------------------- base58

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes) {
  const buf = Buffer.from(bytes);
  let n = BigInt('0x' + (buf.toString('hex') || '0'));
  let out = '';
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b !== 0) break; out = '1' + out; }
  return out;
}

export function base58Decode(str) {
  let n = 0n;
  for (const ch of str) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new CurveError(`invalid base58 character "${ch}"`);
    n = n * 58n + BigInt(i);
  }
  let hex = n === 0n ? '' : n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const lead = str.match(/^1*/)[0].length;
  return Buffer.concat([Buffer.alloc(lead), Buffer.from(hex, 'hex')]);
}

/** Decode a base58 Solana address into its 32 bytes, with validation. */
export function addressBytes(address, name = 'address') {
  let b;
  try { b = base58Decode(String(address)); } catch { b = null; }
  if (!b || b.length !== 32) throw new CurveError(`${name} is not a valid Solana address: "${address}"`);
  return b;
}

// ---------------------------------------------------------------- ed25519

const P = 2n ** 255n - 19n;
const D = (-121665n * modInv(121666n)) % P + P;
const SQRT_M1 = modPow(2n, (P - 1n) / 4n);

function mod(a) { const r = a % P; return r < 0n ? r + P : r; }
function modPow(b, e) {
  let r = 1n; b = mod(b);
  while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; }
  return r;
}
function modInv(a) { return modPow(a, P - 2n); }

/**
 * True when 32 bytes decompress to a point on the ed25519 curve (same rule as
 * curve25519-dalek's CompressedEdwardsY::decompress, used by the Solana runtime).
 */
export function isOnCurve(bytes) {
  const b = Buffer.from(bytes);
  if (b.length !== 32) return false;
  const le = Buffer.from(b).reverse();
  const y = mod(BigInt('0x' + le.toString('hex')) & ((1n << 255n) - 1n));
  const u = mod(y * y - 1n);
  const v = mod(D * y * y + 1n);
  const v3 = mod(v * v * v);
  let x = mod(u * v3 * modPow(u * v3 * v3 * v, (P - 5n) / 8n));
  const vx2 = mod(v * x * x);
  if (vx2 === u) return true;
  if (vx2 === mod(-u)) { x = mod(x * SQRT_M1); return true; }
  return false;
}

// ---------------------------------------------------------------- PDA

/** Solana findProgramAddress: highest bump whose hash is off the curve. */
export function findProgramAddress(seeds, programId = PUMP_PROGRAM_ID) {
  const program = addressBytes(programId, 'program id');
  for (let bump = 255; bump >= 0; bump--) {
    const hash = sha256(...seeds.map((s) => Buffer.from(s)), Buffer.from([bump]), program, Buffer.from('ProgramDerivedAddress'));
    if (!isOnCurve(hash)) return { address: base58Encode(hash), bump };
  }
  throw new CurveError('no valid program address found');
}

/** The bonding curve account for a mint: PDA of ["bonding-curve", mint] under the Pump program. */
export function bondingCurveAddress(mint, programId = PUMP_PROGRAM_ID) {
  return findProgramAddress([Buffer.from('bonding-curve'), addressBytes(mint, 'mint')], programId);
}

// ---------------------------------------------------------------- decoder

/**
 * BondingCurve account layout (little endian):
 *   0  [8]  Anchor discriminator
 *   8  u64  virtualTokenReserves
 *  16  u64  virtualSolReserves
 *  24  u64  realTokenReserves
 *  32  u64  realSolReserves
 *  40  u64  tokenTotalSupply
 *  48  bool complete
 *  49  [32] creator (only on newer accounts, decoded when present)
 */
export function decodeBondingCurve(data) {
  const b = Buffer.from(data);
  if (b.length < 49) throw new CurveError(`bonding curve account is ${b.length} bytes, expected at least 49`);
  if (!b.subarray(0, 8).equals(BONDING_CURVE_DISCRIMINATOR)) {
    throw new CurveError(`account discriminator ${b.subarray(0, 8).toString('hex')} is not a BondingCurve (${BONDING_CURVE_DISCRIMINATOR.toString('hex')})`);
  }
  const out = {
    virtualTokenReserves: b.readBigUInt64LE(8),
    virtualSolReserves: b.readBigUInt64LE(16),
    realTokenReserves: b.readBigUInt64LE(24),
    realSolReserves: b.readBigUInt64LE(32),
    tokenTotalSupply: b.readBigUInt64LE(40),
    complete: b[48] === 1,
  };
  if (b.length >= 81) out.creator = base58Encode(b.subarray(49, 81));
  return out;
}

/** Encode an account buffer (used for fixtures and tests). */
export function encodeBondingCurve(acc) {
  const b = Buffer.alloc(acc.creator ? 81 : 49);
  BONDING_CURVE_DISCRIMINATOR.copy(b, 0);
  ['virtualTokenReserves', 'virtualSolReserves', 'realTokenReserves', 'realSolReserves', 'tokenTotalSupply']
    .forEach((k, i) => b.writeBigUInt64LE(BigInt(acc[k]), 8 + i * 8));
  b[48] = acc.complete ? 1 : 0;
  if (acc.creator) addressBytes(acc.creator, 'creator').copy(b, 49);
  return b;
}

/** Fetch and decode a bonding curve account via getAccountInfo. Pass `curve`, or `mint` to derive it. */
export async function fetchBondingCurve({ rpc, mint, curve, fetchImpl = globalThis.fetch }) {
  if (!rpc) throw new CurveError('live mode needs --rpc <url> (or RAMP_RPC_URL)');
  if (!mint && !curve) throw new CurveError('live mode needs --mint <address> or --curve <address>');
  const address = curve || bondingCurveAddress(mint).address;
  addressBytes(address, 'curve');
  let res;
  try {
    res = await fetchImpl(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [address, { encoding: 'base64', commitment: 'confirmed' }] }),
    });
  } catch (err) {
    throw new CurveError(`could not reach RPC ${rpc}: ${err.message}`);
  }
  if (!res.ok) throw new CurveError(`RPC returned HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new CurveError(`RPC error ${body.error.code}: ${body.error.message}`);
  const value = body.result?.value;
  if (!value) throw new CurveError(`account ${address} not found`);
  if (value.owner && value.owner !== PUMP_PROGRAM_ID) throw new CurveError(`account ${address} is owned by ${value.owner}, not the Pump program`);
  const account = decodeBondingCurve(Buffer.from(value.data[0], 'base64'));
  return { address, mint: mint || null, slot: body.result.context?.slot ?? null, account };
}
