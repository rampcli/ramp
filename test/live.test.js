import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  decodeBondingCurve, encodeBondingCurve, fetchBondingCurve, bondingCurveAddress, findProgramAddress, isOnCurve,
  base58Encode, base58Decode, BONDING_CURVE_DISCRIMINATOR, PUMP_PROGRAM_ID, makeCurve,
} from '../src/index.js';
import { startMockRpc, fixture } from '../fixtures/mock-rpc.js';

const bin = fileURLToPath(new URL('../bin/ramp.js', import.meta.url));
function runCli(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [bin, ...args], { env: { ...process.env, RAMP_RPC_URL: '' } });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('discriminator is sha256("account:BondingCurve")[0..8]', () => {
  assert.deepEqual([...BONDING_CURVE_DISCRIMINATOR], [23, 183, 248, 55, 96, 216, 172, 96]);
  assert.deepEqual(BONDING_CURVE_DISCRIMINATOR, createHash('sha256').update('account:BondingCurve').digest().subarray(0, 8));
});

test('decoder reads the fixture buffer', () => {
  const a = decodeBondingCurve(Buffer.from(fixture.base64, 'base64'));
  for (const k of ['virtualTokenReserves', 'virtualSolReserves', 'realTokenReserves', 'realSolReserves', 'tokenTotalSupply']) {
    assert.equal(a[k], BigInt(fixture.expected[k]), k);
  }
  assert.equal(a.complete, false);
  assert.equal(a.creator, fixture.expected.creator);
  const short = decodeBondingCurve(encodeBondingCurve({ ...fixture.expected, creator: undefined }));
  assert.equal(short.creator, undefined);
  assert.throws(() => decodeBondingCurve(Buffer.alloc(20)), /at least 49/);
  const bad = Buffer.from(fixture.base64, 'base64');
  bad[0] ^= 1;
  assert.throws(() => decodeBondingCurve(bad), /not a BondingCurve/);
});

test('base58 round trip', () => {
  for (const hex of ['', '00', '0000ff', 'deadbeef', '00'.repeat(32)]) {
    const b = Buffer.from(hex, 'hex');
    assert.deepEqual(base58Decode(base58Encode(b)), b);
  }
  assert.equal(base58Encode(Buffer.alloc(32)), '11111111111111111111111111111111');
  assert.equal(base58Decode(PUMP_PROGRAM_ID).length, 32);
});

test('ed25519 on-curve check', () => {
  assert.equal(isOnCurve(Buffer.from('5866666666666666666666666666666666666666666666666666666666666666', 'hex')), true, 'base point');
  for (let i = 0; i < 10; i++) {
    const x = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x;
    assert.equal(isOnCurve(Buffer.from(x, 'base64url')), true, 'real public keys are on the curve');
  }
  let off = 0;
  for (let i = 0; i < 64; i++) off += !isOnCurve(createHash('sha256').update(String(i)).digest());
  assert.ok(off > 10 && off < 54, 'about half of random hashes are off the curve');
});

test('PDA derivation reproduces known Pump program addresses', () => {
  // Pump's "global" config and event authority accounts are PDAs of the program.
  assert.equal(findProgramAddress([Buffer.from('global')]).address, '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
  assert.equal(findProgramAddress([Buffer.from('__event_authority')]).address, 'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
  const pda = bondingCurveAddress(fixture.mint);
  assert.equal(isOnCurve(base58Decode(pda.address)), false);
  assert.ok(pda.bump >= 0 && pda.bump <= 255);
});

test('fetchBondingCurve against a mock RPC', async () => {
  const rpc = await startMockRpc();
  try {
    const live = await fetchBondingCurve({ rpc: rpc.url, curve: fixture.curve });
    assert.equal(live.slot, 312000000);
    assert.equal(rpc.calls[0].method, 'getAccountInfo');
    assert.deepEqual(rpc.calls[0].params[1], { encoding: 'base64', commitment: 'confirmed' });
    const c = makeCurve({ live });
    const s = c.state();
    assert.ok(Math.abs(s.solRaised - 20) < 1e-9);
    assert.ok(Math.abs(s.solToGraduate - (85.0054 - 20)) < 0.001);
    await assert.rejects(fetchBondingCurve({ rpc: rpc.url, mint: fixture.mint }), /not found/);
  } finally { await rpc.close(); }
  const wrongOwner = await startMockRpc({ [fixture.curve]: { base64: fixture.base64, owner: '11111111111111111111111111111111' } });
  try { await assert.rejects(fetchBondingCurve({ rpc: wrongOwner.url, curve: fixture.curve }), /not the Pump program/); }
  finally { await wrongOwner.close(); }
});

test('CLI live mode with --mint derives the PDA and reads the account', async () => {
  const pda = bondingCurveAddress(fixture.mint).address;
  const rpc = await startMockRpc({ [pda]: { base64: fixture.base64, owner: PUMP_PROGRAM_ID } });
  try {
    const r = await runCli(['state', '--rpc', rpc.url, '--mint', fixture.mint]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Curve state \(live\)/);
    assert.match(r.stdout, new RegExp(`Account\\s+${pda}`));
    assert.match(r.stdout, /Real SOL\s+20 SOL/);
    const j = JSON.parse((await runCli(['buy', '1', '--rpc', rpc.url, '--mint', fixture.mint, '--json'])).stdout);
    assert.equal(j.type, 'buy');
    assert.equal(rpc.calls[0].params[0], pda);
  } finally { await rpc.close(); }
});
