import { Calendar, TriangleAlert } from "lucide-react";
import { commonWindow, limitingGuests, nightsBetween, noCommonDates } from "@/core/dates";
import type { Guest } from "@/core/types";
import { formatDayMonth } from "@/lib/form";
import { cn } from "@/lib/utils";
import { glassSurface } from "./GlassCard";

/**
 * Says when the whole group can travel, from the guests' availabilities (use-cases.md A.1, A-S2):
 * "Common window: 26/08 → 05/09 (10 nights). Limited by Martin." or why there is none.
 * Nothing to say with fewer than two guests.
 */
export function WindowBanner({ guests }: { guests: Guest[] }) {
  if (guests.length < 2) return null;

  const window = commonWindow(guests);
  const clash = noCommonDates(guests);
  if (!window && !clash) return null;

  const nights = window ? nightsBetween(window) : 0;
  const limiting = window ? limitingGuests(guests, window) : [];

  return (
    <div
      role="status"
      className={cn(
        glassSurface,
        "flex animate-[fade-up_0.5s_cubic-bezier(0.22,1,0.36,1)_both] items-center gap-4 self-center rounded-full px-8 py-4 text-xl text-white [&_svg]:size-7 [&_svg]:shrink-0 [&_svg]:stroke-[1.4]",
        !window && "border-rose-300/50 bg-rose-400/15 shadow-[0_0_24px_rgb(244_63_94/0.25)]",
      )}
    >
      {window ? <Calendar aria-hidden className="text-[#2ec48f]" /> : <TriangleAlert aria-hidden className="text-rose-200" />}
      {window ? (
        <p>
          Common window:{" "}
          <strong className="font-normal text-[#7ce6bd]">
            {formatDayMonth(window.from)} → {formatDayMonth(window.to)}
          </strong>{" "}
          ({nights} {nights === 1 ? "night" : "nights"}).
          {limiting.length > 0 && <> Limited by {limiting.map((guest) => guest.name).join(", ")}.</>}
        </p>
      ) : (
        <p>
          No common dates between {clash![0].name} and {clash![1].name}.
        </p>
      )}
    </div>
  );
}
