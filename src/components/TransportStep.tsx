"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReachabilityMatrix } from "@/core/reachability";
import type { Destination, Guest, GuestModes, TransportMode } from "@/core/types";
import { ModeMatrix } from "./ModeMatrix";
import { NextLink } from "./NextLink";
import { ReachabilityPreview } from "./ReachabilityPreview";

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * Step 3: which means of transportation each guest accepts, and who can get where with them.
 * Changes are saved as they are made; the preview updates with the answer.
 */
export function TransportStep({
  tripId,
  guests,
  destinations,
  initialModes,
}: {
  tripId: string;
  guests: Guest[];
  destinations: Destination[];
  initialModes: GuestModes;
}) {
  const [modes, setModes] = useState<GuestModes>(initialModes);
  const [matrix, setMatrix] = useState<ReachabilityMatrix | null>(null);
  const [checking, setChecking] = useState(destinations.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(guests[0]?.id ?? "");
  const latest = useRef(0);

  // Work out who can get where as the step opens
  useEffect(() => {
    if (destinations.length === 0) return;
    const sequence = ++latest.current;
    fetch(`/api/trips/${tripId}/reachability`, { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error(`Reachability answered ${response.status}`);
        return response.json() as Promise<ReachabilityMatrix>;
      })
      .then((result) => {
        if (sequence === latest.current) setMatrix(result);
      })
      .catch(() => {
        if (sequence === latest.current) setError("Couldn't check the routes, please reload the page.");
      })
      .finally(() => {
        if (sequence === latest.current) setChecking(false);
      });
  }, [tripId, destinations.length]);

  async function saveModes(guest: Guest, next: TransportMode[]) {
    const sequence = ++latest.current;
    const previous = modes[guest.id];
    setModes((current) => ({ ...current, [guest.id]: next }));
    setChecking(true);
    setError(null);
    try {
      const response = await fetch(`/api/guests/${guest.id}/modes`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ modes: next }),
      });
      if (!response.ok) throw new Error(`Modes answered ${response.status}`);
      const saved: { modes: TransportMode[]; matrix: ReachabilityMatrix } = await response.json();
      // A newer change has been made since: its answer is the one that counts
      if (sequence !== latest.current) return;
      setModes((current) => ({ ...current, [guest.id]: saved.modes }));
      setMatrix(saved.matrix);
    } catch {
      if (sequence !== latest.current) return;
      setModes((current) => ({ ...current, [guest.id]: previous }));
      setError("Couldn't save that change, please try again.");
    } finally {
      if (sequence === latest.current) setChecking(false);
    }
  }

  const toggle = (guest: Guest, mode: TransportMode) => {
    const accepted = modes[guest.id] ?? [guest.preferredMode];
    void saveModes(guest, accepted.includes(mode) ? accepted.filter((m) => m !== mode) : [...accepted, mode]);
  };

  const accept = (guest: Guest, mode: TransportMode) => {
    const accepted = modes[guest.id] ?? [guest.preferredMode];
    if (!accepted.includes(mode)) void saveModes(guest, [...accepted, mode]);
  };

  if (guests.length === 0) {
    return (
      <div className="mx-auto mt-24 flex flex-col items-center gap-8 text-center text-white">
        <p className="text-2xl text-white/75">Add the people you’re travelling with first.</p>
        <Link href="guests" className="rounded-full border border-white/25 bg-white/15 px-10 py-4 text-lg transition-colors hover:bg-white/25">
          Back to the guests
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-14 flex w-full max-w-[1700px] flex-col items-center gap-14">
      <ModeMatrix guests={guests} guestModes={modes} selectedId={selectedId} onSelect={setSelectedId} onToggle={toggle} />

      {destinations.length > 0 ? (
        <ReachabilityPreview guests={guests} destinations={destinations} matrix={matrix} checking={checking} onAccept={accept} />
      ) : (
        <p className="text-xl text-white/65">
          Add destinations to see who can get there.{" "}
          <Link href="destinations" className="underline underline-offset-4">
            Back to the destinations
          </Link>
        </p>
      )}

      {error && (
        <p role="alert" className="animate-[fade-up_0.3s_ease-out_both] text-lg text-rose-200">
          {error}
        </p>
      )}

      <NextLink href="computing" />
    </div>
  );
}
