import { describe, expect, it } from "vitest";
import { blockersOf, countVotes, decidingCriterion, explainBlockers, rankDestinations, recommendedDestination } from "@/core/recommend";
import type { GuestScenario, Scenario } from "@/core/scenario";
import type { BudgetTier, TransportOption } from "@/core/types";
import { loadScenario } from "./helpers/scenario";

const s = loadScenario();
const barcelonaId = s.destinations.barcelona.id;
const montId = s.destinations["mont-saxonnex"].id;
const reunionId = s.destinations["la-reunion"].id;
const scenarios = (["barcelona", "la-reunion", "mont-saxonnex"] as const).map((key) => s.scenarioFor(key));

/** The guests with their ★: Chloé → La Réunion, Martin and Jessy → Barcelona (C.1 step 4). */
const voters = [
  { ...s.chloe, favoriteDestinationId: reunionId },
  { ...s.martin, favoriteDestinationId: barcelonaId },
  { ...s.jessy, favoriteDestinationId: barcelonaId },
];

// With the Extra in the budget (use-cases.md UC-D, D.4, task.md T8.9): no destination works for everyone (Jessy's
// 400 € does not cover food and the tax anywhere), Barcelona is the closest, then Mont-Saxonnex by the smaller overrun
describe("UC-C: the table C.2, with the Extra (D.4)", () => {
  const ranked = rankDestinations(scenarios, countVotes(voters));
  const by = (id: string) => ranked.find((destination) => destination.destinationId === id)!;

  it("ranks Barcelona first, then Mont-Saxonnex, then La Réunion", () => {
    expect(ranked.map((destination) => destination.destinationId)).toEqual([barcelonaId, montId, reunionId]);
    expect(ranked.map((destination) => destination.rank)).toEqual([1, 2, 3]);
  });

  it("makes none eligible", () => {
    expect(ranked.map((destination) => destination.eligible)).toEqual([false, false, false]);
  });

  it("counts the ★: 2 for Barcelona, 0 for Mont-Saxonnex, 1 for La Réunion", () => {
    expect([by(barcelonaId).votes, by(montId).votes, by(reunionId).votes]).toEqual([2, 0, 1]);
  });

  it("recommends none, Chloé's ★ for La Réunion or not", () => {
    expect(recommendedDestination(ranked)).toBeNull();
  });

  it("does not let every guest's ★ for La Réunion change anything (C-S5)", () => {
    const allForReunion = voters.map((guest) => ({ ...guest, favoriteDestinationId: reunionId }));
    const result = rankDestinations(scenarios, countVotes(allForReunion));
    expect(recommendedDestination(result)).toBeNull();
    expect(result.map((d) => d.destinationId)).toEqual([barcelonaId, montId, reunionId]);
    expect(result.find((d) => d.destinationId === reunionId)?.eligible).toBe(false);
  });

  it("explains what blocks each destination (C-S6): the core's overrun, the Plus does not count", () => {
    expect(explainBlockers(scenarios[0])).toEqual(["Jessy +172 €"]);
    expect(explainBlockers(scenarios[1])).toEqual(["Chloé +673 €", "Jessy +1693 €", "Martin ⛔"]);
    expect(explainBlockers(scenarios[2])).toEqual(["Martin +440 €", "Jessy +676 €"]);
  });

  it("describes the blockers in a structured way too", () => {
    expect(blockersOf(scenarios[2])).toEqual([
      { kind: "over", guestId: s.martin.id, name: "Martin", overBudgetEur: 440 },
      { kind: "over", guestId: s.jessy.id, name: "Jessy", overBudgetEur: 676 },
    ]);
  });

  it("carries the totals, the comfy guest counts and the overruns used to rank", () => {
    expect(by(barcelonaId)).toMatchObject({ totalEur: 2697, comfyGuests: 1, overrunEur: 172 });
    expect(by(montId)).toMatchObject({ comfyGuests: 0, overrunEur: 1116 });
    expect(by(montId).totalEur).toBeCloseTo(3684.8, 6);
    expect(by(reunionId).comfyGuests).toBe(0);
    expect(by(reunionId).overrunEur).toBeCloseTo(3658, 6);
  });
});

describe("countVotes", () => {
  it("counts one vote per guest and ignores guests who did not vote", () => {
    const votes = countVotes([...voters, { favoriteDestinationId: null }]);
    expect(votes.get(barcelonaId)).toBe(2);
    expect(votes.get(reunionId)).toBe(1);
    expect(votes.has(montId)).toBe(false);
  });
});

// Hand-built scenarios, to check each ranking criterion on its own
type FakeGuest = { tier: BudgetTier; comfort?: number; unreachable?: boolean; over?: number };

function fake(id: string, guests: FakeGuest[], totalEur = 1000): Scenario {
  const guestScenarios = guests.map(
    (guest, i): GuestScenario => ({
      guestId: `${id}-g${i}`,
      name: `G${i}`,
      maxBudgetEur: 1000,
      status: guest.unreachable ? "unreachable" : "ok",
      reason: null,
      transport: {
        option: {} as TransportOption,
        comfort: { level: "green", score: guest.comfort ?? 50, reasons: [] },
        costEur: 100,
        source: "default",
      },
      housingShareEur: 0,
      mandatoryEur: null,
      plusEur: null,
      costEur: 100,
      tier: guest.tier,
      overBudgetEur: guest.tier === "over" ? (guest.over ?? 10) : 0,
    }),
  );
  return {
    destinationId: id,
    groupSize: guests.length,
    stay: null,
    staySource: null,
    housingTotalEur: 0,
    housingShareEur: 0,
    guests: guestScenarios,
    totalEur,
    averagePerGuestEur: totalEur / guests.length,
    totalIncludesFallback: false,
    totalComplete: true,
    tier: guests.some((g) => g.tier === "over") ? "over" : "limited",
    withExtra: false,
  };
}

const order = (ranked: ReturnType<typeof rankDestinations>) => ranked.map((d) => d.destinationId);
const noVotes = new Map<string, number>();

describe("ranking criteria (R7)", () => {
  it("1. an eligible destination beats any ineligible one, however comfortable", () => {
    const eligibleButTight = fake("A", [{ tier: "limited" }, { tier: "limited" }]);
    const almostPerfect = fake("B", [{ tier: "comfy" }, { tier: "comfy" }, { tier: "over" }]);
    expect(order(rankDestinations([almostPerfect, eligibleButTight], noVotes))).toEqual(["A", "B"]);
  });

  it("1. an unreachable guest makes a destination ineligible", () => {
    const blocked = fake("A", [{ tier: "comfy" }, { tier: "over", unreachable: true }]);
    const fine = fake("B", [{ tier: "limited" }, { tier: "limited" }]);
    expect(rankDestinations([blocked, fine], noVotes).map((d) => d.eligible)).toEqual([true, false]);
  });

  it("2. more guests comfortably within budget wins, even if it costs more and has fewer ★", () => {
    const moreComfy = fake("A", [{ tier: "comfy" }, { tier: "comfy" }], 2000);
    const cheaper = fake("B", [{ tier: "comfy" }, { tier: "limited" }], 500);
    expect(order(rankDestinations([cheaper, moreComfy], new Map([["B", 3]])))).toEqual(["A", "B"]);
  });

  it("3. on equal comfy counts, the better average comfort wins", () => {
    const comfortable = fake("A", [{ tier: "comfy", comfort: 90 }, { tier: "comfy", comfort: 70 }], 2000);
    const rough = fake("B", [{ tier: "comfy", comfort: 60 }, { tier: "comfy", comfort: 50 }], 500);
    expect(order(rankDestinations([rough, comfortable], new Map([["B", 3]])))).toEqual(["A", "B"]);
  });

  it("4. on equal comfort, more ★ wins even if it costs more", () => {
    const loved = fake("A", [{ tier: "comfy" }], 2000);
    const cheap = fake("B", [{ tier: "comfy" }], 500);
    expect(order(rankDestinations([cheap, loved], new Map([["A", 2], ["B", 1]])))).toEqual(["A", "B"]);
  });

  it("5. on a full tie, the cheaper total wins", () => {
    const dear = fake("A", [{ tier: "comfy" }], 2000);
    const cheap = fake("B", [{ tier: "comfy" }], 500);
    expect(order(rankDestinations([dear, cheap], noVotes))).toEqual(["B", "A"]);
  });

  it("keeps the given order when everything is equal", () => {
    const a = fake("A", [{ tier: "comfy" }]);
    const b = fake("B", [{ tier: "comfy" }]);
    expect(order(rankDestinations([a, b], noVotes))).toEqual(["A", "B"]);
    expect(order(rankDestinations([b, a], noVotes))).toEqual(["B", "A"]);
  });

  it("recommends nothing when no destination is eligible", () => {
    const ranked = rankDestinations(
      [fake("A", [{ tier: "over" }]), fake("B", [{ tier: "comfy" }, { tier: "over", over: 25 }])],
      noVotes,
    );
    expect(recommendedDestination(ranked)).toBeNull();
    // the blockers still say what to fix and by how much; B ranks first, it has a comfy guest
    expect(ranked.map((d) => d.destinationId)).toEqual(["B", "A"]);
    expect(ranked.flatMap((d) => d.blockers.map((b) => b.kind === "over" && b.overBudgetEur))).toEqual([25, 10]);
  });

  it("ranks an empty list as empty", () => {
    expect(rankDestinations([], noVotes)).toEqual([]);
    expect(recommendedDestination([])).toBeNull();
  });
});

describe("decidingCriterion (the sentence behind \"Why?\", C-S6)", () => {
  const ranked = rankDestinations(scenarios, countVotes(voters));
  const byId = (id: string) => ranked.find((d) => d.destinationId === id)!;

  it("says Barcelona is ahead for its comfy guest, and Mont-Saxonnex ahead of La Réunion for its smaller overrun (open question 6)", () => {
    expect(decidingCriterion(byId(barcelonaId), byId(montId))).toBe("comfy");
    expect(decidingCriterion(byId(barcelonaId), byId(reunionId))).toBe("comfy");
    expect(decidingCriterion(byId(montId), byId(reunionId))).toBe("overrun");
  });

  it("goes down the criteria in the order of R7 when the first ones are equal", () => {
    const base = { eligible: true, comfyGuests: 2, overrunEur: 0, averageComfortScore: 80, votes: 1, totalEur: 1000, blockers: [], rank: 1, destinationId: "x" };
    expect(decidingCriterion(base, { ...base, comfyGuests: 1 })).toBe("comfy");
    expect(decidingCriterion(base, { ...base, overrunEur: 90 })).toBe("overrun");
    expect(decidingCriterion(base, { ...base, averageComfortScore: 70 })).toBe("comfort");
    expect(decidingCriterion(base, { ...base, votes: 0 })).toBe("votes");
    expect(decidingCriterion(base, { ...base, totalEur: 1200 })).toBe("price");
    expect(decidingCriterion(base, { ...base })).toBe("order");
  });

  it("treats a destination with no comfort score as worse than any", () => {
    const base = { eligible: true, comfyGuests: 0, overrunEur: 0, averageComfortScore: 0, votes: 0, totalEur: 1, blockers: [], rank: 1, destinationId: "x" };
    expect(decidingCriterion(base, { ...base, averageComfortScore: null })).toBe("comfort");
  });
});
