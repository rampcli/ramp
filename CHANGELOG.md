# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-14

### Added

- rampcli.dev opens on the tool: paste a pump.fun mint and the site loads its real bonding curve. The PDA is derived and the account decoded in the browser, the read goes through `/api/rpc`. Shows bonding progress, SOL left to bond, market cap now and at bond, and pins the playground to the real reserves with a "you are here" marker on the chart.
- Graduated coins show that they bonded plus their DexScreener pair (price, market cap, liquidity, 24h volume). Mints without a pump.fun curve show their pair when DexScreener lists one.
- "Try with a live coin" picks the newest pump.fun mint from DexScreener's latest token profiles. Shareable links with `?mint=`.
- Sell quotes in the playground (Buy and Sell toggle), also in `ramp ui`.
- `src/chain.js`: browser-safe base58, ed25519 check, PDA derivation, account decoder and DexScreener helpers, copied to `docs/lib/chain.js`.
- `api/rpc.js`: Vercel function proxying Solana `getAccountInfo` only, with a body cap, 8s timeout, upstream fallback (optional `SOLANA_RPC_URL`, then the public RPCs) and a 15s cache.
- `scripts/dev-site.mjs` serves the site locally the way Vercel does, `--mock` runs it against `fixtures/mock-site.js`.
- Tests for the proxy, the browser module (checked against `src/live.js`), the dev site and an end to end Chromium run against mocks.

### Changed

- Landing page: the live input and the playground are the hero, landing content moved below. The install line sits with the commands.

## [1.0.0] - 2026-10-14

### Changed

- Released as **Ramp**. The CLI command is now `ramp` (was `curve`). The npm package is `ramp-cli` because `ramp` is taken on npm. The env var is `RAMP_RPC_URL`.
- New identity: flat lime ramp and ball icon on forest green (the bonding curve is the ramp, the ball is your coin rolling up to bond), a matching flat SVG mark, a dark green trading-terminal palette with lime `#B6F23A` as the one accent, Archivo for UI and DM Mono for every number. Dashboard and landing page rebuilt in that style (price chart plus buy ticket, dense stat cells, every state designed). README, landing page, dashboard and CLI help rewritten in plain words.
- Curve progress (share of the curve tokens sold) is `progressPct` in JSON output and shown as `Progress` in the CLI.
- All math moved into one browser-safe module, `src/math.js` (no imports, no Node globals), shared by the CLI, MCP server, dashboard and docs playground. Exact BigInt math and defaults are unchanged.
- Trades use a fast internal path, so long simulations do not re-validate parameters on every trade.
- Errors are prefixed `ramp:`. `run()` is now async.

### Added

- Presets: `--preset pumpfun` (default) and `--preset custom --config file.json`; flags override the config.
- `ramp plan`: dev-buy planner with `--own <pct>`, `--target-mcap <n>` (USD with `--sol-price`) and `--budget <sol>` with `--at` points.
- `ramp sim`: seeded Monte Carlo launch simulator (snipers, dev buy, organic buys and sells) with graduation probability, trades to graduate, sniper, dev and top 10 share distributions.
- `ramp bundle`: bundled launch slot vs the same SOL spread over time.
- Live mode (`--rpc`, `--mint`, `--curve`, `RAMP_RPC_URL`): Pump.fun bonding curve PDA derivation, ed25519 on-curve check, base58, account decoder and `getAccountInfo` fetch.
- `ramp chart --svg`: price vs SOL raised chart in the ramp style, with a marker where it bonds and one for your coin.
- `ramp mcp`: MCP server over stdio with `curve_state`, `quote_buy`, `quote_sell`, `plan_dev_buy`, `simulate_launch`.
- `ramp ui`: local dashboard with playground, simulator and bundle check, and a JSON API.
- `docs/index.html`: landing page with an in-browser playground running `src/math.js`.
- Brand assets in `assets/`, `BRAND.md`, CI on Ubuntu and macOS with Node 18, 20 and 22, issue templates, `SECURITY.md`.
- Tests for the planner, simulator determinism, bundle math, account decoder fixture, PDA derivation, mock RPC live mode, MCP server, dashboard and docs sync.

## [0.1.0] - 2026-10-14

### Added

- `Curve` class: constant-product bonding curve with virtual reserves, BigInt reserves in lamports and token base units, immutable `buy`, `sell`, `state`, `withRaised`, `withSold` and `clone`.
- Graduation math computed from the parameters (SOL to graduate, market cap at graduation).
- CLI commands `state`, `buy`, `sell`, `snipe` and `chart`.
- Configurable curve parameters (`--virtual-sol`, `--virtual-tokens`, `--curve-tokens`, `--supply`, `--fee`), USD display (`--sol-price`) and `--json` output.
- Test suite with `node:test`.
