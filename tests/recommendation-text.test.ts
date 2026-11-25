import { describe, expect, it } from "vitest";
import { blockerText, headlineOf, reasonText } from "@/lib/recommendationText";
import type { BlockerView, RecommendationReason } from "@/server/services/dashboard";

const over = (name: string, overBudgetEur: number): BlockerView => ({ kind: "over", guestId: name, name, overBudgetEur });
const cannot = (fallback: Extract<BlockerView, { kind: "unreachable" }>["fallback"]): BlockerView => ({
  kind: "unreachable", guestId: "m", name: "Martin", modes: ["car"], fallback,
});

describe("blockerText (use-cases.md C.1 step 5)", () => {
  it("writes an overrun as the budget page does", () => {
    expect(blockerText(over("Jessy", 906.67))).toBe("Jessy +907 €");
  });

  it("explains a guest who cannot get there, with the fallback's overrun: Martin, car, plane +507 €", () => {
    expect(blockerText(cannot({ mode: "plane", costEur: 1306.67, overBudgetEur: 506.67 }))).toBe("Martin cannot go by car (plane fallback: +507 €)");
  });

  it("says when the fallback would fit, and when there is none", () => {
    expect(blockerText(cannot({ mode: "plane", costEur: 700, overBudgetEur: 0 }))).toBe("Martin cannot go by car (plane fallback: 700 €)");
    expect(blockerText(cannot(null))).toBe("Martin cannot go by car (no other way found)");
  });

  it("lists several accepted modes", () => {
    expect(blockerText({ kind: "unreachable", guestId: "m", name: "Martin", modes: ["car", "train"], fallback: null })).toBe("Martin cannot go by car or train (no other way found)");
  });
});

describe("headlineOf", () => {
  it("is \"Barcelona works for everyone: 1,235 € in total.\" when something works", () => {
    expect(headlineOf({ works: true, shortLabel: "Barcelona", totalEur: 1235 })).toBe("Barcelona works for everyone: 1235 € in total.");
  });

  it("says so, and names the closest, when nothing works", () => {
    expect(headlineOf({ works: false, shortLabel: "Barcelona", totalEur: 1235 })).toBe("No destination works for everyone yet. Closest: Barcelona.");
  });
});

describe("reasonText", () => {
  const standing = { comfyGuests: 2, overrunEur: 0, averageComfort: 84.4, votes: 1, totalEur: 1235 };
  const leads = (criterion: Extract<RecommendationReason, { kind: "leads" }>["criterion"], theirs = {}): RecommendationReason => ({
    kind: "leads", criterion, over: "Mont-Saxonnex", mine: standing, theirs: { ...standing, ...theirs }, theirBlockers: [over("Jessy", 90)],
  });

  it("backs 'works' with the numbers", () => {
    expect(reasonText({ kind: "works", comfyGuests: 2, guests: 3, averageComfort: 84.4 })).toBe(
      "Everyone can get there and nobody is over budget. 2 of 3 guests are comfortably within budget, and the journeys average 84/100 for comfort.",
    );
    expect(reasonText({ kind: "works", comfyGuests: 3, guests: 3, averageComfort: null })).not.toContain("comfort.");
  });

  it("says which criterion put it ahead, with both figures", () => {
    expect(reasonText(leads("eligibility"))).toBe("Mont-Saxonnex doesn't work for everyone: Jessy +90 €.");
    expect(reasonText(leads("comfy", { comfyGuests: 1 }))).toBe("Mont-Saxonnex has fewer guests comfortably within budget (1 against 2).");
    expect(reasonText(leads("comfort", { averageComfort: 70 }))).toBe("Mont-Saxonnex's journeys are less comfortable (70/100 against 84/100).");
    expect(reasonText(leads("votes", { votes: 0 }))).toBe("Level with Mont-Saxonnex on everything else, it has more ★ (1 against 0).");
    expect(reasonText(leads("price", { totalEur: 1500 }))).toBe("Level with Mont-Saxonnex on everything else, it is cheaper (1235 € against 1500 €).");
    expect(reasonText(leads("order"))).toContain("the order the destinations were added decides");
  });

  it("says who is in the way when nothing works", () => {
    expect(reasonText({ kind: "closest", blockers: [over("Jessy", 70)] })).toBe("It is the closest to working. In the way: Jessy +70 €.");
  });

  it("explains that a ★ cannot make a destination eligible, in the singular and the plural", () => {
    const blockers = [over("Jessy", 907), cannot({ mode: "plane", costEur: 1306.67, overBudgetEur: 506.67 })];
    expect(reasonText({ kind: "star_cannot_override", names: ["Chloé"], destination: "Réunion", blockers })).toBe(
      "Chloé puts a ★ on Réunion, but a ★ never makes a destination eligible (Jessy +907 €, Martin cannot go by car (plane fallback: +507 €)).",
    );
    expect(reasonText({ kind: "star_cannot_override", names: ["Chloé", "Martin"], destination: "Réunion", blockers })).toContain("Chloé, Martin put a ★");
  });
});
