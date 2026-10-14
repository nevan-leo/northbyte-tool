'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Figure } from './Figure';
import {
  scenario, routes, COHORTS, requiredFarePct,
  protectTicketRevenue, type Levers, type Cohort, type Scenario,
} from './model';

// Everything a judge asks to see behind the headline: the bridge from today to
// the scenario, the readouts, the cohort and route tables, and what is
// assumption rather than measurement. Carried across from the single-file
// version unchanged.

const M = 1_000_000;
const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v / M).toFixed(1)}M`;
const count = (v: number) => Math.round(v).toLocaleString('en-US');
const pct = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;
const sign = (v: number) => (v < 0 ? 'neg' : v > 0 ? 'pos' : '');
const COHORT_NAME: Record<Cohort, string> = {
  Restore: 'Doubled routes', Decide: 'New routes', Protect: 'Stable routes',
};

export default function EvidenceView({ levers, result, today }:
    { levers: Levers; result: Scenario; today: Scenario }) {
  const [cohortFilter, setCohortFilter] = useState<'All' | Cohort>('All');
  type SortKey = 'contribution' | 'delta' | 'flights';
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'contribution', dir: 1 });
  const toggleSort = (key: SortKey) =>
    setSort(current => ({ key, dir: current.key === key ? (current.dir === 1 ? -1 : 1) : 1 }));

  // The rollback's own worst case answers the question a break-even rho was
  // gesturing at: it still earns this much even at rho = 1.
  const rollbackAtWorst = useMemo(() => {
    const floor: Levers = { ...levers, mode: 'preset', phase: 1, tranche: 4,
      restoreLevel: 0, decideLevel: 0, farePct: 0, releaseIdleGates: false, rhoDown: 1 };
    return scenario({ ...floor, restoreLevel: 1 }).profit - scenario(floor).profit;
  }, [levers]);
  const stable = routes.filter(r => r.Cohort === 'Protect');
  const stableTicketsPerFlight = stable.reduce((a, r) => a + r.Tickets, 0)
    / stable.reduce((a, r) => a + r.Flights_FY2526, 0);
  const stableBreakEven = stable.reduce((a, r) => a + r.CostPerFlight / r.AvgFare, 0) / stable.length;
  const fareForBreakeven = requiredFarePct(result.gapToBreakeven, levers.elasticity, protectTicketRevenue);
  const fareForTarget = requiredFarePct(Math.max(0, result.gapToTarget), levers.elasticity, protectTicketRevenue);

  const steps = useMemo(() => {
    const cohortStep = (cohort: Cohort) => {
      const fare = result.byRoute
        .filter(r => r.route.Cohort === cohort)
        .reduce((a, r) => a + r.fareGain, 0);
      return result.byCohort[cohort].contribution - fare - today.byCohort[cohort].contribution;
    };
    return [
      { label: 'Rollback', value: cohortStep('Restore') },
      { label: 'New routes', value: cohortStep('Decide') },
      { label: 'Stable routes', value: cohortStep('Protect') },
      { label: 'Lost connection feed', value: -result.feedLoss },
      { label: 'Fares', value: result.fareGain },
      { label: 'Gates', value: today.gates - result.gates },
    ].filter(s => Math.abs(s.value) > 1000);
  }, [result, today]);

  const tableRows = useMemo(() => {
    const rows = result.byRoute
      .map((r, i) => ({ ...r, todayRow: today.byRoute[i] }))
      .filter(r => cohortFilter === 'All' || r.route.Cohort === cohortFilter);
    const key = (r: typeof rows[number]) =>
      sort.key === 'contribution' ? r.contribution
        : sort.key === 'flights' ? r.flights
        : r.contribution - r.todayRow.contribution;
    return rows.sort((a, b) => (key(a) - key(b)) * sort.dir);
  }, [result, today, cohortFilter, sort]);

  const sortProps = (key: SortKey) => ({
    className: 'sortable',
    onClick: () => toggleSort(key),
    'aria-sort': (sort.key === key
      ? (sort.dir === 1 ? 'ascending' : 'descending')
      : undefined) as 'ascending' | 'descending' | undefined,
  });
  const arrow = (key: SortKey) => sort.key !== key ? null
    : sort.dir === 1 ? <ArrowUp size={11} aria-hidden className="sortIcon" />
    : <ArrowDown size={11} aria-hidden className="sortIcon" />;

  return <div className="nbMain dataView viewFade">
    <div className="kpiStrip">
      <Kpi label="Flights" value={result.flights} format={count} today={count(today.flights)} />
      <Kpi label="Net revenue" value={result.revenue + result.fareGain - result.feedLoss} format={money} today={money(today.revenue)} />
      <Kpi label="Operating cost" value={result.cost} format={money} today={money(today.cost)} />
      <Kpi label="Contribution" value={result.contribution} format={money} today={money(today.contribution)} tone={sign(result.contribution)} />
      <Kpi label="Gates" value={result.gates} format={money} today={money(today.gates)} />
      <Kpi label="Margin" value={result.margin * 100} format={pct} today={pct(today.margin * 100)} tone={sign(result.margin)} />
      <Kpi label={`Left to the ${levers.targetMarginPct.toFixed(1)}% target`}
           value={result.gapToTarget} format={v => v > 0.05 ? money(v) : 'cleared'}
           today={money(today.target - today.profit)} tone={result.gapToTarget > 0 ? 'neg' : 'pos'} />
    </div>

      <div className="panel">
          <div className="sectionhead"><span>From today to this scenario</span>
            <small>PROFIT AFTER GATES</small></div>
          <Waterfall start={today.profit} end={result.profit} steps={steps} />
      </div>

        <div className="panel readouts">
          <div className="sectionhead"><span>Readouts</span></div>
          <div className="readoutGrid">
            <div>
              <small>Fares needed on the stable routes</small>
              <b>{result.gapToBreakeven <= 0.05 ? 'none, break even is covered'
                : fareForBreakeven === null ? 'not reachable by fares'
                : `${fareForBreakeven.toFixed(2)}% to break even`}</b>
              <span>
                {result.gapToTarget > 0.05 && fareForTarget !== null
                  ? `${fareForTarget.toFixed(2)}% to reach the ${levers.targetMarginPct.toFixed(1)}% target`
                  : `on ${money(protectTicketRevenue)} of stable ticket revenue`}
              </span>
            </div>
            <div>
              <small>If revenue leaves with the flights</small>
              <b className={rollbackAtWorst > 0 ? 'pos' : 'neg'}>{money(rollbackAtWorst)}</b>
              <span>the rollback still earns this at ρ = 1, its own worst case</span>
            </div>
            <div>
              <small>Tickets per flight, stable routes</small>
              <b>{stableTicketsPerFlight.toFixed(1)}</b>
              <span>against {stableBreakEven.toFixed(1)} needed to cover a flight</span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="sectionhead"><span>By cohort</span><small>TODAY → SCENARIO</small></div>
          <div className="tableWrap">
          <table className="nbTable">
            <thead><tr><th>Cohort</th><th>Routes</th><th>Flights</th><th>Revenue</th><th>Cost</th><th>Contribution</th></tr></thead>
            <tbody>
              {COHORTS.map(cohort => {
                const name = COHORT_NAME[cohort];
                const now = today.byCohort[cohort], next = result.byCohort[cohort];
                const n = routes.filter(r => r.Cohort === cohort).length;
                return <tr key={cohort}>
                  <td><b>{name}</b></td>
                  <td>{n}</td>
                  <td>{count(now.flights)} → <b>{count(next.flights)}</b></td>
                  <td>{money(now.revenue)} → <b>{money(next.revenue)}</b></td>
                  <td>{money(now.cost)} → <b>{money(next.cost)}</b></td>
                  <td className={sign(next.contribution)}>
                    {money(now.contribution)} → <b>{money(next.contribution)}</b></td>
                </tr>;
              })}
            </tbody>
          </table>
          </div>
        </div>

        <div className="panel">
          <div className="sectionhead"><span>Every route</span>
            <div className="filterrow">
              {(['All', ...COHORTS] as const).map(c => (
                <button key={c} className={`pill ${cohortFilter === c ? 'active' : ''}`}
                        onClick={() => setCohortFilter(c)}>{c}</button>
              ))}
            </div>
          </div>
          <div className="tableScroll">
            <table className="nbTable routeTable">
              <thead><tr>
                <th>Route</th><th>Cohort</th><th>Tr.</th>
                <th {...sortProps('flights')}>Flights{arrow('flights')}</th>
                <th>Revenue</th><th>Cost</th>
                <th {...sortProps('contribution')}>Contribution{arrow('contribution')}</th>
                <th {...sortProps('delta')}>Change{arrow('delta')}</th>
                <th title="tickets per flight against the number needed to cover a flight">
                  Tickets / needed</th>
              </tr></thead>
              <tbody>
                {tableRows.map(r => {
                  const delta = r.contribution - r.todayRow.contribution;
                  return <tr key={r.route.Route}>
                    <td title={`${r.route.Dep} → ${r.route.Arr}`}><b>{r.route.Route}</b></td>
                    <td><i className={`chip ${r.route.Cohort.toLowerCase()}`} />{COHORT_NAME[r.route.Cohort]}</td>
                    <td>{r.route.Tranche || '—'}</td>
                    <td>{count(r.todayRow.flights)} → <b>{count(r.flights)}</b></td>
                    <td>{money(r.revenue + r.fareGain)}</td>
                    <td>{money(r.cost)}</td>
                    <td className={sign(r.contribution)}>{money(r.contribution)}</td>
                    <td className={sign(delta)}>{Math.abs(delta) < 50_000 ? '' : money(delta)}</td>
                    <td className={r.underFilled ? 'neg' : ''}>
                      {r.flights === 0 ? 'exited'
                        : `${r.ticketsPerFlight.toFixed(1)} / ${r.breakEvenTicketsPerFlight.toFixed(1)}`}
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>

    <div className="assumptions">
      <b>What is assumption, not measurement.</b>
      <ul>
        <li>ρ (revenue response), the fare elasticity and the {levers.targetMarginPct.toFixed(1)}% sustainable target are our assumptions. The target is NorthByte&apos;s own pre-expansion margin after gates.</li>
        <li>One year of data, a narrow range, and part of the rise was inflation, so it cannot rule out the literature elasticities.</li>
        <li>Aircraft lease costs are not in the data and are not modelled. Crew shed at 100% assumes redeployment and no severance.</li>
        <li>Tickets, not passengers: the transaction file is not a manifest. Seat counts are absent, so load factor is never shown.</li>
        <li>Every profit figure restates FY25-26 at the chosen frequency: one year re-run, not a run rate. Nothing compounds and no second year is projected.</li>
        <li>These are scenarios, not forecasts, and nothing here establishes causation.</li>
      </ul>
      <details className="advanced">
        <summary>For Q&amp;A</summary>
        <p className="note">
          ρ is a local response, measured against the expansion. Pushed to an extreme —
          grounding a whole cohort — it keeps 81% of the revenue while every cost
          disappears, which is an artefact of the assumption, not a finding.
        </p>
        <p className="note">
          Doing nothing: −$70.7M next year with flights held, −$105.1M if the expansion
          carries on. Basis: the 38 stable routes, which flew within 0.1% of the same
          schedule in both years — cost per flight +7.0% against their own fares +3.5%.
        </p>
      </details>
    </div>

    <div className="panel">
      <div className="sectionhead"><span>Seasonality</span><small>Second wave, not modelled</small></div>
      <p className="note">
        FY25-26 flew 8.4% more in Mar–Aug than Sep–Feb, and 14% fewer in Dec–Feb than
        Jun–Aug. St John&apos;s trims by the same amount as the rest of the network, so
        nothing in this data singles it out. <b>Not modelled:</b> the plan works on
        annual frequency.
      </p>
    </div>
  </div>;
}

function Kpi({ label, value, format, today, tone = '', wide = false }:
             { label: string; value: number; format: (v: number) => string;
               today: string; tone?: string; wide?: boolean }) {
  return <div className={`kpi ${wide ? 'wide' : ''}`}>
    <small>{label}</small>
    <b className={tone}><Figure value={value} format={format} /></b>
    <span>today {today}</span>
  </div>;
}

function Waterfall({ start, end, steps }:
                   { start: number; end: number; steps: { label: string; value: number }[] }) {
  type Point = { label: string; value: number; running: number; kind: 'anchor' | 'step' };
  const points: Point[] = [{ label: 'Today', value: start, running: start, kind: 'anchor' }];
  let running = start;
  for (const step of steps) {
    running += step.value;
    points.push({ label: step.label, value: step.value, running, kind: 'step' });
  }
  points.push({ label: 'Scenario', value: end, running: end, kind: 'anchor' });
  const scale = Math.max(...points.map(p => Math.abs(p.running)), Math.max(...steps.map(s => Math.abs(s.value)), 1));

  return <div className="waterfall">
    {points.map((point, index) => (
      <div key={`${point.label}-${index}`} className={`wfRow ${point.kind}`}>
        <span className="wfLabel">{point.label}</span>
        <span className="wfTrack">
          <i className={`wfBar ${point.kind === 'anchor' ? 'anchor' : sign(point.value)}`}
             style={{ width: `${Math.abs(point.kind === 'anchor' ? point.running : point.value) / scale * 100}%` }} />
        </span>
        <span className={`wfValue ${sign(point.kind === 'anchor' ? point.running : point.value)}`}>
          {point.kind === 'step' && point.value > 0 ? '+' : ''}{money(point.kind === 'anchor' ? point.running : point.value)}
        </span>
        {point.kind === 'step' && <span className="wfRunning">{money(point.running)}</span>}
      </div>
    ))}
  </div>;
}
