'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A number that moves to its new value instead of jumping. Every figure in the
 * tool recomputes on every lever change, and a column of digits snapping at
 * once reads as a glitch; easing it reads as the model responding.
 */
export function useTween(value: number, ms = 420) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => { current.current = shown; }, [shown]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const from = current.current;
    if (from === value) return;
    const started = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - started) / ms);
      const eased = 1 - Math.pow(1 - t, 3);          // ease-out, no overshoot
      setShown(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);

  return shown;
}

export function Figure({ value, format }:
                       { value: number; format: (v: number) => string }) {
  return <>{format(useTween(value))}</>;
}
