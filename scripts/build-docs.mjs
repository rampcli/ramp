// Builds docs/index.html from scripts/landing.template.html.
// Inlines src/math.js and the playground, and fills the terminal block with real CLI output.
// Also copies src/chain.js to docs/lib/chain.js for docs/app.js (live mode in the browser).
// Usage: node scripts/build-docs.mjs [--check]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run, VERSION } from '../src/cli.js';
import { fillTemplate, sharedVars, logoSvg, iconImg, fontCss } from '../src/web.js';
import { Curve, planOwn, bundleCompare } from '../src/math.js';

const root = new URL('../', import.meta.url);
export const DEMO = [['plan', '--own', '5%'], ['plan', '--target-mcap', '50000', '--sol-price', '150']];

export async function capture(argv) {
  let out = '';
  const io = { stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { out += s; } }, env: {} };
  await run(argv, io);
  return out;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function buildLanding() {
  const blocks = [];
  for (const argv of DEMO) {
    const shown = argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
    blocks.push(`<span class="p">$</span> <span class="c">ramp ${esc(shown)}</span>\n${esc((await capture(argv)).trimEnd())}`);
  }
  const favicon = encodeURIComponent(logoSvg());
  return fillTemplate(readFileSync(new URL('scripts/landing.template.html', root), 'utf8'), {
    ...sharedVars(VERSION), fonts: fontCss('fonts/'), logo: iconImg(40), term: blocks.join('\n\n'), favicon, ...heroVars(),
  });
}

/** Numbers for the stat strip. All from src/math.js. */
export function heroVars() {
  const fx = (v, d) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const launch = new Curve();
  const ls = launch.state();
  return {
    s_bond: fx(ls.solToGraduate, 2), s_grad: fx(ls.graduationMarketCap, 2), s_own: fx(planOwn(launch, 5).solToSpend, 4),
    s_bundle: fx(bundleCompare(launch, 8, 0.5).concentration, 2),
  };
}

/** Browser copies of browser-safe src modules: [source, target] relative to the repo root. */
export const LIB_COPIES = [['src/chain.js', 'docs/lib/chain.js']];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = await buildLanding();
  const target = new URL('docs/index.html', root);
  const libSame = () => LIB_COPIES.every(([a, b]) => { try { return readFileSync(new URL(a, root), 'utf8') === readFileSync(new URL(b, root), 'utf8'); } catch { return false; } });
  if (process.argv.includes('--check')) {
    const same = readFileSync(target, 'utf8') === html && libSame();
    console.log(same ? 'docs/index.html is up to date' : 'docs/index.html is stale, run npm run build:docs');
    process.exitCode = same ? 0 : 1;
  } else {
    writeFileSync(target, html);
    mkdirSync(new URL('docs/lib/', root), { recursive: true });
    for (const [a, b] of LIB_COPIES) writeFileSync(new URL(b, root), readFileSync(new URL(a, root)));
    console.log(`wrote docs/index.html (${html.length} bytes)`);
  }
}
