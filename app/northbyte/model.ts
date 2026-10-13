// NorthByte scenario model.
//
// A direct implementation of section 5 of the build brief. Every number the
// interface shows comes out of scenario(); nothing is computed in a component.
// The acceptance tests in scripts/verify_northbyte.ts pin it to the deck.

import data from '../data/northbyte.json';

export type Route = {
  Route: string; Dep: string; Arr: string; DepRegion: string;
  Cohort: 'Restore' | 'Decide' | 'Protect';
  LaunchDate: string; Tranche: number;
  Flights_FY2526: number; Flights_PreSepFeb: number;
  Tickets: number; TicketRev: number; AncRev: number; Refunds: number; NetRev: number;
  Fuel: number; Crew: number; Maint: number; Food: number; Cost: number;
  GateAlloc: number; Contrib: number; ProfitAfterGates: number;
  ConnTickets: number; FeedToStableRev: number;
  CostPerFlight: number; TicketsPerFlight: number; AvgFare: number;
  PlanFlights: number; Exit: boolean;
};

export const routes = data.routes as Route[];
export const constants = data.constants;
export const presets = data.presets;
export const COHORTS = ['Restore', 'Decide', 'Protect'] as const;
export type Cohort = (typeof COHORTS)[number];

export type Levers = {
  mode: 'preset' | 'manual';
  phase: number;                               // 0..1, today -> plan target
  tranche: number;                             // only routes with Tranche <= n move
  // Per-solution levels, so the two flight levers can be pulled independently
  // of each other. 0 = today, 1 = the plan. decideLevel carries on past 1 toward
  // zero flights, where 2 is every new route exited. phase multiplies both, so
  // leaving these at 1 reproduces the phase/tranche behaviour the tests pin.
  restoreLevel: number;
  decideLevel: number;
  multipliers: Record<Cohort, number>;         // manual mode, 0..1.5 of today
  rhoDown: number;                             // revenue response when cutting
  rhoUp: number;                               // revenue response when adding
  crewShed: number;                            // 0..1 of crew cost saved on cut flights
  farePct: number;                             // Protect fare change, percent
  elasticity: number;                          // 0 .. -1.5, illustrative
  gates: 'actual' | 'forecast';
  releaseIdleGates: boolean;
  seasonal: boolean;
  targetMarginPct: number;
};

export const DEFAULT_LEVERS: Levers = {
  mode: 'preset', phase: 1, tranche: 4, restoreLevel: 1, decideLevel: 1,
  multipliers: { Restore: 1, Decide: 1, Protect: 1 },
  rhoDown: presets.rhoDown.Mid, rhoUp: presets.rhoUp, crewShed: 1,
  farePct: 0, elasticity: 0, gates: 'actual', releaseIdleGates: false,
  seasonal: true, targetMarginPct: constants.targetMarginPct,
};

export type RouteResult = {
  route: Route;
  flights: number; revenue: number; cost: number; contribution: number;
  fareGain: number; feedLoss: number; tickets: number;
  ticketsPerFlight: number; breakEvenTicketsPerFlight: number; underFilled: boolean;
};

export type Scenario = {
  byRoute: RouteResult[];
  flights: number; revenue: number; cost: number; fareGain: number; feedLoss: number;
  contribution: number; gates: number; profit: number; margin: number;
  gapToBreakeven: number; gapToTarget: number; target: number;
  byCohort: Record<Cohort, { flights: number; revenue: number; cost: number; contribution: number }>;
};

/** Fare multiplier on Protect ticket revenue: (1+p)(1+e·p) − 1. */
function fareUplift(farePct: number, elasticity: number) {
  const p = farePct / 100;
  return (1 + p) * (1 + elasticity * p) - 1;
}

/** How far this route's own solution has been pulled: 0 today, 1 the plan. */
function levelFor(route: Route, levers: Levers) {
  const own = route.Cohort === 'Restore' ? levers.restoreLevel
    : route.Cohort === 'Decide' ? levers.decideLevel : 1;
  return levers.phase * own;
}

function targetFlights(route: Route, levers: Levers) {
  if (levers.mode === 'manual') {
    return route.Flights_FY2526 * levers.multipliers[route.Cohort];
  }
  // The seasonal baseline lifts the Restore plan only: stable routes already fly
  // about 8% more in Mar-Aug, and the plan is set from a Sep-Feb window.
  const seasonal = levers.seasonal && route.Cohort === 'Restore' ? constants.seasonalFactor : 1;
  const plan = route.PlanFlights * seasonal;
  const level = levelFor(route, levers);
  if (level <= 1) return route.Flights_FY2526 + level * (plan - route.Flights_FY2526);
  // Past the plan there is nothing left to trim but the route itself.
  return Math.max(0, plan * (2 - level));
}

export function scenario(levers: Levers): Scenario {
  const uplift = fareUplift(levers.farePct, levers.elasticity);
  const byRoute: RouteResult[] = routes.map(route => {
    const today = route.Flights_FY2526;
    // A tranche that has not been applied yet leaves the route untouched.
    const moves = route.Tranche <= levers.tranche;
    const flights = moves ? targetFlights(route, levers) : today;

    const ratio = today > 0 ? flights / today : 0;
    // A route being exited loses its revenue with its flights. So does any cut
    // taken past the plan, which is an exit by another name - but it is taken
    // from the plan's revenue rather than recomputed, so the curve stays
    // continuous as the slider crosses the plan.
    const level = levelFor(route, levers);
    const revenue = (() => {
      if (route.Exit) return route.NetRev * ratio;                 // rho = 1
      if (level <= 1 || levers.mode === 'manual') {
        const rho = ratio < 1 ? levers.rhoDown : levers.rhoUp;
        return route.NetRev * (1 + rho * (ratio - 1));
      }
      const planFlights = targetFlights(route, { ...levers, phase: 1, restoreLevel: 1, decideLevel: 1 });
      const planRatio = today > 0 ? planFlights / today : 0;
      const atPlan = route.NetRev * (1 + levers.rhoDown * (planRatio - 1));
      return planFlights > 0 ? atPlan * (flights / planFlights) : 0;
    })();
    // The share of revenue that actually left with the flights, which is what
    // the connecting feed and the ticket count have to follow.
    const rho = ratio < 1 ? (1 - revenue / route.NetRev) / (1 - ratio)
      : ratio > 1 ? levers.rhoUp : 0;
    const crewPerFlight = today > 0 ? route.Crew / today : 0;
    const cost = flights * route.CostPerFlight
      + (1 - levers.crewShed) * Math.max(0, today - flights) * crewPerFlight;
    const fareGain = route.Cohort === 'Protect' ? route.TicketRev * uplift : 0;
    // Cutting a route also costs the feed it hands to the stable network.
    const feedLoss = route.Exit ? 0 : route.FeedToStableRev * rho * (1 - ratio);
    const tickets = route.NetRev > 0 ? route.Tickets * (revenue / route.NetRev) : 0;
    const breakEven = route.AvgFare > 0 ? route.CostPerFlight / route.AvgFare : 0;
    const ticketsPerFlight = flights > 0 ? tickets / flights : 0;

    return {
      route, flights, revenue, cost, fareGain, feedLoss, tickets,
      contribution: revenue + fareGain - cost,
      ticketsPerFlight, breakEvenTicketsPerFlight: breakEven,
      underFilled: flights > 0 && ticketsPerFlight < breakEven,
    };
  });

  const sum = (pick: (r: RouteResult) => number) => byRoute.reduce((a, r) => a + pick(r), 0);
  const revenue = sum(r => r.revenue);
  const fareGain = sum(r => r.fareGain);
  const feedLoss = sum(r => r.feedLoss);
  const cost = sum(r => r.cost);
  const contribution = sum(r => r.contribution) - feedLoss;
  const gates = (levers.gates === 'actual' ? constants.gatesActual : constants.gatesForecast)
    - (levers.releaseIdleGates ? constants.idleGatesReleasable : 0);
  const profit = contribution - gates;
  const netRevenue = revenue + fareGain - feedLoss;
  const target = (levers.targetMarginPct / 100) * constants.netRevenueToday;

  const byCohort = Object.fromEntries(COHORTS.map(cohort => {
    const rows = byRoute.filter(r => r.route.Cohort === cohort);
    const add = (pick: (r: RouteResult) => number) => rows.reduce((a, r) => a + pick(r), 0);
    return [cohort, {
      flights: add(r => r.flights), revenue: add(r => r.revenue + r.fareGain),
      cost: add(r => r.cost), contribution: add(r => r.contribution),
    }];
  })) as Scenario['byCohort'];

  return {
    byRoute, flights: sum(r => r.flights), revenue, cost, fareGain, feedLoss,
    contribution, gates, profit, margin: netRevenue !== 0 ? profit / netRevenue : 0,
    gapToBreakeven: Math.max(0, -profit), gapToTarget: target - profit, target,
    byCohort,
  };
}

/** Today: every lever neutral. The visual reference for every other number. */
export const TODAY_LEVERS: Levers = {
  ...DEFAULT_LEVERS, phase: 0, tranche: -1, seasonal: false,
  restoreLevel: 0, decideLevel: 0,
};

/** The levels the recommended plan sits at, for the UI's slider marks. */
export const PLAN_LEVEL = 1;

/**
 * Protect fare increase that closes a gap, solving
 * B·((1+p)(1+e·p) − 1) = gap. Returns null when fares alone cannot reach it.
 */
export function requiredFarePct(gap: number, elasticity: number, protectTicketRev: number) {
  if (gap <= 0) return 0;
  const B = protectTicketRev;
  if (B <= 0) return null;
  if (elasticity === 0) return (gap / B) * 100;
  if (elasticity <= -1) return null;
  const disc = (1 + elasticity) ** 2 + (4 * elasticity * gap) / B;
  if (disc < 0) return null;
  const p = (-(1 + elasticity) + Math.sqrt(disc)) / (2 * elasticity);
  return p > 0 ? p * 100 : null;
}

/**
 * How far revenue can fall before the scenario drops below breakeven. Profit is
 * linear in rhoDown, so two evaluations locate the crossing exactly.
 */
export function breakevenRhoDown(levers: Levers) {
  const at0 = scenario({ ...levers, rhoDown: 0 }).profit;
  const at1 = scenario({ ...levers, rhoDown: 1 }).profit;
  if (at0 === at1) return null;
  const rho = at0 / (at0 - at1);
  return rho >= 0 && rho <= 1 ? rho : null;
}

export const protectTicketRevenue = routes
  .filter(r => r.Cohort === 'Protect')
  .reduce((a, r) => a + r.TicketRev, 0);
