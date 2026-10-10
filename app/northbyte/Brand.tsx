'use client';

// The aircraft glyph is Material Symbols "flight" (Apache 2.0), drawn on a
// 24x24 box with the nose pointing up. It is used for the mark, the favicon and
// every aircraft on the map, so the whole tool speaks with one shape.
export const FLIGHT_PATH =
  'M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19'
  + 'l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z';

/** Nose up by default; pass a rotation to point it along a heading. */
export function Flight({ size = 20, rotate = 0, className }:
                       { size?: number; rotate?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}
         aria-hidden="true" focusable="false">
      <path d={FLIGHT_PATH} fill="currentColor"
            transform={rotate ? `rotate(${rotate} 12 12)` : undefined} />
    </svg>
  );
}
