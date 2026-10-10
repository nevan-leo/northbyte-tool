'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import NetworkMap from './NetworkMap';
import {
  scenario, routes, constants, presets, DEFAULT_LEVERS, TODAY_LEVERS, COHORTS,
  requiredFarePct, breakevenRhoDown, protectTicketRevenue,
  type Levers, type Cohort,
} from './model';

const M = 1_000_000;
const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v / M).toFixed(1)}M`;
const count = (v: number) => Math.round(v).toLocaleString('en-US');
const pct = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;
const sign = (v: number) => (v < 0 ? 'neg' : v > 0 ? 'pos' : '');

const PRESETS: Record<string, Levers> = {
  Today: TODAY_LEVERS,
  'Rollback only': { ...DEFAULT_LEVERS, tranche: 3, farePct: 0 },
  'Full plan': {
    ...DEFAULT_LEVERS, tranche: 4, farePct: presets.costPassThroughFarePct,
    gates: 'forecast', releaseIdleGates: true, seasonal: true,
  },
};

export default function ScenarioTool() {
  const [levers, setLevers] = useState<Levers>(PRESETS['Full plan']);
  const [tab, setTab] = useState<'scenario' | 'data'>('scenario');
  const [cohortFilter, setCohortFilter] = useState<'All' | Cohort>('All');
  const MONTHS = 24, PLAN_STEP = MONTHS;
  // Opens on the latest month actually flown: the map answers "where are we
  // now" before it answers "what would the plan do".
  const [step, setStep] = useState(MONTHS - 1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(
      () => setStep(current => (current >= PLAN_STEP ? 0 : current + 1)), 650);
    return () => window.clearInterval(id);
  }, [playing, PLAN_STEP]);
  type SortKey = 'contribution' | 'delta' | 'flights';
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'contribution', dir: 1 });
  const toggleSort = (key: SortKey) =>
    setSort(current => ({ key, dir: current.key === key ? (current.dir === 1 ? -1 : 1) : 1 }));

  const set = <K extends keyof Levers>(key: K, value: Levers[K]) =>
    setLevers(current => ({ ...current, [key]: value }));

  const today = useMemo(() => scenario(TODAY_LEVERS), []);
  const result = useMemo(() => scenario(levers), [levers]);
  const breakevenRho = useMemo(() => breakevenRhoDown(levers), [levers]);
  const fareForBreakeven = requiredFarePct(result.gapToBreakeven, levers.elasticity, protectTicketRevenue);
  const fareForTarget = requiredFarePct(Math.max(0, result.gapToTarget), levers.elasticity, protectTicketRevenue);

  // Waterfall: today's profit to the scenario profit, one step per lever family.
  const scenarioFlights = useMemo(
    () => Object.fromEntries(result.byRoute.map(r => [r.route.Route, r.flights])),
    [result]);

  const steps = useMemo(() => {
    const cohortStep = (cohort: Cohort) => {
      const fare = result.byRoute
        .filter(r => r.route.Cohort === cohort)
        .reduce((a, r) => a + r.fareGain, 0);
      return result.byCohort[cohort].contribution - fare - today.byCohort[cohort].contribution;
    };
    return [
      { label: 'Restore rollback', value: cohortStep('Restore') },
      { label: 'Decide changes', value: cohortStep('Decide') },
      { label: 'Protect flights', value: cohortStep('Protect') },
      { label: 'Lost connection feed', value: -result.feedLoss },
      { label: 'Protect fares', value: result.fareGain },
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
  const activePreset = Object.entries(PRESETS)
    .find(([, p]) => JSON.stringify(p) === JSON.stringify(levers))?.[0];

  return <section className="nb shell">
    <section className="hero">
      <div>
        <p className="eyebrow">NORTHBYTE AIRLINES · FY25-26 PROFIT DIAGNOSIS</p>
        <h1>What does it take<br />to stop losing money?</h1>
      </div>
      <p className="intro">
        Flights grew 20% while revenue grew 4.8% and costs grew 23%. Move the levers to see
        where profit lands against breakeven and a sustainable target.
      </p>
    </section>

    <nav className="tabs" aria-label="Views">
      {([['scenario', 'Scenario'], ['data', 'Data and assumptions']] as const).map(([id, label]) => (
        <button key={id} className={`tab ${tab === id ? 'on' : ''}`}
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => setTab(id)}>{label}</button>
      ))}
    </nav>

    <div className="nbPresets">
      {Object.keys(PRESETS).map(name => (
        <button key={name} className={`pill ${activePreset === name ? 'active' : ''}`}
                onClick={() => setLevers(PRESETS[name])}>{name}</button>
      ))}
      <button className="pill reset" onClick={() => setLevers(PRESETS['Full plan'])}>
        <RotateCcw size={13} aria-hidden /> Reset
      </button>
    </div>

    <div className="kpiStrip">
      <Kpi label="Flights" value={count(result.flights)} today={count(today.flights)} />
      <Kpi label="Net revenue" value={money(result.revenue + result.fareGain - result.feedLoss)} today={money(today.revenue)} />
      <Kpi label="Operating cost" value={money(result.cost)} today={money(today.cost)} />
      <Kpi label="Contribution" value={money(result.contribution)} today={money(today.contribution)} tone={sign(result.contribution)} />
      <Kpi label="Gates" value={money(result.gates)} today={money(today.gates)} />
      <Kpi label="Profit after gates" value={money(result.profit)} today={money(today.profit)} tone={sign(result.profit)} wide />
      <Kpi label="Margin" value={pct(result.margin * 100)} today={pct(today.margin * 100)} tone={sign(result.margin)} />
      <Kpi label="Gap to breakeven" value={result.gapToBreakeven > 0 ? money(-result.gapToBreakeven) : 'cleared'}
           today={money(-Math.max(0, -today.profit))} tone={result.gapToBreakeven > 0 ? 'neg' : 'pos'} />
      <Kpi label={`Gap to ${levers.targetMarginPct.toFixed(1)}% target`}
           value={result.gapToTarget > 0 ? money(-result.gapToTarget) : 'cleared'}
           today={money(-(today.target - today.profit))} tone={result.gapToTarget > 0 ? 'neg' : 'pos'} />
    </div>


    {tab === 'scenario' && <div className="scenarioGrid">
      <aside className="levers">
        <div className="sectionhead"><span>Levers</span><small>Assumptions</small></div>

        <label>Mode
          <select value={levers.mode} onChange={e => set('mode', e.target.value as Levers['mode'])}>
            <option value="preset">Preset plan</option>
            <option value="manual">Manual</option>
          </select>
        </label>

        {levers.mode === 'preset' ? <>
          <Slider label="Phase toward plan" value={levers.phase * 100} min={0} max={100} suffix="%"
                  onChange={v => set('phase', v / 100)} />
          <Slider label="Tranches applied" value={levers.tranche} min={0} max={4} suffix=""
                  onChange={v => set('tranche', v)} />
        </> : COHORTS.map(cohort => (
          <Slider key={cohort} label={`${cohort} flights`} value={levers.multipliers[cohort] * 100}
                  min={0} max={150} suffix="% of today"
                  onChange={v => set('multipliers', { ...levers.multipliers, [cohort]: v / 100 })} />
        ))}

        <div className="leverGroup">
          <span className="leverLabel">Revenue response when flights are cut (ρ)</span>
          <div className="filterrow">
            {Object.entries(presets.rhoDown).map(([name, value]) => (
              <button key={name} className={`pill ${levers.rhoDown === value ? 'active' : ''}`}
                      onClick={() => set('rhoDown', value as number)}>{name}</button>
            ))}
          </div>
          <Slider label="" value={levers.rhoDown * 100} min={0} max={100} step={0.1} suffix="%"
                  onChange={v => set('rhoDown', v / 100)} />
        </div>

        <Slider label="Revenue response when flights are added" value={levers.rhoUp * 100} min={0} max={100}
                step={0.1} suffix="%" onChange={v => set('rhoUp', v / 100)} />
        <Slider label="Crew shed on cut flights" value={levers.crewShed * 100} min={0} max={100} suffix="%"
                onChange={v => set('crewShed', v / 100)} />
        <Slider label="Protect fare change" value={levers.farePct} min={0} max={15} suffix="%" step={0.05}
                onChange={v => set('farePct', v)} />
        <Slider label="Fare elasticity (assumed)" value={levers.elasticity * 100} min={-150} max={0} suffix=""
                onChange={v => set('elasticity', v / 100)} format={v => (v / 100).toFixed(2)} />
        <Slider label="Sustainable target margin" value={levers.targetMarginPct} min={0} max={10} suffix="%" step={0.1}
                onChange={v => set('targetMarginPct', v)} />

        <div className="toggles">
          <label className="toggle"><input type="checkbox" checked={levers.gates === 'forecast'}
                 onChange={e => set('gates', e.target.checked ? 'forecast' : 'actual')} />
            <span>Use 2026-27 gate forecast</span></label>
          <label className="toggle"><input type="checkbox" checked={levers.releaseIdleGates}
                 onChange={e => set('releaseIdleGates', e.target.checked)} />
            <span>Release idle gates (−{money(constants.idleGatesReleasable)})</span></label>
          <label className="toggle"><input type="checkbox" checked={levers.seasonal}
                 onChange={e => set('seasonal', e.target.checked)} />
            <span>Seasonal baseline on Restore (×{constants.seasonalFactor})</span></label>
        </div>
      </aside>
    <div className="panel mapPanel">
      <div className="sectionhead">
        <span>Where the flights go</span>
        <small>Flights per month · 54 routes</small>
      </div>
      <NetworkMap scenarioFlights={scenarioFlights} selected={step} onSelect={setStep}
                  playing={playing} onTogglePlay={() => setPlaying(p => !p)} />
    </div>

    </div>}

    {tab === 'data' && <div className="nbMain dataView">
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
        <li>These are scenarios, not forecasts, and nothing here establishes causation.</li>
      </ul>
    </div>
    </div>}

    <div className="colophon">
      <span>BOLT UBC First Byte 2026 · NorthByte Airlines · FY25-26 (1 Sep 2025 – 31 Aug 2026)</span>
      <span>54 routes · 15,729 flights · all amounts in Canadian dollars</span>
    </div>
  </section>;
}

function Kpi({ label, value, today, tone = '', wide = false }:
             { label: string; value: string; today: string; tone?: string; wide?: boolean }) {
  return <div className={`kpi ${wide ? 'wide' : ''}`}>
    <small>{label}</small>
    <b className={tone}>{value}</b>
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

function Slider({ label, value, min, max, suffix, step = 1, onChange, format }:
                { label: string; value: number; min: number; max: number; suffix: string;
                  step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const progress = ((value - min) / (max - min)) * 100;
  const shown = format ? format(value) : `${Number(value.toFixed(2))}${suffix}`;
  return <label className="slider">
    {label && <span>{label}<b>{shown}</b></span>}
    <input aria-label={label || 'value'} type="range" min={min} max={max} step={step} value={value}
           style={{ background: `linear-gradient(90deg, var(--ink) ${progress}%, var(--line) ${progress}%)` }}
           onChange={e => onChange(Number(e.target.value))} />
  </label>;
}
