"use client";

import { useEffect, useRef, useState } from "react";
import type { StayAnalysisState } from "@/server/services/stays";

const POLL_MS = 1500;
/** The AI can take a minute: past this the worker is probably away, and asking for ever helps no one */
const MAX_POLLS = 100;

export type Advice = StayAnalysisState | { state: "loading" } | { state: "error" };

/**
 * "Why this?" on one accommodation (use-cases.md B-S6): the one time the dashboard asks the AI, because
 * the user clicked for it. Asks the server, which answers at once with the stored rating and starts
 * the AI on an explanation when there is none yet; then follows along until it arrives. `askAgain`
 * asks for an explanation written for what the stay and the group are now.
 */
export function useStayAdvice(stayId: string): { shown: Advice; askAgain: () => void } {
  const [shown, setShown] = useState<Advice>({ state: "loading" });
  // Asking again is started from a click, but follows along with the same loop as the first ask
  const again = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    async function ask(refresh: boolean) {
      clearTimeout(timer);
      try {
        const response = await fetch(
          `/api/stays/${stayId}/analysis`,
          refresh ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh: true }) } : undefined,
        );
        if (!response.ok) throw new Error(`Analysis answered ${response.status}`);
        const answer: StayAnalysisState = await response.json();
        if (cancelled) return;
        setShown(answer);
        if (answer.state === "pending") {
          // The worker may be away: stop asking after a while rather than for ever
          if (++polls < MAX_POLLS) timer = setTimeout(() => ask(false), POLL_MS);
          else setShown({ state: "unavailable", message: "It is taking too long: is the worker running?", previous: answer.previous });
        }
      } catch {
        if (!cancelled) setShown({ state: "error" });
      }
    }
    again.current = () => {
      polls = 0;
      ask(true);
    };
    ask(false);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stayId]);

  return { shown, askAgain: () => again.current() };
}
