"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { tripPath } from "@/lib/trip";
import { cn } from "@/lib/utils";

/**
 * Works the trip out again from scratch (fares and stays are searched anew) and shows the progress
 * screen, which opens the dashboard when it is done. For after a change that the figures on screen
 * cannot follow on their own: other dates, other modes, another guest. In `ratings` mode only the
 * AI's ratings are made again, from what is stored (nothing is searched): for scores that are "not
 * rated by the AI" or that a changed budget has made out of date. In `retry` mode only the searches that
 * failed last time are made again.
 */
export function RecomputeButton({
  tripId,
  className,
  children = "Recompute",
  mode = "everything",
  size = "large",
}: {
  tripId: string;
  className?: string;
  children?: string;
  mode?: "everything" | "ratings" | "retry";
  size?: "large" | "small";
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  // Busy until the progress screen has opened, and no longer: the page this button is on stays alive
  // behind it, so a flag only the failure path puts back would still say "Starting…" on the way back
  const [navigating, startNavigation] = useTransition();
  const busy = starting || navigating;
  const [problem, setProblem] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/trips/${tripId}/compute?${mode === "ratings" ? "rerate=1" : mode === "retry" ? "retry=1" : "force=1"}`, { method: "POST" });
      if (response.status === 409) {
        const body: { message?: string } = await response.json();
        throw new Error(body.message ?? "There is nothing to compute yet.");
      }
      if (!response.ok) throw new Error("Couldn’t start working out your trip, please try again.");
      startNavigation(() => router.push(tripPath(tripId, "/setup/computing")));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn’t start, please try again.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <span className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={cn(
          "flex cursor-pointer items-center gap-2.5 rounded-full border border-emerald-200/50 bg-[#3f7a62]/80 text-white outline-none transition-[background-color,transform] hover:bg-[#4a8a70]/90 focus-visible:ring-2 focus-visible:ring-emerald-300/60 active:scale-[0.97] disabled:cursor-wait disabled:opacity-70 [&_svg]:size-5 [&_svg]:stroke-[1.6]",
          size === "large" ? "h-[54px] px-6 text-xl" : "h-11 px-5 text-lg",
          className,
        )}
      >
        {mode === "ratings" ? <Sparkles aria-hidden className={cn(busy && "animate-pulse")} /> : <RefreshCw aria-hidden className={cn(busy && "animate-spin")} />}
        {busy ? "Starting…" : children}
      </button>
      {problem && (
        <span role="alert" className="text-base text-rose-200">
          {problem}
        </span>
      )}
    </span>
  );
}
