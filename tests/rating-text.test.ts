import { describe, expect, it } from "vitest";
import { listOf, ratingNoticesOf } from "@/lib/ratingText";

describe("listOf", () => {
  it("lists the way a sentence does", () => {
    expect(listOf([])).toBe("");
    expect(listOf(["Paris"])).toBe("Paris");
    expect(listOf(["Paris", "Rome"])).toBe("Paris and Rome");
    expect(listOf(["Paris", "Rome", "Lyon"])).toBe("Paris, Rome and Lyon");
  });
});

describe("ratingNoticesOf", () => {
  it("has nothing to say when the AI rated everything, and for what is not up to date it is silent too", () => {
    expect(ratingNoticesOf({ byRules: [], stale: [] })).toEqual({ notRated: null, outOfDate: null });
  });

  it("says what the rules rated because the AI was not there, and why when it is known", () => {
    const { notRated, outOfDate } = ratingNoticesOf({
      byRules: [
        { destination: "Barcelona", kind: "stays", message: null },
        { destination: "Réunion", kind: "stays", message: "The `claude` command was not found" },
        { destination: "Barcelona", kind: "transport", message: null },
      ],
      stale: [],
    });
    expect(outOfDate).toBeNull();
    expect(notRated).toMatchObject({
      title: "Not rated by the AI",
      text: "The housing at Barcelona and Réunion and the transport to Barcelona were scored with simple rules instead of the AI, because it wasn’t available.",
      detail: "The `claude` command was not found",
      action: "Rate with the AI",
    });
  });

  it("speaks in the singular for one thing at one destination", () => {
    const { notRated } = ratingNoticesOf({ byRules: [{ destination: "Barcelona", kind: "stays", message: null }], stale: [] });
    expect(notRated?.text).toBe("The housing at Barcelona was scored with simple rules instead of the AI, because it wasn’t available.");
    expect(notRated?.detail).toBeNull();
  });

  it("flags what the AI rated for facts that have changed, and says nothing is asked of the AI until the person says so", () => {
    const { notRated, outOfDate } = ratingNoticesOf({ byRules: [], stale: [{ destination: "Barcelona", kind: "transport" }, { destination: "Barcelona", kind: "stays" }] });
    expect(notRated).toBeNull();
    expect(outOfDate).toMatchObject({ title: "These scores may be out of date", action: "Re-rate with the AI" });
    expect(outOfDate?.text).toContain("the housing at Barcelona and the transport to Barcelona");
    expect(outOfDate?.text).toContain("nothing is asked of the AI until you do");
  });

  it("can say both at once, about different destinations", () => {
    const notices = ratingNoticesOf({
      byRules: [{ destination: "Réunion", kind: "stays", message: null }],
      stale: [{ destination: "Barcelona", kind: "stays" }],
    });
    expect(notices.notRated?.text).toContain("The housing at Réunion was scored");
    expect(notices.outOfDate?.text).toContain("the housing at Barcelona");
  });
});
