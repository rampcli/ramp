import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, SIM_DEFAULTS, CurveError, chartPoints, histogram } from './math.js';
import { makeCurve, fetchLive, liveSummary, api } from './core.js';
import { curveSvg } from './chart.js';
import * as f from './format.js';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const CURVE_FLAGS = ['preset', 'config', 'sol-price', 'fee', 'virtual-sol', 'virtual-tokens', 'curve-tokens', 'supply', 'rpc', 'mint', 'curve'];
const GLOBAL_FLAGS = ['json', 'help', 'version'];
const COMMAND_FLAGS = {
  state: [...CURVE_FLAGS, 'sold', 'raised'],
  buy: [...CURVE_FLAGS, 'from-raised'],
  sell: [...CURVE_FLAGS, 'from-raised'],
  snipe: [...CURVE_FLAGS, 'buyers', 'each', 'from-raised'],
  chart: [...CURVE_FLAGS, 'width', 'height', 'svg', 'from-raised'],
  plan: [...CURVE_FLAGS, 'own', 'target-mcap', 'budget', 'at', 'from-raised'],
  sim: [...CURVE_FLAGS, 'runs', 'snipers', 'sniper-sol', 'dev-buy', 'max-trades', 'within', 'min-buy', 'max-buy', 'sell-ratio', 'sell-jitter', 'new-wallets', 'seed', 'from-raised'],
  bundle: [...CURVE_FLAGS, 'wallets', 'each', 'gap', 'from-raised'],
  ui: [...CURVE_FLAGS, 'port', 'host'],
  mcp: [],
};
const BOOLEAN_FLAGS = new Set(['json', 'help', 'version']);

export const HELP = `ramp ${VERSION}
pump.fun curve math. know when it bonds.

Usage:
  ramp state [--sold <tokens> | --raised <sol>]
  ramp buy <sol> [--from-raised <sol>]
  ramp sell <tokens> [--from-raised <sol>]
  ramp plan --own <pct> | --target-mcap <n> | --budget <sol> [--at 0,20,40,60]
  ramp sim [--runs 200] [--snipers 5] [--sniper-sol 1] [--dev-buy 1] [--seed 1]
  ramp bundle [--wallets 8] [--each 0.5] [--gap 2]
  ramp snipe [--buyers 10] [--each 1]
  ramp chart [--width 60] [--height 12] [--svg out.svg]
  ramp ui [--port 4178]
  ramp mcp

Commands:
  state    price, mcap, curve progress and SOL left until it bonds
  buy      what <sol> gets you, fee included
  sell     what <tokens> sells for, after fee
  plan     dev buy: SOL to own X%, SOL to hit an mcap, or what a budget buys
  sim      seeded launch sim: snipers, random flow, odds it bonds, top 10 share
  bundle   how much more supply a bundled slot grabs vs the same buys spread out
  snipe    buyers in a row at launch (default 10 x 1 SOL)
  chart    ascii mcap vs SOL raised; --svg writes price vs SOL raised
  ui       local dashboard with the playground and the sim
  mcp      MCP server over stdio for Claude, Cursor and other agents

Curve parameters:
  --preset <name>           pumpfun (default) or custom
  --config <file.json>      Parameters for --preset custom (implies it)
  --virtual-sol <sol>       Initial virtual SOL reserves      (default ${DEFAULTS.virtualSol})
  --virtual-tokens <n>      Initial virtual token reserves    (default ${DEFAULTS.virtualTokens})
  --curve-tokens <n>        Tokens sold on the curve          (default ${DEFAULTS.curveTokens})
  --supply <n>              Total token supply                (default ${DEFAULTS.supply})
  --fee <pct>               Trading fee in percent            (default ${DEFAULTS.fee})
  --from-raised <sol>       Start from a curve holding this much net SOL

Simulator (sim):
  --runs <n>  --snipers <n>  --sniper-sol <sol[,sol...]>  --dev-buy <sol>  --seed <s>
  --max-trades <n> (${SIM_DEFAULTS.maxTrades})  --within <n> (${SIM_DEFAULTS.within})  --min-buy <sol> (${SIM_DEFAULTS.minBuy})  --max-buy <sol> (${SIM_DEFAULTS.maxBuy})
  --sell-ratio <0-1> (${SIM_DEFAULTS.sellRatio})  --sell-jitter <0-1> (${SIM_DEFAULTS.sellJitter})  --new-wallets <0-1> (${SIM_DEFAULTS.newWalletRatio})

Live mode (state, buy, sell, plan, chart, sim, bundle, snipe):
  --rpc <url>               Solana RPC endpoint (or RAMP_RPC_URL)
  --mint <address>          Token mint; the bonding curve PDA is derived from it
  --curve <address>         Bonding curve account address, instead of --mint

Output:
  --sol-price <usd>         Also show values in USD
  --json                    Print machine-readable JSON
  -h, --help                Show this help
  -v, --version             Show the version

Examples:
  ramp buy 2
  ramp plan --own 5%
  ramp plan --target-mcap 100000 --sol-price 150
  ramp sim --snipers 10 --sniper-sol 0.5,1,2 --seed 42
  ramp bundle --wallets 8 --each 0.5
  ramp chart --svg curve.svg
`;

export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { flags.help = true; continue; }
    if (a === '-v') { flags.version = true; continue; }
    if (!a.startsWith('--')) { positional.push(a); continue; }
    let [name, value] = a.slice(2).split(/=(.*)/s);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = true; continue; }
    if (value === undefined) {
      value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new CurveError(`option --${name} needs a value`);
    }
    flags[name] = value;
  }
  return { command: positional[0], args: positional.slice(1), flags };
}

function positiveNumber(value, name) {
  const n = Number(String(value).replace(/%$/, ''));
  if (!Number.isFinite(n) || n <= 0) throw new CurveError(`${name} must be a positive number, got "${value}"`);
  return n;
}
function nonNegative(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new CurveError(`${name} must be zero or more, got "${value}"`);
  return n;
}
function integer(value, name, min) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new CurveError(`${name} must be an integer of at least ${min}, got "${value}"`);
  return n;
}
const list = (value, name) => String(value).split(',').map((v) => positiveNumber(v.trim(), name));
const opt = (flags, key, fn, ...rest) => (flags[key] === undefined ? undefined : fn(flags[key], `--${key}`, ...rest));

function arg(args, name) {
  if (args.length !== 1) throw new CurveError(`expected exactly one <${name}> argument`);
  return args[0];
}
function noArgs(cmd, args) {
  if (args.length) throw new CurveError(`${cmd} takes no positional arguments`);
}

function curveOpts(flags, live) {
  if (live && flags['from-raised'] !== undefined) throw new CurveError('--from-raised cannot be combined with live mode');
  return {
    preset: flags.preset,
    configPath: flags.config,
    params: {
      virtualSol: flags['virtual-sol'], virtualTokens: flags['virtual-tokens'], curveTokens: flags['curve-tokens'],
      supply: flags.supply, fee: flags.fee,
    },
    fromRaised: flags['from-raised'],
    live,
  };
}

const commands = {
  state(c, args, flags, sp, ctx) {
    noArgs('state', args);
    if (flags.sold !== undefined && flags.raised !== undefined) throw new CurveError('use either --sold or --raised, not both');
    if (ctx.live && (flags.sold !== undefined || flags.raised !== undefined)) throw new CurveError('--sold and --raised cannot be combined with live mode');
    if (flags.sold !== undefined) c = c.withSold(flags.sold);
    if (flags.raised !== undefined) c = c.withRaised(flags.raised);
    const s = c.state();
    let json = { ...s };
    if (sp) { json.solPrice = sp; json.marketCapUsd = s.marketCap * sp; json.graduationMarketCapUsd = s.graduationMarketCap * sp; }
    const pairs = [];
    if (ctx.live) {
      const l = liveSummary(ctx.live);
      json = { ...json, live: l };
      pairs.push(['Account', l.address], ['Real SOL', f.solAmt(l.realSol)]);
    }
    pairs.push(
      ['SOL raised', f.solAmt(s.solRaised)],
      ['Tokens sold', `${f.tokens(s.tokensSold)} (${f.percent(s.soldPctOfSupply)} of supply)`],
      ['Price', f.price(s.price)],
      ['Market cap', f.mcap(s.marketCap, sp)],
      ['Progress', f.percent(s.progressPct)],
      ['SOL to graduate', s.complete ? 'graduated' : `${f.solAmt(s.solToGraduate)} (${f.solAmt(s.solToGraduateWithFee)} incl. ${s.feePct}% fee)`],
      ['Graduation mcap', f.mcap(s.graduationMarketCap, sp)],
    );
    return { json, text: f.keyValues(ctx.live ? 'Curve state (live)' : 'Curve state', pairs) };
  },

  buy(c, args, flags, sp) {
    const r = api.quoteBuy({ ...ctxOpts(c), sol: arg(args, 'sol'), solPrice: sp });
    const pairs = [
      ['Starting at', `${f.solAmt(c.state().solRaised)} raised, mcap ${f.mcap(r.marketCapBefore, sp)}`],
      ['SOL spent', `${f.solAmt(r.solIn)} (fee ${f.solAmt(r.fee)})`],
      ['Tokens out', f.tokens(r.tokensOut)],
      ['Share of supply', f.percent(r.supplyPct)],
      ['Avg price', f.price(r.avgPrice)],
      ['Price impact', `${f.signedPercent(r.priceImpactPct)} (avg price vs spot, fee included)`],
      ['Price after', `${f.price(r.priceAfter)} (${f.signedPercent(r.priceChangePct)})`],
      ['Market cap', `${f.mcap(r.marketCapBefore, sp)} -> ${f.mcap(r.marketCapAfter, sp)}`],
      ['Progress after', f.percent(r.progressPctAfter)],
    ];
    if (r.capped) pairs.push(['Note', `buy capped at graduation, ${f.solAmt(r.unusedSol)} not spent`]);
    return { json: r, text: f.keyValues(`Buy ${args[0]} SOL (fee ${c.state().feePct}%)`, pairs) };
  },

  sell(c, args, flags, sp) {
    if (c.tokensSold === 0n) throw new CurveError('nothing has been bought at launch, pass --from-raised <sol> to start from a later point');
    const r = api.quoteSell({ ...ctxOpts(c), tokens: arg(args, 'tokens'), solPrice: sp });
    const text = f.keyValues(`Sell ${f.tokens(r.tokensIn)} tokens (fee ${c.state().feePct}%)`, [
      ['SOL out', `${f.solAmt(r.solOut)}${sp ? ` (${f.usd(r.solOut * sp)})` : ''} after ${f.solAmt(r.fee)} fee`],
      ['Avg price', f.price(r.avgPrice)],
      ['Price impact', `${f.signedPercent(-r.priceImpactPct)} (avg price vs spot, fee included)`],
      ['Price after', `${f.price(r.priceAfter)} (${f.signedPercent(r.priceChangePct)})`],
      ['Market cap', `${f.mcap(r.marketCapBefore, sp)} -> ${f.mcap(r.marketCapAfter, sp)}`],
    ]);
    return { json: r, text };
  },

  plan(c, args, flags, sp) {
    noArgs('plan', args);
    const o = {
      ...ctxOpts(c), solPrice: sp,
      ownPct: opt(flags, 'own', positiveNumber), targetMcap: opt(flags, 'target-mcap', positiveNumber), budget: opt(flags, 'budget', positiveNumber),
      at: flags.at !== undefined ? String(flags.at).split(',').map((v) => nonNegative(v.trim(), '--at')) : undefined,
    };
    const r = api.planDevBuy(o);
    const start = c.state();
    const from = start.solRaised > 0 ? ` from ${f.solAmt(start.solRaised)} raised` : ' at launch';
    if (r.mode === 'own') {
      return { json: r, text: f.keyValues(`Own ${r.targetPct}% of supply${from} (fee ${start.feePct}%)`, [
        ['Spend', `${f.solAmt(r.solToSpend)}${sp ? ` (${f.usd(r.solToSpend * sp)})` : ''}, fee ${f.solAmt(r.fee)}`],
        ['Tokens out', `${f.tokens(r.tokensOut)} (${f.percent(r.supplyPct, 4)} of supply)`],
        ['Avg price', f.price(r.avgPrice)],
        ['Price impact', f.signedPercent(r.priceImpactPct)],
        ['Market cap', `${f.mcap(r.marketCapBefore, sp)} -> ${f.mcap(r.marketCapAfter, sp)}`],
        ['Progress after', f.percent(r.progressPctAfter)],
      ]) };
    }
    if (r.mode === 'target-mcap') {
      const unit = (v) => (sp ? f.usd(v * sp) : `${f.num(v, 2)} SOL`);
      const title = `Reach a market cap of ${sp ? f.usd(r.targetInput) : `${f.num(r.targetInput, 2)} SOL`}`;
      let pairs;
      if (r.alreadyReached) pairs = [['Result', `already there: current mcap is ${unit(r.currentMarketCap)}`]];
      else if (!r.reachable) {
        pairs = [
          ['Result', 'not reachable on the curve'],
          ['Graduation mcap', `${unit(r.graduationMarketCap)} (the curve completes before your target)`],
        ];
      } else {
        pairs = [
          ['SOL raised needed', `${f.solAmt(r.solRaisedNeeded)} net in the curve`],
          ['From here', `${f.solAmt(r.solToAdd)} net, ${f.solAmt(r.solToAddWithFee)} with fee`],
          ['Progress at target', f.percent(r.progressPctAt)],
          ['Tokens sold', f.tokens(r.tokensSoldAt)],
          ['Graduation mcap', unit(r.graduationMarketCap)],
        ];
      }
      return { json: r, text: f.keyValues(title, pairs) };
    }
    const rows = r.rows.map((row) => [
      `${f.num(row.raised, 2)} SOL`, f.tokens(row.tokensOut), f.percent(row.supplyPct), f.mcap(row.avgEntryMarketCap, sp), f.signedPercent(row.priceImpactPct), `${row.vsFirst.toFixed(2)}x`,
    ]);
    const text = [
      `What ${r.budget} SOL buys at different points on the curve (fee ${start.feePct}%)`, '',
      f.table(['Raised', 'Tokens', '% supply', 'Avg entry mcap', 'Impact', 'vs first'], rows),
    ];
    if (r.rows.length > 1) text.push('', `Buying at ${f.num(r.rows[r.rows.length - 1].raised, 2)} SOL raised gets ${r.rows[r.rows.length - 1].vsFirst.toFixed(2)}x the tokens of buying at ${f.num(r.rows[0].raised, 2)} SOL raised.`);
    return { json: r, text: text.join('\n') };
  },

  sim(c, args, flags) {
    noArgs('sim', args);
    const sim = {
      runs: opt(flags, 'runs', integer, 1), snipers: opt(flags, 'snipers', integer, 0),
      sniperSol: flags['sniper-sol'] !== undefined ? list(flags['sniper-sol'], '--sniper-sol') : undefined,
      devBuy: opt(flags, 'dev-buy', nonNegative), maxTrades: opt(flags, 'max-trades', integer, 1), within: opt(flags, 'within', integer, 1),
      minBuy: opt(flags, 'min-buy', positiveNumber), maxBuy: opt(flags, 'max-buy', positiveNumber),
      sellRatio: opt(flags, 'sell-ratio', nonNegative), sellJitter: opt(flags, 'sell-jitter', nonNegative), newWalletRatio: opt(flags, 'new-wallets', nonNegative),
      seed: flags.seed,
    };
    const r = api.simulate({ ...ctxOpts(c), sim, samples: true });
    const o = r.options;
    const st = (s, d = 2) => (s.mean === null ? 'n/a' : `mean ${f.num(s.mean, d)}  p10 ${f.num(s.p10, d)}  p50 ${f.num(s.p50, d)}  p90 ${f.num(s.p90, d)}`);
    const grads = r.samples.filter((x) => x.graduated).map((x) => x.trades);
    const hist = histogram(grads, 8, 0, o.maxTrades).map((b) => ({ label: `${Math.round(b.from)}-${Math.round(b.to)}`, count: b.count }));
    const text = [
      `Launch simulation: ${r.runs} runs, seed ${o.seed}`,
      `  launch slot: dev buy ${o.devBuy} SOL, ${o.snipers} snipers (${o.sniperSol.join(', ')} SOL)`,
      `  then up to ${o.maxTrades} trades: buys ${o.minBuy}-${o.maxBuy} SOL, sells ${f.percent(o.sellRatio * 100, 0)} +/- ${f.percent(o.sellJitter * 100, 0)} of trades`,
      '',
      f.keyValues('Results', [
        ['Graduated', `${r.graduated}/${r.runs} (${f.percent(r.graduationRate * 100, 1)})`],
        [`Within ${o.within} trades`, f.percent(r.graduatedWithin.probability * 100, 1)],
        ['Trades to graduate', st(r.tradesToGraduate, 0)],
        ['Sniper share %', st(r.sniperSharePct)],
        ['Dev share %', st(r.devSharePct)],
        ['Top 10 share %', st(r.top10SharePct)],
        ['Holders', st(r.holders, 0)],
      ]),
      '',
      'Trades to graduate (graduated runs)',
      f.bars(hist),
      '',
      'Shares are % of total supply at graduation or at the last trade. Model, not a forecast.',
    ];
    return { json: { ...r, samples: undefined }, text: text.join('\n') };
  },

  bundle(c, args, flags, sp) {
    noArgs('bundle', args);
    const r = api.bundle({ ...ctxOpts(c), wallets: opt(flags, 'wallets', integer, 1), each: opt(flags, 'each', positiveNumber), gapSol: opt(flags, 'gap', nonNegative) });
    const n = Math.max(r.bundled.rows.length, r.spread.rows.length);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const b = r.bundled.rows[i];
      const s = r.spread.rows[i];
      rows.push([`#${i + 1}`, b ? f.percent(b.supplyPct) : '-', b ? f.mcap(b.entryMarketCap, sp) : '-', s ? f.percent(s.supplyPct) : '-', s ? f.mcap(s.entryMarketCap, sp) : '-']);
    }
    const text = [
      `${r.bundled.wallets} wallets x ${r.each} SOL: bundled in the launch slot vs spread out (${r.gapSol} SOL of other buys between each)`, '',
      f.table(['Wallet', 'Bundled %', 'Entry mcap', 'Spread %', 'Entry mcap'], rows), '',
      f.keyValues('Summary', [
        ['Bundled', `${f.percent(r.bundled.supplyPct)} of supply for ${f.solAmt(r.bundled.sol)}`],
        ['Spread', `${f.percent(r.spread.supplyPct)} of supply for ${f.solAmt(r.spread.sol)}`],
        ['Concentration', `${r.concentration.toFixed(2)}x (+${f.percent(r.extraPct)} of supply)`],
        ['Per wallet', `${f.percent(r.bundled.smallestWalletPct)} to ${f.percent(r.bundled.largestWalletPct)} bundled, ${f.percent(r.spread.smallestWalletPct)} to ${f.percent(r.spread.largestWalletPct)} spread`],
      ]), '',
      `Signal: ${r.bundled.wallets} same-size buys in the launch slot. No single wallet tops ${f.percent(r.bundled.largestWalletPct)}, so a per-wallet holder alert can miss the combined ${f.percent(r.bundled.supplyPct)}.`,
    ];
    return { json: r, text: text.join('\n') };
  },

  snipe(c, args, flags, sp) {
    noArgs('snipe', args);
    const buyers = integer(flags.buyers ?? 10, '--buyers', 1);
    const each = positiveNumber(flags.each ?? 1, '--each');
    const s = api.snipe({ ...ctxOpts(c), buyers, each });
    const json = { ...s, rows: s.rows.map((r) => (sp ? { ...r, solPrice: sp, entryMarketCapUsd: r.entryMarketCap * sp } : r)) };
    const rows = s.rows.map((r) => [`#${r.buyer}`, f.num(r.solIn, 4), f.tokens(r.tokens), f.percent(r.supplyPct), f.percent(r.cumulativePct), f.mcap(r.entryMarketCap, sp)]);
    const lines = [`${s.rows.length} buyers x ${each} SOL, fee ${c.state().feePct}%`, '', f.table(['Buyer', 'SOL', 'Tokens', '% supply', 'Cumulative', 'Entry mcap'], rows), '',
      `Total: ${f.solAmt(s.totalSol)} in, ${f.tokens(s.totalTokens)} tokens (${f.percent(s.totalSupplyPct)} of supply)`];
    if (s.rows.length > 1) lines.push(`Buyer #1 got ${(s.rows[0].tokens / s.rows[s.rows.length - 1].tokens).toFixed(2)}x the tokens of buyer #${s.rows.length} for the same SOL.`);
    if (s.graduated) lines.push('The curve graduated during this simulation.');
    return { json, text: lines.join('\n') };
  },

  chart(c, args, flags, sp) {
    noArgs('chart', args);
    const width = integer(flags.width ?? 60, '--width', 10);
    const height = integer(flags.height ?? 12, '--height', 4);
    const points = chartPoints(c, width);
    const json = { points: points.map((p) => (sp ? { ...p, solPrice: sp, marketCapUsd: p.marketCap * sp } : p)) };
    const chart = f.asciiChart(points.map((p) => ({ x: p.raised, y: p.marketCap })), {
      height, yLabel: (v) => (sp ? f.usd(v * sp) : `${f.num(v, 1)} SOL`), xLabel: (v) => `${f.num(v, 1)} SOL`,
    });
    let text = `Market cap${sp ? ' (USD)' : ' (SOL)'} vs SOL raised, to graduation\n\n${chart}\n${' '.repeat(Math.max(0, width / 2 - 5))}SOL raised`;
    if (flags.svg) {
      writeFileSync(flags.svg, curveSvg(c, { solPrice: sp }));
      json.svg = flags.svg;
      text += `\n\nWrote ${flags.svg} (price vs SOL raised, graduation marked)`;
    }
    return { json, text };
  },
};

// Commands call api.* with the already-built curve; pass it through as a prebuilt option.
function ctxOpts(c) { return { _curve: c }; }

/** Run the CLI. Resolves to the exit code. */
export async function run(argv, io = { stdout: process.stdout, stderr: process.stderr, env: process.env }) {
  try {
    const { command, args, flags } = parseArgs(argv);
    if (flags.version) { io.stdout.write(`${VERSION}\n`); return 0; }
    if (flags.help || !command || command === 'help') { io.stdout.write(HELP); return command || flags.help ? 0 : 1; }
    if (!COMMAND_FLAGS[command]) throw new CurveError(`unknown command "${command}". Run "ramp --help" for usage`);
    const allowed = new Set([...GLOBAL_FLAGS, ...COMMAND_FLAGS[command]]);
    for (const name of Object.keys(flags)) if (!allowed.has(name)) throw new CurveError(`unknown option --${name} for "${command}"`);
    if (command === 'mcp') {
      const { startMcp } = await import('./mcp.js');
      await startMcp();
      return 0;
    }
    const sp = flags['sol-price'] !== undefined ? positiveNumber(flags['sol-price'], '--sol-price') : undefined;
    const env = io.env || process.env;
    const wantsLive = flags.mint !== undefined || flags.curve !== undefined;
    let live = null;
    if (wantsLive) live = await fetchLive({ rpc: flags.rpc ?? env.RAMP_RPC_URL, mint: flags.mint, curve: flags.curve });
    else if (flags.rpc !== undefined) throw new CurveError('--rpc needs --mint <address> or --curve <address>');
    const opts = curveOpts(flags, live);
    if (command === 'ui') {
      const { startUi } = await import('./ui.js');
      const port = flags.port !== undefined ? integer(flags.port, '--port', 0) : 4178;
      const { url } = await startUi({ port, host: flags.host || '127.0.0.1', curveOpts: { ...opts, fromRaised: undefined }, solPrice: sp });
      io.stdout.write(`ramp ui running at ${url}\nPress Ctrl+C to stop.\n`);
      return new Promise(() => {}); // keep serving
    }
    const { json, text } = commands[command](makeCurve(opts), args, flags, sp, { live });
    io.stdout.write(flags.json ? JSON.stringify(json, null, 2) + '\n' : text + '\n');
    return 0;
  } catch (err) {
    if (!(err instanceof CurveError)) throw err;
    io.stderr.write(`ramp: ${err.message}\n`);
    return 2;
  }
}
