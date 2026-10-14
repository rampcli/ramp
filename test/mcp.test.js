import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { startMockRpc, fixture } from '../fixtures/mock-rpc.js';

const bin = fileURLToPath(new URL('../bin/ramp.js', import.meta.url));

function server(env = {}) {
  const p = spawn(process.execPath, [bin, 'mcp'], { env: { ...process.env, ...env } });
  const pending = new Map();
  let stderr = '';
  p.stderr.on('data', (d) => { stderr += d; });
  createInterface({ input: p.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
  });
  let id = 0;
  return {
    request(method, params) {
      const mid = ++id;
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: mid, method, params }) + '\n');
      return new Promise((resolve) => pending.set(mid, resolve));
    },
    notify(method) { p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); },
    raw(line) { p.stdin.write(line + '\n'); },
    stderr: () => stderr,
    close() { p.stdin.end(); return new Promise((r) => p.on('close', r)); },
  };
}
const parse = (res) => JSON.parse(res.result.content[0].text);

test('initialize, tools/list, ping', async () => {
  const s = server();
  const init = await s.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.result.protocolVersion, '2024-11-05');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(init.result.serverInfo.name, 'ramp');
  assert.equal(init.result.serverInfo.version, '1.1.0');
  s.notify('notifications/initialized');
  assert.equal((await s.request('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18');
  assert.deepEqual((await s.request('ping')).result, {});
  const list = await s.request('tools/list');
  assert.deepEqual(list.result.tools.map((t) => t.name), ['curve_state', 'quote_buy', 'quote_sell', 'plan_dev_buy', 'simulate_launch']);
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object');
  await s.close();
  assert.match(s.stderr(), /ready/);
});

test('tools/call returns JSON text results', async () => {
  const s = server();
  const buy = parse(await s.request('tools/call', { name: 'quote_buy', arguments: { sol: 1 } }));
  assert.ok(Math.abs(buy.tokensOut - 34277831.56) < 0.01);
  const sell = parse(await s.request('tools/call', { name: 'quote_sell', arguments: { tokens: 1000000, fromRaised: 5 } }));
  assert.equal(sell.type, 'sell');
  const plan = parse(await s.request('tools/call', { name: 'plan_dev_buy', arguments: { ownPct: 5 } }));
  assert.ok(Math.abs(plan.solToSpend - 1.4811) < 0.0001);
  const mcap = parse(await s.request('tools/call', { name: 'plan_dev_buy', arguments: { targetMcap: 50000, solPrice: 150 } }));
  assert.ok(Math.abs(mcap.solRaisedNeeded - 73.5857) < 0.0001);
  const a = parse(await s.request('tools/call', { name: 'simulate_launch', arguments: { runs: 25, seed: 7 } }));
  const b = parse(await s.request('tools/call', { name: 'simulate_launch', arguments: { runs: 25, seed: 7 } }));
  assert.deepEqual(a, b);
  assert.equal(a.samples, undefined);
  const custom = parse(await s.request('tools/call', { name: 'curve_state', arguments: { preset: 'custom', config: { virtualSol: 40 } } }));
  assert.equal(custom.virtualSol, 40);
  await s.close();
});

test('tool errors become isError results, protocol errors become JSON-RPC errors', async () => {
  const s = server();
  const err = await s.request('tools/call', { name: 'quote_sell', arguments: { tokens: 10, fromRaised: 0 } });
  assert.equal(err.result.isError, true);
  assert.match(err.result.content[0].text, /nothing has been bought/);
  assert.equal((await s.request('tools/call', { name: 'nope', arguments: {} })).error.code, -32602);
  assert.equal((await s.request('tools/call', { name: 'quote_buy', arguments: {} })).error.code, -32602);
  assert.equal((await s.request('tools/call', { name: 'quote_buy', arguments: { sol: 'x' } })).error.code, -32602);
  assert.equal((await s.request('resources/list')).error.code, -32601);
  await s.close();
});

test('curve_state live mode against a mock RPC', async () => {
  const rpc = await startMockRpc();
  const s = server({ RAMP_RPC_URL: rpc.url });
  try {
    const st = parse(await s.request('tools/call', { name: 'curve_state', arguments: { curve: fixture.curve } }));
    assert.equal(st.live.address, fixture.curve);
    assert.ok(Math.abs(st.solRaised - 20) < 1e-9);
  } finally { await s.close(); await rpc.close(); }
});
