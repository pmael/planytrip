"use client";

import { useRouter } from "next/navigation";
import { GuestViewSelect } from "./GuestViewSelect";

/**
 * Whose Extra the page shows: everyone, or one guest's own lines (their transfer depends on when they arrive and how).
 * Kept in the address (`?guest=`) with the destination, so the page can be shared and reloaded as it is.
 */
export function ExtraGuestView({ guests, selectedId, destinationId }: { guests: { id: string; name: string }[]; selectedId: string | null; destinationId: string }) {
  const router = useRouter();
  return (
    <GuestViewSelect
      guests={guests}
      selectedId={selectedId}
      onChange={(guestId) => router.replace(`?${new URLSearchParams({ dest: destinationId, ...(guestId ? { guest: guestId } : {}) })}`, { scroll: false })}
    />
  );
}
