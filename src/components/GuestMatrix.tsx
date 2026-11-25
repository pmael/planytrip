"use client";

import { Ban, HeartCrack, Star, ThumbsUp } from "lucide-react";
import { formatDuration } from "@/core/comfort";
import { COLOR_TEXT } from "@/lib/colorClasses";
import { guestHue, standingOfCell, STANDING_HEX, STANDING_WORD, type Standing } from "@/lib/deliberationText";
import { formatEur, formatEurShort } from "@/lib/form";
import { cn } from "@/lib/utils";
import type { DeliberationGuest, Dossier, GuestCell } from "@/server/services/deliberation";
import { glassSurface } from "./GlassCard";
import { GuestAvatar } from "./GuestAvatar";
import { MODE_ICONS } from "./TransportCard";
import { TrendIcon } from "./TrendIcon";

/** What the pointer is on: a guest's row, a destination's column, or both (a cell). */
export type Focus = { guestId: string | null; destinationId: string | null };

/** The bar is drawn up to this share of the budget; the tick marks 100 %. */
const BAR_MAX = 1.5;

function RatioBar({ ratio, hex }: { ratio: number | null; hex: string }) {
  const width = ratio === null ? 0 : (Math.min(ratio, BAR_MAX) / BAR_MAX) * 100;
  return (
    <div className="relative h-2.5 rounded-full bg-black/10" role="img" aria-label={ratio === null ? "No cost" : `${Math.round(ratio * 100)} % of the budget`}>
      <div
        className="absolute inset-y-0 left-0 animate-[progress-fill_0.9s_cubic-bezier(0.22,1,0.36,1)_both] rounded-full"
        style={{ width: `${width}%`, backgroundColor: hex }}
      />
      <span aria-hidden title="100 % of the budget" className="absolute -top-1 -bottom-1 w-0.5 rounded bg-black/45" style={{ left: `${100 / BAR_MAX}%` }} />
    </div>
  );
}

function Cell({
  guest,
  dossier,
  cell,
  dimmed,
  onFocus,
  onStar,
  onOpen,
}: {
  guest: DeliberationGuest;
  dossier: Dossier;
  cell: GuestCell;
  dimmed: boolean;
  onFocus: (focus: Focus) => void;
  onStar: (guestId: string, destinationId: string | null) => void;
  onOpen: (destinationId: string) => void;
}) {
  const standing: Standing = standingOfCell(cell);
  const hex = STANDING_HEX[standing];
  const unreachable = standing === "unreachable";
  const Icon = cell.transport ? MODE_ICONS[cell.transport.mode] : null;

  return (
    <td
      onMouseEnter={() => onFocus({ guestId: guest.id, destinationId: dossier.id })}
      onMouseLeave={() => onFocus({ guestId: null, destinationId: null })}
      className={cn("align-top transition-opacity duration-300", dimmed && "opacity-45")}
    >
      <div
        className={cn(
          "relative flex h-full min-h-[132px] flex-col gap-3 rounded-[22px] bg-white p-4 text-black shadow-[0_6px_20px_rgb(0_0_0/0.18)] transition-shadow duration-300",
          cell.starred && "ring-[3px] ring-[#e5c35a] shadow-[0_0_24px_rgb(230_180_70/0.55)]",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          {unreachable ? (
            <button
              type="button"
              aria-label={`${guest.name} at ${dossier.shortLabel}: no way there. Open details`}
              onClick={() => onOpen(dossier.id)}
              className="flex cursor-pointer items-center gap-2 text-2xl outline-none hover:underline"
              style={{ color: hex }}
            >
              <Ban aria-hidden className="size-6 stroke-[1.8]" />
              No way there
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpen(dossier.id)}
              aria-label={`${guest.name} at ${dossier.shortLabel}: ${cell.costEur === null ? "no cost" : formatEurShort(cell.costEur)}, ${STANDING_WORD[standing].toLowerCase()}. Open details`}
              title={`${guest.name} at ${dossier.shortLabel}: ${STANDING_WORD[standing]}`}
              className="cursor-pointer text-4xl whitespace-nowrap outline-none hover:underline focus-visible:underline"
              style={{ color: hex }}
            >
              {cell.costEur === null ? "—" : `${Math.round(cell.costEur)}€`}
            </button>
          )}
          <button
            type="button"
            aria-pressed={cell.starred}
            aria-label={`${guest.name}'s ★ for ${dossier.shortLabel}`}
            title={cell.starred ? `${guest.name}'s favourite: click to take the ★ off` : `Put ${guest.name}'s ★ on ${dossier.shortLabel}`}
            onClick={() => onStar(guest.id, cell.starred ? null : dossier.id)}
            className="-mt-1 -mr-1 flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-transform hover:scale-125 focus-visible:ring-2 focus-visible:ring-[#c9a84c] active:scale-90"
          >
            <Star aria-hidden className={cn("size-7 stroke-[1.5] transition-[fill,color] duration-300", cell.starred ? "fill-[#e5c35a] text-[#c9a84c]" : "text-black/30")} />
          </button>
        </div>

        {unreachable ? (
          <p className="text-base text-black/60">
            {cell.transport ? `Counted with the ${cell.transport.mode} (${formatEurShort(cell.costEur ?? 0)}), an assumption` : "No transport found at all"}
          </p>
        ) : (
          <>
            <div>
              <RatioBar ratio={cell.budgetRatio} hex={hex} />
              <p className="mt-1.5 text-base text-black/65">
                {cell.budgetRatio === null ? "" : `${Math.round(cell.budgetRatio * 100)} % of ${formatEur(guest.maxBudgetEur)}`}
                {cell.overBudgetEur !== null && cell.overBudgetEur > 0 && <span style={{ color: hex }}> · +{Math.round(cell.overBudgetEur)} €</span>}
              </p>
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 text-base text-black/70">
              {cell.transport && Icon ? (
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <Icon aria-hidden className={cn("size-5 stroke-[1.6]", COLOR_TEXT[cell.transport.comfort])} />
                  {cell.transport.durationMin === null ? "" : formatDuration(cell.transport.durationMin)}
                </span>
              ) : (
                <span />
              )}
              {cell.bestFit && (
                <span className="flex items-center gap-1 rounded-full bg-[#2ec48f]/15 px-2.5 py-0.5 text-sm whitespace-nowrap text-[#1f9d74]" title="Where this guest's numbers are best">
                  <ThumbsUp aria-hidden className="size-3.5 stroke-[2]" />
                  Best fit
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </td>
  );
}

/** Says when a guest's ★ points somewhere their budget can't follow: the heart against the wallet. */
function wishGap(guest: DeliberationGuest, destinations: Dossier[]): string | null {
  const wished = destinations.find((d) => d.id === guest.favoriteId);
  const cell = wished?.cells.find((c) => c.guestId === guest.id);
  if (!wished || !cell) return null;
  const standing = standingOfCell(cell);
  if (standing === "unreachable") return `Wants ${wished.shortLabel} but can't get there`;
  if (standing === "over") return `Wants ${wished.shortLabel} but it's ${Math.round(cell.overBudgetEur ?? 0)} € over budget`;
  return null;
}

/**
 * Who goes where: a guest per row, a destination per column. Each cell is what the trip would cost
 * that guest, how much of their budget it takes, how they would get there, whether it is their
 * ★ and whether it is where their numbers are best (use-cases.md C-S5). The ★ can be put on or
 * taken off right here.
 */
export function GuestMatrix({
  guests,
  destinations,
  focus,
  onFocus,
  onStar,
  onOpen,
}: {
  guests: DeliberationGuest[];
  destinations: Dossier[];
  focus: Focus;
  onFocus: (focus: Focus) => void;
  onStar: (guestId: string, destinationId: string | null) => void;
  onOpen: (destinationId: string) => void;
}) {
  const active = focus.guestId !== null || focus.destinationId !== null;
  const hot = (guestId: string | null, destinationId: string | null) =>
    (guestId !== null && focus.guestId === guestId) || (destinationId !== null && focus.destinationId === destinationId);
  const nameOf = (id: string | null) => destinations.find((d) => d.id === id)?.shortLabel ?? null;

  return (
    <section
      aria-label="Who goes where"
      className={cn(glassSurface, "animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both] rounded-[44px] bg-white/[0.12] p-8 text-white")}
    >
      <header className="mb-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-normal">Who goes where</h2>
          <p className="mt-1 text-lg text-white/65">
            Each guest against each destination: what it costs them, and where their ★ is. Put a ★ right here to vote.
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-base text-white/75" aria-label="Legend">
          {(["comfy", "limited", "over", "unreachable"] as const).map((standing) => (
            <li key={standing} className="flex items-center gap-2">
              <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: STANDING_HEX[standing] }} />
              {STANDING_WORD[standing]}
            </li>
          ))}
        </ul>
      </header>

      <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full min-w-[900px] table-fixed border-separate border-spacing-x-3 border-spacing-y-4">
          <colgroup>
            <col className="w-[270px]" />
            {destinations.map((dossier) => (
              <col key={dossier.id} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th aria-label="Guest" />
              {destinations.map((dossier) => (
                <th
                  key={dossier.id}
                  scope="col"
                  onMouseEnter={() => onFocus({ guestId: null, destinationId: dossier.id })}
                  onMouseLeave={() => onFocus({ guestId: null, destinationId: null })}
                  className={cn("text-left align-bottom font-normal transition-opacity duration-300", active && !hot(null, dossier.id) && "opacity-45")}
                >
                  <button type="button" onClick={() => onOpen(dossier.id)} className="flex w-full cursor-pointer items-center gap-3 rounded-full bg-white/10 py-2 pr-4 pl-2 text-left text-2xl outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-emerald-300/60">
                    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-xl", dossier.rank === 1 ? "bg-[#c9a84c]" : "bg-white/15")}>{dossier.rank}</span>
                    <span className="min-w-0 flex-1 truncate">{dossier.shortLabel}</span>
                    {dossier.votes.count > 0 && (
                      <span className="flex items-center gap-1 text-lg text-[#e5c35a]" title={`${dossier.votes.count} ★`}>
                        <Star aria-hidden className="size-4 fill-current" />
                        {dossier.votes.count}
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {guests.map((guest, row) => {
              const gap = wishGap(guest, destinations);
              return (
                <tr key={guest.id}>
                  <th
                    scope="row"
                    onMouseEnter={() => onFocus({ guestId: guest.id, destinationId: null })}
                    onMouseLeave={() => onFocus({ guestId: null, destinationId: null })}
                    className={cn("pr-2 text-left align-top font-normal transition-opacity duration-300", active && !hot(guest.id, null) && "opacity-45")}
                  >
                    <div className="flex items-start gap-4">
                      <GuestAvatar name={guest.name} hue={guestHue(row)} size={54} starred={guest.favoriteId !== null} />
                      <div className="min-w-0">
                        <p className="text-2xl">{guest.name}</p>
                        <p className="text-base text-white/60">
                          {guest.city} · {formatEur(guest.maxBudgetEur)} max
                        </p>
                        <p className="mt-1 text-base">
                          {guest.favoriteId ? (
                            <span className="text-[#e5c35a]">★ {nameOf(guest.favoriteId)}</span>
                          ) : (
                            <span className="text-white/50">No ★ yet</span>
                          )}
                        </p>
                        {guest.bestFitId && guest.bestFitId !== guest.favoriteId && (
                          <p className="text-base text-emerald-200/90">Best fit: {nameOf(guest.bestFitId)}</p>
                        )}
                        {gap && (
                          <p className="mt-1 flex items-start gap-1.5 text-base text-rose-200">
                            <HeartCrack aria-hidden className="mt-0.5 size-4 shrink-0 stroke-[1.8]" />
                            {gap}
                          </p>
                        )}
                      </div>
                    </div>
                  </th>
                  {destinations.map((dossier) => (
                    <Cell
                      key={dossier.id}
                      guest={guest}
                      dossier={dossier}
                      cell={dossier.cells.find((c) => c.guestId === guest.id)!}
                      dimmed={active && !hot(guest.id, dossier.id)}
                      onFocus={onFocus}
                      onStar={onStar}
                      onOpen={onOpen}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="pr-2 text-left align-middle text-xl font-normal text-white/80">
                The group
              </th>
              {destinations.map((dossier) => (
                <td key={dossier.id} className={cn("transition-opacity duration-300", active && !hot(null, dossier.id) && "opacity-45")}>
                  <div className="flex items-center justify-between gap-2 rounded-full bg-white/10 px-5 py-3 text-xl">
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      {formatEur(dossier.totalEur)}
                      <TrendIcon trend={dossier.trend} className="[&_svg]:size-5" />
                    </span>
                    <span className="text-base whitespace-nowrap text-white/65">{formatEur(dossier.perGuestEur)} each</span>
                  </div>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
