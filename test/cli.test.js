import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bin = fileURLToPath(new URL('../bin/ramp.js', import.meta.url));
const ramp = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });

test('--help and --version', () => {
  const h = ramp('--help');
  assert.equal(h.status, 0);
  assert.match(h.stdout, /Usage:/);
  for (const cmd of ['state', 'buy', 'sell', 'snipe', 'chart', 'plan', 'sim', 'bundle', 'ui', 'mcp']) assert.match(h.stdout, new RegExp(`ramp ${cmd}`));
  assert.match(ramp('--version').stdout, /^1\.1\.0/);
});

test('state prints graduation info', () => {
  const r = ramp('state', '--sol-price', '150');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /SOL to graduate\s+85\.0054 SOL/);
  assert.match(r.stdout, /\$61,632/);
});

test('buy, sell, snipe and chart run', () => {
  assert.match(ramp('buy', '1').stdout, /Tokens out\s+34,277,831\.56/);
  assert.match(ramp('sell', '1000000', '--from-raised', '5').stdout, /SOL out/);
  assert.match(ramp('snipe', '--buyers', '3', '--each', '0.5').stdout, /#3/);
  const chart = ramp('chart', '--width', '20');
  assert.equal(chart.status, 0);
  assert.match(chart.stdout, /\*/);
});

test('json mode returns parseable JSON', () => {
  const s = JSON.parse(ramp('state', '--raised', '40', '--json', '--sol-price', '200').stdout);
  assert.equal(s.solRaised, 40);
  assert.equal(s.marketCapUsd, s.marketCap * 200);
  const b = JSON.parse(ramp('buy', '2', '--fee', '1.25', '--json').stdout);
  assert.equal(b.type, 'buy');
  assert.equal(b.fee, 0.025);
  assert.equal(b.curve, undefined);
  const sn = JSON.parse(ramp('snipe', '--buyers', '5', '--json').stdout);
  assert.equal(sn.rows.length, 5);
  assert.equal(JSON.parse(ramp('chart', '--json', '--width', '15').stdout).points.length, 15);
});

test('errors exit non-zero with a clear message', () => {
  const cases = [
    [['buy'], /exactly one <sol>/],
    [['buy', 'abc'], /non-negative number/],
    [['sell', '100'], /--from-raised/],
    [['state', '--sold', '1', '--raised', '1'], /either --sold or --raised/],
    [['nope'], /unknown command/],
    [['buy', '1', '--width', '3'], /unknown option --width/],
    [['state', '--fee'], /needs a value/],
    [['state', '--curve-tokens', '2000000000'], /curve tokens/],
  ];
  for (const [args, re] of cases) {
    const r = ramp(...args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, re);
  }
});

test('presets: custom config file and explicit overrides', () => {
  const cfg = fileURLToPath(new URL('../fixtures/custom-curve.json', import.meta.url));
  const s = JSON.parse(ramp('state', '--preset', 'custom', '--config', cfg, '--json').stdout);
  assert.equal(s.virtualSol, 40);
  assert.equal(s.feePct, 1.25);
  const implied = JSON.parse(ramp('state', '--config', cfg, '--fee', '0.5', '--json').stdout);
  assert.equal(implied.virtualSol, 40);
  assert.equal(implied.feePct, 0.5);
  assert.equal(JSON.parse(ramp('state', '--preset', 'pumpfun', '--json').stdout).virtualSol, 30);
  assert.match(ramp('state', '--preset', 'custom').stderr, /needs a config/);
  assert.match(ramp('state', '--preset', 'nope').stderr, /unknown preset/);
});

test('plan, sim, bundle and chart --svg run from the CLI', () => {
  assert.match(ramp('plan', '--own', '5%').stdout, /Spend\s+1\.4811 SOL/);
  assert.match(ramp('plan', '--target-mcap', '100000', '--sol-price', '150').stdout, /not reachable/);
  assert.match(ramp('plan', '--target-mcap', '50000', '--sol-price', '150').stdout, /SOL raised needed\s+73\.5857 SOL/);
  assert.match(ramp('plan', '--budget', '3').stdout, /60 SOL/);
  const sim = ramp('sim', '--runs', '30', '--seed', '9');
  assert.equal(sim.status, 0);
  assert.match(sim.stdout, /Graduated\s+\d+\/30/);
  assert.deepEqual(JSON.parse(ramp('sim', '--runs', '30', '--seed', '9', '--json').stdout), JSON.parse(ramp('sim', '--runs', '30', '--seed', '9', '--json').stdout));
  assert.match(ramp('bundle', '--wallets', '8', '--each', '0.5').stdout, /Concentration\s+1\.39x/);
  const out = join(mkdtempSync(join(tmpdir(), 'ramp-')), 'c.svg');
  assert.equal(ramp('chart', '--svg', out).status, 0);
  const svg = readFileSync(out, 'utf8');
  assert.match(svg, /^<svg/);
  assert.match(svg, /Graduation: 85\.01 SOL raised/);
  assert.doesNotMatch(svg, /[\u2013\u2014]/);
});

test('new commands validate their input', () => {
  const cases = [
    [['plan'], /exactly one of/],
    [['plan', '--own', '5', '--budget', '1'], /exactly one of/],
    [['plan', '--own', '90'], /more than/],
    [['sim', '--runs', '0'], /--runs/],
    [['sim', '--sell-ratio', '1'], /sell ratio/],
    [['bundle', '--wallets', 'x'], /--wallets/],
    [['state', '--rpc', 'http://127.0.0.1:1'], /--mint/],
    [['state', '--mint', 'not-an-address', '--rpc', 'http://127.0.0.1:1'], /not a valid Solana address/],
  ];
  for (const [args, re] of cases) {
    const r = ramp(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, re, args.join(' '));
  }
});
