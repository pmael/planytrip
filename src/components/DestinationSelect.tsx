"use client";

import { Popover } from "@base-ui/react/popover";
import { Ban, Check, ChevronDown, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { BudgetTier } from "@/core/types";
import { TIER_LABELS } from "@/lib/colorClasses";
import { cn } from "@/lib/utils";
import { glassSurface } from "./GlassCard";
import type { DestinationChoice } from "@/server/services/dashboard";

const TIER_STYLE: Record<BudgetTier, { icon: ReactNode; text: string }> = {
  comfy: { icon: <Check />, text: "text-[#1f9d74]" },
  limited: { icon: <TriangleAlert />, text: "text-[#c9820f]" },
  over: { icon: <Ban />, text: "text-[#d33a2f]" },
};

/** How the selected destination fares for everyone's budget: the worst guest decides (R6). */
export function TierBadge({ tier, className }: { tier: BudgetTier; className?: string }) {
  const style = TIER_STYLE[tier];
  return (
    <span className={cn("flex h-[52px] shrink-0 items-center gap-2 rounded-full bg-white px-4 text-2xl [&_svg]:size-6 [&_svg]:stroke-[1.7]", style.text, className)}>
      {style.icon}
      {TIER_LABELS[tier]}
    </span>
  );
}

/**
 * The destination picker at the top of the dashboard. It opens a list of the trip's destinations;
 * choosing one reloads the page for it (`?dest=`), so the choice is in the URL.
 */
export function DestinationSelect({
  destinations,
  selectedId,
  variant = "bar",
  keep,
}: {
  destinations: DestinationChoice[];
  selectedId: string;
  /** "bar" is the wide pill of the home page, "compact" a small button that sits inside a page title */
  variant?: "bar" | "compact";
  /** Other query parameters to carry over when the destination changes, e.g. the guest a page is showing */
  keep?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const selected = destinations.find((d) => d.id === selectedId) ?? destinations[0];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Destination: ${selected.shortLabel}. Change destination`}
        className={cn(
          "cursor-pointer outline-none transition-colors",
          variant === "bar"
            ? "flex h-[86px] w-full animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both] items-center rounded-full border border-orange-200/30 bg-white/[0.16] px-9 text-white shadow-[0_0_28px_rgb(255_160_80/0.3)] backdrop-blur-md hover:bg-white/[0.22] focus-visible:ring-2 focus-visible:ring-orange-200/60"
            : "flex h-[60px] items-center gap-3 rounded-full border border-white/25 bg-[#7d968b]/80 px-6 text-xl text-white hover:bg-[#8aa598]/90 focus-visible:ring-2 focus-visible:ring-emerald-200/70",
        )}
      >
        <ChevronDown
          aria-hidden
          className={cn("shrink-0 stroke-[1.5] transition-transform duration-300", variant === "bar" ? "size-9" : "size-5", open && "rotate-180")}
        />
        {variant === "bar" ? (
          <>
            <span className="flex-1 text-center text-4xl">{selected.shortLabel}</span>
            <TierBadge tier={selected.tier} />
          </>
        ) : (
          <span>{selected.shortLabel}</span>
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={12} align={variant === "bar" ? "start" : "end"} className="z-50">
          <Popover.Popup
            className={cn(
              glassSurface,
              variant === "bar" ? "w-[min(var(--anchor-width),92vw)]" : "w-[min(560px,92vw)]",
              "origin-top overflow-hidden rounded-[32px] bg-[#5a5a5a]/95 py-3 text-white outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            )}
          >
            <ul aria-label="Destinations">
              {destinations.map((destination) => (
                <li key={destination.id}>
                  <Link
                    href={`?${new URLSearchParams({ dest: destination.id, ...keep })}`}
                    onClick={() => setOpen(false)}
                    aria-current={destination.id === selectedId ? "true" : undefined}
                    className={cn(
                      "flex items-center gap-5 px-9 py-4 text-3xl outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/15",
                      destination.id === selectedId && "bg-white/[0.12]",
                    )}
                  >
                    <Check aria-hidden className={cn("size-7 shrink-0 stroke-2", destination.id === selectedId ? "opacity-100" : "opacity-0")} />
                    <span className="flex flex-1 items-center gap-4">
                      {destination.shortLabel}
                      {destination.recommended && (
                        <span className="rounded-full bg-emerald-300/25 px-3 py-0.5 text-base text-emerald-100">Recommended</span>
                      )}
                      {!destination.inScope && (
                        <span className="rounded-full border border-amber-200/50 bg-[#7a6a3a] px-3 py-0.5 text-base text-amber-100">Outside Europe</span>
                      )}
                    </span>
                    <TierBadge tier={destination.tier} className="h-11 text-xl" />
                  </Link>
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// The compact variant sits inside a page title.
