"use client";

import { BedDouble, ChevronLeft, ChevronRight, Globe, Heart, Hotel, Info, Scale, WandSparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { COLOR_TEXT } from "@/lib/colorClasses";
import { formatEurShort } from "@/lib/form";
import { cn } from "@/lib/utils";
import type { StayCard, HousingColumn } from "@/server/services/stays";
import { glassSurface } from "./GlassCard";
import { plainReason, RatingChip } from "./RatingChip";

/** The offer's photo with its dots when there are several; a placeholder while the sources give none. */
function StayPhoto({ stay }: { stay: StayCard }) {
  const [shot, setShot] = useState(0);
  const photo = stay.photos[shot];

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[330px] overflow-hidden rounded-[28px] bg-gradient-to-br from-[#e9dfcf] to-[#8aa39b]">
      {stay.verdict && stay.fitScore !== null && (
        <RatingChip verdict={stay.verdict} score={stay.fitScore} source={stay.ratedBy} reason={stay.ratingReason} className="absolute top-3 left-3 z-10 shadow-md" />
      )}
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- photos come from other sites, not ours to optimise
        <img src={photo} alt={stay.title} className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center text-[#0d4a35]/70">
          {stay.provider === "booking" ? <Hotel aria-hidden className="size-28 stroke-[1.1]" /> : <BedDouble aria-hidden className="size-28 stroke-[1.1]" />}
        </span>
      )}
      {stay.photos.length > 1 && (
        <div className="absolute inset-x-0 bottom-4 flex justify-center gap-2">
          {stay.photos.map((_, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Photo ${index + 1}`}
              aria-current={index === shot}
              onClick={() => setShot(index)}
              className={cn("size-2.5 cursor-pointer rounded-full transition-colors", index === shot ? "bg-white" : "bg-white/50 hover:bg-white/80")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, colorClass, title }: { label: string; value: string; colorClass: string; title?: string }) {
  return (
    <div className="px-3 text-center" title={title}>
      <p className="text-lg text-black">{label}</p>
      <p className={cn("mt-1 text-2xl whitespace-nowrap", colorClass)}>{value}</p>
    </div>
  );
}

/** The white card of one offer: its name, photo and the figures to choose by (use-cases.md B-S5). */
function StayFace({ stay }: { stay: StayCard }) {
  const color = COLOR_TEXT[stay.color];
  return (
    <article
      aria-label={stay.title}
      className="relative animate-[card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_both] rounded-[22px] bg-white px-7 pt-6 pb-5 text-[#0d4a35] shadow-[0_6px_20px_rgb(0_0_0/0.18)]"
    >
      <h3 className="truncate text-center text-3xl font-normal" title={stay.title}>
        {stay.title}
      </h3>
      <div className="mt-4">
        <StayPhoto stay={stay} />
      </div>
      <div className="mt-5 flex items-end justify-between gap-3 text-black">
        <div className="flex items-end gap-6 text-2xl">
          <div className="leading-tight">
            {stay.rooms !== null && <p>{stay.rooms} {stay.rooms === 1 ? "Room" : "Rooms"}</p>}
            {stay.beds !== null && <p>{stay.beds} {stay.beds === 1 ? "Bed" : "Beds"}</p>}
          </div>
          <p>
            {stay.nights} {stay.nights === 1 ? "night" : "nights"}
          </p>
        </div>
        <div className="flex items-center divide-x divide-black/60">
          <Figure label="Total" value={formatEurShort(stay.totalEur)} colorClass={color} />
          <Figure label="Per guest" value={formatEurShort(stay.perGuestEur)} colorClass={color} />
          <Figure label="Per night" value={formatEurShort(stay.perGuestNightEur)} colorClass={color} title="One guest's share, for one night" />
        </div>
      </div>
      {!stay.fits && (
        <p className="mt-3 text-center text-base text-[#d33a2f]">Sleeps {stay.capacity}: too small for the whole group</p>
      )}
      {stay.verdict === "bad" && stay.ratingReason && (
        <p className="mt-3 text-center text-base text-[#d33a2f]">Not recommended: {plainReason(stay.ratingReason)}</p>
      )}
    </article>
  );
}

function ActionPill({
  icon,
  children,
  pressed,
  tone = "plain",
  disabled,
  title,
  onClick,
  href,
}: {
  icon: ReactNode;
  children: string;
  pressed?: boolean;
  tone?: "plain" | "ai" | "link";
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  href?: string | null;
}) {
  const classes = cn(
    "flex h-[54px] items-center gap-2.5 rounded-full border px-4 text-lg text-white outline-none transition-[background-color,border-color,box-shadow,transform] duration-300 focus-visible:ring-2 focus-visible:ring-emerald-300/60 [&_svg]:size-5 [&_svg]:stroke-[1.5]",
    disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer active:scale-[0.97]",
    tone === "ai" && "border-violet-300/50 bg-violet-400/20 hover:bg-violet-400/30 shadow-[0_0_14px_rgb(167_139_250/0.3)]",
    tone === "link" && "border-sky-300/30 bg-white/[0.14] hover:bg-white/[0.22]",
    tone === "plain" && "border-white/20 bg-white/[0.14] hover:bg-white/[0.22]",
    pressed && (tone === "ai" ? "border-violet-300 bg-violet-500/70 shadow-[0_0_20px_rgb(167_139_250/0.6)]" : "border-emerald-200/60 bg-[#5f8a77]/80"),
  );
  if (href && !disabled) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" title={title} className={classes}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <button type="button" aria-pressed={pressed} disabled={disabled} title={title} onClick={onClick} className={classes}>
      {icon}
      {children}
    </button>
  );
}

/**
 * One source of offers (Airbnb, hotels) as a column: its offers one at a time, best first, with
 * "›" for the next one (use-cases.md B-S4). The ❤ in the corner is the group's pick of
 * accommodation, and "In the budget" says which offer the figures are worked out with.
 */
export function StayColumn({
  column,
  heartedId,
  inBudgetId,
  comparing,
  adviseId,
  onHeart,
  onCompare,
  onInfo,
  onAdvise,
  className,
}: {
  column: HousingColumn;
  heartedId: string | null;
  inBudgetId: string | null;
  comparing: string[];
  adviseId: string | null;
  onHeart: (stay: StayCard) => void;
  onCompare: (stay: StayCard) => void;
  onInfo: (stay: StayCard) => void;
  onAdvise: (stay: StayCard) => void;
  className?: string;
}) {
  const [requested, setIndex] = useState(0);
  const { stays } = column;
  const index = Math.min(requested, Math.max(0, stays.length - 1));
  const stay = stays[index];
  const hearted = stay !== undefined && heartedId === stay.id;

  return (
    <div className={cn(glassSurface, "flex flex-col rounded-[44px] bg-white/[0.12] p-8 text-white transition-[filter,opacity,scale] duration-500", className)}>
      <header className="flex min-h-[60px] items-center justify-between gap-4">
        <h2 className="flex items-baseline gap-3 text-3xl font-normal">
          {column.label}
          {stays.length > 1 && <span className="text-lg text-white/55">{index + 1} / {stays.length}</span>}
          {stay && inBudgetId === stay.id && (
            <span className="rounded-full bg-emerald-300/25 px-3 py-0.5 text-base text-emerald-100" title="The budget is worked out with this offer">
              In the budget
            </span>
          )}
        </h2>
        {stay && (
          <button
            type="button"
            aria-pressed={hearted}
            aria-label={hearted ? `Remove the ❤ from ${stay.title}` : `Choose ${stay.title} for the group`}
            title={hearted ? "The group's choice" : "Choose this one for the group"}
            onClick={() => onHeart(stay)}
            className={cn(
              glassSurface,
              "flex size-[60px] cursor-pointer items-center justify-center rounded-full outline-none transition-[background-color,box-shadow,transform] duration-300 hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-rose-300/60 active:scale-90",
              hearted && "border-rose-200/60 bg-rose-400/70 shadow-[0_0_22px_rgb(251_113_133/0.6)]",
            )}
          >
            <Heart aria-hidden className={cn("size-9 stroke-[1.5] transition-transform duration-300", hearted && "scale-110 fill-white")} />
          </button>
        )}
      </header>

      {stay ? (
        <>
          <div className="relative mt-5">
            <StayFace key={stay.id} stay={stay} />
            {index < stays.length - 1 && (
              <button
                type="button"
                aria-label="Next offer"
                onClick={() => setIndex(index + 1)}
                className="absolute top-1/2 -right-[58px] flex size-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-white outline-none transition-transform hover:scale-125 focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <ChevronRight aria-hidden className="size-10 stroke-[2]" />
              </button>
            )}
            {index > 0 && (
              <button
                type="button"
                aria-label="Previous offer"
                onClick={() => setIndex(index - 1)}
                className="absolute top-1/2 -left-[58px] flex size-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-white outline-none transition-transform hover:scale-125 focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <ChevronLeft aria-hidden className="size-10 stroke-[2]" />
              </button>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <ActionPill icon={<Scale />} pressed={comparing.includes(stay.id)} onClick={() => onCompare(stay)} title="Add to the comparison">
              Compare
            </ActionPill>
            <ActionPill icon={<Info />} onClick={() => onInfo(stay)}>
              More Info
            </ActionPill>
            <ActionPill icon={<WandSparkles />} tone="ai" pressed={adviseId === stay.id} onClick={() => onAdvise(stay)}>
              Why this ?
            </ActionPill>
            <ActionPill icon={<Globe />} tone="link" href={stay.url} disabled={!stay.url} title={stay.url ? "Open the offer" : "No link for this offer"}>
              Link
            </ActionPill>
          </div>
        </>
      ) : (
        <p className="my-24 text-center text-2xl text-white/60">No {column.label === "Hotel" ? "hotel" : column.label} offer found here</p>
      )}
    </div>
  );
}

// Sized to fit the page in one screen.
