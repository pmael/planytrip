import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DestinationSelect } from "@/components/DestinationSelect";
import { HousingPage } from "@/components/HousingPage";
import { NotReady } from "@/components/NotReady";
import { PageTitle } from "@/components/PageTitle";
import { db } from "@/db/client";
import { getHousingView } from "@/server/services/stays";

/** Loads the offers of the chosen destination. It reads the URL and the database, so it streams in behind Suspense. */
async function Housing({ params, searchParams }: Pick<PageProps<"/trips/[tripId]/housing">, "params" | "searchParams">) {
  const { tripId } = await params;
  // Prices seen on SNCF Connect count for a day: this is read at request time, not prerendered (the clock is read below)
  await connection();
  const { dest } = await searchParams;
  const view = getHousingView(db, tripId, typeof dest === "string" ? dest : undefined);
  if (!view) notFound();
  if (view.kind === "not-ready") return <NotReady tripId={tripId} />;

  return (
    <main className="flex-1 px-[3%] py-10 lg:py-[5vh]">
      <div className="mx-auto flex max-w-[1580px] flex-col gap-12">
        <div className="lg:w-[82%]">
          <PageTitle action={<DestinationSelect variant="compact" destinations={view.destinations} selectedId={view.selectedId} />}>
            Housing
          </PageTitle>
        </div>
        {/* Keyed by destination: hearts, comparison and advice start over when the destination changes */}
        <HousingPage key={view.selectedId} destinationId={view.selectedId} columns={view.columns} defaultStayId={view.defaultStayId} />
      </div>
    </main>
  );
}

export default function HousingRoute({ params, searchParams }: PageProps<"/trips/[tripId]/housing">) {
  return (
    <Suspense fallback={null}>
      <Housing params={params} searchParams={searchParams} />
    </Suspense>
  );
}
