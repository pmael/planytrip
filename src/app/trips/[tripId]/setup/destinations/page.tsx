import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DestinationList } from "@/components/DestinationList";
import { ProgressBar } from "@/components/ProgressBar";
import { db } from "@/db/client";
import { getTrip } from "@/server/services/trips";

/** Loads the trip's destinations. It reads the trip id and the database, so it streams in behind Suspense. */
async function Destinations({ params }: { params: PageProps<"/trips/[tripId]/setup/destinations">["params"] }) {
  const { tripId } = await params;
  const trip = getTrip(db, tripId);
  if (!trip) notFound();
  return <DestinationList tripId={tripId} initialDestinations={trip.destinations} guests={trip.guests} />;
}

export default function DestinationsStep({ params }: PageProps<"/trips/[tripId]/setup/destinations">) {
  return (
    <main className="flex flex-1 flex-col px-[5%] pb-[8vh] pt-[16vh]">
      <h1 className="text-center text-4xl font-normal text-white sm:text-5xl">
        Which destinations you want ?
      </h1>

      <Suspense fallback={null}>
        <Destinations params={params} />
      </Suspense>

      <ProgressBar value={0.5} from={0.25} className="mt-auto" />
    </main>
  );
}
