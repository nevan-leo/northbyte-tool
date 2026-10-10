'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Pause, Play } from 'lucide-react';
import map from '../data/northbyte-map.json';
import { routes, type Route } from './model';
import { PLANE_PATH } from './Brand';

// The network as it is flown: one arc per route, and aircraft moving along it in
// proportion to how often it is flown. Cutting flights thins the traffic, which
// is the point the deck has to land in one look.
//
// Geometry is projected ahead of time (scripts/build_map_data.py) and drawn as
// plain SVG, so the frame pastes into a design tool as vectors and nothing is
// fetched at runtime.

const AIRPORTS = map.airports as Record<string, { x: number; y: number; city: string }>;
const MONTHLY = map.monthlyFlights as Record<string, number[]>;
const HUBS = ['YVR', 'YYC', 'YEG', 'YWG', 'YYZ', 'YOW', 'YUL', 'YHZ', 'YYT'];
const COHORT_COLOUR: Record<Route['Cohort'], string> = {
  Restore: 'var(--red)', Decide: 'var(--grey)', Protect: 'var(--ink)',
};
const MAX_PLANES_PER_ROUTE = 7;
const LAP_MS = 3400;           // one end-to-end crossing

type Geometry = { x1: number; y1: number; cx: number; cy: number; x2: number; y2: number };

function geometryFor(route: Route): Geometry | null {
  const from = AIRPORTS[route.Dep], to = AIRPORTS[route.Arr];
  if (!from || !to) return null;
  const dx = to.x - from.x, dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const bow = Math.min(length * 0.16, 70);   // keeps the two directions apart
  return {
    x1: from.x, y1: from.y, x2: to.x, y2: to.y,
    cx: (from.x + to.x) / 2 - (dy / length) * bow,
    cy: (from.y + to.y) / 2 + (dx / length) * bow,
  };
}

export default function NetworkMap({
  scenarioFlights, selected, onSelect, playing, onTogglePlay,
}: {
  scenarioFlights: Record<string, number>;
  selected: number;
  onSelect: (index: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  const months = map.months as string[];
  const isPlan = selected >= months.length;

  const drawn = useMemo(() => routes.map(route => ({
    route,
    geometry: geometryFor(route),
    flightsPerMonth: isPlan
      ? scenarioFlights[route.Route] / 12
      : (MONTHLY[route.Route]?.[selected] ?? 0),
  })).filter(r => r.geometry && r.flightsPerMonth > 0), [selected, isPlan, scenarioFlights]);

  const total = drawn.reduce((a, r) => a + r.flightsPerMonth, 0);
  const busiest = Math.max(...drawn.map(r => r.flightsPerMonth), 1);
  const totals = map.monthlyTotals as number[];
  const peakIndex = totals.indexOf(Math.max(...totals));

  return <div className="mapBlock">
    <div className="mapFrame">
      <svg viewBox={map.viewBox} className="mapSvg" role="img"
           aria-label={`NorthByte network, ${isPlan ? 'recommended plan' : monthLabel(months[selected])}: ${Math.round(total)} flights in the month`}>
        {(map.neighbours as string[]).map((d, i) => <path key={`n${i}`} d={d} className="mapNeighbour" />)}
        {(map.land as string[]).map((d, i) => <path key={`l${i}`} d={d} className="mapLand" />)}
        {(map.lakes as string[]).map((d, i) => <path key={`w${i}`} d={d} className="mapWater" />)}

        {drawn.map(({ route, geometry, flightsPerMonth }) => (
          <path key={route.Route}
                d={`M${geometry!.x1} ${geometry!.y1}Q${geometry!.cx} ${geometry!.cy} ${geometry!.x2} ${geometry!.y2}`}
                fill="none" stroke={COHORT_COLOUR[route.Cohort]}
                strokeWidth={0.5 + (flightsPerMonth / busiest) * 2.2}
                strokeOpacity={0.22} />
        ))}

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
            without clicking back and forth. */}
        <span className="mapDelta">
          {Math.abs(total - totals[peakIndex]) < 1
            ? `the peak, ${monthLabel(months[peakIndex])}`
            : `${total < totals[peakIndex] ? '−' : '+'}${Math.abs(Math.round((total / totals[peakIndex] - 1) * 100))}% vs ${monthLabel(months[peakIndex])}`}
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
      <span className="legendNote">Aircraft shown and line weight follow flights per month. Sep 2024 – Aug 2026 is flown history; the plan is a scenario.</span>
    </p>
  </div>;
}

type Drawn = { route: Route; geometry: Geometry | null; flightsPerMonth: number };

/**
 * The aircraft. Positions are written straight to each node's transform in the
 * animation frame rather than through React: a hundred-odd glyphs at sixty
 * frames a second is not a state update.
 */
function Traffic({ drawn, busiest }: { drawn: Drawn[]; busiest: number }) {
  const group = useRef<SVGGElement>(null);

  const fleet = useMemo(() => drawn.flatMap(({ route, geometry, flightsPerMonth }) => {
    const count = Math.min(MAX_PLANES_PER_ROUTE,
                           Math.max(1, Math.round(flightsPerMonth / (busiest / MAX_PLANES_PER_ROUTE))));
    return Array.from({ length: count }, (_, i) => ({
      id: `${route.Route}-${i}`,
      colour: COHORT_COLOUR[route.Cohort],
      geometry: geometry!,
      offset: i / count,
      // A little variation per route stops the whole network pulsing in step.
      speed: 0.85 + ((route.Route.charCodeAt(0) + route.Route.charCodeAt(4)) % 7) * 0.05,
    }));
  }), [drawn, busiest]);

  useEffect(() => {
    const node = group.current;
    if (!node) return;
    const planes = Array.from(node.children) as SVGGElement[];
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const place = (time: number) => {
      planes.forEach((plane, index) => {
        const { geometry, offset, speed } = fleet[index];
        const t = still ? offset : (offset + (time / LAP_MS) * speed) % 1;
        const u = 1 - t;
        const x = u * u * geometry.x1 + 2 * u * t * geometry.cx + t * t * geometry.x2;
        const y = u * u * geometry.y1 + 2 * u * t * geometry.cy + t * t * geometry.y2;
        const dx = 2 * u * (geometry.cx - geometry.x1) + 2 * t * (geometry.x2 - geometry.cx);
        const dy = 2 * u * (geometry.cy - geometry.y1) + 2 * t * (geometry.y2 - geometry.cy);
        plane.setAttribute('transform',
          `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1)}) scale(0.6)`);
      });
    };

    if (still) { place(0); return; }
    let frame = 0;
    const tick = (time: number) => { place(time); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fleet]);

  return <g ref={group} className="fleet">
    {fleet.map(plane => (
      <g key={plane.id}><path d={PLANE_PATH} fill={plane.colour} /></g>
    ))}
  </g>;
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
      {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
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
