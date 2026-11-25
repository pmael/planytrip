"use client";

import { BedDouble, Hotel } from "lucide-react";
import { useState } from "react";
import type { RatingSource, StayProvider, StayVerdict } from "@/core/types";
import { cn } from "@/lib/utils";
import { RatingChip } from "./RatingChip";

/**
 * The offer's first photo with its score, as the Housing page opens on it (StayColumn.tsx); the same placeholder when it
 * has no photo, or its photo is no longer there.
 */
export function StayThumbnail({
  stay,
  className,
}: {
  stay: { title: string; provider: StayProvider; photo: string | null; verdict: StayVerdict | null; fitScore: number | null; ratedBy: RatingSource | null; ratingReason: string | null };
  className?: string;
}) {
  const [missing, setMissing] = useState(false);
  const Icon = stay.provider === "booking" ? Hotel : BedDouble;
  return (
    <span className={cn("relative block aspect-square overflow-hidden rounded-[28px] bg-gradient-to-br from-[#e9dfcf] to-[#8aa39b]", className)}>
      {stay.verdict && stay.fitScore !== null && (
        <RatingChip verdict={stay.verdict} score={stay.fitScore} source={stay.ratedBy} reason={stay.ratingReason} size="sm" className="absolute top-2.5 left-2.5 z-10 shadow-md" />
      )}
      {stay.photo && !missing ? (
        // eslint-disable-next-line @next/next/no-img-element -- photos come from other sites, not ours to optimise
        <img
          // One that failed before the page was ready does not say so again
          ref={(image) => void (image?.complete && image.naturalWidth === 0 && setMissing(true))}
          src={stay.photo}
          alt={stay.title}
          className="size-full object-cover"
          onError={() => setMissing(true)}
        />
      ) : (
        <span className="flex size-full items-center justify-center text-[#0d4a35]/70">
          <Icon aria-hidden className="size-24 stroke-[1.1]" />
        </span>
      )}
    </span>
  );
}
