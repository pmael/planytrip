// The advice on fitting a destination's Extra into the budgets (task.md T8.8, use-cases.md R12): what the AI is asked
// (the guests, their costs line by line, the levers with the app's savings), what is kept, and reading it back with
// whether it still holds. Written by the advise_extras job while the trip is set up, or on "Ask again"; never on a page.
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { extraAdviceHashOf, type CheckedLine, type ExtraAdviceFacts, type OfferedLever } from "@/ai/extra-advice";
import { adviseByRules, budgetTierWithExtra, LEVER_IDS, totalWith, withLever, type AdviceGuest, type ExtraInput, type ExtraPlan, type LeverId, type PlanChanges } from "@/core/extras";
import type { RatingSource } from "@/core/types";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { enqueueJob } from "@/worker/queue";
import { ConflictError, NotFoundError } from "../errors";
import { tripExtras } from "./extras";
import { loadTripScenarios, type TripScenarios } from "./scenarios";

/** A line of advice, with what the app works out it saves */
export type AdviceLine = { lever: LeverId; steps: number; text: string; savingEur: number };

export type StoredAdvice = {
  /** What the group could agree on, and what it saves each guest */
  group: (Omit<AdviceLine, "savingEur"> & { savingEachEur: Record<string, number> })[];
  guests: { guestId: string; name: string; budgetEur: number; beforeEur: number; afterEur: number; fits: boolean; lines: AdviceLine[] }[];
};

const cents = (eur: number) => Math.round(eur * 100) / 100;
/** "A", "A and B", "A, B and C" */
const listed = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What a lever does, in words: the rules' advice, and what the AI is told each lever is */
export function leverText(lever: LeverId, steps: number, input: ExtraInput, plan: ExtraPlan): string {
  switch (lever) {
    case "groceries-only":
      return "Eat from the supermarket rather than in restaurants";
    case "fewer-nights-out":
      return steps === 1 ? "Go out one night fewer" : `Go out ${steps} nights fewer`;
    case "bars-only":
      return `Make ${steps === 1 ? "one night out" : `${steps} nights out`} bars only, without a club`;
    case "skip-activity": {
      const dearest = plan.activities
        .filter((activity) => activity.priceEur > 0)
        .sort((a, b) => b.priceEur - a.priceEur)
        .slice(0, steps)
        .map((activity) => activity.name);
      return `Leave out ${listed(dearest) || "the dearest visit"}`;
    }
    case "skip-relax":
      return "Skip the spa session";
    case "fewer-day-passes":
      return `Take ${steps} ${plural(steps, "day pass", "day passes")} fewer: walk, or buy single tickets`;
    case "transit-not-taxi":
      return `Take public transport rather than a taxi between the ${input.guests.some((guest) => guest.mode === "plane") ? "airport" : "station"} and the stay`;
  }
}

/** The steps a lever has for a guest, from the plan as it is (at most 10) */
function stepsOf(input: ExtraInput, plan: ExtraPlan, lever: LeverId, guestId: string): number {
  let steps = 0;
  let changes: PlanChanges = {};
  for (let next = withLever(input, plan, changes, lever, guestId); next && steps < 10; next = withLever(input, plan, changes, lever, guestId)) {
    changes = next;
    steps++;
  }
  return steps;
}

/** What `steps` of a lever save a guest, from the plan as it is; null when it has not that many */
function savingOf(input: ExtraInput, plan: ExtraPlan, lever: LeverId, steps: number, guest: AdviceGuest): number | null {
  const changes = withLever(input, plan, {}, lever, guest.guestId, steps);
  return changes ? cents(totalWith(input, {}, guest) - totalWith(input, changes, guest)) : null;
}

export type AdviceInput = {
  destinationId: string;
  facts: ExtraAdviceFacts;
  hash: string;
  input: ExtraInput;
  plan: ExtraPlan;
  guests: (AdviceGuest & { code: string; name: string })[];
};

/** What the AI is asked about a destination's Extra; null when it has no Extra (no stay to work it out for) */
export function adviceInputOf(db: Db, tripId: string, destinationId: string, scenarios: TripScenarios | null = loadTripScenarios(db, tripId)): AdviceInput | null {
  const extra = scenarios && tripExtras(db, tripId, scenarios).get(destinationId);
  const scenario = scenarios?.scenarios.find((candidate) => candidate.destinationId === destinationId);
  const destination = scenarios?.trip.destinations.find((candidate) => candidate.id === destinationId);
  if (!extra || !scenario || !destination) return null;
  const { input, plan } = extra;

  const guests = scenario.guests.map((guest, index) => ({
    guestId: guest.guestId,
    name: guest.name,
    code: `G${index + 1}`,
    maxBudgetEur: guest.maxBudgetEur,
    // What transport and housing cost them (R5; their cost now has the Extra in it too)
    tripEur: (guest.transport?.costEur ?? 0) + guest.housingShareEur,
  }));
  const leversOf = (guest: (typeof guests)[number], ids: readonly LeverId[]): OfferedLever[] =>
    ids.flatMap((lever) => {
      const maxSteps = stepsOf(input, plan, lever, guest.guestId);
      const saving = maxSteps > 0 ? savingOf(input, plan, lever, 1, guest) : null;
      return saving !== null && saving >= 0.5 ? [{ lever, maxSteps, savingPerStepEur: saving, what: leverText(lever, 1, input, plan) }] : [];
    });

  const facts: ExtraAdviceFacts = {
    destination: { name: destination.label.split(",")[0], objective: input.objective, budgetLevel: input.budgetLevel, nights: input.nights },
    guests: guests.map((guest) => {
      const own = plan.guests.find((candidate) => candidate.guestId === guest.guestId)!;
      const { tier } = budgetTierWithExtra({ coreEur: guest.tripEur + own.mandatoryEur, plusEur: own.plusEur }, guest.maxBudgetEur);
      return {
        code: guest.code,
        name: guest.name,
        budgetEur: guest.maxBudgetEur,
        transportAndHousingEur: cents(guest.tripEur),
        extra: Object.fromEntries(own.lines.map((line) => [line.id, cents(line.eur)])),
        mandatoryEur: cents(own.mandatoryEur),
        plusEur: cents(own.plusEur),
        totalEur: cents(guest.tripEur + own.mandatoryEur + own.plusEur),
        status: tier === "comfy" ? "comfy" : tier === "over" ? "over" : "tight",
        levers: tier === "comfy" ? [] : leversOf(guest, LEVER_IDS),
      };
    }),
    // The group's levers: the same change for everyone, the saving each (the mean, when it differs a little)
    groupLevers: LEVER_IDS.filter((lever) => lever !== "transit-not-taxi").flatMap((lever) => {
      const offered = guests.map((guest) => leversOf(guest, [lever])[0]).filter(Boolean);
      if (offered.length < guests.length) return [];
      return [{ lever, maxSteps: Math.min(...offered.map((one) => one.maxSteps)), savingPerStepEur: cents(offered.reduce((sum, one) => sum + one.savingPerStepEur, 0) / offered.length), what: offered[0].what }];
    }),
  };
  return { destinationId, facts, hash: extraAdviceHashOf(facts), input, plan, guests };
}

/** The advice from checked lines (the AI's) or the rules', with the app's euros and where each guest ends up */
export function adviceFrom(advice: AdviceInput, chosen: { group: CheckedLine[]; guests: Map<string, CheckedLine[]> }): StoredAdvice {
  const { input, plan } = advice;
  return {
    group: chosen.group.map((line) => ({
      ...line,
      savingEachEur: Object.fromEntries(advice.guests.map((guest) => [guest.guestId, savingOf(input, plan, line.lever, line.steps, guest) ?? 0])),
    })),
    guests: advice.guests.flatMap((guest) => {
      const lines = chosen.guests.get(guest.code);
      if (!lines || lines.length === 0) return [];
      // Where the guest ends up with all their lines together
      let changes: PlanChanges = {};
      for (const line of lines) changes = withLever(input, plan, changes, line.lever, guest.guestId, line.steps) ?? changes;
      const afterEur = cents(totalWith(input, changes, guest));
      return [
        {
          guestId: guest.guestId,
          name: guest.name,
          budgetEur: guest.maxBudgetEur,
          beforeEur: cents(totalWith(input, {}, guest)),
          afterEur,
          fits: afterEur <= guest.maxBudgetEur + 1e-9,
          lines: lines.map((line) => ({ ...line, savingEur: savingOf(input, plan, line.lever, line.steps, guest) ?? 0 })),
        },
      ];
    }),
  };
}

/** R12 without the AI: each guest over budget, the biggest saving first, in the rules' words; no group advice */
export function rulesAdvice(advice: AdviceInput): StoredAdvice {
  const byRules = adviseByRules(advice.input, advice.plan, advice.guests);
  const guests = new Map(
    byRules.map((one) => [advice.guests.find((guest) => guest.guestId === one.guestId)!.code, one.levers.map((use) => ({ lever: use.lever, steps: use.steps, text: leverText(use.lever, use.steps, advice.input, advice.plan) }))]),
  );
  return adviceFrom(advice, { group: [], guests });
}

export function storeExtraAdvice(db: Db, destinationId: string, kept: { advice: StoredAdvice; source: RatingSource; hash: string; message: string | null }): void {
  db.transaction((tx) => {
    tx.delete(schema.extraAdvice).where(eq(schema.extraAdvice.destinationId, destinationId)).run();
    tx.insert(schema.extraAdvice).values({ destinationId, payloadJson: JSON.stringify(kept.advice), source: kept.source, inputHash: kept.hash, message: kept.message }).run();
  });
}

const Line = z.object({ lever: z.enum(LEVER_IDS), steps: z.number(), text: z.string(), savingEur: z.number() });
const StoredAdviceSchema: z.ZodType<StoredAdvice> = z.object({
  group: z.array(Line.omit({ savingEur: true }).extend({ savingEachEur: z.record(z.string(), z.number()) })),
  guests: z.array(z.object({ guestId: z.string(), name: z.string(), budgetEur: z.number(), beforeEur: z.number(), afterEur: z.number(), fits: z.boolean(), lines: z.array(Line) })),
});

export type KeptAdvice = { advice: StoredAdvice; source: RatingSource; inputHash: string; message: string | null; createdAt: string };

/** What is kept for a destination, or null */
export function keptExtraAdvice(db: Db, destinationId: string): KeptAdvice | null {
  const [row] = db.select().from(schema.extraAdvice).where(eq(schema.extraAdvice.destinationId, destinationId)).all();
  if (!row) return null;
  try {
    const advice = StoredAdviceSchema.safeParse(JSON.parse(row.payloadJson));
    return advice.success ? { advice: advice.data, source: row.source, inputHash: row.inputHash, message: row.message, createdAt: row.createdAt } : null;
  } catch {
    return null;
  }
}

export type AdviceState = KeptAdvice & {
  /** True when a budget, the ❤ stay, an offer or the dates changed since it was written: it may no longer hold */
  stale: boolean;
  /** "Ask again" was pressed and the new advice is being written */
  pending: boolean;
};

/** The advice of a destination and whether it still holds; null when none was written yet */
export function extraAdviceOf(db: Db, tripId: string, destinationId: string, scenarios?: TripScenarios | null): AdviceState | null {
  const kept = keptExtraAdvice(db, destinationId);
  if (!kept) return null;
  const now = adviceInputOf(db, tripId, destinationId, scenarios ?? loadTripScenarios(db, tripId));
  return { ...kept, stale: !now || now.hash !== kept.inputHash, pending: adviceJobPending(db, tripId, destinationId) };
}

/** "Ask again" was pressed and the advice is being written (or the trip's setup has not reached it yet) */
export function adviceJobPending(db: Db, tripId: string, destinationId: string): boolean {
  return (
    db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.tripId, tripId), eq(schema.jobs.type, "advise_extras"), inArray(schema.jobs.status, ["queued", "running"]), sql`json_extract(${schema.jobs.payloadJson}, '$.destinationId') = ${destinationId}`))
      .limit(1)
      .all().length > 0
  );
}

/** "Ask again": the advice is written anew for what the trip is now (the AI is asked; the rules if it is not there) */
export function requestExtraAdvice(db: Db, tripId: string, destinationId: string): { queued: boolean } {
  if (adviceJobPending(db, tripId, destinationId)) return { queued: false };
  enqueueJob(db, { tripId, type: "advise_extras", payload: { destinationId } });
  return { queued: true };
}

// ── The API (the Extra page, task.md T8.10) ─────────────────────────────────

/** The trip of a destination whose trip has been worked out */
function workedOutTripOf(db: Db, destinationId: string): string {
  const [destination] = db.select({ tripId: schema.destinations.tripId }).from(schema.destinations).where(eq(schema.destinations.id, destinationId)).all();
  if (!destination) throw new NotFoundError("Destination not found");
  const [trip] = db.select({ status: schema.trips.status }).from(schema.trips).where(eq(schema.trips.id, destination.tripId)).all();
  if (!trip || !(trip.status === "ready" || trip.status === "validated")) throw new ConflictError("not_ready", "The trip has not been worked out yet");
  return destination.tripId;
}

export type ExtraAdviceStatus = { exists: boolean; pending: boolean; stale: boolean; source: RatingSource | null };

/** GET: where the destination's advice stands, for the page waiting on "Ask again". Asks for nothing. */
export function extraAdviceStatus(db: Db, destinationId: string): ExtraAdviceStatus {
  const tripId = workedOutTripOf(db, destinationId);
  const state = extraAdviceOf(db, tripId, destinationId);
  return { exists: state !== null, pending: adviceJobPending(db, tripId, destinationId), stale: state?.stale ?? false, source: state?.source ?? null };
}

/** POST: "Ask again" (or "Ask for advice" when there is none yet) */
export function askExtraAdvice(db: Db, destinationId: string): { queued: boolean } {
  return requestExtraAdvice(db, workedOutTripOf(db, destinationId), destinationId);
}
