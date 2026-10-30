// Levels: each one adds a single mechanism and a single idea.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Levels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LEVELS = [
    {
      id: 'cash',
      title: 'The Cash Counter',
      newThing: 'Two-sided bookkeeping',
      idea: 'Conservation',
      months: 4,
      start: { cash: 3000 },
      madeToOrder: true,
      overhead: 1500,
      demand: { base: 80 },
      controls: ['price'],
      goal: { profit: 3700 },
      questions: ['gap', 'cashUp', 'equityUp'],
      intro: [
        'You sell DIY thermostat kits. Every customer pays cash on the spot, and you buy each kit from the supplier the moment you sell it, also in cash.',
        'Your only lever is the price. Cheaper kits sell more, but each one earns less.',
        'Watch the two columns in the middle. Every event is written down twice, once on each side, so the columns are always the same height. Accountants call this double-entry. A physicist would call it a conservation law.',
      ],
      debrief: [
        'In this shop, profit and the change in cash were the same number every month. The income statement and the cash flow statement told one story.',
        'Profit landed in Retained earnings, on the right. Cash landed on the left. The two sides moved together because every entry has two legs.',
        'That stops being true the moment money and goods stop moving at the same time. Next level.',
      ],
    },
    {
      id: 'credit',
      title: 'Selling on Credit',
      newThing: 'Receivables',
      idea: 'Delay in the loop',
      months: 6,
      start: { cash: 8000 },
      madeToOrder: true,
      overhead: 1500,
      demand: { base: 80 },
      terms: { allowed: [0, 1, 2] },
      controls: ['price', 'terms'],
      goal: { profit: 8000 },
      questions: ['gap', 'cashUp', 'arUp'],
      intro: [
        'Big customers ask to pay later. If you let them pay in 30 days, 25% more customers buy. At 60 days, 45% more.',
        'A sale counts as revenue the day it happens, so profit goes up right away. The cash only arrives one or two months later. Meanwhile you pay for the kits in cash today.',
        'The question this level asks: can the firm be profitable and still run out of cash? If cash ends a month below zero, the firm is insolvent and the game ends.',
      ],
      debrief: [
        'Profit reports what you earned. Cash shows what you can pay with. Credit terms push the two apart, and Receivables is the tank that holds the difference.',
        'In control terms, credit adds a delay to the loop. The signal you see (profit) arrives before the thing you need (cash). A controller that only watches profit will over-steer.',
        { when: 'ar', text: 'On the bridge from profit to cash, "customers owe more" is the line that ate your cash.' },
      ],
    },
    {
      id: 'stock',
      title: 'Stock and Suppliers',
      newThing: 'Inventory and payables',
      idea: 'Lead times',
      months: 9,
      start: { cash: 6000, invUnits: 100 },
      overhead: 1500,
      leadTime: 1,
      supplierCredit: 1,
      demand: { base: 80, noise: 0.15, season: { 5: 1.3, 6: 1.5, 7: 1.25 } },
      terms: { allowed: [0, 1] },
      controls: ['price', 'terms', 'order'],
      defaults: { order: 80 },
      goal: { profit: 9000 },
      questions: ['gap', 'invUp', 'cashUp', 'arUp'],
      events: [
        { month: 4, type: 'notice', text: 'Trade press: thermostat season starts next month. Expect busy months 5 to 7.' },
        { month: 5, type: 'notice', text: 'Your supplier warns: kits will cost €46 instead of €40 from month 6.' },
        { month: 6, type: 'cost', unitCost: 46, text: 'Kits now cost €46 each.' },
      ],
      intro: [
        'Kits must now be ordered ahead: what you order this month arrives next month. The supplier lets you pay one month after delivery.',
        'Kits on the shelf are Inventory, an asset. They only become an expense (cost of kits sold) when you sell them. Unpaid supplier invoices are Payables: the supplier\'s money, sitting in your bank for a while.',
        'Demand is noisy now, and a busy season is coming. Run out of stock and the customers walk away. Order too much and your cash sits on a shelf.',
      ],
      debrief: [
        'Buying kits did not reduce profit. Selling them did. Paying for them reduced cash, but a month later. Three different moments for one box of kits.',
        'Inventory is cash you have frozen. Payables is cash you have borrowed from your supplier for free. Both sit between profit and cash on the bridge.',
        'The one-month lead time is a delay in your own lever. If you forgot the kits already on their way, you ordered twice. That is the seed of the oscillations in the Governor Lab.',
      ],
    },
    {
      id: 'bench',
      title: 'The Workbench',
      newThing: 'Equipment, depreciation, loans',
      idea: 'Stocks that drain slowly',
      months: 12,
      start: { cash: 8000, invUnits: 90, benches: 1 },
      overhead: 1800,
      leadTime: 1,
      supplierCredit: 1,
      capacityPerBench: 100,
      demand: { base: 90, growth: 0.05, noise: 0.1 },
      terms: { allowed: [0, 1] },
      loan: { rate: 0.01, limit: 20000 },
      controls: ['price', 'terms', 'order', 'bench', 'loan'],
      defaults: { order: 95 },
      goal: { profit: 18000 },
      questions: ['gap', 'cashUp', 'profitPos', 'equityUp'],
      intro: [
        'Each workbench can assemble 100 kits a month, and demand grows about 5% a month. You start with one.',
        'A new workbench costs €6,000 in cash today. It lasts two years, so the expense is spread out: €250 a month of depreciation. Cash drops at once; profit drops slowly.',
        'The bank lends up to €20,000 at 1% interest a month. A loan brings cash in, but it is not income: profit does not change when you borrow. Only the interest is an expense.',
      ],
      debrief: [
        'The workbench purchase showed up in exactly one place on the cash flow statement (investing) and never on the income statement. Depreciation did the opposite: income statement every month, cash flow statement never.',
        'The loan was the same kind of thing. Cash up, liability up, profit untouched.',
        'Equipment is a stock that fills all at once and drains slowly. That slow drain is the reason profit and cash can disagree for years.',
      ],
    },
    {
      id: 'trap',
      title: 'The Growth Trap',
      newThing: 'Disturbances',
      idea: 'Requisite variety',
      months: 12,
      start: { cash: 10000, invUnits: 110, benches: 1 },
      overhead: 2000,
      leadTime: 1,
      supplierCredit: 1,
      capacityPerBench: 100,
      demand: { base: 70, growth: 0.12, noise: 0.08 },
      terms: { allowed: [2], locked: 2 },
      loan: { rate: 0.01, limit: 60000 },
      controls: ['price', 'order', 'bench', 'loan'],
      defaults: { order: 100 },
      goal: { profit: 25000 },
      questions: ['gap', 'cashUp', 'arUp'],
      events: [
        { month: 4, type: 'latePay', text: 'A big customer pays a month late. The invoices due this month slip to next month.' },
        { month: 6, type: 'cod', text: 'Your supplier got nervous: from now on, kits must be paid in cash on delivery.' },
        { month: 8, type: 'rate', rate: 0.015, text: 'The bank raises interest to 1.5% a month.' },
        { month: 9, type: 'badDebt', frac: 0.3, text: 'A retailer goes bust and will not pay part of what it owes.' },
      ],
      intro: [
        'The market loves your kits: demand grows 12% a month. The big retailers insist on paying in 60 days, so every sale waits two months for its cash.',
        'Things will go wrong. Customers will pay late, your supplier will lose patience, the bank will get pricier. You have fewer levers than there are surprises.',
        'You will see large profits. The question is whether the firm is still alive in month 12.',
      ],
      debrief: [
        'This is how growing firms die: profitable, with full order books, and out of cash. Every extra sale needs kits paid now and a customer paying later, so growth eats cash.',
        'Ashby\'s law of requisite variety says only variety can absorb variety. Each surprise needed a lever to absorb it. The bank loan was the lever with the most room, which is why firms negotiate credit lines before they need them.',
        'The essential variable was cash, not profit. A regulator has to watch the variable that kills.',
      ],
    },
  ];

  // Governor Lab scenarios. The governor follows the rule you configure.
  const LAB_SCENARIOS = {
    steady: {
      title: 'Steady market, sudden jump',
      months: 36,
      start: { cash: 12000, invUnits: 160, benches: 0 },
      overhead: 1500,
      leadTime: 2,
      supplierCredit: 1,
      demand: { base: 80, noise: 0.05 },
      terms: { allowed: [1], locked: 1 },
      loan: { rate: 0.01, limit: 40000 },
      events: [{ month: 8, type: 'demand', mult: 1.4, text: 'A TV feature: demand jumps 40% and stays there.' }],
    },
    growth: {
      title: 'Growth with 60-day customers',
      months: 36,
      start: { cash: 10000, invUnits: 110, benches: 1 },
      unitCost: 52,
      overhead: 1500,
      leadTime: 1,
      supplierCredit: 1,
      capacityPerBench: 100,
      demand: { base: 70, growth: 0.07, noise: 0.05 },
      terms: { allowed: [2], locked: 2 },
      loan: { rate: 0.01, limit: 150000 },
      events: [{ month: 12, type: 'cod', text: 'Supplier switches to cash on delivery.' }],
    },
  };

  const LAB_PRESETS = [
    {
      id: 'thermostat', title: 'Calm thermostat', scenario: 'steady',
      params: { alpha: 0.3, cover: 1, gain: 0.3, pipeline: true, watch: 'cash', floor: 6000, borrowGain: 1, autoBench: true },
      note: 'Counts kits already on their way and corrects gently. The jump in month 8 is absorbed in a few months with little overshoot.',
    },
    {
      id: 'bullwhip', title: 'Bullwhip', scenario: 'steady',
      params: { alpha: 0.6, cover: 1, gain: 0.9, pipeline: false, watch: 'cash', floor: 6000, borrowGain: 1, autoBench: true },
      note: 'Forgets the kits already ordered and corrects hard. With a two-month lead time it keeps over-ordering, then cutting back: orders swing far more than demand ever did.',
    },
    {
      id: 'profitblind', title: 'Profit-watching pilot', scenario: 'growth',
      params: { alpha: 0.4, cover: 1, gain: 0.4, pipeline: true, watch: 'profit', floor: 12000, borrowGain: 1, autoBench: true },
      note: 'Borrows when accumulated profit looks low and repays when profit looks healthy. Profit keeps rising, so it keeps paying back the bank while receivables and stock swallow the cash.',
    },
    {
      id: 'cashsighted', title: 'Cash-watching pilot', scenario: 'growth',
      params: { alpha: 0.4, cover: 1, gain: 0.4, pipeline: true, watch: 'cash', floor: 12000, borrowGain: 1, autoBench: true },
      note: 'Exactly the same rule and floor as the profit-watching pilot; only the gauge differs. It watches the variable that actually kills the firm and borrows to keep cash above the floor.',
    },
  ];

  return { LEVELS, LAB_SCENARIOS, LAB_PRESETS };
});
