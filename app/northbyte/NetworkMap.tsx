'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import map from '../data/northbyte-map.json';
import { routes, type Route } from './model';

// The network drawn as it is flown: one arc per route, and a population of
// aircraft on it in proportion to how often it is flown. Cutting flights thins
// the traffic, which is the point the deck has to land in one look.
//
// Everything is plain SVG at projected coordinates (see scripts/build_map_data.py),
// so the frame can be pasted into a design tool as vectors.

const AIRPORTS = map.airports as Record<string, { x: number; y: number; city: string }>;
const MONTHLY = map.monthlyFlights as Record<string, number[]>;
const HUBS = ['YVR', 'YYC', 'YEG', 'YWG', 'YYZ', 'YOW', 'YUL', 'YHZ', 'YYT'];
const COHORT_COLOUR: Record<Route['Cohort'], string> = {
  Restore: 'var(--red)', Decide: 'var(--grey)', Protect: 'var(--ink)',
};

/** Quadratic arc between two airports; the bow keeps opposite directions apart. */
function arc(from: { x: number; y: number }, to: { x: number; y: number }) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const bow = Math.min(length * 0.16, 70);
  return { cx: mx - (dy / length) * bow, cy: my + (dx / length) * bow };
}

function pointOn(from: { x: number; y: number }, c: { cx: number; cy: number },
                 to: { x: number; y: number }, t: number) {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * c.cx + t * t * to.x,
    y: u * u * from.y + 2 * u * t * c.cy + t * t * to.y,
  };
}

export type MapRoute = { route: Route; flightsPerMonth: number };

export default function NetworkMap({
  scenarioFlights, selected, onSelect, playing, onTogglePlay,
}: {
  scenarioFlights: Record<string, number>;   // annual flights under the scenario
  selected: number;                           // month index, or months.length for the plan
  onSelect: (index: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  const months = map.months as string[];
  const planIndex = months.length;
  const isPlan = selected >= planIndex;

  const drawn = useMemo<MapRoute[]>(() => routes.map(route => ({
    route,
    flightsPerMonth: isPlan
      ? scenarioFlights[route.Route] / 12
      : (MONTHLY[route.Route]?.[selected] ?? 0),
  })), [selected, isPlan, scenarioFlights]);

  const total = drawn.reduce((a, r) => a + r.flightsPerMonth, 0);
  const totals = map.monthlyTotals as number[];
  const peakIndex = totals.indexOf(Math.max(...totals));
  const peak = { total: totals[peakIndex], month: months[peakIndex] };
  const busiest = Math.max(...drawn.map(r => r.flightsPerMonth), 1);

  return <div className="mapBlock">
    <div className="mapFrame">
      <svg viewBox={map.viewBox} className="mapSvg" role="img"
           aria-label={`NorthByte network, ${isPlan ? 'recommended plan' : months[selected]}: ${Math.round(total)} flights in the month`}>
        {(map.land as string[]).map((d, i) => <path key={i} d={d} className="mapLand" />)}

        {drawn.map(({ route, flightsPerMonth }) => {
          const from = AIRPORTS[route.Dep], to = AIRPORTS[route.Arr];
          if (!from || !to || flightsPerMonth <= 0) return null;
          const c = arc(from, to);
          return <path key={route.Route}
                       d={`M${from.x} ${from.y}Q${c.cx} ${c.cy} ${to.x} ${to.y}`}
                       fill="none" stroke={COHORT_COLOUR[route.Cohort]}
                       strokeWidth={0.6 + (flightsPerMonth / busiest) * 2.6}
                       strokeOpacity={0.28} />;
        })}

        <Traffic drawn={drawn} busiest={busiest} />

        {Object.entries(AIRPORTS).map(([code, a]) => (
          <circle key={code} cx={a.x} cy={a.y} r={HUBS.includes(code) ? 4 : 2.5} className="mapDot" />
        ))}
        {HUBS.filter(code => AIRPORTS[code]).map(code => (
          <text key={code} x={AIRPORTS[code].x + 9} y={AIRPORTS[code].y + 4} className="mapLabel">{code}</text>
        ))}
      </svg>

      <div className="mapReadout">
        <small>{isPlan ? 'Recommended plan' : monthLabel(months[selected])}</small>
        <b>{Math.round(total).toLocaleString('en-US')}</b>
        <span>flights in the month</span>
        {/* Against the busiest month flown, so the size of the cut is legible
            without having to click back and forth. */}
        <span className="mapDelta">
          {peak.total === 0 ? null
            : Math.abs(total - peak.total) < 1 ? `the peak, ${monthLabel(peak.month)}`
            : `${total < peak.total ? '−' : '+'}${Math.abs(Math.round((total / peak.total - 1) * 100))}% vs ${monthLabel(peak.month)}`}
        </span>
      </div>
    </div>

    <Timeline months={months} selected={selected} onSelect={onSelect}
              playing={playing} onTogglePlay={onTogglePlay}
              planTotal={Object.values(scenarioFlights).reduce((a, v) => a + v, 0) / 12} />

    <p className="legend">
      <i className="chip restore" /> Restore
      <i className="chip decide" /> Decide
      <i className="chip protect" /> Protect
      <span className="legendNote">Line weight and aircraft shown follow flights per month. Sep 2024 – Aug 2026 is flown history; the plan is a scenario.</span>
    </p>
  </div>;
}

/** The aircraft themselves: one dot per block of flights, drifting along the arc. */
function Traffic({ drawn, busiest }: { drawn: MapRoute[]; busiest: number }) {
  const [phase, setPhase] = useState(0);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) return;                       // a static frame says the same thing
    let start: number | undefined;
    const step = (time: number) => {
      start ??= time;
      setPhase(((time - start) / 26000) % 1);  // one slow pass, no easing
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, []);

  return <g>{drawn.flatMap(({ route, flightsPerMonth }) => {
    const from = AIRPORTS[route.Dep], to = AIRPORTS[route.Arr];
    if (!from || !to || flightsPerMonth <= 0) return [];
    const count = Math.min(8, Math.max(1, Math.round(flightsPerMonth / (busiest / 8))));
    const c = arc(from, to);
    return Array.from({ length: count }, (_, i) => {
      const t = (phase + i / count) % 1;
      const { x, y } = pointOn(from, c, to, t);
      return <circle key={`${route.Route}-${i}`} cx={x} cy={y} r={2.2}
                     fill={COHORT_COLOUR[route.Cohort]} fillOpacity={0.9} />;
    });
  })}</g>;
}

function Timeline({ months, selected, onSelect, playing, onTogglePlay, planTotal }: {
  months: string[]; selected: number; onSelect: (i: number) => void;
  playing: boolean; onTogglePlay: () => void; planTotal: number;
}) {
  const totals = map.monthlyTotals as number[];
  const peak = Math.max(...totals, planTotal, 1);
  const bar = (value: number) => `${Math.max(3, (value / peak) * 100)}%`;

  return <div className="timeline">
    <button className="pill playToggle" onClick={onTogglePlay} aria-pressed={playing}>
      {playing ? 'Pause' : 'Play'}
    </button>
    <div className="track" role="group" aria-label="Flights by month">
      {totals.map((value, index) => (
        <button key={months[index]} className={`tick ${selected === index ? 'on' : ''}`}
                onClick={() => onSelect(index)}
                aria-label={`${monthLabel(months[index])}, ${value.toLocaleString('en-US')} flights`}
                aria-pressed={selected === index}>
          <i style={{ height: bar(value) }} />
        </button>
      ))}
      <span className="trackGap" aria-hidden="true" />
      <button className={`tick plan ${selected >= totals.length ? 'on' : ''}`}
              onClick={() => onSelect(totals.length)}
              aria-label={`Recommended plan, ${Math.round(planTotal).toLocaleString('en-US')} flights a month`}
              aria-pressed={selected >= totals.length}>
        <i style={{ height: bar(planTotal) }} />
      </button>
    </div>
    <div className="trackAxis">
      <span>Sep 2024</span><span>Mar 2025</span><span>Sep 2025</span><span>Mar 2026</span><span>Plan</span>
    </div>
  </div>;
}

function monthLabel(month: string) {
  const [year, m] = month.split('-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${year}`;
}
