"use client";

import { useCallback, useState } from "react";
import { overBudgetMessage, sendSelection } from "@/lib/selections";
import type { TransportCard, TransportColumn as Column } from "@/server/services/transports";
import { BudgetToast } from "./BudgetToast";
import { MoreSheet } from "./MoreSheet";
import { TransportColumn } from "./TransportColumn";

/**
 * The Transports page of one guest going to one destination (use-cases.md UC-B): a column per mode
 * with its two cards, and the guest's ❤ (one for the whole trip there, saved as it is made).
 * Keyed by destination and guest by its parent, so it starts over for each.
 */
export function TransportsPage({
  destinationId,
  guestId,
  origin,
  destination,
  columns,
}: {
  destinationId: string;
  guestId: string;
  origin: string;
  destination: string;
  columns: Column[];
}) {
  const everyCard = columns.flatMap((column) => [column.cheapest, column.practical, ...column.more]);
  const [heartedId, setHeartedId] = useState<string | null>(() => everyCard.find((card) => card?.hearted)?.id ?? null);
  // What the budget uses when the guest has not put a ❤: the pick the server made
  const defaultId = everyCard.find((card) => card?.inBudget && !card.hearted)?.id ?? null;
  const [moreMode, setMoreMode] = useState<Column["mode"] | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "warning" | "error" } | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const present = (card: TransportCard): TransportCard => ({
    ...card,
    hearted: card.id === heartedId,
    inBudget: card.id === (heartedId ?? defaultId),
  });

  async function toggleHeart(card: TransportCard) {
    const removing = heartedId === card.id;
    const before = heartedId;
    setHeartedId(removing ? null : card.id);
    try {
      const budget = await sendSelection(
        destinationId,
        removing ? "DELETE" : "PUT",
        removing ? { kind: "transport", guestId } : { kind: "transport", optionId: card.id, guestId },
      );
      setToast(budget.warnings.length > 0 ? { message: overBudgetMessage(budget.warnings), tone: "warning" } : null);
    } catch {
      setHeartedId(before);
      setToast({ message: "Couldn’t save your choice, please try again.", tone: "error" });
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-x-[88px] gap-y-12 lg:grid-cols-2">
        {columns.map((column) => (
          <TransportColumn
            key={column.mode}
            column={column}
            origin={origin}
            destination={destination}
            present={present}
            onHeart={toggleHeart}
            onMore={() => setMoreMode(column.mode)}
            // A lone column sits in the middle rather than against the left edge
            className={columns.length === 1 ? "lg:col-span-2 lg:w-[calc(50%-44px)] lg:justify-self-center" : undefined}
          />
        ))}
      </div>

      <MoreSheet
        column={columns.find((column) => column.mode === moreMode) ?? null}
        origin={origin}
        destination={destination}
        present={present}
        onHeart={toggleHeart}
        onClose={() => setMoreMode(null)}
      />
      {toast && <BudgetToast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </>
  );
}
