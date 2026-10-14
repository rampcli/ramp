// Terminal formatting helpers. Display only; all math lives in math.js.

export function num(n, maxDecimals = 2) {
  return n.toLocaleString('en-US', { maximumFractionDigits: maxDecimals });
}

export function solAmt(n) {
  return `${num(n, n >= 100 ? 2 : 4)} SOL`;
}

export function tokens(n) {
  return num(n, 2);
}

export function percent(n, decimals = 2) {
  return `${n.toFixed(decimals)}%`;
}

export function signedPercent(n, decimals = 2) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

/** Small prices with four significant digits, without scientific notation. */
export function price(n) {
  if (n === 0) return '0 SOL';
  const decimals = Math.min(20, Math.max(2, Math.ceil(-Math.log10(n)) + 3));
  return `${n.toFixed(decimals)} SOL`;
}

export function usd(n) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 0 : 2, minimumFractionDigits: n >= 1000 ? 0 : 2 });
}

/** Market cap in SOL, with USD appended when a SOL price is known. */
export function mcap(n, solPrice) {
  const base = `${num(n, 2)} SOL`;
  return solPrice ? `${base} (${usd(n * solPrice)})` : base;
}

export function keyValues(title, pairs) {
  const width = Math.max(...pairs.map(([k]) => k.length)) + 2;
  return [title, ...pairs.map(([k, v]) => `  ${k.padEnd(width)}${v}`)].join('\n');
}

export function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ');
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

/** Plot points ({x, y}) as an ASCII chart. */
export function asciiChart(points, { height = 12, yLabel = (v) => String(v), xLabel = (v) => String(v) } = {}) {
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const grid = Array.from({ length: height }, () => Array(points.length).fill(' '));
  points.forEach((p, x) => {
    const row = height - 1 - Math.round(((p.y - min) / span) * (height - 1));
    grid[row][x] = '*';
    for (let r = row + 1; r < height; r++) grid[r][x] = '.';
  });
  const labels = grid.map((_, r) => {
    if (r === 0) return yLabel(max);
    if (r === height - 1) return yLabel(min);
    if (r === Math.floor((height - 1) / 2)) return yLabel(min + span * (1 - r / (height - 1)));
    return '';
  });
  const lw = Math.max(...labels.map((l) => l.length));
  const out = grid.map((row, r) => `${labels[r].padStart(lw)} | ${row.join('')}`);
  out.push(`${' '.repeat(lw)} +-${'-'.repeat(points.length)}`);
  const left = xLabel(points[0].x);
  const right = xLabel(points[points.length - 1].x);
  const gap = Math.max(1, points.length - left.length - right.length);
  out.push(`${' '.repeat(lw + 3)}${left}${' '.repeat(gap)}${right}`);
  return out.join('\n');
}

/** Horizontal bar histogram: [{label, count}] -> lines. */
export function bars(rows, { width = 32, char = '#' } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const lw = Math.max(...rows.map((r) => r.label.length));
  const cw = Math.max(...rows.map((r) => String(r.count).length));
  return rows.map((r) => `  ${r.label.padStart(lw)}  ${String(r.count).padStart(cw)}  ${char.repeat(Math.round((r.count / max) * width))}`).join('\n');
}
