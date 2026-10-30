// Ledger Homeostat: interface. All numbers come from the engine's ledger.
(function () {
  'use strict';
  const E = window.Engine;
  const { LEVELS, LAB_SCENARIOS, LAB_PRESETS } = window.Levels;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const ACC = Object.fromEntries(E.ACCOUNTS.map(a => [a.id, a]));
  const ISN = Object.fromEntries(E.IS_LINES.map(l => [l.id, l.name]));
  const CFN = Object.fromEntries(E.CF_LINES.map(l => [l.id, l.name]));
  const SECN = { O: 'Operating', I: 'Investing', F: 'Financing' };

  // ---- formatting ----------------------------------------------------------
  const fmt = n => Math.round(Math.abs(n)).toLocaleString('en-US');
  const eur = n => (n < 0 ? '−' : '') + '€' + fmt(n);
  const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + '€' + fmt(n);
  const acct = n => (Math.round(n) < 0 ? `(${fmt(n)})` : fmt(n)); // accountants' parentheses
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const mName = m => (m === 0 ? 'Founding' : E.monthName(m));

  // ---- storage (optional) ------------------------------------------------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const settings = Object.assign({ speed: 'watch', sound: false }, store.get('lh.settings', {}));
  const progress = store.get('lh.progress', {});
  const saveSettings = () => store.set('lh.settings', settings);

  // ---- sound: relay clicks -----------------------------------------------------
  const Sound = {
    ctx: null,
    beep(freq, dur = 0.05, type = 'square', vol = 0.035, when = 0) {
      if (!settings.sound) return;
      try {
        this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
        const t = this.ctx.currentTime + when;
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
      } catch { /* no audio */ }
    },
    entry(e) {
      const c = e.cf ? e.cf.amt : 0;
      this.beep(c > 0 ? 880 : c < 0 ? 330 : 560, 0.045);
      this.beep(1400, 0.015, 'square', 0.02, 0.05);
    },
    win() { [523, 659, 784, 1047].forEach((f, i) => this.beep(f, 0.18, 'triangle', 0.05, i * 0.11)); },
    lose() { [220, 165, 110].forEach((f, i) => this.beep(f, 0.3, 'sawtooth', 0.04, i * 0.18)); },
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // =========================================================================
  // Balance machine: two stacked columns that are always the same height.
  // A negative balance moves to the other column, hatched (a debit balance on
  // the credit side, or vice versa), which is what accountants do too.
  // =========================================================================
  const STACK = {
    A: ['equip', 'inv', 'ar', 'cash'],
    C: ['capital', 're', 'loan', 'ap'],
  };
  const CONTRA = {
    losses: { side: 'A', of: 're', name: 'Losses so far' },
    overdraft: { side: 'C', of: 'cash', name: 'Overdraft' },
  };

  function createMachine(root, { compact = false } = {}) {
    root.innerHTML = `
      <div class="bm-grid">
        <div><div class="bm-head"><h3>What it has</h3><span>Assets</span></div><div class="bm-stack" data-side="A"></div></div>
        <div class="bm-mid"><div class="bm-eq">=</div><div class="bm-beam"></div><div class="bm-fulcrum"></div></div>
        <div><div class="bm-head"><h3>Who claims it</h3><span>Liabilities + equity</span></div><div class="bm-stack" data-side="C"></div></div>
      </div>
      <div class="bm-totals"><span class="tA"></span><span class="chk"></span><span class="tC"></span></div>
      <svg class="bm-wires" aria-hidden="true"></svg>`;
    const stacks = { A: $('.bm-stack[data-side="A"]', root), C: $('.bm-stack[data-side="C"]', root) };
    const segs = {};
    const mk = (id, side, name, cls) => {
      const d = document.createElement('div');
      d.className = `seg-acct a-${cls}`;
      d.style.height = '0px'; d.style.bottom = '0px'; d.style.opacity = '0';
      d.title = id in ACC ? `${name}: ${ACC[id].plain}` : name;
      d.innerHTML = `<span class="sn">${esc(name)}</span><span class="sv"></span>`;
      stacks[side].appendChild(d);
      segs[id] = { el: d, side, name };
    };
    for (const side of ['A', 'C']) for (const id of STACK[side]) mk(id, side, ACC[id].name, id);
    for (const [id, c] of Object.entries(CONTRA)) { mk(id, c.side, c.name, id); segs[id].el.classList.add('contra'); }

    let scaleMax = 0, layout = {}, last = null;
    const api = {
      reset(fixedMax) { scaleMax = fixedMax || 0; },
      render(bal) {
        last = bal;
        const items = { A: [], C: [] };
        for (const side of ['A', 'C']) for (const id of STACK[side]) if (bal[id] > 0) items[side].push([id, bal[id]]);
        if (bal.re < 0) items.A.push(['losses', -bal.re]);
        if (bal.cash < 0) items.C.push(['overdraft', -bal.cash]);
        const tot = s => items[s].reduce((a, [, v]) => a + v, 0);
        const tA = tot('A'), tC = tot('C');
        scaleMax = Math.max(scaleMax, Math.max(tA, tC) * 1.12, 2000);
        layout = {};
        for (const side of ['A', 'C']) {
          const H = stacks[side].clientHeight || (compact ? 220 : 320);
          let y = 0;
          const shown = new Set(items[side].map(([id]) => id));
          for (const [id, v] of items[side]) {
            const h = (v / scaleMax) * H;
            const s = segs[id];
            s.el.style.bottom = y + 'px'; s.el.style.height = Math.max(h, 0) + 'px'; s.el.style.opacity = '1';
            s.el.classList.toggle('tiny', h < 15);
            s.el.classList.toggle('small', h >= 15 && h < 24);
            $('.sv', s.el).textContent = eur(v);
            layout[id] = { side, bottom: y, h, H };
            y += h;
          }
          for (const id of Object.keys(segs)) {
            if (segs[id].side === side && !shown.has(id)) { segs[id].el.style.height = '0px'; segs[id].el.style.opacity = '0'; }
          }
        }
        $('.tA', root).textContent = eur(tA);
        $('.tC', root).textContent = eur(tC);
        const chk = $('.chk', root);
        const ok = Math.round(tA) === Math.round(tC);
        chk.textContent = ok ? 'balanced' : 'OUT OF BALANCE';
        chk.classList.toggle('bad', !ok);
        $('.bm-beam', root).classList.toggle('tilt', !ok);
      },
      // which segment shows an account right now (re may be shown as losses)
      segFor(a, bal = last) {
        if (a === 're' && bal && bal.re < 0) return 'losses';
        if (a === 'cash' && bal && bal.cash < 0) return 'overdraft';
        return a;
      },
      point(id) {
        const L = layout[id];
        if (!L) return null;
        const r0 = root.getBoundingClientRect();
        const r = stacks[L.side].getBoundingClientRect();
        const y = r.bottom - r0.top - (L.bottom + L.h / 2);
        return { x: L.side === 'A' ? r.right - r0.left : r.left - r0.left, cx: (r.left + r.right) / 2 - r0.left, y, top: r.bottom - r0.top - (L.bottom + L.h), side: L.side };
      },
      flashLegs(legs, bal, life = 1100) {
        const svg = $('.bm-wires', root);
        svg.innerHTML = '';
        const pts = [];
        for (const l of legs) {
          const id = api.segFor(l.a, bal);
          const s = segs[id];
          if (!s) continue;
          s.el.classList.remove('flash'); void s.el.offsetWidth; s.el.classList.add('flash');
          const p = api.point(id);
          if (!p) continue;
          pts.push(p);
          if (!reduced) {
            const b = document.createElement('div');
            b.className = 'bm-delta';
            b.textContent = `${ACC[l.a].name} ${sgn(l.d)}`;
            b.style.animationDuration = life + 'ms';
            b.style.left = p.cx + 'px'; b.style.top = Math.max(0, p.top - 22) + 'px';
            root.appendChild(b);
            setTimeout(() => b.remove(), life + 50);
          }
        }
        if (pts.length >= 2 && !reduced) {
          const [p, q] = pts;
          const W = root.clientWidth;
          let d;
          if (p.side !== q.side) {
            const mx = (p.x + q.x) / 2;
            d = `M${p.x} ${p.y} C${mx} ${p.y} ${mx} ${q.y} ${q.x} ${q.y}`;
          } else {
            const out = p.side === 'A' ? 6 : W - 6;
            const ax = p.side === 'A' ? p.x - (p.x - p.cx) * 2 : p.x + (p.cx - p.x) * -2;
            d = `M${ax} ${p.y} C${out} ${p.y} ${out} ${q.y} ${ax} ${q.y}`;
          }
          svg.setAttribute('viewBox', `0 0 ${W} ${root.clientHeight}`);
          svg.innerHTML = `<path d="${d}"/>`;
        }
      },
      clearWires() { $('.bm-wires', root).innerHTML = ''; },
      highlight(accts) {
        for (const [id, s] of Object.entries(segs)) {
          const a = CONTRA[id] ? CONTRA[id].of : id;
          s.el.classList.toggle('hit', !!accts && accts.has(a));
          s.el.classList.toggle('dim', !!accts && !accts.has(a));
        }
      },
      tilt(on) { $('.bm-beam', root).classList.toggle('tilt', on); },
    };
    return api;
  }

  // =========================================================================
  // Charts
  // =========================================================================
  function lineChart(svg, { n, series, zero = true, danger = false, events = [], cursor = null, dead = null, area = null, fmtY = v => eur(v) }) {
    const w = svg.clientWidth || 600, h = svg.clientHeight || 170;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const pl = 54, pr = 10, pt = 8, pb = 18;
    const all = series.flatMap(s => s.values.filter(v => v != null));
    let lo = Math.min(0, ...all), hi = Math.max(1, ...all);
    if (hi - lo < 1) hi = lo + 1;
    const pad = (hi - lo) * 0.08; hi += pad; if (lo < 0) lo -= pad;
    const X = i => pl + (i / Math.max(1, n)) * (w - pl - pr);
    const Y = v => pt + (1 - (v - lo) / (hi - lo)) * (h - pt - pb);
    let out = '';
    const ticks = niceTicks(lo, hi, 4);
    for (const t of ticks) out += `<line class="ch-grid" x1="${pl}" x2="${w - pr}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ch-label" x="${pl - 6}" y="${Y(t) + 3}" text-anchor="end">${fmtY(t)}</text>`;
    if (danger && lo < 0) out += `<rect class="ch-danger" x="${pl}" y="${Y(0)}" width="${w - pl - pr}" height="${Y(lo) - Y(0)}"/>`;
    if (zero) out += `<line class="ch-zero" x1="${pl}" x2="${w - pr}" y1="${Y(0)}" y2="${Y(0)}"/>`;
    const step = n > 24 ? 6 : n > 12 ? 3 : 1;
    for (let i = 0; i <= n; i += step) out += `<text class="ch-label" x="${X(i)}" y="${h - 4}" text-anchor="middle">${i === 0 ? '0' : i}</text>`;
    for (const m of events) out += `<line class="ch-event" x1="${X(m)}" x2="${X(m)}" y1="${pt}" y2="${h - pb}"/>`;
    if (area) {
      const pts = area.values.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`)).filter(Boolean);
      if (pts.length) out += `<polygon class="ch-area ${area.cls}" points="${X(0)},${Y(0)} ${pts.join(' ')} ${X(area.values.length - 1)},${Y(0)}"/>`;
    }
    for (const s of series) {
      const pts = s.values.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`)).filter(Boolean);
      if (pts.length > 1) out += `<polyline class="ch-line ${s.cls}" points="${pts.join(' ')}"/>`;
      if (s.dot) {
        const i = s.values.length - 1;
        if (s.values[i] != null) out += `<circle class="ch-dot ${s.cls}" cx="${X(i)}" cy="${Y(s.values[i])}" r="4.5"/>`;
      }
    }
    if (dead != null) out += `<text class="ch-label" x="${X(dead)}" y="${pt + 10}" text-anchor="middle" style="fill:var(--bad);font-weight:600">insolvent</text><circle class="ch-dead" cx="${X(dead)}" cy="${Y(series[0].values[dead] ?? 0)}" r="5"/>`;
    if (cursor != null) out += `<line class="ch-cursor" x1="${X(cursor)}" x2="${X(cursor)}" y1="${pt}" y2="${h - pb}"/>`;
    svg.innerHTML = out;
  }
  function niceTicks(lo, hi, count) {
    const span = hi - lo, raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const stepv = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => span / s <= count + 1) || 10 * mag;
    const out = [];
    for (let t = Math.ceil(lo / stepv) * stepv; t <= hi; t += stepv) out.push(Math.round(t));
    return out;
  }
  const kfmt = v => (Math.abs(v) >= 1000 ? (v < 0 ? '−' : '') + '€' + Math.round(Math.abs(v) / 1000) + 'k' : eur(v));

  // =========================================================================
  // Printouts: income statement, cash flow statement, balance sheet, bridge, journal
  // =========================================================================
  function usedLines(game) {
    const is = new Set(['revenue', 'cogs']), cf = new Set(['collect', 'suppliers']);
    for (const r of game.history) for (const e of r.entries) { if (e.is) is.add(e.is.line); if (e.cf) cf.add(e.cf.line); }
    return { is, cf };
  }

  function periodSpan(game, period) {
    const last = game.history[game.history.length - 1].m;
    return period === 'all' ? E.span(game.history, 0, last) : E.span(game.history, period, period);
  }

  function renderPaper(paper, game, period, { printing = false, journalOpen = true, compact = false } = {}) {
    const sp = periodSpan(game, period);
    const st = E.statements(sp);
    const used = usedLines(game);
    const label = period === 'all' ? 'since founding' : mName(period);
    let i = 0;
    const row = (cls, key, lbl, val, link) =>
      `<div class="row ${cls}" ${key ? `data-row="${key}"` : ''} style="--i:${i++}"><span class="lbl">${lbl}${link ? `<span class="link">${link}</span>` : ''}</span>${val == null ? '<span></span>' : `<button type="button" class="amt ${Math.round(val) === 0 ? 'zero' : ''}" data-trace="${key}" title="Trace this number">${acct(val)}</button>`}</div>`;

    let h = '';
    // Income statement
    h += `<section class="stmt"><div class="stmt-title" style="--i:${i++}"><span>Income statement</span><span>${label}</span></div>`;
    if (!compact) h += `<p class="stmt-sub">The story of how Retained earnings changed. Revenue in, expenses out.</p>`;
    for (const l of E.IS_LINES) if (used.is.has(l.id)) h += row('', `is:${l.id}`, l.name, st.is[l.id]);
    h += row('grand', 'ni', 'Profit (net income)', st.ni, `→ Retained earnings ${eur(sp.open.re)} → ${eur(sp.close.re)}`);
    h += `</section>`;

    // Cash flow statement
    h += `<section class="stmt"><div class="stmt-title" style="--i:${i++}"><span>Cash flow statement</span><span>${label}</span></div>`;
    if (!compact) h += `<p class="stmt-sub">The story of how Cash changed. Only entries that touch the Cash tank appear here.</p>`;
    for (const sec of ['O', 'I', 'F']) {
      const lines = E.CF_LINES.filter(l => l.sec === sec && used.cf.has(l.id));
      if (!lines.length && sec !== 'O') continue;
      h += row('sec', null, SECN[sec], null);
      for (const l of lines) h += row('ind', `cf:${l.id}`, l.name, st.cf[l.id]);
      h += row('total', `cfsec:${sec}`, `${SECN[sec]} cash flow`, sec === 'O' ? st.cfo : sec === 'I' ? st.cfi : st.cff);
    }
    h += row('grand', 'cfnet', 'Change in cash', st.net, `→ Cash ${eur(sp.open.cash)} → ${eur(sp.close.cash)}`);
    h += `</section>`;

    // Balance sheet
    h += `<section class="stmt bs-grid"><div class="stmt-title" style="--i:${i++}"><span>Balance sheet</span><span>${period === 'all' ? 'founding → now' : 'start → end of ' + label}</span></div>`;
    if (!compact) h += `<p class="stmt-sub">A snapshot of every tank. The change column links back to the two statements above.</p>`;
    h += `<div class="row hdr" style="--i:${i++}"><span></span><span>start</span><span>end</span><span>change</span></div>`;
    const bsRow = (id, link) => {
      const o = sp.open[id], c = sp.close[id];
      return `<div class="row" data-row="bs:${id}" style="--i:${i++}"><span class="lbl" title="${esc(ACC[id].plain)}">${ACC[id].name}${link ? `<span class="link">${link}</span>` : ''}</span><span>${acct(o)}</span><span>${acct(c)}</span><span><button type="button" class="amt ${c - o === 0 ? 'zero' : ''}" data-trace="bs:${id}">${c - o === 0 ? '–' : (c - o > 0 ? '+' : '') + acct(c - o)}</button></span></div>`;
    };
    const totRow = (lbl, side) => {
      const t = b => E.ACCOUNTS.filter(a => side.includes(a.side)).reduce((x, a) => x + b[a.id], 0);
      return `<div class="row total" style="--i:${i++}"><span class="lbl">${lbl}</span><span>${acct(t(sp.open))}</span><span>${acct(t(sp.close))}</span><span>${acct(t(sp.close) - t(sp.open))}</span></div>`;
    };
    h += row('sec', null, 'Assets', null);
    for (const id of ['cash', 'ar', 'inv', 'equip']) h += bsRow(id, id === 'cash' ? '= change in cash, above' : '');
    h += totRow('Total assets', ['A']);
    h += row('sec', null, 'Liabilities', null);
    for (const id of ['ap', 'loan']) h += bsRow(id);
    h += row('sec', null, 'Equity', null);
    for (const id of ['capital', 're']) h += bsRow(id, id === 're' ? '= profit, above' : '');
    h += totRow('Total claims', ['L', 'E']);
    const diff = st.assets - st.liabilities - st.equity;
    h += `<div class="row" style="--i:${i++}"><span class="lbl">Assets − claims</span><span></span><span class="${diff === 0 ? 'bal-ok' : 'neg'}">${diff === 0 ? '0 ✓' : acct(diff)}</span><span></span></div>`;
    h += `</section>`;

    // Bridge
    h += `<section class="stmt bridge"><div class="stmt-title" style="--i:${i++}"><span>From profit to cash</span><span>${label}</span></div>`;
    if (!compact) h += `<p class="stmt-sub">Why the two statements disagree. Start at profit, adjust for every tank that soaked up or released cash, and you land exactly on the change in cash. Click a bar to trace it.</p>`;
    h += bridgeSVG(st);
    h += `</section>`;

    // Journal
    if (!compact) {
      h += `<section class="stmt journal"><details ${journalOpen ? 'open' : ''}><summary>Journal · ${sp.entries.length} entries</summary>`;
      for (const e of sp.entries) {
        const legs = e.legs.map(l => {
          const debit = (E.SIDE[l.a] === 'A') === (l.d > 0);
          return `<span>${debit ? 'Dr' : 'Cr'} ${ACC[l.a].name} ${fmt(l.d)}</span>`;
        }).join('');
        h += `<div class="je" data-je="${e.id}"><div class="jt"><b>${mName(e.m)}</b> · ${esc(e.text)}</div><div class="jl">${legs}${e.is ? `<span>IS: ${ISN[e.is.line]}</span>` : ''}${e.cf ? `<span>CF: ${SECN[e.cf.sec]}</span>` : ''}</div></div>`;
      }
      h += `</details></section>`;
    }
    paper.innerHTML = h;
    paper.classList.remove('printing');
    if (printing && !reduced) { void paper.offsetWidth; paper.classList.add('printing'); }
    return { sp, st };
  }

  function bridgeSteps(st) {
    const b = st.bridge;
    const steps = [{ k: 'ni', lbl: 'Profit', v: st.ni, total: true }];
    if (b.dep) steps.push({ k: 'is:dep', lbl: '+ depreciation (no cash)', v: b.dep });
    if (b.dAR) steps.push({ k: 'bs:ar', lbl: b.dAR < 0 ? '− customers owe more' : '+ customers paid down', v: b.dAR });
    if (b.dInv) steps.push({ k: 'bs:inv', lbl: b.dInv < 0 ? '− more kits on shelf' : '+ fewer kits on shelf', v: b.dInv });
    if (b.dAP) steps.push({ k: 'bs:ap', lbl: b.dAP > 0 ? '+ owe supplier more' : '− paid supplier down', v: b.dAP });
    steps.push({ k: 'cfsec:O', lbl: '= operating cash flow', v: st.cfo, total: true });
    if (st.cfi) steps.push({ k: 'cfsec:I', lbl: 'investing', v: st.cfi });
    if (st.cff) steps.push({ k: 'cfsec:F', lbl: 'financing', v: st.cff });
    steps.push({ k: 'bs:cash', lbl: '= change in cash', v: st.net, total: true, cash: true });
    return steps;
  }

  function bridgeSVG(st) {
    const steps = bridgeSteps(st);
    let run = 0;
    const bars = steps.map(s => {
      let a, b;
      if (s.total) { a = 0; b = s.v; run = s.v; } else { a = run; b = run + s.v; run = b; }
      return { ...s, a, b };
    });
    const lo = Math.min(0, ...bars.flatMap(x => [x.a, x.b])), hi = Math.max(0, ...bars.flatMap(x => [x.a, x.b]));
    const W = 360, LW = 150, VW = 58, rh = 20, H = bars.length * rh + 6;
    const X = v => LW + ((v - lo) / Math.max(1, hi - lo)) * (W - LW - VW - 6);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Waterfall from profit to change in cash">`;
    s += `<line class="wf-axis" x1="${X(0)}" x2="${X(0)}" y1="0" y2="${H}"/>`;
    bars.forEach((x, i) => {
      const y = i * rh + 3;
      const x0 = X(Math.min(x.a, x.b)), w = Math.max(1.5, Math.abs(X(x.b) - X(x.a)));
      const cls = x.cash ? 'wf-cash' : x.total ? 'wf-total' : x.v >= 0 ? 'wf-up' : 'wf-down';
      s += `<g class="wf-bar" data-trace="${x.k}" tabindex="0" role="button" aria-label="${esc(x.lbl)} ${acct(x.v)}"><rect x="${LW - 150}" y="${y - 2}" width="${W}" height="${rh}" fill="transparent"/>`;
      s += `<text class="wf-lbl" x="2" y="${y + 11}">${esc(x.lbl)}</text><rect class="${cls}" x="${x0}" y="${y + 2}" width="${w}" height="${rh - 8}" rx="1.5"/>`;
      s += `<text class="wf-val" x="${W - 2}" y="${y + 11}" text-anchor="end">${acct(x.v)}</text></g>`;
      if (i < bars.length - 1) s += `<line class="wf-conn" x1="${X(x.b)}" x2="${X(x.b)}" y1="${y + rh - 6}" y2="${y + rh + 4}"/>`;
    });
    return s + '</svg>';
  }

  // ---- trace: click any number, see where it came from ------------------------
  function traceInfo(key, sp, st) {
    const [kind, arg] = key.split(':');
    let pred, label, amount;
    switch (kind) {
      case 'is': pred = e => e.is && e.is.line === arg; label = ISN[arg]; amount = st.is[arg]; break;
      case 'ni': pred = e => !!e.is; label = 'Profit'; amount = st.ni; break;
      case 'cf': pred = e => e.cf && e.cf.line === arg; label = CFN[arg]; amount = st.cf[arg]; break;
      case 'cfsec': pred = e => e.cf && e.cf.sec === arg; label = `${SECN[arg]} cash flow`; amount = arg === 'O' ? st.cfo : arg === 'I' ? st.cfi : st.cff; break;
      case 'cfnet': pred = e => !!e.cf; label = 'Change in cash'; amount = st.net; break;
      case 'bs': pred = e => e.legs.some(l => l.a === arg); label = `Change in ${ACC[arg].name}`; amount = sp.close[arg] - sp.open[arg]; break;
      default: return null;
    }
    const entries = sp.entries.filter(pred);
    const accts = {}, isL = {}, cfL = {};
    for (const e of entries) {
      for (const l of e.legs) accts[l.a] = (accts[l.a] || 0) + l.d;
      if (e.is) isL[e.is.line] = (isL[e.is.line] || 0) + e.is.amt;
      if (e.cf) cfL[e.cf.line] = (cfL[e.cf.line] || 0) + e.cf.amt;
    }
    return { key, label, amount, entries, accts, isL, cfL };
  }

  function traceText(t) {
    const n = t.entries.length;
    if (!n) return `<p><b>${esc(t.label)} ${sgn(t.amount)}</b>: no entries this period touched it.</p>`;
    const list = o => Object.entries(o).filter(([, v]) => v !== 0);
    const tanks = list(t.accts).map(([a, v]) => `${ACC[a].name} ${sgn(v)}`).join(' · ');
    const isTxt = list(t.isL).length ? list(t.isL).map(([l, v]) => `${ISN[l]} ${sgn(v)}`).join(' · ') : 'nothing. Profit did not move.';
    const cfTxt = list(t.cfL).length ? list(t.cfL).map(([l, v]) => `${CFN[l]} ${sgn(v)}`).join(' · ') : 'nothing. No cash changed hands.';
    return `<p><b>${esc(t.label)} ${sgn(t.amount)}</b> comes from ${n} journal entr${n === 1 ? 'y' : 'ies'}, highlighted in the journal.</p>
      <p>Together they moved these tanks: ${tanks}.</p>
      <p>On the income statement: ${isTxt}<br>On the cash flow statement: ${cfTxt}</p>`;
  }

  function applyTrace(paper, machine, t) {
    $$('.row', paper).forEach(r => r.classList.remove('hit'));
    $$('.je', paper).forEach(j => j.classList.remove('hit', 'dim'));
    if (!t) { machine && machine.highlight(null); return; }
    const keys = new Set([...Object.keys(t.isL).map(l => 'is:' + l), ...Object.keys(t.cfL).map(l => 'cf:' + l), ...Object.keys(t.accts).filter(a => t.accts[a] !== 0).map(a => 'bs:' + a), t.key]);
    $$('.row[data-row]', paper).forEach(r => r.classList.toggle('hit', keys.has(r.dataset.row)));
    const ids = new Set(t.entries.map(e => String(e.id)));
    $$('.je', paper).forEach(j => { j.classList.toggle('hit', ids.has(j.dataset.je)); j.classList.toggle('dim', !ids.has(j.dataset.je)); });
    const det = $('.journal details', paper); if (det) det.open = true;
    machine && machine.highlight(new Set(Object.keys(t.accts).filter(a => t.accts[a] !== 0)));
  }

  // ---- gap: profit minus cash change, explained by the other tanks -------------
  // From A = L + E:  Δcash = profit − ΔAR − ΔInv − ΔEquip + ΔAP + ΔLoan + ΔCapital
  function gapParts(open, close) {
    const d = k => close[k] - open[k];
    return [
      ['ar', d('ar'), 'customers owe more', 'customers paid down what they owed'],
      ['inv', d('inv'), 'more kits sitting on the shelf', 'kits sold off the shelf'],
      ['equip', d('equip'), 'workbenches bought: cash now, expense later', 'depreciation: an expense that cost no cash'],
      ['ap', -d('ap'), 'paid the supplier down', 'supplier not paid yet'],
      ['loan', -d('loan'), 'repaid the bank', 'borrowed from the bank'],
      ['capital', -d('capital'), '', 'owner put money in'],
    ].filter(p => p[1] !== 0).map(([a, v, up, down]) => ({ a, v, why: v > 0 ? up : down }));
  }
  function gapSentence(open, close, ni, dcash) {
    const parts = gapParts(open, close);
    if (!parts.length) return 'Profit and the change in cash are the same: no other tank moved.';
    // each part's effect on cash, relative to profit
    const list = parts.map(p => `<b>${ACC[p.a].name} ${sgn(-p.v)}</b> (${p.why})`).join(', ');
    if (Math.abs(ni - dcash) < 1) return `Profit and cash both ${sgn(ni)}, but only because these cancel out: ${list}.`;
    return `Profit ${sgn(ni)}, cash ${sgn(dcash)}. From profit to cash: ${list}.`;
  }

  // =========================================================================
  // Navigation
  // =========================================================================
  const screens = ['map', 'play', 'lab'];
  function show(name) {
    if (name === 'guide') { openGuide(); return; }
    for (const s of screens) $('#' + s).hidden = s !== name;
    $$('.topnav [data-nav]').forEach(b => b.toggleAttribute('aria-current', b.dataset.nav === name || (name === 'play' && b.dataset.nav === 'map')));
    $$('.topnav [aria-current]').forEach(b => b.setAttribute('aria-current', 'page'));
    if (name === 'map') { renderMap(); heroTick(); }
    if (name === 'lab') Lab.enter();
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', e => {
    const n = e.target.closest('[data-nav]');
    if (n) show(n.dataset.nav);
  });
  $('#homeBtn').addEventListener('click', () => show('map'));
  const soundBtn = $('#soundBtn');
  const syncSound = () => { soundBtn.setAttribute('aria-pressed', settings.sound); soundBtn.textContent = settings.sound ? 'Sound on' : 'Sound off'; };
  soundBtn.addEventListener('click', () => { settings.sound = !settings.sound; saveSettings(); syncSound(); Sound.beep(880, 0.05); });
  syncSound();

  // =========================================================================
  // Map
  // =========================================================================
  const starSVG = on => `<svg class="star ${on ? 'on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.2 6.6.7-5 4.5 1.4 6.6L12 17.2l-5.9 3.3 1.4-6.6-5-4.5 6.6-.7z"/></svg>`;
  function renderMap() {
    $('#levelList').innerHTML = LEVELS.map((l, i) => {
      const p = progress[l.id] || {};
      return `<li><button type="button" class="level-card" data-level="${i}">
        <span class="lc-num">${i + 1}</span><h3>${esc(l.title)}</h3>
        <dl><dt>New</dt><dd>${esc(l.newThing)}</dd><dt>Idea</dt><dd>${esc(l.idea)}</dd><dt>Length</dt><dd>${l.months} months</dd></dl>
        <span class="stars" aria-label="${p.stars || 0} of 3 stars">${[1, 2, 3].map(k => starSVG((p.stars || 0) >= k)).join('')}</span>
      </button></li>`;
    }).join('');
  }
  $('#levelList').addEventListener('click', e => {
    const b = e.target.closest('[data-level]');
    if (b) Play.start(+b.dataset.level);
  });

  let heroTick = () => {}, heroRunning = false;
  function drawHeroLoop() {
    const svg = $('#heroLoop');
    const box = (x, y, w, h, t, sub, cls = '') =>
      `<rect class="hl-box ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/><text class="hl-text ${cls ? 'on-sig' : ''}" x="${x + w / 2}" y="${y + h / 2 - 2}">${t}</text><text class="hl-sub" x="${x + w / 2}" y="${y + h / 2 + 14}" ${cls ? 'style="fill:var(--signal-ink)"' : ''}>${sub}</text>`;
    svg.setAttribute('viewBox', '0 0 440 300');
    svg.innerHTML = `
      <defs>
        <marker id="hlHead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="hl-head" d="M0 0L10 5L0 10z"/></marker>
        <marker id="hlHeadBad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="hl-head bad" d="M0 0L10 5L0 10z"/></marker>
      </defs>
      ${box(10, 80, 150, 56, 'Your levers', 'EFFECTORS', 'sig')}
      ${box(280, 80, 150, 56, 'Firm &amp; market', 'THE TANKS')}
      ${box(280, 230, 150, 56, 'Ledger', 'SENSOR')}
      ${box(10, 230, 150, 56, 'Statements → you', 'COMPARATOR')}
      ${box(300, 8, 110, 36, 'Disturbances', '')}
      <path class="hl-arrow" d="M160 108 H276"/>
      <path class="hl-arrow" d="M355 136 V226"/>
      <path class="hl-arrow" d="M280 258 H164"/>
      <path class="hl-arrow" d="M85 230 V140"/>
      <path class="hl-arrow dist" d="M355 44 V76"/>
      <text class="hl-sub" x="220" y="100">act</text>
      <text class="hl-sub" x="368" y="186" style="text-anchor:start">record</text>
      <text class="hl-sub" x="220" y="250">report</text>
      <text class="hl-sub" x="72" y="186" style="text-anchor:end">steer</text>
      <text class="hl-text" x="220" y="176">feedback loop</text>
      <text class="hl-sub" x="220" y="196" style="fill:var(--bad)">keep cash ≥ 0</text>
      <circle class="hl-pulse" r="5" cx="85" cy="108" id="heroDot"/>`;
    if (reduced) return;
    // a signal travelling round the loop
    const pts = [[85, 108], [355, 108], [355, 258], [85, 258]];
    const segL = pts.map((p, i) => { const q = pts[(i + 1) % 4]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
    const total = segL.reduce((a, b) => a + b, 0);
    const dot = $('#heroDot');
    const tick = t => {
      let d = ((t / 6000) % 1) * total, i = 0;
      while (d > segL[i]) { d -= segL[i]; i++; }
      const p = pts[i], q = pts[(i + 1) % 4], f = d / segL[i];
      dot.setAttribute('cx', p[0] + (q[0] - p[0]) * f); dot.setAttribute('cy', p[1] + (q[1] - p[1]) * f);
      if (!$('#map').hidden) requestAnimationFrame(tick); else heroRunning = false;
    };
    heroTick = () => { if (!heroRunning) { heroRunning = true; requestAnimationFrame(tick); } };
    heroTick();
  }

  // =========================================================================
  // Prediction questions: the player's mental model is a regulator too
  // =========================================================================
  const sign3 = v => (v > 0 ? 'up' : v < 0 ? 'down' : 'same');
  const QUESTIONS = {
    gap: {
      q: 'This month, which will be bigger: the profit, or the change in cash?',
      opts: [['profit', 'Profit'], ['same', 'Same'], ['cash', 'Cash change']],
      ans: r => { const d = r.stmt.ni - r.stmt.net; return Math.abs(d) < 1 ? 'same' : d > 0 ? 'profit' : 'cash'; },
    },
    cashUp: {
      q: 'Will cash end the month higher or lower than it starts?',
      opts: [['up', 'Higher'], ['down', 'Lower']],
      ans: r => (r.stmt.net >= 0 ? 'up' : 'down'),
    },
    arUp: {
      q: 'At month end, will customers owe you more or less than now?',
      opts: [['up', 'More'], ['same', 'Same'], ['down', 'Less']],
      ans: r => sign3(r.close.ar - r.open.ar),
    },
    invUp: {
      q: 'Will you end the month with more or fewer kits on the shelf?',
      opts: [['up', 'More'], ['same', 'Same'], ['down', 'Fewer']],
      ans: r => sign3(r.closeUnits - r.openUnits),
    },
    profitPos: {
      q: 'Will this month show a profit or a loss?',
      opts: [['profit', 'Profit'], ['loss', 'Loss']],
      ans: r => (r.stmt.ni >= 0 ? 'profit' : 'loss'),
    },
    equityUp: {
      q: "Will the owner's stake (equity) grow or shrink this month?",
      opts: [['up', 'Grow'], ['down', 'Shrink']],
      ans: r => ((r.close.capital + r.close.re) - (r.open.capital + r.open.re) >= 0 ? 'up' : 'down'),
    },
  };

  // =========================================================================
  // Play
  // =========================================================================
  const Play = (() => {
    let L = null, li = 0, game = null, machine = null, busy = false, period = 0, trace = null;
    let token = 0; // bumped on every (re)start so an abandoned month stops animating
    let pred = { qid: null, pick: null, results: [], last: null };
    const lever = id => $(`.lever[data-lever="${id}"]`);

    function start(i) {
      li = i; L = LEVELS[i];
      token++; busy = false;
      game = E.newGame(L, (Math.random() * 1e9) | 0);
      pred = { qid: null, pick: null, results: [], last: null };
      trace = null; period = 0;
      show('play');
      machine = machine || createMachine($('#machine'));
      machine.reset();
      machine.render({ cash: 0, ar: 0, inv: 0, equip: 0, ap: 0, loan: 0, capital: 0, re: 0 });
      $('#lvlNum').textContent = `Level ${i + 1} of ${LEVELS.length}`;
      $('#lvlTitle').textContent = L.title;
      const sc = game.sc;
      for (const id of ['price', 'terms', 'order', 'bench', 'loan']) lever(id).hidden = !L.controls.includes(id);
      $('#price').value = sc.defaults.price;
      $('#order').value = sc.defaults.order;
      $('#bench').value = 0;
      setTerms(sc.terms.locked ?? sc.defaults.terms);
      $('#paper').innerHTML = '';
      $('#ticker').innerHTML = `<div class="t-top"><span>Ledger</span></div><p class="t-text">The books are closed. Open them to start.</p>`;
      renderMeters(null);
      renderConsole(true);
      intro();
    }

    function intro() {
      const sc = game.sc;
      modal(`
        <p class="eyebrow">Level ${li + 1} · ${esc(L.months)} months</p>
        <h2 id="modalTitle">${esc(L.title)}</h2>
        <div class="tags"><span class="tag sig">New: ${esc(L.newThing)}</span><span class="tag">Idea: ${esc(L.idea)}</span></div>
        ${L.intro.map(p => `<p>${esc(p)}</p>`).join('')}
        <p><b>Goal:</b> ${eur(L.goal.profit)} profit in ${L.months} months, and cash never below zero at a month's end.${sc.unitCost ? ` Kits cost you ${eur(sc.unitCost)} each.` : ''}${sc.overhead ? ` Rent and wages are ${eur(sc.overhead)} a month.` : ''}</p>
        <div class="modal-actions"><button type="button" class="primary" data-act="open">Open the books</button><button type="button" data-act="map">Back to levels</button></div>`,
        { open: () => { closeModal(); founding(); }, map: () => { closeModal(); show('map'); } });
    }

    async function founding() {
      const rec = game.history[0], my = token;
      busy = true; lockUI(true);
      await playEntries(rec, true);
      if (my !== token) return;
      period = 0;
      renderPeriodSel();
      renderPaper($('#paper'), game, period, { printing: true });
      renderTrend();
      busy = false; lockUI(false);
      setLoop('levers');
      renderConsole();
    }

    // ---- console ----
    function setTerms(t) {
      const sc = game.sc;
      const labels = ['Pay now', '30 days', '60 days'];
      const allowed = sc.terms.locked != null ? [sc.terms.locked] : sc.terms.allowed;
      $('#terms').innerHTML = [0, 1, 2].map(k => `<button type="button" role="radio" data-terms="${k}" aria-checked="${k === t}" ${allowed.includes(k) ? '' : 'disabled'}>${labels[k]}</button>`).join('');
      $('#terms').dataset.value = t;
    }
    $('#terms').addEventListener('click', e => {
      const b = e.target.closest('[data-terms]');
      if (b && !b.disabled && !busy) { setTerms(+b.dataset.terms); renderHints(); }
    });
    $$('[data-step]').forEach(b => b.addEventListener('click', () => {
      const inp = $('#' + b.dataset.step);
      inp.value = clamp((+inp.value || 0) + +b.dataset.d, +inp.min, +inp.max);
      renderHints();
    }));
    for (const id of ['price', 'order', 'bench', 'loan']) $('#' + id).addEventListener('input', () => renderHints());

    function readLevers() {
      return {
        price: +$('#price').value,
        terms: +$('#terms').dataset.value,
        order: Math.max(0, Math.round(+$('#order').value || 0)),
        buyBenches: clamp(Math.round(+$('#bench').value || 0), 0, 4),
        borrow: +$('#loan').value || 0,
      };
    }

    function renderHints() {
      if (!game) return;
      const sc = game.sc, d = readLevers(), last = game.history[game.history.length - 1];
      $('#priceOut').textContent = eur(d.price);
      const margin = d.price - game.unitCost;
      $('#priceHint').textContent = `Kits cost you ${eur(game.unitCost)}, so each sale earns ${eur(margin)} before rent and wages. Higher prices mean fewer buyers.`;
      const boost = Math.round((sc.termsBoost[d.terms] - 1) * 100);
      $('#termsHint').textContent = sc.terms.locked != null ? 'The big retailers insist on 60 days. Not negotiable.' :
        d.terms === 0 ? 'Cash at the till. Profit and cash arrive together.' : `${boost}% more customers. Revenue now, cash in ${d.terms * 30} days.`;
      $('#orderOut').textContent = `${d.order} kits`;
      const pipe = game.pipeline.map(p => `${p.units} arriving ${mName(p.arrive)}`).join(', ');
      $('#orderHint').textContent = `On the shelf: ${game.invUnits}. ${pipe ? 'On the way: ' + pipe + '. ' : ''}This order arrives ${sc.leadTime === 0 ? 'this month' : 'in ' + mName(game.month + 1 + sc.leadTime)}${game.cod ? ' and must be paid in cash on arrival' : `; you pay ${sc.supplierCredit} month after that`}. Cost ${eur(d.order * game.unitCost)}.`;
      $('#benchOut').textContent = d.buyBenches ? `${d.buyBenches} × ${eur(sc.bench.cost)}` : 'none';
      const cap = E.capacityOf(game);
      $('#benchHint').textContent = `Capacity: ${isFinite(cap) ? cap : '∞'} kits a month (${game.benches.length} bench${game.benches.length === 1 ? '' : 'es'}). Last month's demand: ${last.demand ?? '–'}. Each bench: ${eur(sc.bench.cost)} cash now, ${eur(sc.bench.cost / sc.bench.life)}/month depreciation for ${sc.bench.life} months.`;
      if (sc.loan) {
        const loanEl = $('#loan');
        loanEl.min = -game.bal.loan; loanEl.max = sc.loan.limit - game.bal.loan;
        $('#loanOut').textContent = d.borrow > 0 ? `borrow ${eur(d.borrow)}` : d.borrow < 0 ? `repay ${eur(-d.borrow)}` : 'no change';
        $('#loanHint').textContent = `Loan: ${eur(game.bal.loan)} of ${eur(sc.loan.limit)} limit, ${(game.rate * 100).toFixed(1)}% interest a month. Slide right to borrow, left to repay.`;
      }
    }

    function renderConsole(preStart) {
      const sc = game.sc, m = game.month, last = game.history[game.history.length - 1];
      const over = game.status !== 'running';
      $('#monthLabel').textContent = over ? (game.status === 'insolvent' ? `Insolvent in ${mName(m)}` : `All ${sc.months} months done`) : preStart ? 'Books closed' : `Next: ${mName(m + 1)} (month ${m + 1} of ${sc.months})`;
      $('#monthDots').innerHTML = Array.from({ length: sc.months }, (_, i) => {
        const k = i + 1;
        const c = k < m ? 'done' : k === m ? (game.status === 'insolvent' ? 'dead' : 'done') : k === m + 1 && !over && !preStart ? 'now' : '';
        return `<i class="${c}"></i>`;
      }).join('');
      // goal gauge
      const re = game.bal.re, goal = L.goal.profit;
      $('#goalVal').textContent = eur(re);
      $('#goalFill').style.width = clamp(re / goal, 0, 1) * 100 + '%';
      $('#goalFill').style.background = re < 0 ? 'var(--bad)' : '';
      $('#goalNote').textContent = re >= goal ? 'Goal reached. Now keep the firm alive.' : `${eur(goal - re)} to go. Profit so far is Retained earnings.`;
      // cash gauge
      const cash = game.bal.cash;
      const S = Math.max(...game.history.map(r => r.close.cash), 1000) * 1.15;
      const pos = (cash + S / 3) / (S * 4 / 3);
      $('#cashVal').textContent = eur(cash);
      $('#cashFill').style.width = clamp(pos, 0, 1) * 100 + '%';
      $('#cashFill').className = 'g-fill' + (cash < 0 ? ' dead' : cash < S * 0.12 ? ' low' : '');
      // notices and market
      $('#notices').innerHTML = (last.events || []).map(ev => `<div class="notice ${ev.type === 'notice' || ev.type === 'cost' ? 'info' : ''}">${esc(ev.text)}</div>`).join('');
      if (last.m >= 1) {
        const lost = last.lost ? ` · missed <b>${last.lost}</b> (${last.lostReason === 'stock' ? 'shelf empty' : 'no capacity'})` : '';
        $('#market').innerHTML = `${mName(last.m)}: demand <b>${last.demand}</b> · sold <b>${last.sold}</b>${lost}`;
      } else $('#market').innerHTML = preStart ? '' : 'No sales yet. Set your levers and run the first month.';
      $('#loan').value = 0; $('#bench').value = 0;
      renderHints();
      renderPredict();
      const run = $('#runBtn');
      run.textContent = over ? 'Level over' : preStart ? 'Open the books first' : `Run ${mName(m + 1)} ▸`;
      run.disabled = over || preStart || busy;
    }

    function lockUI(on) {
      $('#levers').disabled = on;
      $('#runBtn').disabled = on || game.status !== 'running';
      $$('#predict button').forEach(b => { if (!b.dataset.keep) b.disabled = on; });
    }

    // ---- prediction ----
    function renderPredict() {
      const box = $('#predict');
      const over = game.status !== 'running';
      const score = pred.results.length ? `<p class="score">Your model of the firm: ${pred.results.filter(Boolean).length} of ${pred.results.length} predictions right</p>` : `<p class="score">Predict before you run. It trains your model of the firm.</p>`;
      let res = '';
      if (pred.last) res = `<p class="res">${pred.last}</p>`;
      if (over) { box.innerHTML = res + score; return; }
      const qs = L.questions;
      pred.qid = qs[game.month % qs.length];
      pred.pick = null;
      const Q = QUESTIONS[pred.qid];
      box.innerHTML = `${res}<p class="q">${esc(Q.q)}</p><div class="opts">${Q.opts.map(([k, t]) => `<button type="button" data-pick="${k}" aria-pressed="false">${t}</button>`).join('')}</div>${score}`;
    }
    $('#predict').addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b || busy) return;
      pred.pick = b.dataset.pick;
      $$('#predict [data-pick]').forEach(x => x.setAttribute('aria-pressed', x === b));
      Sound.beep(660, 0.03);
    });
    function resolvePrediction(rec) {
      if (!pred.qid || !pred.pick) { pred.last = null; return; }
      const Q = QUESTIONS[pred.qid];
      const ans = Q.ans(rec);
      const ok = ans === pred.pick;
      pred.results.push(ok);
      const name = k => Q.opts.find(o => o[0] === k)[1];
      let why = gapSentence(rec.open, rec.close, rec.stmt.ni, rec.stmt.net);
      if (pred.qid === 'equityUp') why = `Equity moved by ${sgn(rec.stmt.ni)}: exactly this month's profit, because the owner put nothing in or out.`;
      if (pred.qid === 'invUp') why = `Kits: ${rec.openUnits} at the start, ${rec.closeUnits} at the end (${rec.sold} sold${rec.lost ? ', ' + rec.lost + ' missed' : ''}).`;
      if (pred.qid === 'arUp') why = `Receivables went ${eur(rec.open.ar)} → ${eur(rec.close.ar)}. ` + why;
      pred.last = `<b class="${ok ? 'ok' : 'no'}">${ok ? 'Your model was right.' : 'Your model missed.'}</b> Answer: ${name(ans)}. ${why}`;
      Sound.beep(ok ? 1046 : 196, 0.12, 'triangle', 0.05);
    }

    // ---- the loop strip ----
    function setLoop(...nodes) {
      $$('#loopStrip li').forEach(li => li.classList.toggle('on', nodes.includes(li.dataset.node)));
    }

    // ---- run a month ----
    async function runMonth() {
      if (busy || game.status !== 'running') return;
      busy = true; lockUI(true);
      clearTrace();
      const my = token, stale = () => my !== token;
      const dec = readLevers();
      setLoop('levers');
      await sleep(delay(350));
      const rec = E.step(game, dec);
      if (rec.events.length) {
        setLoop('dist', 'firm');
        $('#notices').innerHTML = rec.events.map(ev => `<div class="notice ${ev.type === 'notice' || ev.type === 'cost' ? 'info' : ''}">${esc(ev.text)}</div>`).join('');
        Sound.beep(150, 0.2, 'sawtooth', 0.04);
        await sleep(delay(900));
      }
      if (stale()) return;
      await playEntries(rec);
      if (stale()) return;
      setLoop('statements');
      period = rec.m;
      renderPeriodSel();
      renderPaper($('#paper'), game, period, { printing: true });
      renderTrend();
      await sleep(delay(600));
      if (stale()) return;
      setLoop('compare');
      resolvePrediction(rec);
      busy = false;
      renderConsole();
      lockUI(false);
      if (game.status !== 'running') { await sleep(delay(700)); if (!stale()) finish(); }
      else setTimeout(() => !busy && !stale() && setLoop('levers'), delay(900));
    }
    $('#runBtn').addEventListener('click', runMonth);

    const SPEED = { watch: 1000, quick: 320, skip: 0 };
    const delay = ms => (settings.speed === 'skip' ? 0 : settings.speed === 'quick' ? ms * 0.35 : ms);
    $('#speedSeg').addEventListener('click', e => {
      const b = e.target.closest('[data-speed]');
      if (!b) return;
      settings.speed = b.dataset.speed; saveSettings(); syncSpeed();
    });
    const syncSpeed = () => $$('#speedSeg [data-speed]').forEach(b => b.setAttribute('aria-checked', b.dataset.speed === settings.speed));
    syncSpeed();

    async function playEntries(rec, isFounding) {
      const my = token;
      const disp = { ...rec.open };
      let profit = 0, cash = 0;
      machine.render(disp);
      renderMeters({ open: rec.open, bal: disp, profit, cash, founding: isFounding });
      for (const e of rec.entries) {
        for (const l of e.legs) disp[l.a] += l.d;
        if (e.is) profit += e.is.amt;
        if (e.cf) cash += e.cf.amt;
        if (SPEED[settings.speed] === 0) continue;
        setLoop(['borrow', 'repay', 'capex', 'owner'].includes(e.kind) ? 'levers' : 'firm', 'ledger');
        machine.render(disp);
        machine.flashLegs(e.legs, disp, Math.min(1100, SPEED[settings.speed] * 1.1));
        renderTicker(e, rec);
        renderMeters({ open: rec.open, bal: disp, profit, cash, founding: isFounding });
        Sound.entry(e);
        await sleep(SPEED[settings.speed]);
        if (my !== token) return;
      }
      machine.render(rec.close);
      machine.clearWires();
      renderMeters({ open: rec.open, bal: rec.close, profit: rec.stmt.ni, cash: rec.stmt.net, founding: isFounding, done: true });
      $('#ticker').innerHTML = `<div class="t-top"><span>${mName(rec.m)} · booked</span><span>${rec.entries.length} entries</span></div>
        <p class="t-text">${rec.entries.length} entries, every one with two legs. The columns never tipped.</p>
        <p class="hint">${rec.m === 0 ? 'Founding entries are financing and investing: they move cash but not profit.' : 'Click any number on the printout to trace which entries made it.'}</p>`;
    }

    function renderTicker(e, rec) {
      const legs = e.legs.map(l => {
        const debit = (E.SIDE[l.a] === 'A') === (l.d > 0);
        return `<span><span class="dc">${debit ? 'Debit' : 'Credit'}</span> ${ACC[l.a].name} ${sgn(l.d)}</span>`;
      }).join('');
      const isChip = e.is ? `<span class="chip is">Income statement: ${ISN[e.is.line]} ${sgn(e.is.amt)}</span>` : `<span class="chip none">Income statement: not affected</span>`;
      const cfChip = e.cf ? `<span class="chip cf">Cash flow: ${SECN[e.cf.sec]} · ${CFN[e.cf.line]} ${sgn(e.cf.amt)}</span>` : `<span class="chip none">Cash flow: no cash moved</span>`;
      $('#ticker').innerHTML = `<div class="t-top"><span>${mName(rec.m)} · entry ${rec.entries.indexOf(e) + 1} of ${rec.entries.length}</span><span>#${e.id}</span></div>
        <p class="t-text">${esc(e.text)}</p><div class="t-legs">${legs}</div><div class="t-chips">${isChip}${cfChip}</div>`;
    }

    function renderMeters(s) {
      const box = $('#meters');
      if (!s) { box.innerHTML = `<p class="hint">Two meters will appear here: profit flowing into Retained earnings, and cash flowing into the Cash tank. Watch them part ways.</p>`; return; }
      const M = Math.max(Math.abs(s.profit), Math.abs(s.cash), 500);
      const bar = v => { const w = (Math.abs(v) / M) * 50; return `left:${v >= 0 ? 50 : 50 - w}%;width:${w}%`; };
      box.innerHTML = `
        <div class="meter profit"><div class="m-label">Profit ${s.done ? '' : 'so far '}this month<small>flows into Retained earnings</small></div><div class="m-track"><div class="m-bar" style="${bar(s.profit)}"></div></div><div class="m-val ${s.profit < 0 ? 'neg' : ''}">${sgn(s.profit)}</div></div>
        <div class="meter cashm"><div class="m-label">Change in cash<small>flows into the Cash tank</small></div><div class="m-track"><div class="m-bar" style="${bar(s.cash)}"></div></div><div class="m-val ${s.cash < 0 ? 'neg' : ''}">${sgn(s.cash)}</div></div>
        <p class="gapline">${gapSentence(s.open, s.bal, s.profit, s.cash)}</p>`;
    }

    function renderTrend() {
      const H = game.history, n = game.sc.months;
      const dead = game.status === 'insolvent' ? game.month : null;
      lineChart($('#trend'), {
        n, danger: true, dead, fmtY: kfmt,
        series: [
          { cls: 'cash', values: H.map(r => r.close.cash), dot: true },
          { cls: 're', values: H.map(r => r.close.re), dot: true },
        ],
        events: game.sc.events.filter(ev => ev.type !== 'notice').map(ev => ev.month),
      });
    }

    function renderPeriodSel() {
      const sel = $('#periodSel');
      sel.innerHTML = game.history.map(r => `<option value="${r.m}">${r.m === 0 ? 'Founding' : mName(r.m) + ' (month ' + r.m + ')'}</option>`).join('') + `<option value="all">All months, since founding</option>`;
      sel.value = String(period);
    }
    $('#periodSel').addEventListener('change', e => {
      period = e.target.value === 'all' ? 'all' : +e.target.value;
      clearTrace();
      renderPaper($('#paper'), game, period, { journalOpen: period !== 'all' });
    });

    // ---- trace ----
    function clearTrace() {
      trace = null; $('#trace').hidden = true;
      applyTrace($('#paper'), machine, null);
    }
    function doTrace(key) {
      const { sp, st } = { sp: periodSpan(game, period), st: E.statements(periodSpan(game, period)) };
      const t = traceInfo(key, sp, st);
      if (!t) return;
      trace = t;
      $('#trace').hidden = false;
      $('#trace').innerHTML = traceText(t) + `<button type="button" id="traceClose">Clear trace</button>`;
      $('#traceClose').addEventListener('click', clearTrace);
      applyTrace($('#paper'), machine, t);
      Sound.beep(1200, 0.02);
    }
    $('#paper').addEventListener('click', e => {
      const b = e.target.closest('[data-trace]');
      if (b && !busy) doTrace(b.dataset.trace);
    });
    $('#paper').addEventListener('keydown', e => {
      const b = e.target.closest('g[data-trace]');
      if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); doTrace(b.dataset.trace); }
    });

    // ---- end of level ----
    function finish() {
      const re = game.bal.re, alive = game.status === 'finished', goal = re >= L.goal.profit;
      const right = pred.results.filter(Boolean).length, asked = pred.results.length;
      const sharp = asked >= Math.ceil(L.months / 2) && right / asked >= 0.7;
      const stars = alive ? 1 + (goal ? 1 : 0) + (goal && sharp ? 1 : 0) : 0;
      const p = progress[L.id] || {};
      progress[L.id] = { stars: Math.max(p.stars || 0, stars), best: Math.max(p.best ?? -Infinity, alive ? re : -Infinity) };
      store.set('lh.progress', progress);
      alive && goal ? Sound.win() : !alive ? Sound.lose() : Sound.beep(440, 0.2, 'triangle');
      const sp = E.span(game.history, 0, game.month), st = E.statements(sp);
      const verdict = !alive
        ? `Insolvent in ${mName(game.month)}. Cash ended at ${eur(game.bal.cash)}${re > 0 ? `, while the income statement showed ${eur(re)} of profit so far` : ''}.`
        : goal ? `Survived all ${L.months} months and hit the profit goal.` : `Survived, but profit ended at ${eur(re)}, short of ${eur(L.goal.profit)}.`;
      const why = [];
      if (alive && goal && !sharp) why.push(`Third star: answer at least half the predictions and get 70% right (you had ${right} of ${asked}).`);
      const paper = document.createElement('div');
      paper.className = 'paper compact';
      paper.innerHTML = `<section class="stmt bridge"><div class="stmt-title"><span>From profit to cash</span><span>since founding</span></div>${bridgeSVG(st)}</section>`;
      modal(`
        <p class="eyebrow">Level ${li + 1} · ${esc(L.title)}</p>
        <h2 id="modalTitle">${alive ? 'Books closed' : 'The firm died'}</h2>
        <div class="big-stars" aria-label="${stars} of 3 stars">${[1, 2, 3].map(k => starSVG(stars >= k)).join('')}</div>
        <p class="verdict-line ${alive ? '' : 'dead'}">${verdict}</p>
        <div class="stats">
          <div><span>Profit since founding</span><b>${eur(re)}</b></div>
          <div><span>Cash now</span><b class="${game.bal.cash < 0 ? 'neg' : ''}">${eur(game.bal.cash)}</b></div>
          <div><span>Customers owe you</span><b>${eur(game.bal.ar)}</b></div>
          <div><span>Predictions right</span><b>${right}/${asked}</b></div>
        </div>
        ${why.map(w => `<p class="hint">${esc(w)}</p>`).join('')}
        <h3>Where the profit went</h3>
        <div id="debriefBridge"></div>
        <h3>What to take away</h3>
        ${L.debrief.filter(d => typeof d === 'string' || (d.when === 'ar' && game.history.some(r => r.close.ar > 0))).map(d => `<p>${esc(d.text ?? d)}</p>`).join('')}
        <div class="modal-actions">
          ${li + 1 < LEVELS.length ? `<button type="button" class="primary" data-act="next">Next: ${esc(LEVELS[li + 1].title)}</button>` : `<button type="button" class="primary" data-act="lab">Go to the Governor Lab</button>`}
          <button type="button" data-act="retry">Try again</button>
          <button type="button" data-act="look">Look at the books</button>
          <button type="button" data-act="map">Levels</button>
        </div>`, {
        next: () => { closeModal(); start(li + 1); },
        lab: () => { closeModal(); show('lab'); },
        retry: () => { closeModal(); start(li); },
        look: () => { closeModal(); period = 'all'; renderPeriodSel(); renderPaper($('#paper'), game, 'all', { journalOpen: false }); },
        map: () => { closeModal(); show('map'); },
      });
      $('#debriefBridge').appendChild(paper);
    }

    window.addEventListener('resize', debounce(() => {
      if ($('#play').hidden || !game) return;
      machine.render(game.bal); renderTrend();
    }, 150));

    return { start, setLoop };
  })();

  // =========================================================================
  // Governor Lab
  // =========================================================================
  const Lab = (() => {
    let inited = false, machine = null, run = null, seed = 3;
    const P = { scenario: 'steady', lead: 2, preset: 'thermostat', params: { ...LAB_PRESETS[0].params } };

    function init() {
      inited = true;
      machine = createMachine($('#labMachine'), { compact: true });
      $('#presets').innerHTML = LAB_PRESETS.map(p => `<button type="button" data-preset="${p.id}" aria-pressed="false">${esc(p.title)}</button>`).join('');
      $('#labScenario').innerHTML = Object.entries(LAB_SCENARIOS).map(([k, v]) => `<option value="${k}">${esc(v.title)}</option>`).join('');
      $('#labWatch').innerHTML = Object.entries(E.GAUGES).map(([k, g]) => `<option value="${k}">${esc(g.name)}</option>`).join('');
      $('#presets').addEventListener('click', e => { const b = e.target.closest('[data-preset]'); if (b) applyPreset(b.dataset.preset); });
      const bind = (id, fn) => ['input', 'change'].forEach(ev => $(id).addEventListener(ev, () => { fn(); P.preset = null; update(); }));
      bind('#labScenario', () => { P.scenario = $('#labScenario').value; P.lead = LAB_SCENARIOS[P.scenario].leadTime; });
      bind('#labLead', () => { P.lead = +$('#labLead').value; });
      bind('#labAlpha', () => { P.params.alpha = +$('#labAlpha').value; });
      bind('#labCover', () => { P.params.cover = +$('#labCover').value; });
      bind('#labGain', () => { P.params.gain = +$('#labGain').value; });
      bind('#labPipe', () => { P.params.pipeline = $('#labPipe').checked; });
      bind('#labWatch', () => { P.params.watch = $('#labWatch').value; });
      bind('#labFloor', () => { P.params.floor = +$('#labFloor').value; });
      bind('#labBench', () => { P.params.autoBench = $('#labBench').checked; });
      $('#labReroll').addEventListener('click', () => { seed = (Math.random() * 1e6) | 0; update(); });
      $('#labMonth').addEventListener('input', () => renderBooks(+$('#labMonth').value));
      window.addEventListener('resize', debounce(() => { if (!$('#lab').hidden && run) update(true); }, 150));
      applyPreset('thermostat');
    }

    function applyPreset(id) {
      const p = LAB_PRESETS.find(x => x.id === id);
      P.preset = id; P.scenario = p.scenario; P.lead = LAB_SCENARIOS[p.scenario].leadTime; P.params = { ...p.params };
      update();
    }

    function syncControls() {
      $('#labScenario').value = P.scenario;
      $('#labLead').value = P.lead; $('#labLeadOut').textContent = P.lead === 0 ? 'same month' : `${P.lead} month${P.lead > 1 ? 's' : ''}`;
      $('#labAlpha').value = P.params.alpha; $('#labAlphaOut').textContent = P.params.alpha.toFixed(2);
      $('#labCover').value = P.params.cover; $('#labCoverOut').textContent = `${P.params.cover} mo`;
      $('#labGain').value = P.params.gain; $('#labGainOut').textContent = P.params.gain.toFixed(2);
      $('#labPipe').checked = P.params.pipeline;
      $('#labWatch').value = P.params.watch;
      $('#labFloor').value = P.params.floor; $('#labFloorOut').textContent = eur(P.params.floor);
      $('#labBench').checked = P.params.autoBench;
      $('#labBench').closest('.lever').hidden = !LAB_SCENARIOS[P.scenario].capacityPerBench;
      $$('#presets [data-preset]').forEach(b => b.setAttribute('aria-pressed', b.dataset.preset === P.preset));
      const pr = LAB_PRESETS.find(x => x.id === P.preset);
      $('#presetNote').textContent = pr ? pr.note : 'Your own rule. Compare it with the presets.';
    }

    const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };

    function update(keepMonth) {
      syncControls();
      const sc = E.merge(LAB_SCENARIOS[P.scenario], { leadTime: P.lead });
      run = E.runGovernor(sc, P.params, seed);
      const g = run.game, H = g.history, n = sc.months;
      const dead = g.status === 'insolvent' ? g.month : null;
      const events = sc.events.map(ev => ev.month);
      const demand = H.map((r, i) => (i === 0 ? null : r.demand));
      const orders = [null, ...run.decisions.map(d => d.order)];
      lineChart($('#chOrders'), { n, fmtY: v => String(v), events, series: [{ cls: 'demand', values: demand }, { cls: 'order', values: orders }] });
      lineChart($('#chInv'), { n, fmtY: v => String(v), events, area: { cls: 'inv', values: H.map(r => r.closeUnits) }, series: [{ cls: 'inv', values: H.map(r => r.closeUnits) }] });
      lineChart($('#chCash'), { n, fmtY: kfmt, events, danger: true, dead, series: [{ cls: 'cash', values: H.map(r => r.close.cash) }, { cls: 're', values: H.map(r => r.close.re) }, { cls: 'loan', values: H.map(r => r.close.loan) }] });

      const from = 4;
      const ratio = sd(orders.slice(from).filter(v => v != null)) / Math.max(1e-9, sd(demand.slice(from).filter(v => v != null)));
      const minCash = Math.min(...H.map(r => r.close.cash));
      const re = g.bal.re;
      let story;
      if (dead && re > 0) story = `It died in month ${dead} with ${eur(re)} of profit on the books. The gauge it watched never showed the cash being drained into receivables and stock.`;
      else if (dead) story = `It died in month ${dead}. Cash went below zero and the floor was not enough to absorb the shocks.`;
      else if (ratio > 2) story = `It survived, but orders swung ${ratio.toFixed(1)} times as much as demand. That is the bullwhip: a delay plus a rule that forgets what is already on the way.`;
      else story = `It survived all ${n} months. Orders swung ${ratio.toFixed(1)} times as much as demand and cash never dropped below ${eur(minCash)}.`;
      $('#verdict').innerHTML = `
        <div class="vchip ${dead ? 'dead' : 'ok'}"><span>${dead ? 'Outcome, month ' + dead : 'Outcome after ' + n + ' months'}</span><b>${dead ? 'Insolvent' : 'Alive'}</b></div>
        <div class="vchip"><span>Profit so far</span><b>${kfmt(re)}</b></div>
        <div class="vchip"><span>Lowest cash</span><b class="${minCash < 0 ? 'neg' : ''}">${kfmt(minCash)}</b></div>
        <div class="vchip"><span>Order swing ÷ demand swing</span><b>×${ratio.toFixed(1)}</b></div>
        <div class="vchip story">${esc(story)}</div>`;

      const slider = $('#labMonth');
      slider.max = g.month;
      if (!keepMonth) slider.value = dead ?? Math.min(g.month, 12);
      slider.value = Math.min(+slider.value, g.month);
      machine.reset(Math.max(...H.map(r => r.stmt.assets + Math.max(0, -r.close.re, -r.close.cash))) * 1.1);
      renderBooks(+slider.value);
    }

    function renderBooks(m) {
      const g = run.game;
      $('#labMonthOut').textContent = `${mName(m)} (month ${m})`;
      machine.render(g.history[m].close);
      renderPaper($('#labPaper'), g, m, { compact: true });
      const H = g.history, n = g.sc.months;
      lineChart($('#chCash'), { n, fmtY: kfmt, events: g.sc.events.map(ev => ev.month), danger: true, dead: g.status === 'insolvent' ? g.month : null, cursor: m, series: [{ cls: 'cash', values: H.map(r => r.close.cash) }, { cls: 're', values: H.map(r => r.close.re) }, { cls: 'loan', values: H.map(r => r.close.loan) }] });
    }

    return { enter() { if (!inited) init(); else update(true); } };
  })();

  // =========================================================================
  // Field guide
  // =========================================================================
  const GUIDE = [
    {
      t: 'Stocks and flows',
      cy: 'A system has state variables (stocks) and rates that change them (flows). Forrester\'s system dynamics draws them as tanks and pipes.',
      ac: 'The balance sheet lists the stocks at one moment. The income statement and cash flow statement describe flows over a period.',
      p: ['The income statement watches one tank: Retained earnings. Its bottom line, profit, is exactly how much that tank rose. The cash flow statement watches another tank: Cash. Its bottom line is exactly how much that tank rose. Neither is a separate fact; both are views of the ledger.'],
      cite: 'Jay W. Forrester, Industrial Dynamics (1961).',
    },
    {
      t: 'Double-entry is a conservation law',
      cy: 'Conserved quantities make systems legible: whatever leaves one place must arrive in another, like Kirchhoff\'s current law.',
      ac: 'Every entry has two legs of equal size, so Assets = Liabilities + Equity holds after every single entry.',
      p: ['Try it below. A proper entry moves both columns (or swaps inside one column). A one-legged entry tips the beam, and that is exactly the error double-entry was invented to catch. Merchants in 14th-century Italy used it as an error detector long before anyone called it a conservation law.'],
      demo: true,
      cite: 'Luca Pacioli, Summa de arithmetica (1494), the first printed description.',
    },
    {
      t: 'Accruals are buffers and delays',
      cy: 'A delay between cause and effect, or a buffer that stores material, separates the signal you observe from the state you care about.',
      ac: 'Receivables (sold, not paid), inventory (paid, not sold), payables (received, not paid) and equipment (paid now, expensed over years).',
      p: ['Each of these tanks holds the difference between "earned" and "paid". The bridge from profit to cash in every printout is just the list of how much each buffer soaked up or released. Profit minus the change in cash always equals the change in those other tanks, because of the conservation law above.'],
    },
    {
      t: 'Essential variables',
      cy: 'Ashby: an organism survives as long as its essential variables stay within limits. Body temperature, blood sugar.',
      ac: 'For a firm, cash is the essential variable. Profit can be negative for years; cash cannot be negative for a week.',
      p: ['That is why the game ends on cash, not on profit. A firm dies when it cannot pay, which is a cash event, not an accounting one. The Growth Trap level and the profit-watching autopilot both show a firm dying with large reported profits.'],
      cite: 'W. Ross Ashby, Design for a Brain (1952).',
    },
    {
      t: 'Delays make regulators oscillate',
      cy: 'A controller that corrects hard on a delayed signal overshoots, then corrects the overshoot, and swings.',
      ac: 'Ordering kits with a lead time, and forgetting what is already on the way, makes orders swing harder than demand. Supply chains call it the bullwhip effect.',
      p: ['In the Governor Lab, switch off "count kits already on the way" and raise the correction strength. The orders line starts to swing far more than demand ever did, and the cash line swings with it. MIT\'s Beer Game teaches the same lesson with paper and dice.'],
      cite: 'John Sterman, "Modeling Managerial Behavior" (1989).',
    },
    {
      t: 'Requisite variety',
      cy: 'Ashby\'s law: only variety can absorb variety. A regulator needs at least as many distinct responses as the disturbances it must cancel.',
      ac: 'Late payers, a supplier demanding cash, an interest hike, a bad debt: each needs a lever. A credit line is a lever with a lot of variety, which is why firms arrange one before they need it.',
      p: ['In the Growth Trap there are more surprises than levers. You can still survive, but only by keeping a buffer: spare cash, or unused room on the loan.'],
      cite: 'W. Ross Ashby, An Introduction to Cybernetics (1956), ch. 11.',
    },
    {
      t: 'The good regulator',
      cy: 'Conant and Ashby: every good regulator of a system must be a model of that system.',
      ac: 'A manager who models the firm as "profit" alone cannot regulate cash. The three statements together are the minimum model.',
      p: ['Your prediction score in each level is a measure of how good your internal model is. Every miss is an error signal, and the explanation that follows it is the correction.'],
      cite: 'Conant & Ashby, "Every good regulator of a system must be a model of that system" (1970).',
    },
    {
      t: 'The cybernetic firm, for real',
      cy: 'Stafford Beer applied cybernetics to management with the Viable System Model, and in Chile (1971–73) built Cybersyn, a national feedback network for factories.',
      ac: 'Cybersyn\'s inputs were daily production and finance indicators: a ledger as a nervous system.',
      p: ['This game is a toy version of that idea: one firm, one regulator, a ledger as the sensor and three statements as the display.'],
      cite: 'Stafford Beer, Brain of the Firm (1972); Eden Medina, Cybernetic Revolutionaries (2011).',
    },
  ];

  function openGuide() {
    const body = $('#guideBody');
    if (!body.dataset.done) {
      body.dataset.done = '1';
      body.innerHTML = GUIDE.map((g, i) => `<section class="g-sec">
        <h3>${esc(g.t)}</h3>
        <div class="pair"><div><b>Cybernetics</b>${esc(g.cy)}</div><div><b>Accounting</b>${esc(g.ac)}</div></div>
        ${g.p.map(p => `<p>${esc(p)}</p>`).join('')}
        ${g.demo ? `<div class="demo"><div class="modal-actions"><button type="button" data-demo="sale">Book a cash sale (two legs)</button><button type="button" data-demo="one">Book only one leg</button><button type="button" data-demo="reset">Reset</button></div><p class="hint" id="demoNote">Start: the owner put €3,000 in.</p><div class="machine compact" id="demoMachine"></div></div>` : ''}
        ${g.cite ? `<p class="cite">${esc(g.cite)}</p>` : ''}</section>`).join('');
      const dm = createMachine($('#demoMachine'), { compact: true });
      const base = () => ({ cash: 3000, ar: 0, inv: 0, equip: 0, ap: 0, loan: 0, capital: 3000, re: 0 });
      let bal = base();
      const draw = () => { dm.reset(8000); dm.render(bal); };
      body.addEventListener('click', e => {
        const b = e.target.closest('[data-demo]');
        if (!b) return;
        const k = b.dataset.demo;
        if (k === 'reset') { bal = base(); $('#demoNote').textContent = 'Start: the owner put €3,000 in.'; }
        if (k === 'sale') { bal.cash += 700; bal.re += 700; $('#demoNote').textContent = 'Debit Cash +€700, credit Retained earnings (revenue) +€700. Both columns grow. Balanced.'; Sound.beep(880, 0.05); }
        if (k === 'one') { bal.cash += 700; $('#demoNote').textContent = 'Cash +€700 with no second leg. Where did it come from? The books cannot say, and the beam tips.'; Sound.beep(120, 0.3, 'sawtooth'); }
        draw();
        if (k !== 'reset') dm.flashLegs(k === 'sale' ? [{ a: 'cash', d: 700 }, { a: 're', d: 700 }] : [{ a: 'cash', d: 700 }], bal);
      });
      requestAnimationFrame(draw);
    }
    $('#guide').hidden = false; $('#scrim').hidden = false;
    $('#guideClose').focus();
  }
  const closeGuide = () => { $('#guide').hidden = true; $('#scrim').hidden = true; };
  $('#guideClose').addEventListener('click', closeGuide);
  $('#scrim').addEventListener('click', closeGuide);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#guide').hidden) closeGuide(); });

  // ---- modal ----
  function modal(html, actions) {
    $('#modalCard').innerHTML = html;
    $('#modal').hidden = false;
    $('#modalCard').onclick = e => {
      const b = e.target.closest('[data-act]');
      if (b && actions[b.dataset.act]) actions[b.dataset.act]();
    };
    const first = $('#modalCard .primary'); first && first.focus();
  }
  const closeModal = () => { $('#modal').hidden = true; };

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  // ---- boot ----
  drawHeroLoop();
  show('map');
})();
