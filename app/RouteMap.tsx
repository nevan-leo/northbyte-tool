'use client';

import { useEffect, useRef } from 'react';

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
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t + Math.sin(Math.PI * t) * 4,
    ]);
  }
  return points;
}

export default function RouteMap({ routes, selected, onSelect, networkMode = false }: { routes: RouteRecord[]; selected: number; onSelect: (index: number) => void; networkMode?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const callbackRef = useRef(onSelect);
  callbackRef.current = onSelect;

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let cancelled = false;
    void import('maplibre-gl').then(({ default: maplibregl }) => {
      if (cancelled || !container.current) return;
      const map = new maplibregl.Map({
        container: container.current,
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: [-98, 48],
        zoom: networkMode ? 2.65 : 2.85,
        minZoom: 2,
        maxZoom: 10,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      map.on('load', () => {
        if (cancelled) return;
        map.addSource('route-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'routes-shadow', type: 'line', source: 'route-lines', paint: { 'line-color': '#07100a', 'line-width': 6, 'line-opacity': 0.7 } });
        map.addLayer({ id: 'routes', type: 'line', source: 'route-lines', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'] } });
        mapRef.current = map;
        refreshMap(map, maplibregl);
      });
    });
    return () => { cancelled = true; markersRef.current.forEach(marker => marker.remove()); markersRef.current = []; mapRef.current?.remove(); mapRef.current = null; };
  // The map is intentionally created once; updates are handled below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshMap(map: any, maplibregl: any) {
    const shown = networkMode ? routes : [routes[selected]];
    const features = shown.map((route, index) => ({
      type: 'Feature',
      properties: { color: networkMode && routes.indexOf(route) !== selected ? '#789064' : '#d8ff5f', width: networkMode && routes.indexOf(route) !== selected ? 1.8 : 3.2, opacity: networkMode && routes.indexOf(route) !== selected ? 0.52 : 0.96 },
      geometry: { type: 'LineString', coordinates: arc(route.origin, route.destination) },
    }));
    map.getSource('route-lines')?.setData({ type: 'FeatureCollection', features });
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    const airports = new Map<string, { coords: [number, number]; routeIndex: number; hub: boolean }>();
    routes.forEach((route, index) => {
      airports.set(route.originCode, { coords: route.origin, routeIndex: index, hub: true });
      airports.set(route.destinationCode, { coords: route.destination, routeIndex: index, hub: false });
    });
    airports.forEach((airport, code) => {
      const button = document.createElement('button');
      button.className = `airport-marker ${airport.hub ? 'airport-hub' : ''} ${airport.routeIndex === selected ? 'airport-selected' : ''}`;
      button.type = 'button';
      button.textContent = code;
      button.title = `Select route via ${code}`;
      button.onclick = () => callbackRef.current(airport.routeIndex);
      const marker = new maplibregl.Marker({ element: button, anchor: 'center' }).setLngLat(airport.coords).addTo(map);
      markersRef.current.push(marker);
    });
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    void import('maplibre-gl').then(({ default: maplibregl }) => {
      refreshMap(map, maplibregl);
      const route = routes[selected];
      if (!networkMode) {
        const bounds = new maplibregl.LngLatBounds(route.origin, route.origin).extend(route.destination);
        map.fitBounds(bounds, { padding: 90, maxZoom: 4.5, duration: 700 });
      } else {
        map.easeTo({ center: [-98, 48], zoom: 2.65, duration: 700 });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, networkMode, routes]);

  return <div ref={container} className="realMap" aria-label="Interactive map of U.S.–Canada candidate airline routes" />;
}
