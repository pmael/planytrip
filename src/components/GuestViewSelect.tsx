"use client";

import { guestHue } from "@/lib/deliberationText";
import { cn } from "@/lib/utils";
import { GuestAvatar } from "./GuestAvatar";

/**
 * "Guest view": All, or one guest. It only changes how the cards are shown, never the data
 * (use-cases.md C-S4): a guest's own cost, coloured by their own budget, instead of the average.
 */
export function GuestViewSelect({
  guests,
  selectedId,
  onChange,
}: {
  guests: { id: string; name: string }[];
  selectedId: string | null;
  onChange: (guestId: string | null) => void;
}) {
  const options: { id: string | null; name: string; index: number }[] = [{ id: null, name: "All", index: -1 }, ...guests.map((guest, index) => ({ id: guest.id, name: guest.name, index }))];

  return (
    <div role="radiogroup" aria-label="Guest view" className="flex flex-wrap items-center gap-3">
      <span className="pr-1 text-xl text-white/75">Guest view</span>
      {options.map((option) => {
        const on = option.id === selectedId;
        return (
          <button
            key={option.id ?? "all"}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.id)}
            className={cn(
              "flex h-[50px] cursor-pointer items-center gap-2.5 rounded-full border pr-5 text-xl outline-none transition-[background-color,border-color,box-shadow,transform] duration-300 focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.97]",
              option.id === null ? "pl-5" : "pl-1.5",
              on ? "border-sky-300/60 bg-sky-400/40 shadow-[0_0_18px_rgb(125_180_255/0.4)]" : "border-white/20 bg-white/[0.12] hover:bg-white/[0.22]",
            )}
          >
            {option.id !== null && <GuestAvatar name={option.name} hue={guestHue(option.index)} size={36} />}
            {option.name}
          </button>
        );
      })}
    </div>
  );
}
