import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SettingsPage } from "@/components/SettingsPage";
import { db } from "@/db/client";
import { getSettingsView } from "@/server/services/settings";

/** Loads the trip's settings. It reads the trip id and the database, so it streams in behind Suspense. */
async function Settings({ params }: Pick<PageProps<"/trips/[tripId]/settings">, "params">) {
  const { tripId } = await params;
  // Prices seen on SNCF Connect count for a day: this is read at request time, not prerendered (the clock is read below)
  await connection();
  const view = getSettingsView(db, tripId);
  if (!view) notFound();

  return (
    <main className="flex-1 px-[3%] py-10 lg:py-[5vh]">
      <SettingsPage view={view} />
    </main>
  );
}

export default function SettingsRoute({ params }: PageProps<"/trips/[tripId]/settings">) {
  return (
    <Suspense fallback={null}>
      <Settings params={params} />
    </Suspense>
  );
}
