// Local mock of a Solana JSON-RPC endpoint for tests. Serves getAccountInfo from the fixture.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

export const fixture = JSON.parse(readFileSync(new URL('./bonding-curve-account.json', import.meta.url), 'utf8'));
export const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

/** Start a mock RPC. `accounts` maps address -> { base64, owner }. Resolves to { url, close, calls }. */
export async function startMockRpc(accounts = { [fixture.curve]: { base64: fixture.base64, owner: PUMP } }) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const msg = JSON.parse(body);
      calls.push(msg);
      const acc = accounts[msg.params?.[0]];
      const result = { context: { slot: 312000000 }, value: acc ? { data: [acc.base64, 'base64'], owner: acc.owner, lamports: 1, executable: false } : null };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}
