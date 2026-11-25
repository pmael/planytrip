import { describe, expect, it } from "vitest";
import { budgetTier, guestCost, housingShare, transportCostFor, worstTier } from "@/core/pricing";

describe("transportCostFor (R5)", () => {
  it("leaves the last mile out of a per-person fare: it is the Extra's transfer now (D3, task.md T8.9)", () => {
    expect(transportCostFor({ priceEur: 110, priceUnit: "per_person", lastMileEur: 50 })).toBe(110);
  });

  it("charges the whole vehicle to its only occupant", () => {
    expect(transportCostFor({ priceEur: 145, priceUnit: "per_vehicle", lastMileEur: 0 })).toBe(145);
  });

  it("splits the vehicle between its occupants", () => {
    expect(transportCostFor({ priceEur: 145, priceUnit: "per_vehicle", lastMileEur: 0 }, 2)).toBe(72.5);
  });
});

describe("guestCost and housingShare (R5)", () => {
  it("adds an equal share of the accommodation to the transport", () => {
    const flight = { priceEur: 120, priceUnit: "per_person", lastMileEur: 0 } as const;
    expect(guestCost(flight, { totalPriceEur: 900 }, 3)).toBe(420);
  });

  it("keeps thirds unrounded", () => {
    expect(housingShare({ totalPriceEur: 800 }, 3)).toBeCloseTo(266.6667, 4);
  });

  it("has no housing share without an accommodation", () => {
    expect(housingShare(null, 3)).toBe(0);
  });
});

describe("budgetTier (R6)", () => {
  it.each([
    [0, "comfy"],
    [320, "comfy"], // exactly 80 %
    [320.5, "limited"],
    [370, "limited"], // Jessy in Barcelona, 92.5 %
    [400, "limited"], // exactly 100 %
    [400.5, "over"],
    [1307, "over"],
  ])("%d € of a 400 € budget is %s", (cost, tier) => {
    expect(budgetTier(cost, 400)).toBe(tier);
  });

  it("is not thrown off by floating point", () => {
    expect(budgetTier(0.1 * 3 * 1000, 375)).toBe("comfy"); // 300.00000000000006 / 375 = 80 %
  });
});

describe("worstTier", () => {
  it("is the worst of the tiers", () => {
    expect(worstTier(["comfy", "limited", "comfy"])).toBe("limited");
    expect(worstTier(["comfy", "over", "limited"])).toBe("over");
    expect(worstTier(["comfy", "comfy"])).toBe("comfy");
  });
});
