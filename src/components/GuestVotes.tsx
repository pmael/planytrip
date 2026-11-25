"use client";

import { Calendar, CreditCard, Star, User } from "lucide-react";
import { useState } from "react";
import { TIER_LABELS, toneOfColor, toneOfTier } from "@/lib/colorClasses";
import { formatDateRange } from "@/lib/form";
import { cn } from "@/lib/utils";
import type { DashboardGuest } from "@/server/services/dashboard";
import { glassSurface } from "./GlassCard";
import { Divider, TextSegment, ValuePill } from "./EntryRow";

/**
 * Each guest's budget tier and dates for the selected destination, and their ★ vote: the button
 * puts the guest's ★ on this destination (a guest has one), and pressing it again takes it off.
 * The vote is saved as it is made. The parent gives it a `key` per destination, so it starts over
 * from what the server says whenever the destination changes.
 */
export function GuestVotes({
  guests,
  destination,
}: {
  guests: DashboardGuest[];
  destination: { id: string; name: string };
}) {
  const [starred, setStarred] = useState(() => new Set(guests.filter((g) => g.starred).map((g) => g.id)));
  const [failed, setFailed] = useState(false);

  async function toggle(guestId: string) {
    const wasStarred = starred.has(guestId);
    const setTo = (on: boolean) =>
      setStarred((current) => {
        const next = new Set(current);
        if (on) next.add(guestId);
        else next.delete(guestId);
        return next;
      });

    setTo(!wasStarred);
    setFailed(false);
    try {
      const response = await fetch(`/api/guests/${guestId}/favorite`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destinationId: wasStarred ? null : destination.id }),
      });
      if (!response.ok) throw new Error(`Favorite answered ${response.status}`);
    } catch {
      setTo(wasStarred);
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-[46px]">
      {/* Three guests are shown, the rest are a scroll away (room around the rows is for their glow) */}
      <ul
        aria-label="Guests"
        tabIndex={guests.length > 3 ? 0 : undefined}
        className="-mx-4 -my-3 flex max-h-[404px] flex-col gap-[46px] overflow-y-auto px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/40 [scrollbar-color:rgb(255_255_255/0.35)_transparent] [scrollbar-width:thin]"
      >
        {guests.map((guest, i) => {
          const isStarred = starred.has(guest.id);
          return (
            <li
              key={guest.id}
              className="flex animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both] items-center gap-6"
              style={{ animationDelay: `${450 + i * 90}ms` }}
            >
              <div
                className={cn(
                  glassSurface,
                  "flex h-[86px] min-w-0 flex-1 items-center justify-between gap-4 rounded-full px-8 text-2xl text-white transition-shadow duration-500 [&_svg]:stroke-[1.25]",
                  isStarred && "border-amber-300/40 shadow-[0_0_26px_rgb(230_180_70/0.4)]",
                )}
              >
                <TextSegment className="w-[120px]" icon={<User />}>
                  {guest.name}
                </TextSegment>
                <Divider />
                <ValuePill className="w-[172px]" icon={<CreditCard />} tone={toneOfTier(guest.tier)}>
                  {TIER_LABELS[guest.tier].replace(" budget", "")}
                </ValuePill>
                <Divider />
                <ValuePill className="w-[254px]" icon={<Calendar />} tone={toneOfColor(guest.datesColor)}>
                  {formatDateRange(guest.availableFrom, guest.availableTo)}
                </ValuePill>
              </div>

              <button
                type="button"
                aria-pressed={isStarred}
                aria-label={`${guest.name}'s ★ for ${destination.name}`}
                onClick={() => toggle(guest.id)}
                className={cn(
                  glassSurface,
                  "flex h-[86px] w-[308px] shrink-0 cursor-pointer items-center gap-8 rounded-full px-8 text-2xl text-white outline-none transition-[background-color,box-shadow,transform] duration-300 hover:bg-white/[0.22] focus-visible:ring-2 focus-visible:ring-emerald-300/50 active:scale-[0.97]",
                  isStarred && "border-amber-200/50 bg-[#c9a84c] shadow-[0_0_26px_rgb(230_180_70/0.55)] hover:bg-[#d4b45a]",
                )}
              >
                <Star className={cn("size-9 stroke-[1.4] transition-transform duration-300", isStarred && "scale-110 fill-white")} />
                <span className="truncate">{destination.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {failed && (
        <p role="alert" className="text-lg text-rose-200">
          Couldn’t save that ★, please try again.
        </p>
      )}
    </div>
  );
}
