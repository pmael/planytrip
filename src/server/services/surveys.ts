// What is around each place to stay of a destination, from OpenStreetMap (task.md T8.3, use-cases.md R10, R11): asked
// once per destination for the area of its stays (scrapers/places/overpass.ts, kept a month), worked out per stay
// (core/surroundings.ts) and stored in `place_surveys`, one row per stay. The Extra (T8.6) and the stay ratings (T8.7)
// read it from there.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { surroundingsOf, type Surroundings } from "@/core/surroundings";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { createScrapeCache } from "@/scrapers/cache";
import { overpassFetcher, surveyArea, type PlacesFetcher } from "@/scrapers/places/overpass";
import { extras } from "@/config";
import { commonWindow, tripWindow } from "@/core/dates";
import type { TransportMode } from "@/core/types";
import { toDestination, toGuest } from "@/db/mappers";
import { distanceKm } from "@/geo/airports";
import { hubsOf, type Hub } from "@/geo/hubs";
import { ScrapeBlockedError, ScrapeError } from "@/scrapers/errors";
import { localTransit as transitousLocal, type LocalTransit } from "@/scrapers/places/local-transit";

const SOURCE = "openstreetmap";

/** Where a stay is, as its search kept it (T8.2): null for an offer found before positions were kept */
const PositionSchema = z.object({ lat: z.number(), lon: z.number() });
function positionOf(rawJson: string | null): { lat: number; lon: number } | null {
  try {
    const parsed = PositionSchema.safeParse(rawJson ? JSON.parse(rawJson) : null);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type SurveyOutcome = { surveyed: number; withoutPosition: number };

/**
 * Surveys the stays of a destination. A stay with no known position is left out (it has no row). Nothing is asked when
 * no stay has one. `force` asks OpenStreetMap again even when the area's answer is still kept.
 */
export async function surveyPlaces(db: Db, { destinationId, force = false }: { destinationId: string; force?: boolean }, fetchPlaces: PlacesFetcher = overpassFetcher): Promise<SurveyOutcome> {
  const [destination] = db.select().from(schema.destinations).where(eq(schema.destinations.id, destinationId)).all();
  if (!destination) return { surveyed: 0, withoutPosition: 0 };

  const rows = db.select({ id: schema.stayOptions.id, rawJson: schema.stayOptions.rawJson }).from(schema.stayOptions).where(eq(schema.stayOptions.destinationId, destinationId)).all();
  const stays = rows.flatMap((row) => {
    const position = positionOf(row.rawJson);
    return position ? [{ id: row.id, ...position }] : [];
  });

  const centre = { lat: destination.lat, lon: destination.lon };
  const facts = stays.length === 0 ? new Map<string, Surroundings>() : surroundingsOf(stays, await fetchPlaces(surveyArea(centre, stays), { cache: createScrapeCache(db), refresh: force }), centre);

  db.transaction((tx) => {
    // A stay that is no longer placed loses its row, as one that is gone does (by the foreign key)
    tx.delete(schema.placeSurveys).where(eq(schema.placeSurveys.destinationId, destinationId)).run();
    for (const [stayOptionId, surroundings] of facts) {
      tx.insert(schema.placeSurveys).values({ destinationId, stayOptionId, factsJson: JSON.stringify(surroundings), source: SOURCE }).run();
    }
  });
  return { surveyed: facts.size, withoutPosition: rows.length - stays.length };
}

/** How a stay is reached (T8.6): from each arrival point (km for a taxi, minutes by public transport at midday), and back from a night out */
export type StayAccess = {
  /** `fareEur`: the line's own fare when it is known (an airport bus), else a plain ticket */
  transfers: { hub: string; lat: number; lon: number; km: number; transitMin: number | null; fareEur?: number }[];
  /** A night bus back from the nightlife district at 03:00; null when not asked (not a partying trip, no district) */
  nightBus: boolean | null;
};

const PositionSchema2 = z.object({ lat: z.number(), lon: z.number() });
const AccessSchema: z.ZodType<StayAccess> = z.object({
  transfers: z.array(z.object({ hub: z.string(), lat: z.number(), lon: z.number(), km: z.number(), transitMin: z.number().nullable(), fareEur: z.number().optional() })),
  nightBus: z.boolean().nullable(),
});

const SurroundingsSchema = z.object({
  centreKm: z.number(),
  supermarketKm: z.number().nullable(),
  barsWithin500m: z.number(),
  nightclubsWithin1Km: z.number(),
  sightsWithin1Km: z.number(),
  nightlifeKm: z.number().nullable(),
  historicCentreKm: z.number().nullable(),
  natureKm: z.number().nullable(),
  nightlifeAt: PositionSchema2.nullable().optional(),
  searchedKm: z.object({ supermarket: z.number(), nature: z.number() }),
  access: AccessSchema.optional(),
});

/** What is known around each stay of a destination, by stay id. A row that does not read is left out. */
export function getPlaceSurveys(db: Db, destinationId: string): Map<string, Surroundings & { access?: StayAccess; surveyedAt: string }> {
  const rows = db.select().from(schema.placeSurveys).where(eq(schema.placeSurveys.destinationId, destinationId)).all();
  const result = new Map<string, Surroundings & { access?: StayAccess; surveyedAt: string }>();
  for (const row of rows) {
    try {
      const parsed = SurroundingsSchema.safeParse(JSON.parse(row.factsJson));
      if (parsed.success) result.set(row.stayOptionId, { ...parsed.data, surveyedAt: row.surveyedAt });
    } catch {
      // A row written by an older version: as if not surveyed
    }
  }
  return result;
}

/** The arrival points of a destination's journeys (not the cars'), the most used first, near ones counted as one */
export function arrivalHubs(db: Db, destinationId: string): Hub[] {
  const [row] = db.select().from(schema.destinations).where(eq(schema.destinations.id, destinationId)).all();
  if (!row) return [];
  const destination = toDestination(row);
  const options = db.select({ mode: schema.transportOptions.mode, rawJson: schema.transportOptions.rawJson }).from(schema.transportOptions).where(eq(schema.transportOptions.destinationId, destinationId)).all();
  const counted: { hub: Hub; uses: number }[] = [];
  for (const option of options) {
    if (option.mode === "car") continue;
    let raw: unknown = null;
    try {
      raw = option.rawJson ? JSON.parse(option.rawJson) : null;
    } catch {
      raw = null;
    }
    const { there, back } = hubsOf(raw, option.mode as TransportMode, destination);
    for (const hub of [there, back]) {
      const same = counted.find((known) => distanceKm(known.hub.lat, known.hub.lon, hub.lat, hub.lon) <= extras.transfer.mergeKm);
      if (same) same.uses++;
      else counted.push({ hub, uses: 1 });
    }
  }
  return counted.sort((a, b) => b.uses - a.uses).slice(0, extras.transfer.maxHubs).map((known) => known.hub);
}

/**
 * How each surveyed stay of a destination is reached (T8.6), kept with its survey: from each arrival point, a taxi's
 * km and public transport's minutes at midday (Transitous, kept a month); for a partying trip, whether a night bus runs
 * back from the nightlife district at 03:00. A Transitous that turns us away stops the asking: the rest count as taxis.
 */
export async function surveyAccess(db: Db, destinationId: string, transit: LocalTransit = transitousLocal): Promise<{ stays: number; asked: number; problem: string | null }> {
  const [row] = db.select().from(schema.destinations).where(eq(schema.destinations.id, destinationId)).all();
  if (!row) return { stays: 0, asked: 0, problem: null };
  const destination = toDestination(row);
  const guests = db.select().from(schema.guests).where(eq(schema.guests.tripId, row.tripId)).all().map(toGuest);
  const [trip] = db.select().from(schema.trips).where(eq(schema.trips.id, row.tripId)).all();
  const common = commonWindow(guests, destination);
  const day = common ? tripWindow(common, trip.nights).from : new Date().toISOString().slice(0, 10);
  const nextDay = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  const hubs = arrivalHubs(db, destinationId);
  const surveys = db.select().from(schema.placeSurveys).where(eq(schema.placeSurveys.destinationId, destinationId)).all();
  const stays = new Map(
    db
      .select({ id: schema.stayOptions.id, rawJson: schema.stayOptions.rawJson })
      .from(schema.stayOptions)
      .where(eq(schema.stayOptions.destinationId, destinationId))
      .all()
      .map((stay) => [stay.id, positionOf(stay.rawJson)]),
  );
  const cache = createScrapeCache(db);
  let asked = 0;
  let problem: string | null = null;
  const ask = async (from: { lat: number; lon: number }, to: { lat: number; lon: number }, atUtc: string): Promise<number | null> => {
    if (problem) return null;
    try {
      asked++;
      return await transit(from, to, atUtc, { cache });
    } catch (error) {
      if (!(error instanceof ScrapeError)) throw error;
      if (error instanceof ScrapeBlockedError || !error.retryable) problem = error.message;
      return null;
    }
  };

  for (const survey of surveys) {
    const stay = stays.get(survey.stayOptionId);
    if (!stay) continue;
    const facts = JSON.parse(survey.factsJson) as Surroundings;
    const transfers: StayAccess["transfers"] = [];
    for (const hub of hubs) {
      const km = Math.round(distanceKm(hub.lat, hub.lon, stay.lat, stay.lon) * extras.transfer.roadFactor * 10) / 10;
      transfers.push({ hub: hub.name, lat: hub.lat, lon: hub.lon, km, transitMin: await ask(hub, stay, `${day}T${extras.transfer.askAtUtc}:00Z`) });
    }
    const nightBus =
      destination.objective === "partying" && facts.nightlifeAt
        ? await ask(facts.nightlifeAt, stay, `${nextDay}T${extras.transfer.nightAtUtc}:00Z`).then((minutes) => (minutes === null ? false : minutes <= 60))
        : null;
    const access: StayAccess = { transfers, nightBus: problem && nightBus === false ? null : nightBus };
    db.update(schema.placeSurveys).set({ factsJson: JSON.stringify({ ...facts, access }) }).where(eq(schema.placeSurveys.id, survey.id)).run();
  }
  return { stays: surveys.length, asked, problem };
}
