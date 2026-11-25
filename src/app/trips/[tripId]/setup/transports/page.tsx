import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProgressBar } from "@/components/ProgressBar";
import { TransportStep } from "@/components/TransportStep";
import { db } from "@/db/client";
import { getTrip } from "@/server/services/trips";

/** Loads the guests, their modes and the destinations. It reads the trip id and the database, so it streams in behind Suspense. */
async function Transports({ params }: { params: PageProps<"/trips/[tripId]/setup/transports">["params"] }) {
  const { tripId } = await params;
  const trip = getTrip(db, tripId);
  if (!trip) notFound();
  return (
    <TransportStep
      tripId={tripId}
      guests={trip.guests}
      destinations={trip.destinations}
      initialModes={trip.guestModes}
    />
  );
}

export default function TransportsStep({ params }: PageProps<"/trips/[tripId]/setup/transports">) {
  return (
    <main className="flex flex-1 flex-col px-[5%] pb-[8vh] pt-[16vh]">
      <h1 className="text-center text-4xl font-normal text-white sm:text-5xl">
        Which means of transportation ?
      </h1>

      <Suspense fallback={null}>
        <Transports params={params} />
      </Suspense>

      <div className="mt-auto pt-16">
        <ProgressBar value={0.75} from={0.5} />
      </div>
    </main>
  );
}
