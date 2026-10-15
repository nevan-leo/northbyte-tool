'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Pause, Play } from 'lucide-react';
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
const LABEL_LEFT = ['YOW', 'YXU', 'YQM', 'YHZ', 'YYZ', 'YVR', 'YXX', 'YYT'];
// Named as well as the nine busiest: the two in the north, the two the prairie
// routes run through, and the one on the east coast. They stand alone on the
// map, so naming them costs no legibility. Regina sits on top of Saskatoon and
// stays unnamed.
const ALSO_NAMED = ['YXY', 'YZF', 'YWG', 'YXE', 'YYT'];
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
// Focus mode: the lever's own cohort forward, everything else back to a trace.
const FOCUS_OPACITY = 0.9;
const FADED_OPACITY = 0.15;
// The stable routes are drawn thin and quiet by design - they are the network
// holding steady behind the argument - so lifting their opacity alone barely
// shows. While their lever is being worked they are drawn boldly instead.
const FOCUS_WEIGHT: Record<Route['Cohort'], number> = {
  Protect: 2.8, Restore: 1.75, Decide: 1.35,
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

/** A frame around a set of airports, with room to breathe. */
function frameAround(codes: string[], pad = 150): Box {
  const pts = codes.map(code => AIRPORTS[code]).filter(Boolean);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
  // Keep the base aspect ratio, growing the short side rather than squashing.
  const ratio = BASE.h / BASE.w;
  const box = h / w > ratio ? { w: h / ratio, h } : { w, h: w * ratio };
  return { w: box.w, h: box.h, x: x + w / 2 - box.w / 2, y: y + h / 2 - box.h / 2 };
}

const CAMERAS = [
  { key: 'whole', label: 'Whole network', box: BASE },
  // Halifax in the east, London in the west: the corridor the plan's new
  // routes run through. St John's sits well outside it and stays out of frame.
  { key: 'corridor', label: 'Central Corridor',
    box: frameAround(['YXU', 'YYZ', 'YOW', 'YUL', 'YHZ'], 70) },
] as const;
type CameraKey = typeof CAMERAS[number]['key'];

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
  forecast, todayProfit, fareGain, selected, onSelect, playing, onTogglePlay, focus,
}: {
  forecast: ForecastStep[];           // annual flights per route, month by month
  todayProfit: number;                // profit after gates as things stand
  fareGain: number;                   // what the fare lever is winning, in dollars
  selected: number;                   // 0 = today, 1..n = months ahead
  onSelect: (index: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  focus: Route['Cohort'] | null;      // the lever being worked, if any
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

  // Camera moves are animated rather than cut, so the audience keeps its place
  // on the map. Any drag or pinch cancels the flight in progress.
  const flight = useRef<number | undefined>(undefined);
  const [camera, setCamera] = useState<CameraKey>('whole');
  const flyTo = useCallback((target: Box, key?: CameraKey) => {
    if (flight.current) cancelAnimationFrame(flight.current);
    if (key) setCamera(key);
    const started = performance.now();
    const DURATION = 620;
    let from: Box | null = null;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / DURATION);
      const ease = 1 - Math.pow(1 - t, 3);
      setBox(current => {
        from ??= current;
        return clamp({
          x: from.x + (target.x - from.x) * ease,
          y: from.y + (target.y - from.y) * ease,
          w: from.w + (target.w - from.w) * ease,
          h: from.h + (target.h - from.h) * ease,
        });
      });
      if (t < 1) flight.current = requestAnimationFrame(tick);
    };
    flight.current = requestAnimationFrame(tick);
  }, [clamp]);
  useEffect(() => () => { if (flight.current) cancelAnimationFrame(flight.current); }, []);

  // Working the new-routes lever frames the corridor those routes live in, and
  // lets go of it again when the hand leaves. A corridor the audience asked for
  // by clicking the button is theirs to keep, so only an automatic frame is
  // taken back.
  const autoFramed = useRef(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (focus === 'Decide') {
        if (autoFramed.current) return;
        autoFramed.current = true;
        flyTo(CAMERAS[1].box, 'corridor');
      } else if (autoFramed.current) {
        autoFramed.current = false;
        flyTo(BASE, 'whole');
      }
    });
    return () => cancelAnimationFrame(id);
  }, [focus, flyTo]);

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
      // One notch should move the frame noticeably: a soft cap on the distance
      // keeps a trackpad flick from jumping the whole way in a single frame.
      const stepSize = Math.min(Math.abs(pixels), 60) / 60;
      zoomAt(Math.pow(1.45, pixels < 0 ? stepSize : -stepSize), event.clientX, event.clientY);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (flight.current) cancelAnimationFrame(flight.current);
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


  // The focused cohort is drawn last, so it sits on top of the rest.
  const ordered = useMemo(() => (focus
    ? [...drawn].sort((a, b) => Number(a.route.Cohort === focus) - Number(b.route.Cohort === focus))
    : drawn), [drawn, focus]);

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
    <div className="mapHead">
      <div className="mapReadout">
        <small>{isForecast ? `Forecast · ${step.label}` : 'FY25-26 as flown'}</small>
        <b><Figure value={total * 12} format={v => Math.round(v).toLocaleString('en-US')} /></b>
        <span>flights a year ·{' '}
          <b><Figure value={total} format={v => Math.round(v).toLocaleString('en-US')} /></b>
          {' '}in an average month</span>
      </div>
      <div className="mapHeadRight">
        <p className={`mapDelta ${isForecast && recovered > 0 ? 'up' : ''}`}>
          {isForecast
            ? <>Profit this frequency would earn over a year: <Figure value={recovered} format={signed} /></>
            : `${change < 0 ? '−' : '+'}${Math.abs(change)}% flights vs the pre-expansion months`}
        </p>
        {isForecast && <p className="mapSame">
          {sameMonthChange === 0
            ? 'level with'
            : `${sameMonthChange > 0 ? '+' : '−'}${Math.abs(sameMonthChange)}% on`}
          {' '}FY25-26
        </p>}
        <div className="mapZoom" role="group" aria-label="Camera">
          {CAMERAS.map(preset => (
            <button key={preset.key} className={`pill ${camera === preset.key ? 'active' : ''}`}
                    aria-pressed={camera === preset.key}
                    aria-label={preset.label} title={preset.label}
                    onClick={() => { autoFramed.current = false; flyTo(preset.box, preset.key); }}>
              {preset.key === 'whole' ? <Maximize2 size={14} aria-hidden /> : preset.label}
            </button>
          ))}
        </div>
      </div>
    </div>

    <div className="mapFrame">
      <svg ref={svg} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
           className={`mapSvg ${zoomed ? 'zoomed' : ''}`}
           onPointerDown={onPointerDown} onPointerMove={onPointerMove}
           onPointerUp={endDrag} onPointerLeave={endDrag}
           role="img"
           aria-label={`NorthByte network, ${isForecast ? `forecast ${step.label}` : 'FY25-26 as flown'}: ${Math.round(total * 12)} flights a year, ${Math.round(total)} in an average month`}>
        <Basemap />

        {ordered.map(({ route, geometry, flightsPerMonth }) => {
          const base = route.Cohort === 'Protect'
            ? COHORT_OPACITY.Protect + (PROTECT_OPACITY_AT_FULL_FARES - COHORT_OPACITY.Protect)
              * Math.min(1, Math.max(0, fareGain / FARE_GAIN_FOR_FULL))
            : COHORT_OPACITY[route.Cohort];
          // While a lever is being worked, its own cohort comes forward and the
          // rest drop back. No new colour: the same arcs, quieter.
          const opacity = !focus ? base
            : route.Cohort === focus ? Math.max(base, FOCUS_OPACITY)
            : FADED_OPACITY;
          const d = `M${geometry!.x1} ${geometry!.y1}Q${geometry!.cx} ${geometry!.cy} ${geometry!.x2} ${geometry!.y2}`;
          const bold = focus === route.Cohort ? FOCUS_WEIGHT[route.Cohort] : 1;
          const width = (0.5 + (flightsPerMonth / BUSIEST_EVER) * 2.2)
            * k * COHORT_WEIGHT[route.Cohort] * bold;
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

        <Traffic drawn={ordered} scale={k} focus={focus} />

        {Object.entries(AIRPORTS).map(([code, a]) => (
          <circle key={code} cx={a.x} cy={a.y} r={(HUBS.includes(code) ? 4 : 3) * k} className="mapDot" />
        ))}
        {/* Only the busiest airports are named: twenty labels at this scale
            overlap into mush. Labels sit to the left for the eastern cluster so
            they do not pile up on the routes leaving it. */}
        {Object.entries(AIRPORTS)
          .filter(([code, a]) => a.rank < 9 || ALSO_NAMED.includes(code)).map(([code, a]) => {
          const flip = LABEL_LEFT.includes(code);
          return <text key={code} x={a.x + (flip ? -8 : 8) * k} y={a.y + 4 * k}
                       textAnchor={flip ? 'end' : 'start'}
                       fontSize={13 * k} strokeWidth={3.5 * k} className="mapLabel">{code}</text>;
        })}
      </svg>

    </div>

    <Timeline forecast={forecast} now={now} selected={selected} onSelect={onSelect}
              playing={playing} onTogglePlay={onTogglePlay} />

    <p className="legend">
      <i className="rule restore" /> Doubled routes
      <i className="rule decide" /> New routes
      <i className="rule protect" /> Stable routes
      <span className="legendNote">
        One aircraft stands for about {Math.round(FLIGHTS_PER_PLANE)} flights a month.
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
function Traffic({ drawn, scale, focus }: {
  drawn: Drawn[]; scale: number; focus: Route['Cohort'] | null;
}) {
  const group = useRef<SVGGElement>(null);

  const fleet = useMemo(() => drawn.flatMap(({ route, geometry, flightsPerMonth }) => {
    // A route that is still flying always shows at least one aircraft. Thin
    // routes - Whitehorse flies six a month each way - rounded to none, so the
    // north read as abandoned when it is not. Nothing flying still draws none.
    const count = flightsPerMonth < 0.5 ? 0
      : Math.min(MAX_PLANES_PER_ROUTE,
                 Math.max(1, Math.round(flightsPerMonth / FLIGHTS_PER_PLANE)));
    return Array.from({ length: count }, (_, i) => ({
      id: `${route.Route}-${i}`,
      colour: COHORT_COLOUR[route.Cohort],
      opacity: !focus ? PLANE_OPACITY[route.Cohort]
        : route.Cohort === focus ? 1 : FADED_OPACITY,
      outlined: route.Cohort === 'Decide',
      geometry: geometry!,
      offset: i / count,
      // A little variation per route stops the whole network pulsing in step.
      speed: 0.85 + ((route.Route.charCodeAt(0) + route.Route.charCodeAt(4)) % 7) * 0.05,
    }));
  }), [drawn, focus]);

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
        // Mark only the month a whole quarter of the rollout finishes landing.
        // The rollout runs continuously, so comparing the raw value marked
        // every month instead of the four that complete one.
        const done = index > 0 ? Math.floor(stepOf.tranche + 1e-9) : 0;
        const doneBefore = index > 1 ? Math.floor(forecast[index - 2].tranche + 1e-9) : 0;
        const lands = done > doneBefore && done >= 1;
        return <button key={index}
                className={`tick ${index === 0 ? 'now' : 'ahead'} ${selected === index ? 'on' : ''}`}
                onClick={() => onSelect(index)}
                aria-label={index === 0
                  ? `FY25-26 as flown, ${Math.round(value).toLocaleString('en-US')} flights in an average month`
                  : `${stepOf.label}, ${Math.round(value).toLocaleString('en-US')} flights, ` +
                    `quarter ${stepOf.tranche.toFixed(1)} of the rollout done`}
                aria-pressed={selected === index}>
          <i style={{ height: `${Math.max(3, (value / peak) * 100)}%` }} />
          <u>{index === 0 ? 'now' : index}</u>
          {lands && <em>Q{done}</em>}
        </button>;
      })}
    </div>
    <div className="trackAxis"><span>Months from now</span></div>
  </div>;
}
