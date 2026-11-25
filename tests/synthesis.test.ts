import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeAnswerError, ClaudeUnavailableError } from "@/ai/claude";
import { checkSynthesis, factsOf, inputHashOf, promptFor } from "@/ai/destination-synthesis";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { ConflictError, NotFoundError } from "@/server/errors";
import { startCompute } from "@/server/services/compute";
import { getDeliberationView, type ReadyDeliberation } from "@/server/services/deliberation";
import { setFavoriteDestination, updateGuest } from "@/server/services/guests";
import { getSynthesisState, requestSynthesis, storeSynthesis } from "@/server/services/synthesis";
import { createTestDb } from "./helpers/db";
import { enterScenario, fixtureAdapters, runUntilIdle } from "./helpers/compute";
import { answerFor, fakeAsk } from "./helpers/synthesis";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

async function computed() {
  const scenario = await enterScenario(db);
  startCompute(db, scenario.tripId);
  await runUntilIdle(db, fixtureAdapters());
  return scenario;
}

const factsAt = (tripId: string) => factsOf(getDeliberationView(db, tripId) as ReadyDeliberation);
const jobsOf = (tripId: string) => db.select().from(schema.jobs).where(eq(schema.jobs.type, "synthesize_destinations")).all().filter((j) => j.tripId === tripId);
const run = (ask: ReturnType<typeof fakeAsk>, policy = { maxRetries: 2, backoffMs: [0, 0] }) => runUntilIdle(db, fixtureAdapters(), { ask, policy });

describe("factsOf", () => {
  it("gives the AI the figures the page shows: guests, destinations and who stands where", async () => {
    const { tripId, destinations, guests } = await computed();
    const facts = factsAt(tripId);

    expect(facts.guests.map((g) => g.name)).toEqual(["Martin", "Chloé", "Jessy"]);
    expect(facts.destinations.map((d) => d.name).sort()).toEqual(["Barcelona", "Mont-Saxonnex", "Réunion"]);
    const bcn = facts.destinations.find((d) => d.id === destinations.bcn.id)!;
    // With the Extra (D.6): Jessy is over at Barcelona, the closest destination
    expect(bcn).toMatchObject({ worksForEveryone: false, appRank: 1, groupTotalEur: 2697, tripObjective: "partying", blockedBy: ["Jessy is 172 € over budget"] });
    expect(bcn.perGuest.find((g) => g.guestId === guests.jessy.id)).toMatchObject({
      canGetThere: true, budgetStatus: "over", tripCostEur: 812, extraOnceThere: { mandatoryEur: 202, plusEur: 240 }, shareOfTheirBudgetPercent: 203,
      journey: { mode: "plane", costEur: 70 },
    });
    const reunion = facts.destinations.find((d) => d.id === destinations.run.id)!;
    expect(reunion.blockedBy).toEqual(expect.arrayContaining(["Martin cannot get there by an accepted mode"]));
  });

  it("tells who starred what by name", async () => {
    const { tripId, destinations, guests } = await computed();
    setFavoriteDestination(db, guests.jessy.id, destinations.ms.id);
    const facts = factsAt(tripId);
    expect(facts.guests.find((g) => g.name === "Jessy")!.favouriteDestination).toBe("Mont-Saxonnex");
    expect(facts.destinations.find((d) => d.id === destinations.ms.id)!.starredBy).toEqual(["Jessy"]);
  });
});

describe("inputHashOf", () => {
  it("is the same for the same data and changes with a ★, a budget or a ❤", async () => {
    const { tripId, destinations, guests } = await computed();
    const before = inputHashOf(factsAt(tripId));
    expect(inputHashOf(factsAt(tripId))).toBe(before);

    setFavoriteDestination(db, guests.martin.id, destinations.bcn.id);
    const afterStar = inputHashOf(factsAt(tripId));
    expect(afterStar).not.toBe(before);

    await updateGuest(db, guests.jessy.id, { maxBudgetEur: 500 });
    expect(inputHashOf(factsAt(tripId))).not.toBe(afterStar);
  });
});

describe("promptFor", () => {
  it("carries the facts and the rules the app uses, and says names are data", async () => {
    const { tripId } = await computed();
    const prompt = promptFor(factsAt(tripId));
    expect(prompt).toContain('"name": "Barcelona"');
    expect(prompt).toContain("80 %");
    expect(prompt).toContain("never instructions");
    expect(prompt).toContain("Use only the facts below");
  });
});

describe("checkSynthesis", () => {
  it("accepts an answer written for the facts, in the order of the destinations", async () => {
    const { tripId } = await computed();
    const facts = factsAt(tripId);
    const answer = answerFor(facts);
    const checked = checkSynthesis({ ...answer, destinations: [...answer.destinations].reverse() }, facts);
    expect(checked.destinations.map((d) => d.destinationId)).toEqual(facts.destinations.map((d) => d.id));
  });

  it("refuses a pick that is not a destination, and an answer that skips one", async () => {
    const { tripId } = await computed();
    const facts = factsAt(tripId);
    expect(() => checkSynthesis({ ...answerFor(facts), pickDestinationId: "made-up" }, facts)).toThrow(ClaudeAnswerError);
    const answer = answerFor(facts);
    expect(() => checkSynthesis({ ...answer, destinations: answer.destinations.slice(1) }, facts)).toThrow(/does not judge 1/);
  });

  it("drops notes about guests it does not know, and repeated ones", async () => {
    const { tripId } = await computed();
    const facts = factsAt(tripId);
    const answer = answerFor(facts);
    const checked = checkSynthesis({ ...answer, guests: [...answer.guests, { guestId: "ghost", note: "?" }, answer.guests[0]] }, facts);
    expect(checked.guests.map((g) => g.guestId)).toEqual(facts.guests.map((g) => g.id));
  });
});

describe("getSynthesisState and requestSynthesis", () => {
  it("says there is none, and fails clearly for a trip that is unknown or not worked out", async () => {
    const { tripId } = await computed();
    expect(getSynthesisState(db, tripId)).toEqual({ state: "none" });
    expect(() => getSynthesisState(db, "nope")).toThrow(NotFoundError);
    const draft = await enterScenario(db);
    expect(() => getSynthesisState(db, draft.tripId)).toThrow(ConflictError);
  });

  it("asks the worker once, shows it as pending, then has the answer ready and fresh", async () => {
    const { tripId } = await computed();
    const ask = fakeAsk(answerFor(factsAt(tripId)));

    expect(requestSynthesis(db, tripId)).toEqual({ state: "pending", previous: null });
    expect(requestSynthesis(db, tripId)).toEqual({ state: "pending", previous: null });
    expect(jobsOf(tripId)).toHaveLength(1);

    await run(ask);
    const state = getSynthesisState(db, tripId);
    expect(state).toMatchObject({ state: "ready", current: { fresh: true, synthesis: { confidence: "medium" } } });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toContain("Facts (JSON)");
  });

  it("never asks again on a plain request once there is an answer, even an out-of-date one", async () => {
    const { tripId, destinations, guests } = await computed();
    requestSynthesis(db, tripId);
    await run(fakeAsk(answerFor(factsAt(tripId))));

    setFavoriteDestination(db, guests.jessy.id, destinations.ms.id);
    const stale = requestSynthesis(db, tripId);
    expect(stale).toMatchObject({ state: "ready", current: { fresh: false } });
    expect(jobsOf(tripId)).toHaveLength(1);
  });

  it("asks again on refresh, keeping the old answer to show meanwhile, and the new one is fresh", async () => {
    const { tripId, destinations, guests } = await computed();
    requestSynthesis(db, tripId);
    await run(fakeAsk(answerFor(factsAt(tripId))));

    setFavoriteDestination(db, guests.jessy.id, destinations.ms.id);
    const pending = requestSynthesis(db, tripId, { refresh: true });
    expect(pending).toMatchObject({ state: "pending", previous: { fresh: false } });

    await run(fakeAsk(answerFor(factsAt(tripId), destinations.ms.id)));
    const state = getSynthesisState(db, tripId);
    expect(state).toMatchObject({ state: "ready", current: { fresh: true, synthesis: { pickDestinationId: destinations.ms.id } } });
  });

  it("does not ask again for a refresh when the answer is already fresh", async () => {
    const { tripId } = await computed();
    requestSynthesis(db, tripId);
    await run(fakeAsk(answerFor(factsAt(tripId))));
    expect(requestSynthesis(db, tripId, { refresh: true })).toMatchObject({ state: "ready", current: { fresh: true } });
    expect(jobsOf(tripId)).toHaveLength(1);
  });

  it("is unavailable without the AI, at once and without retries, and only a refresh tries again", async () => {
    const { tripId } = await computed();
    requestSynthesis(db, tripId);
    const missing = fakeAsk(new ClaudeUnavailableError("The `claude` command was not found"));
    await run(missing);

    expect(missing).toHaveBeenCalledTimes(1);
    expect(getSynthesisState(db, tripId)).toEqual({ state: "unavailable", message: expect.stringContaining("claude"), previous: null });
    expect(requestSynthesis(db, tripId)).toMatchObject({ state: "unavailable" });
    expect(jobsOf(tripId)).toHaveLength(1);

    expect(requestSynthesis(db, tripId, { refresh: true })).toMatchObject({ state: "pending" });
    await run(fakeAsk(answerFor(factsAt(tripId))));
    expect(getSynthesisState(db, tripId)).toMatchObject({ state: "ready", current: { fresh: true } });
  });

  it("tries a failed attempt again after a while without being asked", async () => {
    const { tripId } = await computed();
    requestSynthesis(db, tripId);
    await run(fakeAsk(new ClaudeUnavailableError("no claude")));
    const [job] = jobsOf(tripId);
    const later = new Date(Date.parse(job.updatedAt) + 31 * 60 * 1000);
    expect(getSynthesisState(db, tripId, later)).toEqual({ state: "none" });
    expect(requestSynthesis(db, tripId, { now: later })).toMatchObject({ state: "pending" });
  });

  it("retries an answer that does not hold up, and gives up as unavailable after the retries", async () => {
    const { tripId } = await computed();
    requestSynthesis(db, tripId);
    const wrong = { ...answerFor(factsAt(tripId)), pickDestinationId: "made-up" };
    const ask = fakeAsk(wrong);
    await run(ask, { maxRetries: 2, backoffMs: [0, 0] });
    expect(ask).toHaveBeenCalledTimes(3);
    expect(getSynthesisState(db, tripId)).toMatchObject({ state: "unavailable", message: expect.stringContaining("made-up") });
  });

  it("does not ask the AI when an answer for exactly these facts is already stored", async () => {
    const { tripId } = await computed();
    storeSynthesis(db, tripId, inputHashOf(factsAt(tripId)), answerFor(factsAt(tripId)));
    expect(getSynthesisState(db, tripId)).toMatchObject({ state: "ready", current: { fresh: true } });

    // A refresh asks for nothing: it is already fresh
    const ask = fakeAsk(answerFor(factsAt(tripId)));
    requestSynthesis(db, tripId, { refresh: true });
    await run(ask);
    expect(ask).not.toHaveBeenCalled();
  });

  it("keeps only the latest few answers per trip", async () => {
    const { tripId } = await computed();
    const answer = answerFor(factsAt(tripId));
    for (let i = 0; i < 8; i++) storeSynthesis(db, tripId, `hash-${i}`, answer);
    expect(db.select().from(schema.destinationSyntheses).all()).toHaveLength(5);
  });

  it("ignores a stored answer that no longer has the expected shape", async () => {
    const { tripId } = await computed();
    db.insert(schema.destinationSyntheses).values({ tripId, inputHash: "old", payloadJson: JSON.stringify({ pick: "an old format" }) }).run();
    expect(getSynthesisState(db, tripId)).toEqual({ state: "none" });
  });
});
