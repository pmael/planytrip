import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeUnavailableError, type AskFn } from "@/ai/claude";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { startCompute } from "@/server/services/compute";
import { getBudgetView, getDashboard } from "@/server/services/dashboard";
import { getDeliberationView } from "@/server/services/deliberation";
import { updateGuest } from "@/server/services/guests";
import { getRatingStatus, ratingRunOf, ratingsOfTrip } from "@/server/services/ratings";
import { transportRatingInputOf } from "@/server/services/ratingInputs";
import { getHousingView } from "@/server/services/stays";
import { getTransportView } from "@/server/services/transports";
import { enqueueJob } from "@/worker/queue";
import { counted, enterScenario, fixtureAdapters, forgetRatings, runUntilIdle } from "./helpers/compute";
import { createTestDb } from "./helpers/db";
import { failingAsk, fakeRatingAsk } from "./helpers/ratings";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

/**
 * A trip set up with the given AI (none: the rules rate). Without the reference facts of UC-D (helpers/compute.ts): they
 * are written after the computation, so the ratings, made with what the computation found, would look out of date.
 */
async function setUp(ask?: AskFn, adapters = fixtureAdapters()) {
  const scenario = await enterScenario(db);
  startCompute(db, scenario.tripId);
  await runUntilIdle(db, adapters, { ...(ask ? { ask } : {}), fixtureFacts: false });
  return scenario;
}

const runsOf = (tripId: string) => db.select().from(schema.ratingRuns).where(eq(schema.ratingRuns.tripId, tripId)).all();
const jobCount = () => db.select().from(schema.jobs).all().length;

describe("rating the options while the trip is set up", () => {
  it("has the AI rate the places to stay and the journeys of every destination, and keeps who did it", async () => {
    const ask = fakeRatingAsk();
    const { tripId } = await setUp(ask);

    const { stays, transport } = ratingsOfTrip(db, tripId);
    expect(stays.size).toBe(db.select().from(schema.stayOptions).all().length);
    expect(transport.size).toBe(db.select().from(schema.transportOptions).all().length);
    expect([...stays.values(), ...transport.values()].every((rating) => rating.source === "ai")).toBe(true);
    expect([...stays.values()][0].reason).toMatch(/^The AI rated S\d+$/);

    const runs = runsOf(tripId);
    expect(runs.every((run) => run.source === "ai" && run.message === null && run.inputHash.length === 24)).toBe(true);
    // One question per destination and kind of option, never one per option
    expect(ask).toHaveBeenCalledTimes(runs.length);
    expect(getRatingStatus(db, tripId)).toEqual({ byRules: [], stale: [] });
  });

  it("gives the AI's scores to the dashboard as they are, and the dashboard never asks again", async () => {
    const { tripId, destinations } = await setUp(fakeRatingAsk((code) => (code === "S1" ? { score: 91, verdict: "good" } : { score: 40, verdict: "ok" })));
    const before = jobCount();

    const budget = getBudgetView(db, tripId);
    expect(budget?.kind).toBe("ready");
    getDashboard(db, tripId);
    getDeliberationView(db, tripId);
    const housing = getHousingView(db, tripId, destinations.bcn.id);
    const transports = getTransportView(db, tripId, { destinationId: destinations.bcn.id });

    // Reading is all the dashboard does: no job, so no question to the AI
    expect(jobCount()).toBe(before);
    expect(housing?.kind === "ready" && housing.columns.flatMap((c) => c.stays).every((s) => s.ratedBy === "ai" && s.fitScore !== null)).toBe(true);
    expect(transports?.kind === "ready" && transports.columns.flatMap((c) => [c.cheapest, c.practical, ...c.more]).filter((c) => c !== null).every((c) => c.rating?.source === "ai")).toBe(true);
  });

  it("does not ask the AI again for what it has already rated for exactly these facts", async () => {
    const ask = fakeRatingAsk();
    const { tripId } = await setUp(ask);
    const asked = ask.mock.calls.length;

    for (const run of runsOf(tripId)) {
      enqueueJob(db, { tripId, type: run.kind === "stays" ? "rate_stays" : "rate_transport", payload: { destinationId: run.destinationId } });
    }
    await runUntilIdle(db, fixtureAdapters(), { ask, fixtureFacts: false });
    expect(ask).toHaveBeenCalledTimes(asked);
  });
});

describe("when the AI is not available: not rated by the AI, and the trip goes on", () => {
  it("rates with the rules at once when the AI is missing, and says why", async () => {
    const ask = failingAsk(new ClaudeUnavailableError("The `claude` command was not found"));
    const { tripId } = await setUp(ask);

    expect(db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).all()[0].status).toBe("ready");
    const { stays, transport } = ratingsOfTrip(db, tripId);
    expect([...stays.values(), ...transport.values()].every((rating) => rating.source === "rules" && rating.reason.startsWith("Rules only:"))).toBe(true);
    expect(runsOf(tripId).every((run) => run.source === "rules" && run.message === "The `claude` command was not found")).toBe(true);
    // No point asking again and again for a missing program: once per rating job
    expect(ask).toHaveBeenCalledTimes(runsOf(tripId).length);

    expect(getRatingStatus(db, tripId).byRules).toEqual(
      expect.arrayContaining([{ destination: "Barcelona", kind: "stays", message: "The `claude` command was not found" }]),
    );
    expect(getRatingStatus(db, tripId).stale).toEqual([]);
  });

  it("tries an answer that did not hold up again, then falls back to the rules on the last try", async () => {
    const ask = failingAsk(new Error("Claude did not answer within 120 s"));
    const { tripId } = await setUp(ask);

    // 1 try and 2 retries for each rating job
    expect(ask).toHaveBeenCalledTimes(runsOf(tripId).length * 3);
    expect(runsOf(tripId).every((run) => run.source === "rules" && run.message?.startsWith("The AI did not answer properly: Claude did not answer"))).toBe(true);
    expect(db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).all()[0].status).toBe("ready");
  });

  it("does not trust an answer that leaves candidates unrated: it is tried again, then the rules rate", async () => {
    const ask = fakeRatingAsk(() => ({}), { skipLast: true });
    const { destinations } = await setUp(ask);

    // Barcelona has two places to stay, so the answer is a candidate short; a destination with one cannot be
    expect(ratingRunOf(db, destinations.bcn.id, "stays")).toMatchObject({ source: "rules", message: expect.stringContaining("left 1 of 2 candidates unrated") });
    expect(ratingRunOf(db, destinations.run.id, "stays")).toMatchObject({ source: "ai", message: null });
  });

  it("offers the AI again when the person asks for a re-rating, and an AI that is back replaces the rules", async () => {
    const { tripId } = await setUp(failingAsk(new ClaudeUnavailableError("not logged in")));
    expect(getRatingStatus(db, tripId).byRules.length).toBeGreaterThan(0);

    const ask = fakeRatingAsk();
    startCompute(db, tripId, { rerate: true });
    await runUntilIdle(db, fixtureAdapters(), { ask, fixtureFacts: false });

    expect(ask).toHaveBeenCalled();
    expect(getRatingStatus(db, tripId)).toEqual({ byRules: [], stale: [] });
    expect([...ratingsOfTrip(db, tripId).stays.values()].every((rating) => rating.source === "ai")).toBe(true);
  });
});

describe("when a guest's budget changes: scores that may be out of date, never a silent call", () => {
  it("flags what the AI rated for the old budgets, without asking the AI anything", async () => {
    const ask = fakeRatingAsk();
    const { tripId, guests } = await setUp(ask);
    const asked = ask.mock.calls.length;
    const before = jobCount();

    await updateGuest(db, guests.jessy.id, { maxBudgetEur: 900 });
    const status = getRatingStatus(db, tripId);
    expect(status.byRules).toEqual([]);
    expect(status.stale).toEqual(expect.arrayContaining([{ destination: "Barcelona", kind: "stays" }, { destination: "Barcelona", kind: "transport" }]));

    // Showing the dashboard on top of that costs nothing either
    getBudgetView(db, tripId);
    getHousingView(db, tripId);
    expect(ask).toHaveBeenCalledTimes(asked);
    expect(jobCount()).toBe(before);
  });

  it("rates again on request, from what is stored: nothing is searched again", async () => {
    const flights = counted(fixtureAdapters().transportAdaptersFor("plane")[0]);
    const stays = counted(fixtureAdapters().stayAdapters()[0]);
    const adapters = fixtureAdapters({ flights, stays });
    const { tripId, guests } = await setUp(fakeRatingAsk(() => ({ score: 70 })), adapters);
    const searches = [flights.calls.mock.calls.length, stays.calls.mock.calls.length];

    await updateGuest(db, guests.jessy.id, { maxBudgetEur: 900 });
    const newAsk = fakeRatingAsk(() => ({ score: 55 }));
    startCompute(db, tripId, { rerate: true });
    await runUntilIdle(db, adapters, { ask: newAsk, fixtureFacts: false });

    expect(newAsk).toHaveBeenCalled();
    expect(searches.every((n) => n > 0)).toBe(true);
    expect([flights.calls.mock.calls.length, stays.calls.mock.calls.length]).toEqual(searches);
    expect(getRatingStatus(db, tripId)).toEqual({ byRules: [], stale: [] });
    expect([...ratingsOfTrip(db, tripId).stays.values()].every((rating) => rating.score === 55)).toBe(true);
  });

  it("asks the AI nothing on a re-rating when every score is current", async () => {
    const { tripId } = await setUp(fakeRatingAsk());
    const ask = fakeRatingAsk();
    startCompute(db, tripId, { rerate: true });
    await runUntilIdle(db, fixtureAdapters(), { ask, fixtureFacts: false });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("getRatingStatus", () => {
  it("has nothing to doubt for a trip that was never rated, or does not exist", async () => {
    const { tripId } = await setUp(fakeRatingAsk());
    forgetRatings(db);
    expect(getRatingStatus(db, tripId)).toEqual({ byRules: [], stale: [] });
    expect(getRatingStatus(db, "doesnotexist")).toEqual({ byRules: [], stale: [] });
  });

  it("keeps the pass that rated each kind of option at each destination", async () => {
    const { tripId, destinations } = await setUp(fakeRatingAsk());
    expect(ratingRunOf(db, destinations.bcn.id, "stays")).toMatchObject({ tripId, source: "ai" });
    expect(ratingRunOf(db, destinations.bcn.id, "transport")).toMatchObject({ tripId, source: "ai" });
  });
});

describe("the ratings on the Transports page", () => {
  it("shows each option's rating and who gave it", async () => {
    const { tripId, destinations, guests } = await setUp(fakeRatingAsk());
    const view = getTransportView(db, tripId, { destinationId: destinations.bcn.id, guestId: guests.chloe.id, mode: "plane" });
    if (view?.kind !== "ready") throw new Error("not ready");
    const [plane] = view.columns;
    expect(plane.cheapest?.rating).toMatchObject({ source: "ai", verdict: "good" });
    expect(plane.practical?.rating).toMatchObject({ source: "ai" });
  });

  it("offers an option rated bad last, after the red ones, and keeps it out of the two cards", async () => {
    const { tripId, destinations, guests } = await setUp(fakeRatingAsk());
    const read = () => {
      const view = getTransportView(db, tripId, { destinationId: destinations.bcn.id, guestId: guests.chloe.id, mode: "plane" });
      if (view?.kind !== "ready") throw new Error("not ready");
      return view.columns[0];
    };
    const before = read();
    const cheapestId = before.cheapest!.id;

    db.update(schema.optionRatings)
      .set({ verdict: "bad", score: 5, reason: "Leaves at 05:10 and lands after midnight" })
      .where(eq(schema.optionRatings.transportOptionId, cheapestId))
      .run();

    const after = read();
    expect(after.cheapest?.id).not.toBe(cheapestId);
    expect(after.practical?.id).not.toBe(cheapestId);
    const more = after.more.map((card) => card.id);
    expect(more).toContain(cheapestId);
    expect(more[more.length - 1]).toBe(cheapestId);
    expect(after.more.at(-1)?.rating).toMatchObject({ verdict: "bad", reason: "Leaves at 05:10 and lands after midnight" });
  });
});

describe("what the AI is told about each journey", () => {
  it("names the guests who would take it: those of its origin who accept its mode, with their own budgets", async () => {
    const { destinations } = await setUp();
    const input = transportRatingInputOf(db, destinations.bcn.id)!;
    const facts = input.facts.candidates as { mode: string; from: string; takenBy: string[]; shareOfThePoorestGuestsBudgetPercent: number; costEachEur: number }[];

    // Martin drives from Madrid, Jessy flies from there: the car is Martin's, the planes Jessy's
    expect(facts.filter((f) => f.from === "Madrid" && f.mode === "car").every((f) => f.takenBy.join() === "Martin")).toBe(true);
    expect(facts.filter((f) => f.from === "Madrid" && f.mode === "plane").every((f) => f.takenBy.join() === "Jessy")).toBe(true);
    expect(facts.filter((f) => f.from === "Paris").every((f) => f.takenBy.join() === "Chloé")).toBe(true);

    // The car is judged against Martin's 800 €, not against Jessy's 400 € who would never drive it
    const car = facts.find((f) => f.mode === "car")!;
    expect(car.shareOfThePoorestGuestsBudgetPercent).toBe(Math.round((car.costEachEur / 800) * 100));

    const origins = (input.facts as { origins: { from: string; guests: { name: string; acceptsModes: string[] }[] }[] }).origins;
    expect(origins.find((o) => o.from === "Madrid")!.guests.map((g) => [g.name, g.acceptsModes])).toEqual([["Martin", ["car"]], ["Jessy", ["plane"]]]);
  });

  it("is told the same to the rules that rate when the AI is not there: the car is not marked down against Jessy's budget", async () => {
    const { destinations } = await setUp();
    const input = transportRatingInputOf(db, destinations.bcn.id)!;
    const car = db.select().from(schema.transportOptions).all().find((o) => o.destinationId === destinations.bcn.id && o.mode === "car")!;
    const rule = input.rules.get(car.id)!;
    // 145 € is 18 % of Martin's 800 €; against Jessy's 400 € it would be 36 %
    expect(rule.reason).not.toContain("Jessy");
  });
});
