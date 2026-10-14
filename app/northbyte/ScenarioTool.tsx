'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import NetworkMap, { type ForecastStep } from './NetworkMap';
import LeverPanel, { ELASTICITIES, RHO_SCENARIOS } from './Levers';
import EvidenceView from './EvidenceView';
import { Figure, TweenSpeed } from './Figure';
import {
  scenario, doNothing, drift, presets, DEFAULT_LEVERS, TODAY_LEVERS, type Levers,
} from './model';

const M = 1_000_000;
const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v / M).toFixed(1)}M`;
const sign = (v: number) => (v < 0 ? 'neg' : v > 0 ? 'pos' : '');

/** The two states the audience is asked to compare. */
const NATIONAL_ELASTICITY = -0.88;
const TODAY: Levers = { ...TODAY_LEVERS, restoreLevel: 0, decideLevel: 0, farePct: 0,
                        releaseIdleGates: false, gates: 'actual', phase: 1, tranche: 4,
                        elasticity: NATIONAL_ELASTICITY };
const PLAN: Levers = {
  ...DEFAULT_LEVERS, phase: 1, tranche: 4, restoreLevel: 1, decideLevel: 1,
  farePct: presets.costPassThroughFarePct, gates: 'forecast',
  releaseIdleGates: true, seasonal: true, elasticity: NATIONAL_ELASTICITY,
};

const FORECAST_MONTHS = 12;
// Pinned rather than read from the clock, so a screenshot taken in any month
// shows the same twelve months the deck does.
const FORECAST_START = new Date(2026, 10);        // November 2026

export default function ScenarioTool() {
  const [levers, setLevers] = useState<Levers>(PLAN);
  const [tab, setTab] = useState<'map' | 'evidence'>('map');
  // The map opens on the end of the forecast, because that is the state the
  // levers describe; the month actually flown is the first column, one click
  // away, and the readout compares against it.
  const [step, setStep] = useState(FORECAST_MONTHS);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);          // dragging, or animating to a state
  // Doing nothing is a different shape of future, not a lever: flights keep
  // growing at last year's pace and cost per flight keeps drifting up.
  const [drifting, setDrifting] = useState(false);
  const animation = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(
      () => setStep(current => (current >= FORECAST_MONTHS ? 0 : current + 1)), 700);
    return () => window.clearInterval(id);
  }, [playing]);

  const set = useCallback(<K extends keyof Levers>(key: K, value: Levers[K]) => {
    setDrifting(false);
    setLevers(current => ({ ...current, [key]: value }));
  }, []);

  /** Walk the levers to a target state so the audience watches the planes leave. */
  const glideTo = useCallback((target: Levers, ms = 1500, drift = false) => {
    if (animation.current) cancelAnimationFrame(animation.current);
    setDrifting(drift);
    setBusy(true);
    setLevers(from => {
      const started = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / ms);
        const eased = 1 - Math.pow(1 - t, 3);
        const at = (a: number, b: number) => a + (b - a) * eased;
        setLevers({
          ...target,
          rhoDown: from.rhoDown, elasticity: from.elasticity,
          restoreLevel: at(from.restoreLevel, target.restoreLevel),
          decideLevel: at(from.decideLevel, target.decideLevel),
          farePct: at(from.farePct, target.farePct),
          // The switches land at the end rather than flickering on the way.
          releaseIdleGates: t < 1 ? from.releaseIdleGates : target.releaseIdleGates,
          gates: t < 1 ? from.gates : target.gates,
        });
        if (t < 1) animation.current = requestAnimationFrame(tick);
        else { animation.current = undefined; setBusy(false); }
      };
      animation.current = requestAnimationFrame(tick);
      return from;
    });
  }, []);

  useEffect(() => () => { if (animation.current) cancelAnimationFrame(animation.current); }, []);

  const today = useMemo(() => scenario(TODAY_LEVERS), []);
  const nothing = useMemo(() => doNothing(), []);
  const result = useMemo(() => scenario(levers), [levers]);

  // One tranche lands a quarter, never past what the levers allow, so the
  // forecast is the plan on a calendar rather than a separate assumption.
  const forecast = useMemo<ForecastStep[]>(() =>
    Array.from({ length: FORECAST_MONTHS }, (_, i) => {
      const month = new Date(FORECAST_START.getFullYear(), FORECAST_START.getMonth() + i);
      const label = month.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      const through = (i + 1) / FORECAST_MONTHS;

      if (drifting) {
        // Carry on as we are: the network keeps growing the way it grew last
        // year, and the profit walks toward what that costs.
        const scale = 1 + drift.flightsGrowth * through;
        return {
          label, month: month.getMonth(), tranche: 0,
          profit: today.profit + (nothing.expanding - today.profit) * through,
          flights: Object.fromEntries(
            scenario(TODAY_LEVERS).byRoute.map(r => [r.route.Route, r.flights * scale])),
        };
      }

      // A tranche lands over its quarter rather than on its last day, so every
      // month of the forecast moves.
      const tranche = Math.min(levers.tranche, (i + 1) / 3);
      const projection = scenario({ ...levers, tranche });
      return {
        label, month: month.getMonth(), tranche,
        profit: projection.profit,
        flights: Object.fromEntries(projection.byRoute.map(r => [r.route.Route, r.flights])),
      };
    }), [levers, drifting, today, nothing]);

  // Twelve runs: three demand cases by four price responses, at whatever the
  // sliders are now. Cheap enough to do on every change, and it stops the
  // headline claiming one number when the assumptions span a range.
  const range = useMemo(() => {
    const values = RHO_SCENARIOS.flatMap(demand => ELASTICITIES.map(price =>
      scenario({ ...levers, rhoDown: demand.rho, elasticity: price.value }).profit));
    return { low: Math.min(...values), high: Math.max(...values) };
  }, [levers]);

  const atPlan = JSON.stringify({ ...levers, rhoDown: 0, elasticity: 0 })
    === JSON.stringify({ ...PLAN, rhoDown: 0, elasticity: 0 });

  return <TweenSpeed.Provider value={busy ? 100 : 420}>
    <section className="nb shell">
      <section className="hero">
        <div>
          <p className="eyebrow">NORTHBYTE AIRLINES · FY25-26 PROFIT DIAGNOSIS</p>
          <h1>What does it take<br />to stop losing money?</h1>
        </div>
        <p className="intro">
          Flights grew 20.3%, revenue 5.1%, costs 23.5%. Pull the four solutions and watch
          the network and the profit move.
        </p>
      </section>

      <nav className="tabs" aria-label="Views">
        {([['map', 'The plan'], ['evidence', 'Evidence']] as const).map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? 'on' : ''}`}
                  aria-current={tab === id ? 'page' : undefined}
                  onClick={() => setTab(id)}>{label}</button>
        ))}
        <button className="pill reset" onClick={() => glideTo(PLAN, 600)} disabled={atPlan}>
          <RotateCcw size={13} aria-hidden /> Reset
        </button>
      </nav>

      <div className="headline">
        <div className="headlineFigure">
          <small>Profit after gates</small>
          <b className={sign(result.profit)}>
            <Figure value={result.profit} format={money} />
          </b>
          <span>today {money(today.profit)}</span>
        </div>
        <div className="headlineBar" aria-hidden="true">
          <i className="headlineTrack">
            <i className="headlineFill" style={{
              width: `${Math.min(100, Math.max(0, (1 - result.profit / today.profit) * 100))}%`,
            }} />
            <i className="headlineZero" />
          </i>
          <span className="headlineEnds"><em>{money(today.profit)}</em><em>break even</em></span>
          <span className="headlineRange">
            Range across all demand × price cases:{' '}
            <b><Figure value={range.low} format={money} /></b> to{' '}
            <b><Figure value={range.high} format={v => (v > 0 ? '+' : '') + money(v)} /></b>
          </span>
        </div>
        <div className="headlineFigure right">
          <small>{result.gapToBreakeven > 0.05 ? 'Left to break even' : 'Past break even by'}</small>
          <b className={result.gapToBreakeven > 0.05 ? 'neg' : 'pos'}>
            <Figure value={Math.abs(result.gapToBreakeven > 0.05 ? result.gapToBreakeven : result.profit)}
                    format={money} />
          </b>
          <span>today {money(Math.max(0, -today.profit))}</span>
        </div>
      </div>

      <LeverPanel section="breakeven" levers={levers} set={set} result={result}
                  onNothing={() => { glideTo(TODAY, 900, true); setStep(FORECAST_MONTHS); }}
                  onPlan={() => glideTo(PLAN)}
                  drifting={drifting} atPlan={atPlan && !drifting} animating={busy} />



      {tab === 'map' && <div className="dashboard viewFade" key="map"
           onPointerDown={() => setBusy(true)}
           onPointerUp={() => setBusy(false)}
           onPointerCancel={() => setBusy(false)}>
        <LeverPanel section="solutions" levers={levers} set={set} result={result}
                    onNothing={() => { glideTo(TODAY, 900, true); setStep(FORECAST_MONTHS); }}
                    onPlan={() => glideTo(PLAN)}
                    drifting={drifting} atPlan={atPlan && !drifting} animating={busy} />

        <div className="panel mapPanel">
          <div className="sectionhead">
            <span>Where the flights go</span>
            <small>Flights in an average month · the twelve months ahead</small>
          </div>
          <NetworkMap forecast={forecast} todayProfit={today.profit} fareGain={result.fareGain}
                      selected={step} onSelect={setStep}
                      playing={playing} onTogglePlay={() => setPlaying(p => !p)} />
        </div>

        <LeverPanel section="rail" levers={levers} set={set} result={result}
                    onNothing={() => { glideTo(TODAY, 900, true); setStep(FORECAST_MONTHS); }}
                    onPlan={() => glideTo(PLAN)}
                    drifting={drifting} atPlan={atPlan && !drifting} animating={busy} />
      </div>}

      {tab === 'evidence' && <EvidenceView levers={levers} result={result} today={today} />}

      <div className="colophon">
        <span>BOLT UBC First Byte 2026 · NorthByte Airlines · FY25-26 (1 Sep 2025 – 31 Aug 2026)</span>
        <span>54 routes · 15,729 flights · all amounts in Canadian dollars</span>
      </div>
    </section>
  </TweenSpeed.Provider>;
}
