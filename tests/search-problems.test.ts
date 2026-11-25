import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { ScrapeError } from "@/scrapers/errors";
import type { StayAdapter, TransportAdapter } from "@/scrapers/types";
import { searchNoticeOf } from "@/lib/searchText";
import { getSearchProblems, startCompute } from "@/server/services/compute";
import { searchStays } from "@/server/services/search";
import { fixtureStaysAdapter } from "@/scrapers/stays/fixture-stays";
import { fixtureFlightsAdapter } from "@/scrapers/transport/fixture-flights";
import { createTestDb } from "./helpers/db";
import { enterScenario, fixtureAdapters, runUntilIdle } from "./helpers/compute";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

/** Flights that do not answer, until `works` says they do. */
function flakyFlights() {
  const state = { works: false };
  const adapter: TransportAdapter = {
    id: "flaky-flights",
    modes: ["plane"],
    search: vi.fn(async (query) => {
      if (!state.works) throw new ScrapeError("Google Flights did not answer in time");
      return fixtureFlightsAdapter.search(query);
    }),
  };
  return { state, adapter };
}

const flightJobs = () => db.select().from(schema.jobs).all().filter((j) => j.type === "search_transport" && JSON.parse(j.payloadJson).mode === "plane");

describe("getSearchProblems", () => {
  it("has nothing to say when every search worked, and for a trip never computed", async () => {
    const { tripId } = await enterScenario(db);
    expect(getSearchProblems(db, tripId)).toEqual([]);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters());
    expect(getSearchProblems(db, tripId)).toEqual([]);
  });

  it("says which searches gave up, for what and why, once the trip is worked out anyway", async () => {
    const { tripId } = await enterScenario(db);
    const { adapter } = flakyFlights();
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ flights: adapter }));

    expect(db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).all()[0].status).toBe("ready");
    const problems = getSearchProblems(db, tripId);
    // Chloé and Jessy fly (Paris and Madrid) to each of the three destinations
    expect(problems.filter((p) => p.kind === "transport")).toHaveLength(6);
    expect(problems.every((p) => p.kind === "transport" && p.mode === "plane" && p.message === "Google Flights did not answer in time")).toBe(true);
    expect(problems.map((p) => (p.kind === "transport" ? `${p.from}→${p.to}` : ""))).toContain("Paris→Barcelona");
  });

  it("names a failed search for places to stay too", async () => {
    const { tripId } = await enterScenario(db);
    const broken: StayAdapter = { id: "broken", search: async () => Promise.reject(new ScrapeError("Airbnb is slow")) };
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ stays: broken }));
    expect(getSearchProblems(db, tripId).filter((p) => p.kind === "stays").map((p) => p.to).sort()).toEqual(["Barcelona", "Mont-Saxonnex", "Réunion"]);
  });
});

describe("searching again what failed", () => {
  it("searches only what failed, and the problem is gone once it works", async () => {
    const { tripId } = await enterScenario(db);
    const { state, adapter } = flakyFlights();
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ flights: adapter }));
    expect(getSearchProblems(db, tripId).length).toBeGreaterThan(0);

    const carSearchesBefore = db.select().from(schema.jobs).all().filter((j) => JSON.parse(j.payloadJson).mode === "car").length;
    state.works = true;
    startCompute(db, tripId, { retry: true });
    await runUntilIdle(db, fixtureAdapters({ flights: adapter }));

    expect(getSearchProblems(db, tripId)).toEqual([]);
    // What is searched again is asked of the site itself, not of what an earlier try left in the cache
    const retried = db.select().from(schema.jobs).all().filter((j) => j.type === "search_transport" && JSON.parse(j.payloadJson).mode === "plane" && JSON.parse(j.payloadJson).force === true);
    expect(retried.length).toBeGreaterThan(0);
    // The searches that had worked were not made again
    expect(db.select().from(schema.jobs).all().filter((j) => JSON.parse(j.payloadJson).mode === "car")).toHaveLength(carSearchesBefore);
    expect(db.select().from(schema.transportOptions).all().filter((o) => o.mode === "plane").length).toBeGreaterThan(0);
    expect(flightJobs().filter((j) => j.status === "done").length).toBeGreaterThan(0);
  });

  it("does not start another computation on a plain request, but does when asked to retry", async () => {
    const { tripId } = await enterScenario(db);
    const { adapter } = flakyFlights();
    const first = startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ flights: adapter }));
    expect(startCompute(db, tripId).jobId).toBe(first.jobId);
    expect(startCompute(db, tripId, { retry: true }).jobId).not.toBe(first.jobId);
  });
});

describe("searchNoticeOf", () => {
  it("is nothing when nothing failed", () => {
    expect(searchNoticeOf([])).toBeNull();
  });

  it("says what could not be searched, that this is not the same as there being nothing, and why", () => {
    const notice = searchNoticeOf([
      { kind: "transport", mode: "plane", from: "Toulouse", to: "Lisbon", message: "Google Flights did not answer in time" },
      { kind: "transport", mode: "plane", from: "Madrid", to: "Lisbon", message: null },
    ])!;
    expect(notice.title).toBe("2 searches did not work");
    expect(notice.text).toBe("Flights from Toulouse to Lisbon and flights from Madrid to Lisbon could not be searched, so what is shown for them may be missing: that is not the same as there being none.");
    expect(notice.detail).toBe("Google Flights did not answer in time");
    expect(notice.action).toBe("Search again");
  });

  it("speaks of one search in the singular, and of places to stay", () => {
    const notice = searchNoticeOf([{ kind: "stays", to: "Barcelona", message: null }])!;
    expect(notice.title).toBe("A search did not work");
    expect(notice.text).toContain("Places to stay in Barcelona could not be searched, so what is shown for it");
  });
});

describe("two sources of places to stay, one of which fails", () => {
  const hotels: StayAdapter = { id: "hotels", search: async () => Promise.reject(new ScrapeError("Google Hotels did not show its results in time")) };

  it("keeps what the other found, does not remove what the failed one had, and raises the failure", async () => {
    const { destinations } = await enterScenario(db);
    const stays = () => db.select().from(schema.stayOptions).all().filter((row) => row.destinationId === destinations.bcn.id);

    await searchStays(db, { destinationId: destinations.bcn.id }, [fixtureStaysAdapter]);
    const before = stays().map((row) => row.title).sort();
    expect(before.length).toBeGreaterThan(0);

    // Now one source answers and the other does not: the hotels found before are still there
    const apartmentsOnly: StayAdapter = { id: "apartments", search: async (q) => (await fixtureStaysAdapter.search(q)).filter((offer) => offer.provider === "airbnb") };
    await expect(searchStays(db, { destinationId: destinations.bcn.id }, [apartmentsOnly, hotels])).rejects.toThrow("did not show its results");
    expect(stays().map((row) => row.title).sort()).toEqual(before);
  });

  it("is reported like any failed search, once the queue has given up", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    const apartments: StayAdapter = { id: "apartments", search: async (q) => (await fixtureStaysAdapter.search(q)).filter((offer) => offer.provider === "airbnb") };
    await runUntilIdle(db, { ...fixtureAdapters(), stayAdapters: () => [apartments, hotels] });

    expect(getSearchProblems(db, tripId).filter((p) => p.kind === "stays")).toHaveLength(3);
    // The apartments were stored all the same
    expect(db.select().from(schema.stayOptions).all().length).toBeGreaterThan(0);
  });
});
