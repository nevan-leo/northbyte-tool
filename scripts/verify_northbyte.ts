// Acceptance tests from section 7 of the build brief. The tool is only correct
// if it reproduces the deck, so this runs the model against every published
// figure at a $0.05M tolerance.
//
//   npx esbuild scripts/verify_northbyte.ts --bundle --platform=node --format=esm \
//     --outfile=<tmp>/verify.mjs && node <tmp>/verify.mjs

import {
  scenario, routes, presets, DEFAULT_LEVERS, TODAY_LEVERS, type Levers,
} from '../app/northbyte/model';

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

console.log(failures === 0
  ? '\nAll acceptance tests pass.'
  : `\n${failures} acceptance test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
