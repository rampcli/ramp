// SVG export of the curve in the Ramp brand style. Pure string building, no DOM.
import { chartPoints } from './math.js';
import { num } from './format.js';

export const PALETTE = Object.freeze({
  bg: '#0B1F14', panel: '#10291B', grid: '#1A3324', gridStrong: '#2A4434', accent: '#B6F23A',
  text: '#EAF5EC', muted: '#8AA394', up: '#B6F23A', down: '#FF6B5B',
});

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Price vs SOL raised, launch to graduation, with a graduation marker and an optional "you are here" point. */
export function curveSvg(curve, { width = 960, height = 540, solPrice, title = 'Price vs SOL raised' } = {}) {
  const c = PALETTE;
  const base = launchOf(curve);
  const pts = chartPoints(base, 120);
  const st = base.state();
  const here = curve.solRaised > 0n ? { raised: curve.state().solRaised, price: curve.price } : null;
  const m = { l: 96, r: 48, t: 92, b: 70 };
  const W = width - m.l - m.r;
  const H = height - m.t - m.b;
  const xMax = pts[pts.length - 1].raised;
  const yMin = 0;
  const yMax = st.graduationPrice * 1.08;
  const X = (v) => m.l + (v / xMax) * W;
  const Y = (v) => m.t + H - ((v - yMin) / (yMax - yMin)) * H;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.raised).toFixed(1)},${Y(p.price).toFixed(1)}`).join('');
  const area = `${line}L${X(xMax).toFixed(1)},${Y(0).toFixed(1)}L${X(0).toFixed(1)},${Y(0).toFixed(1)}Z`;
  const grid = [];
  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i) / 4;
    grid.push(`<line x1="${m.l}" x2="${m.l + W}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${i === 0 ? c.gridStrong : c.grid}"/>`);
    grid.push(`<text x="${m.l - 14}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${esc(i === 0 ? '0' : (v * 1e6).toFixed(3))}</text>`);
  }
  const step = xMax > 60 ? 20 : xMax > 25 ? 10 : 5;
  for (let v = 0; v <= xMax + 1e-9; v += step) {
    grid.push(`<line x1="${X(v).toFixed(1)}" x2="${X(v).toFixed(1)}" y1="${m.t}" y2="${m.t + H}" stroke="${c.grid}"/>`);
    grid.push(`<text x="${X(v).toFixed(1)}" y="${m.t + H + 24}" text-anchor="middle">${v}</text>`);
  }
  const gx = X(xMax);
  const gy = Y(st.graduationPrice);
  const usd = solPrice ? ` ($${Math.round(st.graduationMarketCap * solPrice).toLocaleString('en-US')})` : '';
  const gradLabel = `Graduation: ${num(st.solToGraduate, 2)} SOL raised, mcap ${num(st.graduationMarketCap, 2)} SOL${usd}`;
  const hereMark = here
    ? `<g><line x1="${X(here.raised).toFixed(1)}" x2="${X(here.raised).toFixed(1)}" y1="${Y(here.price).toFixed(1)}" y2="${m.t + H}" stroke="${c.text}" stroke-opacity="0.35" stroke-dasharray="4 4"/><circle cx="${X(here.raised).toFixed(1)}" cy="${Y(here.price).toFixed(1)}" r="13" fill="${c.text}" fill-opacity="0.12"/><circle cx="${X(here.raised).toFixed(1)}" cy="${Y(here.price).toFixed(1)}" r="7" fill="${c.text}"/><text x="${(X(here.raised) + 14).toFixed(1)}" y="${(Y(here.price) + 24).toFixed(1)}" fill="${c.text}">${esc(`Now: ${num(here.raised, 2)} SOL raised`)}</text></g>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
<defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.accent}" stop-opacity="0.16"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/></linearGradient></defs>
<rect width="${width}" height="${height}" rx="10" fill="${c.bg}"/>
<g font-family="'DM Mono', ui-monospace, Menlo, monospace" font-size="13" fill="${c.muted}" style="font-variant-numeric:tabular-nums">
<text x="${m.l}" y="44" font-family="Archivo, ui-sans-serif, system-ui, sans-serif" font-size="22" font-weight="800" letter-spacing="-0.4" fill="${c.text}">${esc(title)}</text>
<text x="${m.l}" y="68">${esc(`virtual ${num(base.params.virtualSol)} SOL / ${num(Number(base.params.virtualTokens) / 1e6)}M tokens, ${num(Number(base.params.curveTokens) / 1e6, 1)}M on curve, fee ${st.feePct}%`)}</text>
${grid.join('\n')}
<path d="${area}" fill="url(#fill)"/>
<path d="${line}" fill="none" stroke="${c.accent}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
${hereMark}
<circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="8" fill="${c.bg}" stroke="${c.accent}" stroke-width="2.5"/>
<text x="${(gx - 22).toFixed(1)}" y="${(gy - 2).toFixed(1)}" text-anchor="end" fill="${c.accent}">${esc(gradLabel)}</text>
<text x="${m.l + W / 2}" y="${height - 18}" text-anchor="middle">SOL raised (net of fees)</text>
<text x="24" y="${m.t + H / 2}" transform="rotate(-90 24 ${m.t + H / 2})" text-anchor="middle">price (SOL per 1M tokens)</text>
</g>
</svg>
`;
}

/** Small label-free version for cards: thin grid, area fill, the line, a "now" dot and the bond ring. */
export function miniCurveSvg(curve, { width = 480, height = 200, cls = '' } = {}) {
  const c = PALETTE;
  const base = launchOf(curve);
  const pts = chartPoints(base, 80);
  const st = base.state();
  const pad = 10;
  const xMax = pts[pts.length - 1].raised;
  const yMax = st.graduationPrice * 1.1;
  const X = (v) => pad + (v / xMax) * (width - pad * 2);
  const Y = (v) => height - pad - (v / yMax) * (height - pad * 2);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.raised).toFixed(1)},${Y(p.price).toFixed(1)}`).join('');
  const grid = [];
  for (let i = 0; i <= 4; i++) grid.push(`<line x1="${pad}" x2="${width - pad}" y1="${Y((yMax * i) / 4).toFixed(1)}" y2="${Y((yMax * i) / 4).toFixed(1)}" stroke="${i ? c.grid : c.gridStrong}"/>`);
  for (let i = 1; i < 6; i++) grid.push(`<line x1="${X((xMax * i) / 6).toFixed(1)}" x2="${X((xMax * i) / 6).toFixed(1)}" y1="${pad}" y2="${height - pad}" stroke="${c.grid}"/>`);
  const here = curve.solRaised > 0n ? { x: X(curve.state().solRaised), y: Y(curve.price) } : { x: X(0), y: Y(pts[0].price) };
  const id = `mf${width}x${height}`;
  return `<svg xmlns="http://www.w3.org/2000/svg"${cls ? ` class="${cls}"` : ''} viewBox="0 0 ${width} ${height}" role="img" aria-label="Price vs SOL raised, launch to bond">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.accent}" stop-opacity="0.18"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/></linearGradient></defs>
${grid.join('')}
<path d="${line}L${X(xMax).toFixed(1)},${Y(0).toFixed(1)}L${X(0).toFixed(1)},${Y(0).toFixed(1)}Z" fill="url(#${id})"/>
<path d="${line}" fill="none" stroke="${c.accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
<line x1="${here.x.toFixed(1)}" x2="${here.x.toFixed(1)}" y1="${here.y.toFixed(1)}" y2="${(height - pad).toFixed(1)}" stroke="${c.text}" stroke-opacity="0.35" stroke-dasharray="3 3"/>
<circle cx="${X(xMax).toFixed(1)}" cy="${Y(st.graduationPrice).toFixed(1)}" r="6" fill="${c.bg}" stroke="${c.accent}" stroke-width="2"/>
<circle cx="${here.x.toFixed(1)}" cy="${here.y.toFixed(1)}" r="5" fill="${c.text}" stroke="${c.bg}" stroke-width="2"/>
</svg>`;
}

/** The same curve parameters, at launch. */
export function launchOf(curve) {
  return curve._next({ virtualSol: curve.initialVirtualSol, virtualTokens: curve.initialVirtualTokens, realTokens: curve.curveTokens });
}
