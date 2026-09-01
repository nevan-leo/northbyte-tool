'use client';

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';

export type RouteRecord = {
  code: string;
  origin: [number, number];
  destination: [number, number];
  originCode: string;
  destinationCode: string;
};

function arc(from: [number, number], to: [number, number]) {
  const points: [number, number][] = [];
  for (let i = 0; i <= 48; i += 1) {
    const t = i / 48;
    points.push([
      from[1] + (to[1] - from[1]) * t + Math.sin(Math.PI * t) * 4,
      from[0] + (to[0] - from[0]) * t,
    ]);
  }
  return points;
}

export default function RouteMap({ routes, selected, onSelect, networkMode = false }: { routes: RouteRecord[]; selected: number; onSelect: (index: number) => void; networkMode?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const overlayRef = useRef<LayerGroup | null>(null);
  const callbackRef = useRef(onSelect);
  callbackRef.current = onSelect;

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let cancelled = false;
    void import('leaflet').then(L => {
      if (cancelled || !container.current) return;
      const map = L.map(container.current, { zoomControl: true, attributionControl: true, minZoom: 2, maxZoom: 10 }).setView([48, -98], networkMode ? 3 : 4);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
        className: 'dark-map-tiles',
      }).addTo(map);
      mapRef.current = map;
      overlayRef.current = L.layerGroup().addTo(map);
      window.setTimeout(() => map.invalidateSize(), 0);
      draw(L, map);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw(L: typeof import('leaflet'), map: LeafletMap) {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.clearLayers();
    const shown = networkMode ? routes : [routes[selected]];

    shown.forEach(route => {
      const active = routes.indexOf(route) === selected;
      L.polyline(arc(route.origin, route.destination), { color: active ? '#d8ff5f' : '#82986b', weight: active ? 3 : 2, opacity: active ? 0.95 : 0.55, smoothFactor: 1 }).addTo(overlay);
    });

    const airports = new Map<string, { coords: [number, number]; routeIndex: number; hub: boolean }>();
    routes.forEach((route, index) => {
      airports.set(route.originCode, { coords: route.origin, routeIndex: index, hub: true });
      airports.set(route.destinationCode, { coords: route.destination, routeIndex: index, hub: false });
    });
    airports.forEach((airport, code) => {
      const isSelected = airport.routeIndex === selected;
      const icon = L.divIcon({
        className: '',
        html: `<button type="button" class="airport-marker ${airport.hub ? 'airport-hub' : ''} ${isSelected ? 'airport-selected' : ''}" aria-label="Select route via ${code}">${code}</button>`,
        iconSize: [38, 22],
        iconAnchor: [19, 11],
      });
      L.marker([airport.coords[1], airport.coords[0]], { icon, keyboard: true, title: `Select route via ${code}` }).on('click', () => callbackRef.current(airport.routeIndex)).addTo(overlay);
    });

    if (networkMode) {
      map.setView([48, -98], 3, { animate: true });
    } else {
      const route = routes[selected];
      map.fitBounds([[route.origin[1], route.origin[0]], [route.destination[1], route.destination[0]]], { padding: [70, 70], maxZoom: 5, animate: true });
    }
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    void import('leaflet').then(L => draw(L, map));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, networkMode, routes]);

  return <div ref={container} className="realMap" aria-label="Interactive OpenStreetMap showing U.S.–Canada candidate airline routes" />;
}
