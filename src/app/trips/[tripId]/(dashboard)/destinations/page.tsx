import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { factsOf, inputHashOf } from "@/ai/destination-synthesis";
import { DestinationsPage } from "@/components/DestinationsPage";
import { NotReady } from "@/components/NotReady";
import { db } from "@/db/client";
import { buildTripMap } from "@/lib/tripMap";
import { getDeliberationView } from "@/server/services/deliberation";

const flag = (value: string | string[] | undefined) => value === "1";

/** Loads every destination compared. It reads the URL and the database, so it streams in behind Suspense. */
async function Destinations({ params, searchParams }: Pick<PageProps<"/trips/[tripId]/destinations">, "params" | "searchParams">) {
  const { tripId } = await params;
  // Prices seen on SNCF Connect count for a day: this is read at request time, not prerendered (the clock is read below)
  await connection();
  const { ai, map } = await searchParams;
  const view = getDeliberationView(db, tripId);
  if (!view) notFound();
  if (view.kind === "not-ready") return <NotReady tripId={tripId} />;

  const geometry = buildTripMap(
    view.guests.map((guest) => ({ id: guest.id, name: guest.name, originKey: guest.originKey, city: guest.city, lat: guest.lat, lon: guest.lon })),
    view.destinations.map((destination) => ({ id: destination.id, label: destination.shortLabel, lat: destination.lat, lon: destination.lon })),
  );

  return (
    <main className="flex-1 px-[3%] py-10 lg:py-[5vh]">
      <DestinationsPage tripId={tripId} view={view} map={geometry} factsHash={inputHashOf(factsOf(view))} initial={{ ai: flag(ai), map: flag(map) }} />
    </main>
  );
}

export default function DestinationsRoute({ params, searchParams }: PageProps<"/trips/[tripId]/destinations">) {
  return (
    <Suspense fallback={null}>
      <Destinations params={params} searchParams={searchParams} />
    </Suspense>
  );
}
