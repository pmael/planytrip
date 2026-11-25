import { describe, expect, it } from "vitest";
import { clockComfort, comfortOf, needsOvernightStop, type ComfortInput } from "@/core/comfort";
import { SCENARIO_WINDOW, transportFixtures, type TransportFixture } from "@/db/seed/fixtures";

const toInput = (fixture: TransportFixture): ComfortInput => ({
  mode: fixture.mode,
  variant: fixture.variant,
  stops: fixture.stops,
  outDepartAt: fixture.departTime ? `${SCENARIO_WINDOW.from}T${fixture.departTime}` : null,
  outDurationMin: fixture.durationMin,
  backDurationMin: fixture.durationMin,
  lastMileEur: fixture.lastMileEur ?? 0,
});

/** The fastest duration among the options of the same route, as the caller would compute it. */
const fastestOnRoute = (fixture: TransportFixture) =>
  Math.min(
    ...transportFixtures
      .filter(
        (other) =>
          other.destination === fixture.destination &&
          other.originKey === fixture.originKey &&
          other.mode === fixture.mode,
      )
      .map((other) => other.durationMin),
  );

describe("the §1.3 test dataset", () => {
  it.each(transportFixtures.map((fixture) => [fixture.destination, fixture.originKey, fixture.label, fixture] as const))(
    "%s from %s: %s",
    (_destination, _origin, _label, fixture) => {
      expect(comfortOf(toInput(fixture), fastestOnRoute(fixture)).level).toBe(fixture.expectedComfort);
    },
  );

  const find = (label: string) => {
    const fixture = transportFixtures.find((f) => f.label.startsWith(label));
    if (!fixture) throw new Error(`No fixture starting with "${label}"`);
    return fixture;
  };

  it("rates the 910 € flight to La Réunion red: 3 stops, 23 h 40", () => {
    const fixture = find("3 stops");
    const { level, reasons } = comfortOf(toInput(fixture), fastestOnRoute(fixture));
    expect(level).toBe("red");
    expect(reasons).toContain("3 stops");
    expect(reasons.some((reason) => reason.includes("23 h 40"))).toBe(true);
  });

  it("rates Mont-Saxonnex by car with tolls red: 13 h in a day", () => {
    const fixture = find("Car with tolls (1,330 km)");
    const { level, reasons } = comfortOf(toInput(fixture), 0);
    expect(level).toBe("red");
    expect(reasons).toEqual(["13 h of driving in a day, over 10 h"]);
  });

  it("explains the early departures", () => {
    const fixture = find("Transavia ORY→BCN");
    expect(comfortOf(toInput(fixture), fastestOnRoute(fixture)).reasons).toEqual(["Departs at 06:30, early"]);
  });

  it("has no reason for a green option", () => {
    const fixture = find("Iberia MAD→BCN");
    expect(comfortOf(toInput(fixture), fastestOnRoute(fixture)).reasons).toEqual([]);
  });

  it("scores the comfortable Iberia flight above the 06:45 Vueling one", () => {
    const iberia = find("Iberia MAD→BCN");
    const vueling = find("Vueling MAD→BCN");
    expect(comfortOf(toInput(iberia), 75).score).toBeGreaterThan(comfortOf(toInput(vueling), 75).score);
  });

  it("scores every option between 0 and 100", () => {
    for (const fixture of transportFixtures) {
      const { score } = comfortOf(toInput(fixture), fastestOnRoute(fixture));
      expect(Number.isInteger(score) && score >= 0 && score <= 100).toBe(true);
    }
  });
});

const flight = (overrides: Partial<ComfortInput> = {}): ComfortInput => ({
  mode: "plane",
  variant: "standard",
  stops: 0,
  outDepartAt: "2027-08-26T12:00",
  outDurationMin: 100,
  backDurationMin: 100,
  lastMileEur: 0,
  ...overrides,
});

const drive = (hours: number, variant: ComfortInput["variant"] = "no_tolls"): ComfortInput => ({
  mode: "car",
  variant,
  stops: null,
  outDepartAt: null,
  outDurationMin: Math.round(hours * 60),
  backDurationMin: Math.round(hours * 60),
  lastMileEur: 0,
});

const levelAt = (time: string) => comfortOf(flight({ outDepartAt: `2027-08-26T${time}` }), 100).level;

describe("plane, train and bus", () => {
  it("is green for a direct, quick flight at a normal hour", () => {
    expect(comfortOf(flight(), 100)).toEqual({ level: "green", score: 100, reasons: [] });
  });

  it("applies the same rules to trains and buses", () => {
    expect(comfortOf(flight({ mode: "train", stops: 1 }), 100).level).toBe("yellow");
    expect(comfortOf(flight({ mode: "bus", stops: 3 }), 100).level).toBe("red");
  });

  describe("departure time", () => {
    it.each([
      ["08:00", "green"],
      ["12:00", "green"],
      ["20:59", "green"],
      ["21:00", "yellow"],
      ["22:59", "yellow"],
      ["23:00", "red"],
      ["02:00", "red"],
      ["05:59", "red"],
      ["06:00", "yellow"],
      ["07:59", "yellow"],
    ])("%s is %s", (time, level) => {
      expect(levelAt(time)).toBe(level);
    });

    it("is not rated when the departure is unknown", () => {
      expect(comfortOf(flight({ outDepartAt: null }), 100).level).toBe("green");
    });
  });

  describe("stops", () => {
    it.each([
      [0, "green"],
      [1, "yellow"],
      [2, "yellow"],
      [3, "red"],
      [4, "red"],
    ])("%i stops is %s", (stops, level) => {
      expect(comfortOf(flight({ stops }), 100).level).toBe(level);
    });
  });

  describe("duration against the fastest option", () => {
    it.each([
      [100, "green"],
      [130, "green"],
      [131, "yellow"],
      [200, "yellow"],
      [201, "red"],
    ])("%i min vs 100 min is %s", (minutes, level) => {
      expect(comfortOf(flight({ outDurationMin: minutes }), 100).level).toBe(level);
    });

    it("is red beyond 20 h even when it is the fastest option", () => {
      const { level, reasons } = comfortOf(flight({ outDurationMin: 21 * 60 }), 21 * 60);
      expect(level).toBe("red");
      expect(reasons).toEqual(["21 h of travel, over 20 h"]);
    });

    it("falls back to the return duration when the outbound one is missing", () => {
      expect(comfortOf(flight({ outDurationMin: null, backDurationMin: 250 }), 100).level).toBe("red");
    });
  });

  it("takes the worst criterion and lists every reason, worst first", () => {
    const { level, reasons } = comfortOf(flight({ stops: 1, outDepartAt: "2027-08-26T23:30" }), 100);
    expect(level).toBe("red");
    expect(reasons).toEqual(["Departs at 23:30, in the middle of the night", "1 stop"]);
  });
});

describe("car with one driver", () => {
  it.each([
    [5.5, "green"],
    [6, "green"],
    [6.25, "yellow"],
    [10, "yellow"],
    [10.25, "red"],
    [17.5, "red"],
  ])("%d h of driving is %s", (hours, level) => {
    expect(comfortOf(drive(hours), 0).level).toBe(level);
  });

  it("ignores the departure time and the route's fastest duration", () => {
    expect(comfortOf({ ...drive(5), outDepartAt: "2027-08-26T03:00" }, 1).level).toBe("green");
  });

  it("rates an overnight-stop variant by its day of driving (2 × 8 h 45 is yellow)", () => {
    expect(comfortOf(drive(8.75, "overnight_stop"), 0).level).toBe("yellow");
  });
});

describe("score", () => {
  it("drops with more stops, a worse hour, a longer trip and a costlier last mile", () => {
    const base = comfortOf(flight(), 100).score;
    expect(comfortOf(flight({ stops: 1 }), 100).score).toBeLessThan(base);
    expect(comfortOf(flight({ outDepartAt: "2027-08-26T06:30" }), 100).score).toBeLessThan(base);
    expect(comfortOf(flight({ outDurationMin: 150 }), 100).score).toBeLessThan(base);
    expect(comfortOf(flight({ lastMileEur: 50 }), 100).score).toBeLessThan(base);
  });

  it("weights duration 40 %, schedule 30 %, stops 20 % and last mile 10 %", () => {
    // Worst duration only (ratio 2 → 0), the other criteria perfect
    expect(comfortOf(flight({ outDurationMin: 200 }), 100).score).toBe(60);
    // Worst schedule only
    expect(comfortOf(flight({ outDepartAt: "2027-08-26T02:00" }), 100).score).toBe(70);
    // Worst stops only
    expect(comfortOf(flight({ stops: 3 }), 100).score).toBe(80);
    // Worst last mile only (100 € or more)
    expect(comfortOf(flight({ lastMileEur: 100 }), 100).score).toBe(90);
  });

  it("prefers a shorter day of driving", () => {
    expect(comfortOf(drive(5), 0).score).toBeGreaterThan(comfortOf(drive(9), 0).score);
  });
});

describe("needsOvernightStop", () => {
  it("is true for a car option with more than 10 h of driving in a day", () => {
    expect(needsOvernightStop(drive(13, "tolls"))).toBe(true);
    expect(needsOvernightStop(drive(17.5))).toBe(true);
  });

  it("is false up to 10 h", () => {
    expect(needsOvernightStop(drive(10))).toBe(false);
    expect(needsOvernightStop(drive(6.25))).toBe(false);
  });

  it("is false for the overnight variant itself", () => {
    expect(needsOvernightStop(drive(13, "overnight_stop"))).toBe(false);
  });

  it("is false for anything but the car", () => {
    expect(needsOvernightStop(flight({ outDurationMin: 25 * 60 }))).toBe(false);
  });
});

describe("clockComfort", () => {
  it("rates a clock time with the windows R2 applies to a departure", () => {
    expect(clockComfort("2027-08-26T10:15")).toBe("green");
    expect(clockComfort("2027-08-26T06:45")).toBe("yellow");
    expect(clockComfort("2027-08-26T22:30")).toBe("yellow");
    expect(clockComfort("2027-08-27T03:00")).toBe("red");
  });

  it("has no opinion without a time", () => {
    expect(clockComfort(null)).toBeNull();
    expect(clockComfort("2027-08-26")).toBeNull();
  });
});
