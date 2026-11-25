import { vi } from "vitest";
import { ClaudeUnavailableError, type AskFn } from "@/ai/claude";
import { eq, sql } from "drizzle-orm";
import type { GeoPlace, Guest, TransportMode } from "@/core/types";
import { destinationKeyOf, fixtureActivityRows, fixtureOriginOf, fixtureSurveyFacts, localPriceFixtures, transportFixtures, transportOptionOf } from "@/db/seed/fixtures";
import { airportLocation } from "@/geo/airports";
import type { Db } from "@/db/types";
import type { RouteFn } from "@/geo/osrm";
import type { LocalTransit } from "@/scrapers/places/local-transit";
import type { PlacesFetcher } from "@/scrapers/places/overpass";
import { ScrapeUnavailableError } from "@/scrapers/errors";
import type { FuelPricesSource } from "@/scrapers/prices/oil-bulletin";
import type { PriceDestinationDeps } from "@/worker/handlers/price-destination";
import type { AdapterSet } from "@/scrapers/registry";
import { fixtureStaysAdapter } from "@/scrapers/stays/fixture-stays";
import { fixtureFlightsAdapter } from "@/scrapers/transport/fixture-flights";
import type { StayAdapter, TransportAdapter } from "@/scrapers/types";
import { addDestination } from "@/server/services/destinations";
import { addGuest, setGuestModes } from "@/server/services/guests";
import { storeRatings } from "@/server/services/ratings";
import { createTrip, getTrip } from "@/server/services/trips";
import { scenarioWithExtra } from "@/server/services/scenarios";
import { toRouteCheck, toStayAnalysis, toStayOption, toTransportOption } from "@/db/mappers";
import * as schema from "@/db/schema";
import { createHandlers } from "@/worker/handlers";
import { runWorker } from "@/worker";
import type { RetryPolicy } from "@/worker/queue";

export const madrid: GeoPlace = { label: "Madrid, Spain", countryCode: "ES", lat: 40.4168, lon: -3.7038, airports: ["MAD"] };
export const paris: GeoPlace = { label: "Paris, France", countryCode: "FR", lat: 48.8566, lon: 2.3522, airports: ["ORY", "CDG"] };
export const barcelona: GeoPlace = { label: "Barcelona, Spain", countryCode: "ES", lat: 41.3874, lon: 2.1686, airports: ["BCN"] };
export const reunion: GeoPlace = { label: "Réunion, France", countryCode: "FR", lat: -21.1309, lon: 55.5266, airports: ["RUN"] };
export const montSaxonnex: GeoPlace = { label: "Mont-Saxonnex, France", countryCode: "FR", lat: 46.0517, lon: 6.4533, airports: ["GVA"] };

/** The §1.3 car rows as an adapter, so that tests need no routing service. */
export const fixtureCarAdapter: TransportAdapter = {
  id: "fixture-car",
  modes: ["car"],
  async search(query) {
    const origin = fixtureOriginOf(query.origin.airports);
    const destination = destinationKeyOf(query.destination.airports);
    return transportFixtures
      .filter((f) => f.mode === "car" && f.originKey === origin && f.destination === destination)
      .map((f) => transportOptionOf(f, query.origin.key, query.window));
  },
};

/** Counts how often an adapter is asked. */
export function counted<A extends TransportAdapter | StayAdapter>(adapter: A): A & { calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn();
  return { ...adapter, calls, search: (q: never) => (calls(q), (adapter.search as (q: never) => Promise<unknown>)(q)) } as never;
}

export function fixtureAdapters(overrides: { flights?: TransportAdapter; car?: TransportAdapter; stays?: StayAdapter } = {}): AdapterSet {
  const flights = overrides.flights ?? fixtureFlightsAdapter;
  const car = overrides.car ?? fixtureCarAdapter;
  const stays = overrides.stays ?? fixtureStaysAdapter;
  return {
    transportAdaptersFor: (mode: TransportMode) => (mode === "plane" ? [flights] : mode === "car" ? [car] : []),
    stayAdapters: () => [stays],
  };
}

/** A router that finds a road everywhere except to an island in the southern hemisphere. */
export const fakeRoute: RouteFn = async (_from, to) => (to.lat < 0 ? null : { distanceKm: 620, durationMin: 370 });

const dates = { availableFrom: "2027-08-26", availableTo: "2027-09-05" };

/** Martin, Chloé and Jessy and the three destinations, entered the way the wizard does. */
export async function enterScenario(db: Db, { martinAcceptsPlane = false } = {}) {
  const trip = createTrip(db);
  const martin = (await addGuest(db, trip.id, { name: "Martin", homePlace: madrid, maxBudgetEur: 800, ...dates, preferredMode: "car" })).guest;
  const chloe = (await addGuest(db, trip.id, { name: "Chloé", homePlace: paris, maxBudgetEur: 1200, ...dates, availableTo: "2027-09-14", preferredMode: "plane" })).guest;
  const jessy = (await addGuest(db, trip.id, { name: "Jessy", homePlace: madrid, maxBudgetEur: 400, ...dates, availableTo: "2027-09-14", preferredMode: "plane" })).guest;
  if (martinAcceptsPlane) await setGuestModes(db, martin.id, ["car", "plane"], fakeRoute);
  const bcn = await addDestination(db, trip.id, { place: barcelona, budgetLevel: "light", objective: "partying" });
  const run = await addDestination(db, trip.id, { place: reunion, budgetLevel: "high", objective: "chill" });
  const ms = await addDestination(db, trip.id, { place: montSaxonnex, budgetLevel: "high", objective: "nature" });
  return { tripId: trip.id, guests: { martin, chloe, jessy } as Record<string, Guest>, destinations: { bcn, run, ms } };
}

/** A test that does not hand the worker an AI must never reach the real one: that would spend the subscription. */
const noAi: AskFn = async () => {
  throw new ClaudeUnavailableError("No AI was provided in this test");
};

/** A test that does not hand the worker OpenStreetMap must never reach the real one: an area with nothing in it. */
const noPlaces: PlacesFetcher = async () => [];

/** Nor Transitous: no public transport anywhere */
const noTransit: LocalTransit = async () => null;

/** No EU Weekly Oil Bulletin: the fuel price stays an estimate */
export const noBulletin: FuelPricesSource = async () => {
  throw new ScrapeUnavailableError("No Oil Bulletin in the tests");
};

/** Nor the AI, Eurostat, the map, DiscoverCars or the Oil Bulletin for the local prices: they are the rules', at the EU average */
const noPrices: PriceDestinationDeps = { ask: noAi, levels: async () => null, findPlace: async () => null, franceTax: async () => null, route: async () => null, transit: async () => null, rental: async () => null, fuel: noBulletin };

/** Runs the worker until the queue is empty, with waits and backoff made instant. */
export async function runUntilIdle(
  db: Db,
  adapters: AdapterSet,
  {
    route = fakeRoute,
    policy,
    ask = noAi,
    places = noPlaces,
    transit = noTransit,
    prices = noPrices,
    adviceAsk = noAi,
    fixtureFacts = true,
  }: { route?: RouteFn; policy?: RetryPolicy; ask?: AskFn; places?: PlacesFetcher; transit?: LocalTransit; prices?: PriceDestinationDeps; adviceAsk?: AskFn; fixtureFacts?: boolean } = {},
) {
  const controller = new AbortController();
  const fast: RetryPolicy = policy ?? { maxRetries: 2, backoffMs: [0, 0] };
  const done = runWorker(db, createHandlers({ route, adapters, ask, places, transit, prices, adviceAsk, waitMs: 1 }), { pollMs: 2, signal: controller.signal, policy: fast });
  // Idle: nothing queued and nothing running
  for (let i = 0; i < 2000; i++) {
    const [{ n }] = db.all<{ n: number }>(sql`select count(*) as n from jobs where status in ('queued','running')`);
    if (n === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  controller.abort();
  await done;
  if (fixtureFacts) writeFixtureFacts(db);
}

/**
 * The reference facts of use-cases.md UC-D for the scenario's destinations and stays, written over what the test's own
 * computation found (no AI, no OpenStreetMap, no Transitous): the local prices, the things to do and what is around each
 * stay, as the seed writes them. The Extra, and so every cost, is then UC-D's (task.md T8.9).
 */
export function writeFixtureFacts(db: Db) {
  for (const destination of db.select().from(schema.destinations).all()) {
    const key = destinationKeyOf(JSON.parse(destination.airportsJson) as string[]);
    if (!key) continue;
    db.delete(schema.destinationPrices).where(eq(schema.destinationPrices.destinationId, destination.id)).run();
    db.insert(schema.destinationPrices).values({ destinationId: destination.id, pricesJson: JSON.stringify(localPriceFixtures[key]), source: "ai", inputHash: "fixture", message: null }).run();
    db.delete(schema.extraActivities).where(eq(schema.extraActivities.destinationId, destination.id)).run();
    for (const row of fixtureActivityRows(key, destination)) db.insert(schema.extraActivities).values({ ...row, destinationId: destination.id, objective: destination.objective }).run();
  }
  for (const stay of db.select().from(schema.stayOptions).all()) {
    const facts = stay.externalId ? fixtureSurveyFacts(stay.externalId, airportLocation) : null;
    if (!facts) continue;
    db.delete(schema.placeSurveys).where(eq(schema.placeSurveys.stayOptionId, stay.id)).run();
    db.insert(schema.placeSurveys).values({ destinationId: stay.destinationId, stayOptionId: stay.id, factsJson: JSON.stringify(facts), source: "fixture" }).run();
  }
}

/** The trip's stored data as the domain types, ready for buildScenario. */
export function readTrip(db: Db, tripId: string) {
  const trip = getTrip(db, tripId)!;
  const destinationIds = trip.destinations.map((d) => d.id);
  const options = db.select().from(schema.transportOptions).all().filter((o) => destinationIds.includes(o.destinationId)).map(toTransportOption);
  const stays = db.select().from(schema.stayOptions).all().filter((s) => destinationIds.includes(s.destinationId)).map(toStayOption);
  const checks = db.select().from(schema.routeChecks).all().filter((c) => destinationIds.includes(c.destinationId)).map(toRouteCheck);
  const analyses = new Map(db.select().from(schema.stayAnalyses).all().map((a) => [a.stayId, toStayAnalysis(a)]));
  // With each guest's Extra (task.md T8.9), as the dashboard works it out
  const scenarioFor = (destinationId: string, guestModes = trip.guestModes) =>
    scenarioWithExtra(db, {
      destination: trip.destinations.find((d) => d.id === destinationId)!,
      guests: trip.guests,
      guestModes,
      options,
      stays,
      analyses,
      selections: [],
      checks,
    });
  return { trip, options, stays, checks, scenarioFor };
}

/** A trip set up before ratings existed, or whose ratings were lost: nothing was ever rated. */
export function forgetRatings(db: Db) {
  db.delete(schema.optionRatings).run();
  db.delete(schema.ratingRuns).run();
}

/**
 * What the AI rated at one destination while the trip was set up, replacing the rules' ratings:
 * the given stays as `[stayId, score, verdict]`; the stays not named are left unrated.
 */
export function rateStaysAsAi(db: Db, tripId: string, destinationId: string, rated: readonly (readonly [string, number, "good" | "ok" | "bad"])[]) {
  storeRatings(
    db,
    { tripId, destinationId, kind: "stays", hash: "test" },
    new Map(rated.map(([stayId, score, verdict]) => [stayId, { verdict, score, reason: "-", source: "ai" as const }])),
    { source: "ai", message: null },
  );
}
