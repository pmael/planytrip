"use client";

import { AlertTriangle, ArrowLeftRight, Crown, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { Synthesis } from "@/ai/destination-synthesis";
import { guestHue } from "@/lib/deliberationText";
import { cn } from "@/lib/utils";
import type { DeliberationGuest, Dossier } from "@/server/services/deliberation";
import type { SynthesisResult, SynthesisState } from "@/server/services/synthesis";
import { GuestAvatar } from "./GuestAvatar";

export const VERDICT_STYLE = {
  good: { hex: "#2ec48f", label: "Good fit" },
  ok: { hex: "#c9a227", label: "Workable" },
  bad: { hex: "#d33a2f", label: "Poor fit" },
} as const;

const CONFIDENCE_LABEL = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" } as const;

/** "just now", "3 min ago", "2 h ago" */
function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** Seconds since `active` became true, counted for real: the wait is shown as it is. */
function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const began = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - began) / 1000)), 1000);
    return () => {
      clearInterval(timer);
      setElapsed(0);
    };
  }, [active]);
  return elapsed;
}

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block h-5 animate-[ai-shimmer_1.8s_linear_infinite] rounded-full bg-[linear-gradient(90deg,rgb(255_255_255/0.08)_25%,rgb(196_181_253/0.35)_50%,rgb(255_255_255/0.08)_75%)] bg-[length:200%_100%]",
        className,
      )}
    />
  );
}

function Orb({ thinking }: { thinking?: boolean }) {
  return (
    <span className="relative flex size-14 shrink-0 items-center justify-center">
      <span aria-hidden className={cn("absolute inset-0 rounded-full bg-violet-400/40 blur-md", thinking && "animate-[ai-breathe_1.6s_ease-in-out_infinite]")} />
      <span className="relative flex size-14 items-center justify-center rounded-full border border-violet-200/50 bg-violet-500/70">
        <Sparkles aria-hidden className={cn("size-7 stroke-[1.6]", thinking && "animate-[ai-breathe_1.2s_ease-in-out_infinite]")} />
      </span>
      {thinking && (
        <span aria-hidden className="absolute inset-[-6px] animate-[ai-orbit_3s_linear_infinite] rounded-full border-2 border-transparent border-t-violet-200/80" />
      )}
    </span>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("rounded-full px-3 py-1 text-base", className)}>{children}</span>;
}

/** What the AI said, in full. */
function Reading({
  synthesis,
  destinations,
  guests,
  recommendedId,
  onOpen,
}: {
  synthesis: Synthesis;
  destinations: Dossier[];
  guests: DeliberationGuest[];
  recommendedId: string | null;
  onOpen: (destinationId: string) => void;
}) {
  const pick = destinations.find((d) => d.id === synthesis.pickDestinationId);
  const agrees = recommendedId !== null && pick?.id === recommendedId;

  return (
    <div className="grid animate-[fade-up_0.5s_ease-out_both] gap-10 lg:grid-cols-[1.35fr_1fr]">
      <div className="flex flex-col gap-5">
        <div>
          <p className="flex items-center gap-2 text-lg text-violet-100/80">
            <Crown aria-hidden className="size-5 stroke-[1.6]" />
            If it were up to the AI
          </p>
          <h3 className="mt-1 text-5xl font-normal">{pick?.shortLabel ?? "—"}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip className="bg-violet-300/25 text-violet-50">{CONFIDENCE_LABEL[synthesis.confidence]}</Chip>
          {recommendedId !== null && (
            <Chip className={agrees ? "bg-emerald-300/25 text-emerald-50" : "bg-amber-300/25 text-amber-50"}>
              {agrees ? "Agrees with the ranking" : `Differs from the ranking${pick ? ` (#${pick.rank})` : ""}`}
            </Chip>
          )}
        </div>
        <p className="text-2xl leading-snug text-white">{synthesis.headline}</p>
        <p className="text-xl leading-relaxed text-white/80">{synthesis.reasoning}</p>
      </div>

      <div className="flex flex-col gap-8">
        <div>
          <h4 className="mb-3 text-xl text-violet-100/80">How each destination scores</h4>
          <ul className="flex flex-col gap-3">
            {destinations.map((destination) => {
              const verdict = synthesis.destinations.find((d) => d.destinationId === destination.id);
              if (!verdict) return null;
              const style = VERDICT_STYLE[verdict.verdict];
              return (
                <li key={destination.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(destination.id)}
                    className="group flex w-full cursor-pointer items-center gap-4 rounded-full px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-200/70"
                  >
                    <span className="w-[190px] shrink-0 truncate text-xl group-hover:underline" title={destination.shortLabel}>{destination.shortLabel}</span>
                    <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/10">
                      <span
                        className="absolute inset-y-0 left-0 animate-[progress-fill_0.9s_cubic-bezier(0.22,1,0.36,1)_both] rounded-full"
                        style={{ width: `${verdict.score}%`, backgroundColor: style.hex, boxShadow: `0 0 12px ${style.hex}` }}
                      />
                    </span>
                    <span className="w-10 text-right text-xl tabular-nums">{verdict.score}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {synthesis.tradeoffs.length > 0 && (
          <div>
            <h4 className="mb-3 text-xl text-violet-100/80">What would change its mind</h4>
            <ul className="flex flex-col gap-2.5 text-lg text-white/85">
              {synthesis.tradeoffs.map((tradeoff) => (
                <li key={tradeoff} className="flex gap-3">
                  <ArrowLeftRight aria-hidden className="mt-1 size-5 shrink-0 stroke-[1.6] text-violet-200" />
                  {tradeoff}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {synthesis.guests.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-3">
          {synthesis.guests.map((note) => {
            const index = guests.findIndex((g) => g.id === note.guestId);
            if (index < 0) return null;
            return (
              <li key={note.guestId} className="flex items-start gap-4 rounded-[22px] bg-white/[0.08] p-4">
                <GuestAvatar name={guests[index].name} hue={guestHue(index)} size={44} />
                <p className="text-lg leading-snug text-white/85">{note.note}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The AI's take on the destinations (use-cases.md UC-C): which one it would go for with everything
 * the page shows, why, and what would change its mind. It says when it is out of date, and the
 * rest of the page works without it.
 */
export function AiPanel({
  state,
  error,
  onRefresh,
  destinations,
  guests,
  recommendedId,
  onOpen,
}: {
  state: SynthesisState | null;
  error: boolean;
  onRefresh: () => void;
  destinations: Dossier[];
  guests: DeliberationGuest[];
  recommendedId: string | null;
  onOpen: (destinationId: string) => void;
}) {
  const pending = state === null || state.state === "pending";
  const elapsed = useElapsedSeconds(pending && !error);

  const shown: SynthesisResult | null =
    state === null || state.state === "none" ? null : state.state === "ready" ? state.current : state.previous;
  const stale = shown !== null && !shown.fresh && state?.state === "ready";

  return (
    <section
      aria-label="The AI's take"
      className="relative overflow-hidden rounded-[44px] border border-violet-300/40 bg-[#2b2347]/55 p-9 text-white shadow-[0_0_44px_rgb(139_92_246/0.38)] backdrop-blur-md"
    >
      <span aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-[420px] rounded-full bg-violet-500/25 blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-40 -left-20 size-[360px] rounded-full bg-fuchsia-500/15 blur-3xl" />

      <div className="relative flex flex-col gap-8">
        <header className="flex flex-wrap items-center gap-5">
          <Orb thinking={pending && !error} />
          <div className="min-w-0 flex-1">
            <h2 className="text-3xl font-normal">The AI&rsquo;s take</h2>
            <p className="text-lg text-violet-100/75">
              {pending
                ? shown
                  ? "Reading the figures again…"
                  : `Claude is reading the figures… ${elapsed} s`
                : shown
                  ? `Written ${timeAgo(shown.createdAt)} from the figures on this page`
                  : "It weighs budgets, journeys, dates and who wants what."}
            </p>
          </div>
          {shown && !pending && (
            <Chip className={shown.fresh ? "bg-emerald-300/25 text-emerald-50" : "bg-amber-300/25 text-amber-50"}>
              {shown.fresh ? "Up to date" : "Out of date"}
            </Chip>
          )}
          {!pending && state?.state !== "none" && (
            <button
              type="button"
              onClick={onRefresh}
              className="flex h-12 cursor-pointer items-center gap-2.5 rounded-full border border-violet-300/50 bg-violet-400/25 px-5 text-lg outline-none transition-[background-color,transform] hover:bg-violet-400/40 focus-visible:ring-2 focus-visible:ring-violet-200/70 active:scale-[0.97]"
            >
              <RefreshCw aria-hidden className="size-5 stroke-[1.6]" />
              {state?.state === "unavailable" ? "Try again" : "Refresh"}
            </button>
          )}
        </header>

        {stale && (
          <p role="status" className="flex items-center gap-3 rounded-[18px] bg-amber-300/15 px-5 py-3 text-lg text-amber-50">
            <AlertTriangle aria-hidden className="size-6 shrink-0 stroke-[1.6]" />
            A ★, a ❤ or a budget has changed since this was written. Refresh to take it into account.
          </p>
        )}

        {state?.state === "unavailable" && (
          <div role="alert" className="flex items-start gap-3 rounded-[18px] bg-rose-300/15 px-5 py-4 text-rose-50">
            <AlertTriangle aria-hidden className="mt-0.5 size-6 shrink-0 stroke-[1.6]" />
            <div>
              <p className="text-lg">The AI isn&rsquo;t available right now. The rest of the page works without it.</p>
              <p className="mt-1 text-base break-words text-rose-100/70">{state.message}</p>
            </div>
          </div>
        )}

        {error && state === null && (
          <p role="alert" className="text-lg text-rose-100">
            Couldn&rsquo;t reach the server to ask. Is the app still running?
          </p>
        )}

        {shown ? (
          <div className={cn("transition-opacity duration-500", pending && "opacity-55")}>
            <Reading synthesis={shown.synthesis} destinations={destinations} guests={guests} recommendedId={recommendedId} onOpen={onOpen} />
          </div>
        ) : pending && !error ? (
          <div className="flex flex-col gap-4" aria-hidden>
            <Shimmer className="h-9 w-[40%]" />
            <Shimmer className="w-[90%]" />
            <Shimmer className="w-[80%]" />
            <Shimmer className="w-[60%]" />
          </div>
        ) : null}
      </div>
    </section>
  );
}
