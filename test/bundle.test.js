import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Curve, bundleCompare } from '../src/index.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${a} within ${tol} of ${b}`);

test('a bundle equals one combined buy of the same SOL', () => {
  const r = bundleCompare(new Curve(), 8, 0.5);
  close(r.bundled.tokens, new Curve().buy(4).tokensOut, 0.01);
  close(r.bundled.sol, 4, 1e-9);
  assert.equal(r.bundled.wallets, 8);
});

test('spreading the same buys over time gets less supply', () => {
  const r = bundleCompare(new Curve(), 8, 0.5, { gapSol: 2 });
  assert.ok(r.spread.supplyPct < r.bundled.supplyPct);
  close(r.concentration, r.bundled.supplyPct / r.spread.supplyPct, 1e-12);
  close(r.concentration, 1.39, 0.01);
  close(r.spread.organicSol, 14, 1e-9);
  // first wallet is identical in both, later wallets get less when spread
  close(r.bundled.rows[0].supplyPct, r.spread.rows[0].supplyPct, 1e-9);
  assert.ok(r.spread.rows[7].supplyPct < r.bundled.rows[7].supplyPct);
});

test('with no gap, bundled and spread are the same', () => {
  const r = bundleCompare(new Curve(), 5, 1, { gapSol: 0 });
  close(r.concentration, 1, 1e-12);
});

test('per-wallet shares stay small while the total is large', () => {
  const r = bundleCompare(new Curve(), 20, 0.5);
  assert.ok(r.bundled.largestWalletPct < 2);
  assert.ok(r.bundled.supplyPct > 25);
  assert.throws(() => bundleCompare(new Curve(), 0, 1), /wallets/);
});
