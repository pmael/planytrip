import { BedDouble, Landmark, type LucideIcon, Mountain, PartyPopper, ShoppingCart, Waves } from "lucide-react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DashboardCard, SplitLabel, StatTile, Tile } from "@/components/DashboardCard";
import { DestinationSelect } from "@/components/DestinationSelect";
import { GuestVotes } from "@/components/GuestVotes";
import { NotReady } from "@/components/NotReady";
import { StayThumbnail } from "@/components/StayThumbnail";
import { TransportBadge } from "@/components/TransportBadge";
import { ValidateButton } from "@/components/ValidateButton";
import { colorOf } from "@/core/colors";
import type { Objective, TransportMode } from "@/core/types";
import { db } from "@/db/client";
import { COLOR_TEXT } from "@/lib/colorClasses";
import { EXTRA_WORDS } from "@/lib/extraText";
import { formatEur } from "@/lib/form";
import { tripPath } from "@/lib/trip";
import { MODE_LABELS } from "@/lib/reachabilityText";
import { getDashboard } from "@/server/services/dashboard";

const MODE_COLORS = ["bg-[#00cf6a]", "bg-[#e5333f]", "bg-[#3b82f6]", "bg-[#f59e0b]"];
const EXTRA_ICONS: Record<Objective, LucideIcon> = { none: ShoppingCart, partying: PartyPopper, chill: Waves, culture: Landmark, nature: Mountain };

/** The means of transportation the guests would take, as overlapping badges (the first in front): the airlines' logos for the flights. */
function TransportBadges({ carriers }: { carriers: { mode: TransportMode; label: string; airline: string | null }[] }) {
  const shown = carriers.slice(0, 4);
  // As wide as the tile allows, and overlapping by less than the edge around a logo: each can be read
  const size = `min(120px, ${(100 / (shown.length - 0.14 * (shown.length - 1))).toFixed(2)}%)`;
  return (
    <span className="mt-4 flex min-h-[150px] w-full items-center justify-center">
      {shown.map((carrier, index) => (
        <TransportBadge key={`${carrier.mode}-${carrier.label}`} {...carrier} size={size} colorClass={MODE_COLORS[index]} style={{ marginLeft: index === 0 ? 0 : `calc(-0.14 * ${size})`, zIndex: shown.length - index }} />
      ))}
    </span>
  );
}

/** Loads the dashboard for the chosen destination. It reads the URL and the database, so it streams in behind Suspense. */
async function Home({ params, searchParams }: Pick<PageProps<"/trips/[tripId]">, "params" | "searchParams">) {
  const { tripId } = await params;
  // Prices seen on SNCF Connect count for a day: this is read at request time, not prerendered (the clock is read below)
  await connection();
  const { dest } = await searchParams;
  const view = getDashboard(db, tripId, typeof dest === "string" ? dest : undefined);
  if (!view) notFound();
  if (view.kind === "not-ready") return <NotReady tripId={tripId} />;

  const selected = view.destinations.find((destination) => destination.id === view.selectedId)!;
  const totalColor = COLOR_TEXT[colorOf("budget", view.budget.tier)];
  const star = view.budget.includesFallback ? "*" : "";
  const ExtraIcon = EXTRA_ICONS[view.extra.objective];

  return (
    <main className="flex-1 px-[4%] py-10 lg:py-[5vh]">
      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-x-[4%] gap-y-12 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-wrap items-center gap-6 lg:col-span-3">
          <div className="min-w-[320px] flex-1">
            <DestinationSelect destinations={view.destinations} selectedId={view.selectedId} />
          </div>
          <ValidateButton
            key={view.selectedId}
            tripId={tripId}
            destinationId={view.selectedId}
            destinationName={selected.shortLabel}
            totalEur={view.budget.totalEur}
            perGuestEur={view.budget.perGuestEur}
            problems={view.guests.filter((guest) => guest.tier === "over").map((guest) => `${guest.name} is over budget or can't get there`)}
            validatedSummaryId={view.validated?.destinationId === view.selectedId ? view.validated.summaryId : null}
          />
        </div>

        <DashboardCard caption="Budget" glow="rgb(46 196 143 / 0.25)" delay={100} href={tripPath(tripId, "/budget")}>
          <StatTile label="Total" value={`${formatEur(view.budget.totalEur)}${star}`} valueClass={totalColor} />
          <StatTile label="per guest" value={formatEur(view.budget.perGuestEur)} valueClass={totalColor} />
        </DashboardCard>

        <DashboardCard caption="Housing" glow="rgb(120 160 255 / 0.3)" delay={180} href={`${tripPath(tripId, "/housing")}?dest=${view.selectedId}`}>
          <Tile className="flex flex-1 flex-col items-center gap-4 p-4">
            {view.housing ? (
              <StayThumbnail key={view.selectedId} stay={view.housing} className="w-full max-w-[250px]" />
            ) : (
              <span className="flex size-[214px] items-center justify-center rounded-[28px] bg-gradient-to-br from-[#e9dfcf] to-[#8aa39b] text-[#0d4a35]">
                <BedDouble aria-hidden className="size-24 stroke-[1.2]" />
              </span>
            )}
            <span className="line-clamp-2 text-center text-xl text-black" title={view.housing?.title}>
              {view.housing?.title ?? "No accommodation found"}
            </span>
          </Tile>
        </DashboardCard>

        <DashboardCard caption="Transports" glow="rgb(210 130 255 / 0.3)" delay={260} href={`${tripPath(tripId, "/transports")}?dest=${view.selectedId}`}>
          <Tile className="flex flex-1 flex-col items-center gap-4 p-4">
            <TransportBadges carriers={view.carriers} />
            <SplitLabel labels={view.transportModes.map((mode) => MODE_LABELS[mode])} />
          </Tile>
        </DashboardCard>

        <div className="lg:col-span-2 lg:row-start-3">
          <GuestVotes key={view.selectedId} guests={view.guests} destination={{ id: selected.id, name: selected.shortLabel }} />
        </div>

        <DashboardCard
          caption="Extra"
          glow="rgb(255 150 90 / 0.35)"
          delay={340}
          className="lg:col-start-3 lg:row-start-3 lg:-mt-[3vh] lg:self-start"
          href={`${tripPath(tripId, "/extra")}?dest=${view.selectedId}`}
        >
          <Tile className="flex flex-1 flex-col items-center gap-4 p-4">
            <span className="mt-4 flex size-[190px] items-center justify-center rounded-full bg-[#eef1ee] text-[#17803d]">
              <ExtraIcon aria-hidden className="size-24 stroke-[1.3]" />
            </span>
            <SplitLabel labels={[...EXTRA_WORDS[view.extra.objective]]} />
            {view.extra.totalEur !== null && <span className="text-lg text-black/60">{formatEur(view.extra.totalEur)} for the group</span>}
          </Tile>
        </DashboardCard>
      </div>
    </main>
  );
}

export default function DashboardHome({ params, searchParams }: PageProps<"/trips/[tripId]">) {
  return (
    <Suspense fallback={null}>
      <Home params={params} searchParams={searchParams} />
    </Suspense>
  );
}
