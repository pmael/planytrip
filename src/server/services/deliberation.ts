// The Destinations page: every destination side by side, and for each guest where they stand at
// each of them, so the group can settle on one (use-cases.md UC-C: C-S3 to C-S6).
import { colorOf } from "@/core/colors";
import { commonWindow, limitingGuests, nightsBetween, tripWindow } from "@/core/dates";
import { bestFitFor, budgetRatioOf, standingOf, type Standing } from "@/core/preferences";
import type { Blocker } from "@/core/recommend";
import { recommendedDestination } from "@/core/recommend";
import { trends } from "@/core/trends";
import type {
  BudgetLevel,
  BudgetTier,
  Color,
  Objective,
  RatingSource,
  StayProvider,
  StayVerdict,
  TransportMode,
  Trend,
  TripStatus,
} from "@/core/types";
import type { Db } from "@/db/types";
import type { NotReady } from "./dashboard";
import { loadTripScenarios } from "./scenarios";
import { validatedDestinationOf } from "./summaries";

/** One guest at one destination: what the trip would cost them and how they stand on it. */
export type GuestCell = {
  guestId: string;
  destinationId: string;
  /** unreachable: none of their accepted modes gets there */
  status: "ok" | "unreachable";
  tier: BudgetTier;
  /** Transport, their share of the accommodation and their Extra (task.md T8.9). Null when there is no transport at all */
  costEur: number | null;
  overBudgetEur: number | null;
  /** Share of their budget the trip takes: 0.92 is 92 % */
  budgetRatio: number | null;
  transport: {
    mode: TransportMode;
    costEur: number;
    durationMin: number | null;
    comfort: Color;
    /** No accepted mode gets there: this is the cheapest other one, an assumption */
    assumed: boolean;
  } | null;
  housingShareEur: number;
  /** Their Extra (use-cases.md R10): the Mandatory and the Plus. Null until the destination's local prices are known */
  mandatoryEur: number | null;
  plusEur: number | null;
  /** The guest's ★ is on this destination */
  starred: boolean;
  /** Where the guest's numbers say they are best off */
  bestFit: boolean;
};

export type Dossier = {
  id: string;
  label: string;
  shortLabel: string;
  countryCode: string;
  lat: number;
  lon: number;
  airports: string[];
  inScope: boolean;
  budgetLevel: BudgetLevel;
  objective: Objective;
  /** The days the group would go, null when no dates work for everyone */
  window: { from: string; to: string; nights: number; limitedBy: string[] } | null;
  /** 1 is the best (R7) */
  rank: number;
  /** Everyone can get there and nobody is in the red */
  eligible: boolean;
  recommended: boolean;
  tier: BudgetTier;
  totalEur: number;
  perGuestEur: number;
  trend: Trend;
  /** A guest is counted with another mode, so the total rests on an assumption */
  includesFallback: boolean;
  /** False when a guest has no transport at all, so the total leaves them out */
  complete: boolean;
  standing: Standing;
  /** Mean comfort score (0-100) of the guests' trips */
  averageComfort: number | null;
  votes: { count: number; guestIds: string[] };
  blockers: Blocker[];
  housing: {
    title: string;
    provider: StayProvider;
    totalEur: number;
    perGuestEur: number;
    chosen: boolean;
    verdict: StayVerdict | null;
    fitScore: number | null;
    /** Who gave that score: the AI, or the rules when it was not available */
    ratedBy: RatingSource | null;
  } | null;
  modes: TransportMode[];
  /** In the order of the guests */
  cells: GuestCell[];
};

export type DeliberationGuest = {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  /** The full label of where they live, e.g. "Madrid, Spain" */
  homeLabel: string;
  originKey: string;
  maxBudgetEur: number;
  availableFrom: string;
  availableTo: string;
  modes: TransportMode[];
  preferredMode: TransportMode;
  /** Where their ★ is */
  favoriteId: string | null;
  /** Where their numbers say they are best off */
  bestFitId: string | null;
};

export type DeliberationView =
  | NotReady
  | {
      kind: "ready";
      tripId: string;
      status: TripStatus;
      guests: DeliberationGuest[];
      /** Best first */
      destinations: Dossier[];
      /** The destination that works for everyone, null when none does */
      recommendedId: string | null;
      /** The best of them even when none works for everyone: the one to unblock first */
      closestId: string;
      /** The destination the group validated, and its summary; null while nothing is decided */
      validated: { summaryId: string; destinationId: string } | null;
    };

/** A trip that has been worked out: what the page shows. */
export type ReadyDeliberation = Extract<DeliberationView, { kind: "ready" }>;

const cityOf = (label: string) => label.split(",")[0];

/** Every destination of a trip compared, best first. Null when the trip does not exist. */
export function getDeliberationView(db: Db, tripId: string): DeliberationView | null {
  const loaded = loadTripScenarios(db, tripId);
  if (!loaded) return null;
  const { trip, scenarios, analyses, ranked } = loaded;
  if (!(trip.status === "ready" || trip.status === "validated") || scenarios.length === 0 || trip.guests.length === 0) {
    return { kind: "not-ready", tripId, status: trip.status };
  }

  const recommendedId = recommendedDestination(ranked)?.destinationId ?? null;
  const marks = trends(Object.fromEntries(scenarios.map((scenario) => [scenario.destinationId, scenario.totalEur])));
  const bestFit = new Map(trip.guests.map((guest) => [guest.id, bestFitFor(scenarios, guest.id)]));

  const destinations = ranked.map((entry): Dossier => {
    const destination = trip.destinations.find((d) => d.id === entry.destinationId)!;
    const scenario = scenarios.find((s) => s.destinationId === entry.destinationId)!;
    const rawWindow = commonWindow(trip.guests, destination);
    const window = rawWindow && tripWindow(rawWindow, trip.nights);
    const stay = scenario.stay;
    const analysis = stay ? analyses.get(stay.id) : undefined;
    const voters = trip.guests.filter((guest) => guest.favoriteDestinationId === destination.id);

    return {
      id: destination.id,
      label: destination.label,
      shortLabel: cityOf(destination.label),
      countryCode: destination.countryCode,
      lat: destination.lat,
      lon: destination.lon,
      airports: destination.airports,
      inScope: destination.inScope,
      budgetLevel: destination.budgetLevel,
      objective: destination.objective,
      window: window
        ? {
            from: window.from,
            to: window.to,
            nights: nightsBetween(window),
            limitedBy: limitingGuests(trip.guests, window).map((guest) => guest.name),
          }
        : null,
      rank: entry.rank,
      eligible: entry.eligible,
      recommended: destination.id === recommendedId,
      tier: scenario.tier,
      totalEur: scenario.totalEur,
      perGuestEur: scenario.averagePerGuestEur,
      trend: marks[destination.id],
      includesFallback: scenario.totalIncludesFallback,
      complete: scenario.totalComplete,
      standing: standingOf(scenario),
      averageComfort: entry.averageComfortScore,
      votes: { count: voters.length, guestIds: voters.map((guest) => guest.id) },
      blockers: entry.blockers,
      housing: stay
        ? {
            title: stay.title,
            provider: stay.provider,
            totalEur: scenario.housingTotalEur,
            perGuestEur: scenario.housingShareEur,
            chosen: scenario.staySource === "selected",
            verdict: analysis?.verdict ?? null,
            fitScore: analysis?.fitScore ?? null,
            ratedBy: analysis?.ratedBy ?? null,
          }
        : null,
      modes: [...new Set(scenario.guests.flatMap((guest) => (guest.transport ? [guest.transport.option.mode] : [])))],
      cells: scenario.guests.map((guest): GuestCell => {
        const transport = guest.transport;
        return {
          guestId: guest.guestId,
          destinationId: destination.id,
          status: guest.status,
          tier: guest.tier,
          costEur: guest.costEur,
          overBudgetEur: guest.overBudgetEur,
          budgetRatio: budgetRatioOf(guest),
          transport: transport
            ? {
                mode: transport.option.mode,
                costEur: transport.costEur,
                durationMin: transport.option.outDurationMin,
                comfort: colorOf("comfort", transport.comfort.level),
                assumed: transport.source === "fallback",
              }
            : null,
          housingShareEur: guest.housingShareEur,
          mandatoryEur: guest.mandatoryEur,
          plusEur: guest.plusEur,
          starred: trip.guests.find((g) => g.id === guest.guestId)?.favoriteDestinationId === destination.id,
          bestFit: bestFit.get(guest.guestId) === destination.id,
        };
      }),
    };
  });

  return {
    kind: "ready",
    tripId,
    status: trip.status,
    guests: trip.guests.map((guest) => ({
      id: guest.id,
      name: guest.name,
      city: cityOf(guest.homeLabel),
      lat: guest.homeLat,
      lon: guest.homeLon,
      homeLabel: guest.homeLabel,
      originKey: guest.originKey,
      maxBudgetEur: guest.maxBudgetEur,
      availableFrom: guest.availableFrom,
      availableTo: guest.availableTo,
      modes: trip.guestModes[guest.id] ?? [guest.preferredMode],
      preferredMode: guest.preferredMode,
      favoriteId: guest.favoriteDestinationId,
      bestFitId: bestFit.get(guest.id) ?? null,
    })),
    destinations,
    recommendedId,
    closestId: recommendedId ?? ranked[0].destinationId,
    validated: validatedDestinationOf(db, tripId),
  };
}
