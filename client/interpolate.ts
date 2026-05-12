// Client-side clock interpolation. Anchor to last server-pushed value and
// extrapolate by performance.now() — clamped to 1 second past the anchor.

"use client";

import { useEffect, useState } from "react";

const MAX_EXTRAPOLATION_MS = 1_000;

export function useInterpolatedRemaining(
  anchorMs: number,
  anchorAt: number | null,
  running: boolean,
): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    let raf: number;
    const loop = () => {
      setTick((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  void tick;
  if (!running || anchorAt == null) return anchorMs;
  const elapsed = Math.min(Date.now() - anchorAt, MAX_EXTRAPOLATION_MS);
  return anchorMs - elapsed;
}
