// Writes the asset sources into assets/. PNGs are rendered from these with a headless
// Chromium script (see CONTRIBUTING.md). Terminal and chart assets come from real CLI runs.
// icon.png (512) and coin.png (1000) are resized from the icon masters, not built here.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { logoSvg, logoMonoSvg, fontCss } from '../src/web.js';
import { capture, heroVars } from './build-docs.mjs';
import { curveSvg } from '../src/chart.js';
import { Curve } from '../src/math.js';

const asset = (p) => new URL(`../assets/${p}`, import.meta.url);
const out = (p, s) => { writeFileSync(asset(p), s); console.log(`wrote assets/${p}`); };
mkdirSync(asset(''), { recursive: true });
const C = { bg: '#0B1F14', panel: '#10291B', raised: '#163523', inset: '#0D2318', line: '#1E3A2A', line2: '#2A4434', accent: '#B6F23A', text: '#EAF5EC', muted: '#8AA394', faint: '#5E7A69', out: '#C4D6C9' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

out('logo.svg', logoSvg());
out('logo-mono.svg', logoMonoSvg());

// terminal: real output. DM Mono is embedded so the SVG renders the same inside a README <img>.
const sessions = [['plan', '--own', '5%'], ['sim', '--seed', '42']];
const lines = [];
for (const argv of sessions) {
  lines.push({ t: `ramp ${argv.join(' ')}`, k: 'cmd' });
  const outLines = (await capture(argv)).trimEnd().split('\n');
  outLines.forEach((l, i) => lines.push({ t: l, k: l && !l.startsWith(' ') && (outLines[i + 1] || '').startsWith(' ') ? 'head' : 'out' }));
  lines.push({ t: '', k: 'out' });
}
lines.pop();
const mono = readFileSync(asset('fonts/dm-mono-400.woff2')).toString('base64');
const lh = 22;
const tw = 880;
const top = 48;
const th = top + 24 + lines.length * lh + 16;
const color = { cmd: C.accent, head: C.text, out: C.out };
out('terminal.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}" viewBox="0 0 ${tw} ${th}" role="img" aria-label="Terminal session running ramp plan and ramp sim">
<style>@font-face{font-family:"DM Mono";src:url(data:font/woff2;base64,${mono}) format("woff2");font-weight:400}text{font-family:"DM Mono",ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}</style>
<rect x="0.5" y="0.5" width="${tw - 1}" height="${th - 1}" rx="10" fill="${C.inset}" stroke="${C.line2}"/>
<path d="M1 ${top}H${tw - 1}" stroke="${C.line}"/>
<g transform="translate(20 15) scale(0.18)" fill="${C.accent}"><path d="M8 79.86V74.32C42.32 71.82 67.95 56.95 90.57 20.61Q91.45 19.73 92 20.14V79.86Z"/><circle cx="44.19" cy="43.95" r="17.78"/></g>
<text x="46" y="29" font-size="12" fill="${C.text}">ramp</text>
<text x="${tw - 20}" y="29" text-anchor="end" font-size="12" fill="${C.muted}">example output from a real run</text>
<g font-size="13.5">
${lines.map((l, i) => {
    const y = top + 30 + i * lh;
    if (l.k === 'cmd') return `<text x="24" y="${y}" xml:space="preserve"><tspan fill="${C.faint}">$ </tspan><tspan fill="${C.accent}">${esc(l.t)}</tspan></text>`;
    return `<text x="24" y="${y}" xml:space="preserve" fill="${color[l.k]}">${esc(l.t)}</text>`;
  }).join('\n')}
</g>
</svg>
`);

// chart example from `ramp chart --from-raised 30 --sol-price 150 --svg`
out('curve.svg', curveSvg(new Curve().withRaised(30), { solPrice: 150 }));

// banner source (render at 1280x640, content inside the centre 1200x560). Numbers come from src/math.js.
const h = heroVars();
out('banner.html', `<!doctype html><html><head><meta charset="utf-8"><style>
${fontCss('fonts/')}
*{box-sizing:border-box}html,body{margin:0}
body{width:1280px;height:640px;background:${C.bg};color:${C.text};font-family:Archivo,system-ui,sans-serif;position:relative;overflow:hidden}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:64px 64px;background-position:-1px -1px}
.left{position:absolute;left:88px;top:88px;width:560px}
.icon{display:block;width:152px;height:152px;border-radius:22%}
.word{margin:28px 0 0;font-size:132px;font-weight:800;letter-spacing:-.045em;line-height:.8}
.pitch{margin:28px 0 32px;font-size:30px;line-height:1.25;font-weight:700;letter-spacing:-.02em;color:${C.muted}}
.pitch b{color:${C.text};font-weight:700}
.chip{display:inline-flex;align-items:center;gap:12px;height:48px;padding:0 18px;font:400 17px "DM Mono",monospace;background:${C.inset};border:1px solid ${C.line2};border-radius:10px}
.chip i{font-style:normal;color:${C.faint}}
.card{position:absolute;right:88px;top:88px;width:460px;background:${C.panel};border:1px solid ${C.line};border-radius:10px;padding:24px;display:flex;flex-direction:column;gap:16px}
.top{display:flex;justify-content:space-between;align-items:center;font-size:15px;font-weight:700}
.top span{font:400 12px "DM Mono",monospace;color:${C.muted};border:1px solid ${C.line};border-radius:6px;padding:4px 8px;font-weight:400}
.big{font:400 44px/1 "DM Mono",monospace;letter-spacing:-.03em}
.big small{font-size:16px;color:${C.muted};letter-spacing:0}
.sub{margin-top:8px;font:400 13px "DM Mono",monospace;color:${C.muted}}
svg{display:block;width:100%;height:auto}
.prow{display:flex;justify-content:space-between;font-size:12px;color:${C.muted};margin-bottom:8px}.prow b{font:400 12px "DM Mono",monospace;color:${C.text}}
.bar{height:6px;border-radius:3px;background:${C.raised}}.bar i{display:block;height:100%;border-radius:3px;background:${C.accent};width:${h.h_prog}%}
.rows{border-top:1px solid ${C.line};padding-top:16px;display:flex;flex-direction:column;gap:12px}
.kv{display:flex;justify-content:space-between;font-size:14px;color:${C.muted};font-weight:500}.kv b{font:400 14px "DM Mono",monospace;color:${C.text}}.kv b.k{color:${C.accent}}
</style></head><body><div class="grid"></div>
<div class="left"><img class="icon" src="icon.png" alt="">
<h1 class="word">ramp</h1>
<p class="pitch">pump.fun curve math.<br><b>know when it bonds.</b></p>
<span class="chip"><i>$</i>npx ramp-cli plan --own 5%</span></div>
<div class="card">
<div class="top">example coin, 30 SOL raised<span>example data</span></div>
<div><div class="big">${h.h_mcap} <small>SOL mcap</small></div><div class="sub">${h.h_mcapusd} at $150 SOL</div></div>
${h.h_chart}
<div><div class="prow"><span>Bonding progress</span><b>${h.h_prog}%</b></div><div class="bar"><i></i></div></div>
<div class="rows"><div class="kv"><span>Buy 1 SOL, you get</span><b class="k">${h.h_tokens}</b></div><div class="kv"><span>SOL left until it bonds</span><b>${h.h_left} SOL</b></div><div class="kv"><span>Mcap when it bonds</span><b>${h.h_grad} SOL</b></div></div>
</div>
</body></html>
`);
