"use client";

import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ExtraAdviceStatus } from "@/server/services/extraAdvice";
import type { ExtraAdviceView } from "@/server/services/extraView";

/** How often to ask whether the advice is written, while it is */
const POLL_MS = 2500;

const minus = (eur: number) => `−${Math.round(eur)} €`;

/** What a group line saves: each guest's the same in general, a range when it differs; the guest's own in their view */
function groupSaving(savingEachEur: Record<string, number>, viewerId: string | null): string {
  if (viewerId) return minus(savingEachEur[viewerId] ?? 0);
  const values = Object.values(savingEachEur).map(Math.round);
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? `${minus(low)} each` : `−${low} to ${high} € each`;
}

/**
 * The advice on fitting the Extra into the budgets (use-cases.md R12): written while the trip was set up, by the AI or,
 * without it, by the rules, and said so. The euros are the app's. When a budget, the ❤ stay, an offer or the dates
 * changed since, it says it may be out of date; "Ask again" has the worker write it anew and the page waits for it.
 */
export function ExtraAdvicePanel({
  destinationId,
  advice,
  pending,
  viewer,
}: {
  destinationId: string;
  advice: ExtraAdviceView | null;
  pending: boolean;
  /** The guest whose view this is, or null for everyone */
  viewer: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [waiting, setWaiting] = useState(pending);
  // Each answer that says "still writing" asks once more
  const [polls, setPolls] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // While the advice is being written, ask how it is going; once it is, read the page again
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/destinations/${destinationId}/extra-advice`);
        if (!response.ok) throw new Error(String(response.status));
        const status: ExtraAdviceStatus = await response.json();
        if (cancelled) return;
        if (status.pending) setPolls((count) => count + 1);
        else {
          setWaiting(false);
          router.refresh();
        }
      } catch {
        if (!cancelled) setError("Couldn't reach the server to ask. Is the app still running?");
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [waiting, polls, destinationId, router]);

  async function askAgain() {
    setError(null);
    try {
      const response = await fetch(`/api/destinations/${destinationId}/extra-advice`, { method: "POST" });
      if (!response.ok) throw new Error(String(response.status));
      setWaiting(true);
    } catch {
      setError("Couldn't ask for the advice. Is the app still running?");
    }
  }

  const ownLines = viewer ? advice?.guests.find((guest) => guest.guestId === viewer.id) : null;

  return (
    <section
      aria-label="Advice"
      aria-busy={waiting}
      className="relative overflow-hidden rounded-[32px] border border-violet-300/40 bg-[#2b2347]/55 p-8 text-white shadow-[0_0_36px_rgb(139_92_246/0.3)] backdrop-blur-md"
    >
      <header className="flex flex-wrap items-center gap-4">
        <Sparkles aria-hidden className="size-7 stroke-[1.5] text-violet-200" />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-normal">Advice</h2>
          <p className="text-base text-violet-100/75">
            {waiting
              ? "Writing the advice for the trip as it is now…"
              : advice
                ? advice.source === "ai"
                  ? "Written by the AI. The euros are the app's own."
                  : "Rule-based: not written by the AI."
                : "How to fit what the trip costs once there into each budget."}
          </p>
        </div>
        {advice?.stale && !waiting && <span className="rounded-full bg-amber-300/25 px-3 py-1 text-base text-amber-50">May be out of date</span>}
        {!waiting && (
          <button
            type="button"
            onClick={askAgain}
            className="flex h-11 cursor-pointer items-center gap-2 rounded-full border border-violet-300/50 bg-violet-400/25 px-5 text-lg outline-none transition-[background-color,transform] hover:bg-violet-400/40 focus-visible:ring-2 focus-visible:ring-violet-200/70 active:scale-[0.97]"
          >
            <RefreshCw aria-hidden className="size-5 stroke-[1.6]" />
            {advice ? "Ask again" : "Ask for advice"}
          </button>
        )}
      </header>

      {advice?.stale && !waiting && (
        <p role="status" className="mt-5 flex items-center gap-3 rounded-[16px] bg-amber-300/15 px-4 py-3 text-base text-amber-50">
          <AlertTriangle aria-hidden className="size-5 shrink-0 stroke-[1.6]" />
          A budget, the ❤ stay, an offer or the dates changed since this was written.
        </p>
      )}
      {advice?.message && <p className="mt-3 text-sm break-words text-violet-100/60">{advice.message}</p>}
      {error && (
        <p role="alert" className="mt-4 text-base text-rose-100">
          {error}
        </p>
      )}

      {advice && (
        <div className={cn("mt-6 flex flex-col gap-5 text-lg transition-opacity duration-500", waiting && "opacity-55")}>
          {advice.group.length > 0 && (
            <div>
              <h3 className="text-base text-violet-100/70">For everyone</h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {advice.group.map((line) => (
                  <li key={`${line.lever}-${line.steps}`} className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span>{line.text}</span>
                    <span className="whitespace-nowrap text-emerald-200">{groupSaving(line.savingEachEur, viewer?.id ?? null)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(viewer ? (ownLines ? [ownLines] : []) : advice.guests).map((guest) => (
            <div key={guest.guestId}>
              <h3 className="text-base text-violet-100/70">{guest.name}</h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {guest.lines.map((line) => (
                  <li key={`${line.lever}-${line.steps}`} className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span>{line.text}</span>
                    <span className="whitespace-nowrap text-emerald-200">{minus(line.savingEur)}</span>
                  </li>
                ))}
              </ul>
              <p className={cn("mt-2 text-base", guest.fits ? "text-emerald-200" : "text-amber-100")}>
                {guest.fits
                  ? `With this, ≈ ${Math.round(guest.afterEur)} € of ${guest.budgetEur} €.`
                  : `Still ≈ ${Math.round(guest.afterEur)} € of ${guest.budgetEur} €: it does not fit, even with these.`}
              </p>
            </div>
          ))}

          {viewer && !ownLines && <p className="text-violet-100/80">No advice for {viewer.name}.</p>}
          {!viewer && advice.group.length === 0 && advice.guests.length === 0 && <p className="text-violet-100/80">No advice for this destination: nobody needed any when it was written.</p>}
        </div>
      )}
    </section>
  );
}
