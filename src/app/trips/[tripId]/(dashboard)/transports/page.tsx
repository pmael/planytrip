import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DestinationSelect } from "@/components/DestinationSelect";
import { GuestSelect } from "@/components/GuestSelect";
import { NotReady } from "@/components/NotReady";
import { PageTitle } from "@/components/PageTitle";
import { TransportsPage } from "@/components/TransportsPage";
import { db } from "@/db/client";
import { getTransportView } from "@/server/services/transports";

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

/** Loads how the chosen guest gets to the chosen destination. It reads the URL and the database, so it streams in behind Suspense. */
async function Transports({ params, searchParams }: Pick<PageProps<"/trips/[tripId]/transports">, "params" | "searchParams">) {
  const { tripId } = await params;
  // Prices seen on SNCF Connect count for a day: this is read at request time, not prerendered (the clock is read below)
  await connection();
  const { dest, guest } = await searchParams;
  const view = getTransportView(db, tripId, { destinationId: single(dest), guestId: single(guest) });
  if (!view) notFound();
  if (view.kind === "not-ready") return <NotReady tripId={tripId} />;

  const origin = view.guests.find((g) => g.id === view.guestId)!.originLabel;
  return (
    <main className="flex-1 px-[3%] py-10 lg:py-[5vh]">
      <div className="mx-auto flex max-w-[1580px] flex-col gap-12">
        <div className="lg:w-[82%]">
          <PageTitle
            lead={<GuestSelect guests={view.guests} selectedId={view.guestId} destinationId={view.selectedId} />}
            action={<DestinationSelect variant="compact" destinations={view.destinations} selectedId={view.selectedId} keep={{ guest: view.guestId }} />}
          >
            Transports
          </PageTitle>
        </div>
        {/* Keyed by destination and guest: the ❤ and the open sheet start over when either changes */}
        <TransportsPage
          key={`${view.selectedId}:${view.guestId}`}
          destinationId={view.selectedId}
          guestId={view.guestId}
          origin={origin}
          destination={view.destinationLabel}
          columns={view.columns}
        />
      </div>
    </main>
  );
}

export default function TransportsRoute({ params, searchParams }: PageProps<"/trips/[tripId]/transports">) {
  return (
    <Suspense fallback={null}>
      <Transports params={params} searchParams={searchParams} />
    </Suspense>
  );
}
