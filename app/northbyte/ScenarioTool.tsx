'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import NetworkMap, { type ForecastStep } from './NetworkMap';
import LeverPanel from './Levers';
import EvidenceView from './EvidenceView';
import { Figure, TweenSpeed, useTween } from './Figure';
import {
  scenario, doNothing, drift, presets, DEFAULT_LEVERS, TODAY_LEVERS, type Levers,
} from './model';

const M = 1_000_000;
const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v / M).toFixed(1)}M`;
const sign = (v: number) => (v < 0 ? 'neg' : v > 0 ? 'pos' : '');

// The base case is what our own year of data shows: fares drew no measurable
// response, and revenue behaved as it did when the flights were added. The
// harsher cases are a click away on the assumptions card.
const BASE_ELASTICITY = 0;                      // "No response"
const BASE_RHO_DOWN = presets.rhoDown.High;     // "Demand holds"

/** The two states the audience is asked to compare. */
const TODAY: Levers = { ...TODAY_LEVERS, restoreLevel: 0, decideLevel: 0, farePct: 0,
                        releaseIdleGates: false, gates: 'actual', phase: 1, tranche: 4,
                        elasticity: BASE_ELASTICITY, rhoDown: BASE_RHO_DOWN };
const PLAN: Levers = {
  ...DEFAULT_LEVERS, phase: 1, tranche: 4, restoreLevel: 1, decideLevel: 1,
  farePct: presets.costPassThroughFarePct, gates: 'forecast',
  releaseIdleGates: true, seasonal: true,
  elasticity: BASE_ELASTICITY, rhoDown: BASE_RHO_DOWN,
};

/** The three cards the rail turns through, in reading order. */
const STAGES = [
  { section: 'breakeven' as const, label: 'Where it lands' },
  { section: 'solutions' as const, label: 'The four levers' },
  { section: 'rail' as const, label: 'Assumptions' },
];

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
        // Ease in as well as out. A pure ease-out leaves at full speed, which
        // is what made the handles look like they were being flung rather than
        // moved; smoothstep starts and stops at rest.
        const eased = t * t * (3 - 2 * t);
        const at = (a: number, b: number) => a + (b - a) * eased;
        setLevers({
          ...target,
          rhoDown: from.rhoDown, elasticity: from.elasticity,
          restoreLevel: at(from.restoreLevel, target.restoreLevel),
          decideLevel: at(from.decideLevel, target.decideLevel),
          farePct: at(from.farePct, target.farePct),
          // The switches throw at the start rather than snapping at the end:
          // a thing that can only be on or off should lead the move, not
          // ricochet to its stop once everything else has settled.
          releaseIdleGates: target.releaseIdleGates,
          gates: target.gates,
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

  // The rail is a deck of three cards: where the money lands, the four levers,
  // the assumptions behind them. Scrolling turns the card rather than the page.
  // The listener is attached by hand because React's onWheel is passive, and a
  // passive listener cannot stop the page scrolling underneath.
  // Which cohort the hand is on, passed to the map so it can bring it forward.
  const [focus, setFocus] = useState<'Restore' | 'Decide' | 'Protect' | null>(null);
  const [stage, setStage] = useState(0);
  const stageBody = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = stageBody.current;
    if (!node) return;
    let last = 0;
    let travel = 0;              // wheel distance since the last card turned
    let lastSeen = 0;
    // A card is a deliberate move, so it takes a deliberate scroll: a whole
    // gesture's worth of wheel in one direction, then a pause before the next.
    const TURN_DISTANCE = 220;
    const REST_MS = 700;
    const onWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (Math.abs(delta) < 2) return;
      // On a short window a card can be taller than the rail. Let it scroll to
      // its own end first, and only then turn to the next card.
      const room = node.scrollHeight - node.clientHeight > 2;
      const atTop = node.scrollTop <= 0;
      const atEnd = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
      if (room && !((delta > 0 && atEnd) || (delta < 0 && atTop))) return;
      event.preventDefault();
      const now = performance.now();
      // A new gesture, or a change of direction, starts counting again.
      if (now - lastSeen > 400 || Math.sign(delta) !== Math.sign(travel)) travel = 0;
      lastSeen = now;
      travel += delta;
      if (now - last < REST_MS || Math.abs(travel) < TURN_DISTANCE) return;
      setStage(current => {
        const next = Math.min(STAGES.length - 1, Math.max(0, current + (travel > 0 ? 1 : -1)));
        if (next !== current) { last = now; travel = 0; }
        return next;
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  // The headline bar and the headline figure run off the same eased value, so
  // they arrive together. A CSS transition on top of a per-frame width was
  // fighting the glide and reading as a stutter.
  const shownProfit = useTween(result.profit);
  const toBreakeven = Math.min(100, Math.max(0,
    today.profit === 0 ? 0 : (1 - shownProfit / today.profit) * 100));

  const atPlan = JSON.stringify({ ...levers, rhoDown: 0, elasticity: 0 })
    === JSON.stringify({ ...PLAN, rhoDown: 0, elasticity: 0 });

  return <TweenSpeed.Provider value={busy ? 100 : 420}>
    <section className="nb shell">


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

      {tab === 'map' && <div className="dashboard viewFade" key="map"
           onPointerDown={() => setBusy(true)}
           onPointerUp={() => setBusy(false)}
           onPointerCancel={() => setBusy(false)}>
        <div className="panel mapPanel">
          <NetworkMap forecast={forecast} todayProfit={today.profit} fareGain={result.fareGain}
                      selected={step} onSelect={setStep} focus={focus}
                      playing={playing} onTogglePlay={() => setPlaying(p => !p)} />
        </div>

        <div className="railCol">
          <div className="railTop">
            <div className="headlineFigure">
              <small>Profit after gates</small>
              <b className={sign(result.profit)}>{money(shownProfit)}</b>
              <span>today {money(today.profit)}</span>
            </div>
            <div className="headlineFigure right">
              <small>{result.gapToBreakeven > 0.05 ? 'Left to break even' : 'Past break even by'}</small>
              <b className={result.gapToBreakeven > 0.05 ? 'neg' : 'pos'}>
                <Figure value={Math.abs(result.gapToBreakeven > 0.05 ? result.gapToBreakeven : result.profit)}
                        format={money} />
              </b>
              <span>today {money(Math.max(0, -today.profit))}</span>
            </div>
            <div className="headlineBar" aria-hidden="true">
              <i className="headlineTrack">
                <i className="headlineFill" style={{ width: `${toBreakeven}%` }} />
                <i className="headlineZero" />
              </i>
              <span className="headlineEnds"><em>{money(today.profit)}</em><em>break even</em></span>
            </div>
          </div>

          <div className="filterrow stateButtons">
            <button className={`pill ${drifting ? 'active' : ''}`}
                    onClick={() => { glideTo(TODAY, 900, true); setStep(FORECAST_MONTHS); }}>
              Do nothing
            </button>
            <button className={`pill ${atPlan && !drifting ? 'active' : ''}`}
                    onClick={() => glideTo(PLAN)}>Our plan</button>
          </div>

          {/* One column, three cards deep. The wheel turns the card over
              instead of scrolling the page, so the map never leaves the screen. */}
          <div className="stageBody" ref={stageBody}>
            <div className="stage viewFade" key={stage}>
              <LeverPanel section={STAGES[stage].section} levers={levers} set={set}
                          result={result} animating={busy} onFocus={setFocus} />
            </div>
          </div>

          <div className="stageDots" role="tablist" aria-label="Rail view">
            {STAGES.map((item, index) => (
              <button key={item.section} role="tab" aria-selected={index === stage}
                      className={`stageDot ${index === stage ? 'on' : ''}`}
                      onClick={() => setStage(index)}>
                <i aria-hidden />{item.label}
              </button>
            ))}
          </div>
        </div>
      </div>}

      {tab === 'evidence' && <EvidenceView levers={levers} result={result} today={today} />}


    </section>
  </TweenSpeed.Provider>;
}
