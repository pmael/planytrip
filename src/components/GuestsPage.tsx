"use client";

import { Calendar, CreditCard, Star, Trash2, UserPlus, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { commonWindow, limitingGuests, nightsBetween } from "@/core/dates";
import { guestHue, standingOfCell, STANDING_HEX, STANDING_WORD } from "@/lib/deliberationText";
import { formatDateRange, formatEur } from "@/lib/form";
import { MODE_LABELS } from "@/lib/reachabilityText";
import { tripPath } from "@/lib/trip";
import { cn } from "@/lib/utils";
import type { DeliberationGuest, ReadyDeliberation } from "@/server/services/deliberation";
import { GuestAvatar } from "./GuestAvatar";
import { GuestEditDialog } from "./GuestEditDialog";
import { glassSurface } from "./GlassCard";
import { PageTitle } from "./PageTitle";
import { RecomputeButton } from "./RecomputeButton";
import { MODE_ICONS } from "./TransportCard";
import { Tile } from "./DashboardCard";

const ghostButton =
  "flex h-[50px] cursor-pointer items-center gap-2 rounded-full border border-white/25 bg-white/[0.12] px-5 text-lg outline-none transition-[background-color,transform] hover:bg-white/22 focus-visible:ring-2 focus-visible:ring-emerald-300/60 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-5 [&_svg]:stroke-[1.5]";

function GuestCard({
  guest,
  index,
  view,
  onEdit,
  onRemove,
  canRemove,
  removing,
}: {
  guest: DeliberationGuest;
  index: number;
  view: ReadyDeliberation;
  onEdit: () => void;
  onRemove: () => void;
  canRemove: boolean;
  removing: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const favorite = view.destinations.find((d) => d.id === guest.favoriteId);

  return (
    <li
      aria-label={guest.name}
      className={cn(glassSurface, "flex animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both] flex-col gap-6 rounded-[44px] bg-white/[0.12] p-8 text-white")}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <header className="flex items-center gap-5">
        <GuestAvatar name={guest.name} hue={guestHue(index)} size={68} starred={favorite !== undefined} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-3xl font-normal">{guest.name}</h2>
          <p className="truncate text-lg text-white/65">
            {guest.homeLabel} · prefers {MODE_LABELS[guest.preferredMode].toLowerCase()}
          </p>
        </div>
      </header>

      <Tile className="grid grid-cols-3 py-4 text-black">
        <div className="min-w-0 px-3 text-center">
          <p className="flex items-center justify-center gap-1.5 text-lg [&_svg]:size-4 [&_svg]:stroke-[1.6]">
            <CreditCard aria-hidden />
            Budget
          </p>
          <p className="mt-1 text-2xl whitespace-nowrap text-[#0d4a35]">{formatEur(guest.maxBudgetEur)}</p>
        </div>
        <div className="min-w-0 border-l border-black/60 px-3 text-center">
          <p className="flex items-center justify-center gap-1.5 text-lg [&_svg]:size-4 [&_svg]:stroke-[1.6]">
            <Calendar aria-hidden />
            Available
          </p>
          <p className="mt-1 text-xl whitespace-nowrap text-[#0d4a35]">{formatDateRange(guest.availableFrom, guest.availableTo)}</p>
        </div>
        <div className="min-w-0 border-l border-black/60 px-3 text-center">
          <p className="text-lg">Accepts</p>
          <p className="mt-1 flex items-center justify-center gap-2 text-[#0d4a35] [&_svg]:size-6 [&_svg]:stroke-[1.5]">
            {guest.modes.map((mode) => {
              const Icon = MODE_ICONS[mode];
              return <Icon key={mode} aria-label={MODE_LABELS[mode]} />;
            })}
          </p>
        </div>
      </Tile>

      <div>
        <h3 className="mb-3 flex items-center justify-between text-xl text-white/80">
          Where they stand
          <span className="flex items-center gap-2 text-base">
            <Star aria-hidden className={cn("size-4", favorite ? "fill-[#e5c35a] text-[#e5c35a]" : "text-white/40")} />
            {favorite ? <span className="text-[#e5c35a]">{favorite.shortLabel}</span> : <span className="text-white/50">No ★ yet</span>}
          </span>
        </h3>
        <ul className="flex flex-col gap-2.5">
          {view.destinations.map((dossier) => {
            const cell = dossier.cells.find((c) => c.guestId === guest.id)!;
            const standing = standingOfCell(cell);
            const hex = STANDING_HEX[standing];
            return (
              <li key={dossier.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-x-3 rounded-full bg-white/[0.08] py-2 pr-5 pl-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-white/15 text-base">{dossier.rank}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-xl">{dossier.shortLabel}</span>
                  {cell.starred && <Star aria-label="Their ★" className="size-4 shrink-0 fill-[#e5c35a] text-[#e5c35a]" />}
                  {cell.bestFit && <span className="shrink-0 rounded-full bg-emerald-300/25 px-2 py-0.5 text-sm text-emerald-50">Best fit</span>}
                </span>
                <span className="flex items-center gap-3 text-right text-xl whitespace-nowrap" style={{ color: hex }} title={STANDING_WORD[standing]}>
                  <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: hex }} />
                  {standing === "unreachable" ? "No way there" : cell.costEur === null ? "—" : `${Math.round(cell.costEur)}€`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-3">
        <button type="button" onClick={onEdit} className={ghostButton}>
          <Pencil aria-hidden />
          Edit
        </button>
        {confirming ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onRemove();
              }}
              disabled={removing}
              className={cn(ghostButton, "border-rose-300/60 bg-rose-500/60 hover:bg-rose-500/80")}
            >
              Remove {guest.name}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={ghostButton}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!canRemove}
            title={canRemove ? undefined : "A trip needs at least one guest"}
            className={cn(ghostButton, "hover:bg-rose-500/40")}
          >
            <Trash2 aria-hidden />
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * The guests of the trip (use-cases.md UC-A): who they are, what they can spend and when, and where
 * each stands among the destinations. Budget and name changes show at once; dates, modes or a
 * guest leaving change what has to be searched, so the page offers to recompute.
 */
export function GuestsPage({ tripId, view }: { tripId: string; view: ReadyDeliberation }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<DeliberationGuest | null>(null);
  const [needsRecompute, setNeedsRecompute] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const window = commonWindow(view.guests);
  const limiting = window ? limitingGuests(view.guests, window) : [];
  const nights = window ? nightsBetween(window) : 0;

  async function remove(guest: DeliberationGuest) {
    setRemoving(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/guests/${guest.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Delete answered ${response.status}`);
      setNeedsRecompute(true);
      startTransition(() => router.refresh());
    } catch {
      setProblem(`Couldn’t remove ${guest.name}, please try again.`);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-[1580px] flex-col gap-10">
      <div className="lg:w-[82%]">
        <PageTitle
          action={
            <Link
              href={tripPath(tripId, "/setup/guests")}
              className="flex h-[60px] items-center gap-3 rounded-full border border-white/25 bg-[#7d968b]/80 px-6 text-xl text-white outline-none transition-colors hover:bg-[#8aa598]/90 focus-visible:ring-2 focus-visible:ring-emerald-200/70 [&_svg]:size-5 [&_svg]:stroke-[1.5]"
            >
              <UserPlus aria-hidden />
              <span className="hidden sm:inline">Add a guest</span>
            </Link>
          }
        >
          Guests
        </PageTitle>
      </div>

      <p
        role="status"
        className={cn(glassSurface, "flex animate-[fade-up_0.5s_ease-out_both] items-center gap-4 self-start rounded-full px-7 py-3.5 text-xl text-white [&_svg]:size-6 [&_svg]:shrink-0 [&_svg]:stroke-[1.4]", !window && "border-rose-300/50 bg-rose-400/15")}
      >
        <Calendar aria-hidden className={window ? "text-[#2ec48f]" : "text-rose-200"} />
        {window ? (
          <span>
            Everyone is free {formatDateRange(window.from, window.to)} ({nights} {nights === 1 ? "night" : "nights"})
            {limiting.length > 0 && limiting.length < view.guests.length && <span className="text-white/65"> · set by {limiting.map((guest) => guest.name).join(", ")}</span>}
          </span>
        ) : (
          <span>There are no dates when everyone is free.</span>
        )}
      </p>

      {needsRecompute && (
        <div role="status" className={cn(glassSurface, "flex animate-[fade-up_0.5s_ease-out_both] flex-wrap items-center gap-5 rounded-[32px] border-amber-200/45 bg-amber-300/[0.1] px-7 py-5 text-xl text-white")}>
          <p className="min-w-[260px] flex-1">That changes what has to be searched: fares and stays were worked out for the old dates, modes or guests.</p>
          <RecomputeButton tripId={tripId}>Recompute now</RecomputeButton>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-lg text-rose-200">
          {problem}
        </p>
      )}

      <ul className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        {view.guests.map((guest, index) => (
          <GuestCard
            key={guest.id}
            guest={guest}
            index={index}
            view={view}
            onEdit={() => setEditing(guest)}
            onRemove={() => remove(guest)}
            canRemove={view.guests.length > 1}
            removing={removing}
          />
        ))}
      </ul>

      <GuestEditDialog
        guest={editing}
        onSaved={({ needsRecompute: stale }) => {
          if (stale) setNeedsRecompute(true);
          startTransition(() => router.refresh());
        }}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
