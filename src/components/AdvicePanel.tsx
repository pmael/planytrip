"use client";

import { RefreshCw, Sparkles, TriangleAlert, X } from "lucide-react";
import type { StayAnalysis } from "@/core/types";
import { cn } from "@/lib/utils";
import { PlaneLoader } from "./PlaneLoader";
import { RatingChip } from "./RatingChip";
import { useStayAdvice } from "./useStayAdvice";

/**
 * What is known about one accommodation: the rating it was given while the trip was set up and, once
 * the AI has been asked "Why this?", its explanation. Until then the words are the rating's own reason.
 */
function Advice({ analysis }: { analysis: StayAnalysis }) {
  return (
    <div className="flex flex-col gap-5">
      <RatingChip verdict={analysis.verdict} score={analysis.fitScore} source={analysis.ratedBy ?? null} surface="pale" size="xl" />
      {analysis.ratedBy === "rules" && (
        <p className="text-base text-black/55">Not rated by the AI: simple rules gave this score, because the AI was not available when it was rated.</p>
      )}
      <p>{analysis.summary}</p>
      {analysis.pros.length > 0 && (
        <div>
          <h3 className="mb-1 text-xl text-[#1f9d74]">Pros</h3>
          <ul className="list-disc space-y-1 pl-6">
            {analysis.pros.map((pro) => <li key={pro}>{pro}</li>)}
          </ul>
        </div>
      )}
      {analysis.cons.length > 0 && (
        <div>
          <h3 className="mb-1 text-xl text-[#d33a2f]">Cons</h3>
          <ul className="list-disc space-y-1 pl-6">
            {analysis.cons.map((con) => <li key={con}>{con}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * "Why this?" (use-cases.md B-S6): the stay's stored rating at once, then the AI's explanation of
 * it, asked for because the user clicked. Without one yet it asks and follows along: "Analysis in
 * progress…", then the text appears by itself. An explanation written for facts that have since
 * changed says so and can be asked for again. When the AI cannot help, it says so, the rating stays
 * on show and nothing else is affected (B.5).
 */
export function AdvicePanel({
  stay,
  onClose,
}: {
  stay: { id: string; title: string };
  onClose: () => void;
}) {
  const { shown, askAgain } = useStayAdvice(stay.id);

  const shownAdvice =
    shown.state === "ready" ? shown.analysis : shown.state === "pending" || shown.state === "unavailable" ? (shown.previous ?? null) : null;
  const pending = shown.state === "pending" || shown.state === "loading";

  return (
    <section
      aria-label="AI advise"
      className="absolute inset-0 flex animate-[card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_both] flex-col rounded-[44px] border border-violet-300/40 bg-[#5d5a66]/90 p-9 text-white shadow-[0_0_34px_rgb(167_139_250/0.35)] backdrop-blur-md"
    >
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-3 text-4xl font-normal">
          <Sparkles aria-hidden className="size-8 text-violet-200" />
          AI advise
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the advice"
          className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white outline-none transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          <X aria-hidden className="size-6" />
        </button>
      </header>
      <p className="mt-2 truncate text-lg text-white/65">{stay.title}</p>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto rounded-[24px] bg-white p-7 text-lg leading-relaxed text-[#1f2a26]">
        {shown.state === "ready" && shown.stale && (
          <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-amber-50 px-4 py-3 text-base text-amber-950">
            <span className="flex items-center gap-2">
              <TriangleAlert aria-hidden className="size-5 shrink-0" />
              The offer, the group or the score may have changed since this was written.
            </span>
            <button
              type="button"
              onClick={askAgain}
              className="flex cursor-pointer items-center gap-2 rounded-full border border-violet-400/50 bg-violet-100 px-4 py-1.5 text-base text-violet-950 outline-none transition-colors hover:bg-violet-200 focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <RefreshCw aria-hidden className="size-4" />
              Re-analyse
            </button>
          </div>
        )}

        {pending && (
          <div role="status" className={cn("flex flex-col items-center gap-2 text-black/70", shownAdvice && "mb-5")}>
            <PlaneLoader width={180} decorative />
            <p>{shownAdvice?.explained ? "Looking again…" : "Analysis in progress…"}</p>
          </div>
        )}

        {shownAdvice && (
          <div className={cn("transition-opacity duration-500", pending && shownAdvice.explained && "opacity-50")}>
            <Advice analysis={shownAdvice} />
          </div>
        )}

        {shown.state === "error" && <p className="text-black/70">Couldn’t reach the server, please try again.</p>}
        {shown.state === "unavailable" && (
          <div className={cn("text-black/70", shownAdvice && "mt-5 border-t border-black/10 pt-5")}>
            <p>The AI explanation isn’t available right now. Everything else keeps working.</p>
            {shown.message && <p className="mt-2 text-base break-words text-black/50">{shown.message}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
