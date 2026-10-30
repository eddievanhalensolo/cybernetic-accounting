// Ledger Homeostat: simulation engine.
// The ledger is the only source of truth. Every event is a balanced journal
// entry; all three statements are derived from the entries, never computed
// on their own. Works in the browser (window.Engine) and in Node (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ACCOUNTS = [
    { id: 'cash', name: 'Cash', side: 'A', plain: 'Money in the bank right now.' },
    { id: 'ar', name: 'Receivables', side: 'A', plain: 'Sales already made that customers have not paid for yet.' },
    { id: 'inv', name: 'Inventory', side: 'A', plain: 'Kits on the shelf: paid for (or owed), not yet sold. Valued at what they cost.' },
    { id: 'equip', name: 'Workbenches', side: 'A', plain: 'Equipment, at purchase price minus the wear booked so far (depreciation).' },
    { id: 'ap', name: 'Payables', side: 'L', plain: 'Kits the supplier delivered that you have not paid for yet.' },
    { id: 'loan', name: 'Bank loan', side: 'L', plain: 'Money borrowed from the bank. It brings cash in, but it is not income.' },
    { id: 'capital', name: "Owner's capital", side: 'E', plain: 'What the owner put in at the start.' },
    { id: 're', name: 'Retained earnings', side: 'E', plain: 'All profits so far minus all losses. The income statement explains how it changed.' },
  ];
  const SIDE = Object.fromEntries(ACCOUNTS.map(a => [a.id, a.side]));

  const IS_LINES = [
    { id: 'revenue', name: 'Sales revenue' },
    { id: 'cogs', name: 'Cost of kits sold' },
    { id: 'overhead', name: 'Rent & wages' },
    { id: 'dep', name: 'Depreciation' },
    { id: 'baddebt', name: 'Bad debts' },
    { id: 'interest', name: 'Interest' },
  ];
  const CF_LINES = [
    { id: 'collect', sec: 'O', name: 'Cash from customers' },
    { id: 'suppliers', sec: 'O', name: 'Paid suppliers' },
    { id: 'overhead', sec: 'O', name: 'Paid rent & wages' },
    { id: 'interest', sec: 'O', name: 'Paid interest' },
    { id: 'capex', sec: 'I', name: 'Bought workbenches' },
    { id: 'owner', sec: 'F', name: 'Owner invested' },
    { id: 'borrow', sec: 'F', name: 'Borrowed from bank' },
    { id: 'repay', sec: 'F', name: 'Repaid bank loan' },
  ];
  const CF_SEC = Object.fromEntries(CF_LINES.map(l => [l.id, l.sec]));

  const DEFAULTS = {
    months: 12,
    seed: 7,
    start: { cash: 10000, invUnits: 0, benches: 0, loan: 0 },
    unitCost: 40,
    refPrice: 70,
    elasticity: 2,
    demand: { base: 80, growth: 0, noise: 0, season: {} },
    termsBoost: [1, 1.25, 1.45],
    terms: { allowed: [0], locked: null },
    overhead: 1500,
    madeToOrder: false,
    leadTime: 1,
    supplierCredit: 1,
    capacityPerBench: null, // null = no capacity limit
    bench: { cost: 6000, life: 24 },
    loan: null, // { rate, limit }
    events: [],
    defaults: { price: 70, terms: 0, order: 80, buyBenches: 0, borrow: 0 },
  };

  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function merge(base, over) {
    const out = { ...base };
    for (const k of Object.keys(over || {})) {
      out[k] = isObj(base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k];
    }
    return out;
  }
  const clone = v => JSON.parse(JSON.stringify(v));

  // mulberry32, state kept on the game so a game is a plain serialisable object
  function rand(s) {
    s.rng = (s.rng + 0x6D2B79F5) | 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function gauss(s) {
    const u = 1 - rand(s), v = rand(s);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ---- posting -----------------------------------------------------------

  function post(s, kind, text, legs, isLine, cfLine) {
    const L = legs.map(([a, d]) => ({ a, d: Math.round(d) })).filter(l => l.d !== 0);
    if (!L.length) return null;
    let left = 0, right = 0;
    for (const l of L) (SIDE[l.a] === 'A' ? (left += l.d) : (right += l.d));
    if (left !== right) throw new Error(`Unbalanced entry "${text}": ${left} vs ${right}`);
    for (const l of L) s.bal[l.a] += l.d;
    const e = { id: ++s.seq, m: s.month, kind, text, legs: L, is: null, cf: null };
    const re = L.find(l => l.a === 're');
    if (re) {
      if (!isLine) throw new Error(`Entry "${text}" touches retained earnings without an income line`);
      e.is = { line: isLine, amt: re.d };
    }
    const c = L.find(l => l.a === 'cash');
    if (c) {
      if (!cfLine) throw new Error(`Entry "${text}" touches cash without a cash-flow line`);
      e.cf = { line: cfLine, sec: CF_SEC[cfLine], amt: c.d };
    }
    s.cur.entries.push(e);
    return e;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = m => (m <= 0 ? 'founding' : `${MONTHS[(m - 1) % 12]}${m > 12 ? ' Y' + (Math.floor((m - 1) / 12) + 1) : ''}`);
  const eur = n => '€' + Math.round(n).toLocaleString('en-US');

  // ---- statements ----------------------------------------------------------

  // Statements for any span: the entries in it plus opening and closing balances.
  function statements({ entries, open, close }) {
    const is = Object.fromEntries(IS_LINES.map(l => [l.id, 0]));
    const cf = Object.fromEntries(CF_LINES.map(l => [l.id, 0]));
    for (const e of entries) {
      if (e.is) is[e.is.line] += e.is.amt;
      if (e.cf) cf[e.cf.line] += e.cf.amt;
    }
    const ni = Object.values(is).reduce((a, b) => a + b, 0);
    const sec = k => CF_LINES.filter(l => l.sec === k).reduce((a, l) => a + cf[l.id], 0);
    const cfo = sec('O'), cfi = sec('I'), cff = sec('F');
    const d = k => close[k] - open[k];
    const bridge = { ni, dep: -is.dep, dAR: -d('ar'), dInv: -d('inv'), dAP: d('ap') };
    bridge.cfo = bridge.ni + bridge.dep + bridge.dAR + bridge.dInv + bridge.dAP;
    const tot = (b, side) => ACCOUNTS.filter(a => a.side === side).reduce((x, a) => x + b[a.id], 0);
    return {
      is, ni, cf, cfo, cfi, cff, net: cfo + cfi + cff, bridge,
      assets: tot(close, 'A'), liabilities: tot(close, 'L'), equity: tot(close, 'E'),
      open, close,
    };
  }

  function span(history, from, to) {
    const recs = history.filter(r => r.m >= from && r.m <= to);
    if (!recs.length) return null;
    return {
      entries: recs.flatMap(r => r.entries),
      open: recs[0].open,
      close: recs[recs.length - 1].close,
    };
  }

  // ---- game ------------------------------------------------------------------

  function newGame(level, seed) {
    const sc = merge(DEFAULTS, level);
    const s = {
      sc, month: 0, status: 'running', rng: (seed ?? sc.seed) | 0, seq: 0,
      bal: { cash: 0, ar: 0, inv: 0, equip: 0, ap: 0, loan: 0, capital: 0, re: 0 },
      invUnits: 0, arCohorts: [], apCohorts: [], pipeline: [], benches: [],
      unitCost: sc.unitCost, cod: false, rate: sc.loan ? sc.loan.rate : 0,
      lastDemand: null, history: [], cur: null,
    };
    const st = sc.start;
    const rec = { m: 0, open: { ...s.bal }, openUnits: 0, entries: [], events: [], decisions: null };
    s.cur = rec;
    const benchCost = st.benches * sc.bench.cost;
    const stockCost = st.invUnits * sc.unitCost;
    const capital = st.cash + benchCost + stockCost - (st.loan || 0);
    post(s, 'owner', `The owner puts ${eur(capital)} into the business`, [['cash', capital], ['capital', capital]], null, 'owner');
    if (st.loan) post(s, 'borrow', `The bank lends ${eur(st.loan)}`, [['cash', st.loan], ['loan', st.loan]], null, 'borrow');
    for (let i = 0; i < st.benches; i++) {
      post(s, 'capex', `Buys a workbench for ${eur(sc.bench.cost)}`, [['equip', sc.bench.cost], ['cash', -sc.bench.cost]], null, 'capex');
      s.benches.push({ cost: sc.bench.cost, book: sc.bench.cost, left: sc.bench.life });
    }
    if (st.invUnits) {
      post(s, 'delivery', `Buys ${st.invUnits} kits for the opening shelf, paid in cash`, [['inv', stockCost], ['cash', -stockCost]], null, 'suppliers');
      s.invUnits = st.invUnits;
    }
    closeMonth(s, rec);
    return s;
  }

  function demandFor(s, price, terms, m) {
    const sc = s.sc, dm = sc.demand;
    let base = dm.base * Math.pow(1 + dm.growth, m - 1) * (dm.season[m] ?? 1);
    for (const ev of sc.events) {
      if (ev.type === 'demand' && m >= ev.month && m <= (ev.until ?? Infinity)) base *= ev.mult;
    }
    let q = base * Math.pow(price / sc.refPrice, -sc.elasticity) * sc.termsBoost[terms];
    if (dm.noise) q *= Math.max(0, 1 + dm.noise * gauss(s));
    return Math.max(0, Math.round(q));
  }

  const capacityOf = s => (s.sc.capacityPerBench ? s.benches.length * s.sc.capacityPerBench : Infinity);
  const onOrder = s => s.pipeline.reduce((a, p) => a + p.units, 0);

  function receive(s, units, paidNow) {
    const cost = units * s.unitCost;
    s.invUnits += units;
    if (paidNow) {
      post(s, 'delivery', `${units} kits arrive, paid in cash on delivery`, [['inv', cost], ['cash', -cost]], null, 'suppliers');
    } else {
      post(s, 'delivery', `${units} kits arrive; the supplier's invoice is due in ${s.sc.supplierCredit} month${s.sc.supplierCredit > 1 ? 's' : ''}`,
        [['inv', cost], ['ap', cost]]);
      s.apCohorts.push({ due: s.month + s.sc.supplierCredit, amt: cost, from: s.month });
    }
  }

  function step(s, dec) {
    if (s.status !== 'running') throw new Error('Game is over');
    const sc = s.sc;
    const m = ++s.month;
    dec = { ...sc.defaults, ...dec };
    const price = Math.max(1, Math.round(dec.price));
    const terms = sc.terms.locked ?? (sc.terms.allowed.includes(dec.terms) ? dec.terms : sc.terms.allowed[0]);
    const rec = { m, open: { ...s.bal }, openUnits: s.invUnits, entries: [], events: [], decisions: { ...dec, price, terms } };
    s.cur = rec;

    for (const ev of sc.events) {
      if (ev.month !== m) continue;
      if (ev.text) rec.events.push({ type: ev.type, text: ev.text });
      if (ev.type === 'cod') s.cod = true;
      if (ev.type === 'cost') s.unitCost = ev.unitCost;
      if (ev.type === 'rate') s.rate = ev.rate;
    }

    // 1. Your levers: financing, investment, ordering
    if (sc.loan && dec.borrow > 0) {
      const amt = Math.min(Math.round(dec.borrow), sc.loan.limit - s.bal.loan);
      if (amt > 0) post(s, 'borrow', `You borrow ${eur(amt)} from the bank`, [['cash', amt], ['loan', amt]], null, 'borrow');
    } else if (sc.loan && dec.borrow < 0) {
      const amt = Math.min(Math.round(-dec.borrow), s.bal.loan);
      if (amt > 0) post(s, 'repay', `You repay ${eur(amt)} of the loan`, [['cash', -amt], ['loan', -amt]], null, 'repay');
    }
    if (sc.capacityPerBench) {
      for (let i = 0; i < (dec.buyBenches | 0); i++) {
        post(s, 'capex', `You buy a workbench for ${eur(sc.bench.cost)} cash`, [['equip', sc.bench.cost], ['cash', -sc.bench.cost]], null, 'capex');
        s.benches.push({ cost: sc.bench.cost, book: sc.bench.cost, left: sc.bench.life });
      }
    }
    rec.ordered = 0;
    if (!sc.madeToOrder && dec.order > 0) {
      rec.ordered = Math.round(dec.order);
      s.pipeline.push({ units: rec.ordered, arrive: m + sc.leadTime, placed: m });
    }

    // 2. The world: deliveries, customers paying, paying the supplier
    const arriving = s.pipeline.filter(p => p.arrive <= m);
    s.pipeline = s.pipeline.filter(p => p.arrive > m);
    for (const p of arriving) receive(s, p.units, sc.supplierCredit === 0 || s.cod);

    if (sc.events.some(ev => ev.type === 'latePay' && ev.month === m)) {
      for (const c of s.arCohorts) if (c.due <= m) c.due = m + 1;
    }
    for (const c of s.arCohorts.filter(c => c.due <= m)) {
      post(s, 'collect', `Customers pay for ${monthName(c.from)} sales`, [['cash', c.amt], ['ar', -c.amt]], null, 'collect');
    }
    s.arCohorts = s.arCohorts.filter(c => c.due > m);
    const bad = sc.events.find(ev => ev.type === 'badDebt' && ev.month === m);
    if (bad && s.arCohorts.length) {
      const c = s.arCohorts.reduce((a, b) => (b.amt > a.amt ? b : a));
      const w = Math.round(c.amt * bad.frac);
      c.amt -= w;
      post(s, 'baddebt', `A customer goes bust: ${eur(w)} of ${monthName(c.from)} invoices will never be paid`, [['re', -w], ['ar', -w]], 'baddebt');
    }
    for (const c of s.apCohorts.filter(c => c.due <= m)) {
      post(s, 'paysupplier', `You pay the supplier for kits delivered in ${monthName(c.from)}`, [['ap', -c.amt], ['cash', -c.amt]], null, 'suppliers');
    }
    s.apCohorts = s.apCohorts.filter(c => c.due > m);

    // 3. Selling
    const demand = demandFor(s, price, terms, m);
    const cap = capacityOf(s);
    let sold;
    if (sc.madeToOrder) {
      sold = Math.min(demand, cap);
      if (sold) receive(s, sold, true);
    } else {
      sold = Math.min(demand, s.invUnits, cap);
    }
    rec.demand = demand; rec.sold = sold; rec.lost = demand - sold; rec.capacity = cap;
    rec.lostReason = !rec.lost ? null : (!sc.madeToOrder && s.invUnits <= cap) ? 'stock' : 'capacity';
    if (sold) {
      const rev = sold * price;
      if (terms === 0) {
        post(s, 'sale', `${sold} kits sold at ${eur(price)}, paid in cash`, [['cash', rev], ['re', rev]], 'revenue', 'collect');
      } else {
        post(s, 'sale', `${sold} kits sold at ${eur(price)}, customers will pay in ${terms * 30} days`, [['ar', rev], ['re', rev]], 'revenue');
        s.arCohorts.push({ due: m + terms, amt: rev, from: m });
      }
      const cogs = sold === s.invUnits ? s.bal.inv : Math.round((s.bal.inv * sold) / s.invUnits);
      s.invUnits -= sold;
      post(s, 'cogs', `${sold} kits leave the shelf: their cost becomes an expense`, [['inv', -cogs], ['re', -cogs]], 'cogs');
    }

    // 4. Running costs
    if (sc.overhead) post(s, 'overhead', `Rent and wages paid`, [['cash', -sc.overhead], ['re', -sc.overhead]], 'overhead', 'overhead');
    let dep = 0;
    for (const b of s.benches) {
      if (b.left <= 0) continue;
      const d = b.left === 1 ? b.book : Math.min(b.book, Math.round(b.cost / sc.bench.life));
      b.book -= d; b.left -= 1; dep += d;
    }
    if (dep) post(s, 'dep', `Workbenches wear out a little: ${eur(dep)} of their value becomes an expense`, [['re', -dep], ['equip', -dep]], 'dep');
    if (s.bal.loan > 0 && s.rate) {
      const i = Math.round(s.bal.loan * s.rate);
      post(s, 'interest', `Interest on the loan`, [['cash', -i], ['re', -i]], 'interest', 'interest');
    }

    s.lastDemand = demand;
    closeMonth(s, rec);
    if (s.bal.cash < 0) s.status = 'insolvent';
    else if (m >= sc.months) s.status = 'finished';
    return rec;
  }

  function closeMonth(s, rec) {
    rec.close = { ...s.bal };
    rec.closeUnits = s.invUnits;
    rec.onOrder = onOrder(s);
    rec.benches = s.benches.length;
    rec.stmt = statements(rec);
    s.history.push(rec);
    s.cur = null;
  }

  // ---- the governor: an automatic regulator ----------------------------------

  const GAUGES = {
    cash: { name: 'Cash in the bank', read: s => s.bal.cash },
    liquid: { name: 'Cash + receivables', read: s => s.bal.cash + s.bal.ar },
    profit: { name: 'Profit so far (retained earnings)', read: s => s.bal.re },
  };

  function governorDecide(s, p) {
    const sc = s.sc;
    const g = s.gov || (s.gov = { forecast: p.initialForecast ?? sc.demand.base });
    if (s.lastDemand != null) g.forecast = p.alpha * s.lastDemand + (1 - p.alpha) * g.forecast;
    const f = g.forecast;
    const target = f * p.cover + (p.pipeline ? f * sc.leadTime : 0);
    const position = s.invUnits + (p.pipeline ? onOrder(s) : 0);
    const order = Math.max(0, Math.round(f + p.gain * (target - position)));
    let buyBenches = 0;
    if (p.autoBench && sc.capacityPerBench && f > 0.9 * capacityOf(s)) buyBenches = 1;
    let borrow = 0;
    if (sc.loan) {
      // the gauge plus its own last change: a one-month-ahead guess
      const prev = s.history.length > 1 ? s.history[s.history.length - 2].close : null;
      const now = GAUGES[p.watch].read(s);
      const v = now + (prev ? now - GAUGES[p.watch].read({ bal: prev }) : 0);
      if (v < p.floor) borrow = Math.round(p.borrowGain * (p.floor - v));
      else if (v > 2 * p.floor && s.bal.loan > 0) borrow = -Math.round(0.5 * (v - 2 * p.floor));
      if (buyBenches) borrow += sc.bench.cost;
    }
    return { price: p.price ?? sc.defaults.price, terms: sc.terms.locked ?? sc.defaults.terms, order, buyBenches, borrow };
  }

  function runGovernor(level, params, seed) {
    const s = newGame(level, seed);
    const decisions = [];
    while (s.status === 'running') {
      const d = governorDecide(s, params);
      decisions.push(d);
      step(s, d);
    }
    return { game: s, decisions };
  }

  return {
    ACCOUNTS, IS_LINES, CF_LINES, SIDE, GAUGES, DEFAULTS,
    newGame, step, statements, span, demandFor, capacityOf, onOrder,
    governorDecide, runGovernor, merge, clone, monthName, eur,
  };
});
