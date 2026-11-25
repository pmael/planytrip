import { describe, expect, it } from "vitest";
import { blockerLabel, countryName, guestHue, initialsOf, standingOfCell, verdictOf, withVotes } from "@/lib/deliberationText";
import type { ReadyDeliberation } from "@/server/services/deliberation";

describe("text helpers", () => {
  it("names countries and takes initials", () => {
    expect(countryName("FR")).toBe("France");
    expect(countryName("es")).toBe("Spain");
    expect(initialsOf("Martin")).toBe("M");
    expect(initialsOf("Jean Paul Sartre")).toBe("JP");
    expect(initialsOf("  ")).toBe("");
  });

  it("gives each guest a colour that wraps around", () => {
    expect(guestHue(0)).not.toBe(guestHue(1));
    expect(guestHue(6)).toBe(guestHue(0));
  });

  it("writes blockers as the budget page does (C-S6)", () => {
    expect(blockerLabel({ kind: "over", guestId: "j", name: "Jessy", overBudgetEur: 89.6 })).toBe("Jessy +90 €");
    expect(blockerLabel({ kind: "unreachable", guestId: "m", name: "Martin" })).toBe("Martin ⛔");
  });

  it("reads a guest's state at a destination in one word", () => {
    expect(standingOfCell({ status: "ok", tier: "limited" })).toBe("limited");
    expect(standingOfCell({ status: "unreachable", tier: "over" })).toBe("unreachable");
  });

  it("says whether a destination works for everyone", () => {
    const standing = { comfy: 2, limited: 1, over: 0, unreachable: 0 };
    expect(verdictOf({ eligible: true, standing, blockers: [] }, 3)).toBe("Works for everyone, 2 of 3 comfortably");
    expect(verdictOf({ eligible: true, standing: { ...standing, comfy: 3, limited: 0 }, blockers: [] }, 3)).toBe("Works for everyone, comfortably");
    expect(verdictOf({ eligible: false, standing, blockers: [{ kind: "unreachable", guestId: "m", name: "Martin" }] }, 3)).toBe("Doesn't work for 1 of 3");
  });
});

describe("withVotes", () => {
  const cell = (guestId: string, destinationId: string, starred: boolean) => ({ guestId, destinationId, starred }) as ReadyDeliberation["destinations"][number]["cells"][number];
  const view = {
    kind: "ready",
    guests: [
      { id: "m", favoriteId: "a" },
      { id: "j", favoriteId: null },
    ],
    destinations: [
      { id: "a", votes: { count: 1, guestIds: ["m"] }, cells: [cell("m", "a", true), cell("j", "a", false)] },
      { id: "b", votes: { count: 0, guestIds: [] }, cells: [cell("m", "b", false), cell("j", "b", false)] },
    ],
  } as unknown as ReadyDeliberation;

  it("changes nothing without a vote of its own", () => {
    const same = withVotes(view, {});
    expect(same.destinations.map((d) => d.votes.count)).toEqual([1, 0]);
    expect(same.guests.map((g) => g.favoriteId)).toEqual(["a", null]);
  });

  it("moves a guest's ★ to another destination, counts and cells included", () => {
    const moved = withVotes(view, { m: "b", j: "b" });
    expect(moved.guests.map((g) => g.favoriteId)).toEqual(["b", "b"]);
    expect(moved.destinations.map((d) => [d.id, d.votes.count, d.votes.guestIds])).toEqual([["a", 0, []], ["b", 2, ["m", "j"]]]);
    expect(moved.destinations[1].cells.map((c) => c.starred)).toEqual([true, true]);
    expect(moved.destinations[0].cells.map((c) => c.starred)).toEqual([false, false]);
  });

  it("takes a ★ off with null, and leaves the original alone", () => {
    const off = withVotes(view, { m: null });
    expect(off.destinations[0].votes).toEqual({ count: 0, guestIds: [] });
    expect(view.destinations[0].votes.count).toBe(1);
  });
});
