import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { ScrapeBlockedError, ScrapeError, ScrapeUnavailableError } from "@/scrapers/errors";
import { createAdapterRegistry } from "@/scrapers/registry";
import type { StayAdapter, StayQuery, TransportAdapter, TransportQuery } from "@/scrapers/types";
import { startCompute } from "@/server/services/compute";
import { updateDestination } from "@/server/services/destinations";
import { searchStays, searchTransport } from "@/server/services/search";
import { createTestDb } from "./helpers/db";
import { enterScenario, fixtureAdapters, runUntilIdle } from "./helpers/compute";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

describe("createAdapterRegistry (T7.6: the switch between the dataset and the real sites)", () => {
  it("scrapes Airbnb for stays when config says airbnb, and uses the dataset when it says fixture", () => {
    expect(createAdapterRegistry({ flights: "fixture", stays: "airbnb" }).stayAdapters().map((a) => a.id)).toEqual(["airbnb"]);
    expect(createAdapterRegistry({ flights: "fixture", stays: "fixture" }).stayAdapters().map((a) => a.id)).toEqual(["fixture-stays"]);
  });

  it("has nothing to search stays with for a source it does not know", () => {
    expect(createAdapterRegistry({ flights: "fixture", stays: "booking" }).stayAdapters()).toEqual([]);
  });

  it("keeps the flights on the dataset while only Airbnb is real, and the car always real", () => {
    const registry = createAdapterRegistry({ flights: "fixture", stays: "airbnb" });
    expect(registry.transportAdaptersFor("plane").map((a) => a.id)).toEqual(["fixture-flights"]);
    expect(registry.transportAdaptersFor("car")).toHaveLength(1);
    expect(registry.transportAdaptersFor("train")).toEqual([]); // ground is not set
  });

  it("searches Google Flights for flights when they are real, and still has the car", () => {
    const registry = createAdapterRegistry({ flights: "google-flights", stays: "airbnb" });
    expect(registry.transportAdaptersFor("plane").map((a) => a.id)).toEqual(["google-flights"]);
    expect(registry.transportAdaptersFor("car")).toHaveLength(1);
  });

  it("searches FlixBus for buses and trains, and nothing for them when it is switched off", () => {
    const on = createAdapterRegistry({ flights: "fixture", stays: "fixture", ground: "flixbus" });
    expect(on.transportAdaptersFor("bus").map((a) => a.id)).toEqual(["flixbus"]);
    expect(on.transportAdaptersFor("train").map((a) => a.id)).toEqual(["flixbus"]);
    expect(createAdapterRegistry({ flights: "fixture", stays: "fixture", ground: "none" }).transportAdaptersFor("bus")).toEqual([]);
    expect(createAdapterRegistry({ flights: "fixture", stays: "fixture" }).transportAdaptersFor("train")).toEqual([]);
  });

  it("adds the hotels from Google Hotels to Airbnb's rentals, unless they are switched off", () => {
    expect(createAdapterRegistry({ flights: "fixture", stays: "airbnb", hotels: "google-hotels" }).stayAdapters().map((a) => a.id)).toEqual(["airbnb", "google-hotels"]);
    expect(createAdapterRegistry({ flights: "fixture", stays: "airbnb", hotels: "none" }).stayAdapters().map((a) => a.id)).toEqual(["airbnb"]);
    expect(createAdapterRegistry({ flights: "fixture", stays: "airbnb" }).stayAdapters().map((a) => a.id)).toEqual(["airbnb"]);
    // The sample dataset has its own hotels
    expect(createAdapterRegistry({ flights: "fixture", stays: "fixture", hotels: "google-hotels" }).stayAdapters().map((a) => a.id)).toEqual(["fixture-stays"]);
  });

  it("has no flight source for one it does not know", () => {
    expect(createAdapterRegistry({ flights: "skyscanner", stays: "airbnb" }).transportAdaptersFor("plane")).toEqual([]);
  });
});

/** A stay adapter that writes down what it was asked and finds nothing. */
function listening() {
  const queries: StayQuery[] = [];
  const adapter: StayAdapter = { id: "listening", search: async (query) => (queries.push(query), []) };
  return { adapter, queries };
}

describe("searchStays gives the adapter what it needs", () => {
  it("asks for the group's size and the days everyone is free", async () => {
    const { destinations } = await enterScenario(db);
    const { adapter, queries } = listening();
    await searchStays(db, { destinationId: destinations.bcn.id }, [adapter]);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ groupSize: 3, window: { from: "2027-08-26", to: "2027-09-05" } });
    expect(queries[0].destination).toMatchObject({ id: destinations.bcn.id, label: expect.stringContaining("Barcelona"), airports: ["BCN"] });
    expect(queries[0].destination.lat).toBeCloseTo(41.39, 1);
  });

  it("asks for the destination's own dates when they are narrower than the group's", async () => {
    const { destinations } = await enterScenario(db);
    await updateDestination(db, destinations.bcn.id, { dateFrom: "2027-08-28", dateTo: "2027-09-03" });
    const { adapter, queries } = listening();
    await searchStays(db, { destinationId: destinations.bcn.id }, [adapter]);
    expect(queries[0].window).toEqual({ from: "2027-08-28", to: "2027-09-03" });
  });

  it("gives it a cache that keeps what it scraped, and says whether to ask the site again", async () => {
    const { destinations } = await enterScenario(db);
    const { adapter, queries } = listening();
    await searchStays(db, { destinationId: destinations.bcn.id }, [adapter]);
    await searchStays(db, { destinationId: destinations.bcn.id, force: true }, [adapter]);

    expect(queries.map((q) => q.refresh)).toEqual([undefined, true]);
    // The cache is the table's: what it remembers is there for the next run
    const produce = vi.fn(async () => "x");
    await queries[0].cache!.remember("k", "airbnb", 60_000, produce);
    await queries[0].cache!.remember("k", "airbnb", 60_000, produce);
    expect(produce).toHaveBeenCalledTimes(1);
    expect(db.select().from(schema.scrapeCache).all()).toHaveLength(1);
  });
});

describe("searchTransport gives the adapter a cache, like the stays", () => {
  it("keeps what it scraped, and says whether to ask the site again", async () => {
    const { destinations } = await enterScenario(db);
    const queries: TransportQuery[] = [];
    const adapter: TransportAdapter = { id: "listening", modes: ["plane"], search: async (query) => (queries.push(query), []) };
    const payload = { destinationId: destinations.bcn.id, originKey: "madrid-spain", mode: "plane" as const };
    await searchTransport(db, payload, [adapter]);
    await searchTransport(db, { ...payload, force: true }, [adapter]);

    expect(queries.map((q) => q.refresh)).toEqual([undefined, true]);
    const produce = vi.fn(async () => "x");
    await queries[0].cache!.remember("k", "google-flights", 60_000, produce);
    await queries[0].cache!.remember("k", "google-flights", 60_000, produce);
    expect(produce).toHaveBeenCalledTimes(1);
  });
});

describe("the computation and the real sites", () => {
  it("passes `force` on to the transport searches too", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId, { force: true });
    await runUntilIdle(db, fixtureAdapters());
    const searches = db.select().from(schema.jobs).all().filter((j) => j.type === "search_transport");
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.every((j) => JSON.parse(j.payloadJson).force === true)).toBe(true);
  });

  it("passes `force` on to the stay searches: a recomputation that forces asks the site again", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId, { force: true });
    await runUntilIdle(db, fixtureAdapters());
    const staySearches = db.select().from(schema.jobs).all().filter((j) => j.type === "search_stays");
    expect(staySearches.length).toBeGreaterThan(0);
    expect(staySearches.every((j) => JSON.parse(j.payloadJson).force === true)).toBe(true);
  });

  it("does not force them otherwise", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters());
    const staySearches = db.select().from(schema.jobs).all().filter((j) => j.type === "search_stays");
    expect(staySearches.every((j) => JSON.parse(j.payloadJson).force === false)).toBe(true);
  });

  const failing = (error: Error) => {
    const search = vi.fn(async () => Promise.reject(error));
    return { adapter: { id: "failing", search } as StayAdapter, search };
  };
  const staySearchJobs = () => db.select().from(schema.jobs).all().filter((j) => j.type === "search_stays");

  it("gives up at once on a site that turned us away: asking again would only make it worse", async () => {
    const { tripId } = await enterScenario(db);
    const { adapter, search } = failing(new ScrapeBlockedError());
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ stays: adapter }));

    // One try per destination, no retries
    expect(search).toHaveBeenCalledTimes(3);
    expect(staySearchJobs().every((j) => j.status === "failed" && j.attempts === 1)).toBe(true);
    expect(staySearchJobs()[0].error).toContain("verification");
  });

  it("gives up at once on dates the site does not sell yet, saying so", async () => {
    const { tripId } = await enterScenario(db);
    const { adapter, search } = failing(new ScrapeUnavailableError("Airbnb has nothing to show for these dates yet"));
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ stays: adapter }));
    expect(search).toHaveBeenCalledTimes(3);
    expect(staySearchJobs()[0].error).toContain("these dates");
  });

  it("tries a hiccup again, as the queue does for any job", async () => {
    const { tripId } = await enterScenario(db);
    const { adapter, search } = failing(new ScrapeError("timed out"));
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ stays: adapter }));
    // 3 destinations, each tried 3 times (the first run and two retries)
    expect(search).toHaveBeenCalledTimes(9);
    expect(staySearchJobs().every((j) => j.status === "failed" && j.attempts === 3)).toBe(true);
  });

  it("still gets the trip ready when the stays could not be had: the way of getting there was found", async () => {
    const { tripId } = await enterScenario(db);
    const { adapter } = failing(new ScrapeBlockedError());
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ stays: adapter }));
    const [trip] = db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).all();
    expect(trip.status).toBe("ready");
    expect(db.select().from(schema.stayOptions).all()).toHaveLength(0);
  });
});
