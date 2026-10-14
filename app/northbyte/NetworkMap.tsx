'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Pause, Play, ZoomIn, ZoomOut } from 'lucide-react';
import map from '../data/northbyte-map.json';
import { routes, type Route } from './model';
import { Figure } from './Figure';
import { FLIGHT_PATH } from './Brand';
import { signed } from './format';

// The network as it is flown: one arc per route, and aircraft moving along it in
// proportion to how often it is flown. Cutting flights thins the traffic, which
// is the point the deck has to land in one look.
//
// Geometry is projected ahead of time (scripts/build_map_data.py) and drawn as
// plain SVG, so the frame pastes into a design tool as vectors and nothing is
// fetched at runtime.

const AIRPORTS = map.airports as Record<string, { x: number; y: number; city: string; rank: number }>;
const LAND = map.land as { d: string; code: string }[];
const MONTHLY = map.monthlyFlights as Record<string, number[]>;
const HUBS = ['YVR', 'YYC', 'YEG', 'YWG', 'YYZ', 'YOW', 'YUL', 'YHZ', 'YYT'];
const LABEL_LEFT = ['YOW', 'YXU', 'YQM', 'YHZ', 'YYZ', 'YVR', 'YXX'];
const COHORT_COLOUR: Record<Route['Cohort'], string> = {
  Restore: 'var(--clay)', Decide: 'var(--tan)', Protect: 'var(--ink)',
};
// Four related colours cannot separate three cohorts on their own, so each one
// gets its own weight and texture as well. It also matches the argument: the ten
// Restore routes carry the loss and should shout, the thirty-eight Protect
// routes are the network holding steady behind them.
const COHORT_DASH: Partial<Record<Route['Cohort'], string>> = { Decide: '5 4' };
const COHORT_OPACITY: Record<Route['Cohort'], number> = {
  Restore: 0.85, Decide: 0.95, Protect: 0.16,
};
// A fare rise is invisible on a map of flights, so the stable routes come
// forward as the fares lever earns: 0.16 at nothing, 0.5 at $8M.
const PROTECT_OPACITY_AT_FULL_FARES = 0.5;
const FARE_GAIN_FOR_FULL = 8_000_000;
const COHORT_WEIGHT: Record<Route['Cohort'], number> = {
  Restore: 1.6, Decide: 1.6, Protect: 0.9,
};
const PLANE_OPACITY: Record<Route['Cohort'], number> = {
  Restore: 1, Decide: 1, Protect: 0.5,
};
const MAX_PLANES_PER_ROUTE = 7;
// The reference is the busiest route-month ever flown, NOT the busiest route in
// whatever is on screen. Normalising against the current state kept the fleet
// the same size however many flights were cut, which is the opposite of the
// point: one aircraft now stands for a fixed number of flights a month.
const BUSIEST_EVER = Math.max(
  ...Object.values(map.monthlyFlights as Record<string, number[]>).flat(), 1);
const FLIGHTS_PER_PLANE = BUSIEST_EVER / MAX_PLANES_PER_ROUTE;
const LAP_MS = 3400;           // one end-to-end crossing
const PLANE_SCALE = 0.62;      // the 24-unit glyph down to map scale

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

type Box = { x: number; y: number; w: number; h: number };

const BASE: Box = (() => {
  const [x, y, w, h] = (map.viewBox as string).split(' ').map(Number);
  return { x, y, w, h };
})();
const MAX_ZOOM = 8;

export type ForecastStep = {
  label: string; month: number; tranche: number; profit: number;
  flights: Record<string, number>;      // annual flights per route
};

// Everything on this map is an AVERAGE MONTH of the year in question. A single
// calendar month is not comparable with another - August flew 1,474 and
// February 1,103 - so showing real months made the plan's effect wobble up and
// down when what it does is come steadily down. Seasonality is a finding in its
// own right and lives in the evidence tab.
const FY = 12;                                    // the second year in the data
const BASELINE_MONTH: Record<string, number> = Object.fromEntries(
  Object.entries(MONTHLY).map(([route, counts]) =>
    [route, counts.slice(FY).reduce((a, v) => a + v, 0) / 12]));

export default function NetworkMap({
  forecast, todayProfit, fareGain, selected, onSelect, playing, onTogglePlay,
}: {
  forecast: ForecastStep[];           // annual flights per route, month by month
  todayProfit: number;                // profit after gates as things stand
  fareGain: number;                   // what the fare lever is winning, in dollars
  selected: number;                   // 0 = today, 1..n = months ahead
  onSelect: (index: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  const isForecast = selected > 0;
  const step = forecast[selected - 1];

  const svg = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<Box>(BASE);
  const drag = useRef<{ x: number; y: number; box: Box } | null>(null);
  const zoomed = box.w < BASE.w - 0.5;
  const k = box.w / BASE.w;        // symbol scale: shrink as the frame narrows

  /** Keep the frame inside the base extent so the map cannot be lost offscreen. */
  const clamp = useCallback((next: Box): Box => {
    const w = Math.min(BASE.w, Math.max(BASE.w / MAX_ZOOM, next.w));
    const h = w * (BASE.h / BASE.w);
    return {
      w, h,
      x: Math.min(BASE.x + BASE.w - w, Math.max(BASE.x, next.x)),
      y: Math.min(BASE.y + BASE.h - h, Math.max(BASE.y, next.y)),
    };
  }, []);

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    setBox(current => {
      const rect = svg.current?.getBoundingClientRect();
      // Zoom towards the pointer when there is one, otherwise the centre.
      const fx = rect && clientX !== undefined ? (clientX - rect.left) / rect.width : 0.5;
      const fy = rect && clientY !== undefined ? (clientY - rect.top) / rect.height : 0.5;
      const w = current.w / factor;
      const h = current.h / factor;
      return clamp({
        w, h,
        x: current.x + (current.w - w) * fx,
        y: current.y + (current.h - h) * fy,
      });
    });
  }, [clamp]);

  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    // Registered here rather than as a React prop so it can be non-passive and
    // stop the page scrolling under the cursor.
    const onWheel = (event: WheelEvent) => {
      // A bare wheel scrolls the page. Zooming on it hijacked the scroll
      // whenever the pointer crossed the map, which also left the frame zoomed
      // in without anyone asking. Pinch on a trackpad arrives as ctrl+wheel, so
      // this still reads as the ordinary gesture.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const stepSize = Math.min(Math.abs(pixels), 50) / 50;
      zoomAt(Math.pow(1.07, pixels < 0 ? stepSize : -stepSize), event.clientX, event.clientY);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, box };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    const rect = svg.current?.getBoundingClientRect();
    if (!start || !rect) return;
    setBox(clamp({
      ...start.box,
      x: start.box.x - (event.clientX - start.x) * (start.box.w / rect.width),
      y: start.box.y - (event.clientY - start.y) * (start.box.h / rect.height),
    }));
  };
  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const drawn = useMemo(() => routes.map(route => ({
    route,
    geometry: geometryFor(route),
    flightsPerMonth: isForecast
      ? (step?.flights[route.Route] ?? 0) / 12
      : (BASELINE_MONTH[route.Route] ?? 0),
  })).filter(r => r.geometry && r.flightsPerMonth > 0), [isForecast, step]);


  const total = drawn.reduce((a, r) => a + r.flightsPerMonth, 0);
  const totals = map.monthlyTotals as number[];
  const now = totals.slice(FY).reduce((a, v) => a + v, 0) / 12;   // FY25-26 average month
  // Sep 2024 - Feb 2025 is the pre-expansion window the rollback aims at, and is
  // the only fair yardstick for where the airline stands today.
  const preExpansion = totals.slice(0, 6).reduce((a, v) => a + v, 0) / 6;
  const change = preExpansion > 0 ? Math.round((total / preExpansion - 1) * 100) : 0;
  // Against FY25-26's own average month, which is what the first column shows.
  const sameMonthChange = now > 0 ? Math.round((total / now - 1) * 100) : 0;
  // What the plan is for: a cut in flights is the means, the profit it recovers
  // is the point. The model restates FY25-26 at the chosen frequency, so this is
  // one year re-run, not a run rate and not something that compounds.
  const recovered = isForecast ? step.profit - todayProfit : 0;

  return <div className="mapBlock">
    <div className="mapFrame">
      <svg ref={svg} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
           className={`mapSvg ${zoomed ? 'zoomed' : ''}`}
           onPointerDown={onPointerDown} onPointerMove={onPointerMove}
           onPointerUp={endDrag} onPointerLeave={endDrag}
           role="img"
           aria-label={`NorthByte network, ${isForecast ? `forecast ${step.label}` : 'FY25-26 as flown'}: ${Math.round(total)} flights in an average month`}>
        <Basemap />

        {drawn.map(({ route, geometry, flightsPerMonth }) => {
          const opacity = route.Cohort === 'Protect'
            ? COHORT_OPACITY.Protect + (PROTECT_OPACITY_AT_FULL_FARES - COHORT_OPACITY.Protect)
              * Math.min(1, Math.max(0, fareGain / FARE_GAIN_FOR_FULL))
            : COHORT_OPACITY[route.Cohort];
          const d = `M${geometry!.x1} ${geometry!.y1}Q${geometry!.cx} ${geometry!.cy} ${geometry!.x2} ${geometry!.y2}`;
          const width = (0.5 + (flightsPerMonth / BUSIEST_EVER) * 2.2) * k * COHORT_WEIGHT[route.Cohort];
          const dash = COHORT_DASH[route.Cohort];
          return <g key={route.Route}>
            {/* Tan on cream is too quiet on its own, so the Decide routes get a
                dark underlay and the dashes ride on top of it. */}
            {dash && <path d={d} fill="none" stroke="var(--ink)" strokeWidth={width * 1.5}
                           strokeOpacity={0.45} />}
            <path d={d} fill="none" stroke={COHORT_COLOUR[route.Cohort]} strokeWidth={width}
                  strokeDasharray={dash ? dash.split(' ').map(n => Number(n) * k).join(' ') : undefined}
                  strokeOpacity={opacity} />
          </g>;
        })}

        <Traffic drawn={drawn} scale={k} />

        {Object.entries(AIRPORTS).map(([code, a]) => (
          <circle key={code} cx={a.x} cy={a.y} r={(HUBS.includes(code) ? 4 : 3) * k} className="mapDot" />
        ))}
        {/* Only the busiest airports are named: twenty labels at this scale
            overlap into mush. Labels sit to the left for the eastern cluster so
            they do not pile up on the routes leaving it. */}
        {Object.entries(AIRPORTS).filter(([, a]) => a.rank < 9).map(([code, a]) => {
          const flip = LABEL_LEFT.includes(code);
          return <text key={code} x={a.x + (flip ? -8 : 8) * k} y={a.y + 4 * k}
                       textAnchor={flip ? 'end' : 'start'}
                       fontSize={13 * k} strokeWidth={3.5 * k} className="mapLabel">{code}</text>;
        })}
      </svg>

      <div className="mapZoom">
        <button className="pill" onClick={() => zoomAt(1.35)} aria-label="Zoom in"><ZoomIn size={14} /></button>
        <button className="pill" onClick={() => zoomAt(1 / 1.35)} aria-label="Zoom out"><ZoomOut size={14} /></button>
        <button className="pill" onClick={() => setBox(BASE)} aria-label="Reset the view"
                disabled={!zoomed}><Maximize2 size={14} /></button>
        <span className="zoomHint">drag to pan<br />pinch to zoom</span>
      </div>

      <div className="mapReadout">
        <small>{isForecast ? `Forecast · ${step.label}` : 'FY25-26 as flown'}</small>
        <b><Figure value={total} format={v => Math.round(v).toLocaleString('en-US')} /></b>
        <span>flights in an average month</span>
        {isForecast && <span className="mapSame">
          {sameMonthChange === 0
            ? 'level with'
            : `${sameMonthChange > 0 ? '+' : '−'}${Math.abs(sameMonthChange)}% on`}
          {' '}FY25-26
        </span>}
        <span className={`mapDelta ${isForecast && recovered > 0 ? 'up' : ''}`}>
          {isForecast
            ? <>Profit this frequency would earn over a year: <Figure value={recovered} format={signed} /></>
            : `${change < 0 ? '−' : '+'}${Math.abs(change)}% flights vs the pre-expansion months`}
        </span>
      </div>
    </div>

    <Timeline forecast={forecast} now={now} selected={selected} onSelect={onSelect}
              playing={playing} onTogglePlay={onTogglePlay} />

    <p className="legend">
      <i className="rule restore" /> Doubled routes <small>10, the loss</small>
      <i className="rule decide" /> New routes <small>6, re-cut or exited</small>
      <i className="rule protect" /> Stable routes <small>38, held flat</small>
      {Math.abs(fareGain) > 50_000 &&
        <span className={`fareChip ${fareGain < 0 ? 'neg' : ''}`}>{signed(fareGain)} from fares</span>}
      <span className="legendNote">
        One aircraft stands for about {Math.round(FLIGHTS_PER_PLANE)} flights a month.
        Every figure is an average month; the real months vary seasonally.
      </span>
    </p>
  </div>;
}

/** Geography, memoised once: no lever can change the coastline. */
const Basemap = memo(function Basemap() {
  return <g>
    {(map.neighbours as string[]).map((d, i) => <path key={`n${i}`} d={d} className="mapNeighbour" />)}
    {LAND.map((shape, i) => <path key={`l${i}`} d={shape.d} className="mapLand" />)}
    {(map.lakes as string[]).map((d, i) => <path key={`w${i}`} d={d} className="mapWater" />)}
  </g>;
});

type Drawn = { route: Route; geometry: Geometry | null; flightsPerMonth: number };

/**
 * The aircraft. Positions are written straight to each node's transform in the
 * animation frame rather than through React: a hundred-odd glyphs at sixty
 * frames a second is not a state update.
 */
function Traffic({ drawn, scale }: { drawn: Drawn[]; scale: number }) {
  const group = useRef<SVGGElement>(null);

  const fleet = useMemo(() => drawn.flatMap(({ route, geometry, flightsPerMonth }) => {
    const count = Math.min(MAX_PLANES_PER_ROUTE, Math.round(flightsPerMonth / FLIGHTS_PER_PLANE));
    return Array.from({ length: count }, (_, i) => ({
      id: `${route.Route}-${i}`,
      colour: COHORT_COLOUR[route.Cohort],
      opacity: PLANE_OPACITY[route.Cohort],
      outlined: route.Cohort === 'Decide',
      geometry: geometry!,
      offset: i / count,
      // A little variation per route stops the whole network pulsing in step.
      speed: 0.85 + ((route.Route.charCodeAt(0) + route.Route.charCodeAt(4)) % 7) * 0.05,
    }));
  }), [drawn]);

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
        // The glyph is drawn nose-up on a 24x24 box, so the heading needs a
        // quarter turn, and the box needs centring on the point.
        const heading = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        plane.setAttribute('transform',
          `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${heading.toFixed(1)}) scale(${PLANE_SCALE * scale}) translate(-12 -12)`);
      });
    };

    if (still) { place(0); return; }
    let frame = 0;
    const tick = (time: number) => { place(time); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fleet, scale]);

  return <g ref={group} className="fleet">
    {fleet.map(plane => (
      <g key={plane.id}>
        <path d={FLIGHT_PATH} fill={plane.colour} fillOpacity={plane.opacity}
              stroke={plane.outlined ? 'var(--ink)' : undefined}
              strokeWidth={plane.outlined ? 1.2 : undefined} />
      </g>
    ))}
  </g>;
}

function Timeline({ forecast, now, selected, onSelect, playing, onTogglePlay }: {
  forecast: ForecastStep[]; now: number; selected: number;
  onSelect: (i: number) => void; playing: boolean; onTogglePlay: () => void;
}) {
  const levels = [now, ...forecast.map(stepOf => Object.values(stepOf.flights)
    .reduce((a, v) => a + v, 0) / 12)];
  const peak = Math.max(...levels, 1);

  return <div className="timeline">
    <button className="pill playToggle" onClick={onTogglePlay} aria-pressed={playing}>
      {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
      {playing ? 'Pause' : 'Play'}
    </button>
    <div className="track" role="group" aria-label="Flights per month, today and the twelve months ahead">
      {levels.map((value, index) => {
        const stepOf = forecast[index - 1];
        // Mark only the month a whole tranche finishes landing. The tranche runs
        // continuously now, so comparing the raw value marked every month.
        const done = index > 0 ? Math.floor(stepOf.tranche + 1e-9) : 0;
        const doneBefore = index > 1 ? Math.floor(forecast[index - 2].tranche + 1e-9) : 0;
        const lands = done > doneBefore && done >= 1;
        return <button key={index}
                className={`tick ${index === 0 ? 'now' : 'ahead'} ${selected === index ? 'on' : ''}`}
                onClick={() => onSelect(index)}
                aria-label={index === 0
                  ? `FY25-26 as flown, ${Math.round(value).toLocaleString('en-US')} flights in an average month`
                  : `${stepOf.label}, ${Math.round(value).toLocaleString('en-US')} flights, ` +
                    `tranche ${stepOf.tranche.toFixed(1)} applied`}
                aria-pressed={selected === index}>
          <i style={{ height: `${Math.max(3, (value / peak) * 100)}%` }} />
          {lands && <em>T{done}</em>}
        </button>;
      })}
    </div>
    <div className="trackAxis">
      <span>FY25-26</span><span>+3 months</span><span>+6</span><span>+9</span><span>+12</span>
    </div>
  </div>;
}
