// rampcli.dev live mode. Paste a pump.fun mint: the bonding curve PDA is derived here, the account
// is read through /api/rpc, decoded here, and the playground below is pinned to the real reserves.
// Graduated coins show their DexScreener pair. Plain ES module, no build step.
import {
  loadBondingCurve, curveInput, latestPumpMint, tokenPairs, bestPair, tokenMeta, solUsdFrom, isAddress, LiveError, DEXSCREENER,
} from './lib/chain.js';

const qs = new URLSearchParams(location.search);
const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
// Test hooks: only honoured on localhost, ignored in production.
const DEX = (local && qs.get('dex')) || DEXSCREENER;
const RPC = (local && qs.get('rpc')) || '/api/rpc';
const CLI_RPC = 'https://api.mainnet-beta.solana.com';
/** Used when DexScreener has no fresh pump.fun profile: a well-known coin that bonded long ago. */
export const FALLBACK_MINT = '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump';

const $ = (id) => document.getElementById(id);
const form = $('live-form');
const input = $('mint');
const go = $('live-go');
const ex = $('live-example');
const box = $('live');
if (!form || !box) throw new Error('live mode markup missing');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fx = (v, d) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const n = (v, d = 2) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d });
const short = (a) => (a && a.length > 12 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a || '');
const usdc = (v) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return '-';
  if (x >= 1e9) return '$' + fx(x / 1e9, 2) + 'B';
  if (x >= 1e6) return '$' + fx(x / 1e6, 2) + 'M';
  if (x >= 1e4) return '$' + fx(x / 1e3, 1) + 'K';
  if (x >= 1) return '$' + fx(x, 2);
  return '$' + Number(x.toPrecision(3)).toString();
};
const markSvg = '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="#B6F23A"><path d="M8 79.86V74.32C42.32 71.82 67.95 56.95 90.57 20.61Q91.45 19.73 92 20.14V79.86Z"/><circle cx="44.19" cy="43.95" r="17.78"/></g></svg>';

let seq = 0;

function show(state, html) {
  box.hidden = false;
  box.dataset.state = state;
  box.innerHTML = html;
  document.documentElement.classList.remove('has-mint');
}

function setUrl(mint) {
  const u = new URL(location.href);
  if (mint) u.searchParams.set('mint', mint); else u.searchParams.delete('mint');
  u.searchParams.delete('token');
  history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
}

function idRow(mint, meta, chip, chipCls) {
  const img = meta?.image ? `<img src="${esc(meta.image)}" alt="" width="40" height="40" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'lv-ph',innerHTML:this.dataset.mark}))" data-mark="${esc(markSvg)}">` : `<span class="lv-ph">${markSvg}</span>`;
  const name = meta?.name ? esc(meta.name) : 'unnamed coin';
  const sym = meta?.symbol ? `<em>$${esc(meta.symbol)}</em>` : '';
  return `<div class="lv-id">${img}<div class="lv-name"><strong>${name} ${sym}</strong><button type="button" class="lv-mint" data-copy="${esc(mint)}" title="Copy mint">${esc(short(mint))}</button></div><span class="lv-chip ${chipCls}">${chip}</span></div>`;
}

function tools(mint) {
  return `<div class="lv-tools"><button type="button" class="btn btn-sm" data-share>Copy link</button><a class="btn btn-sm" href="https://dexscreener.com/solana/${encodeURIComponent(mint)}" target="_blank" rel="noopener">DexScreener</a><button type="button" class="btn btn-sm" data-reset>Back to the model</button></div>`;
}

function skeleton(mint) {
  show('loading', `<div class="lv-top"><div class="lv-id"><span class="sk sk-av"></span><div class="lv-name"><span class="sk sk-t"></span><span class="sk sk-s"></span></div></div><span class="lv-note">reading the bonding curve of ${esc(short(mint))}</span></div>
  <div class="cells lv-cells">${'<div class="cell"><span class="sk sk-l"></span><b><span class="sk sk-b"></span></b><small><span class="sk sk-l"></span></small></div>'.repeat(4)}</div>`);
}

function errorView(mint, err) {
  const title = {
    'bad-address': 'not a Solana address',
    'not-found': 'no bonding curve found',
    'not-pump': 'not a pump.fun curve',
    'rate-limited': 'rate limited',
    unreachable: 'could not read the chain',
    rpc: 'RPC error',
    'bad-account': 'unexpected account',
  }[err.kind] || 'something went wrong';
  const retry = ['rate-limited', 'unreachable', 'rpc'].includes(err.kind) ? '<button type="button" class="btn btn-sm" data-retry>Try again</button>' : '';
  show('error', `<div class="lv-msg err"><div><strong>${esc(title)}</strong><p>${esc(err.message)}</p></div><div class="lv-tools">${retry}<button type="button" class="btn btn-sm" data-reset>Back to the model</button></div></div>`);
  box.dataset.mint = mint || '';
}

function curveView(live, meta, solUsd, solUsdEst) {
  // M is src/math.js, inlined into the page as a classic script (global lexical binding).
  const ci = curveInput(live);
  const base = new M.Curve({ supply: ci.supply });
  const c = base.withReserves(ci);
  const s = c.state();
  show('curve', `<div class="lv-top">${idRow(live.mint, meta, 'on the curve, live', 'on')}${tools(live.mint)}</div>
  <div class="cells lv-cells">
    <div class="cell"><span>Bonding progress</span><b class="key" data-k="progress">${fx(s.progressPct, 2)}%</b><small><span class="bar"><i style="width:${Math.min(100, s.progressPct).toFixed(2)}%"></i></span></small></div>
    <div class="cell"><span>SOL left to bond</span><b data-k="left">${fx(s.solToGraduateWithFee, 3)} SOL</b><small>fee incl., ${fx(s.solToGraduate, 3)} net</small></div>
    <div class="cell"><span>Market cap now</span><b data-k="mcap">${n(s.marketCap, 2)} SOL</b><small>${usdc(s.marketCap * solUsd)} est.</small></div>
    <div class="cell"><span>Mcap when it bonds</span><b data-k="grad">${n(s.graduationMarketCap, 2)} SOL</b><small>${usdc(s.graduationMarketCap * solUsd)} est.</small></div>
  </div>
  <p class="lv-foot">read at slot ${live.slot != null ? n(live.slot, 0) : 'unknown'} from curve account <code>${esc(short(live.address))}</code>, ${fx(Number(live.account.realSolReserves) / 1e9, 3)} SOL real reserves. USD is an estimate at $${n(solUsd, 2)} per SOL${solUsdEst ? ' implied by DexScreener' : ', set it in the ticket'}. not financial advice.</p>`);
  window.rampPlayground?.setLive({ ...ci, mint: live.mint, rpc: CLI_RPC, solPrice: solUsdEst ? solUsd : null });
}

function pairView(mint, meta, pair, { bonded, note }) {
  const p = pair || {};
  const dex = p.dexId ? esc(p.dexId) : 'an AMM';
  const msg = bonded
    ? `this coin finished its bonding curve${pair ? ` and trades on ${dex}` : ''}. there is nothing left to quote on the curve, so the model below is back to a fresh launch.`
    : note;
  const cells = pair ? `<div class="cells lv-cells">
    <div class="cell"><span>Price</span><b data-k="price">${usdc(p.priceUsd)}</b><small>${p.priceNative ? fx(Number(p.priceNative) * 1e6, 4) + ' SOL per 1M' : ''}</small></div>
    <div class="cell"><span>Market cap</span><b>${usdc(p.marketCap ?? p.fdv)}</b><small>${p.fdv ? 'fdv ' + usdc(p.fdv) : ''}</small></div>
    <div class="cell"><span>Liquidity</span><b>${usdc(p.liquidity?.usd)}</b><small>${esc(p.quoteToken?.symbol || '')} pair on ${dex}</small></div>
    <div class="cell"><span>Volume 24h</span><b>${usdc(p.volume?.h24)}</b><small>${p.priceChange?.h24 != null ? (p.priceChange.h24 >= 0 ? '+' : '') + fx(p.priceChange.h24, 2) + '% 24h' : ''}</small></div>
  </div>` : '';
  const link = pair?.url ? `<a class="btn btn-sm" href="${esc(pair.url)}" target="_blank" rel="noopener">Open the pair</a>` : '';
  show(bonded ? 'bonded' : 'pair', `<div class="lv-top">${idRow(mint, meta, bonded ? 'bonded' : 'not on a pump.fun curve', bonded ? 'done' : 'off')}<div class="lv-tools">${link}<button type="button" class="btn btn-sm" data-share>Copy link</button><button type="button" class="btn btn-sm" data-reset>Back to the model</button></div></div>
  <p class="lv-lead">${esc(msg)}</p>${cells}<p class="lv-foot">market data from DexScreener${pair ? '' : ' is unavailable right now'}. not financial advice.</p>`);
  window.rampPlayground?.clearLive();
}

export async function run(raw) {
  const mint = String(raw || '').trim();
  const my = ++seq;
  input.value = mint;
  input.removeAttribute('aria-invalid');
  if (!isAddress(mint)) {
    input.setAttribute('aria-invalid', 'true');
    errorView(mint, new LiveError('bad-address', mint ? 'that is not a Solana address. paste the mint, 32 to 44 base58 characters' : 'paste a pump.fun mint first, or try a live coin'));
    return;
  }
  setUrl(mint);
  skeleton(mint);
  go.disabled = true;
  const [curve, pairs] = await Promise.allSettled([
    loadBondingCurve({ mint, rpcUrl: RPC }),
    tokenPairs(mint, { base: DEX }),
  ]);
  if (my !== seq) return;
  go.disabled = false;
  const list = pairs.status === 'fulfilled' ? pairs.value : [];
  const meta = tokenMeta(list, mint);
  const solLive = solUsdFrom(list);
  const solUsd = solLive || Number(document.getElementById('pg-solusd')?.value) || 150;
  if (curve.status === 'fulfilled') {
    const live = curve.value;
    if (curveInput(live).complete) return pairView(mint, meta, bestPair(list, { graduated: true }), { bonded: true });
    try { return curveView(live, meta, solUsd, !!solLive); } catch (e) { return errorView(mint, new LiveError('bad-account', `could not use this curve: ${e.message}`)); }
  }
  const err = curve.reason instanceof LiveError ? curve.reason : new LiveError('unreachable', String(curve.reason?.message || curve.reason));
  const pair = bestPair(list, { graduated: true });
  if ((err.kind === 'not-found' || err.kind === 'not-pump') && pair) {
    return pairView(mint, meta, pair, { bonded: false, note: `there is no pump.fun bonding curve for this mint. DexScreener lists it on ${pair.dexId || 'an AMM'}, shown here for reference.` });
  }
  errorView(mint, err);
}

async function example() {
  ex.disabled = true;
  const label = ex.textContent;
  ex.textContent = 'finding a fresh coin...';
  let mint = null;
  try { mint = await latestPumpMint({ base: DEX }); } catch { mint = null; }
  ex.disabled = false;
  ex.textContent = label;
  await run(mint || FALLBACK_MINT);
}

function reset() {
  seq++;
  box.hidden = true;
  box.innerHTML = '';
  box.dataset.state = '';
  go.disabled = false;
  input.removeAttribute('aria-invalid');
  setUrl(null);
  window.rampPlayground?.clearLive();
}

form.addEventListener('submit', (e) => { e.preventDefault(); run(input.value); });
ex.addEventListener('click', example);
input.addEventListener('paste', () => setTimeout(() => { if (isAddress(input.value.trim())) run(input.value); }, 0));
box.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.hasAttribute('data-reset')) reset();
  else if (t.hasAttribute('data-retry')) run(box.dataset.mint || input.value);
  else if (t.hasAttribute('data-share') || t.hasAttribute('data-copy')) {
    const text = t.hasAttribute('data-share') ? location.href : t.dataset.copy;
    const was = t.textContent;
    try { await navigator.clipboard.writeText(text); t.textContent = 'Copied'; } catch { t.textContent = 'Copy failed'; }
    setTimeout(() => { t.textContent = was; }, 1400);
  }
});

const first = qs.get('mint') || qs.get('token');
if (first) run(first);
window.rampLive = { run, reset };
