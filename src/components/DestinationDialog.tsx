"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Bed, Calendar, Crown, Plane, Receipt, Sparkles, Star, X } from "lucide-react";
import Link from "next/link";
import { formatDuration } from "@/core/comfort";
import {
  BUDGET_LEVEL_LABELS,
  blockerLabel,
  countryName,
  guestHue,
  OBJECTIVE_LABELS,
  standingOfCell,
  STANDING_HEX,
  STANDING_WORD,
} from "@/lib/deliberationText";
import { formatDateRange, formatEur, formatEurShort } from "@/lib/form";
import { MODE_LABELS } from "@/lib/reachabilityText";
import { tripPath } from "@/lib/trip";
import { cn } from "@/lib/utils";
import type { DeliberationGuest, Dossier } from "@/server/services/deliberation";
import { VERDICT_STYLE } from "./AiPanel";
import { glassSurface } from "./GlassCard";
import { GuestAvatar } from "./GuestAvatar";
import { TierBadge } from "./DestinationSelect";
import { ValidateButton } from "./ValidateButton";

/** What the AI said about this destination, in full. */
export type AiDetail = { verdict: keyof typeof VERDICT_STYLE; score: number; summary: string; strengths: string[]; concerns: string[]; picked: boolean };

const PROVIDER_LABELS = { airbnb: "Airbnb", booking: "Hotel" } as const;

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 rounded-[20px] bg-white/[0.08] p-4">
      <span className="mt-0.5 text-white/70 [&_svg]:size-6 [&_svg]:stroke-[1.4]">{icon}</span>
      <div className="min-w-0">
        <dt className="text-base text-white/60">{label}</dt>
        <dd className="text-xl">{children}</dd>
      </div>
    </div>
  );
}

/**
 * Everything known about one destination, in one place: the facts, what each guest would pay and
 * how they would get there, the accommodation, and what the AI thinks of it when it has said.
 */
export function DestinationDialog({
  tripId,
  dossier,
  guests,
  ai,
  validatedSummaryId,
  onClose,
}: {
  tripId: string;
  dossier: Dossier | null;
  guests: DeliberationGuest[];
  ai: AiDetail | null;
  /** The summary of this destination when the group validated it, else null */
  validatedSummaryId: string | null;
  onClose: () => void;
}) {
  const voters = dossier ? guests.filter((g) => dossier.votes.guestIds.includes(g.id)) : [];
  const withDest = (path: string) => (dossier ? `${tripPath(tripId, path)}?dest=${dossier.id}` : "#");

  return (
    <Dialog.Root open={dossier !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/25 backdrop-blur-md transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            glassSurface,
            "fixed top-1/2 left-1/2 z-50 max-h-[92vh] w-[min(980px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[40px] bg-[#606060]/95 p-9 text-white outline-none transition-[opacity,scale] duration-200 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          )}
        >
          {dossier && (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-5">
                  <span className={cn("flex size-16 shrink-0 items-center justify-center rounded-full text-4xl", dossier.rank === 1 ? "bg-[#c9a84c] shadow-[0_0_20px_rgb(230_180_70/0.55)]" : "bg-white/15")}>
                    {dossier.rank}
                  </span>
                  <div className="min-w-0">
                    <Dialog.Title className="truncate text-4xl font-normal">{dossier.label}</Dialog.Title>
                    <div className="mt-2 flex flex-wrap gap-2 text-base">
                      {dossier.recommended && (
                        <span className="flex items-center gap-1.5 rounded-full bg-emerald-300/25 px-3 py-0.5 text-emerald-50">
                          <Crown aria-hidden className="size-4" /> Recommended
                        </span>
                      )}
                      {ai?.picked && (
                        <span className="flex items-center gap-1.5 rounded-full bg-violet-400/35 px-3 py-0.5 text-violet-50">
                          <Sparkles aria-hidden className="size-4" /> AI&rsquo;s pick
                        </span>
                      )}
                      {!dossier.inScope && <span className="rounded-full border border-amber-200/50 bg-[#7a6a3a] px-3 py-0.5 text-amber-100">Outside Europe</span>}
                      {dossier.eligible ? (
                        <span className="rounded-full bg-white/12 px-3 py-0.5 text-white/85">Works for everyone</span>
                      ) : (
                        dossier.blockers.map((blocker) => (
                          <span key={`${blocker.kind}-${blocker.guestId}`} className="rounded-full bg-rose-400/25 px-3 py-0.5 text-rose-50">
                            {blockerLabel(blocker)}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <TierBadge tier={dossier.tier} />
                  <Dialog.Close aria-label="Close" className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/15 outline-none transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-emerald-300/60">
                    <X aria-hidden className="size-6" />
                  </Dialog.Close>
                </div>
              </div>

              <dl className="mt-8 grid gap-4 sm:grid-cols-2">
                <Fact icon={<Plane />} label="Where">
                  {countryName(dossier.countryCode)}
                  {dossier.airports.length > 0 && <span className="text-white/60"> · {dossier.airports.join(", ")}</span>}
                </Fact>
                <Fact icon={<Receipt />} label="The trip">
                  {OBJECTIVE_LABELS[dossier.objective]} · {BUDGET_LEVEL_LABELS[dossier.budgetLevel]}
                </Fact>
                <Fact icon={<Calendar />} label="Dates">
                  {dossier.window ? (
                    <>
                      {formatDateRange(dossier.window.from, dossier.window.to)} · {dossier.window.nights} {dossier.window.nights === 1 ? "night" : "nights"}
                      {dossier.window.limitedBy.length > 0 && <span className="text-white/60"> · set by {dossier.window.limitedBy.join(", ")}</span>}
                    </>
                  ) : (
                    <span className="text-rose-200">No dates work for everyone</span>
                  )}
                </Fact>
                <Fact icon={<Star />} label="★ votes">
                  {voters.length > 0 ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {voters.map((voter) => (
                        <span key={voter.id} className="flex items-center gap-2">
                          <GuestAvatar name={voter.name} hue={guestHue(guests.indexOf(voter))} size={30} />
                          {voter.name}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-white/55">Nobody yet</span>
                  )}
                </Fact>
                <div className="sm:col-span-2">
                  <Fact icon={<Bed />} label="Accommodation">
                    {dossier.housing ? (
                      <>
                        {dossier.housing.title}
                        <span className="text-white/60">
                          {" "}
                          · {PROVIDER_LABELS[dossier.housing.provider]} · {formatEur(dossier.housing.totalEur)} in all, {formatEurShort(dossier.housing.perGuestEur)} per guest
                          {dossier.housing.chosen ? " · the group's ❤" : " · the cheapest that fits"}
                          {dossier.housing.fitScore !== null && ` · ${dossier.housing.ratedBy === "rules" ? "rule-based" : "AI"} fit ${dossier.housing.fitScore}/100`}
                        </span>
                      </>
                    ) : (
                      <span className="text-white/55">No accommodation found</span>
                    )}
                  </Fact>
                </div>
              </dl>

              <h3 className="mt-9 mb-3 text-2xl font-normal">Guest by guest</h3>
              <div className="overflow-x-auto rounded-[24px] bg-white p-2 text-black">
                <table className="w-full min-w-[720px] text-left text-lg">
                  <thead className="text-base text-black/55">
                    <tr>
                      <th className="px-4 py-2 font-normal">Guest</th>
                      <th className="px-4 py-2 font-normal">Getting there</th>
                      <th className="px-4 py-2 text-right font-normal">Transport</th>
                      <th className="px-4 py-2 text-right font-normal">Housing</th>
                      <th className="px-4 py-2 text-right font-normal">Total</th>
                      <th className="px-4 py-2 font-normal">Of their budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guests.map((guest, i) => {
                      const cell = dossier.cells.find((c) => c.guestId === guest.id)!;
                      const standing = standingOfCell(cell);
                      const hex = STANDING_HEX[standing];
                      return (
                        <tr key={guest.id} className="border-t border-black/10">
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-3">
                              <GuestAvatar name={guest.name} hue={guestHue(i)} size={36} starred={cell.starred} />
                              {guest.name}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-black/75">
                            {cell.transport ? (
                              <>
                                {MODE_LABELS[cell.transport.mode]}
                                {cell.transport.durationMin !== null && ` · ${formatDuration(cell.transport.durationMin)}`}
                                {cell.transport.assumed && <span className="text-[#d33a2f]"> · assumed</span>}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">{cell.transport ? formatEurShort(cell.transport.costEur) : "—"}</td>
                          <td className="px-4 py-3 text-right">{formatEurShort(cell.housingShareEur)}</td>
                          <td className="px-4 py-3 text-right" style={{ color: hex }}>
                            {cell.costEur === null ? "—" : formatEurShort(cell.costEur)}
                          </td>
                          <td className="px-4 py-3" style={{ color: hex }}>
                            {standing === "unreachable"
                              ? STANDING_WORD.unreachable
                              : `${Math.round((cell.budgetRatio ?? 0) * 100)} % · ${STANDING_WORD[standing]}`}
                            {cell.bestFit && <span className="ml-2 rounded-full bg-[#2ec48f]/15 px-2 py-0.5 text-sm text-[#1f9d74]">Best fit</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-black/15">
                      <td className="px-4 py-3" colSpan={4}>
                        The group{dossier.includesFallback ? " (rests on an assumption)" : ""}
                      </td>
                      <td className="px-4 py-3 text-right" style={{ color: STANDING_HEX[dossier.tier] }}>
                        {formatEur(dossier.totalEur)}
                      </td>
                      <td className="px-4 py-3 text-black/65">{formatEur(dossier.perGuestEur)} each</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {ai && (
                <div className="mt-8 rounded-[24px] border border-violet-300/40 bg-violet-400/15 p-6">
                  <h3 className="flex items-center gap-3 text-2xl font-normal">
                    <Sparkles aria-hidden className="size-6 stroke-[1.6] text-violet-200" />
                    The AI on {dossier.shortLabel}
                    <span className="rounded-full bg-white px-3 py-0.5 text-lg" style={{ color: VERDICT_STYLE[ai.verdict].hex }}>
                      {VERDICT_STYLE[ai.verdict].label} · {ai.score}/100
                    </span>
                  </h3>
                  <p className="mt-3 text-xl leading-relaxed text-white/85">{ai.summary}</p>
                  <div className="mt-4 grid gap-6 sm:grid-cols-2">
                    {ai.strengths.length > 0 && (
                      <ul className="flex flex-col gap-1.5 text-lg text-white/85">
                        {ai.strengths.map((strength) => (
                          <li key={strength} className="flex gap-2">
                            <span aria-hidden className="text-[#2ec48f]">+</span>
                            {strength}
                          </li>
                        ))}
                      </ul>
                    )}
                    {ai.concerns.length > 0 && (
                      <ul className="flex flex-col gap-1.5 text-lg text-white/85">
                        {ai.concerns.map((concern) => (
                          <li key={concern} className="flex gap-2">
                            <span aria-hidden className="text-[#ff7a70]">−</span>
                            {concern}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              <nav aria-label="Go further" className="mt-8 flex flex-wrap gap-3">
                {[
                  ["Housing", "/housing"],
                  ["Transports", "/transports"],
                  ["Budget", "/budget"],
                ].map(([label, path]) => (
                  <Link
                    key={path}
                    href={path === "/budget" ? tripPath(tripId, path) : withDest(path)}
                    className="flex h-[54px] items-center rounded-full border border-white/25 bg-white/[0.14] px-7 text-xl outline-none transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-emerald-300/60"
                  >
                    {label}
                  </Link>
                ))}
                <ValidateButton
                  key={dossier.id}
                  tripId={tripId}
                  destinationId={dossier.id}
                  destinationName={dossier.shortLabel}
                  totalEur={dossier.totalEur}
                  perGuestEur={dossier.perGuestEur}
                  problems={dossier.blockers.map(blockerLabel)}
                  validatedSummaryId={validatedSummaryId}
                  className="ml-auto"
                />
              </nav>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
