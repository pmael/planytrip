// The stay ratings follow the destination's objective (task.md T8.7, use-cases.md R11), on the seeded scenario: the
// rules give the objective a quarter of the score, the AI is told the objective's criteria and what is around each stay.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stayRatingPrompt } from "@/ai/option-ratings";
import { rateStayByRules } from "@/core/ratings";
import * as schema from "@/db/schema";
import { seedScenarioMartin } from "@/db/seed/scenario-martin";
import type { Db } from "@/db/types";
import { stayRatingInputOf } from "@/server/services/ratingInputs";
import { createTestDb } from "./helpers/db";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

const titleOf = (id: string) => db.select({ title: schema.stayOptions.title }).from(schema.stayOptions).where(eq(schema.stayOptions.id, id)).get()!.title;

describe("the rules rate Barcelona's stays for partying (seed)", () => {
  it("puts the Gràcia flat first, with how well it suits partying in its score and its reason", () => {
    const { destinationIds } = seedScenarioMartin(db);
    const input = stayRatingInputOf(db, destinationIds.barcelona)!;
    const ranked = [...input.rules].sort((a, b) => b[1].score - a[1].score);
    expect(titleOf(ranked[0][0])).toMatch(/^Gràcia apartment/);
    expect(ranked[0][1].reason).toMatch(/suits partying \d+\/100/);
  });

  it("changes nothing for None: the score is the rules' as before T8.7", () => {
    const { destinationIds } = seedScenarioMartin(db);
    db.update(schema.destinations).set({ objective: "none" }).where(eq(schema.destinations.id, destinationIds.barcelona)).run();
    const input = stayRatingInputOf(db, destinationIds.barcelona)!;
    const [gracia] = db.select().from(schema.stayOptions).where(eq(schema.stayOptions.destinationId, destinationIds.barcelona)).all().filter((stay) => stay.title.startsWith("Gràcia"));
    const before = rateStayByRules({ capacity: gracia.capacity, totalPriceEur: gracia.totalPriceEur, groupSize: 3, budgets: [{ name: "Martin", maxBudgetEur: 800 }, { name: "Chloé", maxBudgetEur: 1200 }, { name: "Jessy", maxBudgetEur: 400 }], rating: gracia.rating, reviewCount: null, distanceKm: null });
    expect(input.rules.get(gracia.id)).toEqual(before);
    expect(input.rules.get(gracia.id)!.reason).not.toMatch(/suits/);
  });
});

describe("the AI is told the objective and what is around each stay", () => {
  it("gives each candidate its surroundings and amenities, and the season, and asks it to weigh the objective", () => {
    const { destinationIds } = seedScenarioMartin(db);
    const input = stayRatingInputOf(db, destinationIds["mont-saxonnex"])!;
    expect(input.facts.destination).toMatchObject({ tripObjective: "nature", season: "summer" });
    expect(input.facts.candidates[0]).toMatchObject({ around: { nearestHikingPathOrParkKm: 0, nearestSupermarketKm: 4 }, has: expect.arrayContaining(["kitchen", "free parking", "view"]) });
    const prompt = stayRatingPrompt(input.facts);
    expect(prompt).toContain('"nature": close to hiking paths and natural parks');
    expect(prompt).toContain("counts for about a quarter of your judgement");
  });

  it("knows the southern winter: La Réunion in August", () => {
    const { destinationIds } = seedScenarioMartin(db);
    expect(stayRatingInputOf(db, destinationIds["la-reunion"])!.facts.destination.season).toBe("winter");
  });
});
