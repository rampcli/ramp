# Contributing

Clone it and run the tests. There is nothing to install.

```sh
git clone https://github.com/OWNER/ramp.git && cd ramp
npm test
```

Node 18 or newer. Zero runtime dependencies, and it stays that way.

## Where things live

| Path | What |
|---|---|
| `src/math.js` | Every formula: curve, planner, bundle, sim. No imports, no Node globals, because the browser runs the same file. |
| `src/live.js` | base58, ed25519 on-curve check, PDA derivation, account decoder, RPC call |
| `src/core.js` | Shared entry points for the CLI, the MCP server and the dashboard |
| `src/cli.js`, `src/mcp.js`, `src/ui.js` | The three front doors |
| `src/web/` | Dashboard page, shared CSS and the playground script |
| `scripts/` | Builders for `docs/index.html` and `assets/` (not shipped to npm) |
| `fixtures/` | Test fixtures and the mock RPC server |

## Rules that save review time

1. A math change comes with a test, ideally against a closed-form number.
2. Reserves stay BigInt. Floats are for display only.
3. CLI output changed? Rerun the commands and paste the real output into the README.
4. No em or en dashes anywhere. `test/repo.test.js` will catch them.

## Docs and assets

```sh
npm run build:docs     # docs/index.html, inlines src/math.js and real CLI output
npm run build:assets   # assets/*.svg and assets/banner.html
```

`test/repo.test.js` fails if `docs/index.html` is stale.

The PNGs (`banner.png`, `dashboard.png`, `docs/preview.png`) are screenshots of those sources taken with headless Chromium at 1280x640 and 1440 wide. `icon.png` (512) and `coin.png` (1000) are resized from the icon masters in the brand kit.

## Bugs

Give the exact command, what it printed, and what you expected. If a number looks wrong, say what you compared it to: a transaction, the launchpad UI, or a hand calculation.
