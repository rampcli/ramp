import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Curve, DEFAULTS, snipe, chartPoints, CurveError, parseUnits, formatUnits } from '../src/index.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${a} to be within ${tol} of ${b}`);

test('defaults match the documented Pump.fun parameters', () => {
  const s = new Curve().state();
  assert.equal(s.virtualSol, DEFAULTS.virtualSol);
  assert.equal(s.virtualTokens, DEFAULTS.virtualTokens);
  assert.equal(s.tokensLeftOnCurve, DEFAULTS.curveTokens);
  close(s.price, 30 / 1_073_000_000, 1e-18);
  close(s.marketCap, 27.959, 0.001);
});

test('unit parsing is exact', () => {
  assert.equal(parseUnits('1.5', 9), 1_500_000_000n);
  assert.equal(parseUnits(0.000000001, 9), 1n);
  assert.equal(parseUnits('1,000', 6), 1_000_000_000n);
  assert.equal(formatUnits(85_005_358_342n, 9), '85.005358342');
  assert.throws(() => parseUnits('-1', 9), CurveError);
  assert.throws(() => parseUnits('abc', 9), CurveError);
});

test('k never decreases and stays constant up to rounding (fees sit outside the curve)', () => {
  let c = new Curve();
  for (const amount of [0.1, 3, 7.5, 12, 0.003]) {
    const next = c.buy(amount).curve;
    const k1 = next.virtualSol * next.virtualTokens;
    assert.ok(k1 >= c.k, 'k must not decrease');
    assert.ok(Number(k1 - c.k) / Number(c.k) < 1e-9, 'k drift must be negligible');
    c = next;
  }
  const after = c.sell(1_000_000).curve;
  assert.ok(after.virtualSol * after.virtualTokens >= c.k);
});

test('buy matches the constant-product formula', () => {
  const r = new Curve({ fee: 0 }).buy(1);
  const expected = 1_073_000_000 - (30 * 1_073_000_000) / 31;
  close(r.tokensOut, expected, 0.000001);
  assert.equal(r.fee, 0);
});

test('fee is taken from the SOL in', () => {
  const r = new Curve({ fee: 1.25 }).buy(2);
  close(r.fee, 0.025, 1e-9);
  close(r.solNet, 1.975, 1e-9);
});

test('buy then sell round trip loses about twice the fee', () => {
  for (const fee of [1, 1.25, 0]) {
    const buy = new Curve({ fee }).withRaised(10).buy(5);
    const sell = buy.curve.sell(buy.tokensOut);
    const lossPct = (1 - sell.solOut / 5) * 100;
    const expected = (1 - (1 - fee / 100) ** 2) * 100;
    close(lossPct, expected, 0.0001, `fee ${fee}`);
  }
});

test('immutability: buy does not change the original curve', () => {
  const c = new Curve();
  const before = c.state();
  c.buy(10);
  assert.deepEqual(c.state(), before);
  assert.deepEqual(c.clone().state(), before);
});

test('graduation math is computed, not hardcoded', () => {
  const s = new Curve().state();
  const expected = (30 * 793_100_000) / (1_073_000_000 - 793_100_000);
  close(s.solToGraduate, expected, 1e-8);
  close(s.solToGraduate, 85.005, 0.001);
  close(s.solToGraduateWithFee, expected / 0.99, 1e-6);
  const gradPrice = (30 + expected) / (1_073_000_000 - 793_100_000);
  close(s.graduationMarketCap, gradPrice * 1e9, 1e-6);

  const custom = new Curve({ virtualSol: 40 }).state();
  close(custom.solToGraduate, (40 * 793_100_000) / 279_900_000, 1e-8);
});

test('buying exactly the graduation amount completes the curve', () => {
  const c = new Curve();
  const r = c.buy(c.state().solToGraduateWithFee);
  assert.equal(r.graduated, true);
  assert.equal(r.curve.state().solToGraduate, 0);
  assert.throws(() => r.curve.buy(1), /graduated/);
});

test('oversized buys are capped at graduation', () => {
  const r = new Curve().buy(500);
  assert.equal(r.capped, true);
  assert.equal(r.tokensOut, DEFAULTS.curveTokens);
  close(r.solIn + r.unusedSol, 500, 1e-9);
  close(r.solIn, 85.0054 / 0.99, 0.001);
});

test('withSold and withRaised agree', () => {
  const a = new Curve().withRaised(25);
  const b = new Curve().withSold(a.state().tokensSold);
  close(a.state().solRaised, b.state().solRaised, 1e-8);
  close(a.price, b.price, 1e-15);
});

test('selling more than was bought is rejected', () => {
  const c = new Curve().withRaised(1);
  assert.throws(() => c.sell(1_000_000_000), /only/);
});

test('invalid parameters are rejected', () => {
  assert.throws(() => new Curve({ curveTokens: 2_000_000_000 }), CurveError);
  assert.throws(() => new Curve({ fee: 100 }), CurveError);
  assert.throws(() => new Curve({ virtualSol: 0 }), CurveError);
  assert.throws(() => new Curve().buy(0), CurveError);
});

test('snipe sums add up and early buyers get more', () => {
  const s = snipe(new Curve(), 10, 1);
  assert.equal(s.rows.length, 10);
  close(s.totalSol, 10, 1e-9);
  close(s.totalTokens, s.rows.reduce((t, r) => t + r.tokens, 0), 1e-6);
  close(s.totalSupplyPct, s.rows[9].cumulativePct, 1e-9);
  for (let i = 1; i < s.rows.length; i++) assert.ok(s.rows[i].tokens < s.rows[i - 1].tokens);
  // sequential buys equal one combined buy (up to rounding)
  const one = new Curve().buy(10);
  close(s.totalTokens, one.tokensOut, 0.01);
});

test('snipe stops when the curve graduates', () => {
  const s = snipe(new Curve(), 20, 10);
  assert.equal(s.graduated, true);
  assert.equal(s.rows.length, 9);
  close(s.totalTokens, DEFAULTS.curveTokens, 1e-6);
});

test('chart points run from launch to graduation and increase', () => {
  const pts = chartPoints(new Curve(), 30);
  assert.equal(pts.length, 30);
  close(pts[0].marketCap, 27.959, 0.001);
  close(pts[29].marketCap, new Curve().state().graduationMarketCap, 0.01);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].marketCap > pts[i - 1].marketCap);
});
