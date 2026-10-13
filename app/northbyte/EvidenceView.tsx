'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Figure } from './Figure';
import {
  routes, COHORTS, requiredFarePct, breakevenRhoDown,
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

export default function EvidenceView({ levers, result, today }:
    { levers: Levers; result: Scenario; today: Scenario }) {
  const [cohortFilter, setCohortFilter] = useState<'All' | Cohort>('All');
  type SortKey = 'contribution' | 'delta' | 'flights';
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'contribution', dir: 1 });
  const toggleSort = (key: SortKey) =>
    setSort(current => ({ key, dir: current.key === key ? (current.dir === 1 ? -1 : 1) : 1 }));

  const breakevenRho = useMemo(() => breakevenRhoDown(levers), [levers]);
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

  const worst = useMemo(
    () => [...result.byRoute].sort((a, b) => a.contribution - b.contribution).slice(0, 10),
    [result]);
  const worstScale = Math.max(...worst.map(r =>
    Math.max(Math.abs(r.contribution), Math.abs(today.byRoute.find(t => t.route.Route === r.route.Route)!.contribution))), 1);
  const underFilled = result.byRoute.filter(r => r.underFilled).length;

  return <div className="nbMain dataView viewFade">
    <div className="kpiStrip">
      <Kpi label="Flights" value={result.flights} format={count} today={count(today.flights)} />
      <Kpi label="Net revenue" value={result.revenue + result.fareGain - result.feedLoss} format={money} today={money(today.revenue)} />
      <Kpi label="Operating cost" value={result.cost} format={money} today={money(today.cost)} />
      <Kpi label="Contribution" value={result.contribution} format={money} today={money(today.contribution)} tone={sign(result.contribution)} />
      <Kpi label="Gates" value={result.gates} format={money} today={money(today.gates)} />
      <Kpi label="Profit after gates" value={result.profit} format={money} today={money(today.profit)} tone={sign(result.profit)} wide />
      <Kpi label="Margin" value={result.margin * 100} format={pct} today={pct(today.margin * 100)} tone={sign(result.margin)} />
      <Kpi label="Left to break even" value={result.gapToBreakeven} format={v => v > 0.05 ? money(v) : 'cleared'}
           today={money(Math.max(0, -today.profit))} tone={result.gapToBreakeven > 0 ? 'neg' : 'pos'} />
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
              <small>Protect fare rise to break even</small>
              <b>{result.gapToBreakeven <= 0 ? 'already there'
                : fareForBreakeven === null ? 'not reachable by fares alone'
                : `${fareForBreakeven.toFixed(2)}%`}</b>
              <span>on {money(protectTicketRevenue)} of stable ticket revenue</span>
            </div>
            <div>
              <small>Protect fare rise to hit target</small>
              <b>{result.gapToTarget <= 0 ? 'already there'
                : fareForTarget === null ? 'not reachable by fares alone'
                : `${fareForTarget.toFixed(2)}%`}</b>
              <span>target {money(result.target)} = {levers.targetMarginPct.toFixed(1)}% of today&apos;s revenue</span>
            </div>
            <div>
              <small>Breakeven revenue response</small>
              <b>{breakevenRho === null ? (result.profit >= 0 ? 'holds at any ρ' : 'never breaks even')
                : `ρ = ${breakevenRho.toFixed(2)}`}</b>
              <span>{breakevenRho === null ? 'within the 0–1 range'
                : `profit stays positive while under ${(breakevenRho * 100).toFixed(0)}% of flights cut flows through to revenue`}</span>
            </div>
            <div>
              <small>Routes below break-even fill</small>
              <b className={underFilled > 0 ? 'neg' : 'pos'}>{underFilled} of {result.byRoute.filter(r => r.flights > 0).length}</b>
              <span>tickets per flight under cost per flight ÷ average fare</span>
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
                const now = today.byCohort[cohort], next = result.byCohort[cohort];
                const n = routes.filter(r => r.Cohort === cohort).length;
                return <tr key={cohort}>
                  <td><b>{cohort}</b></td>
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
          <div className="sectionhead"><span>Ten worst routes</span><small>CONTRIBUTION</small></div>
          <div className="bars">
            {worst.map(r => {
              const now = today.byRoute.find(t => t.route.Route === r.route.Route)!;
              return <div key={r.route.Route} className="barRow">
                <span className="barLabel" title={`${r.route.Dep} → ${r.route.Arr}`}>{r.route.Route}</span>
                <span className="barTrack">
                  <i className={`bar ghost ${sign(now.contribution)}`}
                     style={{ width: `${Math.abs(now.contribution) / worstScale * 100}%` }} />
                  <i className={`bar ${r.route.Cohort.toLowerCase()} ${sign(r.contribution)}`}
                     style={{ width: `${Math.abs(r.contribution) / worstScale * 100}%` }} />
                </span>
                <span className={`barValue ${sign(r.contribution)}`}>{money(r.contribution)}</span>
              </div>;
            })}
          </div>
          <p className="legend">Pale bar is today, solid bar is the scenario. Colour marks the cohort:
            <i className="chip restore" /> Restore <i className="chip decide" /> Decide <i className="chip protect" /> Protect
          </p>
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
                <th>Fill</th>
              </tr></thead>
              <tbody>
                {tableRows.map(r => {
                  const delta = r.contribution - r.todayRow.contribution;
                  return <tr key={r.route.Route}>
                    <td title={`${r.route.Dep} → ${r.route.Arr}`}><b>{r.route.Route}</b></td>
                    <td><i className={`chip ${r.route.Cohort.toLowerCase()}`} />{r.route.Cohort}</td>
                    <td>{r.route.Tranche || '—'}</td>
                    <td>{count(r.todayRow.flights)} → <b>{count(r.flights)}</b></td>
                    <td>{money(r.revenue + r.fareGain)}</td>
                    <td>{money(r.cost)}</td>
                    <td className={sign(r.contribution)}>{money(r.contribution)}</td>
                    <td className={sign(delta)}>{delta === 0 ? '—' : money(delta)}</td>
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
        <li>No price response is measurable in the data: there is no price variation to measure it from.</li>
        <li>Aircraft lease costs are not in the data and are not modelled. Crew shed at 100% assumes redeployment and no severance.</li>
        <li>One ticket is treated as one passenger. Seat counts are absent, so load factor is never shown — fill is tickets per flight against the break-even count.</li>
        <li>Every profit figure restates FY25-26 at the chosen frequency: one year re-run, not a run rate. Nothing compounds and no second year is projected.</li>
        <li>These are scenarios, not forecasts, and nothing here establishes causation.</li>
      </ul>
    </div>

    <div className="panel">
      <div className="sectionhead"><span>Seasonality</span><small>Second wave, not modelled</small></div>
      <p className="note">
        The network already flies 28% fewer flights in Dec–Feb than Jun–Aug, while
        St John&apos;s holds at 87% of its summer schedule through the winter, and the
        seasonal pattern is worth optimising across the network. Neither is in the
        numbers above: the plan works on annual frequency, so a month-by-month cut
        would need a model this one does not have.
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
