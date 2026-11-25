import { eq, inArray } from "drizzle-orm";
import { countVotes, rankDestinations, type RankedDestination } from "@/core/recommend";
import { buildScenario, type Scenario, type ScenarioInput } from "@/core/scenario";
import type { OptionRating, RouteCheck, Selection, StayAnalysis, StayJudgement, StayOption, TransportOption, TripDetails } from "@/core/types";
import { toRouteCheck, toSelection, toStayAnalysis, toStayOption, toTransportOption } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { extraPlan } from "@/core/extras";
import { extraInputOf } from "./extras";
import { withObservedPrices } from "./observedPrices";
import { ratingsOfTrip } from "./ratings";
import { getTrip } from "./trips";

export type TripScenarios = {
  trip: TripDetails;
  /** What each destination costs, in the order the destinations were added */
  scenarios: Scenario[];
  /** Every transport option found for the trip's destinations, as stored (comfort is filled in by `rateOptions`) */
  options: TransportOption[];
  /** What the route checks found out about the trip's destinations */
  checks: RouteCheck[];
  /** Every accommodation found for the trip's destinations */
  stays: StayOption[];
  /** The stays' AI analyses, by stay id */
  analyses: Map<string, StayAnalysis>;
  /** The group's ❤ choices */
  selections: Selection[];
  /** Best first (use-cases.md R7); the first eligible one is the recommendation */
  ranked: RankedDestination[];
};

/**
 * What is known about a stay, as one analysis: its verdict and score are the rating made while the trip
 * was set up when there is one (so that asking "Why this?" never changes what is shown first), the
 * text is the AI's explanation when it has been asked for, or else the rating's own reason.
 */
export function mergeJudgement(stayId: string, rating: OptionRating | null, explanation: StayAnalysis | null): StayAnalysis | null {
  if (!rating) return explanation && { ...explanation, explained: true };
  return {
    id: explanation?.id ?? stayId,
    stayId,
    verdict: rating.verdict,
    fitScore: rating.score,
    pros: explanation?.pros ?? [],
    cons: explanation?.cons ?? [],
    summary: explanation?.summary ?? rating.reason,
    inputHash: explanation?.inputHash ?? "",
    createdAt: explanation?.createdAt ?? new Date(0).toISOString(),
    ratedBy: rating.source,
    ratingReason: rating.reason,
    explained: explanation !== null,
  };
}

/** What a card shows of a stay's analysis: nothing when there is none. */
export function judgementOf(analysis: StayAnalysis | undefined): StayJudgement | null {
  if (!analysis) return null;
  const { verdict, fitScore, summary, pros, cons } = analysis;
  return { verdict, fitScore, summary, pros, cons, ratedBy: analysis.ratedBy ?? null, explained: analysis.explained ?? true };
}

/**
 * Works out what every destination of a trip would cost each guest, from what the computation
 * stored, the ❤ choices and the ★ votes. Nothing here is stored: it is recomputed on every read
 * (database.md), so a heart or a vote shows at once. Null when the trip does not exist.
 */
export function loadTripScenarios(db: Db, tripId: string): TripScenarios | null {
  const trip = getTrip(db, tripId);
  if (!trip) return null;

  const destinationIds = trip.destinations.map((destination) => destination.id);
  if (destinationIds.length === 0) return { trip, scenarios: [], options: [], checks: [], stays: [], analyses: new Map(), selections: [], ranked: [] };

  // What the AI (or the rules) rated while the trip was set up: the dashboard only reads it
  const ratings = ratingsOfTrip(db, tripId);
  // A train the person saw on SNCF Connect in the last day is priced as they saw it (task.md T7.9)
  const options = withObservedPrices(
    db,
    db
      .select()
      .from(schema.transportOptions)
      .where(inArray(schema.transportOptions.destinationId, destinationIds))
      .all()
      .map(toTransportOption),
  ).map((option) => ({ ...option, rating: ratings.transport.get(option.id) ?? null }));
  const stays = db.select().from(schema.stayOptions).where(inArray(schema.stayOptions.destinationId, destinationIds)).all().map(toStayOption);
  const checks = db.select().from(schema.routeChecks).where(inArray(schema.routeChecks.destinationId, destinationIds)).all().map(toRouteCheck);
  const selections = db.select().from(schema.selections).where(eq(schema.selections.tripId, tripId)).all().map(toSelection);
  const explanations = new Map(
    stays.length === 0
      ? []
      : db
          .select()
          .from(schema.stayAnalyses)
          .where(inArray(schema.stayAnalyses.stayId, stays.map((stay) => stay.id)))
          .all()
          .map((row) => [row.stayId, toStayAnalysis(row)] as const),
  );
  const analyses = new Map<string, StayAnalysis>(
    stays.flatMap((stay): [string, StayAnalysis][] => {
      const merged = mergeJudgement(stay.id, ratings.stays.get(stay.id) ?? null, explanations.get(stay.id) ?? null);
      return merged ? [[stay.id, merged]] : [];
    }),
  );

  const scenarios = trip.destinations.map((destination) =>
    scenarioWithExtra(db, { destination, guests: trip.guests, guestModes: trip.guestModes, options, stays, analyses, selections, checks }),
  );
  return { trip, scenarios, options, checks, stays, analyses, selections, ranked: rankDestinations(scenarios, countVotes(trip.guests)) };
}

/**
 * What a destination would cost each guest with the group's ❤ on another of its stays: the Housing page's "what each
 * guest would pay" (B-S7). Worked out as the ❤ would be, the stay's own Extra included (no kitchen, its tax, how far
 * it is: R10), so a card says what the ❤ then shows. Null for a stay or destination that is not the trip's.
 */
export function scenarioWithStay(db: Db, loaded: TripScenarios, destinationId: string, stayId: string): Scenario | null {
  const destination = loaded.trip.destinations.find((candidate) => candidate.id === destinationId);
  const stay = loaded.stays.find((candidate) => candidate.id === stayId && candidate.destinationId === destinationId);
  if (!destination || !stay) return null;
  const heart: Selection = { id: `if-${stayId}`, tripId: loaded.trip.id, destinationId, kind: "stay", stayOptionId: stayId, reason: null, createdAt: new Date(0).toISOString() };
  const selections = [...loaded.selections.filter((selection) => !(selection.kind === "stay" && selection.destinationId === destinationId)), heart];
  const { trip, options, stays, analyses, checks } = loaded;
  return scenarioWithExtra(db, { destination, guests: trip.guests, guestModes: trip.guestModes, options, stays, analyses, selections, checks });
}

/**
 * A destination's scenario with each guest's Extra in their cost and tier (R5, R6, task.md T8.9). The Extra needs the
 * scenario's stay and journeys, so it is worked out first without it, then with it. It counts once the destination's
 * local prices are known (T8.4): a trip computed before keeps its figures until it is computed again.
 */
export function scenarioWithExtra(db: Db, input: ScenarioInput): Scenario {
  const first = buildScenario(input);
  const built = extraInputOf(db, input.destination, input.guests, first);
  if (!built || built.pricesSource === "eu-average") return first;
  const plan = extraPlan(built.input);
  return buildScenario({ ...input, extras: new Map(plan.guests.map((guest) => [guest.guestId, { mandatoryEur: guest.mandatoryEur, plusEur: guest.plusEur }])) });
}
