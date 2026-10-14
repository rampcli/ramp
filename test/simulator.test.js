import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Curve, simulateLaunch, mulberry32, seedFrom, histogram, CurveError } from '../src/index.js';

test('PRNG is deterministic and uniform enough', () => {
  const a = mulberry32(seedFrom(42));
  const b = mulberry32(seedFrom(42));
  const xs = Array.from({ length: 10000 }, () => a());
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b()));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.02);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notEqual(seedFrom(1), seedFrom('2'));
});

test('simulation is deterministic for a seed and changes with the seed', () => {
  const c = new Curve();
  const a = simulateLaunch(c, { runs: 40, seed: 42 });
  const b = simulateLaunch(c, { runs: 40, seed: 42 });
  const d = simulateLaunch(c, { runs: 40, seed: 43 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.samples, d.samples);
});

// Recorded from a run of this model. If you change the model on purpose, update these values.
const PINNED = { graduated: 42, p50: 480, within: 0.46, top10p50: 22.322251 };

test('pinned results for seed 42 (guards against accidental model changes)', () => {
  const r = simulateLaunch(new Curve(), { runs: 50, seed: 42 });
  assert.equal(r.runs, 50);
  assert.equal(r.graduated, r.samples.filter((s) => s.graduated).length);
  const snapshot = { graduated: r.graduated, p50: r.tradesToGraduate.p50, within: r.graduatedWithin.probability, top10p50: r.top10SharePct.p50 };
  assert.deepEqual(snapshot, PINNED);
});

test('dev share equals the dev buy alone (dev never sells)', () => {
  const r = simulateLaunch(new Curve(), { runs: 10, seed: 1, devBuy: 2, snipers: 0 });
  const expected = new Curve().buy(2).supplyPct;
  for (const s of r.samples) assert.ok(Math.abs(s.devPct - expected) < 1e-6);
});

test('more snipers in the first slot means more sniper supply', () => {
  const few = simulateLaunch(new Curve(), { runs: 60, seed: 5, snipers: 2, sellRatio: 0, sellJitter: 0 });
  const many = simulateLaunch(new Curve(), { runs: 60, seed: 5, snipers: 20, sniperSol: [0.5, 1, 2], sellRatio: 0, sellJitter: 0 });
  assert.ok(many.sniperSharePct.mean > few.sniperSharePct.mean * 4);
  // with no sells every run graduates and nobody's bag shrinks
  assert.equal(few.graduationRate, 1);
  assert.ok(many.top10SharePct.p50 >= many.sniperSharePct.p50 * 0.5);
});

test('invariants: shares stay in range, holders positive', () => {
  const r = simulateLaunch(new Curve(), { runs: 30, seed: 'abc' });
  for (const s of r.samples) {
    assert.ok(s.top10Pct > 0 && s.top10Pct <= 79.31 + 1e-9);
    assert.ok(s.sniperPct >= 0 && s.devPct >= 0 && s.holders > 0);
    if (s.graduated) assert.ok(Math.abs(s.solRaised - 85.0054) < 0.001);
  }
  assert.ok(r.graduatedWithin.probability <= r.graduationRate);
});

test('options are validated', () => {
  assert.throws(() => simulateLaunch(new Curve(), { runs: 0 }), CurveError);
  assert.throws(() => simulateLaunch(new Curve(), { sniperSol: [0] }), /sniper sizes/);
  assert.throws(() => simulateLaunch(new Curve(), { minBuy: 2, maxBuy: 1 }), /buy range/);
});

test('histogram buckets every value', () => {
  const h = histogram([0, 1, 2, 3, 10], 5, 0, 10);
  assert.equal(h.length, 5);
  assert.equal(h.reduce((s, b) => s + b.count, 0), 5);
  assert.equal(h[4].count, 1);
});
