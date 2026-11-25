import { describe, expect, it } from "vitest";
import { addDays, commonWindow, limitingGuests, nightsBetween, noCommonDates, tripWindow } from "@/core/dates";

const guest = (name: string, availableFrom: string, availableTo: string) => ({ name, availableFrom, availableTo });

// The reference scenario (use-cases.md §1.1)
const martin = guest("Martin", "2027-08-26", "2027-09-05");
const chloe = guest("Chloé", "2027-08-26", "2027-09-14");
const jessy = guest("Jessy", "2027-08-26", "2027-09-14");
const scenario = [martin, chloe, jessy];

describe("reference scenario", () => {
  it("has a common window of 26/08 → 05/09, i.e. 10 nights", () => {
    const window = commonWindow(scenario);
    expect(window).toEqual({ from: "2027-08-26", to: "2027-09-05" });
    expect(nightsBetween(window!)).toBe(10);
  });

  it("is limited by Martin alone", () => {
    const window = commonWindow(scenario)!;
    expect(limitingGuests(scenario, window)).toEqual([martin]);
  });
});

describe("commonWindow", () => {
  it("is the guest's own availability when there is one guest", () => {
    expect(commonWindow([chloe])).toEqual({ from: "2027-08-26", to: "2027-09-14" });
  });

  it("is null without guests", () => {
    expect(commonWindow([])).toBeNull();
  });

  it("is null when two guests never overlap (A-S2)", () => {
    expect(commonWindow([martin, guest("Late", "2027-09-10", "2027-09-14")])).toBeNull();
  });

  it("takes the latest start and the earliest end, whatever the order", () => {
    const a = guest("A", "2027-08-20", "2027-09-20");
    const b = guest("B", "2027-08-28", "2027-09-10");
    const c = guest("C", "2027-08-25", "2027-09-30");
    expect(commonWindow([a, b, c])).toEqual({ from: "2027-08-28", to: "2027-09-10" });
    expect(commonWindow([c, b, a])).toEqual({ from: "2027-08-28", to: "2027-09-10" });
  });

  it("keeps a one-day overlap as a window with 0 nights", () => {
    const window = commonWindow([martin, guest("Late", "2027-09-05", "2027-09-14")]);
    expect(window).toEqual({ from: "2027-09-05", to: "2027-09-05" });
    expect(nightsBetween(window!)).toBe(0);
  });

  describe("with a destination's own dates", () => {
    it("narrows the window", () => {
      expect(commonWindow(scenario, { dateFrom: "2027-08-28", dateTo: "2027-09-02" })).toEqual({
        from: "2027-08-28",
        to: "2027-09-02",
      });
    });

    it("ignores destination dates that are wider than the guests'", () => {
      expect(commonWindow(scenario, { dateFrom: "2027-08-01", dateTo: "2027-12-31" })).toEqual({
        from: "2027-08-26",
        to: "2027-09-05",
      });
    });

    it("applies only the date that is given", () => {
      expect(commonWindow(scenario, { dateFrom: "2027-08-30", dateTo: null })).toEqual({
        from: "2027-08-30",
        to: "2027-09-05",
      });
      expect(commonWindow(scenario, { dateFrom: null, dateTo: "2027-09-01" })).toEqual({
        from: "2027-08-26",
        to: "2027-09-01",
      });
    });

    it("is null when the destination dates are outside every availability", () => {
      expect(commonWindow(scenario, { dateFrom: "2027-09-08", dateTo: "2027-09-12" })).toBeNull();
    });
  });
});

describe("nightsBetween", () => {
  it("counts across a month change", () => {
    expect(nightsBetween({ from: "2027-08-30", to: "2027-09-02" })).toBe(3);
  });

  it("counts a leap day", () => {
    expect(nightsBetween({ from: "2028-02-28", to: "2028-03-01" })).toBe(2);
  });

  it("is not shifted by daylight saving changes", () => {
    expect(nightsBetween({ from: "2027-03-27", to: "2027-03-29" })).toBe(2);
    expect(nightsBetween({ from: "2027-10-30", to: "2027-11-01" })).toBe(2);
  });
});

describe("limitingGuests", () => {
  it("lists every guest tied on the limiting end", () => {
    const early = guest("Early", "2027-08-26", "2027-09-05");
    const window = commonWindow([martin, early, chloe])!;
    expect(limitingGuests([martin, early, chloe], window)).toEqual([martin, early]);
  });

  it("includes the guest who arrives last", () => {
    const late = guest("Late", "2027-08-30", "2027-09-14");
    const window = commonWindow([chloe, late, jessy])!;
    expect(limitingGuests([chloe, late, jessy], window)).toEqual([late]);
  });

  it("can name two different guests, one per edge, in the given order", () => {
    const late = guest("Late", "2027-08-30", "2027-09-14");
    const window = commonWindow([martin, late, chloe])!;
    expect(limitingGuests([martin, late, chloe], window)).toEqual([martin, late]);
  });

  it("is empty when everyone has the same availability", () => {
    const same = [chloe, jessy];
    expect(limitingGuests(same, commonWindow(same)!)).toEqual([]);
  });

  it("is empty for a single guest", () => {
    expect(limitingGuests([martin], commonWindow([martin])!)).toEqual([]);
  });

  it("does not blame a guest when the destination's dates set the window", () => {
    const window = commonWindow(scenario, { dateFrom: "2027-08-28", dateTo: "2027-09-02" })!;
    expect(limitingGuests(scenario, window)).toEqual([]);
  });
});

describe("noCommonDates", () => {
  it("names the guest who arrives last and the one who leaves first", () => {
    const late = guest("Late", "2027-09-10", "2027-09-14");
    expect(noCommonDates([martin, chloe, late])).toEqual([late, martin]);
  });

  it("is null when there is a common window", () => {
    expect(noCommonDates(scenario)).toBeNull();
  });

  it("is null for fewer than two guests", () => {
    expect(noCommonDates([])).toBeNull();
    expect(noCommonDates([martin])).toBeNull();
  });
});

describe("addDays", () => {
  it("moves a calendar day forward, across months and years", () => {
    expect(addDays("2027-08-26", 5)).toBe("2027-08-31");
    expect(addDays("2027-08-30", 3)).toBe("2027-09-02");
    expect(addDays("2027-12-30", 3)).toBe("2028-01-02");
    expect(addDays("2027-08-26", 0)).toBe("2027-08-26");
  });

  it("goes through a leap day and a daylight saving change without slipping", () => {
    expect(addDays("2028-02-28", 2)).toBe("2028-03-01");
    expect(addDays("2027-03-27", 2)).toBe("2027-03-29");
  });

  it("can go back", () => {
    expect(addDays("2027-09-01", -1)).toBe("2027-08-31");
  });
});

describe("tripWindow", () => {
  const window = { from: "2027-08-26", to: "2027-09-05" };

  it("is the whole window when the trip has no set length", () => {
    expect(tripWindow(window, null)).toEqual(window);
  });

  it("cuts the window to the first nights", () => {
    expect(tripWindow(window, 5)).toEqual({ from: "2027-08-26", to: "2027-08-31" });
    expect(nightsBetween(tripWindow(window, 5))).toBe(5);
  });

  it("never goes past the window", () => {
    expect(tripWindow(window, 30)).toEqual(window);
    expect(tripWindow(window, 10)).toEqual(window);
  });
});
