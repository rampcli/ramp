// Browser playground. Expects `M` (src/math.js, inlined) and a <div id="playground">.
// Layout: price chart card on the left, a buy or sell ticket on the right. Every number comes from M.
// Live mode: window.rampPlayground.setLive({ virtualSol, virtualTokens, realTokens, supply, mint, rpc })
// pins the curve to real on-chain reserves (BigInt base units); clearLive() returns to the model.
(function () {
  const root = document.getElementById('playground');
  if (!root) return;
  const boot = window.RAMP_BOOT || {};
  const P = Object.assign({}, M.DEFAULTS, boot.params || {});
  const $ = (id) => root.querySelector('#' + id);
  const n = (v, d = 2) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d });
  const fx = (v, d) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const usd = (v) => '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 0 : 2 });
  const sgn = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const BUY_MIN = 0.01, BUY_MAX = 50, SELL_MIN = 0.01, SELL_MAX = 200; // SOL, and millions of tokens
  const logv = (lo, hi) => (t) => lo * Math.pow(hi / lo, t / 1000);
  const logt = (lo, hi) => (v) => Math.round((Math.log(v / lo) / Math.log(hi / lo)) * 1000);
  const toBuy = logv(BUY_MIN, BUY_MAX), fromBuy = logt(BUY_MIN, BUY_MAX);
  const toSell = logv(SELL_MIN, SELL_MAX), fromSell = logt(SELL_MIN, SELL_MAX);
  const num = (id, label, attrs) => `<label class="field"><span>${label}</span><input id="${id}" type="number" inputmode="decimal" ${attrs}></label>`;
  let live = null;
  let side = 'buy';

  root.innerHTML = `
  <div class="pg">
    <div class="pg-main panel">
      <div class="pg-head">
        <div class="pg-price">
          <span class="label">Spot price, SOL per 1M tokens</span>
          <div class="big"><span id="s-price">0</span><small>SOL</small></div>
          <span class="sub" id="s-price2"></span>
        </div>
        <div class="pg-prog">
          <div class="row"><span class="label">Bonding progress</span><b id="s-bond">0%</b></div>
          <div class="bar" role="progressbar" aria-label="Bonding progress" aria-valuemin="0" aria-valuemax="100"><i id="s-bar"></i></div>
          <div class="foot" id="s-bond2"></div>
        </div>
      </div>
      <div class="pg-chart"><svg id="pg-svg" class="chart-svg" viewBox="0 0 760 390" role="img" aria-label="Price versus SOL raised, launch to graduation"></svg></div>
      <div class="legend pg-legend"><span><i style="background:var(--accent)"></i>price curve</span><span><i style="background:var(--text)"></i><span id="lg-now">coin now</span></span><span><i id="lg-band" style="background:var(--accent);opacity:.4"></i><span id="lg-trade">your buy</span></span><span><i style="background:transparent;box-shadow:inset 0 0 0 2px var(--accent);border-radius:50%"></i>bonds here</span></div>
      <div class="cells">
        <div class="cell"><span>Market cap</span><b id="s-mcap"></b><small id="s-mcap2"></small></div>
        <div class="cell"><span>Mcap when it bonds</span><b id="s-grad"></b><small id="s-grad2"></small></div>
        <div class="cell"><span id="s-after-l">Mcap after your buy</span><b id="s-after"></b><small id="s-after2"></small></div>
        <div class="cell"><span>Price impact</span><b id="s-imp"></b><small>avg vs spot, fee incl.</small></div>
      </div>
    </div>
    <form class="pg-ticket panel" id="pg-form" onsubmit="return false">
      <div class="pg-tt">
        <div class="seg" role="group" aria-label="Side"><button type="button" id="pg-side-buy" class="on" aria-pressed="true">Buy</button><button type="button" id="pg-side-sell" aria-pressed="false">Sell</button></div>
        <span class="pg-tt-note">exact, fee incl.</span>
      </div>
      <div class="slider" id="pg-raised-w"><label for="pg-raised"><span id="pg-raised-l">SOL raised so far</span> <b id="pg-raised-v"></b></label><input id="pg-raised" type="range" min="0" max="85" step="0.1" value="${boot.raised ?? 0}"></div>
      <div class="slider" id="pg-buy-w"><label for="pg-buy">Buy size <b id="pg-buy-v"></b></label><input id="pg-buy" type="range" min="0" max="1000" step="1" value="${fromBuy(boot.buy ?? 1)}"></div>
      <div class="slider" id="pg-sell-w" hidden><label for="pg-sell">Sell size <b id="pg-sell-v"></b></label><input id="pg-sell" type="range" min="0" max="1000" step="1" value="${fromSell(10)}"></div>
      <div class="slider"><label for="pg-fee">Fee <b id="pg-fee-v"></b></label><input id="pg-fee" type="range" min="0" max="5" step="0.05" value="${P.fee}"></div>
      <div class="pg-row">
        ${num('pg-solusd', 'SOL price (USD)', `min="0" step="1" value="${boot.solPrice ?? 150}"`)}
        ${num('pg-own', 'Own % of supply', 'min="0.1" max="70" step="0.1" value="5"')}
      </div>
      <div class="pg-out">
        <div class="pg-get"><span>You get</span><b id="s-out">0</b><small id="s-out2"></small></div>
        <div class="kv"><span>Avg price / 1M</span><b id="s-avg"></b></div>
        <div class="kv"><span>Price after</span><b id="s-pafter"></b></div>
        <div class="kv"><span>Dev buy for <span id="s-ownpct">5%</span></span><b id="s-own"></b></div>
      </div>
      <div class="pg-cmd">
        <code id="pg-cli" aria-label="Same quote from the CLI"></code>
        <button class="btn" id="pg-copy" type="button">Copy CLI command</button>
      </div>
      <details class="pg-adv">
        <summary>Curve parameters</summary>
        <div class="pg-row">
          ${num('pg-vs', 'Virtual SOL', `min="1" step="1" value="${P.virtualSol}"`)}
          ${num('pg-vt', 'Virtual tokens (M)', `min="1" step="1" value="${P.virtualTokens / 1e6}"`)}
        </div>
        <div class="pg-row">
          ${num('pg-ct', 'Curve tokens (M)', `min="1" step="0.1" value="${P.curveTokens / 1e6}"`)}
          ${num('pg-sup', 'Supply (M)', `min="1" step="1" value="${P.supply / 1e6}"`)}
        </div>
      </details>
      <p class="status err" id="pg-err" role="status" aria-live="polite"></p>
    </form>
  </div>`;

  const ids = ['pg-raised', 'pg-buy', 'pg-sell', 'pg-fee', 'pg-solusd', 'pg-own', 'pg-vs', 'pg-vt', 'pg-ct', 'pg-sup'];
  ids.forEach((id) => $(id).addEventListener('input', update));
  $('pg-copy').addEventListener('click', async function () {
    const btn = this;
    try { await navigator.clipboard.writeText($('pg-cli').textContent); btn.textContent = 'Copied'; } catch (e) { btn.textContent = 'Select the line above'; }
    setTimeout(() => { btn.textContent = 'Copy CLI command'; }, 1600);
  });
  function setSide(s) {
    side = s;
    $('pg-side-buy').classList.toggle('on', s === 'buy');
    $('pg-side-sell').classList.toggle('on', s === 'sell');
    $('pg-side-buy').setAttribute('aria-pressed', String(s === 'buy'));
    $('pg-side-sell').setAttribute('aria-pressed', String(s === 'sell'));
    $('pg-buy-w').hidden = s !== 'buy';
    $('pg-sell-w').hidden = s !== 'sell';
    update();
  }
  $('pg-side-buy').addEventListener('click', () => setSide('buy'));
  $('pg-side-sell').addEventListener('click', () => setSide('sell'));

  function params() {
    return {
      virtualSol: Number($('pg-vs').value), virtualTokens: Number($('pg-vt').value) * 1e6,
      curveTokens: Number($('pg-ct').value) * 1e6, supply: Number($('pg-sup').value) * 1e6, fee: Number($('pg-fee').value),
    };
  }

  function fill(el) {
    const min = Number(el.min), max = Number(el.max), v = Number(el.value);
    el.style.setProperty('--fill', (max > min ? ((v - min) / (max - min)) * 100 : 0) + '%');
  }

  function cli(p, raised, amount, sp) {
    const parts = [side === 'buy' ? 'ramp buy' : 'ramp sell', side === 'buy' ? n(amount, amount < 1 ? 3 : 2).replace(/,/g, '') : String(Math.round(amount))];
    if (live) parts.push('--mint', live.mint || 'MINT', '--rpc', live.rpc || 'https://api.mainnet-beta.solana.com');
    else if (raised > 0) parts.push('--from-raised', String(Number(raised.toFixed(1))));
    if (p.fee !== M.DEFAULTS.fee) parts.push('--fee', String(p.fee));
    if (p.virtualSol !== M.DEFAULTS.virtualSol) parts.push('--virtual-sol', String(p.virtualSol));
    if (p.virtualTokens !== M.DEFAULTS.virtualTokens) parts.push('--virtual-tokens', String(p.virtualTokens));
    if (p.curveTokens !== M.DEFAULTS.curveTokens) parts.push('--curve-tokens', String(p.curveTokens));
    if (!live && p.supply !== M.DEFAULTS.supply) parts.push('--supply', String(p.supply));
    if (sp) parts.push('--sol-price', String(sp));
    return parts.join(' ');
  }

  function blank(msg) {
    ['s-out', 's-avg', 's-pafter', 's-after', 's-imp'].forEach((id) => { $(id).textContent = '-'; $(id).className = ''; });
    $('s-out2').textContent = msg;
    $('s-after2').textContent = '';
  }

  function update() {
    const err = $('pg-err');
    const p = params();
    if (live) p.supply = live.supply;
    let base;
    try { base = new M.Curve(p); err.textContent = ''; root.classList.remove('is-error'); } catch (e) { err.textContent = e.message; root.classList.add('is-error'); return; }
    const gs = base.state();
    const slider = $('pg-raised');
    const max = Math.max(0, Math.floor((gs.solToGraduate - 0.05) * 10) / 10);
    if (Number(slider.max) !== max) slider.max = String(max);
    let c;
    try {
      c = live ? base.withReserves(live) : base.withRaised(Math.min(Number(slider.value), max).toFixed(9));
    } catch (e) { err.textContent = e.message; root.classList.add('is-error'); return; }
    const s = c.state();
    const raised = live ? s.solRaised : Math.min(Number(slider.value), max);
    if (live) slider.value = String(Math.min(raised, max));
    slider.disabled = !!live;
    root.classList.toggle('is-live', !!live);
    const sp = Number($('pg-solusd').value) || 0;
    const fee = Number($('pg-fee').value);
    ['pg-raised', 'pg-buy', 'pg-sell', 'pg-fee'].forEach((id) => fill($(id)));
    $('pg-raised-l').textContent = live ? 'SOL raised, live on chain' : 'SOL raised so far';
    $('pg-raised-v').textContent = fx(raised, live ? 3 : 1) + ' SOL';
    $('pg-fee-v').textContent = fx(fee, 2) + '%';
    const u = (v) => (sp ? usd(v * sp) : '');
    $('s-price').textContent = fx(s.price * 1e6, 4);
    $('s-price2').textContent = (sp ? usd(s.price * 1e6 * sp) + ' per 1M, ' : '') + 'mcap ' + n(s.marketCap) + ' SOL';
    $('s-bond').textContent = fx(s.progressPct, 2) + '%';
    $('s-bar').style.width = Math.min(100, s.progressPct) + '%';
    root.querySelector('[role=progressbar]').setAttribute('aria-valuenow', s.progressPct.toFixed(2));
    $('s-bond2').textContent = s.complete ? 'bonded, the curve is complete' : n(s.solToGraduateWithFee, 2) + ' SOL to go, fee incl.';
    $('s-mcap').textContent = n(s.marketCap) + ' SOL';
    $('s-mcap2').textContent = u(s.marketCap) || n(s.tokensSold / 1e6, 1) + 'M sold';
    $('s-grad').textContent = n(s.graduationMarketCap) + ' SOL';
    $('s-grad2').textContent = u(s.graduationMarketCap) || 'at ' + n(gs.solToGraduate, 2) + ' SOL raised';
    $('lg-now').textContent = live ? 'you are here' : 'coin now';
    $('lg-trade').textContent = side === 'buy' ? 'your buy' : 'your sell';
    $('lg-band').style.background = side === 'buy' ? 'var(--accent)' : 'var(--down)';
    $('s-after-l').textContent = side === 'buy' ? 'Mcap after your buy' : 'Mcap after your sell';
    const own = Number($('pg-own').value);
    $('s-ownpct').textContent = n(own, 2) + '%';
    try { $('s-own').textContent = fx(M.planOwn(c, own).solToSpend, 4) + ' SOL'; } catch (e) { $('s-own').textContent = 'n/a'; }

    let trade = null;
    if (side === 'buy') {
      const buy = toBuy(Number($('pg-buy').value));
      $('pg-buy-v').textContent = n(buy, buy < 1 ? 3 : 2) + ' SOL';
      $('pg-cli').textContent = cli(p, raised, buy, sp);
      if (s.complete) blank('the curve is complete, nothing left to buy');
      else {
        const b = c.buy(buy.toFixed(9));
        trade = { from: raised, to: Math.min(gs.solToGraduate, raised + b.solNet) };
        $('s-after').textContent = n(b.marketCapAfter) + ' SOL';
        $('s-after2').textContent = u(b.marketCapAfter) || 'price ' + sgn(b.priceChangePct);
        const imp = $('s-imp');
        imp.textContent = sgn(b.priceImpactPct);
        imp.className = b.priceImpactPct > 15 ? 'down' : '';
        $('s-out').textContent = fx(b.tokensOut / 1e6, 2) + 'M';
        $('s-out2').textContent = fx(b.supplyPct, 3) + '% of supply' + (b.capped ? ', capped where it bonds' : '');
        $('s-avg').textContent = fx(b.avgPrice * 1e6, 4) + ' SOL';
        const pa = $('s-pafter');
        pa.textContent = sgn(b.priceChangePct);
        pa.className = 'up';
      }
    } else {
      const want = toSell(Number($('pg-sell').value)) * 1e6;
      const tokens = Math.min(want, s.tokensSold);
      $('pg-sell-v').textContent = n(tokens / 1e6, tokens < 1e6 ? 3 : 2) + 'M';
      $('pg-cli').textContent = cli(p, raised, Math.max(1, tokens), sp);
      if (tokens < 1) blank(live ? 'nothing has been bought on this curve yet' : 'nothing bought yet at this point, move SOL raised up');
      else {
        const r = c.sell(tokens.toFixed(6));
        trade = { from: Math.max(0, raised - r.solGross), to: raised, sell: true };
        $('s-after').textContent = n(r.marketCapAfter) + ' SOL';
        $('s-after2').textContent = u(r.marketCapAfter) || 'price ' + sgn(r.priceChangePct);
        const imp = $('s-imp');
        imp.textContent = sgn(-r.priceImpactPct);
        imp.className = r.priceImpactPct > 15 ? 'down' : '';
        $('s-out').textContent = fx(r.solOut, r.solOut < 1 ? 4 : 3) + ' SOL';
        $('s-out2').textContent = (sp ? usd(r.solOut * sp) + ', ' : '') + 'fee ' + fx(r.fee, 4) + ' SOL' + (want > s.tokensSold ? ', capped at tokens sold' : '');
        $('s-avg').textContent = fx(r.avgPrice * 1e6, 4) + ' SOL';
        const pa = $('s-pafter');
        pa.textContent = sgn(r.priceChangePct);
        pa.className = 'down';
      }
    }
    draw(base, raised, c, trade);
  }

  function draw(base, raised, c, trade) {
    const svg = $('pg-svg');
    const box = svg.getBoundingClientRect();
    const W = Math.max(300, Math.round(box.width || 760)), H = Math.max(200, Math.round(box.height || 390)), m = { l: 52, r: 24, t: 20, b: 32 };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const pts = M.chartPoints(base, 90);
    const xMax = pts[pts.length - 1].raised, yMax = pts[pts.length - 1].price * 1.12;
    const X = (v) => m.l + (Math.min(v, xMax) / xMax) * (W - m.l - m.r);
    const Y = (v) => m.t + (H - m.t - m.b) * (1 - Math.min(v, yMax) / yMax);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + X(p.raised).toFixed(1) + ',' + Y(p.price).toFixed(1)).join('');
    const pr = (r) => { const vs = base.params.virtualSol + r; return (vs * vs) / (base.params.virtualSol * base.params.virtualTokens); };
    let bandPath = '';
    if (trade && trade.to > trade.from) {
      const seg = pts.filter((p) => p.raised > trade.from && p.raised < trade.to);
      const band = [[trade.from, pr(trade.from)], ...seg.map((p) => [p.raised, p.price]), [trade.to, pr(trade.to)]];
      bandPath = band.map(([x, y], i) => (i ? 'L' : 'M') + X(x).toFixed(1) + ',' + Y(y).toFixed(1)).join('') + `L${X(trade.to).toFixed(1)},${Y(0)}L${X(trade.from).toFixed(1)},${Y(0)}Z`;
    }
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const v = (yMax * i) / 4;
      grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#FFFFFF" stroke-opacity="${i ? '.06' : '.14'}"/><text x="${m.l - 10}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${i ? (v * 1e6).toFixed(2) : '0'}</text>`;
    }
    const step = (xMax > 60 ? 10 : xMax > 25 ? 5 : 2) * (W < 600 ? 2 : 1);
    for (let v = 0; v <= xMax + 1e-9; v += step) {
      grid += `<line x1="${X(v).toFixed(1)}" x2="${X(v).toFixed(1)}" y1="${m.t}" y2="${H - m.b}" stroke="#FFFFFF" stroke-opacity=".04"/>`;
      if (v % (step * 2) === 0 && X(v) < W - m.r - 90) grid += `<text x="${X(v).toFixed(1)}" y="${H - 10}" text-anchor="middle">${v}</text>`;
    }
    const gx = X(xMax), gy = Y(pts[pts.length - 1].price);
    const nx = X(raised), ny = Y(live ? c.price : pr(raised));
    const tag = live ? 'you are here' : '';
    const tagRight = nx < W - 160;
    const tagEl = tag ? `<text x="${(tagRight ? nx + 12 : nx - 12).toFixed(1)}" y="${(ny - 12).toFixed(1)}" text-anchor="${tagRight ? 'start' : 'end'}" style="fill:#EAF5EC">${tag}</text>` : '';
    $('pg-svg').innerHTML = `
      <defs><linearGradient id="pgf" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#B6F23A" stop-opacity=".16"/><stop offset="1" stop-color="#B6F23A" stop-opacity="0"/></linearGradient></defs>
      ${grid}
      <path d="${path}L${X(xMax)},${Y(0)}L${X(0)},${Y(0)}Z" fill="url(#pgf)"/>
      ${bandPath ? `<path d="${bandPath}" fill="${trade.sell ? '#FF6B5B' : '#B6F23A'}" fill-opacity="${trade.sell ? '.28' : '.30'}"/>` : ''}
      <path d="${path}" fill="none" stroke="#B6F23A" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <line x1="${nx.toFixed(1)}" x2="${nx.toFixed(1)}" y1="${ny.toFixed(1)}" y2="${H - m.b}" stroke="#EAF5EC" stroke-opacity=".35" stroke-dasharray="3 3"/>
      <circle cx="${gx}" cy="${gy}" r="7" fill="#0B1F14" stroke="#B6F23A" stroke-width="2"/>
      <text x="${gx - 14}" y="${gy + 4}" text-anchor="end" style="fill:#B6F23A">bonds at ${n(xMax, 2)} SOL</text>
      ${live ? `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="11" fill="#EAF5EC" fill-opacity=".14"/>` : ''}
      <circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="5" fill="#EAF5EC" stroke="#0B1F14" stroke-width="2"/>
      ${tagEl}
      <text x="${W - m.r}" y="${H - 10}" text-anchor="end">SOL raised</text>`;
  }

  window.rampPlayground = {
    /** Pin the playground to on-chain reserves. BigInt (or numeric string) base units, supply in whole tokens. */
    setLive(l) {
      live = { virtualSol: BigInt(l.virtualSol), virtualTokens: BigInt(l.virtualTokens), realTokens: BigInt(l.realTokens), supply: Number(l.supply) || P.supply, mint: l.mint, rpc: l.rpc };
      if (l.solPrice) $('pg-solusd').value = String(Math.round(l.solPrice * 100) / 100);
      update();
    },
    clearLive() { live = null; update(); },
    isLive: () => !!live,
    setSide,
  };

  let rw = 0;
  window.addEventListener('resize', () => { if (window.innerWidth !== rw) { rw = window.innerWidth; update(); } });
  update();
})();
