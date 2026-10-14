import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Curve, planOwn, planTargetMcap, planBudget, bigSqrt, resolveParams, CurveError } from '../src/index.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${a} within ${tol} of ${b}`);

test('planOwn: buying the planned SOL lands on the target share', () => {
  for (const pct of [0.5, 1, 5, 10, 25]) {
    const c = new Curve();
    const p = planOwn(c, pct);
    close(p.supplyPct, pct, 1e-5, `own ${pct}%`);
    // closed form: net = v0 * t / (T0 - t), gross = net / (1 - fee)
    const t = 1e9 * pct / 100;
    const net = (30 * t) / (1_073_000_000 - t);
    close(p.solToSpend, net / 0.99, 1e-6, `gross for ${pct}%`);
    const check = c.buy(p.solToSpend);
    assert.ok(check.tokensOut >= t - 1e-6, 'spending the plan must reach the target');
  }
});

test('planOwn respects fee and starting point', () => {
  const noFee = planOwn(new Curve({ fee: 0 }), 5);
  assert.equal(noFee.fee, 0);
  const later = planOwn(new Curve().withRaised(40), 5);
  assert.ok(later.solToSpend > planOwn(new Curve(), 5).solToSpend * 3);
  assert.throws(() => planOwn(new Curve(), 80), /more than/);
  assert.throws(() => planOwn(new Curve(), 0), CurveError);
});

test('planTargetMcap inverts the price formula', () => {
  const c = new Curve();
  const target = 300; // SOL
  const r = planTargetMcap(c, target);
  assert.equal(r.reachable, true);
  // mcap = (v0 + raised)^2 / k * supply  =>  raised = sqrt(mcap * k / supply) - v0
  close(r.solRaisedNeeded, Math.sqrt((target * 30 * 1_073_000_000) / 1e9) - 30, 1e-6);
  close(c.withRaised(r.solRaisedNeeded).marketCap, target, 1e-3);
  close(r.solToAddWithFee, r.solToAdd / 0.99, 1e-6);
  assert.equal(planTargetMcap(c, 500).reachable, false);
  assert.equal(planTargetMcap(c.withRaised(50), 100).alreadyReached, true);
});

test('planBudget compares launch with later points', () => {
  const r = planBudget(new Curve(), 3);
  assert.deepEqual(r.rows.map((x) => x.raised), [0, 20, 40, 60]);
  assert.equal(r.rows[0].vsFirst, 1);
  for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i].tokensOut < r.rows[i - 1].tokensOut);
  close(r.rows[0].tokensOut, new Curve().buy(3).tokensOut, 1e-9);
  assert.equal(planBudget(new Curve(), 1, [0, 200]).rows.length, 1, 'points past graduation are skipped');
});

test('bigSqrt and resolveParams', () => {
  for (const n of [0n, 1n, 2n, 99n, 100n, 10n ** 40n + 7n]) {
    const r = bigSqrt(n);
    assert.ok(r * r <= n && (r + 1n) * (r + 1n) > n);
  }
  assert.equal(resolveParams().virtualSol, 30);
  assert.equal(resolveParams({ preset: 'custom', config: { virtualSol: 42 } }).virtualSol, 42);
  assert.equal(resolveParams({ overrides: { fee: 0.5 } }).fee, 0.5);
  assert.throws(() => resolveParams({ preset: 'custom', config: { bogus: 1 } }), /unknown curve parameter/);
});
