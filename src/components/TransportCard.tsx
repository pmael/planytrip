"use client";

import { ArrowRight, CarFront, ExternalLink, Heart, Plane, TramFront, BusFront } from "lucide-react";
import type { TransportMode } from "@/core/types";
import { formatDuration } from "@/core/comfort";
import { COLOR_TEXT } from "@/lib/colorClasses";
import { formatDayMonth, formatEurShort } from "@/lib/form";
import { providerLabel, uncomfortableText, VARIANT_LABELS } from "@/lib/transportText";
import { cn } from "@/lib/utils";
import type { TransportCard as Card, TransportLeg } from "@/server/services/transports";
import { plainReason, RatingChip } from "./RatingChip";

export const MODE_ICONS: Record<TransportMode, typeof Plane> = { plane: Plane, train: TramFront, bus: BusFront, car: CarFront };

/** One way: when it leaves and arrives, coloured by how pleasant those hours are, with the date and length between. */
function LegRow({ label, leg, durationColor }: { label: string; leg: TransportLeg; durationColor: string }) {
  const timed = leg.departTime !== null && leg.arriveTime !== null;
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4" aria-label={label}>
      <p className={cn("min-w-[72px] text-2xl", timed ? COLOR_TEXT[leg.departColor] : "text-black")}>
        {timed ? leg.departTime : leg.date ? formatDayMonth(leg.date) : "—"}
      </p>
      <div className="flex flex-col items-center text-black">
        <span className="text-base leading-tight">{timed && leg.date ? formatDayMonth(leg.date) : label}</span>
        <span aria-hidden className="relative my-0.5 h-px w-full bg-black/70">
          <ArrowRight className="absolute -top-[9px] -right-1 size-[18px] stroke-[1.5]" />
        </span>
        <span className={cn("text-base leading-tight", durationColor)}>
          {leg.durationMin !== null ? formatDuration(leg.durationMin) : "—"}
        </span>
      </div>
      <p className={cn("min-w-[72px] text-right text-2xl", timed ? COLOR_TEXT[leg.arriveColor] : "text-black/40")}>
        {timed ? (
          <>
            {leg.arriveTime}
            {leg.arrivesDaysLater > 0 && <sup className="ml-0.5 text-sm">+{leg.arrivesDaysLater}</sup>}
          </>
        ) : (
          ""
        )}
      </p>
    </div>
  );
}

/**
 * The white card of one transport option: what it costs the guest, how it goes there and back, who
 * runs it, and the ❤ that makes it the guest's choice (use-cases.md B-S1, B-S2, A-S7).
 */
export function TransportCard({
  card,
  origin,
  destination,
  onHeart,
  className,
}: {
  card: Card;
  origin: string;
  destination: string;
  onHeart: (card: Card) => void;
  className?: string;
}) {
  const Icon = MODE_ICONS[card.mode];
  const variant = VARIANT_LABELS[card.variant];
  const red = card.comfort.level === "red";

  return (
    <article
      aria-label={`${providerLabel(card.provider)}, ${card.soldOut ? "sold out" : formatEurShort(card.costEur)}`}
      className={cn("group/card relative animate-[card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_both] rounded-[22px] bg-white px-6 pt-5 pb-4 text-[#0d4a35] shadow-[0_6px_20px_rgb(0_0_0/0.18)]", card.soldOut && "bg-white/80", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          {card.soldOut && (
            <p className="mb-2 inline-block rounded-full bg-rose-100 px-3 py-0.5 text-sm font-medium text-rose-700" title="The seller has no seat left on this train, there or back">
              Sold out
            </p>
          )}
          <p className={cn("text-4xl leading-none", COLOR_TEXT[card.priceColor], card.soldOut && "opacity-50")}>
            {card.priceKind === "estimated" && <span aria-label="About" className="mr-0.5 text-3xl">≈</span>}
            {formatEurShort(card.costEur)}
          </p>
          {card.priceKind === "estimated" && (
            <p className="mt-1 text-sm text-[#a8741c]" title={card.priceNote ?? undefined}>
              Estimated price{card.priceNote ? `: ${card.priceNote}` : ""}
            </p>
          )}
          {card.priceKind === "observed" && (
            <p className="mt-1 text-sm text-[#1f9d74]" title="Le prix vu par vous sur la page du vendeur, il y a moins d'un jour">
              {card.priceNote}
            </p>
          )}
          {card.lastMileEur > 0 && (
            <p className="mt-1 text-sm text-black/55">incl. {formatEurShort(card.lastMileEur)} to get from the {card.mode === "train" ? "station" : "airport"}</p>
          )}
        </div>
        <button
          type="button"
          aria-pressed={card.hearted}
          aria-label={card.hearted ? `Remove the ❤ from this ${card.mode} option` : `Choose this ${card.mode} option`}
          title={card.hearted ? "Your choice" : "Choose this one"}
          onClick={() => onHeart(card)}
          className="-mt-1 -mr-2 flex size-11 cursor-pointer items-center justify-center rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-rose-400/60 active:scale-90"
        >
          <Heart
            aria-hidden
            className={cn("size-8 stroke-[1.5] transition-[color,fill,transform] duration-300", card.hearted ? "scale-110 fill-rose-500 text-rose-500" : "text-[#0d4a35]/55")}
          />
        </button>
      </div>

      <p className="mt-3 flex items-center gap-2 text-lg text-black">
        <span className="truncate">{origin}</span>
        <ArrowRight aria-hidden className="size-4 shrink-0" />
        <span className="truncate">{destination}</span>
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <LegRow label="Out" leg={card.out} durationColor={COLOR_TEXT[card.comfort.color]} />
        <LegRow label="Back" leg={card.back} durationColor={COLOR_TEXT[card.comfort.color]} />
      </div>

      {red && (
        <p className="mt-3 rounded-2xl bg-[#d33a2f]/10 px-3 py-1.5 text-base text-[#d33a2f]">{uncomfortableText(card.comfort.reasons)}</p>
      )}
      {card.rating && (
        <div className="mt-3">
          <RatingChip verdict={card.rating.verdict} score={card.rating.score} source={card.rating.source} reason={card.rating.reason} surface="pale" size="sm" />
        </div>
      )}
      {card.rating?.verdict === "bad" && (
        <p className="mt-2 rounded-2xl bg-[#d33a2f]/10 px-3 py-1.5 text-base text-[#d33a2f]">Not recommended: {plainReason(card.rating.reason)}</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 rounded-full border border-[#0d4a35]/25 px-3 py-1 text-base text-[#0d4a35]">
          <Icon aria-hidden className="size-4 shrink-0 stroke-[1.6]" />
          <span className="truncate">{card.mode === "car" ? (variant ?? "Car") : providerLabel(card.provider)}</span>
          {card.mode !== "car" && card.stops !== null && card.stops > 0 && (
            <span className="shrink-0 text-black/55">· {card.stops} {card.stops === 1 ? "stop" : "stops"}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center">
          {card.inBudget && (
            <span className="shrink-0 rounded-full bg-[#2ec48f]/15 px-3 py-0.5 text-sm text-[#1f9d74]" title="The budget is worked out with this option">
              In the budget
            </span>
          )}
          {card.url && (
            // Out of the way until the card is pointed at (or reached by keyboard): then it slides out.
            // Where there is no pointer to hover with, it is always there.
            <a
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open the ${providerLabel(card.provider)} offer in a new tab`}
              title="Open the offer"
              className="ml-0 flex h-8 max-w-0 translate-x-3 items-center overflow-hidden rounded-full bg-[#0d4a35] text-base whitespace-nowrap text-white opacity-0 outline-none transition-[max-width,margin,opacity,transform,background-color] duration-300 ease-out group-hover/card:ml-2 group-hover/card:max-w-[110px] group-hover/card:translate-x-0 group-hover/card:opacity-100 group-focus-within/card:ml-2 group-focus-within/card:max-w-[110px] group-focus-within/card:translate-x-0 group-focus-within/card:opacity-100 hover:bg-[#136b4c] focus-visible:ring-2 focus-visible:ring-[#2ec48f] motion-reduce:transition-none [@media(hover:none)]:ml-2 [@media(hover:none)]:max-w-[110px] [@media(hover:none)]:translate-x-0 [@media(hover:none)]:opacity-100"
            >
              <span className="flex items-center gap-1.5 px-3.5">
                <ExternalLink aria-hidden className="size-4 stroke-[1.8]" />
                Link
              </span>
            </a>
          )}
        </span>
      </div>
    </article>
  );
}
