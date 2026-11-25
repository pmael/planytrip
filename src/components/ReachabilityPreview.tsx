"use client";

import { Ban, Check, CircleHelp, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cellFor, type ReachabilityMatrix } from "@/core/reachability";
import type { Destination, Guest, TransportMode } from "@/core/types";
import { describeCell, MODE_LABELS, type CellDescription } from "@/lib/reachabilityText";
import { cn } from "@/lib/utils";
import { glassSurface } from "./GlassCard";

const TONES: Record<CellDescription["tone"], { icon: ReactNode; text: string; surface: string }> = {
  ok: { icon: <Check />, text: "text-[#7ce6bd]", surface: "border-emerald-300/30" },
  warning: { icon: <TriangleAlert />, text: "text-amber-200", surface: "border-amber-300/40 bg-amber-300/10" },
  blocked: { icon: <Ban />, text: "text-rose-200", surface: "border-rose-300/40 bg-rose-400/10" },
  unverified: { icon: <CircleHelp />, text: "text-white/60", surface: "border-white/15" },
};

function Cell({ description, onOffer }: { description: CellDescription; onOffer?: (mode: TransportMode) => void }) {
  const tone = TONES[description.tone];
  return (
    <div
      className={cn(
        glassSurface,
        "flex min-h-[104px] animate-[fade-up_0.4s_ease-out_both] flex-col justify-center gap-1.5 rounded-[26px] px-5 py-3.5 text-lg shadow-none",
        tone.surface,
      )}
    >
      <p className={cn("flex items-center gap-2.5 text-xl [&_svg]:size-6 [&_svg]:shrink-0", tone.text)}>
        {tone.icon}
        {description.title}
      </p>
      {description.detail && <p className="text-base text-white/65">{description.detail}</p>}
      {description.offer && onOffer && (
        <button
          type="button"
          onClick={() => onOffer(description.offer!)}
          className="mt-1 w-fit cursor-pointer rounded-full border border-emerald-200/40 bg-[#6f9f72] px-5 py-1.5 text-base text-white outline-none transition-colors hover:bg-[#7db380] focus-visible:ring-2 focus-visible:ring-emerald-300/60"
        >
          Add {MODE_LABELS[description.offer].toLowerCase()}
        </button>
      )}
    </div>
  );
}

/**
 * Who can get where, with the modes accepted now (use-cases.md A.1 step 4): one cell per guest and
 * destination. A guest who cannot get somewhere is offered another mode in one click.
 */
export function ReachabilityPreview({
  guests,
  destinations,
  matrix,
  checking,
  onAccept,
}: {
  guests: Guest[];
  destinations: Destination[];
  matrix: ReachabilityMatrix | null;
  checking: boolean;
  onAccept: (guest: Guest, mode: TransportMode) => void;
}) {
  return (
    <section aria-labelledby="reach-title" className={cn(glassSurface, "w-full rounded-[44px] p-8 lg:p-10")}>
      <h2 id="reach-title" className="flex items-center gap-3 text-2xl font-normal text-white">
        Can everyone get there?
        {checking && (
          <span role="status" className="flex items-center gap-2 text-lg text-white/60">
            <LoaderCircle aria-hidden className="size-5 animate-spin" />
            Checking routes…
          </span>
        )}
      </h2>

      <div
        className="mt-7 grid items-stretch gap-4 text-white"
        style={{ gridTemplateColumns: `minmax(110px, 170px) repeat(${destinations.length}, minmax(0, 1fr))` }}
      >
        <span />
        {destinations.map((destination) => (
          <div key={destination.id} className="flex min-w-0 items-center gap-3 px-2 text-xl">
            <span className="truncate" title={destination.label}>
              {destination.label.split(",")[0]}
            </span>
            {!destination.inScope && (
              <span className="shrink-0 rounded-full border border-amber-200/50 bg-[#7a6a3a] px-3 py-0.5 text-sm text-amber-100">
                Outside Europe
              </span>
            )}
          </div>
        ))}

        {guests.map((guest) => (
          <div key={guest.id} className="contents">
            <div className="flex items-center px-2 text-xl">{guest.name}</div>
            {destinations.map((destination) => {
              const cell = matrix && cellFor(matrix, guest.id, destination.id);
              return cell ? (
                <Cell
                  key={destination.id}
                  description={describeCell(cell)}
                  onOffer={(mode) => onAccept(guest, mode)}
                />
              ) : (
                <div
                  key={destination.id}
                  aria-hidden
                  className="min-h-[104px] animate-pulse rounded-[26px] border border-white/10 bg-white/[0.08]"
                />
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
