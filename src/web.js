// Page builder shared by `ramp ui` and scripts/build-docs.mjs.
// Inlines src/math.js (the same file the CLI uses) into a single HTML page.
import { readFileSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(here(p), 'utf8');

export const ACCENT = '#B6F23A';
/** The flat mark, traced from the icon master: a concave ramp wedge (flat at launch, steep near the end, like the price curve) and the ball, your coin rolling up to bond. viewBox 0 0 100 100. */
export const MARK_PATHS = '<path d="M8 79.86V74.32C42.32 71.82 67.95 56.95 90.57 20.61Q91.45 19.73 92 20.14V79.86Z"/><circle cx="44.19" cy="43.95" r="17.78"/>';

/** Font files bundled in assets/fonts/. Archivo for UI and headings, DM Mono for every number. */
export const FONT_FILES = ['archivo-500.woff2', 'archivo-700.woff2', 'archivo-800.woff2', 'dm-mono-400.woff2', 'dm-mono-500.woff2'];

/** @font-face rules with `prefix` as the folder that holds FONT_FILES. */
export function fontCss(prefix) {
  const face = (family, file, weight) => `@font-face { font-family: "${family}"; src: url("${prefix}${file}") format("woff2"); font-weight: ${weight}; font-display: swap; }`;
  return [
    face('Archivo', 'archivo-500.woff2', 500), face('Archivo', 'archivo-700.woff2', 700), face('Archivo', 'archivo-800.woff2', 800),
    face('DM Mono', 'dm-mono-400.woff2', 400), face('DM Mono', 'dm-mono-500.woff2', 500),
  ].join('\n');
}

/** Flat mark as SVG. Without `size` it is exactly the master file (assets/logo.svg). */
export function logoSvg({ size, color = ACCENT, title } = {}) {
  const dims = size ? ` class="mark" width="${size}" height="${size}"` : '';
  const label = title ? ` role="img" aria-label="${title}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${dims}${label}><g fill="${color}">${MARK_PATHS}</g></svg>`;
}

/** Single colour version in currentColor (assets/logo-mono.svg). */
export function logoMonoSvg() {
  return logoSvg({ color: 'currentColor' });
}

/** The 3D app icon (src/web/icon.png, 128px, from the rounded master) as an inline <img>. */
export function iconImg(size = 34) {
  const b64 = readFileSync(here('./web/icon.png')).toString('base64');
  return `<img class="icon" src="data:image/png;base64,${b64}" width="${size}" height="${size}" alt="Ramp">`;
}

/** math.js as a classic script: `const M = { ...exports }`. */
export function inlineMath() {
  const src = read('./math.js');
  const names = [...src.matchAll(/^export (?:class|function|const|let) (\w+)/gm)].map((m) => m[1]);
  return `const M = (() => {\n${src.replace(/^export /gm, '')}\nreturn { ${names.join(', ')} };\n})();`;
}

/** Fill a template: /*{{name}}*\/ and {{name}} placeholders. */
export function fillTemplate(html, vars) {
  return html.replace(/\/\*\{\{(\w+)\}\}\*\/|\{\{(\w+)\}\}/g, (m, a, b) => {
    const key = a || b;
    return key in vars ? String(vars[key]) : m;
  });
}

export function sharedVars(version) {
  return {
    css: read('./web/base.css'),
    mark: logoSvg({ size: 22, title: 'ramp' }),
    math: inlineMath(),
    playground: read('./web/playground.js'),
    logo: iconImg(34),
    version,
  };
}

export function buildDashboard({ version, boot = {} }) {
  const json = JSON.stringify(boot).replace(/</g, '\\u003c');
  return fillTemplate(read('./web/dashboard.html'), { ...sharedVars(version), fonts: fontCss('/fonts/'), favicon: encodeURIComponent(logoSvg()), boot: `window.RAMP_BOOT = ${json};` });
}
