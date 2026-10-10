'use client';

// A maple leaf, drawn once, used as the mark and the favicon. The eleven-point
// leaf is the one on the flag, not an approximation of it.
export const MAPLE_LEAF_PATH =
  'M50 6 L56.8 24.4 L72.3 13.2 L67.9 32.9 L84.6 29.4 L77.3 41.6 L96 45.8 '
  + 'L81.4 57.7 L87.5 62.6 L68.2 76.7 L71.4 86.5 L54.3 83.5 L53.2 94 '
  + 'L46.8 94 L45.7 83.5 L28.6 86.5 L31.8 76.7 L12.5 62.6 L18.6 57.7 '
  + 'L4 45.8 L22.7 41.6 L15.4 29.4 L32.1 32.9 L27.7 13.2 L43.2 24.4 Z';

export function MapleLeaf({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className}
         aria-hidden="true" focusable="false">
      <path d={MAPLE_LEAF_PATH} fill="currentColor" />
    </svg>
  );
}

// A filled silhouette rather than a line icon: at twelve pixels a stroked glyph
// turns to mush, and these are drawn a hundred at a time. Nose points along +x
// so a single rotation aligns it with the heading.
export const PLANE_PATH =
  'M11 0 L7.6 1.8 L5.4 4.2 L-4 3.2 L-6.4 4.6 L0.6 7.2 L-1 9.4 L-5.2 9.2 '
  + 'L-6.6 10.4 L-2.6 11.8 L-2.6 -11.8 L-6.6 -10.4 L-5.2 -9.2 L-1 -9.4 '
  + 'L0.6 -7.2 L-6.4 -4.6 L-4 -3.2 L5.4 -4.2 L7.6 -1.8 Z';
