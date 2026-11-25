"use client";

import { useState } from "react";
import type { TransportMode } from "@/core/types";
import { airlineLogoUrl } from "@/lib/airlines";
import { cn } from "@/lib/utils";
import { MODE_ICONS } from "./TransportCard";

/**
 * One means of transportation as a round badge: the airline's logo for a flight when it is known and can be loaded,
 * the mode's icon otherwise.
 */
export function TransportBadge({ mode, label, airline, size, colorClass, style }: { mode: TransportMode; label: string; airline: string | null; size: string; colorClass: string; style?: React.CSSProperties }) {
  const [missing, setMissing] = useState(false);
  const Icon = MODE_ICONS[mode];
  const logo = airline !== null && !missing;
  return (
    <span
      title={label}
      className={cn("flex aspect-square shrink-0 items-center justify-center rounded-full border-4 shadow-lg", logo ? "border-black/[0.06] bg-white" : cn("border-white text-white", colorClass))}
      style={{ width: size, ...style }}
    >
      {logo ? (
        // A plain image: its size is known, it comes from Google's server as it is, and it says nothing of this page to it
        // eslint-disable-next-line @next/next/no-img-element
        <img
          // One that failed before the page was ready does not say so again
          ref={(image) => void (image?.complete && image.naturalWidth === 0 && setMissing(true))}
          src={airlineLogoUrl(airline)}
          alt={label}
          width={64}
          height={64}
          className="size-[54%]"
          referrerPolicy="no-referrer"
          onError={() => setMissing(true)}
        />
      ) : (
        <Icon aria-hidden className="size-[47%] stroke-[1.5]" />
      )}
    </span>
  );
}
