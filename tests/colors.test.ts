import { describe, expect, it } from "vitest";
import { colorOf } from "@/core/colors";
import { coverageOf } from "@/core/dates";

describe("colorOf (R8)", () => {
  it("budget: comfy is green, limited yellow, over red", () => {
    expect(colorOf("budget", "comfy")).toBe("green");
    expect(colorOf("budget", "limited")).toBe("yellow");
    expect(colorOf("budget", "over")).toBe("red");
    expect(colorOf("budget", null)).toBe("neutral");
  });

  it("comfort: passes the traffic light through", () => {
    expect(colorOf("comfort", "green")).toBe("green");
    expect(colorOf("comfort", "yellow")).toBe("yellow");
    expect(colorOf("comfort", "red")).toBe("red");
    expect(colorOf("comfort", undefined)).toBe("neutral");
  });

  it("dates: covers is green, partly yellow, not red", () => {
    expect(colorOf("dates", "covers")).toBe("green");
    expect(colorOf("dates", "partial")).toBe("yellow");
    expect(colorOf("dates", "none")).toBe("red");
  });

  it("trend: the lowest figure is green, the highest red, the rest yellow", () => {
    expect(colorOf("trend", "▲")).toBe("green");
    expect(colorOf("trend", "▼")).toBe("red");
    expect(colorOf("trend", "≈")).toBe("yellow");
    expect(colorOf("trend", undefined)).toBe("neutral");
  });

  it("aiVerdict: good green, ok yellow, bad red, unavailable grey (B.5)", () => {
    expect(colorOf("aiVerdict", "good")).toBe("green");
    expect(colorOf("aiVerdict", "ok")).toBe("yellow");
    expect(colorOf("aiVerdict", "bad")).toBe("red");
    expect(colorOf("aiVerdict", null)).toBe("neutral");
  });

  describe("relativePrice", () => {
    const prices = [300, 450, 600];

    it("splits the price range in thirds: cheapest green, middle yellow, dearest red", () => {
      expect(colorOf("relativePrice", 300, prices)).toBe("green");
      expect(colorOf("relativePrice", 450, prices)).toBe("yellow");
      expect(colorOf("relativePrice", 600, prices)).toBe("red");
    });

    it("gives the same colour to equal prices", () => {
      const tied = [300, 300, 600];
      expect(colorOf("relativePrice", 300, tied)).toBe("green");
      expect(colorOf("relativePrice", 600, tied)).toBe("red");
    });

    it("with two prices, the cheaper is green and the dearer red (Airbnb 900 € vs hotel 1,200 €)", () => {
      expect(colorOf("relativePrice", 900, [900, 1200])).toBe("green");
      expect(colorOf("relativePrice", 1200, [900, 1200])).toBe("red");
    });

    it("is neutral when there is nothing to compare with", () => {
      expect(colorOf("relativePrice", 300, [300])).toBe("neutral");
      expect(colorOf("relativePrice", 300, [300, 300, 300])).toBe("neutral");
    });
  });
});

describe("coverageOf", () => {
  const window = { from: "2027-08-26", to: "2027-09-05" };

  it("covers when the availability holds the whole window", () => {
    expect(coverageOf({ availableFrom: "2027-08-26", availableTo: "2027-09-14" }, window)).toBe("covers");
    expect(coverageOf({ availableFrom: "2027-08-26", availableTo: "2027-09-05" }, window)).toBe("covers");
  });

  it("is partial when it only overlaps", () => {
    expect(coverageOf({ availableFrom: "2027-08-26", availableTo: "2027-09-01" }, window)).toBe("partial");
    expect(coverageOf({ availableFrom: "2027-09-05", availableTo: "2027-09-14" }, window)).toBe("partial");
  });

  it("is none when it does not touch the window", () => {
    expect(coverageOf({ availableFrom: "2027-09-06", availableTo: "2027-09-14" }, window)).toBe("none");
  });
});
