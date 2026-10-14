import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startUi } from '../src/ui.js';
import { buildDashboard, inlineMath } from '../src/web.js';

test('dashboard serves the page and the JSON API', async () => {
  const { server, url } = await startUi({ port: 0 });
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<title>Ramp dashboard<\/title>/);
    assert.match(html, /window\.RAMP_BOOT = /);
    assert.match(html, /class Curve/, 'math.js is inlined');
    assert.doesNotMatch(html, /<script[^>]+src=/, 'no external scripts');
    const get = async (p) => { const r = await fetch(new URL(p, url)); return { status: r.status, body: await r.json() }; };
    assert.equal((await get('/api/health')).body.version, '1.1.0');
    assert.equal((await get('/api/state?raised=20')).body.solRaised, 20);
    assert.ok(Math.abs((await get('/api/quote?sol=1')).body.tokensOut - 34277831.56) < 0.01);
    assert.equal((await get('/api/quote?side=sell&amount=1000&raised=5')).body.type, 'sell');
    assert.ok(Math.abs((await get('/api/plan?own=5')).body.solToSpend - 1.4811) < 0.0001);
    assert.ok((await get('/api/bundle?wallets=8&each=0.5')).body.concentration > 1);
    const a = await get('/api/simulate?runs=20&seed=4&snipers=3&sniperSol=0.5,1');
    const b = await get('/api/simulate?runs=20&seed=4&snipers=3&sniperSol=0.5,1');
    assert.equal(a.status, 200);
    assert.deepEqual(a.body, b.body);
    assert.equal(a.body.samples.length, 20);
    const bad = await get('/api/quote?sol=abc');
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /non-negative/);
    assert.equal((await fetch(new URL('/api/nope', url))).status, 404);
    assert.equal((await fetch(new URL('/fonts/../../package.json', url))).status, 404);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  } finally { server.close(); }
});

test('inlined math evaluates in a sandbox and matches the module', async () => {
  const M = new Function(`${inlineMath()}\nreturn M;`)();
  const c = new M.Curve();
  assert.ok(Math.abs(c.buy(1).tokensOut - 34277831.56) < 0.01);
  assert.equal(typeof M.simulateLaunch, 'function');
  assert.match(buildDashboard({ version: 'x', boot: { a: '</script>' } }), /\\u003c\/script>/, 'boot JSON is escaped');
});

test('ramp ui prints its URL and serves', async () => {
  const bin = fileURLToPath(new URL('../bin/ramp.js', import.meta.url));
  const p = spawn(process.execPath, [bin, 'ui', '--port', '0']);
  try {
    const url = await new Promise((resolve, reject) => {
      p.stdout.on('data', (d) => { const m = String(d).match(/http:\/\/\S+/); if (m) resolve(m[0]); });
      p.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 10000);
    });
    assert.equal((await fetch(url)).status, 200);
  } finally { p.kill(); }
});
