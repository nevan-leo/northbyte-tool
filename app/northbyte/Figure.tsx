'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';

/**
 * A number that moves to its new value instead of jumping. Every figure in the
 * tool recomputes on every lever change, and a column of digits snapping at
 * once reads as a glitch; easing it reads as the model responding.
 */
/**
 * How long a figure takes to reach its new value. Dropped to ~100ms while a
 * slider is being dragged, so the numbers keep up with the hand, and back to
 * 420ms otherwise, where the easing is doing the reading.
 */
export const TweenSpeed = createContext(420);

export function useTween(value: number, override?: number) {
  const ms = useContext(TweenSpeed) ?? 420;
  const [shown, setShown] = useState(value);
  // Where the figure actually is, written inside the frame loop. Reading it
  // back from state a render later made each new target start from a stale
  // value, which showed up as a wobble at the head of a glide.
  const current = useRef(value);

  useEffect(() => {
    const duration = override ?? ms;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current.current = value;
      setShown(value);
      return;
    }
    const from = current.current;
    if (from === value) return;
    const started = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);          // ease-out, no overshoot
      const at = from + (value - from) * eased;
      current.current = at;
      setShown(at);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, ms, override]);

  return shown;
}

export function Figure({ value, format }:
                       { value: number; format: (v: number) => string }) {
  return <>{format(useTween(value))}</>;
}
