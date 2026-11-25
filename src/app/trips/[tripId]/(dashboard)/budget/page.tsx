import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BudgetPanel } from "@/components/BudgetPanel";
import { RecommendationBanner } from "@/components/RecommendationBanner";
import { NotReady } from "@/components/NotReady";
import { PageTitle } from "@/components/PageTitle";
import { db } from "@/db/client";
import { BUDGET_SHOWS } from "@/server/schemas";
import { getBudgetView } from "@/server/services/dashboard";

/** Loads the destinations side by side. It reads the URL and the database, so it streams in behind Suspense. */
async function Budget({ params, searchParams }: Pick<PageProps<"/trips/[tripId]/budget">, "params" | "searchParams">) {
  const { tripId } = await params;
  // Prices seen on SNCF Connect count for a day: this is read at request time, not prerendered (the clock is read below)
  await connection();
  const { show, guest } = await searchParams;
  // A chip that does not exist is ignored rather than refused: the URL is the user's to edit
  const chips = (typeof show === "string" ? show.split(",") : []).filter((chip): chip is (typeof BUDGET_SHOWS)[number] =>
    (BUDGET_SHOWS as readonly string[]).includes(chip),
  );
  const view = getBudgetView(db, tripId, { show: [...new Set(chips)], guestId: typeof guest === "string" ? guest : undefined });
  if (!view) notFound();
  if (view.kind === "not-ready") return <NotReady tripId={tripId} />;

  return (
    <main className="flex-1 px-[3%] py-10 lg:py-[5vh]">
      <div className="mx-auto flex max-w-[1580px] flex-col gap-12">
        <div className="lg:w-[82%]">
          <PageTitle>Budget</PageTitle>
        </div>
        <RecommendationBanner recommendation={view.recommendation} guestCount={view.guests.length} />
        <BudgetPanel tripId={tripId} cards={view.cards} initialShow={view.show} guests={view.guests} initialGuestId={view.guestId} />
      </div>
    </main>
  );
}

export default function BudgetPage({ params, searchParams }: PageProps<"/trips/[tripId]/budget">) {
  return (
    <Suspense fallback={null}>
      <Budget params={params} searchParams={searchParams} />
    </Suspense>
  );
}
