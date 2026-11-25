"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SynthesisState } from "@/server/services/synthesis";

/** How often to ask how it is going while the AI writes. */
const POLL_MS = 2500;

/** GET asks where it stands; POST asks the worker for it (`refresh`: for the trip as it is now). */
async function callSynthesis(tripId: string, method: "GET" | "POST", refresh = false): Promise<SynthesisState> {
  const response = await fetch(
    `/api/trips/${tripId}/synthesis`,
    method === "POST" ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh }) } : { method },
  );
  if (!response.ok) throw new Error(`Synthesis answered ${response.status}`);
  return response.json();
}

/**
 * The AI's take on the destinations, as the page follows it. Turning it on asks for a synthesis
 * when nobody has yet; while it is being written the hook asks how it is going; when `factsHash`
 * changes (a ★, a ❤ or a budget moved) it finds out whether the answer still holds. `refresh`
 * asks again for the trip as it is now.
 */
export function useSynthesis(tripId: string, enabled: boolean, factsHash: string) {
  const [state, setState] = useState<SynthesisState | null>(null);
  const [error, setError] = useState(false);
  // Answers can arrive out of order: only the latest request counts
  const latest = useRef(0);

  const track = useCallback((request: Promise<SynthesisState>) => {
    const mine = ++latest.current;
    request.then(
      (next) => {
        if (mine !== latest.current) return;
        setState(next);
        setError(false);
      },
      () => {
        if (mine === latest.current) setError(true);
      },
    );
  }, []);

  useEffect(() => {
    if (enabled) track(callSynthesis(tripId, "POST"));
  }, [enabled, tripId, track]);

  const seenHash = useRef(factsHash);
  useEffect(() => {
    if (!enabled || factsHash === seenHash.current) return;
    seenHash.current = factsHash;
    track(callSynthesis(tripId, "GET"));
  }, [enabled, factsHash, tripId, track]);

  useEffect(() => {
    if (!enabled || state?.state !== "pending") return;
    const timer = setTimeout(() => track(callSynthesis(tripId, "GET")), POLL_MS);
    return () => clearTimeout(timer);
  }, [enabled, state, tripId, track]);

  const refresh = useCallback(() => track(callSynthesis(tripId, "POST", true)), [tripId, track]);
  return { state, error, refresh };
}
