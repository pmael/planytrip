"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { MODE_LABELS } from "@/lib/reachabilityText";
import { cn } from "@/lib/utils";
import type { TransportCard as Card, TransportColumn as Column } from "@/server/services/transports";
import { glassSurface } from "./GlassCard";
import { TransportCard } from "./TransportCard";

/**
 * The rest of a mode's options (use-cases.md B-S1): the uncomfortable ones come after the others and the
 * ones rated "not recommended" last of all, each saying why. A ❤ can be put on any of them, like on the
 * two cards of the column.
 */
export function MoreSheet({
  column,
  origin,
  destination,
  present,
  onHeart,
  onClose,
}: {
  column: Column | null;
  origin: string;
  destination: string;
  present: (card: Card) => Card;
  onHeart: (card: Card) => void;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={column !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/25 backdrop-blur-md transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            glassSurface,
            "fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[40px] bg-[#606060]/95 p-8 text-white outline-none transition-[opacity,scale] duration-200 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-3xl font-normal">More by {column ? MODE_LABELS[column.mode].toLowerCase() : ""}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/15 outline-none transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-emerald-300/60">
              <X aria-hidden className="size-6" />
            </Dialog.Close>
          </div>
          <ul className="mt-6 flex flex-col gap-5 overflow-y-auto pr-1">
            {column?.more.map((option) => (
              <li key={option.id}>
                <TransportCard card={present(option)} origin={origin} destination={destination} onHeart={onHeart} />
              </li>
            ))}
          </ul>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
