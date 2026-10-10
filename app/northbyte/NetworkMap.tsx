'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Pause, Play, ZoomIn, ZoomOut } from 'lucide-react';
import map from '../data/northbyte-map.json';
import { routes, type Route } from './model';
import { FLIGHT_PATH } from './Brand';

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
      event.preventDefault();
      zoomAt(event.deltaY < 0 ? 1.18 : 1 / 1.18, event.clientX, event.clientY);
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
    flightsPerMonth: isPlan
      ? scenarioFlights[route.Route] / 12
      : (MONTHLY[route.Route]?.[selected] ?? 0),
  })).filter(r => r.geometry && r.flightsPerMonth > 0), [selected, isPlan, scenarioFlights]);

  const total = drawn.reduce((a, r) => a + r.flightsPerMonth, 0);
  const busiest = Math.max(...drawn.map(r => r.flightsPerMonth), 1);
  const totals = map.monthlyTotals as number[];
  // Sep 2024 - Feb 2025 is the pre-expansion window the plan rolls back toward,
  // so a flown month is best read against it; the plan is best read against now.
  const preExpansion = totals.slice(0, 6).reduce((a, v) => a + v, 0) / 6;
  const now = totals[totals.length - 1];
  const against = isPlan
    ? { value: now, label: `${monthLabel(months[months.length - 1])}` }
    : { value: preExpansion, label: 'the pre-expansion months' };
  const change = against.value > 0 ? Math.round((total / against.value - 1) * 100) : 0;

  return <div className="mapBlock">
    <div className="mapFrame">
      <svg ref={svg} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
           className={`mapSvg ${zoomed ? 'zoomed' : ''}`}
           onPointerDown={onPointerDown} onPointerMove={onPointerMove}
           onPointerUp={endDrag} onPointerLeave={endDrag}
           role="img"
           aria-label={`NorthByte network, ${isPlan ? 'recommended plan' : monthLabel(months[selected])}: ${Math.round(total)} flights in the month`}>
        {(map.neighbours as string[]).map((d, i) => <path key={`n${i}`} d={d} className="mapNeighbour" />)}
        {(map.land as string[]).map((d, i) => <path key={`l${i}`} d={d} className="mapLand" />)}
        {(map.lakes as string[]).map((d, i) => <path key={`w${i}`} d={d} className="mapWater" />)}

        {drawn.map(({ route, geometry, flightsPerMonth }) => (
          <path key={route.Route}
                d={`M${geometry!.x1} ${geometry!.y1}Q${geometry!.cx} ${geometry!.cy} ${geometry!.x2} ${geometry!.y2}`}
                fill="none" stroke={COHORT_COLOUR[route.Cohort]}
                strokeWidth={(0.5 + (flightsPerMonth / busiest) * 2.2) * k}
                strokeOpacity={0.22} />
        ))}

        <Traffic drawn={drawn} busiest={busiest} scale={k} />

        {Object.entries(AIRPORTS).map(([code, a]) => (
          <circle key={code} cx={a.x} cy={a.y} r={(HUBS.includes(code) ? 4 : 2.5) * k} className="mapDot" />
        ))}
        {HUBS.filter(code => AIRPORTS[code]).map(code => (
          <text key={code} x={AIRPORTS[code].x + 9 * k} y={AIRPORTS[code].y + 4 * k}
                fontSize={13 * k} strokeWidth={3 * k} className="mapLabel">{code}</text>
        ))}
      </svg>

      <div className="mapZoom">
        <button className="pill" onClick={() => zoomAt(1.5)} aria-label="Zoom in"><ZoomIn size={14} /></button>
        <button className="pill" onClick={() => zoomAt(1 / 1.5)} aria-label="Zoom out"><ZoomOut size={14} /></button>
        <button className="pill" onClick={() => setBox(BASE)} aria-label="Reset the view"
                disabled={!zoomed}><Maximize2 size={14} /></button>
      </div>

      <div className="mapReadout">
        <small>{isPlan ? 'Recommended plan' : monthLabel(months[selected])}</small>
        <b>{Math.round(total).toLocaleString('en-US')}</b>
        <span>flights in the month</span>
        {/* Against the busiest month flown, so the size of the cut is legible
            without clicking back and forth. */}
        <span className={`mapDelta ${change > 0 ? 'up' : ''}`}>
          {change === 0 ? `level with ${against.label}`
            : `${change < 0 ? '−' : '+'}${Math.abs(change)}% vs ${against.label}`}
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
function Traffic({ drawn, busiest, scale }: { drawn: Drawn[]; busiest: number; scale: number }) {
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
      <g key={plane.id}><path d={FLIGHT_PATH} fill={plane.colour} /></g>
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
