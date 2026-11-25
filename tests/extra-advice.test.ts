// The advice on fitting the Extra into the budgets (task.md T8.8, use-cases.md R12): the levers the rules work out, the
// check of the AI's lines (only the levers given, the app's euros), the advise_extras job, and the advice going out of
// date with a ❤ on another stay. On the seeded reference scenario (Barcelona: Jessy over, Martin tight).
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeUnavailableError, type AskFn } from "@/ai/claude";
import { checkExtraAdvice, extraAdvicePrompt, type ExtraAdviceAnswer, type ExtraAdviceFacts } from "@/ai/extra-advice";
import { extraPlan, withLever, type ExtraInput } from "@/core/extras";
import * as schema from "@/db/schema";
import { seedScenarioMartin } from "@/db/seed/scenario-martin";
import type { Db } from "@/db/types";
import { adviceInputOf, extraAdviceOf, keptExtraAdvice, requestExtraAdvice } from "@/server/services/extraAdvice";
import { setSelection } from "@/server/services/selections";
import { createAdviseExtrasHandler } from "@/worker/handlers/advise-extras";
import { processNextJob } from "@/worker";
import { enqueueJob } from "@/worker/queue";
import { createTestDb } from "./helpers/db";
import { seedExtraInput } from "./helpers/extras";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

describe("the levers", () => {
  it("leaves out the dearest paid activity first (Le Mont-Saxonnex: the Aiguille du Midi)", () => {
    const input = seedExtraInput("mont-saxonnex");
    const plan = extraPlan(input);
    const changes = withLever(input, plan, {}, "skip-activity", "jessy")!;
    expect(extraPlan({ ...input }).activities.map((a) => a.name)).toContain("Aiguille du Midi cable car");
    const after = input.activities.slice(0, plan.hikeDays).filter((a) => a.name !== "Aiguille du Midi cable car");
    expect(changes).toEqual({ skippedActivities: 1 });
    expect(after).toHaveLength(5);
  });

  it("offers public transport instead of a taxi only for a taxi the guest takes alone", () => {
    // Le Mont-Saxonnex: Chloé and Jessy each take a taxi alone from Geneva (the bus takes 1 h 45), and share one back
    const input = seedExtraInput("mont-saxonnex");
    const plan = extraPlan(input);
    expect(withLever(input, plan, {}, "transit-not-taxi", "chloe")).toEqual({ transitLegs: ["chloe|there"] });
    expect(withLever(input, plan, {}, "transit-not-taxi", "chloe", 2)).toBeNull();
    expect(withLever(input, plan, {}, "transit-not-taxi", "martin")).toBeNull();
  });

  it("has none for what the objective does not have", () => {
    const input: ExtraInput = seedExtraInput("barcelona");
    const plan = extraPlan(input);
    expect(withLever(input, plan, {}, "skip-relax", "jessy")).toBeNull();
    expect(withLever(input, plan, {}, "fewer-day-passes", "jessy")).toBeNull();
    expect(withLever(input, plan, { nightsOut: 1 }, "fewer-nights-out", "jessy")).toBeNull();
  });
});

const facts: ExtraAdviceFacts = {
  destination: { name: "Barcelona", objective: "partying", budgetLevel: "light", nights: 10 },
  guests: [
    { code: "G1", name: "Martin", budgetEur: 800, transportAndHousingEur: 445, extra: {}, mandatoryEur: 338, plusEur: 240, totalEur: 1023, status: "tight", levers: [{ lever: "fewer-nights-out", maxSteps: 4, savingPerStepEur: 48, what: "Go out one night fewer" }] },
    { code: "G2", name: "Chloé", budgetEur: 1200, transportAndHousingEur: 420, extra: {}, mandatoryEur: 202, plusEur: 240, totalEur: 862, status: "comfy", levers: [] },
  ],
  groupLevers: [{ lever: "bars-only", maxSteps: 5, savingPerStepEur: 15, what: "Make one night out bars only" }],
};

describe("checkExtraAdvice: only the levers given, the app's euros", () => {
  it("keeps the lines that name a lever given, within its steps, without an amount of their own", () => {
    const answer: ExtraAdviceAnswer = {
      group: [
        { lever: "bars-only", steps: 2, text: "Make two of the nights bars in El Born, no club" },
        { lever: "groceries-only", steps: 1, text: "Everyone cooks" },
      ],
      guests: [
        {
          code: "G1",
          lines: [
            { lever: "fewer-nights-out", steps: 2, text: "Go out three nights rather than five" },
            { lever: "fewer-nights-out", steps: 9, text: "Never go out" },
            { lever: "skip-activity", steps: 1, text: "Skip the museum" },
          ],
        },
        { code: "G2", lines: [{ lever: "bars-only", steps: 1, text: "Chloé is comfy" }] },
      ],
    };
    const checked = checkExtraAdvice(answer, facts);
    expect(checked.group).toEqual([{ lever: "bars-only", steps: 2, text: "Make two of the nights bars in El Born, no club" }]);
    expect(checked.guests.get("G1")).toEqual([{ lever: "fewer-nights-out", steps: 2, text: "Go out three nights rather than five" }]);
    // Chloé is comfy: no line for her; a lever not given, too many steps, a lever given twice
    expect(checked.guests.has("G2")).toBe(false);
    expect(checked.dropped).toBe(4);
  });

  it("drops a line that writes an amount of its own: the euros are the app's", () => {
    const answer: ExtraAdviceAnswer = { group: [], guests: [{ code: "G1", lines: [{ lever: "fewer-nights-out", steps: 1, text: "One night fewer saves you €48" }] }] };
    expect(checkExtraAdvice(answer, facts).guests.get("G1")).toEqual([]);
    expect(checkExtraAdvice({ group: [], guests: [{ code: "G1", lines: [{ lever: "fewer-nights-out", steps: 1, text: "Save 50 euros" }] }] }, facts).dropped).toBe(1);
  });

  it("asks for lines without money, for the tight or over guests only, from the levers given", () => {
    const prompt = extraAdvicePrompt(facts);
    expect(prompt).toContain("without any amount of money");
    expect(prompt).toContain('only for guests who are "tight" or "over"');
  });
});

describe("adviceInputOf: what the AI is told about Barcelona (seed)", () => {
  it("gives each guest their status and, to those tight or over, their levers with what one step saves", () => {
    const { tripId, destinationIds } = seedScenarioMartin(db);
    const input = adviceInputOf(db, tripId, destinationIds.barcelona)!;
    const byName = (name: string) => input.facts.guests.find((guest) => guest.name === name)!;
    expect(byName("Jessy").status).toBe("over");
    expect(byName("Chloé")).toMatchObject({ status: "comfy", levers: [] });
    expect(byName("Jessy").levers.map((lever) => lever.lever)).toEqual(expect.arrayContaining(["groceries-only", "fewer-nights-out", "bars-only"]));
    const fewer = byName("Jessy").levers.find((lever) => lever.lever === "fewer-nights-out")!;
    expect(fewer.maxSteps).toBe(4);
    expect(input.facts.groupLevers.map((lever) => lever.lever)).toContain("fewer-nights-out");
    expect(input.facts.groupLevers.map((lever) => lever.lever)).not.toContain("transit-not-taxi");
  });
});

describe("the advise_extras job", () => {
  async function run(tripId: string, destinationId: string, ask: AskFn) {
    enqueueJob(db, { tripId, type: "advise_extras", payload: { destinationId } });
    await processNextJob(db, { advise_extras: createAdviseExtrasHandler(ask) }, { policy: { maxRetries: 0, backoffMs: [0] } });
  }
  const answering = (answer: ExtraAdviceAnswer) => vi.fn(async () => answer) as unknown as AskFn;

  it("keeps the AI's lines with the app's euros, and where each guest ends up", async () => {
    const { tripId, destinationIds } = seedScenarioMartin(db);
    const input = adviceInputOf(db, tripId, destinationIds.barcelona)!;
    const jessy = input.facts.guests.find((guest) => guest.name === "Jessy")!;
    await run(tripId, destinationIds.barcelona, answering({
      group: [{ lever: "fewer-nights-out", steps: 2, text: "Three big nights out together rather than five" }],
      guests: [{ code: jessy.code, lines: [{ lever: "groceries-only", steps: 1, text: "Eat from the supermarket at every meal" }, { lever: "bars-only", steps: 1, text: "Make one of the nights bars only, with 50 € left" }] }],
    }));

    const kept = keptExtraAdvice(db, destinationIds.barcelona)!;
    expect(kept.source).toBe("ai");
    expect(kept.message).toMatch(/^1 line of the AI's answer was not kept/);
    const groceries = jessy.levers.find((lever) => lever.lever === "groceries-only")!;
    const advice = kept.advice.guests.find((guest) => guest.name === "Jessy")!;
    expect(advice.lines).toEqual([{ lever: "groceries-only", steps: 1, text: "Eat from the supermarket at every meal", savingEur: groceries.savingPerStepEur }]);
    expect(advice.afterEur).toBeCloseTo(advice.beforeEur - groceries.savingPerStepEur, 2);
    expect(advice.fits).toBe(false);
    // The group line saves every guest the same two nights out
    const savings = Object.values(kept.advice.group[0].savingEachEur);
    expect(new Set(savings).size).toBe(1);
    expect(savings[0]).toBeGreaterThan(0);
  });

  it("advises by the rules without the AI: the guests over budget, the biggest saving first, no group line", async () => {
    const { tripId, destinationIds } = seedScenarioMartin(db);
    await run(tripId, destinationIds.barcelona, (async () => {
      throw new ClaudeUnavailableError("The claude CLI is not installed");
    }) as AskFn);
    const kept = keptExtraAdvice(db, destinationIds.barcelona)!;
    expect(kept).toMatchObject({ source: "rules", message: "Not written by the AI (The claude CLI is not installed)" });
    expect(kept.advice.group).toEqual([]);
    const jessy = kept.advice.guests.find((guest) => guest.name === "Jessy")!;
    expect(jessy.lines[0]).toMatchObject({ lever: "fewer-nights-out", text: "Go out 4 nights fewer" });
    expect(jessy.fits).toBe(false);
    expect(kept.advice.guests.map((guest) => guest.name)).not.toContain("Chloé");
  });

  it("is not asked again for the same facts, and goes out of date with a ❤ on another stay (task.md T8.8)", async () => {
    const { tripId, destinationIds } = seedScenarioMartin(db);
    const ask = answering({ group: [], guests: [] });
    await run(tripId, destinationIds.barcelona, ask);
    await run(tripId, destinationIds.barcelona, ask);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(extraAdviceOf(db, tripId, destinationIds.barcelona)).toMatchObject({ stale: false, pending: false });

    const [hotel] = db.select().from(schema.stayOptions).where(eq(schema.stayOptions.destinationId, destinationIds.barcelona)).all().filter((stay) => stay.provider === "booking");
    setSelection(db, destinationIds.barcelona, { kind: "stay", optionId: hotel.id });
    expect(extraAdviceOf(db, tripId, destinationIds.barcelona)).toMatchObject({ stale: true });

    // "Ask again": queued once, written for the hotel
    expect(requestExtraAdvice(db, tripId, destinationIds.barcelona)).toEqual({ queued: true });
    expect(requestExtraAdvice(db, tripId, destinationIds.barcelona)).toEqual({ queued: false });
    expect(extraAdviceOf(db, tripId, destinationIds.barcelona)).toMatchObject({ pending: true });
    await processNextJob(db, { advise_extras: createAdviseExtrasHandler(ask) });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(extraAdviceOf(db, tripId, destinationIds.barcelona)).toMatchObject({ stale: false, pending: false });
  });
});
