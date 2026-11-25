"use client";

import { ArrowRight, CalendarDays, House, Plane, Sparkles, Star } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Trend } from "@/core/types";
import { COLOR_TEXT } from "@/lib/colorClasses";
import { formatDayMonth, formatEur } from "@/lib/form";
import { tripPath } from "@/lib/trip";
import { MODE_LABELS } from "@/lib/reachabilityText";
import { formatDuration } from "@/core/comfort";
import { cn } from "@/lib/utils";
import { blockerText } from "@/lib/recommendationText";
import type { BudgetCard, BudgetShow, GuestCardView } from "@/server/services/dashboard";
import { glassSurface } from "./GlassCard";
import { GuestViewSelect } from "./GuestViewSelect";
import { StayAnalysisButton } from "./StayAnalysisButton";
import { TrendIcon } from "./TrendIcon";

/** "1235 €", or "~ 1233 €" when it was rounded: whole euros, so a figure fits the card (C-S3: rounding happens at display time). */
const formatCardEur = (value: number) => (Math.abs(value - Math.round(value)) < 0.005 ? `${Math.round(value)} €` : `~ ${Math.round(value)} €`);

const CHIPS: { id: BudgetShow; label: string; icon: ReactNode }[] = [
  { id: "dates", label: "Dates", icon: <CalendarDays /> },
  { id: "housing", label: "Housing", icon: <House /> },
  { id: "transports", label: "Transports", icon: <Plane /> },
  { id: "extra", label: "Extra", icon: <Sparkles /> },
];

/** "Total | per guest", the way the cards write a figure and its share. */
function Figures({ totalEur, perGuestEur, colorClass, assumed }: { totalEur: number; perGuestEur: number; colorClass: string; assumed?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 text-center">
      <div>
        <p className="text-2xl text-black">Total</p>
        <p className={cn("mt-3 text-[2rem] whitespace-nowrap", colorClass)}>
          {formatCardEur(totalEur)}
          {assumed && <span title="Counts a way of getting there the guest did not choose: an assumption">*</span>}
        </p>
      </div>
      <span aria-hidden className="h-[78px] w-px bg-[#0d4a35]/70" />
      <div>
        <p className="text-2xl text-black">per guest</p>
        <p className={cn("mt-3 text-[2rem] whitespace-nowrap", colorClass)}>{formatCardEur(perGuestEur)}</p>
      </div>
    </div>
  );
}

/** One guest's own cost, coloured by their own budget: what "Guest view" shows instead of the total and the average. */
function GuestFigures({ view }: { view: GuestCardView }) {
  const color = COLOR_TEXT[view.color];
  if (view.status === "unreachable") {
    return (
      <div className="text-center">
        <p className="text-[2rem] text-[#d33a2f]">⛔ No way there</p>
        {view.transport && (
          <p className="mt-2 text-lg text-black/60">
            Counted with the {MODE_LABELS[view.transport.mode].toLowerCase()} ({formatCardEur(view.costEur ?? view.transport.costEur)}*), an assumption
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 text-center">
      <div>
        <p className="text-2xl text-black">{view.name}</p>
        <p className={cn("mt-3 text-[2rem] whitespace-nowrap", color)}>{view.costEur === null ? "—" : formatCardEur(view.costEur)}</p>
      </div>
      <span aria-hidden className="h-[78px] w-px bg-[#0d4a35]/70" />
      <div>
        <p className="text-2xl text-black">of {formatEur(view.maxBudgetEur)}</p>
        <p className={cn("mt-3 text-[2rem] whitespace-nowrap", color)}>{view.budgetRatio === null ? "—" : `${Math.round(view.budgetRatio * 100)} %`}</p>
      </div>
    </div>
  );
}

const TIER_WORD = { comfy: "Comfy", limited: "Limited", over: "Over budget" } as const;

/** Under the figures: for a guest, how the trip sits with their budget; for everyone, whether it works and what is in the way. */
function Standing({ card, view }: { card: BudgetCard; view: GuestCardView | null }) {
  if (view) {
    if (view.status === "unreachable") return null;
    return (
      <p className={cn("mt-4 text-center text-xl", COLOR_TEXT[view.color])}>
        {TIER_WORD[view.tier]}
        {view.overBudgetEur !== null && view.overBudgetEur > 0 && ` · +${Math.round(view.overBudgetEur)} €`}
      </p>
    );
  }
  return card.eligible ? (
    <p className="mt-4 text-center text-xl text-[#1f9d74]">Works for everyone</p>
  ) : (
    <ul aria-label="What keeps it from working" className="mt-4 flex flex-wrap justify-center gap-2 text-base">
      {card.blockers.map((blocker) => (
        <li key={`${blocker.kind}-${blocker.guestId}`} className="rounded-full bg-[#d33a2f]/10 px-3 py-0.5 text-[#d33a2f]">
          {blockerText(blocker)}
        </li>
      ))}
    </ul>
  );
}

function Section({ title, trend, children }: { title: string; trend?: Trend; children: ReactNode }) {
  return (
    <section className="animate-[fade-up_0.4s_ease-out_both]">
      <hr className="my-5 border-[#0d4a35]/15" />
      <h3 className="flex items-center justify-center gap-3 text-4xl font-normal text-[#0d4a35]/55">
        {trend && <TrendIcon trend={trend} />}
        {title}
      </h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DestinationCard({ tripId, card, show, guestId }: { tripId: string; card: BudgetCard; show: BudgetShow[]; guestId: string | null }) {
  const { total, dates, housing, transports, extra } = card;
  const view = guestId ? (card.guestViews[guestId] ?? null) : null;
  const anyOn = show.length > 0;

  return (
    <article className="relative flex min-h-[220px] animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both] flex-col rounded-[22px] bg-white p-7 text-[#0d4a35]">
      {(card.votes.count > 0 || !card.inScope) && (
        <div className="-mt-2 mb-2 flex min-h-[28px] items-center justify-between gap-2">
          {card.votes.count > 0 ? (
            <span
              className={cn(
                "flex items-center gap-1 rounded-full border px-3 py-0.5 text-sm",
                view && card.votes.guestIds.includes(view.guestId)
                  ? "border-[#c9a84c] bg-[#c9a84c] text-white"
                  : "border-[#c9a84c]/50 bg-[#fff6d6] text-[#8a6d12]",
              )}
              title={`★ ${card.votes.names.join(", ")}`}
            >
              <Star aria-hidden className="size-3.5 fill-current" />
              {card.votes.count}
              <span className="sr-only"> ★: {card.votes.names.join(", ")}</span>
            </span>
          ) : (
            <span />
          )}
          {!card.inScope && (
            <span className="rounded-full border border-amber-500/40 bg-amber-100 px-3 py-0.5 text-sm text-amber-800" title="Computed for reference only">
              Outside Europe
            </span>
          )}
        </div>
      )}
      <h2 className="flex items-center justify-center gap-3 text-4xl font-normal">
        {anyOn && <TrendIcon trend={total.trend} />}
        {card.shortLabel}
      </h2>
      <div className="mt-4">
        {view ? (
          <GuestFigures view={view} />
        ) : (
          <Figures totalEur={total.totalEur} perGuestEur={total.perGuestEur} colorClass={COLOR_TEXT[total.color]} assumed={total.includesFallback} />
        )}
      </div>
      <Standing card={card} view={view} />

      {show.includes("dates") && (
        <Section title="Dates">
          {dates ? (
            <div className="flex flex-col items-center gap-1 text-center text-xl text-black">
              <p className="text-2xl text-[#0d4a35]">
                {formatDayMonth(dates.from)} → {formatDayMonth(dates.to)}
              </p>
              <p>
                {dates.nights} {dates.nights === 1 ? "night" : "nights"}
              </p>
              {dates.limitedBy.length > 0 && <p className="text-[#c9a227]">Limited by {dates.limitedBy.join(", ")}</p>}
              {dates.setByDestination && <p className="text-[#c9a227]">Set by this destination’s dates</p>}
            </div>
          ) : (
            <p className="text-center text-xl text-[#d33a2f]">No common dates here</p>
          )}
        </Section>
      )}

      {show.includes("housing") && (
        <Section title="Housing" trend={housing?.trend}>
          {housing ? (
            <>
              <Figures totalEur={housing.totalEur} perGuestEur={housing.perGuestEur} colorClass={COLOR_TEXT[housing.color]} />
              <p className="mt-4 truncate pr-12 text-center text-lg text-black/70" title={housing.stay.title}>
                {housing.stay.title}
              </p>
              <div className="h-8" />
              <StayAnalysisButton stay={housing.stay} analysis={housing.analysis} />
            </>
          ) : (
            <p className="text-center text-xl text-black/60">No accommodation found</p>
          )}
        </Section>
      )}

      {show.includes("transports") && (
        <Section title="Transports" trend={transports?.trend}>
          {transports ? (
            <>
              <Figures totalEur={transports.totalEur} perGuestEur={transports.perGuestEur} colorClass={COLOR_TEXT[transports.color]} />
              <ul className="mt-5 flex flex-col gap-1.5 text-lg text-black">
                {transports.guests.map((guest) => (
                  <li key={guest.guestId} className={cn("flex items-baseline justify-between gap-3 transition-opacity", guestId && guestId !== guest.guestId && "opacity-40")}>
                    <span className="truncate">{guest.name}</span>
                    {guest.costEur === null ? (
                      <span className="text-[#d33a2f]">⛔ no way</span>
                    ) : (
                      <span className="whitespace-nowrap">
                        <span className={cn("text-xl", COLOR_TEXT[guest.comfort])}>
                          {formatEur(guest.costEur)}
                          {guest.assumed && <span title="The guest did not choose this mode: an assumption">*</span>}
                        </span>
                        <span className="ml-2 text-black/60">
                          {guest.mode && MODE_LABELS[guest.mode]}
                          {guest.durationMin !== null && ` · ${formatDuration(guest.durationMin)}`}
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-center text-xl text-black/60">No way of getting there</p>
          )}
        </Section>
      )}

      {show.includes("extra") && (
        <Section title="Extra" trend={extra?.trend}>
          {extra ? (
            <>
              <Figures totalEur={extra.totalEur} perGuestEur={extra.perGuestEur} colorClass={COLOR_TEXT[extra.color]} />
              <p className="mt-4 text-center text-lg text-black/70">
                Mandatory {formatEur(extra.mandatoryEur)} · Plus {formatEur(extra.plusEur)}
              </p>
              <ul className="mt-4 flex flex-col gap-1.5 text-lg text-black">
                {extra.guests.map((guest) => (
                  <li key={guest.guestId} className={cn("flex items-baseline justify-between gap-3 transition-opacity", guestId && guestId !== guest.guestId && "opacity-40")}>
                    <span className="truncate">{guest.name}</span>
                    <span className="whitespace-nowrap">
                      <span className="text-xl">{formatEur(guest.mandatoryEur + guest.plusEur)}</span>
                      <span className="ml-2 text-black/60" title="Mandatory + Plus">
                        {formatEur(guest.mandatoryEur)} + {formatEur(guest.plusEur)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-center text-base text-black/50">
                The Plus is a suggestion: only the Mandatory can put a guest over budget.
                {!extra.pricesByAi && " Local prices not estimated by the AI."}
              </p>
              <Link
                href={`${tripPath(tripId, "/extra")}?${new URLSearchParams({ dest: card.destinationId, ...(guestId ? { guest: guestId } : {}) })}`}
                className="mx-auto mt-4 flex w-fit items-center gap-2 rounded-full px-4 py-1.5 text-lg text-[#0d4a35] outline-none hover:bg-[#0d4a35]/10 focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                Line by line
                <ArrowRight aria-hidden className="size-5 stroke-[1.6]" />
              </Link>
            </>
          ) : (
            <p className="text-center text-xl text-black/60">Not counted yet: the local prices are not known</p>
          )}
        </Section>
      )}
    </article>
  );
}

/**
 * The Budget page: every destination side by side (use-cases.md UC-C.1). The chips open sections
 * on each card to compare one thing across the destinations; they can be combined, and the choice
 * is kept in the URL (`?show=housing,dates`) without reloading. "Guest view" shows one guest's own
 * cost instead of the average, coloured by their budget (`?guest=`): only the display changes.
 */
export function BudgetPanel({
  tripId,
  cards,
  initialShow,
  guests,
  initialGuestId,
}: {
  tripId: string;
  cards: BudgetCard[];
  initialShow: BudgetShow[];
  guests: { id: string; name: string }[];
  initialGuestId: string | null;
}) {
  const [show, setShow] = useState<BudgetShow[]>(initialShow);
  const [guestId, setGuestId] = useState<string | null>(initialGuestId);

  function viewAs(next: string | null) {
    setGuestId(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("guest", next);
    else url.searchParams.delete("guest");
    window.history.replaceState(null, "", url);
  }

  function toggle(chip: BudgetShow) {
    const next = show.includes(chip) ? show.filter((id) => id !== chip) : [...show, chip];
    setShow(next);
    // Keep the choice in the address without asking the server for anything
    const url = new URL(window.location.href);
    if (next.length > 0) url.searchParams.set("show", next.join(","));
    else url.searchParams.delete("show");
    window.history.replaceState(null, "", url);
  }

  const assumed = cards.some((card) => card.total.includesFallback);
  const ordered = CHIPS.map((chip) => chip.id).filter((id) => show.includes(id));

  return (
    <section
      aria-label="Budget of each destination"
      className={cn(glassSurface, "animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_0.1s_both] rounded-[44px] bg-white/[0.12] px-[26px] pt-9 pb-8 text-white")}
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 pl-[8px] lg:pl-[68px]">
        <p className="text-2xl">{guestId ? `${guests.find((g) => g.id === guestId)?.name ?? ""}'s cost` : "Total"}</p>
        <GuestViewSelect guests={guests} selectedId={guestId} onChange={viewAs} />
      </div>

      <div
        className="grid grid-cols-1 gap-[43px] lg:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
        style={{ "--cols": Math.min(cards.length, 3) } as React.CSSProperties}
      >
        {cards.map((card) => (
          <DestinationCard key={card.destinationId} tripId={tripId} card={card} show={ordered} guestId={guestId} />
        ))}
      </div>

      {assumed && (
        <p className="mt-5 pl-2 text-base text-white/60">* Counts a way of getting there that the guest did not choose, as an assumption.</p>
      )}

      <div role="group" aria-label="Compare" className="mt-8 flex flex-wrap gap-5 pl-3">
        {CHIPS.map((chip) => {
          const on = show.includes(chip.id);
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(chip.id)}
              className={cn(
                "flex h-[60px] cursor-pointer items-center gap-3 rounded-full border px-6 text-xl outline-none transition-[background-color,border-color,box-shadow,transform] duration-300 focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.97] [&_svg]:size-6 [&_svg]:stroke-[1.5]",
                on
                  ? "border-sky-300/60 bg-sky-400/40 shadow-[0_0_18px_rgb(125_180_255/0.4)]"
                  : "border-rose-200/30 bg-white/[0.14] shadow-[0_0_14px_rgb(255_150_150/0.18)] hover:bg-white/[0.22]",
              )}
            >
              {chip.icon}
              {chip.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
