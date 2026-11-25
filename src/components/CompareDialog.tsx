"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { colorOf } from "@/core/colors";
import { COLOR_TEXT, TIER_LABELS } from "@/lib/colorClasses";
import { formatEurShort } from "@/lib/form";
import { cn } from "@/lib/utils";
import type { StayCard } from "@/server/services/stays";
import { glassSurface } from "./GlassCard";
import { RatingChip } from "./RatingChip";

/**
 * 2 or 3 offers side by side (use-cases.md B-S7), with what each guest would pay in all if that
 * offer were the group's pick and how that sits with their budget: the "budget impact".
 */
export function CompareDialog({
  stays,
  open,
  onClose,
}: {
  stays: { stay: StayCard; source: string }[];
  open: boolean;
  onClose: () => void;
}) {
  const columns = `minmax(130px, 170px) repeat(${stays.length}, minmax(0, 1fr))`;
  const guests = stays[0]?.stay.impact ?? [];

  const row = (label: string, cell: (stay: StayCard) => React.ReactNode) => (
    <div className="contents">
      <dt className="py-2.5 text-white/60">{label}</dt>
      {stays.map(({ stay }) => (
        <dd key={stay.id} className="py-2.5">{cell(stay)}</dd>
      ))}
    </div>
  );

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/25 backdrop-blur-md transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            glassSurface,
            "fixed top-1/2 left-1/2 z-50 max-h-[92vh] w-[min(1100px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[40px] bg-[#606060]/95 p-9 text-white outline-none transition-[opacity,scale] duration-200 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          )}
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-3xl font-normal">Compare</Dialog.Title>
            <Dialog.Close aria-label="Close" className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-white/15 outline-none transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-emerald-300/60">
              <X aria-hidden className="size-6" />
            </Dialog.Close>
          </div>

          <dl className="mt-6 grid gap-x-6 text-xl" style={{ gridTemplateColumns: columns }}>
            <div className="contents">
              <dt />
              {stays.map(({ stay, source }) => (
                <dd key={stay.id} className="pb-4">
                  <p className="text-base text-white/55">{source}</p>
                  <p className="text-2xl leading-snug">{stay.title}</p>
                </dd>
              ))}
            </div>
            {row("Total", (s) => <span className={COLOR_TEXT[s.color]}>{formatEurShort(s.totalEur)}</span>)}
            {row("Per guest", (s) => <span className={COLOR_TEXT[s.color]}>{formatEurShort(s.perGuestEur)}</span>)}
            {row("Per guest / night", (s) => <span className={COLOR_TEXT[s.color]}>{formatEurShort(s.perGuestNightEur)}</span>)}
            {row("Sleeps", (s) => (
              <span className={cn(!s.fits && "text-rose-200")}>
                {s.capacity}
                {!s.fits && " (too small)"}
              </span>
            ))}
            {row("Rooms · beds", (s) => [s.rooms, s.beds].map((n) => n ?? "—").join(" · "))}
            {row("Rating", (s) => (s.rating !== null ? `${s.rating} / 5` : "—"))}
            {row("Rating", (s) =>
              s.verdict && s.fitScore !== null ? (
                <RatingChip verdict={s.verdict} score={s.fitScore} source={s.ratedBy} reason={s.ratingReason} />
              ) : (
                <span className="text-white/50">Not rated yet</span>
              ),
            )}
          </dl>

          <h3 className="mt-6 mb-1 border-t border-white/20 pt-5 text-2xl font-normal">Budget impact</h3>
          <p className="mb-2 text-base text-white/55">What each guest would pay in all if this were the group’s choice</p>
          <dl className="grid gap-x-6 text-xl" style={{ gridTemplateColumns: columns }}>
            {guests.map((guest) => (
              <div key={guest.guestId} className="contents">
                <dt className="py-2.5 text-white/80">{guest.name}</dt>
                {stays.map(({ stay }) => {
                  const entry = stay.impact.find((impact) => impact.guestId === guest.guestId);
                  return (
                    <dd key={stay.id} className="py-2.5">
                      {entry ? (
                        <>
                          <span className={COLOR_TEXT[colorOf("budget", entry.tier)]}>{formatEurShort(entry.costEur)}</span>
                          <span className="ml-2 text-base text-white/55">{TIER_LABELS[entry.tier]}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </dd>
                  );
                })}
              </div>
            ))}
          </dl>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
