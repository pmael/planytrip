import { describe, expect, it, vi } from "vitest";
import { comfortOf } from "@/core/comfort";
import { OsrmUnavailableError, type RouteFn } from "@/geo/osrm";
import { RouteTooLongError, ValhallaUnavailableError, type TollRoute, type TollRouteFn } from "@/geo/valhalla";
import { ScrapeUnavailableError } from "@/scrapers/errors";
import { createCarAdapter } from "@/scrapers/transport/car";
import type { TransportQuery } from "@/scrapers/types";

const query: TransportQuery = {
  mode: "car",
  origin: { key: "madrid-spain", label: "Madrid, Spain", lat: 40.4168, lon: -3.7038, airports: ["MAD"] },
  destination: { id: "d1", label: "Barcelona, Spain", lat: 41.3874, lon: 2.1686, airports: ["BCN"] },
  window: { from: "2027-08-26", to: "2027-09-05" },
};

const drive = (distanceKm: number, hours: number, tollKm = 0, hasToll = tollKm > 0): TollRoute => ({
  distanceKm, durationMin: hours * 60, tollKm, hasToll,
});

/** A toll-aware router that answers with `fast` and, when avoiding tolls, `slow`. */
const tollRouter = (fast: TollRoute | null, avoiding: TollRoute | null = fast) =>
  vi.fn(async (_from, _to, options) => (options?.avoidTolls ? avoiding : fast)) as unknown as TollRouteFn & ReturnType<typeof vi.fn>;

const noOsrm = vi.fn(async () => {
  throw new Error("OSRM should not be asked");
}) as unknown as RouteFn;

/** No fuel prices: the config's 1.80 €/L, as these tests were written for (the bulletin's are tested below) */
const noFuel = async () => {
  throw new ScrapeUnavailableError("no bulletin in these tests");
};
const adapterWith = (tollRoute: TollRouteFn, roadRoute: RouteFn = noOsrm) => createCarAdapter({ tollRoute, roadRoute, fuel: noFuel });

describe("Madrid → Barcelona: a drive with no tolls", () => {
  const router = tollRouter(drive(620, 6.07));

  it("has one option, the standard drive, at 145 € for the car", async () => {
    const [only, ...rest] = await adapterWith(router).search(query);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({
      originKey: "madrid-spain", mode: "car", variant: "standard", provider: "valhalla",
      priceEur: 145, priceUnit: "per_vehicle", lastMileEur: 0, outDurationMin: 364, backDurationMin: 364,
    });
  });

  it("does not ask for the toll-free way, there is nothing to avoid", async () => {
    await adapterWith(router).search(query);
    expect(router).toHaveBeenCalledTimes(1);
  });

  it("is a drive of 6 h 4, comfortable enough: no overnight stop", async () => {
    const options = await adapterWith(router).search(query);
    expect(options.map((o) => o.variant)).toEqual(["standard"]);
    expect(comfortOf(options[0], 0).level).toBe("yellow");
  });
});

describe("a drive with tolls", () => {
  // Faster by 3 h on 640 km of toll roads, or slow and free
  const fast = drive(1381, 13.4, 640);
  const slow = drive(1381, 18.8, 60);

  it("offers the drive with tolls and the one without", async () => {
    const options = await adapterWith(tollRouter(fast, slow)).search(query);
    expect(options.map((o) => o.variant)).toEqual(["tolls", "no_tolls", "overnight_stop"]);
  });

  it("charges the tolls of both ways to the tolled drive: fuel 323 € + 640 km × 2 × 0.09", async () => {
    const [tolls, noTolls] = await adapterWith(tollRouter(fast, slow)).search(query);
    expect(tolls).toMatchObject({ variant: "tolls", priceEur: 438, outDurationMin: 804 });
    // fuel 323 € + the 60 km of toll that could not be avoided
    expect(noTolls).toMatchObject({ variant: "no_tolls", priceEur: 334, outDurationMin: 1128 });
  });

  it("asks for both ways", async () => {
    const router = tollRouter(fast, slow);
    await adapterWith(router).search(query);
    expect(router).toHaveBeenCalledTimes(2);
    expect(router.mock.calls[1][2]).toEqual({ avoidTolls: true });
  });

  it("keeps the figures it worked from", async () => {
    const [tolls] = await adapterWith(tollRouter(fast, slow)).search(query);
    expect(tolls.raw).toEqual({ distanceKm: 1381, tollKm: 640, tollsKnown: true, fuelEurPerL: 1.8, fuelPriceFrom: "config" });
  });

  it("keeps only the tolled drive when the toll-free way is the same road", async () => {
    const options = await adapterWith(tollRouter(fast, drive(1381, 13.4, 640))).search(query);
    expect(options.map((o) => o.variant)).toEqual(["tolls", "overnight_stop"]);
  });

  it("keeps only the tolled drive when there is no toll-free way", async () => {
    const options = await adapterWith(tollRouter(fast, null)).search(query);
    expect(options.map((o) => o.variant)).toEqual(["tolls", "overnight_stop"]);
  });

  it("keeps the tolled drive when the toll-free request fails", async () => {
    const router = vi.fn(async (_f, _t, options) => {
      if (options?.avoidTolls) throw new ValhallaUnavailableError("down");
      return fast;
    }) as unknown as TollRouteFn;
    const options = await adapterWith(router).search(query);
    expect(options.map((o) => o.variant)).toEqual(["tolls", "overnight_stop"]);
  });
});

describe("overnight stop (A-S5, R2)", () => {
  it("splits the trip when every drive is red: 325 € + 2 nights at 60 € = 445 € (the §1.3 figures)", async () => {
    // The doc's Mont-Saxonnex drives: 13 h with tolls, 17 h 30 without
    const options = await adapterWith(tollRouter(drive(1330, 13, 1000), drive(1390, 17.5, 0))).search(query);
    const overnight = options.find((o) => o.variant === "overnight_stop")!;
    expect(overnight).toMatchObject({
      priceEur: 445, outDurationMin: 525, backDurationMin: 525, stops: 1, priceUnit: "per_vehicle", mode: "car",
    });
    expect(overnight.raw).toMatchObject({ basedOn: "no_tolls", nightsEachWay: 1, drivingPerDayMin: 525 });
  });

  it("makes the days of driving comfortable: 2 × 8 h 45 is yellow, not red", async () => {
    const options = await adapterWith(tollRouter(drive(1330, 13, 1000), drive(1390, 17.5, 0))).search(query);
    const levels = Object.fromEntries(options.map((o) => [o.variant, comfortOf(o, 0).level]));
    expect(levels).toEqual({ tolls: "red", no_tolls: "red", overnight_stop: "yellow" });
  });

  it("starts from the cheapest drive", async () => {
    const options = await adapterWith(tollRouter(drive(1000, 11, 600), drive(1000, 14, 0))).search(query);
    expect(options.find((o) => o.variant === "overnight_stop")?.raw).toMatchObject({ basedOn: "no_tolls" });
  });

  it("is not made when one drive is comfortable enough", async () => {
    const options = await adapterWith(tollRouter(drive(900, 9.5, 400), drive(950, 12, 0))).search(query);
    expect(options.map((o) => o.variant)).toEqual(["tolls", "no_tolls"]);
  });

  it("is not made when the drive is exactly 10 h", async () => {
    const options = await adapterWith(tollRouter(drive(900, 10))).search(query);
    expect(options.map((o) => o.variant)).toEqual(["standard"]);
  });

  it("uses more nights for a longer drive: 25 h is 3 days, so 2 nights each way", async () => {
    const options = await adapterWith(tollRouter(drive(2000, 25))).search(query);
    const overnight = options.find((o) => o.variant === "overnight_stop")!;
    // fuel 2000 km × 2 × 0.117 = 468 €, plus 2 nights × 2 ways × 60 €
    expect(overnight).toMatchObject({ stops: 2, priceEur: 468 + 240, outDurationMin: 500 });
  });
});

describe("when there is no road, or no way to know", () => {
  it("has no option when there is no road", async () => {
    expect(await adapterWith(tollRouter(null)).search(query)).toEqual([]);
  });

  it("has no option for any mode but the car", async () => {
    const router = tollRouter(drive(620, 6));
    expect(await adapterWith(router).search({ ...query, mode: "plane" })).toEqual([]);
    expect(router).not.toHaveBeenCalled();
  });

  describe("for a drive the toll-aware router refuses (too long, or it is down)", () => {
    const refusing = (error: Error) => vi.fn(async () => { throw error; }) as unknown as TollRouteFn;

    it("falls back to OSRM: the distance and time, the fuel as the only cost, and a note about the tolls", async () => {
      const osrm = vi.fn(async () => ({ distanceKm: 2400, durationMin: 1500 })) as unknown as RouteFn;
      const options = await adapterWith(refusing(new RouteTooLongError("too long")), osrm).search(query);
      const standard = options.find((o) => o.variant === "standard")!;
      expect(standard).toMatchObject({ provider: "osrm", priceEur: 562, outDurationMin: 1500 });
      expect(standard.raw).toMatchObject({ tollsKnown: false });
    });

    it("also splits a very long drive over several days", async () => {
      const osrm = vi.fn(async () => ({ distanceKm: 2400, durationMin: 1500 })) as unknown as RouteFn;
      const options = await adapterWith(refusing(new ValhallaUnavailableError("down")), osrm).search(query);
      expect(options.map((o) => o.variant)).toEqual(["standard", "overnight_stop"]);
    });

    it("has no option when OSRM finds no road either (an island)", async () => {
      const osrm = vi.fn(async () => null) as unknown as RouteFn;
      expect(await adapterWith(refusing(new RouteTooLongError("too long")), osrm).search(query)).toEqual([]);
    });

    it("lets OSRM's failure through, so the job is retried", async () => {
      const osrm = vi.fn(async () => { throw new OsrmUnavailableError("down"); }) as unknown as RouteFn;
      await expect(adapterWith(refusing(new RouteTooLongError("too long")), osrm).search(query)).rejects.toBeInstanceOf(OsrmUnavailableError);
    });
  });

  it("lets a bug through instead of hiding it behind the fallback", async () => {
    const buggy = vi.fn(async () => { throw new Error("bug"); }) as unknown as TollRouteFn;
    await expect(adapterWith(buggy).search(query)).rejects.toThrow("bug");
  });
});

describe("the adapter", () => {
  it("identifies itself as the car source", () => {
    const adapter = adapterWith(tollRouter(null));
    expect(adapter).toMatchObject({ id: "car", modes: ["car"] });
  });

  it("leaves the times and the comfort to others: nothing is invented", async () => {
    const [option] = await adapterWith(tollRouter(drive(620, 6))).search(query);
    expect(option).toMatchObject({
      outDepartAt: null, outArriveAt: null, backDepartAt: null, backArriveAt: null,
      stops: null, comfortScore: null, comfortLevel: null, url: null,
    });
  });
});
