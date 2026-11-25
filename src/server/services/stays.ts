// The Housing page: the offers of a destination by source, and the AI's advice on each one
// (use-cases.md UC-B, B-S4 to B-S8).
import { and, desc, eq, sql } from "drizzle-orm";
import { colorOf } from "@/core/colors";
import { nightsBetween } from "@/core/dates";
import { recommendedDestination } from "@/core/recommend";
import { pickDefaultStay, type Scenario } from "@/core/scenario";
import type { BudgetTier, Color, RatingSource, StayAnalysis, StayProvider, StayVerdict } from "@/core/types";
import { toStayAnalysis } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { enqueueJob } from "@/worker/queue";
import { ConflictError, FieldError, NotFoundError } from "../errors";
import { destinationChoices, type DestinationChoice, type NotReady } from "./dashboard";
import { loadTripScenarios, mergeJudgement, scenarioWithStay, type TripScenarios } from "./scenarios";
import { stayAnalysisInputOf } from "./stayAnalysisInput";

export type StayCard = {
  id: string;
  provider: StayProvider;
  title: string;
  rooms: number | null;
  beds: number | null;
  /** How many people it sleeps */
  capacity: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalEur: number;
  perGuestEur: number;
  /** One guest's share for one night */
  perGuestNightEur: number;
  /** Cheapest of the destination's offers is green, dearest red (R8) */
  color: Color;
  rating: number | null;
  url: string | null;
  photos: string[];
  /** How well it suits the group, from the rating made while the trip was set up; null when nothing rated it */
  fitScore: number | null;
  verdict: StayVerdict | null;
  /** Who gave that score: the AI, or the rules when the AI was not available ("not rated by the AI"); null when nobody did */
  ratedBy: RatingSource | null;
  /** Why it got that score, in a sentence */
  ratingReason: string | null;
  /** The group's ❤ is on this one */
  hearted: boolean;
  /** Whether it sleeps the whole group */
  fits: boolean;
  /** What each guest would pay in all if this were the pick, and how that sits with their budget (B-S7) */
  impact: { guestId: string; name: string; costEur: number; tier: BudgetTier }[];
};

export type HousingColumn = { provider: StayProvider; label: string; stays: StayCard[] };

export type HousingView =
  | NotReady
  | {
      kind: "ready";
      tripId: string;
      destinations: DestinationChoice[];
      selectedId: string;
      /** The offer the budget uses when nobody has put a ❤ */
      defaultStayId: string | null;
      /** One column per source, each sorted best first */
      columns: HousingColumn[];
    };

const COLUMNS: { provider: StayProvider; label: string }[] = [
  { provider: "airbnb", label: "Airbnb" },
  { provider: "booking", label: "Hotel" },
];

/**
 * Every offer of a destination as a card, by stay id: how the group would fare with each (B-S5, B-S7), worked out as a
 * ❤ on it would be, its own Extra included (R10).
 */
function stayCardsOf(db: Db, loaded: TripScenarios, scenario: Scenario): Map<string, StayCard> {
  const { trip, stays, analyses } = loaded;
  const groupSize = trip.guests.length;
  const offers = stays.filter((stay) => stay.destinationId === scenario.destinationId);
  const totals = offers.map((stay) => stay.totalPriceEur);

  return new Map<string, StayCard>(
    offers.map((stay) => {
      const nights = Math.max(1, nightsBetween({ from: stay.checkIn, to: stay.checkOut }));
      const analysis = analyses.get(stay.id);
      const share = stay.totalPriceEur / groupSize;
      const withIt = scenario.stay?.id === stay.id ? scenario : scenarioWithStay(db, loaded, scenario.destinationId, stay.id);
      const impact = (withIt?.guests ?? []).flatMap((guest) =>
        guest.costEur === null ? [] : [{ guestId: guest.guestId, name: guest.name, costEur: guest.costEur, tier: guest.tier }],
      );
      return [
        stay.id,
        {
          id: stay.id,
          provider: stay.provider,
          title: stay.title,
          rooms: stay.rooms,
          beds: stay.beds,
          capacity: stay.capacity,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          nights,
          totalEur: stay.totalPriceEur,
          perGuestEur: share,
          perGuestNightEur: share / nights,
          color: colorOf("relativePrice", stay.totalPriceEur, totals),
          rating: stay.rating,
          url: stay.url,
          photos: stay.photos,
          fitScore: analysis?.fitScore ?? null,
          verdict: analysis?.verdict ?? null,
          ratedBy: analysis?.ratedBy ?? null,
          ratingReason: analysis?.ratingReason ?? null,
          hearted: scenario.staySource === "selected" && scenario.stay?.id === stay.id,
          fits: stay.capacity >= groupSize,
          impact,
        },
      ];
    }),
  );
}

/** Best first: by the fit score it was rated, then by price (B-S4). */
const bestFirst = (a: StayCard, b: StayCard) => (b.fitScore ?? 0) - (a.fitScore ?? 0) || a.totalEur - b.totalEur;

/**
 * The offers of one destination (the recommended one by default), one column per source, best
 * first: by the fit score they were rated while the trip was set up, then by price (B-S4). Null when
 * the trip does not exist.
 */
export function getHousingView(db: Db, tripId: string, destinationId?: string): HousingView | null {
  const loaded = loadTripScenarios(db, tripId);
  if (!loaded) return null;
  const { trip, scenarios, stays, analyses, ranked } = loaded;
  if (!(trip.status === "ready" || trip.status === "validated") || scenarios.length === 0) {
    return { kind: "not-ready", tripId, status: trip.status };
  }

  const recommended = recommendedDestination(ranked)?.destinationId;
  const scenario =
    scenarios.find((s) => s.destinationId === destinationId) ??
    scenarios.find((s) => s.destinationId === (recommended ?? ranked[0].destinationId))!;
  const groupSize = trip.guests.length;
  const offers = stays.filter((stay) => stay.destinationId === scenario.destinationId);
  const cards = stayCardsOf(db, loaded, scenario);

  return {
    kind: "ready",
    tripId,
    destinations: destinationChoices(trip.destinations, scenarios, recommended),
    selectedId: scenario.destinationId,
    defaultStayId: pickDefaultStay(offers, analyses, groupSize)?.id ?? null,
    columns: COLUMNS.map(({ provider, label }) => ({
      provider,
      label,
      stays: [...cards.values()]
        .filter((card) => card.provider === provider)
        .sort(bestFirst),
    })),
  };
}

// ── The API: a destination's offers, and a comparison ──────────────────────

/** The destination's trip and its scenario, for a trip that has been worked out. */
function scenarioOfDestination(db: Db, destinationId: string) {
  const [destination] = db.select({ tripId: schema.destinations.tripId }).from(schema.destinations).where(eq(schema.destinations.id, destinationId)).all();
  if (!destination) throw new NotFoundError("Destination not found");

  const loaded = loadTripScenarios(db, destination.tripId)!;
  if (!(loaded.trip.status === "ready" || loaded.trip.status === "validated")) {
    throw new ConflictError("not_ready", "The trip has not been worked out yet");
  }
  return { loaded, scenario: loaded.scenarios.find((s) => s.destinationId === destinationId)! };
}

export type StayPage = {
  items: StayCard[];
  /** Pass it back to get the next page; null when there is no more */
  nextCursor: string | null;
};

/**
 * One page of a destination's offers, best first (B-S4), optionally of one source only. The cursor
 * says where the previous page stopped; it is only meant to be handed back as it was given.
 */
export function listStays(
  db: Db,
  destinationId: string,
  { provider, cursor, limit = 5 }: { provider?: StayProvider; cursor?: string; limit?: number } = {},
): StayPage {
  const { loaded, scenario } = scenarioOfDestination(db, destinationId);
  const offset = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isInteger(offset) || offset < 0) throw new FieldError("cursor", "That is not a page this list gave");

  const cards = [...stayCardsOf(db, loaded, scenario).values()].filter((card) => provider === undefined || card.provider === provider).sort(bestFirst);
  const items = cards.slice(offset, offset + limit);
  return { items, nextCursor: offset + limit < cards.length ? String(offset + limit) : null };
}

export type StayComparison = {
  destinationId: string;
  /** The guests, in the order of the rows of each offer's `impact` */
  guests: { id: string; name: string }[];
  /** In the order asked for. `impact` is what each guest would pay, and where that leaves them, if it were the pick (B-S7) */
  stays: StayCard[];
};

/** 2 or 3 offers of one destination side by side, with the budget impact on each guest (B-S7). */
export function compareStays(db: Db, destinationId: string, ids: string[]): StayComparison {
  const { loaded, scenario } = scenarioOfDestination(db, destinationId);
  if (new Set(ids).size !== ids.length) throw new FieldError("ids", "Each offer can only be compared once");

  const cards = stayCardsOf(db, loaded, scenario);
  const unknown = ids.filter((id) => !cards.has(id));
  if (unknown.length > 0) throw new FieldError("ids", "Those offers are not offered at this destination");

  return {
    destinationId,
    guests: loaded.trip.guests.map((guest) => ({ id: guest.id, name: guest.name })),
    stays: ids.map((id) => cards.get(id)!),
  };
}

// ── AI advice ──────────────────────────────────────────────────────────────

/**
 * What "Why this?" answers with. `analysis` and `previous` carry the stay's stored rating (its score
 * and who gave it) together with the AI's explanation once it has been asked for, so a rating is
 * shown at once and the explanation follows.
 */
export type StayAnalysisState =
  /** The AI has explained it. `stale`: the offer, the group or the rating has changed since it was written */
  | { state: "ready"; analysis: StayAnalysis; stale: boolean }
  /** The explanation has been asked for and is on its way: ask again in a moment. `previous` is what is known until then */
  | { state: "pending"; previous?: StayAnalysis }
  /** It could not be had (the AI is not available): the rest keeps working (B.5). `message` says why, when known */
  | { state: "unavailable"; message: string | null; previous?: StayAnalysis };

/** How long a failed attempt keeps the AI "unavailable" before another one is made. */
const RETRY_AFTER_MS = 30 * 60 * 1000;

/**
 * "Why this?" on a stay (B-S6), the one place the AI is asked while the dashboard is in use. When it
 * has not explained the stay yet, asks the worker to and says it is pending; a request that failed
 * recently is not made again at once. An explanation that exists is given as it is, flagged `stale`
 * when the facts it was written for have changed (their fingerprint differs): asking again is up to
 * the user (`refresh`), so the subscription is never spent unasked.
 */
export function getOrRequestStayAnalysis(
  db: Db,
  stayId: string,
  { now = new Date(), refresh = false }: { now?: Date; refresh?: boolean } = {},
): StayAnalysisState {
  const input = stayAnalysisInputOf(db, stayId);
  if (!input) throw new NotFoundError("Accommodation not found");

  const [row] = db.select().from(schema.stayAnalyses).where(eq(schema.stayAnalyses.stayId, stayId)).all();
  const explanation = row ? toStayAnalysis(row) : null;
  // The stored rating comes with it whether or not the AI has explained it yet
  const judged = mergeJudgement(stayId, input.rating, explanation);
  const previous = judged ? { previous: judged } : {};

  const [latest] = db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, "analyze_stay"), sql`json_extract(${schema.jobs.payloadJson}, '$.stayId') = ${stayId}`))
    .orderBy(desc(schema.jobs.createdAt), desc(sql`rowid`))
    .limit(1)
    .all();

  if (latest && (latest.status === "queued" || latest.status === "running")) return { state: "pending", ...previous };

  const stale = explanation !== null && explanation.inputHash !== input.inputHash;
  // Asking again about facts that have not changed would only give the same answer
  if (explanation && judged && (!refresh || !stale)) return { state: "ready", analysis: judged, stale };

  if (!explanation && !refresh && latest?.status === "failed" && now.getTime() - Date.parse(latest.updatedAt) < RETRY_AFTER_MS) {
    return { state: "unavailable", message: latest.error, ...previous };
  }

  enqueueJob(db, { tripId: input.tripId, type: "analyze_stay", payload: { stayId } });
  return { state: "pending", ...previous };
}
