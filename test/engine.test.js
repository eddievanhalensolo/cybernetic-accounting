// The four invariants that make the lesson true. If any fails once, the game lies.
const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine.js');
const { LEVELS, LAB_SCENARIOS, LAB_PRESETS } = require('../levels.js');

function checkMonth(rec) {
  const st = rec.stmt;
  // 1. Assets = Liabilities + Equity, at every month end
  assert.strictEqual(st.assets, st.liabilities + st.equity, `A = L + E in month ${rec.m}`);
  // 2. Net income = change in retained earnings
  assert.strictEqual(st.ni, rec.close.re - rec.open.re, `NI = ΔRE in month ${rec.m}`);
  // 3. Cash flow statement net change = change in cash
  assert.strictEqual(st.net, rec.close.cash - rec.open.cash, `CF = Δcash in month ${rec.m}`);
  // 4. Indirect method = direct method for operating cash flow
  assert.strictEqual(st.bridge.cfo, st.cfo, `indirect CFO = direct CFO in month ${rec.m}`);
  for (const e of rec.entries) {
    let l = 0, r = 0;
    for (const g of e.legs) (E.SIDE[g.a] === 'A' ? (l += g.d) : (r += g.d));
    assert.strictEqual(l, r, `entry ${e.id} balances`);
  }
}

function randomPlayer(s, rnd) {
  const sc = s.sc;
  return {
    price: 40 + Math.floor(rnd() * 70),
    terms: sc.terms.allowed[Math.floor(rnd() * sc.terms.allowed.length)],
    order: Math.floor(rnd() * 250),
    buyBenches: rnd() < 0.15 ? 1 : 0,
    borrow: Math.round((rnd() - 0.4) * 15000),
  };
}

function lcg(seed) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test('invariants hold for random play on every level', () => {
  for (const lvl of LEVELS) {
    for (let seed = 1; seed <= 200; seed++) {
      const s = E.newGame(lvl, seed);
      const rnd = lcg(seed * 31 + 7);
      checkMonth(s.history[0]);
      // keep stepping past insolvency by ignoring status, to stress the books
      for (let i = 0; i < lvl.months; i++) {
        s.status = 'running';
        checkMonth(E.step(s, randomPlayer(s, rnd)));
      }
      const all = E.statements(E.span(s.history, 0, s.month));
      assert.strictEqual(all.net, s.bal.cash);
      assert.strictEqual(all.bridge.cfo, all.cfo);
    }
  }
});

test('invariants hold for every governor preset and seeds', () => {
  for (const p of LAB_PRESETS) {
    for (let seed = 1; seed <= 50; seed++) {
      const { game } = E.runGovernor(LAB_SCENARIOS[p.scenario], p.params, seed);
      game.history.forEach(checkMonth);
    }
  }
});

test('cash-only level: profit equals the change in cash', () => {
  const s = E.newGame(LEVELS[0], 1);
  for (let i = 0; i < 4; i++) {
    const r = E.step(s, { price: 80 });
    assert.strictEqual(r.stmt.ni, r.stmt.net);
  }
});

test('credit level: 60-day terms at €70 go insolvent while profitable', () => {
  const s = E.newGame(LEVELS[1], 1);
  let profit = 0;
  while (s.status === 'running') profit += E.step(s, { price: 70, terms: 2 }).stmt.ni;
  assert.strictEqual(s.status, 'insolvent');
  assert.ok(profit > 0);
});

test('credit level: 30-day terms at €80 survive and meet the goal', () => {
  const s = E.newGame(LEVELS[1], 1);
  let profit = 0;
  while (s.status === 'running') profit += E.step(s, { price: 80, terms: 1 }).stmt.ni;
  assert.strictEqual(s.status, 'finished');
  assert.ok(profit >= LEVELS[1].goal.profit, `profit ${profit}`);
});

test('governor lab: profit-watcher dies, cash-watcher survives, bullwhip amplifies', () => {
  const by = id => LAB_PRESETS.find(p => p.id === id);
  const run = id => E.runGovernor(LAB_SCENARIOS[by(id).scenario], by(id).params, 3);
  for (let seed = 1; seed <= 20; seed++) {
    const go = id => E.runGovernor(LAB_SCENARIOS[by(id).scenario], by(id).params, seed).game;
    const pb = go('profitblind');
    assert.strictEqual(pb.status, 'insolvent', `profit-watcher seed ${seed}`);
    assert.ok(pb.bal.re > 0, 'dies while profitable');
    assert.strictEqual(go('cashsighted').status, 'finished', `cash-watcher seed ${seed}`);
  }
  // the two pilots differ only in the gauge
  const { watch: a, ...pa } = by('profitblind').params, { watch: b, ...pc } = by('cashsighted').params;
  assert.deepStrictEqual(pa, pc);
  const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
  const ratio = id => {
    const { game, decisions } = run(id);
    const orders = decisions.slice(6).map(d => d.order);
    const demand = game.history.slice(7).map(r => r.demand);
    return sd(orders) / sd(demand);
  };
  assert.ok(ratio('bullwhip') > 2 * ratio('thermostat'), `bullwhip ${ratio('bullwhip')} vs ${ratio('thermostat')}`);
});
