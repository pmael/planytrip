"use client";

import { ChevronDown, Crown, Scale, Star } from "lucide-react";
import { useId, useState } from "react";
import { formatEur } from "@/lib/form";
import { blockerText, headlineOf, reasonText } from "@/lib/recommendationText";
import { cn } from "@/lib/utils";
import type { Recommendation } from "@/server/services/dashboard";
import { glassSurface } from "./GlassCard";

/**
 * The recommendation at the top of the Budget page: which destination works for everyone and what
 * it costs, or, when none does, the closest one. "Why?" opens the reasons with their numbers and
 * the whole ranking, including what keeps each other destination from working (use-cases.md C-S6).
 */
export function RecommendationBanner({ recommendation, guestCount }: { recommendation: Recommendation; guestCount: number }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { works } = recommendation;

  return (
    <section
      aria-label="Recommendation"
      className={cn(
        glassSurface,
        "animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both] rounded-[44px] p-8 text-white",
        works ? "border-emerald-200/45 bg-emerald-300/[0.1] shadow-[0_0_40px_rgb(46_196_143/0.35)]" : "border-amber-200/45 bg-amber-300/[0.08] shadow-[0_0_40px_rgb(230_180_70/0.3)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <span
          aria-hidden
          className={cn(
            "flex size-[76px] shrink-0 items-center justify-center rounded-full",
            works ? "bg-[#3f7a62] shadow-[0_0_26px_rgb(46_196_143/0.6)]" : "bg-[#8a7330] shadow-[0_0_26px_rgb(230_180_70/0.5)]",
          )}
        >
          {works ? <Crown className="size-10 stroke-[1.4]" /> : <Scale className="size-10 stroke-[1.4]" />}
        </span>

        <div className="min-w-[260px] flex-1">
          <p className={cn("text-lg", works ? "text-emerald-100" : "text-amber-100")}>{works ? "Recommendation" : "No recommendation yet"}</p>
          <h2 className="text-3xl leading-tight font-normal sm:text-4xl">{headlineOf(recommendation)}</h2>
          {!works && recommendation.reasons[0]?.kind === "closest" && (
            <p className="mt-1 text-xl text-white/80">{recommendation.reasons[0].blockers.map(blockerText).join(" · ")}</p>
          )}
          {recommendation.includesFallback && (
            <p className="mt-1 text-base text-white/60">The total counts a way of getting there that a guest did not choose, as an assumption.</p>
          )}
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex h-[54px] cursor-pointer items-center gap-2.5 rounded-full border border-white/30 bg-white/[0.14] px-6 text-xl outline-none transition-[background-color,transform] hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-emerald-300/60 active:scale-[0.97]"
        >
          Why?
          <ChevronDown aria-hidden className={cn("size-5 stroke-[1.8] transition-transform duration-300", open && "rotate-180")} />
        </button>
      </div>

      <div id={panelId} className={cn("grid transition-[grid-template-rows] duration-500 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden" inert={!open}>
          <div className="flex flex-col gap-8 pt-8">
            <ul className="flex flex-col gap-3 text-xl leading-snug text-white/90">
              {recommendation.reasons.map((reason, index) => (
                <li key={index} className="flex gap-3">
                  <span aria-hidden className={cn("mt-2.5 size-2.5 shrink-0 rounded-full", reason.kind === "star_cannot_override" ? "bg-[#e5c35a]" : works ? "bg-[#2ec48f]" : "bg-amber-300")} />
                  {reasonText(reason)}
                </li>
              ))}
            </ul>

            <div className="overflow-x-auto rounded-[24px] bg-white p-2 text-black">
              <table className="w-full min-w-[760px] text-left text-lg">
                <caption className="sr-only">Every destination, best first, with the figures that ranked it</caption>
                <thead className="text-base text-black/55">
                  <tr>
                    <th className="px-4 py-2 font-normal">#</th>
                    <th className="px-4 py-2 font-normal">Destination</th>
                    <th className="px-4 py-2 font-normal">Works for everyone</th>
                    <th className="px-4 py-2 font-normal">Comfortably in budget</th>
                    <th className="px-4 py-2 font-normal">Comfort</th>
                    <th className="px-4 py-2 font-normal">★</th>
                    <th className="px-4 py-2 text-right font-normal">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendation.ranking.map((row) => (
                    <tr key={row.destinationId} className="border-t border-black/10 align-top">
                      <td className="px-4 py-3 text-[#0d4a35]">{row.rank}</td>
                      <td className="px-4 py-3 text-[#0d4a35]">{row.shortLabel}</td>
                      <td className="px-4 py-3">
                        {row.eligible ? (
                          <span className="text-[#1f9d74]">Yes</span>
                        ) : (
                          <ul className="flex flex-col gap-1 text-[#d33a2f]">
                            {row.blockers.map((blocker) => (
                              <li key={`${blocker.kind}-${blocker.guestId}`}>{blockerText(blocker)}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.comfyGuests} of {guestCount}
                      </td>
                      <td className="px-4 py-3">{row.averageComfort === null ? "—" : `${Math.round(row.averageComfort)}/100`}</td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1">
                          <Star aria-hidden className={cn("size-4", row.votes > 0 ? "fill-[#e5c35a] text-[#c9a84c]" : "text-black/30")} />
                          {row.votes}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">{formatEur(row.totalEur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="-mt-3 text-base text-white/60">
              Ranked by: works for everyone, then guests comfortably within budget, then comfort of the journeys, then ★, then total. A ★ only settles a tie.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
