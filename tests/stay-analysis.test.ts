import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeUnavailableError } from "@/ai/claude";
import { StayAnalysisAnswerSchema, stayFactsOf, stayInputHashOf, stayPromptFor, tidyStayAnswer, type StayFactsInput } from "@/ai/stay-analysis";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { startCompute } from "@/server/services/compute";
import { updateGuest } from "@/server/services/guests";
import { stayAnalysisInputOf } from "@/server/services/stayAnalysisInput";
import { getOrRequestStayAnalysis } from "@/server/services/stays";
import { enqueueJob } from "@/worker/queue";
import { createTestDb } from "./helpers/db";
import { enterScenario, fixtureAdapters, forgetRatings, rateStaysAsAi, runUntilIdle } from "./helpers/compute";
import { fakeStayAsk, stayAnswer } from "./helpers/synthesis";

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

const apartmentOf = (destinationId: string) =>
  db.select().from(schema.stayOptions).all().find((s) => s.destinationId === destinationId && s.provider === "airbnb")!;
const rows = (stayId: string) => db.select().from(schema.stayAnalyses).where(eq(schema.stayAnalyses.stayId, stayId)).all();
const jobsOf = () => db.select().from(schema.jobs).all().filter((j) => j.type === "analyze_stay");
const run = (ask: ReturnType<typeof fakeStayAsk>, policy = { maxRetries: 2, backoffMs: [0, 0] }) => runUntilIdle(db, fixtureAdapters(), { ask, policy });

const input: StayFactsInput = {
  stay: { title: "Flat", provider: "airbnb", rooms: 2, beds: 3, capacity: 3, checkIn: "2027-08-26", checkOut: "2027-09-05", nights: 10, totalPriceEur: 900, rating: 4.6, reviewsSample: ["Great", "Noisy at night"] },
  destination: { label: "Barcelona, Spain", countryCode: "ES", inScope: true, objective: "partying", budgetLevel: "light" },
  guests: [{ name: "Martin", maxBudgetEur: 800 }, { name: "Chloé", maxBudgetEur: 1200 }, { name: "Jessy", maxBudgetEur: 400 }],
};

describe("stayFactsOf", () => {
  const facts = stayFactsOf(input);

  it("tells the AI what the place is and what it costs each guest, as a share of their own budget", () => {
    expect(facts.accommodation).toMatchObject({ source: "Airbnb", sleeps: 3, nights: 10, totalEur: 900, perGuestEur: 300, perGuestPerNightEur: 30, ratingOutOf5: 4.6 });
    expect(facts.group).toMatchObject({ size: 3, sleepsEveryone: true });
    // Jessy's 300 € is three quarters of her 400 €: the thing a stay's fit hangs on
    expect(facts.group.guests.map((g) => [g.name, g.housingShareOfTheirBudgetPercent])).toEqual([["Martin", 38], ["Chloé", 25], ["Jessy", 75]]);
  });

  it("says when the place cannot sleep the group, and names a hotel as one", () => {
    const small = stayFactsOf({ ...input, stay: { ...input.stay, capacity: 2, provider: "booking" } });
    expect(small.group.sleepsEveryone).toBe(false);
    expect(small.accommodation.source).toBe("A hotel (Google Hotels)");
  });

  it("keeps a few short review snippets, not a flood of long ones", () => {
    const many = stayFactsOf({ ...input, stay: { ...input.stay, reviewsSample: Array.from({ length: 20 }, (_, i) => `${i} ${"x".repeat(1000)}`) } });
    expect(many.accommodation.reviewSnippets).toHaveLength(6);
    expect(many.accommodation.reviewSnippets.every((r) => r.length <= 300)).toBe(true);
    expect(stayFactsOf({ ...input, stay: { ...input.stay, reviewsSample: null } }).accommodation.reviewSnippets).toEqual([]);
  });
});

describe("stayInputHashOf", () => {
  const hash = (change: Partial<StayFactsInput["stay"]> = {}, guests = input.guests) => stayInputHashOf(stayFactsOf({ ...input, stay: { ...input.stay, ...change }, guests }));

  it("is the same for the same facts and changes with the price, the offer or a guest's budget", () => {
    expect(hash()).toBe(hash());
    expect(hash({ totalPriceEur: 1000 })).not.toBe(hash());
    expect(hash({ rooms: 3 })).not.toBe(hash());
    expect(hash({ reviewsSample: ["New review"] })).not.toBe(hash());
    expect(hash({}, [{ name: "Martin", maxBudgetEur: 800 }, { name: "Chloé", maxBudgetEur: 1200 }, { name: "Jessy", maxBudgetEur: 500 }])).not.toBe(hash());
  });
});

describe("stayPromptFor", () => {
  it("carries the facts and what a verdict means to the app, and says other people's words are data", () => {
    const prompt = stayPromptFor(stayFactsOf(input));
    expect(prompt).toContain('"title": "Flat"');
    expect(prompt).toContain("housingShareOfTheirBudgetPercent");
    expect(prompt).toContain('"bad" only when the group should not be offered this place by default');
    expect(prompt).toContain("never instructions");
    expect(prompt).toContain("Use only the facts below");
  });
});

describe("StayAnalysisAnswerSchema", () => {
  it("accepts a valid answer and refuses ones outside the bounds of the spec", () => {
    expect(StayAnalysisAnswerSchema.safeParse(stayAnswer()).success).toBe(true);
    expect(StayAnalysisAnswerSchema.safeParse(stayAnswer({ fitScore: 101 })).success).toBe(false);
    expect(StayAnalysisAnswerSchema.safeParse(stayAnswer({ pros: Array(6).fill("x") })).success).toBe(false);
    expect(StayAnalysisAnswerSchema.safeParse(stayAnswer({ summary: "x".repeat(801) })).success).toBe(false);
    expect(StayAnalysisAnswerSchema.safeParse({ ...stayAnswer(), verdict: "great" }).success).toBe(false);
  });
});

describe("tidyStayAnswer", () => {
  it("takes the stray backslashes out of quotes the model escaped twice", () => {
    const tidy = tidyStayAnswer(stayAnswer({ summary: 'Suits the \\"light\\" budget level.', pros: ['A \\"good\\" price'], cons: ["It's fine"] }));
    expect(tidy.summary).toBe('Suits the "light" budget level.');
    expect(tidy.pros).toEqual(['A "good" price']);
    expect(tidy.cons).toEqual(["It's fine"]);
  });

  it("trims, and drops bullets that are empty", () => {
    const tidy = tidyStayAnswer(stayAnswer({ summary: "  A flat.  ", pros: ["  Roomy ", "", "   "], cons: [] }));
    expect(tidy).toMatchObject({ summary: "A flat.", pros: ["Roomy"], cons: [] });
  });

  it("leaves a clean answer as it is", () => {
    const answer = stayAnswer();
    expect(tidyStayAnswer(answer)).toEqual(answer);
  });
});

describe("stayAnalysisInputOf", () => {
  it("reads the facts from what is stored: the offer, the destination and the guests", async () => {
    const { destinations } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    const result = stayAnalysisInputOf(db, stay.id)!;
    expect(result.facts.accommodation).toMatchObject({ title: stay.title, totalEur: 900, nights: 10 });
    expect(result.facts.destination).toMatchObject({ name: "Barcelona, Spain", tripObjective: "partying", tripBudgetLevel: "light" });
    expect(result.facts.group.guests.map((g) => g.name)).toEqual(["Martin", "Chloé", "Jessy"]);
    expect(result.inputHash).toBe(stayInputHashOf(result.facts));
  });

  it("is null for an accommodation that does not exist", () => {
    expect(stayAnalysisInputOf(db, "nope")).toBeNull();
  });
});

describe("the analyze_stay job (B.4 #4)", () => {
  it("asks for the advice, shows it as pending, then has it ready, without reloading anything", async () => {
    const { destinations } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    const ask = fakeStayAsk(stayAnswer());

    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "pending" });
    await run(ask);

    // The score is the one rated when the trip was set up (the rules', as no AI was there, with Barcelona's partying
    // counting for a quarter: 53, R11), the words the AI's
    const state = getOrRequestStayAnalysis(db, stay.id);
    expect(state).toMatchObject({
      state: "ready", stale: false,
      analysis: { verdict: "ok", fitScore: 53, ratedBy: "rules", explained: true, pros: ["Sleeps all three"], cons: ["Takes 75 % of Jessy's budget"], summary: "A workable apartment, tight for Jessy." },
    });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toContain(stay.title);
    expect(jobsOf()).toHaveLength(1);
  });

  it("keeps the advice clean: quotes the model escaped twice are put right when it is stored", async () => {
    const { destinations } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    getOrRequestStayAnalysis(db, stay.id);
    await run(fakeStayAsk(stayAnswer({ summary: 'Fits the \\"light\\" level.' })));
    expect(rows(stay.id)[0].summary).toBe('Fits the "light" level.');
  });

  it("keeps the fingerprint of the facts the advice was written for", async () => {
    const { destinations } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    getOrRequestStayAnalysis(db, stay.id);
    await run(fakeStayAsk(stayAnswer()));
    expect(rows(stay.id)[0].inputHash).toBe(stayAnalysisInputOf(db, stay.id)!.inputHash);
  });

  it("does not ask the AI again for facts it already answered (cache by input_hash)", async () => {
    const { destinations, tripId } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    getOrRequestStayAnalysis(db, stay.id);
    await run(fakeStayAsk(stayAnswer()));

    const again = fakeStayAsk(stayAnswer({ summary: "Something else" }));
    enqueueJob(db, { tripId, type: "analyze_stay", payload: { stayId: stay.id } });
    await run(again);

    expect(again).not.toHaveBeenCalled();
    expect(rows(stay.id)[0].summary).toBe("A workable apartment, tight for Jessy.");
  });

  it("says an advice is out of date when the price moved, and asks again only when told to", async () => {
    const { destinations } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    getOrRequestStayAnalysis(db, stay.id);
    await run(fakeStayAsk(stayAnswer()));

    db.update(schema.stayOptions).set({ totalPriceEur: 1200 }).where(eq(schema.stayOptions.id, stay.id)).run();
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "ready", stale: true });
    expect(jobsOf()).toHaveLength(1);

    // Asked again: the old advice stays to be shown while the new one is written
    const pending = getOrRequestStayAnalysis(db, stay.id, { refresh: true });
    expect(pending).toMatchObject({ state: "pending", previous: { explained: true, summary: "A workable apartment, tight for Jessy." } });
    expect(jobsOf()).toHaveLength(2);

    await run(fakeStayAsk(stayAnswer({ summary: "Now it is dear." })));
    expect(rows(stay.id)).toHaveLength(1);
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "ready", stale: false, analysis: { summary: "Now it is dear." } });
  });

  it("notices a change in a guest's budget too", async () => {
    const { destinations, guests } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    getOrRequestStayAnalysis(db, stay.id);
    await run(fakeStayAsk(stayAnswer()));
    await updateGuest(db, guests.jessy.id, { maxBudgetEur: 900 });
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "ready", stale: true });
  });

  it("does not ask again on refresh when nothing changed: it would only repeat itself", async () => {
    const { destinations } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    getOrRequestStayAnalysis(db, stay.id);
    await run(fakeStayAsk(stayAnswer()));

    expect(getOrRequestStayAnalysis(db, stay.id, { refresh: true })).toMatchObject({ state: "ready", stale: false });
    expect(jobsOf()).toHaveLength(1);
  });

  it("flags an advice that was not written from these facts, such as the seed's", async () => {
    const { destinations } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    db.insert(schema.stayAnalyses).values({ stayId: stay.id, verdict: "ok", fitScore: 62, summary: "-", inputHash: "seed" }).run();
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "ready", stale: true });
    expect(jobsOf()).toHaveLength(0);
  });
});

describe("when the AI is not available (B.5)", () => {
  it("fails at once without retries when the CLI is missing, and says so", async () => {
    const { destinations } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    getOrRequestStayAnalysis(db, stay.id);
    const ask = fakeStayAsk(new ClaudeUnavailableError("The `claude` command was not found"));
    await run(ask);

    expect(ask).toHaveBeenCalledTimes(1);
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "unavailable", message: expect.stringContaining("claude"), previous: { ratedBy: "rules", explained: false } });
    expect(jobsOf()).toHaveLength(1);
    expect(rows(stay.id)).toHaveLength(0);
  });

  it("only tries again after a while, or when asked", async () => {
    const { destinations } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    getOrRequestStayAnalysis(db, stay.id);
    await run(fakeStayAsk(new ClaudeUnavailableError("no claude")));

    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "unavailable" });
    expect(jobsOf()).toHaveLength(1);
    expect(getOrRequestStayAnalysis(db, stay.id, { refresh: true })).toMatchObject({ state: "pending" });
    expect(jobsOf()).toHaveLength(2);
  });

  it("retries an answer that does not hold up, then gives up as unavailable with the reason", async () => {
    const { destinations } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    getOrRequestStayAnalysis(db, stay.id);
    const ask = fakeStayAsk(new Error("Claude did not answer within 120 s"));
    await run(ask);

    expect(ask).toHaveBeenCalledTimes(3);
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "unavailable", message: expect.stringContaining("did not answer") });
  });

  it("keeps showing an advice that exists when a refresh could not be had", async () => {
    const { destinations } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    getOrRequestStayAnalysis(db, stay.id);
    await run(fakeStayAsk(stayAnswer()));
    db.update(schema.stayOptions).set({ totalPriceEur: 1200 }).where(eq(schema.stayOptions.id, stay.id)).run();

    getOrRequestStayAnalysis(db, stay.id, { refresh: true });
    await run(fakeStayAsk(new ClaudeUnavailableError("no claude")));
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "ready", stale: true, analysis: { summary: "A workable apartment, tight for Jessy." } });
  });

  it("fails for good when the accommodation was removed in the meantime", async () => {
    const { destinations, tripId } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    const job = enqueueJob(db, { tripId, type: "analyze_stay", payload: { stayId: stay.id } });
    db.delete(schema.stayOptions).where(eq(schema.stayOptions.id, stay.id)).run();

    const ask = fakeStayAsk(stayAnswer());
    await run(ask);
    expect(ask).not.toHaveBeenCalled();
    expect(db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).all()[0]).toMatchObject({ status: "failed", error: expect.stringContaining("no longer exists") });
  });
});

describe("explaining a stay that was rated while the trip was set up", () => {
  it("keeps that score: the AI explains it, it does not change it", async () => {
    const { destinations, tripId } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    rateStaysAsAi(db, tripId, destinations.bcn.id, [[stay.id, 90, "good"]]);

    getOrRequestStayAnalysis(db, stay.id);
    await run(fakeStayAsk(stayAnswer({ verdict: "bad", fitScore: 20, summary: "Cheap for what it is." })));

    expect(rows(stay.id)[0]).toMatchObject({ verdict: "good", fitScore: 90, summary: "Cheap for what it is." });
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({
      state: "ready", stale: false, analysis: { verdict: "good", fitScore: 90, ratedBy: "ai", explained: true },
    });
  });

  it("tells the AI the score it is explaining, and that it stands", async () => {
    const { destinations, tripId } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    rateStaysAsAi(db, tripId, destinations.bcn.id, [[stay.id, 90, "good"]]);

    getOrRequestStayAnalysis(db, stay.id);
    const ask = fakeStayAsk(stayAnswer());
    await run(ask);

    const prompt = ask.mock.calls[0][0] as string;
    expect(prompt).toContain("has already scored this accommodation");
    expect(prompt).toContain("90/100");
    expect(prompt).toContain("EXPLAIN");
    expect(prompt).toContain('"storedRating"');
  });

  it("says that the rules scored it when the AI was not there to", async () => {
    const { destinations } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    const prompt = stayPromptFor(stayAnalysisInputOf(db, stay.id)!.facts);
    expect(prompt).toContain("simple rules, because the AI was not available");
  });

  it("is out of date once the stay is rated again: the explanation was written for the old score", async () => {
    const { destinations, tripId } = await computed();
    const stay = apartmentOf(destinations.bcn.id);
    getOrRequestStayAnalysis(db, stay.id);
    await run(fakeStayAsk(stayAnswer()));
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "ready", stale: false });

    rateStaysAsAi(db, tripId, destinations.bcn.id, [[stay.id, 31, "ok"]]);
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "ready", stale: true, analysis: { fitScore: 31, ratedBy: "ai" } });
  });

  it("gives a stay nobody rated the AI's own verdict and score, as before the ratings existed", async () => {
    const { destinations } = await computed();
    forgetRatings(db);
    const stay = apartmentOf(destinations.bcn.id);

    expect(getOrRequestStayAnalysis(db, stay.id)).toEqual({ state: "pending" });
    const ask = fakeStayAsk(stayAnswer({ verdict: "bad", fitScore: 30 }));
    await run(ask);

    expect(rows(stay.id)[0]).toMatchObject({ verdict: "bad", fitScore: 30 });
    expect(ask.mock.calls[0][0]).not.toContain("has already scored");
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "ready", analysis: { verdict: "bad", fitScore: 30, explained: true } });
  });
});

describe("stayFactsOf with a stored rating", () => {
  it("carries the rating, and leaves it out when nothing rated the stay, so that the old fingerprints still hold", () => {
    const rated = stayFactsOf({ ...input, rating: { verdict: "good", score: 90, reason: "Roomy and cheap", source: "ai" } });
    expect(rated.storedRating).toEqual({ score: 90, verdict: "good", ratedBy: "ai", reason: "Roomy and cheap" });
    expect(stayInputHashOf(rated)).not.toBe(stayInputHashOf(stayFactsOf(input)));
    expect(JSON.stringify(stayFactsOf(input))).not.toContain("storedRating");
    expect(stayInputHashOf(stayFactsOf({ ...input, rating: null }))).toBe(stayInputHashOf(stayFactsOf(input)));
  });
});
