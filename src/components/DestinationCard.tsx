"use client";

import { Bed, Calendar, Crown, MapPin, Sparkles, Star } from "lucide-react";
import { colorOf } from "@/core/colors";
import { COLOR_TEXT } from "@/lib/colorClasses";
import {
  BUDGET_LEVEL_LABELS,
  blockerLabel,
  countryName,
  guestHue,
  OBJECTIVE_LABELS,
  standingOfCell,
  STANDING_HEX,
  STANDING_WORD,
  verdictOf,
} from "@/lib/deliberationText";
import { formatDateRange, formatEur, formatEurShort } from "@/lib/form";
import { cn } from "@/lib/utils";
import type { DeliberationGuest, Dossier } from "@/server/services/deliberation";
import { VERDICT_STYLE } from "./AiPanel";
import { CountUp } from "./CountUp";
import { Tile } from "./DashboardCard";
import { TierBadge } from "./DestinationSelect";
import { glassSurface } from "./GlassCard";
import { GuestAvatar } from "./GuestAvatar";
import { MODE_ICONS } from "./TransportCard";
import { TrendIcon } from "./TrendIcon";

/** What the AI said about this destination, to show on its card. */
export type AiVerdict = { verdict: keyof typeof VERDICT_STYLE; score: number; summary: string; picked: boolean };

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("flex items-center gap-1.5 rounded-full px-3 py-0.5 text-base [&_svg]:size-4 [&_svg]:stroke-[1.8]", className)}>{children}</span>;
}

/**
 * One destination as a card: where it ranks, what it costs the group, how each guest stands there
 * (the ring on their avatar), who has put a ★ on it and what keeps it from working (use-cases.md
 * C-S3 to C-S6). Hovering it lights up the same destination in the matrix and on the map.
 */
export function DestinationCard({
  dossier,
  guests,
  ai,
  dimmed,
  index,
  onFocus,
  onOpen,
}: {
  dossier: Dossier;
  guests: DeliberationGuest[];
  ai: AiVerdict | null;
  dimmed: boolean;
  index: number;
  onFocus: (destinationId: string | null) => void;
  onOpen: (destinationId: string) => void;
}) {
  const color = COLOR_TEXT[colorOf("budget", dossier.tier)];
  const star = dossier.includesFallback ? "*" : "";
  const voters = dossier.votes.guestIds.map((id) => guests.find((g) => g.id === id)!).filter(Boolean);
  const { window: dates, housing } = dossier;

  return (
    <article
      aria-label={dossier.shortLabel}
      onMouseEnter={() => onFocus(dossier.id)}
      onMouseLeave={() => onFocus(null)}
      onFocus={() => onFocus(dossier.id)}
      onBlur={() => onFocus(null)}
      className={cn(
        glassSurface,
        "relative flex animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both] flex-col gap-5 rounded-[44px] bg-white/[0.12] p-7 text-white transition-[opacity,scale,box-shadow,border-color] duration-300",
        dossier.recommended && "border-emerald-200/55 shadow-[0_0_36px_rgb(46_196_143/0.45)]",
        dimmed && "scale-[0.985] opacity-55",
      )}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <header className="flex items-start gap-4">
        <span
          title={`Ranked ${dossier.rank}`}
          className={cn(
            "flex size-14 shrink-0 items-center justify-center rounded-full text-3xl",
            dossier.rank === 1 ? "bg-[#c9a84c] shadow-[0_0_18px_rgb(230_180_70/0.55)]" : "bg-white/15",
          )}
        >
          {dossier.rank}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-3xl leading-tight font-normal">
            <button type="button" onClick={() => onOpen(dossier.id)} className="cursor-pointer text-left outline-none hover:underline focus-visible:underline">
              {dossier.shortLabel}
            </button>
          </h3>
          <p className="flex items-center gap-1.5 text-lg text-white/65">
            <MapPin aria-hidden className="size-4 stroke-[1.6]" />
            {countryName(dossier.countryCode)}
          </p>
        </div>
      </header>

      <div className="-mt-1 flex flex-wrap items-center gap-2">
        <TierBadge tier={dossier.tier} className="h-9 px-3 text-lg [&_svg]:size-5" />
        {dossier.recommended && (
          <Badge className="bg-emerald-300/25 text-emerald-50">
            <Crown aria-hidden />
            Recommended
          </Badge>
        )}
        {ai?.picked && (
          <Badge className="bg-violet-400/35 text-violet-50 shadow-[0_0_14px_rgb(167_139_250/0.5)]">
            <Sparkles aria-hidden />
            AI&rsquo;s pick
          </Badge>
        )}
        {!dossier.inScope && <Badge className="border border-amber-200/50 bg-[#7a6a3a] text-amber-100">Outside Europe</Badge>}
        <Badge className="bg-white/12 text-white/85">{OBJECTIVE_LABELS[dossier.objective]}</Badge>
        <Badge className="bg-white/12 text-white/85">{BUDGET_LEVEL_LABELS[dossier.budgetLevel]}</Badge>
      </div>

      <Tile className="grid grid-cols-2 py-4 text-black">
        <div className="min-w-0 px-3 text-center">
          <p className="text-lg">Total</p>
          <p className={cn("mt-1 flex items-center justify-center gap-1 text-[1.65rem] whitespace-nowrap", color)}>
            <CountUp value={dossier.totalEur} format={formatEur} />
            {star}
            <TrendIcon trend={dossier.trend} className="[&_svg]:size-6" />
          </p>
        </div>
        <div className="min-w-0 border-l border-black/60 px-3 text-center">
          <p className="text-lg">Per guest</p>
          <p className={cn("mt-1 text-[1.65rem] whitespace-nowrap", color)}>
            <CountUp value={dossier.perGuestEur} format={formatEur} />
          </p>
        </div>
      </Tile>

      <div>
        <p className="mb-2 text-lg text-white/70">{verdictOf(dossier, guests.length)}</p>
        <ul className="flex flex-wrap gap-3" aria-label="Where each guest stands">
          {guests.map((guest, i) => {
            const cell = dossier.cells.find((c) => c.guestId === guest.id)!;
            const standing = standingOfCell(cell);
            return (
              <li key={guest.id} className="flex items-center gap-2" title={`${guest.name}: ${STANDING_WORD[standing]}`}>
                <GuestAvatar name={guest.name} hue={guestHue(i)} ring={STANDING_HEX[standing]} dashed={standing === "unreachable"} starred={cell.starred} size={42} />
                <span className="text-base text-white/80">{cell.costEur === null ? "—" : formatEurShort(cell.costEur)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {dossier.blockers.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="What keeps it from working">
          {dossier.blockers.map((blocker) => (
            <li key={`${blocker.kind}-${blocker.guestId}`} className="rounded-full bg-rose-400/25 px-3 py-0.5 text-base text-rose-50">
              {blockerLabel(blocker)}
            </li>
          ))}
        </ul>
      )}

      <ul className="flex flex-col gap-2.5 text-lg text-white/85 [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]">
        <li className="flex items-center gap-3">
          <Star aria-hidden className={cn(voters.length > 0 && "fill-[#e5c35a] text-[#e5c35a]")} />
          {voters.length > 0 ? voters.map((voter) => voter.name).join(", ") : <span className="text-white/55">Nobody&rsquo;s ★ yet</span>}
        </li>
        <li className="flex items-center gap-3">
          <Calendar aria-hidden />
          {dates ? (
            <span>
              {formatDateRange(dates.from, dates.to)} · {dates.nights} {dates.nights === 1 ? "night" : "nights"}
            </span>
          ) : (
            <span className="text-rose-200">No dates work for everyone</span>
          )}
        </li>
        <li className="flex items-center gap-3">
          <Bed aria-hidden />
          {housing ? (
            <span className="truncate" title={housing.title}>
              {housing.title} · {formatEurShort(housing.perGuestEur)}/guest
            </span>
          ) : (
            <span className="text-white/55">No accommodation found</span>
          )}
        </li>
        <li className="flex items-center gap-3">
          <span className="flex gap-1.5">
            {dossier.modes.map((mode) => {
              const Icon = MODE_ICONS[mode];
              return <Icon key={mode} aria-label={mode} />;
            })}
          </span>
          {dossier.averageComfort === null ? (
            <span className="text-white/55">No journey found</span>
          ) : (
            <span>Journeys {Math.round(dossier.averageComfort)}/100 comfort</span>
          )}
        </li>
      </ul>

      {ai && (
        <p className="flex gap-3 rounded-[20px] border-l-4 bg-violet-400/15 py-3 pr-4 pl-4 text-base leading-snug text-violet-50" style={{ borderColor: VERDICT_STYLE[ai.verdict].hex }}>
          <Sparkles aria-hidden className="mt-0.5 size-5 shrink-0 stroke-[1.6] text-violet-200" />
          <span>
            <span className="mr-2 rounded-full bg-white px-2.5 py-0.5 text-sm whitespace-nowrap" style={{ color: VERDICT_STYLE[ai.verdict].hex }}>
              {VERDICT_STYLE[ai.verdict].label} · {ai.score}
            </span>
            {ai.summary}
          </span>
        </p>
      )}

      <button
        type="button"
        onClick={() => onOpen(dossier.id)}
        className="mt-auto flex h-[54px] cursor-pointer items-center justify-center rounded-full border border-white/25 bg-white/[0.14] text-xl outline-none transition-[background-color,transform] hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-emerald-300/60 active:scale-[0.98]"
      >
        Full details
      </button>
    </article>
  );
}
