"use client";

import { Popover } from "@base-ui/react/popover";
import { Sparkles } from "lucide-react";
import type { StayJudgement } from "@/core/types";
import { cn } from "@/lib/utils";
import type { BudgetCard } from "@/server/services/dashboard";
import { glassSurface } from "./GlassCard";
import { PlaneLoader } from "./PlaneLoader";
import { RatingChip } from "./RatingChip";
import { useStayAdvice } from "./useStayAdvice";

/** What the popover shows: the stored rating, with the AI's explanation once it has been asked for. */
function WhyThis({ stay, stored }: { stay: { id: string; title: string }; stored: StayJudgement | null }) {
  const { shown } = useStayAdvice(stay.id);
  const known =
    shown.state === "ready" ? shown.analysis : shown.state === "pending" || shown.state === "unavailable" ? shown.previous : undefined;
  const judgement: StayJudgement | null = known
    ? { ...known, ratedBy: known.ratedBy ?? null, explained: known.explained ?? true }
    : stored;
  const waiting = shown.state === "loading" || shown.state === "pending";

  return (
    <div className="mt-4 flex flex-col gap-3 text-base">
      {judgement && (
        <>
          <RatingChip verdict={judgement.verdict} score={judgement.fitScore} source={judgement.ratedBy} size="lg" />
          {judgement.ratedBy === "rules" && (
            <p className="text-sm text-white/60">Not rated by the AI: simple rules gave this score, because the AI was not available when it was rated.</p>
          )}
          <p className="text-white/85">{judgement.summary}</p>
          {judgement.pros.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-emerald-100">
              {judgement.pros.map((pro) => <li key={pro}>{pro}</li>)}
            </ul>
          )}
          {judgement.cons.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-rose-100">
              {judgement.cons.map((con) => <li key={con}>{con}</li>)}
            </ul>
          )}
        </>
      )}
      {waiting && (
        <div role="status" className="flex items-center gap-3 text-violet-100/80">
          <PlaneLoader width={110} tone="glow" decorative />
          Asking the AI to explain…
        </div>
      )}
      {shown.state === "unavailable" && (
        <p className="text-white/60">The AI explanation isn’t available right now. Everything else keeps working.</p>
      )}
      {shown.state === "error" && <p className="text-white/60">Couldn’t reach the server, please try again.</p>}
      {!judgement && !waiting && shown.state === "ready" && <p className="text-white/70">The AI has no explanation for this accommodation.</p>}
    </div>
  );
}

/**
 * "Why this?" on the chosen accommodation (use-cases.md B-S6): the score it was rated while the trip
 * was set up, straight away, and the AI's explanation of it, asked for when this opens: the dashboard
 * only asks the AI because someone clicked here.
 */
export function StayAnalysisButton({
  stay,
  analysis,
}: {
  stay: { id: string; title: string };
  analysis: NonNullable<BudgetCard["housing"]>["analysis"];
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Why this accommodation? ${stay.title}`}
        title="Why this?"
        className="absolute right-5 bottom-5 flex size-[42px] cursor-pointer items-center justify-center rounded-full bg-white text-[#7c3aed] shadow-[0_2px_10px_rgb(0_0_0/0.25)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-violet-400 data-[popup-open]:scale-110"
      >
        <Sparkles aria-hidden className="size-6 fill-[#7c3aed]/20 stroke-[1.8]" />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={12} align="end" className="z-50">
          <Popover.Popup
            className={cn(
              glassSurface,
              "max-h-[min(70vh,560px)] w-[min(420px,92vw)] origin-top-right overflow-y-auto rounded-[28px] bg-[#555]/95 p-6 text-white outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            )}
          >
            <Popover.Title className="flex items-center gap-2 text-xl font-normal text-violet-200">
              <Sparkles aria-hidden className="size-5" />
              Why this?
            </Popover.Title>
            <p className="mt-2 text-lg">{stay.title}</p>
            <WhyThis stay={stay} stored={analysis} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
