import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PriceAccuracyPage } from "@/components/PriceAccuracyPage";
import { db } from "@/db/client";
import { getSettingsView } from "@/server/services/settings";
import { getPriceAccuracy } from "@/server/services/priceAccuracy";

/** How wrong the train price estimates are, on the prices seen on SNCF Connect. It reads the trip, the database and the model's files, so it streams in behind Suspense. */
async function PriceAccuracy({ params }: Pick<PageProps<"/trips/[tripId]/settings/price-accuracy">, "params">) {
  const { tripId } = await params;
  // Prices seen on SNCF Connect count for a day: this is read at request time, not prerendered (the clock is read below)
  await connection();
  // The prices belong to the person, not to a trip: the trip is only where the page is found, and a trip that does not exist is not
  if (!getSettingsView(db, tripId)) notFound();

  return (
    <main className="flex-1 px-[3%] py-10 lg:py-[5vh]">
      <PriceAccuracyPage view={getPriceAccuracy(db)} tripId={tripId} />
    </main>
  );
}

export default function PriceAccuracyRoute({ params }: PageProps<"/trips/[tripId]/settings/price-accuracy">) {
  return (
    <Suspense fallback={null}>
      <PriceAccuracy params={params} />
    </Suspense>
  );
}
