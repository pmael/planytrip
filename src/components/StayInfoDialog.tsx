"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { formatDateRange, formatEurShort } from "@/lib/form";
import type { StayCard } from "@/server/services/stays";
import { glassSurface } from "./GlassCard";
import { cn } from "@/lib/utils";

/** Everything known about one offer, in a list ("More Info"). */
export function StayInfoDialog({ stay, onClose }: { stay: StayCard | null; onClose: () => void }) {
  const rows: [string, string][] = stay
    ? [
        ["Source", stay.provider === "booking" ? "Hotel" : "Airbnb"],
        ["Stay", `${formatDateRange(stay.checkIn, stay.checkOut)} · ${stay.nights} ${stay.nights === 1 ? "night" : "nights"}`],
        ["Sleeps", `${stay.capacity} ${stay.capacity === 1 ? "person" : "people"}`],
        ...(stay.rooms !== null ? [["Rooms", String(stay.rooms)] as [string, string]] : []),
        ...(stay.beds !== null ? [["Beds", String(stay.beds)] as [string, string]] : []),
        ...(stay.rating !== null ? [["Rating", `${stay.rating} / 5`] as [string, string]] : []),
        ["Total", formatEurShort(stay.totalEur)],
        ["Per guest", formatEurShort(stay.perGuestEur)],
        ["Per guest, per night", formatEurShort(stay.perGuestNightEur)],
      ]
    : [];

  return (
    <Dialog.Root open={stay !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/25 backdrop-blur-md transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            glassSurface,
            "fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[40px] bg-[#606060]/95 p-9 text-white outline-none transition-[opacity,scale] duration-200 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-3xl font-normal">{stay?.title}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/15 outline-none transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-emerald-300/60">
              <X aria-hidden className="size-6" />
            </Dialog.Close>
          </div>
          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-xl">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-white/60">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {stay && !stay.fits && (
            <p className="mt-6 text-lg text-rose-200">It sleeps {stay.capacity}: too small for the whole group.</p>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
