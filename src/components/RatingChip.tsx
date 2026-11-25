import { Ruler, Sparkles } from "lucide-react";
import { colorOf } from "@/core/colors";
import type { RatingSource, StayVerdict } from "@/core/types";
import { COLOR_TEXT } from "@/lib/colorClasses";
import { cn } from "@/lib/utils";

export const VERDICT_LABELS: Record<StayVerdict, string> = { good: "Good fit", ok: "Acceptable", bad: "Not recommended" };

/** A rating's reason as a sentence of its own: the rules' ones start by saying they are the rules'. */
export const plainReason = (reason: string) => reason.replace(/^Rules only:\s*/i, "");

/** What the tooltip says of who rated it: the rules only do it when the AI could not (R4). */
export const SOURCE_TITLES: Record<RatingSource, string> = {
  ai: "Rated by the AI while the trip was set up",
  rules: "Not rated by the AI: the rules scored it because the AI was not available",
};

const SIZES = { sm: "text-sm", base: "text-base", lg: "text-lg", xl: "text-xl" } as const;

/**
 * A rating on an option: who gave it (the AI, or the rules when the AI was not available), its
 * score and what that comes to. Just an answer that was stored: showing it never asks the AI.
 */
export function RatingChip({
  verdict,
  score,
  source,
  reason,
  surface = "white",
  size = "base",
  className,
}: {
  verdict: StayVerdict;
  score: number;
  /** Null for an analysis made before ratings existed: it was the AI's */
  source: RatingSource | null;
  /** Why, shown when pointing at the pill */
  reason?: string | null;
  /** The pill is `white` on the dark glass, `pale` on a white card */
  surface?: "white" | "pale";
  size?: "sm" | "base" | "lg" | "xl";
  className?: string;
}) {
  const by = source ?? "ai";
  const Icon = by === "ai" ? Sparkles : Ruler;
  return (
    <span
      title={reason ? `${SOURCE_TITLES[by]}. ${plainReason(reason)}` : SOURCE_TITLES[by]}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-0.5 whitespace-nowrap",
        SIZES[size],
        surface === "white" ? "bg-white" : "bg-[#f1f5f3]",
        by === "rules" && "border border-dashed border-black/25",
        COLOR_TEXT[colorOf("aiVerdict", verdict)],
        className,
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="text-black/60">{by === "ai" ? "AI" : "Rule-based"}</span>
      <span>
        {score} · {VERDICT_LABELS[verdict]}
      </span>
    </span>
  );
}
