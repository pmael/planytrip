import { describe, expect, it } from "vitest";
import { blockedText, providerLabel, uncomfortableText, VARIANT_LABELS } from "@/lib/transportText";

describe("providerLabel", () => {
  it("writes the companies' names the way they do", () => {
    expect(providerLabel("easyjet")).toBe("easyJet");
    expect(providerLabel("air-austral")).toBe("Air Austral");
  });

  it("makes a readable name out of one it doesn't know", () => {
    expect(providerLabel("norse-atlantic")).toBe("Norse Atlantic");
  });
});

describe("uncomfortableText", () => {
  it("names what makes an option red (use-cases.md B.1 step 2)", () => {
    expect(uncomfortableText(["3 stops", "23 h 40 of travel, over 20 h"])).toBe("Uncomfortable: 3 stops, 23 h 40 of travel, over 20 h");
  });

  it("still says it when there is no detail", () => {
    expect(uncomfortableText([])).toBe("Uncomfortable");
  });
});

describe("blockedText", () => {
  it("says why a mode has nothing", () => {
    expect(blockedText("no_road_route", "Réunion")).toBe("There is no road to Réunion");
    expect(blockedText("no_airport", "Le Mont-Saxonnex")).toBe("There is no airport near Le Mont-Saxonnex");
    expect(blockedText("anything_else", "Rome")).toBe("Can't get to Rome this way");
  });
});

describe("VARIANT_LABELS", () => {
  it("only labels the variants that set a car option apart", () => {
    expect(VARIANT_LABELS.standard).toBeNull();
    expect(VARIANT_LABELS.overnight_stop).toBe("Overnight stop");
  });
});
