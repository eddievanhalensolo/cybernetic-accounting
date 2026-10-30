# Ledger Homeostat

A small game that connects cybernetics and accounting. You run a firm that sells DIY thermostat kits and act as its regulator. The balance sheet is the state of the system (the tanks), the income statement and the cash flow statement are two instruments watching flows into two different tanks (retained earnings and cash), and the ledger is the sensor.

Open `index.html` in a browser. No build step and no server; fonts load from Google Fonts with system fallbacks.

## What's in it

- **Five levels**, each adding one mechanism and one idea: cash-only stand (conservation), credit sales (delay), inventory and suppliers (lead times), equipment and loans (slow-draining stocks), growth with disturbances (requisite variety).
- **Balance machine**: two stacked columns that are always the same height. Negative balances move to the other column, hatched (overdraft, accumulated losses).
- **Profit vs. cash meters**, with the gap explained by the other tanks in every month.
- **Green-bar printouts**: income statement, cash flow statement, balance sheet, profit-to-cash bridge, journal. Click any number to trace the journal entries behind it and see where else they show up.
- **Predictions** before each month, scored: your mental model is a regulator too.
- **Governor Lab**: configure an autopilot (ordering rule, financing rule, which gauge it watches) and run 36 months. Presets show a calm thermostat, the bullwhip, a profit-watching pilot that dies rich, and a cash-watching one that survives.
- **Field guide**: the eight ideas side by side (cybernetics / accounting), with a one-legged-entry demo that tips the beam.

## Files

| File | Role |
|---|---|
| `engine.js` | Simulation. Every event is a balanced journal entry; all statements are derived from entries. Works in Node and the browser. |
| `levels.js` | Level and lab scenario definitions, texts. |
| `app.js` | Interface. |
| `style.css` | Styles, light and dark. |

## Tests

```sh
node --test test/engine.test.js   # invariants: A = L + E, profit = ΔRE, cash flow = Δcash, indirect = direct; lab lessons hold
node test/browser.mjs [outdir]     # drives headless Chrome through every screen, fails on console errors or phone overflow
```

Run both after any change to `engine.js` or `levels.js`. Level goals were calibrated with an automatic player (see the governor in `engine.js`).
