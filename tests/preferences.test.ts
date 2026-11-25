import { describe, expect, it } from "vitest";
import { bestFitFor, budgetRatioOf, standingOf } from "@/core/preferences";
import type { GuestScenario, Scenario } from "@/core/scenario";
import { loadScenario } from "./helpers/scenario";

const ref = loadScenario();

describe("standingOf", () => {
  it("counts the guests by tier, the ones who cannot get there apart (use-cases.md B.2, A.4)", () => {
    // Barcelona with the Extra (UC-D, D.3): Martin limited (1,023 € of 800 €, over only by the Plus), Chloé comfy, Jessy over
    expect(standingOf(ref.scenarioFor("barcelona"))).toEqual({ comfy: 1, limited: 1, over: 1, unreachable: 0 });
    // Réunion: Martin only drives, so he cannot get there; Jessy is over
    const reunion = standingOf(ref.scenarioFor("la-reunion"));
    expect(reunion.unreachable).toBe(1);
    expect(reunion.over).toBeGreaterThanOrEqual(1);
    expect(reunion.comfy + reunion.limited + reunion.over + reunion.unreachable).toBe(3);
  });
});

describe("budgetRatioOf", () => {
  it("is the share of the budget the trip takes", () => {
    expect(budgetRatioOf({ costEur: 370, maxBudgetEur: 400 })).toBeCloseTo(0.925);
    expect(budgetRatioOf({ costEur: null, maxBudgetEur: 400 })).toBeNull();
  });
});

describe("bestFitFor", () => {
  const scenarios = () => (["barcelona", "la-reunion", "mont-saxonnex"] as const).map((key) => ref.scenarioFor(key));

  it("picks the destination that takes the smallest share of a guest's budget", () => {
    // Jessy: 370/400 in Barcelona, 490/400 in Mont-Saxonnex, 1307/400 in La Réunion
    expect(bestFitFor(scenarios(), ref.jessy.id)).toBe(ref.destinations.barcelona.id);
    expect(bestFitFor(scenarios(), ref.martin.id)).toBe(ref.destinations.barcelona.id);
  });

  it("is null for a guest nobody knows", () => {
    expect(bestFitFor(scenarios(), "nobody")).toBeNull();
  });

  it("leaves out a destination the guest cannot get to by a mode they accept, however cheap its fallback", () => {
    const only = [ref.scenarioFor("la-reunion")];
    expect(only[0].guests.find((g) => g.guestId === ref.martin.id)!.status).toBe("unreachable");
    expect(bestFitFor(only, ref.martin.id)).toBeNull();
  });

  describe("ties", () => {
    const guestAt = (over: Partial<GuestScenario> & { comfort: number; cost: number }): GuestScenario => ({
      guestId: "g",
      name: "G",
      maxBudgetEur: 1000,
      status: "ok",
      reason: null,
      transport: { comfort: { score: over.comfort, level: "green", reasons: [] } } as unknown as GuestScenario["transport"],
      housingShareEur: 0,
      mandatoryEur: null,
      plusEur: null,
      costEur: over.cost,
      tier: "comfy",
      overBudgetEur: 0,
    });
    const at = (destinationId: string, guest: GuestScenario): Scenario => ({ destinationId, guests: [guest] }) as Scenario;

    it("goes to the more comfortable trip when the share of the budget is the same", () => {
      const scenarios = [at("a", guestAt({ cost: 500, comfort: 60 })), at("b", guestAt({ cost: 500, comfort: 90 }))];
      expect(bestFitFor(scenarios, "g")).toBe("b");
    });

    it("then to the cheaper one, then to the first listed", () => {
      expect(bestFitFor([at("a", guestAt({ cost: 500, comfort: 80 })), at("b", guestAt({ cost: 500, comfort: 80 }))], "g")).toBe("a");
      // Same ratio is only possible with different budgets: 500/1000 and 250/500
      const small = { ...guestAt({ cost: 250, comfort: 80 }), maxBudgetEur: 500 };
      expect(bestFitFor([at("a", guestAt({ cost: 500, comfort: 80 })), at("b", small)], "g")).toBe("b");
    });
  });
});
