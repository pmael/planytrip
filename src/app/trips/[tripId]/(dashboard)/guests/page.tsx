import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { GuestsPage } from "@/components/GuestsPage";
import { NotReady } from "@/components/NotReady";
import { db } from "@/db/client";
import { getDeliberationView } from "@/server/services/deliberation";

/** Loads the guests with where each stands. It reads the trip id and the database, so it streams in behind Suspense. */
async function Guests({ params }: Pick<PageProps<"/trips/[tripId]/guests">, "params">) {
  const { tripId } = await params;
  // Prices seen on SNCF Connect count for a day: this is read at request time, not prerendered (the clock is read below)
  await connection();
  const view = getDeliberationView(db, tripId);
  if (!view) notFound();
  if (view.kind === "not-ready") return <NotReady tripId={tripId} />;

  return (
    <main className="flex-1 px-[3%] py-10 lg:py-[5vh]">
      <GuestsPage tripId={tripId} view={view} />
    </main>
  );
}

export default function GuestsRoute({ params }: PageProps<"/trips/[tripId]/guests">) {
  return (
    <Suspense fallback={null}>
      <Guests params={params} />
    </Suspense>
  );
}
