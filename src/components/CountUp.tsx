"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const DURATION_MS = 850;
const QUERY = "(prefers-reduced-motion: reduce)";

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * A figure that counts up from nothing when it appears, and from the old value to the new when it
 * changes. `format` writes the number down; while it counts it shows whole numbers only. Without
 * motion (the visitor asked for less) it just shows the value.
 */
export function CountUp({ value, format }: { value: number; format: (value: number) => string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (reduced) return;
    const from = latest.current;
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / DURATION_MS);
      latest.current = from + (value - from) * (1 - (1 - t) ** 3);
      setShown(latest.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);

  if (reduced) return <>{format(value)}</>;
  return <>{shown === value ? format(value) : format(Math.round(shown))}</>;
}
