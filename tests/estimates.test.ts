// How long the computation's steps will take (core/estimates.ts, the progress screen): learnt from the jobs that ran,
// apart from what is quick the second time, and put on the steps, the ones still to be planned included.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimates } from "@/config";
import { experienceOf, isSlow, remainingSeconds, usualSeconds, type FinishedJob } from "@/core/estimates";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { estimateText, tookText } from "@/lib/durationText";
import { getProgress, startCompute } from "@/server/services/compute";
import { enterScenario, fixtureAdapters, runUntilIdle } from "./helpers/compute";
import { createTestDb } from "./helpers/db";

const at = (second: number) => new Date(Date.UTC(2026, 10, 25) + second * 1000).toISOString();
const job = (kind: string, subject: string, created: number, finished: number, more: Partial<FinishedJob> = {}): FinishedJob => ({
  kind, subject, createdAt: at(created), finishedAt: at(finished), ok: true, attempts: 1, ...more,
});

describe("what is learnt from the jobs that ran", () => {
  it("counts a job from the end of the one before it: the worker runs one at a time", () => {
    const { first } = experienceOf([job("plane", "a", 0, 60), job("plane", "b", 0, 100), job("plane", "c", 500, 530)]);
    expect(first.get("plane")).toEqual([60, 40, 30]);
  });

  it("tells what is done again for the same thing apart, only once it worked", () => {
    const jobs = [job("rate", "a", 0, 18), job("rate", "b", 18, 20, { ok: false }), job("rate", "b", 20, 38), job("rate", "a", 100, 100)];
    const { first, again } = experienceOf(jobs);
    expect(first.get("rate")).toEqual([18, 18]);
    expect(again.get("rate")).toEqual([0]);
  });

  it("does not learn from what was tried again, or from a worker that was stopped meanwhile", () => {
    const { first } = experienceOf([job("plane", "a", 0, 95, { attempts: 2 }), job("plane", "b", 100, 100 + estimates.notWorkAfterSeconds + 1)]);
    expect(first.get("plane")).toBeUndefined();
  });

  it("says the typical figure until it has run enough, then the usual time without the odd very long one", () => {
    const some = experienceOf([job("search_stays", "a", 0, 40), job("search_stays", "b", 40, 80)]);
    expect(usualSeconds(some, "search_stays", "z")).toBe(estimates.typicalSeconds.search_stays);
    const jobs = Array.from({ length: 10 }, (_, i) => job("search_stays", `d${i}`, i * 40, (i + 1) * 40));
    const last = jobs[jobs.length - 1];
    const slow = experienceOf([...jobs, job("search_stays", "slow", 400, 400 + 500)]);
    expect(last.finishedAt).toBe(at(400));
    expect(usualSeconds(slow, "search_stays", "z")).toBe(40);
    expect(usualSeconds(slow, "never heard of", "z")).toBe(estimates.otherSeconds);
  });

  it("expects nothing from what was already done and is kept", () => {
    const past = experienceOf([job("rate_stays", "a", 0, 18), job("rate_stays", "a", 100, 100)]);
    expect(usualSeconds(past, "rate_stays", "a")).toBe(0);
    expect(usualSeconds(past, "rate_stays", "b")).toBe(estimates.typicalSeconds.rate_stays);
    // Never done again yet: what is kept is expected to be quick, a search is not
    const once = experienceOf([job("survey_places", "a", 0, 130), job("search_stays", "a", 130, 200)]);
    expect(usualSeconds(once, "survey_places", "a")).toBe(estimates.keptSeconds);
    expect(usualSeconds(once, "search_stays", "a")).toBe(estimates.typicalSeconds.search_stays);
  });

  it("follows the computation itself: a site slow today moves the rest", () => {
    const past = experienceOf([0, 1, 2].map((i) => job("plane", `${i}`, i * 60, (i + 1) * 60)));
    expect(usualSeconds(past, "plane", "z")).toBe(60);
    expect(usualSeconds(past, "plane", "z", [120, 120, 120])).toBe(90);
  });

  it("never says that what is running has nothing left, and says when it is slow", () => {
    expect(remainingSeconds(60, 20)).toBe(40);
    expect(remainingSeconds(60, 300)).toBe(9);
    expect(remainingSeconds(0, 0)).toBe(1);
    expect(isSlow(60, 100)).toBe(false);
    expect(isSlow(60, 151)).toBe(true);
    // Two seconds instead of none is not slow
    expect(isSlow(0, 10)).toBe(false);
  });
});

describe("how a time is written", () => {
  it("rounds what is left, so that it does not flicker", () => {
    expect([3, 12, 44, 58, 80, 100, 200, 640, 4200].map(estimateText)).toEqual(["a few seconds", "10 s", "40 s", "1 min", "1 min 30", "1 min 30", "3 min 30", "11 min", "1 h 10"]);
  });

  it("says what it took to the second", () => {
    expect([0.1, 4.4, 60, 72].map(tookText)).toEqual(["instant", "4 s", "1 min", "1 min 12 s"]);
  });
});

describe("the times on the progress screen", () => {
  let db: Db;
  let close: () => void;
  beforeEach(() => ({ db, close } = createTestDb()));
  afterEach(() => close());

  /** A computation whose searches are planned: one flight search in the given state since `since`, one waiting */
  async function planned(status: "queued" | "running" = "queued", since = at(0)) {
    const { tripId, destinations } = await enterScenario(db);
    const [compute] = db.insert(schema.jobs).values({ tripId, type: "compute_trip", status: "running", progressJson: JSON.stringify({ plan: { done: 1, total: 1 } }), createdAt: at(-5), updatedAt: at(0) }).returning().all();
    for (const [destination, state] of [[destinations.bcn, status], [destinations.run, "queued"]] as const) {
      db.insert(schema.jobs).values({ tripId, type: "search_transport", status: state, createdAt: at(-2), updatedAt: since, payloadJson: JSON.stringify({ parent: compute.id, destinationId: destination.id, originKey: "madrid-spain", mode: "plane" }) }).run();
    }
    return { tripId, compute };
  }
  const typical = estimates.typicalSeconds;
  const later = 3 * (typical.survey_places + typical.price_destination + typical.rate_stays + typical.rate_transport + typical.advise_extras);

  it("lists the steps still to come with their time, and the total of them all", async () => {
    const { tripId } = await planned();
    const { steps, secondsLeft } = getProgress(db, tripId, new Date(at(0)));
    expect(steps.map((step) => [step.id, step.state])).toEqual([
      ["routes", "done"], ["transport:plane", "pending"], ["survey", "pending"], ["prices", "pending"], ["rate:stays", "pending"], ["rate:transport", "pending"], ["advice", "pending"],
    ]);
    expect(steps[1].secondsLeft).toBe(2 * typical["search_transport:plane"]);
    expect(steps.find((step) => step.id === "prices")).toMatchObject({ total: 3, secondsLeft: 3 * typical.price_destination });
    expect(secondsLeft).toBe(2 * typical["search_transport:plane"] + later);
    expect(steps[0].tookSeconds).toBe(3);
  });

  it("counts down while a search runs, and says when it takes longer than usual", async () => {
    const { tripId } = await planned("running", at(0));
    const plane = typical["search_transport:plane"];
    const stepAt = (second: number) => getProgress(db, tripId, new Date(at(second))).steps.find((step) => step.id === "transport:plane")!;
    expect(stepAt(0)).toMatchObject({ secondsLeft: 2 * plane, slow: false });
    expect(stepAt(20)).toMatchObject({ secondsLeft: 2 * plane - 20, slow: false });
    expect(stepAt(plane * 3)).toMatchObject({ secondsLeft: plane + plane * 0.15, slow: true });
  });

  it("does not know before the routes are checked, and has nothing left once it is over", async () => {
    const { tripId } = await enterScenario(db);
    startCompute(db, tripId);
    expect(getProgress(db, tripId).secondsLeft).toBeNull();
    await runUntilIdle(db, fixtureAdapters());
    const { steps, secondsLeft } = getProgress(db, tripId);
    expect(secondsLeft).toBeNull();
    expect(steps.every((step) => step.secondsLeft === undefined && typeof step.tookSeconds === "number")).toBe(true);
  });
});
