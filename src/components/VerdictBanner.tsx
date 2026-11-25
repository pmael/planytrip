"use client";

import { Crown, Scale } from "lucide-react";
import { colorOf } from "@/core/colors";
import { COLOR_TEXT } from "@/lib/colorClasses";
import { blockerLabel } from "@/lib/deliberationText";
import { formatEur } from "@/lib/form";
import { cn } from "@/lib/utils";
import type { ReadyDeliberation } from "@/server/services/deliberation";
import { CountUp } from "./CountUp";
import { Tile } from "./DashboardCard";
import { glassSurface } from "./GlassCard";

/**
 * Where the group stands: the destination that works for everyone, or, when none does, the closest
 * one and who is in the way (use-cases.md C-S5, C-S6).
 */
export function VerdictBanner({ view, onOpen }: { view: ReadyDeliberation; onOpen: (destinationId: string) => void }) {
  const lead = view.destinations.find((d) => d.id === view.closestId)!;
  const works = view.recommendedId !== null;
  const guestCount = view.guests.length;
  const totalColor = COLOR_TEXT[colorOf("budget", lead.tier)];
  const votes = view.destinations.reduce((sum, d) => sum + d.votes.count, 0);

  return (
    <section
      aria-label={works ? "Recommendation" : "No recommendation yet"}
      className={cn(
        glassSurface,
        "relative flex animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both] flex-wrap items-center gap-x-10 gap-y-6 rounded-[44px] p-8 text-white",
        works ? "border-emerald-200/45 bg-emerald-300/[0.1] shadow-[0_0_40px_rgb(46_196_143/0.35)]" : "border-amber-200/45 bg-amber-300/[0.08] shadow-[0_0_40px_rgb(230_180_70/0.3)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-[92px] shrink-0 items-center justify-center rounded-full",
          works ? "bg-[#3f7a62] shadow-[0_0_30px_rgb(46_196_143/0.6)]" : "bg-[#8a7330] shadow-[0_0_30px_rgb(230_180_70/0.5)]",
        )}
      >
        {works ? <Crown className="size-12 stroke-[1.4]" /> : <Scale className="size-12 stroke-[1.4]" />}
      </span>

      <div className="min-w-[260px] flex-1">
        <p className={cn("text-xl", works ? "text-emerald-100" : "text-amber-100")}>
          {works ? "Recommended for the group" : "No destination works for everyone yet"}
        </p>
        <h2 className="mt-1 text-5xl font-normal">
          <button type="button" onClick={() => onOpen(lead.id)} className="cursor-pointer outline-none hover:underline focus-visible:underline">
            {works ? lead.shortLabel : `Closest: ${lead.shortLabel}`}
          </button>
        </h2>
        <p className="mt-2 text-xl text-white/80">
          {works
            ? `${lead.standing.comfy} of ${guestCount} comfortably within budget${votes > 0 ? ` · ${lead.votes.count} ★ vote${lead.votes.count === 1 ? "" : "s"}` : ""}`
            : lead.blockers.map(blockerLabel).join(" · ")}
        </p>
      </div>

      <Tile className="flex w-full items-center justify-around gap-4 px-5 py-4 text-black sm:w-auto sm:gap-6 sm:px-7">
        <div className="text-center">
          <p className="text-lg">Total</p>
          <p className={cn("text-2xl whitespace-nowrap sm:text-3xl", totalColor)}>
            <CountUp value={lead.totalEur} format={formatEur} />
          </p>
        </div>
        <span aria-hidden className="h-12 w-px bg-black/60" />
        <div className="text-center">
          <p className="text-lg">Per guest</p>
          <p className={cn("text-2xl whitespace-nowrap sm:text-3xl", totalColor)}>
            <CountUp value={lead.perGuestEur} format={formatEur} />
          </p>
        </div>
        {lead.window && (
          <>
            <span aria-hidden className="h-12 w-px bg-black/60" />
            <div className="text-center">
              <p className="text-lg">Nights</p>
              <p className="text-2xl text-[#0d4a35] sm:text-3xl">{lead.window.nights}</p>
            </div>
          </>
        )}
      </Tile>

      {!works && (
        <ul className="flex basis-full flex-wrap gap-3 text-lg">
          {view.destinations
            .filter((d) => d.id !== lead.id)
            .map((destination) => (
              <li key={destination.id} className="rounded-full bg-white/10 px-4 py-1.5">
                <span className="text-white/65">{destination.shortLabel}: </span>
                {destination.blockers.map(blockerLabel).join(" · ") || "no blocker"}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
