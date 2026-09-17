/*
 * Self-check for the terminal's two pieces of non-trivial client-side maths:
 * the Churning tab's holding-state reconstruction, and the Overview tab's
 * trailing-return periods.
 *
 *   node test_terminal.js
 *
 * app.js is the real file, loaded against the real data.js / holdings.js with a
 * stub DOM — nothing here re-implements the logic it is checking, so a change to
 * churnData() that breaks a rule below fails here rather than silently shipping
 * a wrong "Avg Stocks Held".
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const here = __dirname;

/* A DOM just real enough to let the tab render. Elements are handed out rather
   than nulled so renderChurning() actually executes every template in this
   file — a broken interpolation fails here instead of on the page. */
const el = () => ({
  innerHTML: '', textContent: '', style: {}, dataset: {},
  classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  getContext: () => ({}),
});
const ctx = {
  console,
  // Init is inside a DOMContentLoaded handler, so swallowing the listener is
  // enough to load app.js without a browser.
  document: {
    addEventListener() {},
    getElementById: el,
    querySelector: el,
    querySelectorAll: () => [],
    documentElement: { getAttribute: () => 'dark', setAttribute() {} },
  },
  window: {},
  localStorage: { getItem: () => null, setItem() {} },
  Chart: function () { this.destroy = () => {}; },
};
ctx.Chart.defaults = { font: {} };
vm.createContext(ctx);

// One script, not three: a top-level `const` belongs to its own script's
// lexical scope, so MONTHLY_HOLDINGS and the helpers would be invisible to the
// next runInContext call. The epilogue is the only line of test-only code that
// runs inside the page's own scope.
const bundle = ['data.js', 'holdings.js', 'app.js']
  .map(f => fs.readFileSync(path.join(here, f), 'utf8'))
  .join('\n;\n')
  + '\n;globalThis.__probe = { spanDays, churnData, setChurnRule, MONTHLY_HOLDINGS, state,'
  + ' periodRows, periodNote, annualise, renderTab, renderHeader, M };';
vm.runInContext(bundle, ctx, { filename: 'bundle.js' });
Object.assign(ctx, ctx.__probe);

let failures = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  if (cond) return;
  failures++;
  console.error(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
}

// ── Pure date maths, independent of any book ──────────────────────────────
// The tax boundary is the thing most likely to be got wrong by one day, so it
// is pinned explicitly rather than inferred from whatever the data happens to
// contain.
const spanDays = ctx.spanDays;
check('Jan..Dec 2022 is 365 days', spanDays('2022-01', '2022-12') === 365,
  `got ${spanDays('2022-01', '2022-12')}`);
check('12 months is NOT long-term at a 365-day rule', !(spanDays('2022-01', '2022-12') > 365));
check('13 months IS long-term at a 365-day rule', spanDays('2022-01', '2023-01') > 365,
  `got ${spanDays('2022-01', '2023-01')}`);
check('a one-month spell spans that month', spanDays('2022-02', '2022-02') === 28,
  `got ${spanDays('2022-02', '2022-02')}`);
check('leap February is 29 days', spanDays('2024-02', '2024-02') === 29);

// ── Reconstruction invariants, over every published run ───────────────────
const runs = Object.keys(ctx.MONTHLY_HOLDINGS);
check('there are runs to test', runs.length > 0);

let totalSpells = 0;
for (const key of runs) {
  const [u, v] = [key.slice(0, key.indexOf('_')), key.slice(key.indexOf('_') + 1)];
  const d = ctx.churnData(u, v);
  if (!d) { check(`${key} has churn data`, false); continue; }
  totalSpells += d.spells.length;

  const books = ctx.MONTHLY_HOLDINGS[key];
  const closed = d.spells.filter(s => !s.openNow);

  // Every position in every book belongs to exactly one spell covering that
  // month: this is what makes "stocks held" a reading of the book rather than
  // a guess from trade counts.
  d.byMonth.forEach((row, i) => {
    const expected = books[row.month].filter(h => !h.m).length;
    check(`${key} ${row.month} held count matches the book`, row.held === expected,
      `book ${expected}, churn ${row.held}`);
    const covering = d.spells.filter(s => i >= s.startIdx && i < s.startIdx + s.months).length;
    check(`${key} ${row.month} spells cover every holding`, covering === expected,
      `book ${expected}, spells ${covering}`);
    check(`${key} ${row.month} long + short = held`, row.lt + row.st === row.held,
      `${row.lt}+${row.st} != ${row.held}`);
  });

  // Entries and exits must account for every spell exactly once, or turnover
  // and the exit split are both wrong.
  const entries = d.byMonth.reduce((a, r) => a + r.entered, 0);
  const exits = d.byMonth.reduce((a, r) => a + r.exited, 0);
  check(`${key} entries = spells`, entries === d.spells.length, `${entries} vs ${d.spells.length}`);
  check(`${key} exits = closed spells`, exits === closed.length, `${exits} vs ${closed.length}`);

  // An open spell is one that reaches the final book — nothing else.
  d.spells.forEach(s => {
    check(`${key} ${s.sym} open flag matches last month`,
      s.openNow === (s.endMonth === d.last));
    check(`${key} ${s.sym} spell is at least one month`, s.months >= 1);
    check(`${key} ${s.sym} days match its span`, s.days === spanDays(s.startMonth, s.endMonth));
  });

  // A name that leaves and comes back is two spells, so its clock restarts.
  const bySym = new Map();
  d.spells.forEach(s => bySym.set(s.sym, (bySym.get(s.sym) || 0) + 1));
  for (const [sym, n] of bySym) {
    if (n < 2) continue;
    const ss = d.spells.filter(s => s.sym === sym).sort((a, b) => a.startIdx - b.startIdx);
    for (let i = 1; i < ss.length; i++) {
      check(`${key} ${sym} re-entry leaves a real gap`,
        ss[i].startIdx > ss[i - 1].startIdx + ss[i - 1].months,
        `spell ${i} starts at ${ss[i].startIdx}, previous ends at ${ss[i - 1].startIdx + ss[i - 1].months - 1}`);
    }
  }

  // Bullion must not reach the equity churning figures at all.
  check(`${key} excludes the bullion sleeve`,
    !d.spells.some(s => s.sym === 'GOLDBEES' || s.sym === 'SILVERBEES'));
}

// The threshold is a live input: changing it must move the split without
// changing the spells it classifies.
const probe = runs.find(k => ctx.churnData(k.slice(0, k.indexOf('_')), k.slice(k.indexOf('_') + 1)));
if (probe) {
  const [u, v] = [probe.slice(0, probe.indexOf('_')), probe.slice(probe.indexOf('_') + 1)];
  const at365 = ctx.churnData(u, v).spells.length;
  ctx.setChurnRule(1095);
  const at1095 = ctx.churnData(u, v);
  check('threshold change keeps the same spells', at1095.spells.length === at365,
    `${at365} vs ${at1095.spells.length}`);
  const ltAt1095 = at1095.spells.filter(s => !s.openNow && s.days > 1095).length;
  ctx.setChurnRule(365);
  const ltAt365 = ctx.churnData(u, v).spells.filter(s => !s.openNow && s.days > 365).length;
  check('a longer threshold cannot classify more as long-term', ltAt1095 <= ltAt365,
    `${ltAt1095} > ${ltAt365}`);
}

// Render the tab at every threshold. MAQS shows ONE strategy — the fixed
// UNIVERSE/SLEEVE — so that is the only combination the renderer supports; the
// reconstruction above is still checked against all 16 runs, which is where the
// regression value lies. The tab is the only place these templates run, so this
// is what catches a bad interpolation.
const HOME = { u: ctx.state.universe, v: ctx.state.variant };
check('terminal is pinned to All Indices', HOME.u === 'T759', HOME.u);
check('terminal is pinned to the full sleeve', HOME.v === 'goldsilver', HOME.v);
for (const rule of [365, 730, 1095]) {
  try {
    ctx.setChurnRule(rule);
  } catch (e) {
    check(`renders at a ${rule}-day rule`, false, e.message);
  }
}
// A run with no published books must fall back, not throw.
ctx.state.universe = 'NOSUCH';
try { ctx.setChurnRule(365); } catch (e) { check('missing run falls back to N/A', false, e.message); }
check('missing run has no churn data', ctx.churnData('NOSUCH', HOME.v) === null);
ctx.state.universe = HOME.u;
ctx.state.variant = HOME.v;
ctx.setChurnRule(365);

// ── TRAILING RETURNS ──────────────────────────────────────────────────────
// 1Y / 2Y / 3Y must be the SAME calculation over a longer slice, and a period
// the history cannot fill must report itself as unavailable rather than quietly
// spanning fewer months.
const { periodRows, periodNote, annualise, M } = ctx;

for (const key of Object.keys(M.monthly)) {
  const series = M.monthly[key];
  const rows = periodRows(key);
  const byLabel = Object.fromEntries(rows.map(r => [r.label, r]));

  for (const [label, need] of [['1 Year', 12], ['2 Years', 24], ['3 Years', 36]]) {
    const r = byLabel[label];
    check(`${key} always reports ${label}`, !!r);
    if (!r) continue;
    if (series.length >= need) {
      check(`${key} ${label} spans exactly ${need} months`, r.months === need && !r.short,
        `months=${r.months} short=${r.short}`);
      // The same compounding the 1Y row uses, recomputed here from the raw
      // series — if periodRows ever switched methodology mid-table this fails.
      const want = series.slice(-need).reduce((a, x) => a * (1 + x.port_ret), 1) - 1;
      check(`${key} ${label} compounds the last ${need} months`, Math.abs(r.val - want) < 1e-12,
        `${r.val} vs ${want}`);
    } else {
      check(`${key} ${label} reports N/A`, r.short && r.val === null && r.bench === null);
      check(`${key} ${label} says why`, /n\/a/.test(periodNote(r)), periodNote(r));
    }
  }
  // A longer period must cover at least as much ground as a shorter one.
  if (byLabel['2 Years'] && !byLabel['2 Years'].short && !byLabel['1 Year'].short) {
    check(`${key} 2Y spans more months than 1Y`, byLabel['2 Years'].months > byLabel['1 Year'].months);
  }
}

// Annualisation: a 3Y cumulative restated per year must compound back.
const ann3 = annualise(2.0, 36);                       // +200% over three years
check('annualise inverts compounding', Math.abs(Math.pow(1 + ann3, 3) - 3.0) < 1e-12);
check('annualise declines a sub-year period', annualise(0.1, 6) === null);
check('annualise declines a null return', annualise(null, 36) === null);

// The insufficient-history path with a deliberately short series, since every
// published run happens to be long enough to fill 3Y.
const shortKey = '__short__';
M.monthly[shortKey] = Array.from({ length: 14 }, (_, i) => ({
  trade_month: `2025-${String(i + 1).padStart(2, '0')}`.replace('2025-13', '2026-01').replace('2025-14', '2026-02'),
  port_ret: 0.01, bench_ret: 0.005,
}));
const shortRows = Object.fromEntries(periodRows(shortKey).map(r => [r.label, r]));
check('short history fills 1Y', shortRows['1 Year'] && !shortRows['1 Year'].short);
check('short history reports 2Y as N/A', shortRows['2 Years'] && shortRows['2 Years'].short
  && shortRows['2 Years'].val === null);
check('short history reports 3Y as N/A', shortRows['3 Years'] && shortRows['3 Years'].short);
check('N/A note names the shortfall', /needs 24 mo, only 14/.test(periodNote(shortRows['2 Years'])),
  periodNote(shortRows['2 Years']));
delete M.monthly[shortKey];

console.log(`\n${ran} checks over ${runs.length} runs, ${totalSpells} spells, `
  + `${Object.keys(M.monthly).length} return series`);
if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('all checks passed');
