import { describe, expect, it } from "vitest";
import { pickCheapest, pickDefaultStay, pickMostPractical } from "@/core/scenario";
import type { OptionRating, StayAnalysis, StayOption, TransportOption } from "@/core/types";
import { judgementOf, mergeJudgement } from "@/server/services/scenarios";

/** Just the parts of an option the picks look at. */
const option = (id: string, priceEur: number, over: Partial<TransportOption> = {}) =>
  ({ id, priceEur, priceUnit: "per_person", lastMileEur: 0, comfortLevel: "green", comfortScore: 80, rating: null, ...over }) as TransportOption;
const rating = (verdict: OptionRating["verdict"], score: number, source: OptionRating["source"] = "ai"): OptionRating => ({ verdict, score, reason: "-", source });

describe("pickCheapest with ratings (R3)", () => {
  it("skips the option rated bad for the next cheapest that is comfortable", () => {
    const picked = pickCheapest([option("cheap-but-bad", 80, { rating: rating("bad", 10) }), option("fine", 120, { rating: rating("ok", 60) }), option("dear", 300)]);
    expect(picked?.id).toBe("fine");
  });

  it("still takes an option nobody rated, and one the rules rated: only a bad one is set aside", () => {
    expect(pickCheapest([option("unrated", 90), option("rules", 120, { rating: rating("good", 90, "rules") })])?.id).toBe("unrated");
  });

  it("falls back to the cheapest comfortable one when all of them were rated bad, so that there is still a journey to count", () => {
    const picked = pickCheapest([option("a", 150, { rating: rating("bad", 20) }), option("b", 100, { rating: rating("bad", 30) })]);
    expect(picked?.id).toBe("b");
  });

  it("never takes a red option for its rating: the comfort rule comes first", () => {
    const picked = pickCheapest([option("red-and-loved", 50, { comfortLevel: "red", rating: rating("good", 95) }), option("bad-but-comfortable", 200, { rating: rating("bad", 10) })]);
    expect(picked?.id).toBe("bad-but-comfortable");
    expect(pickCheapest([option("only-red", 50, { comfortLevel: "red" })])).toBeNull();
  });
});

describe("pickMostPractical with ratings (B-S2)", () => {
  it("leaves out an option rated bad, however comfortable", () => {
    const picked = pickMostPractical([option("best-comfort-bad", 100, { comfortScore: 95, rating: rating("bad", 5) }), option("next", 100, { comfortScore: 80 })]);
    expect(picked?.id).toBe("next");
  });

  it("breaks a tie of comfort by the rating, then by the price", () => {
    const tied = [option("cheap", 90, { rating: rating("ok", 50) }), option("rated-higher", 150, { rating: rating("good", 85) }), option("unrated", 80)];
    expect(pickMostPractical(tied)?.id).toBe("rated-higher");
    expect(pickMostPractical([option("dear", 200), option("cheap", 100)])?.id).toBe("cheap");
  });

  it("gives the best of the bad ones when every option was rated bad", () => {
    expect(pickMostPractical([option("a", 100, { comfortScore: 60, rating: rating("bad", 10) }), option("b", 100, { comfortScore: 70, rating: rating("bad", 5) })])?.id).toBe("b");
  });

  it("has nothing to pick when there is nothing", () => {
    expect(pickMostPractical([])).toBeNull();
  });
});

const stay = (id: string, totalPriceEur: number, capacity = 3) => ({ id, totalPriceEur, capacity }) as StayOption;
const analysis = (stayId: string, verdict: StayAnalysis["verdict"], fitScore: number) => ({ stayId, verdict, fitScore }) as StayAnalysis;

describe("pickDefaultStay with ratings (R4)", () => {
  it("takes the cheapest that fits and was not judged bad", () => {
    const stays = [stay("cheap-bad", 500), stay("middle", 800), stay("dear", 1500), stay("too-small", 300, 2)];
    const analyses = new Map([["cheap-bad", analysis("cheap-bad", "bad", 15)], ["middle", analysis("middle", "ok", 55)]]);
    expect(pickDefaultStay(stays, analyses, 3)?.id).toBe("middle");
  });

  it("counts a stay that nobody rated as eligible", () => {
    expect(pickDefaultStay([stay("unrated", 700), stay("rated", 900)], new Map([["rated", analysis("rated", "good", 90)]]), 3)?.id).toBe("unrated");
  });

  it("breaks a tie of price by the better fit", () => {
    const analyses = new Map([["a", analysis("a", "ok", 50)], ["b", analysis("b", "good", 85)]]);
    expect(pickDefaultStay([stay("a", 800), stay("b", 800)], analyses, 3)?.id).toBe("b");
  });

  it("keeps a destination's accommodation when every one that fits was judged bad: the cheapest of them, still flagged by its rating", () => {
    const analyses = new Map([["x", analysis("x", "bad", 20)], ["y", analysis("y", "bad", 10)]]);
    expect(pickDefaultStay([stay("y", 1200), stay("x", 900)], analyses, 3)?.id).toBe("x");
  });

  it("is null when nothing sleeps the group", () => {
    expect(pickDefaultStay([stay("small", 300, 2)], new Map(), 3)).toBeNull();
  });
});

describe("mergeJudgement: what the cards know about a stay", () => {
  const explanation: StayAnalysis = {
    id: "an1", stayId: "s1", verdict: "ok", fitScore: 55, pros: ["Central"], cons: ["Noisy"], summary: "A lively flat.", inputHash: "abc", createdAt: "2027-01-01T00:00:00.000Z",
  };

  it("takes the score and the verdict from the rating, and the words from the explanation when there is one", () => {
    const merged = mergeJudgement("s1", rating("good", 88), explanation)!;
    expect(merged).toMatchObject({ stayId: "s1", verdict: "good", fitScore: 88, ratedBy: "ai", explained: true, pros: ["Central"], cons: ["Noisy"], summary: "A lively flat.", inputHash: "abc" });
  });

  it("speaks with the rating's own reason until the AI has been asked to explain", () => {
    const merged = mergeJudgement("s1", { ...rating("ok", 50, "rules"), reason: "Rules only: 300 € each" }, null)!;
    expect(merged).toMatchObject({ verdict: "ok", fitScore: 50, ratedBy: "rules", explained: false, pros: [], cons: [], summary: "Rules only: 300 € each", ratingReason: "Rules only: 300 € each", inputHash: "" });
  });

  it("gives an old explanation as it is when no rating was ever made, and marks it explained", () => {
    expect(mergeJudgement("s1", null, explanation)).toMatchObject({ verdict: "ok", fitScore: 55, explained: true, summary: "A lively flat." });
    expect(mergeJudgement("s1", null, explanation)?.ratedBy).toBeUndefined();
  });

  it("knows nothing about a stay with neither", () => {
    expect(mergeJudgement("s1", null, null)).toBeNull();
  });
});

describe("judgementOf: the same, as a card shows it", () => {
  it("is nothing for no analysis", () => {
    expect(judgementOf(undefined)).toBeNull();
  });

  it("says who rated it and whether it was explained, and leaves the database's bookkeeping out", () => {
    const merged = mergeJudgement("s1", rating("good", 70), null)!;
    expect(judgementOf(merged)).toEqual({ verdict: "good", fitScore: 70, summary: "-", pros: [], cons: [], ratedBy: "ai", explained: false });
  });

  it("calls an analysis from before ratings existed the AI's own: no rating, but explained", () => {
    const legacy = { id: "a", stayId: "s", verdict: "ok", fitScore: 62, pros: [], cons: [], summary: "-", inputHash: "seed", createdAt: "x" } as StayAnalysis;
    expect(judgementOf(legacy)).toMatchObject({ ratedBy: null, explained: true });
  });
});
