// Local stand-ins for the website's upstreams, for tests and screenshots (the container has no internet).
// One server: POST /rpc answers Solana getAccountInfo, GET /dex/... mimics DexScreener (with CORS).
// All mints, accounts and market numbers here are synthetic test data, except FALLBACK (a real mint
// used only as an address; its market data below is made up).
import { createServer } from 'node:http';
import { Curve } from '../src/math.js';
import { bondingCurveAddress, encodeBondingCurve, PUMP_PROGRAM_ID } from '../src/live.js';

export const MINTS = Object.freeze({
  curve: 'RamphB8he3hK84Fo4fzbFGUg2eA2mkTQvxvKnNppump', // on the curve, 52.4 SOL raised
  bonded: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', // complete curve, trades on an AMM
  missing: 'RampGyCftHfLKw5RkUGS2iFiiCKocoeUN3ZPMAjpump', // no account, no pairs
  limited: 'RampH2vhzeFW6Muy2pUJwWUqHv61EpG8iY2YL88pump', // RPC answers 429
  other: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // not a pump.fun coin, has pairs
});
export const RAISED = 52.4;
export const SOL_USD = 180;

function account(mint, { raised = 0, complete = false } = {}) {
  const c = new Curve().withRaised(raised);
  const done = complete ? { virtualSolReserves: 0n, virtualTokenReserves: 0n, realTokenReserves: 0n, realSolReserves: 0n } : null;
  return encodeBondingCurve({
    virtualTokenReserves: done ? 0n : c.virtualTokens, virtualSolReserves: done ? 0n : c.virtualSol,
    realTokenReserves: done ? 0n : c.realTokens, realSolReserves: done ? 0n : c.solRaised,
    tokenTotalSupply: 1_000_000_000_000_000n, complete, creator: '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf',
  }).toString('base64');
}

const pair = (mint, o) => ({
  chainId: 'solana', dexId: o.dexId, url: `https://dexscreener.com/solana/${o.pairAddress}`, pairAddress: o.pairAddress,
  baseToken: { address: mint, name: o.name, symbol: o.symbol }, quoteToken: { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL' },
  priceNative: String(o.priceNative), priceUsd: String(o.priceNative * SOL_USD), liquidity: o.liq ? { usd: o.liq } : undefined,
  fdv: o.fdv, marketCap: o.fdv, volume: { h24: o.vol }, priceChange: { h24: o.chg }, info: { imageUrl: o.image },
});

export function dexData() {
  const live = new Curve().withRaised(RAISED);
  return {
    profiles: [
      { chainId: 'base', tokenAddress: '0x0000000000000000000000000000000000000001' },
      { chainId: 'solana', tokenAddress: MINTS.other },
      { chainId: 'solana', tokenAddress: MINTS.curve, icon: '' },
    ],
    pairs: {
      [MINTS.curve]: [pair(MINTS.curve, { dexId: 'pumpfun', pairAddress: 'RampPairCurve1111111111111111111111111111111', name: 'Test Ramp Coin', symbol: 'TRAMP', priceNative: live.price, fdv: live.marketCap * SOL_USD, vol: 48210, chg: 31.2 })],
      [MINTS.bonded]: [
        pair(MINTS.bonded, { dexId: 'pumpfun', pairAddress: 'RampPairBondedCurve11111111111111111111111111', name: 'Example Bonded', symbol: 'BOND', priceNative: 0.0000041, fdv: 750000, vol: 1000, chg: 0 }),
        pair(MINTS.bonded, { dexId: 'pumpswap', pairAddress: 'RampPairBondedAmm1111111111111111111111111111', name: 'Example Bonded', symbol: 'BOND', priceNative: 0.0045, liq: 2840000, fdv: 810000000, vol: 12400000, chg: -3.4 }),
      ],
      [MINTS.other]: [pair(MINTS.other, { dexId: 'raydium', pairAddress: 'RampPairOther111111111111111111111111111111', name: 'Example Stable', symbol: 'STBL', priceNative: 1 / SOL_USD, liq: 9100000, fdv: 1e9, vol: 52000000, chg: 0.01 })],
    },
  };
}

/** Start the mock. Resolves to { url, rpcUrl, dexUrl, calls, close }. */
export async function startMockSite() {
  const pda = (m) => bondingCurveAddress(m).address;
  const accounts = {
    [pda(MINTS.curve)]: account(MINTS.curve, { raised: RAISED }),
    [pda(MINTS.bonded)]: account(MINTS.bonded, { complete: true }),
  };
  const limited = pda(MINTS.limited);
  const dex = dexData();
  const calls = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    calls.push(`${req.method} ${u.pathname}`);
    const json = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(obj));
    };
    if (u.pathname === '/rpc' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const msg = JSON.parse(body);
        const addr = msg.params?.[0];
        if (addr === limited) return json(429, { jsonrpc: '2.0', id: msg.id, error: { code: 429, message: 'Too many requests' } });
        const b64 = accounts[addr];
        json(200, { jsonrpc: '2.0', id: msg.id, result: { context: { slot: 312345678 }, value: b64 ? { data: [b64, 'base64'], owner: PUMP_PROGRAM_ID, lamports: 1, executable: false } : null } });
      });
      return;
    }
    if (u.pathname === '/dex/token-profiles/latest/v1') return json(200, dex.profiles);
    const m = u.pathname.match(/^\/dex\/tokens\/v1\/solana\/(\w+)$/);
    if (m) return json(200, dex.pairs[m[1]] || []);
    json(404, { error: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, rpcUrl: `${url}/rpc`, dexUrl: `${url}/dex`, calls, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
