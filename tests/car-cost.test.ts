import { describe, expect, it } from "vitest";
import { carTripCostEur } from "@/core/pricing";

describe("carTripCostEur (A-S6)", () => {
  it("is the fuel for the round trip: 620 km to Barcelona costs 145 €", () => {
    // 620 km × 2 × 6.5 L/100 km × 1.80 €/L
    expect(carTripCostEur({ distanceKm: 620 })).toBe(145);
  });

  it("is 325 € for the 1,390 km no-toll drive to Mont-Saxonnex", () => {
    expect(carTripCostEur({ distanceKm: 1390 })).toBe(325);
  });

  it("adds 0.09 € per km of toll road, for both ways", () => {
    // 145.08 of fuel + 100 km × 2 × 0.09
    expect(carTripCostEur({ distanceKm: 620, tollKm: 100 })).toBe(163);
  });

  it("rounds to the whole euro", () => {
    expect(carTripCostEur({ distanceKm: 100 })).toBe(23); // 23.4
    expect(carTripCostEur({ distanceKm: 110 })).toBe(26); // 25.74
  });

  it("is free for no distance", () => {
    expect(carTripCostEur({ distanceKm: 0 })).toBe(0);
  });
});
