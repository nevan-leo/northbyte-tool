// Acceptance tests from section 7 of the build brief. The tool is only correct
// if it reproduces the deck, so this runs the model against every published
// figure at a $0.05M tolerance.
//
//   npx esbuild scripts/verify_northbyte.ts --bundle --platform=node --format=esm \
//     --outfile=<tmp>/verify.mjs && node <tmp>/verify.mjs

import {
  scenario, routes, presets, DEFAULT_LEVERS, TODAY_LEVERS, type Levers,
} from '../app/northbyte/model';
import { bestFarePct, ceiling, doNothing, recipe } from '../app/northbyte/model';
import { signed } from '../app/northbyte/format';

const M = 1_000_000;
let failures = 0;

function check(label: string, actual: number, expected: number, tolerance = 0.05 * M) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures += 1;
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(3));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} got ${fmt(actual).padStart(14)}  want ${fmt(expected).padStart(14)}`);
}

// ---------------------------------------------------------------- today ----
const today = scenario(TODAY_LEVERS);
check('today: flights', today.flights, 15_729, 0.5);
check('today: net revenue', today.revenue, 189_641_058);
check('today: cost', today.cost, 238_376_476);
check('today: contribution', today.contribution, -48_735_418);
check('today: gates', today.gates, 10_023_126);
check('today: profit after gates', today.profit, -58_758_544);
check('today: margin %', today.margin * 100, -31.0, 0.1);
check('today: Restore contribution', today.byCohort.Restore.contribution, -48_798_729);
check('today: Decide contribution', today.byCohort.Decide.contribution, -10_259_846);
check('today: Protect contribution', today.byCohort.Protect.contribution, 10_323_157);

// ------------------------------------- plan, no fares, forecast gates ------
const planBase: Levers = {
  ...DEFAULT_LEVERS, phase: 1, tranche: 4, farePct: 0, elasticity: 0,
  gates: 'forecast', releaseIdleGates: false, seasonal: true, crewShed: 1,
};
check('plan, rho High (0.046)', scenario({ ...planBase, rhoDown: presets.rhoDown.High }).profit, -2.09 * M);
check('plan, rho Mid (0.19)', scenario({ ...planBase, rhoDown: presets.rhoDown.Mid }).profit, -6.18 * M);
check('plan, rho Low (1.0)', scenario({ ...planBase, rhoDown: presets.rhoDown.Low }).profit, -28.92 * M);

// ------------------------------------------------------- the full plan ----
const full: Levers = { ...planBase, farePct: presets.costPassThroughFarePct, releaseIdleGates: true };
check('full plan, rho High', scenario({ ...full, rhoDown: presets.rhoDown.High }).profit, 3.26 * M);
check('full plan, rho Mid', scenario({ ...full, rhoDown: presets.rhoDown.Mid }).profit, -0.84 * M);
check('full plan, rho Low', scenario({ ...full, rhoDown: presets.rhoDown.Low }).profit, -23.58 * M);

// ----------------------------------------------- spot check: YUL -> YVR ----
const yulyvr = routes.find(r => r.Route === 'YUL-YVR')!;
check('YUL-YVR: flights today', yulyvr.Flights_FY2526, 306, 0.5);
check('YUL-YVR: plan flights (pre-seasonal)', yulyvr.PlanFlights, 144, 0.5);
check('YUL-YVR: revenue today', yulyvr.NetRev, 9.29 * M, 0.01 * M);
check('YUL-YVR: cost today', yulyvr.Cost, 19.63 * M, 0.01 * M);
check('YUL-YVR: contribution today', yulyvr.Contrib, -10.34 * M, 0.01 * M);

// ------------------------------------------- the per-solution levels ------
// The two flight levers can be pulled independently; at full they have to land
// exactly where the brief's full plan lands, and at zero exactly on today.
const levelled = (restoreLevel: number, decideLevel: number, extra: Partial<Levers> = {}) =>
  scenario({ ...DEFAULT_LEVERS, phase: 1, tranche: 4, restoreLevel, decideLevel, ...extra });

const fullByLevels: Partial<Levers> = {
  farePct: presets.costPassThroughFarePct, elasticity: 0,
  gates: 'forecast', releaseIdleGates: true, seasonal: true, crewShed: 1,
};
check('levels=1, rho High  -> full plan', levelled(1, 1, { ...fullByLevels, rhoDown: presets.rhoDown.High }).profit, 3.26 * M);
check('levels=1, rho Mid   -> full plan', levelled(1, 1, { ...fullByLevels, rhoDown: presets.rhoDown.Mid }).profit, -0.84 * M);
check('levels=1, rho Low   -> full plan', levelled(1, 1, { ...fullByLevels, rhoDown: presets.rhoDown.Low }).profit, -23.58 * M);
check('levels=0 -> today', levelled(0, 0, { seasonal: true }).profit, today.profit, 1);
check('levels=0 -> today, flights', levelled(0, 0).flights, 15_729, 0.5);

function monotonic(label: string, pull: (level: number) => number) {
  const steps = [0, 0.25, 0.5, 0.75, 1].map(pull);
  const rising = steps.every((v, i) => i === 0 || v >= steps[i - 1] - 1);
  if (!rising) failures += 1;
  console.log(`${rising ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ` +
    steps.map(v => (v / M).toFixed(1)).join(' -> '));
}
monotonic('profit rises with restoreLevel ($M)', level => levelled(level, 0).profit);
monotonic('profit rises with decideLevel ($M)', level => levelled(0, level).profit);
// Past the plan the new routes are exited outright, which still helps.
monotonic('profit rises past the plan ($M)', level => levelled(0, 1 + level).profit);


// ------------------------------------------------- edge cases --------------
// Nothing here should produce a NaN, an Infinity, or a number that claims to be
// a gain while being a loss.

const edges: [string, Partial<Levers>][] = [
  ['everything at today', { restoreLevel: 0, decideLevel: 0, farePct: 0, releaseIdleGates: false }],
  ['every route cut away', { restoreLevel: 1, decideLevel: 2, farePct: 0 }],
  ['fares at 10% with no demand response', { restoreLevel: 0, decideLevel: 0, farePct: 10, elasticity: 0 }],
  ['fares at 10% at route-level elasticity', { restoreLevel: 0, decideLevel: 0, farePct: 10, elasticity: -1.54 }],
  ['revenue leaves with the flights', { restoreLevel: 1, decideLevel: 1, rhoDown: 1 }],
  ['no crew cost shed', { restoreLevel: 1, decideLevel: 1, crewShed: 0 }],
  ['manual, every cohort grounded', { mode: 'manual', multipliers: { Restore: 0, Decide: 0, Protect: 0 } }],
  ['manual, every cohort at 150%', { mode: 'manual', multipliers: { Restore: 1.5, Decide: 1.5, Protect: 1.5 } }],
  ['target margin at zero', { targetMarginPct: 0 }],
];

for (const [label, patch] of edges) {
  const s = scenario({ ...DEFAULT_LEVERS, phase: 1, tranche: 4, ...patch });
  const numbers = [s.profit, s.flights, s.revenue, s.cost, s.contribution, s.margin,
                   s.fareGain, s.feedLoss, s.gapToBreakeven, s.gapToTarget,
                   ...s.byRoute.flatMap(r => [r.flights, r.revenue, r.cost, r.ticketsPerFlight])];
  const bad = numbers.filter(v => !Number.isFinite(v));
  const ok = bad.length === 0 && s.flights >= 0;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  edge: ${label.padEnd(40)} ` +
    `profit ${(s.profit / M).toFixed(1)}M  flights ${Math.round(s.flights)}` +
    (bad.length ? `  ${bad.length} non-finite` : ''));
}

// The sign on a difference has to be the difference's own.
const formatting: [number, string][] = [
  [0, 'no change'], [10_000, 'no change'], [-10_000, 'no change'],
  [42_800_000, '+$42.8M'], [-1_200_000, '−$1.2M'], [NaN, 'no change'],
];
for (const [value, want] of formatting) {
  const got = signed(value);
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  signed(${String(value).padEnd(12)}) -> ${got.padEnd(10)} want ${want}`);
}


// ------------------------------------- doing nothing, and the ceiling -------
// "What if we carry on" is the first question anyone asks, and the answer is
// not this year repeated: cost per flight rose while fares stood still.
const nothing = doNothing();
check('do nothing, flights held', nothing.held, -64.6 * M, 0.2 * M);
check('do nothing, expansion continues', nothing.expanding, -105.1 * M, 0.3 * M);
const doingNothingIsWorse = nothing.held < today.profit && nothing.expanding < nothing.held;
if (!doingNothingIsWorse) failures += 1;
console.log(`${doingNothingIsWorse ? 'PASS' : 'FAIL'}  doing nothing is worse than today, and expanding worse still`);

// What the four levers top out at, which is the answer to "so what IS the plan".
const atBase: Levers = { ...DEFAULT_LEVERS, phase: 1, tranche: 4, gates: 'forecast',
                         releaseIdleGates: true, seasonal: true };
for (const [name, rho] of [['High', presets.rhoDown.High], ['Mid', presets.rhoDown.Mid],
                           ['Low', presets.rhoDown.Low]] as const) {
  const best = ceiling({ ...atBase, rhoDown: rho }, 6.4);
  console.log(`      ceiling at ${name.padEnd(5)} demand, no price response: ` +
    `${(best.profit / M).toFixed(1)}M, ${(best.short / M).toFixed(1)}M short of target`);
}
const midCeiling = ceiling({ ...atBase, rhoDown: presets.rhoDown.Mid }, 6.4);
check('ceiling at base demand clears break even', midCeiling.profit, 3.8 * M, 0.3 * M);
const shortOfTarget = midCeiling.short > 0;
if (!shortOfTarget) failures += 1;
console.log(`${shortOfTarget ? 'PASS' : 'FAIL'}  the four levers alone do not reach the sustainable target`);

// A fare rise only helps while demand does not answer back.
const elastic = ceiling({ ...atBase, rhoDown: presets.rhoDown.Mid, elasticity: -0.88 }, 6.4);
const faresBackfire = elastic.profit < midCeiling.profit;
if (!faresBackfire) failures += 1;
console.log(`${faresBackfire ? 'PASS' : 'FAIL'}  fares at the national elasticity give back ` +
  `${((midCeiling.profit - elastic.profit) / M).toFixed(1)}M of the ceiling`);


// -------------------------------------------- the fare optimum --------------
// Revenue moves with (1+p)(1+e·p), so once e is negative there is a price past
// which the tickets lost cost more than the fare gained.
check('best fare, no price response', bestFarePct(0, 6.4), 6.4, 0.01);
check('best fare, half response', bestFarePct(-0.5, 6.4), 6.4, 0.01);
check('best fare, national average', bestFarePct(-0.88, 6.4), 6.4, 0.01);
check('best fare, route level -> leave fares alone', bestFarePct(-1.54, 6.4), 0, 0.01);
check('best fare, uncapped national average', bestFarePct(-0.88, 100), 6.82, 0.02);

// The whole recipe, at base demand, under each price response.
const atBase2: Levers = { ...DEFAULT_LEVERS, phase: 1, tranche: 4, gates: 'forecast',
                          releaseIdleGates: true, seasonal: true, rhoDown: presets.rhoDown.Mid };
for (const [name, e, want] of [['no response', 0, 3.8], ['half', -0.5, -1.1],
                               ['national average', -0.88, -4.8],
                               ['route level', -1.54, -5.4]] as const) {
  const r = recipe({ ...atBase2, elasticity: e }, 6.4);
  check(`recipe at base demand, ${name}`, r.profit, want * M, 0.2 * M);
}
const flightsCarryIt = recipe({ ...atBase2, elasticity: -1.54 }, 6.4);
const flightShare = flightsCarryIt.steps.slice(0, 2).reduce((a, s) => a + s.value, 0);
const faresDoNothing = Math.abs(flightsCarryIt.steps[3].value) < 0.05 * M;
if (!(flightShare > 50 * M && faresDoNothing)) failures += 1;
console.log(`${flightShare > 50 * M && faresDoNothing ? 'PASS' : 'FAIL'}  at route-level elasticity the ` +
  `flights carry ${(flightShare / M).toFixed(1)}M and fares are left alone`);

console.log(failures === 0
  ? '\nAll acceptance tests pass.'
  : `\n${failures} acceptance test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
