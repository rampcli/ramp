// Website: browser live mode (src/chain.js and its docs/lib copy), the /api/rpc proxy, and an
// end to end run of docs/ against local mocks (skipped when Playwright is not installed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import * as chain from '../src/chain.js';
import * as live from '../src/live.js';
import { fixture } from '../fixtures/mock-rpc.js';
import { startMockSite, MINTS, RAISED, SOL_USD, dexData } from '../fixtures/mock-site.js';
import { createRpcHandler, checkRequest, upstreams, MAX_BODY } from '../api/rpc.js';
import { startDevSite } from '../scripts/dev-site.mjs';
import { LIB_COPIES } from '../scripts/build-docs.mjs';
import { Curve } from '../src/math.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const sha256 = async (d) => createHash('sha256').update(d).digest();

test('docs/lib copies are identical to src', () => {
  for (const [src, copy] of LIB_COPIES) assert.equal(read(copy), read(src), `${copy} is stale, run npm run build:docs`);
});

test('chain.js is browser safe (no imports, no Node globals)', () => {
  const src = read('src/chain.js');
  assert.doesNotMatch(src, /^import /m);
  assert.doesNotMatch(src, /\b(require|process|Buffer)\b/);
});

test('chain.js agrees with the CLI live module', async () => {
  for (const m of [fixture.mint, MINTS.curve, MINTS.bonded, MINTS.other]) {
    assert.deepEqual(await chain.bondingCurveAddress(m, sha256), live.bondingCurveAddress(m), m);
  }
  const bytes = chain.base64Bytes(fixture.base64);
  assert.deepEqual(chain.decodeBondingCurve(bytes), live.decodeBondingCurve(Buffer.from(fixture.base64, 'base64')));
  assert.deepEqual([...chain.BONDING_CURVE_DISCRIMINATOR], [...live.BONDING_CURVE_DISCRIMINATOR]);
  for (const hex of ['', '00', '0000ff', 'deadbeef']) {
    const b = Uint8Array.from(Buffer.from(hex, 'hex'));
    assert.equal(chain.base58Encode(b), live.base58Encode(b));
    assert.deepEqual([...chain.base58Decode(chain.base58Encode(b))], [...b]);
  }
  const bad = Uint8Array.from(bytes); bad[0] ^= 1;
  assert.throws(() => chain.decodeBondingCurve(bad), (e) => e.kind === 'bad-account');
  assert.equal(chain.isAddress('not-a-mint'), false);
  assert.equal(chain.isAddress(MINTS.curve), true);
  assert.throws(() => chain.addressBytes('0OIl'), (e) => e.kind === 'bad-address');
});

test('loadBondingCurve against a mock RPC: live, bonded, missing, rate limited', async () => {
  const mock = await startMockSite();
  try {
    const opts = { rpcUrl: mock.rpcUrl, sha256 };
    const l = await chain.loadBondingCurve({ mint: MINTS.curve, ...opts });
    assert.equal(l.slot, 312345678);
    assert.equal(l.address, live.bondingCurveAddress(MINTS.curve).address);
    const ci = chain.curveInput(l);
    assert.equal(ci.complete, false);
    assert.equal(ci.supply, 1e9);
    const s = new Curve({ supply: ci.supply }).withReserves(ci).state();
    assert.ok(Math.abs(s.solRaised - RAISED) < 1e-6);
    assert.ok(Math.abs(s.solToGraduate - (85.0054 - RAISED)) < 0.001);
    assert.equal(chain.curveInput(await chain.loadBondingCurve({ mint: MINTS.bonded, ...opts })).complete, true);
    await assert.rejects(chain.loadBondingCurve({ mint: MINTS.missing, ...opts }), (e) => e.kind === 'not-found');
    await assert.rejects(chain.loadBondingCurve({ mint: MINTS.limited, ...opts }), (e) => e.kind === 'rate-limited' && /rate limited/.test(e.message));
    await assert.rejects(chain.loadBondingCurve({ mint: 'nope', ...opts }), (e) => e.kind === 'bad-address');
    await assert.rejects(chain.loadBondingCurve({ mint: MINTS.curve, rpcUrl: 'http://127.0.0.1:1/x', sha256 }), (e) => e.kind === 'unreachable');
  } finally { await mock.close(); }
});

test('DexScreener helpers pick the right mint, pair, meta and SOL price', async () => {
  const d = dexData();
  assert.equal(chain.pickPumpMint(d.profiles), MINTS.curve, 'skips other chains and mints not ending in pump');
  assert.equal(chain.pickPumpMint([]), null);
  assert.equal(chain.pickPumpMint({ nope: 1 }), null);
  const bonded = d.pairs[MINTS.bonded];
  assert.equal(chain.bestPair(bonded, { graduated: true }).dexId, 'pumpswap');
  assert.equal(chain.bestPair([]), null);
  assert.deepEqual(chain.tokenMeta(d.pairs[MINTS.curve], MINTS.curve), { name: 'Test Ramp Coin', symbol: 'TRAMP', image: null });
  assert.ok(Math.abs(chain.solUsdFrom(d.pairs[MINTS.curve]) - SOL_USD) < 1e-6);
  assert.equal(chain.solUsdFrom([]), null);
  const mock = await startMockSite();
  try {
    assert.equal(await chain.latestPumpMint({ base: mock.dexUrl }), MINTS.curve);
    assert.equal((await chain.tokenPairs(MINTS.other, { base: mock.dexUrl }))[0].dexId, 'raydium');
    assert.deepEqual(await chain.tokenPairs(MINTS.missing, { base: mock.dexUrl }), []);
  } finally { await mock.close(); }
});

// ---------------------------------------------------------------- /api/rpc

function fakeReq(method, body, { parsed = false, headers = {} } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from(method === 'POST' && !parsed ? [Buffer.from(raw)] : []);
  req.method = method;
  req.headers = headers;
  if (parsed) req.body = body;
  return req;
}
function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = (b) => { res.body = b || ''; res.done = true; };
  res.json = () => JSON.parse(res.body);
  return res;
}
const call = async (h, method, body, o) => { const res = fakeRes(); await h(fakeReq(method, body, o), res); return res; };
const ok = (address) => ({ jsonrpc: '2.0', id: 9, method: 'getAccountInfo', params: [address, { encoding: 'base64', commitment: 'confirmed' }] });

test('rpc proxy only forwards getAccountInfo with a base58 address', () => {
  assert.ok(checkRequest(ok(MINTS.curve)).method);
  assert.match(checkRequest({ ...ok(MINTS.curve), method: 'sendTransaction' }).error, /not allowed/);
  assert.match(checkRequest([ok(MINTS.curve)]).error, /batch/);
  assert.match(checkRequest({ ...ok(MINTS.curve), params: ['x'] }).error, /params/);
  assert.match(checkRequest({ ...ok(MINTS.curve), params: [MINTS.curve, { encoding: 'jsonParsed' }] }).error, /base64/);
  assert.deepEqual(checkRequest({ ...ok(MINTS.curve), params: [MINTS.curve, { encoding: 'base64', dataSlice: { offset: 0 } }] }).params, [MINTS.curve, { encoding: 'base64' }]);
  assert.deepEqual(upstreams({}), ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']);
  assert.equal(upstreams({ SOLANA_RPC_URL: 'https://example.invalid/rpc' })[0], 'https://example.invalid/rpc');
});

test('rpc proxy: fallback, cache, rate limits and bad requests', async () => {
  const seen = [];
  let now = 1000;
  const fetchImpl = async (url, init) => {
    seen.push(url);
    const msg = JSON.parse(init.body);
    if (url === 'https://a.invalid') return new Response('forbidden', { status: 403 });
    if (url === 'https://limited.invalid') return new Response('{}', { status: 429 });
    if (url === 'https://slow.invalid') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    return Response.json({ jsonrpc: '2.0', id: msg.id, result: { context: { slot: 5 }, value: null } });
  };
  const h = createRpcHandler({ upstreams: ['https://a.invalid', 'https://b.invalid'], fetchImpl, now: () => now });
  let r = await call(h, 'POST', ok(MINTS.curve));
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().id, 9);
  assert.equal(r.json().result.context.slot, 5);
  assert.deepEqual(seen, ['https://a.invalid', 'https://b.invalid'], 'falls back past a 403');
  assert.equal(r.headers['x-ramp-cache'], 'miss');
  assert.ok(r.headers['cache-control']);
  r = await call(h, 'POST', { ...ok(MINTS.curve), id: 'abc' }, { parsed: true });
  assert.equal(r.headers['x-ramp-cache'], 'hit', 'identical request served from cache (Vercel pre-parsed body)');
  assert.equal(r.json().id, 'abc');
  assert.equal(seen.length, 2);
  now += 16000;
  await call(h, 'POST', ok(MINTS.curve));
  assert.equal(seen.length, 4, 'cache expires after 15s');

  assert.equal((await call(h, 'GET', '')).statusCode, 405);
  assert.equal((await call(h, 'POST', 'nope')).statusCode, 400);
  assert.equal((await call(h, 'POST', { ...ok(MINTS.curve), method: 'getTokenLargestAccounts' })).statusCode, 400);
  assert.equal((await call(h, 'POST', 'x'.repeat(MAX_BODY + 10))).statusCode, 413);
  assert.equal((await call(h, 'POST', ok(MINTS.curve), { headers: { 'content-length': '99999' } })).statusCode, 413);

  const lim = createRpcHandler({ upstreams: ['https://limited.invalid', 'https://slow.invalid'], fetchImpl, timeoutMs: 50 });
  r = await call(lim, 'POST', ok(MINTS.curve));
  assert.equal(r.statusCode, 429);
  assert.match(r.json().error.message, /rate limited/);
  const down = createRpcHandler({ upstreams: ['https://slow.invalid'], fetchImpl, timeoutMs: 50 });
  assert.equal((await call(down, 'POST', ok(MINTS.curve))).statusCode, 502, 'a timeout gives a gateway error');
});

test('dev site serves docs/ and routes /api/rpc like Vercel', async () => {
  const mock = await startMockSite();
  const site = await startDevSite({ port: 0, rpcUpstreams: [mock.rpcUrl] });
  try {
    const page = await fetch(site.url + '/');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /id="live-form"/);
    assert.match(html, /<script type="module" src="app.js"><\/script>/);
    assert.equal((await fetch(site.url + '/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await fetch(site.url + '/lib/chain.js')).status, 200);
    assert.equal((await fetch(site.url + '/../package.json')).status, 404);
    assert.equal((await fetch(site.url + '/api/nope')).status, 404);
    const pda = live.bondingCurveAddress(MINTS.curve).address;
    const r = await fetch(site.url + '/api/rpc', { method: 'POST', body: JSON.stringify(ok(pda)) });
    assert.equal(r.status, 200);
    assert.ok((await r.json()).result.value.data[0].length > 60);
  } finally { await site.close(); await mock.close(); }
});

// ---------------------------------------------------------------- end to end in Chromium

const PW = '/home/claude/src-reels/tools/node_modules/playwright/index.mjs';
const CHROME = '/opt/pw-browsers/chromium';
const canBrowse = existsSync(PW) && existsSync(CHROME);

test('site end to end against mocks', { skip: !canBrowse && 'playwright not installed here', timeout: 90000 }, async () => {
  const { chromium } = await import(PW);
  const mock = await startMockSite();
  const site = await startDevSite({ port: 0, rpcUpstreams: [mock.rpcUrl] });
  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => errors.push(e.message));
    const open = (q = '') => page.goto(`${site.url}/?dex=${encodeURIComponent(mock.dexUrl)}${q}`);
    await open();
    assert.equal(await page.locator('#live').isHidden(), true, 'empty state: the model, no live panel');
    assert.match(await page.textContent('#s-bond'), /^0\.00%$/);

    // example button: newest pump.fun profile from (mock) DexScreener
    await page.click('#live-example');
    await page.waitForSelector('#live[data-state=curve]');
    assert.equal(await page.inputValue('#mint'), MINTS.curve);
    assert.match(page.url(), new RegExp(`mint=${MINTS.curve}`));
    const expected = new Curve().withRaised(RAISED).state();
    assert.equal(await page.textContent('[data-k=progress]'), expected.progressPct.toFixed(2) + '%');
    assert.match(await page.textContent('[data-k=left]'), new RegExp(expected.solToGraduateWithFee.toFixed(3)));
    assert.match(await page.textContent('#live'), /Test Ramp Coin/);
    assert.match(await page.textContent('#live'), /not financial advice/);
    assert.match(await page.textContent('#pg-raised-v'), /52\.400 SOL/);
    assert.equal(await page.isDisabled('#pg-raised'), true);
    assert.match(await page.textContent('#pg-svg'), /you are here/);
    assert.match(await page.textContent('#pg-cli'), new RegExp(`ramp buy 1 --mint ${MINTS.curve}`));
    assert.equal(await page.inputValue('#pg-solusd'), String(SOL_USD), 'SOL price taken from DexScreener');
    await page.click('#pg-side-sell');
    assert.match(await page.textContent('#s-out'), /SOL$/);
    assert.match(await page.textContent('#pg-cli'), /^ramp sell \d+ --mint/);

    // bonded coin via typing and submit
    await page.fill('#mint', MINTS.bonded);
    await page.click('#live-go');
    await page.waitForSelector('#live[data-state=bonded]');
    assert.match(await page.textContent('#live'), /finished its bonding curve and trades on pumpswap/);
    assert.equal(await page.isDisabled('#pg-raised'), false, 'playground back on the model');

    // not a pump.fun coin but listed: show the pair
    await page.fill('#mint', MINTS.other);
    await page.click('#live-go');
    await page.waitForSelector('#live[data-state=pair]');
    assert.match(await page.textContent('#live'), /no pump\.fun bonding curve/);

    // errors
    await page.fill('#mint', 'not-a-mint');
    await page.click('#live-go');
    await page.waitForSelector('#live[data-state=error]');
    assert.match(await page.textContent('#live'), /not a Solana address/);
    await open(`&mint=${MINTS.missing}`);
    await page.waitForSelector('#live[data-state=error]');
    assert.match(await page.textContent('#live'), /no bonding curve found/);
    await open(`&mint=${MINTS.limited}`);
    await page.waitForSelector('#live[data-state=error]');
    assert.match(await page.textContent('#live'), /rate limited/);
    assert.equal(await page.locator('[data-retry]').count(), 1);
    await page.click('[data-reset]');
    assert.equal(await page.locator('#live').isHidden(), true);
    assert.doesNotMatch(page.url(), /mint=/);

    // shareable link auto-runs; no sideways scroll on a phone
    await open(`&mint=${MINTS.curve}`);
    await page.waitForSelector('#live[data-state=curve]');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await site.close();
    await mock.close();
  }
});
