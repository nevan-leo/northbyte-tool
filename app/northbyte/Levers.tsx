'use client';

import { useMemo } from 'react';
import {
  scenario, recipe, routes, constants, presets, requiredFarePct,
  protectTicketRevenue, type Levers, type Scenario,
} from './model';

// The four solutions from the deck, each labelled in the unit the airline
// actually operates in - flights a week, dollars a ticket - rather than in the
// model's internal levels. Every figure here is computed from the route data.

import { money, signed } from './format';

const M = 1_000_000;
const WEEKS = 52;

const RESTORE = routes.filter(r => r.Cohort === 'Restore');
const PROTECT = routes.filter(r => r.Cohort === 'Protect');

/** Pre-expansion frequency, annualised from the Sep 2024 - Feb 2025 half year. */
const preExpansion = (route: { Flights_PreSepFeb: number }) => route.Flights_PreSepFeb * 2;
const PROTECT_TICKETS = PROTECT.reduce((a, r) => a + r.Tickets, 0);
const PROTECT_FARE = PROTECT.reduce((a, r) => a + r.TicketRev, 0) / PROTECT_TICKETS;
// The stable routes moved their own prices by 1.9-6.4% route by route (3.5% on
// average) while flying the same schedule, so anything past that range is
// outside what the data can speak to.
const FARE_EVIDENCE_CEILING = 6.4;
const FARE_MAX = 10;

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
  { value: -0.5, name: 'Half', note: 'illustrative' },
  { value: -0.88, name: 'National average, −0.88', note: 'IATA/InterVISTAS' },
  { value: -1.54, name: 'Route level, −1.54', note: 'IATA/InterVISTAS' },
] as const;

export default function LeverPanel({ section, levers, set, result, onNothing, onPlan,
                                     drifting, atPlan, animating }: {
  section: 'solutions' | 'breakeven' | 'rail';
  levers: Levers;
  set: <K extends keyof Levers>(key: K, value: Levers[K]) => void;
  result: Scenario;
  onNothing: () => void;
  onPlan: () => void;
  drifting: boolean;
  atPlan: boolean;
  animating: boolean;
}) {
  const flightsOf = (code: string) =>
    result.byRoute.find(r => r.route.Route === code)?.flights ?? 0;
  const cohortFlights = (cohort: 'Restore' | 'Decide') => result.byRoute
    .filter(r => r.route.Cohort === cohort)
    .reduce((a, r) => a + r.flights, 0);

  const extraLive = (cohortFlights('Restore')
    - RESTORE.reduce((a, r) => a + preExpansion(r), 0)) / WEEKS;
  const decideLive = cohortFlights('Decide') / WEEKS;
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
  const stack = Math.max(...plan.steps.map(s => Math.abs(s.value)), 1);
  const fareToBreakeven = requiredFarePct(result.gapToBreakeven, levers.elasticity, protectTicketRevenue);

  const axis = Math.max(1, ...Object.values(impacts)
    .flatMap(i => [Math.abs(i.value), Math.abs(i.low), Math.abs(i.high)]));

  if (section === 'solutions') return <div className={`solutionRow ${animating ? 'animating' : ''}`}>
    <div className="solutionRowHead">
      <div className="sectionhead"><span>Our four solutions</span></div>
      <div className="filterrow stateButtons">
        <button className={`pill ${drifting ? 'active' : ''}`} onClick={onNothing}>Do nothing</button>
        <button className={`pill ${atPlan ? 'active' : ''}`} onClick={onPlan}>Our plan</button>
      </div>
    </div>

    <Solution n={1} title="Roll back the doubled routes"
              impact={impacts.rollback} axis={axis}
              readout={<>{extraLive.toFixed(0)} extra flights a week</>}>
      <Track label="Extra flights a week, against before the expansion"
             value={levers.restoreLevel * 100} min={0} max={100} marks={[{ at: 0, label: 'Today' }, { at: 100, label: 'Our plan' }]}
             onChange={v => set('restoreLevel', v / 100)} />
      <p className="line">Montréal–Vancouver {(flightsOf('YUL-YVR') / WEEKS).toFixed(1)} a week each way</p>
    </Solution>

    <Solution n={2} title="Raise fares on the stable routes"
              impact={impacts.fares} axis={axis}
              readout={<>${(PROTECT_FARE + farePerTicket).toFixed(0)} a ticket
                <small>+${farePerTicket.toFixed(0)}, {levers.farePct.toFixed(2)}%</small></>}>
      <Track label={`Average ticket price, $${PROTECT_FARE.toFixed(0)} today`}
             value={levers.farePct} min={0} max={FARE_MAX} step={0.05}
             marks={[{ at: 0, label: 'Today' },
                     { at: presets.costPassThroughFarePct, label: 'Our plan' }]}
             shadeFrom={FARE_EVIDENCE_CEILING}
             shadeTitle="Beyond what the data shows: the stable routes moved their own prices by 1.9–6.4% route by route, 3.5% on average"
             onChange={v => set('farePct', v)} />
      {levers.farePct > FARE_EVIDENCE_CEILING &&
        <p className="line warn">Beyond what the data shows — the stable routes moved their own prices by 1.9–6.4%, 3.5% on average.</p>}
    </Solution>

    <Solution n={3} title="Fly the new routes less"
              impact={impacts.decide} axis={axis}
              readout={<>{decideLive.toFixed(0)} flights a week</>}>
      <Track label="Flights a week on the 6 routes"
             value={levers.decideLevel * 50} min={0} max={100}
             marks={[{ at: 0, label: 'Today' }, { at: 50, label: 'Our plan' }, { at: 100, label: 'All exited' }]}
             onChange={v => set('decideLevel', v / 50)} />
      <p className="line" title="London and Moncton are reduced until each flight needs about 10 tickets to break even">
        London {(flightsOf('YYZ-YXU') / WEEKS).toFixed(1)} · Moncton {(flightsOf('YHZ-YQM') / WEEKS).toFixed(1)} ·
        Ottawa–Montréal {(flightsOf('YOW-YUL') / WEEKS).toFixed(1)} a week each way
      </p>
    </Solution>

    <Solution n={4} title="Hand back the idle gates"
              impact={impacts.gates} axis={axis}
              readout={levers.releaseIdleGates
                ? <>Saves {money(constants.idleGatesReleasable)} a year</>
                : <>Held<small>no saving</small></>}>
      <label className="toggle">
        <input type="checkbox" checked={levers.releaseIdleGates}
               onChange={e => set('releaseIdleGates', e.target.checked)} />
        <span>At the January renewal</span>
      </label>
    </Solution>
  </div>;

  if (section === 'breakeven') return <section className="breakevenBox">
      <div className="sectionhead stacked"><span>How we break even</span>
        <small>At the assumptions selected</small></div>

      <p className="landsNow">
        <b className={result.profit < 0 ? 'neg' : 'pos'}>{money(result.profit)}</b>
        <span>{result.profit < 0 ? `${money(-result.profit)} short` : `${money(result.profit)} clear`}</span>
      </p>

      <ol className="recipe">
        {plan.steps.map(step => (
          <li key={step.label} className={step.value < 0.05 * M ? 'idle' : ''}>
            <span className="recipeBar">
              <i style={{ width: `${(Math.abs(step.value) / stack) * 100}%` }}
                 className={step.value < 0 ? 'neg' : ''} />
            </span>
            <span className="recipeLabel">{step.label}</span>
            <b className={step.value < 0 ? 'neg' : ''}>{signed(step.value)}</b>
          </li>
        ))}
        <li className="recipeTotal">
          <span className="recipeBar" />
          <span className="recipeLabel">All four together</span>
          <b className={plan.breaksEven ? 'pos' : 'neg'}>{money(plan.profit)}</b>
        </li>
      </ol>

      <p className="note">
        {plan.bestFarePct < 0.01
          ? <>At this price response, fares lose more in tickets than they earn. Leave them alone.</>
          : <>Fares earn most at <b>{plan.bestFarePct.toFixed(1)}%</b>
              {plan.bestFarePct >= FARE_EVIDENCE_CEILING ? ', the top of the evidence' : ', past which they cost more than they earn'}.</>}
      </p>

      <p className="note">
        {plan.breaksEven
          ? <>All four, pulled fully: <b>{money(plan.profit)}</b>.{' '}
              {plan.short > 0.05 * M
                ? <>The {constants.targetMarginPct.toFixed(1)}% target is {money(plan.short)} beyond them.</>
                : <>Clears the {constants.targetMarginPct.toFixed(1)}% target.</>}</>
          : <>All four, pulled fully: <b>{money(plan.profit)}</b>. Break even is out of reach here
              {fareToBreakeven !== null && <>; fares alone would need {fareToBreakeven.toFixed(0)}%</>}.</>}
      </p>
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
      <p className="note">Route level applies if rivals don&apos;t match our fares.</p>
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
      <Track label={`Sustainable target margin ${levers.targetMarginPct.toFixed(1)}%`}
             value={levers.targetMarginPct} min={0} max={10} step={0.1}
             onChange={v => set('targetMarginPct', v)} />
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

function Solution({ n, title, impact, axis, readout, children }: {
  n: number; title: string; axis: number;
  impact: { value: number; low: number; high: number };
  readout: React.ReactNode; children: React.ReactNode;
}) {
  const width = (v: number) => `${(Math.abs(v) / axis) * 100}%`;
  const banded = Math.abs(impact.high - impact.low) > 0.05 * M;
  return <section className="pillar solution">
    <h3><span>{n}</span>{title}</h3>
    <div className="solutionHead">
      <p className="readout">{readout}</p>
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

function Track({ label, value, min, max, step = 1, marks = [], shadeFrom, shadeTitle, onChange }: {
  label: string; value: number; min: number; max: number; step?: number;
  marks?: { at: number; label: string }[];
  shadeFrom?: number; shadeTitle?: string;
  onChange: (v: number) => void;
}) {
  const place = (v: number) => ((v - min) / (max - min)) * 100;
  const progress = place(value);
  return <label className="slider leverTrack">
    <span className="trackLabel">{label}</span>
    <span className="trackRail">
      {shadeFrom !== undefined &&
        <i className="trackShade" style={{ left: `${place(shadeFrom)}%`, width: `${100 - place(shadeFrom)}%` }}
           title={shadeTitle} />}
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
