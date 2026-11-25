import { Heart } from "lucide-react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DestinationSelect } from "@/components/DestinationSelect";
import { ExtraAdvicePanel } from "@/components/ExtraAdvicePanel";
import { ExtraLines, ExtraStandingList } from "@/components/ExtraBreakdown";
import { ExtraGuestView } from "@/components/ExtraGuestView";
import { glassSurface } from "@/components/GlassCard";
import { NotReady } from "@/components/NotReady";
import { PageTitle } from "@/components/PageTitle";
import { db } from "@/db/client";
import { BUDGET_LEVEL_LABELS, OBJECTIVE_LABELS } from "@/lib/deliberationText";
import { cn } from "@/lib/utils";
import { getExtraView } from "@/server/services/extraView";

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

const PRICES_WORDS = { ai: "Local prices estimated by the AI", rules: "Local prices from the country's price level: not estimated by the AI", "eu-average": "EU average prices" } as const;

/** Loads the Extra of the chosen destination, for everyone or one guest. It reads the URL and the database, so it streams in behind Suspense. */
async function Extra({ params, searchParams }: Pick<PageProps<"/trips/[tripId]/extra">, "params" | "searchParams">) {
  const { tripId } = await params;
  // Prices seen on SNCF Connect count for a day: this is read at request time, not prerendered
  await connection();
  const { dest, guest } = await searchParams;
  const view = getExtraView(db, tripId, { destinationId: single(dest), guestId: single(guest) });
  if (!view) notFound();
  if (view.kind === "not-ready") return <NotReady tripId={tripId} />;

  const { destination, extra } = view;
  const viewer = view.guests.find((g) => g.id === view.guestId) ?? null;
  return (
    <main className="flex-1 px-[3%] py-10 lg:py-[5vh]">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-10">
        <PageTitle action={<DestinationSelect variant="compact" destinations={view.destinations} selectedId={view.selectedId} keep={view.guestId ? { guest: view.guestId } : undefined} />}>
          Extra
        </PageTitle>

        <section aria-label="What the Extra is worked out for" className={cn(glassSurface, "flex flex-col gap-6 rounded-[36px] px-8 py-7 text-white")}>
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            <p className="text-2xl">
              {destination.shortLabel}
              <span className="text-white/70">
                {" "}
                · {OBJECTIVE_LABELS[destination.objective]} · {BUDGET_LEVEL_LABELS[destination.budgetLevel]}
                {destination.nights !== null && ` · ${destination.nights} ${destination.nights === 1 ? "night" : "nights"}`}
              </span>
            </p>
            <ExtraGuestView guests={view.guests} selectedId={view.guestId} destinationId={view.selectedId} />
          </div>
          {extra && (
            <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 text-lg text-white/80">
              <p className="flex items-center gap-2">
                {extra.stay.chosen && <Heart aria-label="The group's ❤" className="size-5 fill-rose-300 text-rose-300" />}
                Worked out for the stay &ldquo;{extra.stay.title}&rdquo;{extra.stay.chosen ? "" : ", the default pick until the group puts its ❤ on one"}
              </p>
              <p>
                {extra.estimate && "≈ estimates · "}
                {PRICES_WORDS[extra.pricesSource]}
              </p>
            </div>
          )}
          {extra && !extra.counted && (
            <p role="status" className="rounded-[18px] bg-amber-300/15 px-5 py-3 text-lg text-amber-50">
              Not counted in the budget yet: this destination&rsquo;s local prices are not known, so these figures use EU average prices. Computing the trip again finds them.
            </p>
          )}
        </section>

        {extra ? (
          <>
            <ExtraLines view={view} />
            <ExtraStandingList view={view} />
            <ExtraAdvicePanel key={`${view.selectedId}:${view.guestId ?? "all"}`} destinationId={view.selectedId} advice={view.advice} pending={view.advicePending} viewer={viewer} />
          </>
        ) : (
          <p className="rounded-[22px] bg-white p-7 text-xl text-[#0d4a35]">No place to stay was found here, so there is nothing to work the Extra out for.</p>
        )}
      </div>
    </main>
  );
}

export default function ExtraRoute({ params, searchParams }: PageProps<"/trips/[tripId]/extra">) {
  return (
    <Suspense fallback={null}>
      <Extra params={params} searchParams={searchParams} />
    </Suspense>
  );
}
