"use client";

import { MODE_LABELS } from "@/lib/reachabilityText";
import { blockedText } from "@/lib/transportText";
import { cn } from "@/lib/utils";
import type { TransportCard as Card, TransportColumn as Column } from "@/server/services/transports";
import { glassSurface } from "./GlassCard";
import { MODE_ICONS, TransportCard } from "./TransportCard";

function Slot({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 px-2 text-2xl font-normal">{title}</h3>
      {children}
    </div>
  );
}

/**
 * One way of getting there (Plane, Car...) as a column: the Cheapest option and the Most Practical
 * one, and a "More" button for the rest (use-cases.md B-S1, B-S2).
 */
export function TransportColumn({
  column,
  destination,
  origin,
  present,
  onHeart,
  onMore,
  className,
}: {
  column: Column;
  destination: string;
  origin: string;
  /** Puts the ❤ and the budget flag on a card as they stand now, which the page keeps track of */
  present: (card: Card) => Card;
  onHeart: (card: Card) => void;
  onMore: () => void;
  className?: string;
}) {
  const Icon = MODE_ICONS[column.mode];
  const nothing = column.blockedReason !== null || column.empty;
  const card = (option: Card) => (
    <TransportCard key={option.id} card={present(option)} origin={origin} destination={destination} onHeart={onHeart} />
  );

  return (
    <section
      aria-label={MODE_LABELS[column.mode]}
      className={cn(glassSurface, "flex flex-col gap-6 rounded-[44px] bg-white/[0.12] p-8 text-white", className)}
    >
      <h2 className="flex items-center gap-3 text-3xl font-normal">
        <Icon aria-hidden className="size-8 stroke-[1.4]" />
        {MODE_LABELS[column.mode]}
      </h2>

      {nothing ? (
        <p className="my-16 text-center text-2xl text-white/60">
          {column.blockedReason !== null
            ? blockedText(column.blockedReason, destination)
            : `No ${MODE_LABELS[column.mode].toLowerCase()} option found for ${origin} → ${destination}`}
        </p>
      ) : (
        <>
          <Slot title="Cheapest">
            {column.cheapest ? (
              card(column.cheapest)
            ) : (
              <p className="rounded-[22px] border border-dashed border-white/35 px-6 py-8 text-center text-lg text-white/70">
                Nothing comfortable here: every option is uncomfortable, see More.
              </p>
            )}
          </Slot>
          <Slot title="Most Practical">{column.practical && card(column.practical)}</Slot>

          {column.more.length > 0 && (
            <button
              type="button"
              onClick={onMore}
              className="mx-auto mt-2 flex h-[54px] cursor-pointer items-center rounded-full border border-white/25 bg-white/[0.16] px-10 text-xl outline-none transition-[background-color,transform] hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-emerald-300/60 active:scale-[0.97]"
            >
              More
              <span className="ml-3 text-base text-white/60">{column.more.length}</span>
            </button>
          )}
        </>
      )}
    </section>
  );
}
