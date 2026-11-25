import { describe, expect, it } from "vitest";
import { trends } from "@/core/trends";
import { loadScenario } from "./helpers/scenario";

describe("trends (C-S3)", () => {
  it("marks the lowest ▲, the highest ▼ and the others ≈", () => {
    expect(trends({ a: 1235, b: 1695, c: 3700 })).toEqual({ a: "▲", b: "≈", c: "▼" });
  });

  it("gives ties the same marker", () => {
    expect(trends({ a: 100, b: 100, c: 300 })).toEqual({ a: "▲", b: "▲", c: "▼" });
    expect(trends({ a: 100, b: 300, c: 300 })).toEqual({ a: "▲", b: "▼", c: "▼" });
  });

  it("is ≈ everywhere when all values are equal, or when there is only one", () => {
    expect(trends({ a: 5, b: 5, c: 5 })).toEqual({ a: "≈", b: "≈", c: "≈" });
    expect(trends({ a: 5 })).toEqual({ a: "≈" });
  });

  it("handles two values", () => {
    expect(trends({ a: 1, b: 2 })).toEqual({ a: "▲", b: "▼" });
  });

  it("treats float noise as a tie", () => {
    expect(trends({ a: 0.1 + 0.2, b: 0.3, c: 5 })).toEqual({ a: "▲", b: "▲", c: "▼" });
  });

  it("is empty for no destination", () => {
    expect(trends({})).toEqual({});
  });

  describe("on the reference scenario (table C.2)", () => {
    const s = loadScenario();
    const scenarios = {
      barcelona: s.scenarioFor("barcelona"),
      reunion: s.scenarioFor("la-reunion"),
      mont: s.scenarioFor("mont-saxonnex"),
    };

    it("housing: La Réunion ▲ (267 €, the cheapest), Barcelona and Mont-Saxonnex ▼ (300 €, tied)", () => {
      const result = trends({
        barcelona: scenarios.barcelona.housingShareEur,
        reunion: scenarios.reunion.housingShareEur,
        mont: scenarios.mont.housingShareEur,
      });
      expect(result).toEqual({ barcelona: "▼", reunion: "▲", mont: "▼" });
    });

    it("total: Barcelona ▲, Mont-Saxonnex ≈, La Réunion ▼", () => {
      const result = trends({
        barcelona: scenarios.barcelona.totalEur,
        reunion: scenarios.reunion.totalEur,
        mont: scenarios.mont.totalEur,
      });
      expect(result).toEqual({ barcelona: "▲", reunion: "▼", mont: "≈" });
    });
  });
});
