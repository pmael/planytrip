import { describe, expect, it } from "vitest";
import { rateStayByRules, rateTransportByRules, type StayRatingInput } from "@/core/ratings";

const group = [
  { name: "Martin", maxBudgetEur: 800 },
  { name: "Chloé", maxBudgetEur: 1200 },
  { name: "Jessy", maxBudgetEur: 400 },
];

const stay = (over: Partial<StayRatingInput> = {}): StayRatingInput => ({
  capacity: 4, totalPriceEur: 600, groupSize: 3, budgets: group, rating: 4.8, reviewCount: 120, distanceKm: 1.5, ...over,
});

describe("rateStayByRules", () => {
  it("rates a cheap, well rated, close place that fits as good, with the figures behind it", () => {
    const rated = rateStayByRules(stay());
    // 200 € each is 50 % of Jessy's 400 €
    expect(rated.verdict).toBe("good");
    expect(rated.score).toBeGreaterThanOrEqual(70);
    expect(rated.reason).toBe("Rules only: 200 € each is 50 % of Jessy's budget, sleeps 4, rated 4.8 (120 reviews)");
  });

  it("says it is the rules, never the AI", () => {
    expect(rateStayByRules(stay()).reason.startsWith("Rules only")).toBe(true);
  });

  it("is bad when it cannot sleep the group, however cheap and loved", () => {
    const rated = rateStayByRules(stay({ capacity: 2, totalPriceEur: 100, rating: 5 }));
    expect(rated).toMatchObject({ verdict: "bad", reason: "Rules only: it sleeps 2 and the group is 3" });
    expect(rated.score).toBeLessThanOrEqual(30);
  });

  it("is bad when its share alone is the whole budget of the poorest guest", () => {
    const rated = rateStayByRules(stay({ totalPriceEur: 1500 }));
    expect(rated).toMatchObject({ verdict: "bad", reason: "Rules only: 500 € each is more than Jessy's whole budget" });
    expect(rateStayByRules(stay({ totalPriceEur: 1200 })).verdict).toBe("bad");
  });

  it("still tells apart what is unusable: a loved place nobody can afford is less bad than a poor one", () => {
    // Both cost more than Jessy's whole budget; one is well rated by many guests and close, the other is neither
    const loved = rateStayByRules(stay({ totalPriceEur: 1500, rating: 4.9, reviewCount: 300, distanceKm: 1 }));
    const poor = rateStayByRules(stay({ totalPriceEur: 1500, rating: 3.6, reviewCount: 4, distanceKm: 12 }));
    expect([loved.verdict, poor.verdict]).toEqual(["bad", "bad"]);
    expect(loved.score).toBeGreaterThan(poor.score);
    // ...and both still end up under anything usable
    expect(loved.score).toBeLessThan(rateStayByRules(stay({ totalPriceEur: 900 })).score);
  });

  it("scores a dearer place lower, as the poorest guest's share of it grows", () => {
    const cheap = rateStayByRules(stay({ totalPriceEur: 450 })).score;
    const dearer = rateStayByRules(stay({ totalPriceEur: 900 })).score;
    const dearest = rateStayByRules(stay({ totalPriceEur: 1100 })).score;
    expect(cheap).toBeGreaterThan(dearer);
    expect(dearer).toBeGreaterThan(dearest);
  });

  it("scores the poorest guest's budget, not the average: the same stay is worse for a poorer group", () => {
    const rich = rateStayByRules(stay({ budgets: [{ name: "A", maxBudgetEur: 2000 }, { name: "B", maxBudgetEur: 2000 }, { name: "C", maxBudgetEur: 2000 }] }));
    expect(rich.score).toBeGreaterThan(rateStayByRules(stay()).score);
  });

  it("prefers a place that sleeps the group snugly to one with a lot of unused room", () => {
    expect(rateStayByRules(stay({ capacity: 3 })).score).toBeGreaterThanOrEqual(rateStayByRules(stay({ capacity: 4 })).score - 1);
    expect(rateStayByRules(stay({ capacity: 4 })).score).toBeGreaterThan(rateStayByRules(stay({ capacity: 8 })).score);
  });

  it("is less sure of a rating built on a few reviews", () => {
    expect(rateStayByRules(stay({ rating: 5, reviewCount: 3 })).score).toBeLessThan(rateStayByRules(stay({ rating: 5, reviewCount: 200 })).score);
  });

  it("scores a listing with no rating in the middle, and says so", () => {
    const fresh = rateStayByRules(stay({ rating: null, reviewCount: null }));
    expect(fresh.reason).toContain("no rating yet");
    expect(fresh.score).toBeLessThan(rateStayByRules(stay()).score);
  });

  it("is kinder to a place near the destination's centre than to one far out", () => {
    expect(rateStayByRules(stay({ distanceKm: 1 })).score).toBeGreaterThan(rateStayByRules(stay({ distanceKm: 20 })).score);
  });

  it("copes with a distance it does not know", () => {
    const unknown = rateStayByRules(stay({ distanceKm: null }));
    expect(unknown.score).toBeGreaterThan(0);
    expect(Number.isInteger(unknown.score)).toBe(true);
  });

  it("keeps the score between 0 and 100 whatever it is given", () => {
    for (const price of [0, 50, 600, 5000]) {
      for (const rating of [null, 0, 3, 5]) {
        const { score } = rateStayByRules(stay({ totalPriceEur: price, rating }));
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("rateTransportByRules", () => {
  const journey = { costEur: 70, budgets: [{ name: "Jessy", maxBudgetEur: 400 }], comfort: { level: "green" as const, score: 90, reasons: [] as string[] } };

  it("rates a comfortable, cheap journey as good", () => {
    const rated = rateTransportByRules(journey);
    expect(rated.verdict).toBe("good");
    expect(rated.reason).toBe("Rules only: comfortable, 70 € is 18 % of Jessy's budget");
  });

  it("is bad when it is red for comfort, naming why", () => {
    const rated = rateTransportByRules({ ...journey, costEur: 910, budgets: [{ name: "Jessy", maxBudgetEur: 4000 }], comfort: { level: "red", score: 20, reasons: ["3 stops", "23 h 40 of travel"] } });
    expect(rated).toMatchObject({ verdict: "bad", reason: "Rules only: 3 stops, 910 € is 23 % of Jessy's budget" });
  });

  it("is bad when it costs the poorest guest everything they have", () => {
    expect(rateTransportByRules({ ...journey, costEur: 450 }).verdict).toBe("bad");
  });

  it("is dearer to a poorer guest: the same fare scores worse against a smaller budget", () => {
    const poor = rateTransportByRules({ ...journey, costEur: 200 });
    const rich = rateTransportByRules({ ...journey, costEur: 200, budgets: [{ name: "Chloé", maxBudgetEur: 1200 }] });
    expect(rich.score).toBeGreaterThan(poor.score);
  });

  it("reads the poorest of the guests who would take it", () => {
    const rated = rateTransportByRules({ ...journey, budgets: [{ name: "Martin", maxBudgetEur: 800 }, { name: "Jessy", maxBudgetEur: 400 }] });
    expect(rated.reason).toContain("Jessy's budget");
  });

  it("describes a yellow journey by what held it back, or just as acceptable", () => {
    expect(rateTransportByRules({ ...journey, comfort: { level: "yellow", score: 60, reasons: ["Departs at 06:45, early"] } }).reason).toContain("Departs at 06:45, early");
    expect(rateTransportByRules({ ...journey, comfort: { level: "yellow", score: 60, reasons: [] } }).reason).toContain("acceptable");
  });
});
