'use client';

import { useCallback, useMemo, useRef } from 'react';
import {
  scenario, recipe, contributions, routes, constants, presets,
  type Levers, type Scenario, type Route,
} from './model';

// The four solutions from the deck, each labelled in the unit the airline
// actually operates in - flights a week, dollars a ticket - rather than in the
// model's internal levels. Every figure here is computed from the route data.

import { signed } from './format';

const M = 1_000_000;
const WEEKS = 52;

const RESTORE = routes.filter(r => r.Cohort === 'Restore');
const NEW_ROUTES = routes.filter(r => r.Cohort === 'Decide');
const PROTECT = routes.filter(r => r.Cohort === 'Protect');

/** Pre-expansion frequency, annualised from the Sep 2024 - Feb 2025 half year. */
const preExpansion = (route: { Flights_PreSepFeb: number }) => route.Flights_PreSepFeb * 2;
const PROTECT_TICKETS = PROTECT.reduce((a, r) => a + r.Tickets, 0);
const PROTECT_FARE = PROTECT.reduce((a, r) => a + r.TicketRev, 0) / PROTECT_TICKETS;
// The stable routes moved their own prices by 1.9-6.4% route by route (3.5% on
// average) while flying the same schedule, so anything past that range is
// outside what the data can speak to.
const FARE_EVIDENCE_CEILING = 6.4;

export const RHO_SCENARIOS = [
  { key: 'High', rho: presets.rhoDown.High, name: 'Demand holds',
    note: 'revenue behaves as it did when flights were added' },
  { key: 'Mid', rho: presets.rhoDown.Mid, name: 'Same tickets per flight as before the expansion',
    note: '' },
  { key: 'Low', rho: presets.rhoDown.Low, name: 'Revenue leaves with the flights',
    note: 'a stress case' },
] as const;

export const ELASTICITIES = [
  { value: 0, name: 'No response', note: 'our data, one year' },
  { value: -0.88, name: 'National average, −0.88', note: 'IATA/InterVISTAS' },
  { value: -1.54, name: 'Route level, −1.54', note: 'IATA/InterVISTAS' },
] as const;

export default function LeverPanel({ section, levers, set, result, animating, onFocus }: {
  section: 'solutions' | 'breakeven' | 'rail';
  levers: Levers;
  set: <K extends keyof Levers>(key: K, value: Levers[K]) => void;
  result: Scenario;
  animating: boolean;
  /** Which cohort the hand is on, so the map can bring it forward. */
  onFocus?: (cohort: Route['Cohort'] | null) => void;
}) {
  // Hovering or dragging a lever focuses its cohort on the map; letting go
  // restores the whole network a beat later, so a slip of the mouse between two
  // cards does not flash the map.
  const release = useRef<number | undefined>(undefined);
  const hold = useCallback((cohort: Route['Cohort']) => {
    window.clearTimeout(release.current);
    onFocus?.(cohort);
  }, [onFocus]);
  const letGo = useCallback(() => {
    window.clearTimeout(release.current);
    release.current = window.setTimeout(() => onFocus?.(null), 400);
  }, [onFocus]);

  const flightsOf = (code: string) =>
    result.byRoute.find(r => r.route.Route === code)?.flights ?? 0;
  const cohortFlights = (cohort: 'Restore' | 'Decide') => result.byRoute
    .filter(r => r.route.Cohort === cohort)
    .reduce((a, r) => a + r.flights, 0);

  const extraToday = RESTORE.reduce((a, r) => a + r.Flights_FY2526 - preExpansion(r), 0) / WEEKS;
  const extraLive = (cohortFlights('Restore')
    - RESTORE.reduce((a, r) => a + preExpansion(r), 0)) / WEEKS;
  const extraAtPlan = RESTORE.reduce(
    (a, r) => a + r.PlanFlights * (levers.seasonal ? constants.seasonalFactor : 1)
             - preExpansion(r), 0) / WEEKS;
  const newToday = NEW_ROUTES.reduce((a, r) => a + r.Flights_FY2526, 0) / WEEKS;
  const newAtPlan = NEW_ROUTES.reduce((a, r) => a + r.PlanFlights, 0) / WEEKS;
  const decideLive = cohortFlights('Decide') / WEEKS;
  const cut = (from: number, to: number) => Math.max(0, from - to);
  const flightsCut = cut(extraToday, extraLive);
  const newRoutesCut = cut(newToday, decideLive);
  const farePerTicket = PROTECT_FARE * (levers.farePct / 100);

  // Each lever measured on its own: the model re-run with that lever alone.
  const impacts = useMemo(() => {
    const alone = (patch: Partial<Levers>) => scenario({
      ...levers, mode: 'preset', phase: 1, tranche: 4,
      restoreLevel: 0, decideLevel: 0, farePct: 0, releaseIdleGates: false,
      ...patch,
    }).profit;
    const base = alone({});
    const band = (patch: Partial<Levers>, variants: Partial<Levers>[]) => {
      const values = variants.map(v => alone({ ...patch, ...v }) - base);
      return { low: Math.min(...values), high: Math.max(...values) };
    };
    const rhoEnds = [{ rhoDown: presets.rhoDown.High }, { rhoDown: presets.rhoDown.Low }];
    return {
      rollback: { value: alone({ restoreLevel: levers.restoreLevel }) - base,
                  ...band({ restoreLevel: levers.restoreLevel }, rhoEnds) },
      fares: { value: alone({ farePct: levers.farePct }) - base,
               ...band({ farePct: levers.farePct }, ELASTICITIES.map(e => ({ elasticity: e.value }))) },
      decide: { value: alone({ decideLevel: levers.decideLevel }) - base,
                ...band({ decideLevel: levers.decideLevel }, rhoEnds) },
      gates: { value: alone({ releaseIdleGates: levers.releaseIdleGates }) - base,
               low: 0, high: 0 },
    };
  }, [levers]);

  const plan = useMemo(() => recipe(levers, FARE_EVIDENCE_CEILING), [levers]);

  // Each bar is a share of what its own lever is worth pulled all the way, so
  // the bar fills exactly when the slider does. The dollars beside it stay
  // comparable between cards; the bar answers "how much of this lever is left".
  const full = (i: number) => Math.max(1, Math.abs(plan.steps[i].value));
  // The list is what the levers are doing now, not what they could do: the four
  // steps add up to the turnaround the headline figure is standing on. The bar
  // and the percentage are the same quantity - each lever's share of that
  // turnaround - so the drawing cannot say one thing and the number another.
  const live = useMemo(() => contributions(levers), [levers]);
  // Measured against the gap we start from, not against each other. A share of
  // the four would have to divide by a total that is itself collapsing as the
  // levers come off, so every bar held its width and then vanished at the end.
  // Against a fixed gap each bar simply slides down to nothing.
  const gap = Math.max(Math.abs(live.nothing), 1);
  const shareOf = (v: number) => (v / gap) * 100;
  // A floor of 2% so a real $0.4M still draws something rather than nothing.
  const barWidth = (v: number) => {
    const share = Math.abs(shareOf(v));
    // Under a tenth of a point draws nothing; above it, a floor of 2% so a real
    // $0.4M is visible, eased in so the bar grows into the floor.
    return `${share < 0.1 ? 0 : Math.min(100, Math.max(2 * Math.min(1, share / 0.6), share))}%`;
  };

  if (section === 'solutions') return <div className={`solutionRow ${animating ? 'animating' : ''}`}>
    <Solution n={1} title="Roll back the doubled routes"
              impact={impacts.rollback} axis={full(0)}
              headline={flightsCut < 0.5 ? 'No change' : `Cut ${flightsCut.toFixed(0)} flights a week`}
              sub={flightsCut < 0.5
                ? `${extraToday.toFixed(0)} extra flights a week today`
                : `From ${extraToday.toFixed(0)} extra flights a week to ${extraLive.toFixed(0)}`}>
      <Track label="Extra flights still flying on the 10 doubled routes, against before the expansion"
             value={levers.restoreLevel * 100} min={0} max={100} marks={[{ at: 0, label: 'Today' }, { at: 100, label: 'Our plan' }]}
             onChange={v => set('restoreLevel', v / 100)}
             onHold={() => hold('Restore')} onLetGo={letGo} />
      <p className="line" title={`The plan leaves about ${extraAtPlan.toFixed(0)} extra flights a week because of the ${constants.seasonalFactor} seasonal allowance`}>
        Montréal–Vancouver {(flightsOf('YUL-YVR') / WEEKS).toFixed(1)} a week each way ·
        plan keeps {extraAtPlan.toFixed(0)} for seasonality
      </p>
    </Solution>

    <Solution n={2} title="Raise fares on the stable routes"
              impact={impacts.fares} axis={full(3)}
              headline={levers.farePct < 0.01 ? 'No change' : `Raise tickets $${farePerTicket.toFixed(0)}`}
              sub={levers.farePct < 0.01
                ? `$${PROTECT_FARE.toFixed(0)} a ticket today`
                : `$${PROTECT_FARE.toFixed(0)} to $${(PROTECT_FARE + farePerTicket).toFixed(0)} (+${levers.farePct.toFixed(2)}%)`}>
      <Track label={`Average ticket price, $${PROTECT_FARE.toFixed(0)} today`}
             value={levers.farePct} min={0} max={FARE_EVIDENCE_CEILING} step={0.05}
             marks={[{ at: 0, label: 'Today' },
                     { at: presets.costPassThroughFarePct, label: 'Our plan' },
                     { at: FARE_EVIDENCE_CEILING, label: 'Top of the evidence' }]}
             onChange={v => set('farePct', v)}
             onHold={() => hold('Protect')} onLetGo={letGo} />
      <p className="line">The stable routes moved their own prices by 1.9–6.4% last year, 3.5% on average.</p>
    </Solution>

    <Solution n={3} title="Fly the new routes less"
              impact={impacts.decide} axis={full(1)}
              headline={newRoutesCut < 0.5 ? 'No change' : `Cut ${newRoutesCut.toFixed(0)} flights a week`}
              sub={newRoutesCut < 0.5
                ? `${newToday.toFixed(0)} flights a week today`
                : decideLive < 0.5
                  ? `From ${newToday.toFixed(0)} a week to none`
                  : `From ${newToday.toFixed(0)} a week to ${decideLive.toFixed(0)}`}>
      <Track label="Flights a week still flying on the 6 new routes"
             value={levers.decideLevel * 50} min={0} max={100}
             marks={[{ at: 0, label: 'Today' }, { at: 50, label: `Our plan, ${newAtPlan.toFixed(0)}` },
                     { at: 100, label: 'All exited' }]}
             onChange={v => set('decideLevel', v / 50)}
             onHold={() => hold('Decide')} onLetGo={letGo} />
      <p className="line" title="London and Moncton are reduced until each flight needs about 10 tickets to break even">
        London {(flightsOf('YYZ-YXU') / WEEKS).toFixed(1)} · Moncton {(flightsOf('YHZ-YQM') / WEEKS).toFixed(1)} ·
        Ottawa–Montréal {(flightsOf('YOW-YUL') / WEEKS).toFixed(1)} a week each way
      </p>
    </Solution>

    <Solution n={4} title="Close both idle gates"
              impact={impacts.gates} axis={full(2)}
              control={<label className="toggle switch">
                <input type="checkbox" checked={levers.releaseIdleGates}
                       aria-label="Close the two idle gates at the January renewal"
                       onChange={e => set('releaseIdleGates', e.target.checked)} />
              </label>} />
  </div>;

  if (section === 'breakeven') return <section className="breakevenBox">
      <ol className="recipe">
        {live.steps.map(step => (
          <li key={step.label} className={step.value < 0.05 * M ? 'idle' : ''}>
            <span className="recipeBar">
              <i style={{ width: barWidth(step.value) }} className={step.value < 0 ? 'neg' : ''} />
            </span>
            <span className="recipeLabel">{step.label}</span>
            <b className={step.value < 0 ? 'neg' : ''}>{signed(step.value)}</b>
            <u>{Math.abs(step.value) < 0.05 * M ? '—'
              : `${Math.round(shareOf(step.value))}% of the gap`}</u>
          </li>
        ))}
      </ol>

  </section>;

  return <aside className="rail">
    <section className="pillar selectors">
      <h3>If we cut flights</h3>
      <div className="choiceList">
        {RHO_SCENARIOS.map(option => (
          <button key={option.key} className={`choice ${levers.rhoDown === option.rho ? 'on' : ''}`}
                  onClick={() => set('rhoDown', option.rho)}>
            <b>{option.name}</b>{option.note && <small>{option.note}</small>}
          </button>
        ))}
      </div>

      <h3 className="second">If we raise prices</h3>
      <div className="choiceList">
        {ELASTICITIES.map(option => (
          <button key={option.value} className={`choice ${levers.elasticity === option.value ? 'on' : ''}`}
                  onClick={() => set('elasticity', option.value)}>
            <b>{option.name}</b>{option.note && <small>{option.note}</small>}
          </button>
        ))}
      </div>
    </section>

    <details className="advanced">
      <summary>For Q&amp;A</summary>
      <Track label={`Crew cost shed ${Math.round(levers.crewShed * 100)}%`}
             value={levers.crewShed * 100} min={0} max={100}
             onChange={v => set('crewShed', v / 100)} />
      <label className="toggle">
        <input type="checkbox" checked={levers.gates === 'forecast'}
               onChange={e => set('gates', e.target.checked ? 'forecast' : 'actual')} />
        <span>Price gates at the 2026-27 forecast</span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={levers.seasonal}
               onChange={e => set('seasonal', e.target.checked)} />
        <span>Seasonal baseline on the rollback (×{constants.seasonalFactor})</span>
      </label>
    </details>

  </aside>;
}

function Solution({ n, title, impact, axis, headline, sub, control, children }: {
  n: number; title: string; axis: number;
  impact: { value: number; low: number; high: number };
  headline?: string; sub?: string;
  /** A switch that sits on the title line, for a lever with nothing to drag. */
  control?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const width = (v: number) => `${Math.min(100, (Math.abs(v) / axis) * 100)}%`;
  const banded = Math.abs(impact.high - impact.low) > 0.05 * M;
  return <section className={`pillar solution ${control ? 'switched' : ''}`}>
    <h3><span>{n}</span>{title}{control}</h3>
    <div className="solutionHead">
      {headline && <p className="readout">{headline}<small>{sub}</small></p>}
      <div className="impact" title={`${signed(impact.value)} measured on its own`}>
        <span className="impactTrack">
          {banded && <i className="impactBand"
             style={{ left: width(Math.min(impact.low, 0)), width: width(impact.high - impact.low) }} />}
          <i className={`impactBar ${impact.value < 0 ? 'neg' : ''}`} style={{ width: width(impact.value) }} />
        </span>
        <b className={impact.value < 0 ? 'neg' : ''}>{signed(impact.value)}</b>
      </div>
    </div>
    {children}
  </section>;
}

function Track({ label, value, min, max, step = 1, marks = [], onChange, onHold, onLetGo }: {
  label: string; value: number; min: number; max: number; step?: number;
  marks?: { at: number; label: string }[];
  onChange: (v: number) => void;
  onHold?: () => void;
  onLetGo?: () => void;
}) {
  const place = (v: number) => ((v - min) / (max - min)) * 100;
  const progress = place(value);
  return <label className="slider leverTrack"
                onPointerEnter={onHold} onPointerDown={onHold}
                onPointerLeave={onLetGo} onPointerUp={onLetGo}>
    <span className="trackLabel">{label}</span>
    <span className="trackRail">
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value}
             style={{ background: `linear-gradient(90deg, var(--ink) ${progress}%, var(--line) ${progress}%)` }}
             onChange={e => onChange(Number(e.target.value))} />
    </span>
    {marks.length > 0 && <span className="marks">
      {marks.map(mark => (
        <i key={mark.label} style={{ left: `${place(mark.at)}%` }}>{mark.label}</i>
      ))}
    </span>}
  </label>;
}
