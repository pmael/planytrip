import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "@/server/errors";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import type { TransportAdapter } from "@/scrapers/types";
import { fixtureFlightsAdapter } from "@/scrapers/transport/fixture-flights";
import { addDestination, deleteDestination } from "@/server/services/destinations";
import { addGuest, setGuestModes } from "@/server/services/guests";
import { getProgress, startCompute } from "@/server/services/compute";
import { createTrip, getTrip, updateTrip } from "@/server/services/trips";
import { processNextJob } from "@/worker";
import { createHandlers } from "@/worker/handlers";
import { getJob } from "@/worker/queue";
import { createTestDb } from "./helpers/db";
import {
  barcelona,
  counted,
  enterScenario,
  fakeRoute,
  fixtureAdapters,
  madrid,
  readTrip,
  runUntilIdle,
} from "./helpers/compute";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

const statusOf = (tripId: string) => getTrip(db, tripId)!.status;
const jobsOf = (type: string) => db.select().from(schema.jobs).where(eq(schema.jobs.type, type as never)).all();

describe("startCompute", () => {
  it("queues a compute_trip job and puts the trip in computing", async () => {
    const { tripId } = await enterScenario(db);
    const { jobId } = startCompute(db, tripId);
    expect(getJob(db, jobId)).toMatchObject({ type: "compute_trip", status: "queued", tripId, payload: { force: false } });
    expect(statusOf(tripId)).toBe("computing");
  });

  it("answers 409 for each thing that is missing", async () => {
    const trip = createTrip(db);
    expect(() => startCompute(db, trip.id)).toThrow(ConflictError);
    expect(() => startCompute(db, trip.id)).toThrow(expect.objectContaining({ reason: "no_guests" }));

    await addGuest(db, trip.id, { name: "Martin", homePlace: madrid, maxBudgetEur: 800, availableFrom: "2027-08-26", availableTo: "2027-09-05", preferredMode: "car" });
    expect(() => startCompute(db, trip.id)).toThrow(expect.objectContaining({ reason: "no_destinations" }));

    await addDestination(db, trip.id, { place: barcelona, budgetLevel: "light", objective: "none" });
    await addGuest(db, trip.id, { name: "Late", homePlace: madrid, maxBudgetEur: 500, availableFrom: "2027-09-10", availableTo: "2027-09-14", preferredMode: "plane" });
    expect(() => startCompute(db, trip.id)).toThrow(expect.objectContaining({ reason: "no_common_dates", message: "No common dates between Late and Martin" }));
  });

  it("rejects an unknown trip", () => {
    expect(() => startCompute(db, "doesnotexist")).toThrow(NotFoundError);
  });

  it("does not start a second computation while one is under way", async () => {
    const { tripId } = await enterScenario(db);
    const first = startCompute(db, tripId);
    expect(startCompute(db, tripId)).toEqual(first);
    expect(startCompute(db, tripId, { force: true })).toEqual(first);
    expect(jobsOf("compute_trip")).toHaveLength(1);
  });
});

describe("computing the reference scenario (task.md T3.4)", () => {
  it("leaves the trip ready, with every option in the database", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    expect(statusOf(tripId)).toBe("computing");

    await runUntilIdle(db, fixtureAdapters());

    expect(statusOf(tripId)).toBe("ready");
    const { options, stays } = readTrip(db, tripId);
    // §1.3: 6 + 4 + 5 transport options (the car has none to La Réunion) and 4 stays
    expect(options).toHaveLength(15);
    expect(stays).toHaveLength(4);
    expect(jobsOf("compute_trip")[0].status).toBe("done");
  });

  it("finds what the tables of use-cases.md say, with the Extra (UC-D, D.3): Martin 1,023 € and 1,347.60 €, totals 2,697 €, 3,684.80 € and 6,292 €", async () => {
    const { tripId, destinations } = await enterScenario(db);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters());

    const { scenarioFor } = readTrip(db, tripId);
    const barcelonaCost = scenarioFor(destinations.bcn.id);
    const reunionCost = scenarioFor(destinations.run.id);
    const montCost = scenarioFor(destinations.ms.id);

    expect(barcelonaCost.guests.find((g) => g.name === "Martin")?.costEur).toBe(1023);
    expect(montCost.guests.find((g) => g.name === "Martin")?.costEur).toBeCloseTo(1347.6, 2);
    expect(barcelonaCost.totalEur).toBe(2697);
    expect(montCost.totalEur).toBeCloseTo(3684.8, 6);
    expect(reunionCost.totalEur).toBeCloseTo(6292, 6);
    expect(reunionCost.guests.find((g) => g.name === "Martin")).toMatchObject({ status: "unreachable", transport: { source: "fallback" } });
    // Jessy's food and tax alone take her past her 400 €
    expect(barcelonaCost.tier).toBe("over");
  });

  it("rates every option for comfort as it stores it", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters());

    const { options } = readTrip(db, tripId);
    expect(options.every((o) => o.comfortLevel !== null && o.comfortScore !== null)).toBe(true);
    const iberia = options.find((o) => o.provider === "iberia")!;
    const threeStops = options.find((o) => o.priceEur === 910)!;
    expect([iberia.comfortLevel, threeStops.comfortLevel]).toEqual(["green", "red"]);
  });

  it("searches only the modes someone accepts, and the plane for the guest who cannot drive", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    const flights = counted(fixtureFlightsAdapter);
    await runUntilIdle(db, fixtureAdapters({ flights }));

    // Plane from Madrid (Jessy, and Martin's fallback) and from Paris (Chloé) for each of 3 destinations
    expect(flights.calls).toHaveBeenCalledTimes(6);
    const tasks = jobsOf("search_transport").map((j) => JSON.parse(j.payloadJson));
    expect(tasks.filter((t) => t.mode === "car")).toHaveLength(2); // Barcelona and Mont-Saxonnex, not the island
    expect(tasks.some((t) => t.mode === "train" || t.mode === "bus")).toBe(false);
  });

  it("does not search for a mode that has no adapter, even when a guest accepts it", async () => {
    const { tripId, guests } = await enterScenario(db);
    await setGuestModes(db, guests.chloe.id, ["plane", "train"], fakeRoute);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters());
    expect(jobsOf("search_transport").map((j) => JSON.parse(j.payloadJson).mode)).not.toContain("train");
    expect(statusOf(tripId)).toBe("ready");
  });

  it("files each option under the guests' own departure place", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters());
    const origins = new Set(readTrip(db, tripId).options.map((o) => o.originKey));
    expect([...origins].sort()).toEqual(["madrid-spain", "paris-france"]);
  });
});

describe("computing again", () => {
  async function computed() {
    const scenario = await enterScenario(db);
    startCompute(db, scenario.tripId);
    await runUntilIdle(db, fixtureAdapters());
    return scenario;
  }

  it("leaves a ready trip alone: no new job, the same answer", async () => {
    const { tripId } = await computed();
    const first = jobsOf("compute_trip")[0].id;
    expect(startCompute(db, tripId)).toEqual({ jobId: first });
    expect(jobsOf("compute_trip")).toHaveLength(1);
    expect(statusOf(tripId)).toBe("ready");
  });

  it("with force searches everything again, but keeps the options that are still on offer", async () => {
    const { tripId } = await computed();
    const before = readTrip(db, tripId).options.map((o) => o.id).sort();

    startCompute(db, tripId, { force: true });
    expect(statusOf(tripId)).toBe("computing");
    const flights = counted(fixtureFlightsAdapter);
    await runUntilIdle(db, fixtureAdapters({ flights }));

    expect(flights.calls).toHaveBeenCalledTimes(6);
    expect(readTrip(db, tripId).options.map((o) => o.id).sort()).toEqual(before);
    expect(statusOf(tripId)).toBe("ready");
  });

  it("keeps a ❤ on an option that is still on offer when everything is searched again", async () => {
    const { tripId, destinations, guests } = await computed();
    const tolls = readTrip(db, tripId).options.find((o) => o.destinationId === destinations.bcn.id && o.variant === "tolls")!;
    db.insert(schema.selections).values({
      tripId, destinationId: destinations.bcn.id, kind: "transport", guestId: guests.martin.id, transportOptionId: tolls.id,
    }).run();

    startCompute(db, tripId, { force: true });
    await runUntilIdle(db, fixtureAdapters());
    expect(db.select().from(schema.selections).all()).toHaveLength(1);
  });

  it("searches only what is new when a destination is added", async () => {
    const { tripId } = await computed();
    await addDestination(db, tripId, { place: { ...barcelona, label: "Girona, Spain", airports: ["GRO"] }, budgetLevel: "light", objective: "none" });
    db.update(schema.trips).set({ status: "draft" }).where(eq(schema.trips.id, tripId)).run();

    startCompute(db, tripId);
    const flights = counted(fixtureFlightsAdapter);
    await runUntilIdle(db, fixtureAdapters({ flights }));
    // Girona is unknown to the fake adapters: 2 searches (Madrid and Paris), none for the others
    expect(flights.calls).toHaveBeenCalledTimes(2);
    expect(statusOf(tripId)).toBe("ready");
  });

  it("removes an option that is no longer offered", async () => {
    const { tripId, destinations } = await computed();
    const none: TransportAdapter = { id: "empty", modes: ["plane"], search: async () => [] };
    startCompute(db, tripId, { force: true });
    await runUntilIdle(db, fixtureAdapters({ flights: none }));
    const planes = readTrip(db, tripId).options.filter((o) => o.mode === "plane" && o.destinationId === destinations.bcn.id);
    expect(planes).toEqual([]);
  });
});

describe("the trip's days", () => {
  it("shortens the searched stay to the trip's nights", async () => {
    const { tripId, destinations } = await enterScenario(db);
    updateTrip(db, tripId, { nights: 5 });
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters());

    const { stays, options } = readTrip(db, tripId);
    const apartment = stays.find((s) => s.destinationId === destinations.bcn.id && s.provider === "airbnb")!;
    expect(apartment).toMatchObject({ checkIn: "2027-08-26", checkOut: "2027-08-31", totalPriceEur: 450 });
    const iberia = options.find((o) => o.provider === "iberia")!;
    expect(iberia.backDepartAt).toBe("2027-08-31T16:00");
  });

  it("skips a destination whose own dates leave no day for the whole group", async () => {
    const { tripId, destinations } = await enterScenario(db);
    db.update(schema.destinations).set({ dateFrom: "2028-01-01", dateTo: "2028-01-10" }).where(eq(schema.destinations.id, destinations.bcn.id)).run();
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters());
    const { options, stays } = readTrip(db, tripId);
    expect(options.some((o) => o.destinationId === destinations.bcn.id)).toBe(false);
    expect(stays.some((s) => s.destinationId === destinations.bcn.id)).toBe(false);
    expect(statusOf(tripId)).toBe("ready");
  });

  it("does nothing for a destination removed while its search waited", async () => {
    const { tripId, destinations } = await enterScenario(db);
    startCompute(db, tripId);
    // Plan, then remove a destination before its searches run
    const handlers = createHandlers({ route: fakeRoute, adapters: fixtureAdapters(), waitMs: 1 });
    await processNextJob(db, handlers); // the compute job's first stage
    deleteDestination(db, destinations.ms.id);
    await runUntilIdle(db, fixtureAdapters());
    expect(statusOf(tripId)).toBe("ready");
    expect(readTrip(db, tripId).options.some((o) => o.destinationId === destinations.ms.id)).toBe(false);
  });
});

describe("when searches fail", () => {
  const broken: TransportAdapter = {
    id: "broken", modes: ["plane"],
    search: vi.fn(async () => {
      throw new Error("the flight site is down");
    }),
  };

  it("retries a failing search, and finishes with the rest when it never works (partial results)", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ flights: broken }));

    const flights = jobsOf("search_transport").filter((j) => JSON.parse(j.payloadJson).mode === "plane");
    expect(flights.every((j) => j.status === "failed" && j.attempts === 3)).toBe(true);
    // The cars and the stays were found, so the trip is usable
    expect(statusOf(tripId)).toBe("ready");
    expect(readTrip(db, tripId).options.every((o) => o.mode === "car")).toBe(true);
  });

  it("shows which step failed", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ flights: broken }));
    const steps = Object.fromEntries(getProgress(db, tripId).steps.map((s) => [s.id, s.state]));
    expect(steps).toEqual({ routes: "done", "transport:plane": "failed", "transport:car": "done", stays: "done", prices: "done", "rate:stays": "done", "rate:transport": "done", advice: "done" });
  });

  it("gives the reason a step failed, so the screen can say more than \"failed\"", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ flights: broken }));
    const plane = getProgress(db, tripId).steps.find((s) => s.id === "transport:plane")!;
    expect(plane.state).toBe("failed");
    expect(plane.error).toBeTruthy();
  });

  it("recovers when a search works on a retry", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    let calls = 0;
    const flaky: TransportAdapter = {
      id: "flaky", modes: ["plane"],
      search: async (q) => {
        if (++calls <= 2) throw new Error("hiccup");
        return fixtureFlightsAdapter.search(q);
      },
    };
    await runUntilIdle(db, fixtureAdapters({ flights: flaky }));
    expect(statusOf(tripId)).toBe("ready");
    expect(jobsOf("search_transport").filter((j) => j.status === "failed")).toHaveLength(0);
  });

  it("gives the trip back as a draft, and fails, when nothing at all was found", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    const none: TransportAdapter = { id: "none", modes: ["plane", "car"], search: async () => [] };
    await runUntilIdle(db, fixtureAdapters({ flights: none, car: none }));

    expect(statusOf(tripId)).toBe("draft");
    const progress = getProgress(db, tripId);
    expect(jobsOf("compute_trip")[0]).toMatchObject({ status: "failed" });
    expect(progress.error).toMatch(/No way of getting/);
  });

  it("can be started again after it failed", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    const none: TransportAdapter = { id: "none", modes: ["plane", "car"], search: async () => [] };
    await runUntilIdle(db, fixtureAdapters({ flights: none, car: none }));
    expect(statusOf(tripId)).toBe("draft");

    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters());
    expect(statusOf(tripId)).toBe("ready");
  });
});

describe("getProgress", () => {
  it("has no steps before anything was started", async () => {
    const { tripId } = await enterScenario(db);
    expect(getProgress(db, tripId)).toEqual({ status: "draft", steps: [], error: null, notices: [], secondsLeft: null });
  });

  it("rejects an unknown trip", () => {
    expect(() => getProgress(db, "doesnotexist")).toThrow(NotFoundError);
  });

  it("is pending right after the start", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    expect(getProgress(db, tripId)).toMatchObject({ status: "computing", steps: [{ id: "routes", state: "pending", done: 0, total: 0 }] });
  });

  it("lists the routes, each mode's searches, the stays and their ratings once everything is done", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters());
    const progress = getProgress(db, tripId);
    expect(progress).toMatchObject({ status: "ready", error: null });
    // Without the times they took, which are not the same from one run to the next
    expect(progress.steps.map(({ id, label, done, total, state }) => ({ id, label, done, total, state }))).toEqual([
      { id: "routes", label: "Checking routes", done: 6, total: 6, state: "done" },
      { id: "transport:car", label: "Searching car routes", done: 2, total: 2, state: "done" },
      { id: "transport:plane", label: "Searching flights", done: 6, total: 6, state: "done" },
      { id: "stays", label: "Looking for places to stay", done: 3, total: 3, state: "done" },
      { id: "prices", label: "Finding local prices and things to do", done: 3, total: 3, state: "done" },
      { id: "rate:stays", label: "Rating the places to stay", done: 3, total: 3, state: "done" },
      { id: "rate:transport", label: "Rating the journeys", done: 3, total: 3, state: "done" },
      { id: "advice", label: "Writing the advice on the Extra", done: 3, total: 3, state: "done" },
    ]);
  });

  it("says when the AI could not rate and the rules did, with the reason, so the scores are not taken for the AI's", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    // What the computation itself kept, without the reference facts written over its prices
    await runUntilIdle(db, fixtureAdapters(), { fixtureFacts: false });
    expect(getProgress(db, tripId).notices).toEqual([
      "Not rated by the AI: the places to stay were scored with simple rules (No AI was provided in this test).",
      "Not rated by the AI: the journeys were scored with simple rules (No AI was provided in this test).",
      "Local prices by the rules, not the AI, for Barcelona, Mont-Saxonnex, Réunion: country averages (No AI was provided in this test).",
      "Advice on the Extra by the rules, not the AI (No AI was provided in this test).",
    ]);
  });

  it("shows a computation under way: the routes are done and the searches wait", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    await processNextJob(db, createHandlers({ route: fakeRoute, adapters: fixtureAdapters(), waitMs: 60_000 }));

    const steps = getProgress(db, tripId).steps;
    expect(steps.find((s) => s.id === "routes")).toMatchObject({ state: "done", done: 6, total: 6 });
    expect(steps.find((s) => s.id === "transport:plane")).toMatchObject({ state: "pending", done: 0, total: 6 });
    expect(steps.find((s) => s.id === "stays")).toMatchObject({ state: "pending", done: 0, total: 3 });
  });
});

describe("the state of a step, from its searches", () => {
  type Status = "queued" | "running" | "done" | "failed";

  /** A computation whose flight searches are in the given states ([status, attempts]). */
  async function stepWith(searches: [Status, number?][]) {
    const { tripId, destinations } = await enterScenario(db);
    const compute = db.insert(schema.jobs).values({ tripId, type: "compute_trip", status: "running", payloadJson: "{}" }).returning().all()[0];
    for (const [status, attempts = 0] of searches) {
      db.insert(schema.jobs).values({
        tripId, type: "search_transport", status, attempts,
        payloadJson: JSON.stringify({ parent: compute.id, destinationId: destinations.bcn.id, originKey: "madrid-spain", mode: "plane" }),
      }).run();
    }
    return getProgress(db, tripId).steps.find((s) => s.id === "transport:plane")!;
  }

  it.each([
    ["nothing has started", [["queued"], ["queued"]], "pending", 0],
    ["one is being worked on", [["running", 1], ["queued"]], "running", 0],
    ["one is waiting to be tried again", [["queued", 1], ["queued"]], "running", 0],
    ["some are done and the others have not started", [["done", 1], ["done", 1], ["queued"]], "running", 2],
    ["some are done and one gave up while another is still to run", [["done", 1], ["failed", 3], ["queued"]], "running", 1],
    ["all are done", [["done", 1], ["done", 1]], "done", 2],
    ["one gave up and none is left to run", [["done", 1], ["failed", 3]], "failed", 1],
    ["all gave up", [["failed", 3], ["failed", 3]], "failed", 0],
  ] as [string, [Status, number?][], string, number][])("is %s → %s", async (_what, searches, state, done) => {
    expect(await stepWith(searches)).toMatchObject({ state, done, total: searches.length });
  });
});

describe("the worker's waiting", () => {
  it("does not use up retries while the computation waits", async () => {
    const { tripId } = await enterScenario(db);
    const { jobId } = startCompute(db, tripId);
    const handlers = createHandlers({ route: fakeRoute, adapters: fixtureAdapters(), waitMs: 0 });
    for (let i = 0; i < 5; i++) await processNextJob(db, handlers); // plans, then waits for searches that are not run
    expect(getJob(db, jobId)).toMatchObject({ status: "queued", attempts: 0 });
  });
});
