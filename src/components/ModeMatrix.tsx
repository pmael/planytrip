"use client";

import { BusFront, CarFront, Plane, TramFront } from "lucide-react";
import type { ReactNode } from "react";
import type { Guest, GuestModes, TransportMode } from "@/core/types";
import { cn } from "@/lib/utils";
import { glassSurface } from "./GlassCard";

const MODES: { id: TransportMode; label: string; icon: ReactNode }[] = [
  { id: "plane", label: "Plane", icon: <Plane /> },
  { id: "train", label: "Train", icon: <TramFront /> },
  { id: "bus", label: "Flix Bus", icon: <BusFront /> },
  { id: "car", label: "Car", icon: <CarFront /> },
];

/**
 * The four means of transportation as cards, for one guest at a time: a green card is accepted
 * by the selected guest. Their preferred mode is always accepted (use-cases.md A-S3) and cannot
 * be switched off. With several guests, a row of tabs chooses whose modes are shown.
 */
export function ModeMatrix({
  guests,
  guestModes,
  selectedId,
  onSelect,
  onToggle,
}: {
  guests: Guest[];
  guestModes: GuestModes;
  selectedId: string;
  onSelect: (guestId: string) => void;
  onToggle: (guest: Guest, mode: TransportMode) => void;
}) {
  const guest = guests.find((g) => g.id === selectedId) ?? guests[0];
  const accepted = guestModes[guest.id] ?? [guest.preferredMode];

  return (
    <div className="flex w-full flex-col items-center gap-10">
      {guests.length > 1 && (
        <div role="tablist" aria-label="Guest" className="flex flex-wrap justify-center gap-3">
          {guests.map((other) => (
            <button
              key={other.id}
              type="button"
              role="tab"
              aria-selected={other.id === guest.id}
              onClick={() => onSelect(other.id)}
              className={cn(
                "h-12 rounded-full border px-7 text-xl outline-none transition-[background-color,color,border-color] duration-200 focus-visible:ring-2 focus-visible:ring-emerald-300/60",
                other.id === guest.id
                  ? "border-white bg-white text-[#0d4a35]"
                  : "border-white/25 bg-white/10 text-white/80 hover:bg-white/20",
              )}
            >
              {other.name}
            </button>
          ))}
        </div>
      )}

      <ul className="grid w-full grid-cols-2 gap-6 lg:grid-cols-4 lg:gap-[4%]">
        {MODES.map((mode, i) => {
          const isAccepted = accepted.includes(mode.id);
          const isPreferred = guest.preferredMode === mode.id;
          return (
            <li
              key={mode.id}
              className="animate-[card-in_0.6s_cubic-bezier(0.22,1,0.36,1)_both]"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <button
                type="button"
                aria-pressed={isAccepted}
                aria-disabled={isPreferred}
                title={isPreferred ? `${guest.name}'s preferred mode is always accepted` : undefined}
                onClick={() => !isPreferred && onToggle(guest, mode.id)}
                className={cn(
                  glassSurface,
                  "relative flex aspect-[368/404] w-full flex-col items-center justify-between rounded-[44px] pb-9 pt-[24%] text-2xl text-white outline-none transition-[background-color,transform] duration-300 focus-visible:ring-2 focus-visible:ring-emerald-300/50 motion-reduce:transition-none",
                  isPreferred ? "cursor-default" : "hover:bg-white/[0.2] active:scale-[0.98]",
                  isAccepted && "bg-[#5f8a77]/80",
                  isAccepted && !isPreferred && "hover:bg-[#5f8a77]/90",
                )}
              >
                {isPreferred && (
                  <span className="absolute top-5 right-6 rounded-full bg-white/20 px-3.5 py-1 text-base">Preferred</span>
                )}
                <span className="flex size-[150px] items-center justify-center rounded-full bg-white text-black [&_svg]:size-[72px] [&_svg]:stroke-[1.5]">
                  {mode.icon}
                </span>
                {mode.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
