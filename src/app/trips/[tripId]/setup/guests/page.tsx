import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GuestList } from "@/components/GuestList";
import { ProgressBar } from "@/components/ProgressBar";
import { db } from "@/db/client";
import { getTrip } from "@/server/services/trips";

/** Loads the trip's guests. It reads the trip id and the database, so it streams in behind Suspense. */
async function Guests({ params }: { params: PageProps<"/trips/[tripId]/setup/guests">["params"] }) {
  const { tripId } = await params;
  const trip = getTrip(db, tripId);
  if (!trip) notFound();
  return <GuestList tripId={tripId} initialGuests={trip.guests} />;
}

export default function GuestsStep({ params }: PageProps<"/trips/[tripId]/setup/guests">) {
  return (
    <main className="flex flex-1 flex-col px-[5%] pb-[8vh] pt-[16vh]">
      <h1 className="text-center text-4xl font-normal text-white sm:text-5xl">
        People you’re travelling with
      </h1>

      <Suspense fallback={null}>
        <Guests params={params} />
      </Suspense>

      <ProgressBar value={0.25} className="mt-auto" />
    </main>
  );
}
