"use client";

import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { TransportGuest } from "@/server/services/transports";
import { glassSurface } from "./GlassCard";

/**
 * Whose journey the page shows (use-cases.md A-S8). Guests who leave from the same place are listed
 * together under it; choosing one reloads the page for them (`?guest=`), keeping the destination.
 */
export function GuestSelect({
  guests,
  selectedId,
  destinationId,
}: {
  guests: TransportGuest[];
  selectedId: string;
  destinationId: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = guests.find((guest) => guest.id === selectedId) ?? guests[0];
  const origins = [...new Set(guests.map((guest) => guest.originKey))];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Guest: ${selected.name}. Change guest`}
        className="flex h-[60px] cursor-pointer items-center gap-3 rounded-full border border-white/25 bg-[#7d968b]/80 px-6 text-xl text-white outline-none transition-colors hover:bg-[#8aa598]/90 focus-visible:ring-2 focus-visible:ring-emerald-200/70"
      >
        <span>{selected.name}</span>
        <ChevronDown aria-hidden className={cn("size-5 shrink-0 stroke-[1.5] transition-transform duration-300", open && "rotate-180")} />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={12} align="start" className="z-50">
          <Popover.Popup
            className={cn(
              glassSurface,
              "w-[min(420px,92vw)] origin-top overflow-hidden rounded-[32px] bg-[#5a5a5a]/95 py-3 text-white outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            )}
          >
            {/* About three guests are shown; the others are a scroll away */}
            <ul aria-label="Guests" className="max-h-[250px] overflow-y-auto [scrollbar-color:rgb(255_255_255/0.35)_transparent] [scrollbar-width:thin]">
              {origins.map((originKey) => {
                const group = guests.filter((guest) => guest.originKey === originKey);
                return (
                  <li key={originKey}>
                    <p className="px-9 pt-3 pb-1 text-base text-white/55">
                      {group.map((guest) => guest.name).join(" · ")} ({group[0].originLabel})
                    </p>
                    <ul>
                      {group.map((guest) => (
                        <li key={guest.id}>
                          <Link
                            href={`?${new URLSearchParams({ dest: destinationId, guest: guest.id })}`}
                            onClick={() => setOpen(false)}
                            aria-current={guest.id === selectedId ? "true" : undefined}
                            className={cn(
                              "flex items-center gap-5 px-9 py-3 text-2xl outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/15",
                              guest.id === selectedId && "bg-white/[0.12]",
                            )}
                          >
                            <Check aria-hidden className={cn("size-6 shrink-0 stroke-2", guest.id === selectedId ? "opacity-100" : "opacity-0")} />
                            {guest.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
