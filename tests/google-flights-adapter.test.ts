import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { googleFlights } from "@/config";
import { ScrapeBlockedError, ScrapeChangedError, ScrapeError } from "@/scrapers/errors";
import { airportPairs, createGoogleFlightsAdapter, searchUrl, type GoogleFlightsSettings } from "@/scrapers/transport/google-flights";
import type { FlightsDriver } from "@/scrapers/transport/google-flights-chrome";
import type { ScrapeCache, TransportQuery } from "@/scrapers/types";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests/fixtures/google-flights", name), "utf8");
const OUTBOUND = fixture("tls-mad-outbound.txt");
const RETURNS = fixture("mad-tls-returns.txt");

const query = (over: Partial<TransportQuery> = {}): TransportQuery => ({
  mode: "plane",
  origin: { key: "toulouse-france", label: "Toulouse, France", lat: 43.6045, lon: 1.4442, airports: ["TLS"] },
  destination: { id: "d", label: "Madrid, Spain", lat: 40.4168, lon: -3.7038, airports: ["MAD"] },
  window: { from: "2026-12-22", to: "2026-12-26" },
  ...over,
});

const config: GoogleFlightsSettings = { ...googleFlights };
const now = () => new Date("2026-10-20T10:00:00Z");

/** A fake browser that gives Google's two captured answers. */
function fakeDriver(answers: string[] = [OUTBOUND, RETURNS]) {
  const driver = vi.fn<FlightsDriver>(async () => ({ answers, rows: [] }));
  return driver;
}
const adapterWith = (driver: FlightsDriver, settings: GoogleFlightsSettings = config) => createGoogleFlightsAdapter({ driver, config: settings, now });

describe("searchUrl", () => {
  const url = new URL(searchUrl(config, "TLS", "MAD", { from: "2026-12-22", to: "2026-12-26" }));

  it("asks Google for a round trip between the two airports on the stay's days, in euros", () => {
    expect(url.origin + url.pathname).toBe("https://www.google.com/travel/flights");
    expect(url.searchParams.get("q")).toBe("Flights from TLS to MAD on 2026-12-22 through 2026-12-26");
    expect(url.searchParams.get("curr")).toBe("EUR");
    expect(url.searchParams.get("hl")).toBe("en");
  });
});

describe("airportPairs", () => {
  it("is the one pair of two single-airport places", () => {
    expect(airportPairs(["TLS"], ["MAD"], 4)).toEqual([["TLS", "MAD"]]);
  });

  it("pairs a place with several airports with each of the other's, the nearest first", () => {
    expect(airportPairs(["ORY", "CDG"], ["BCN"], 4)).toEqual([["ORY", "BCN"], ["CDG", "BCN"]]);
    expect(airportPairs(["ORY", "CDG"], ["LGW", "LHR"], 4)).toEqual([["ORY", "LGW"], ["ORY", "LHR"], ["CDG", "LGW"], ["CDG", "LHR"]]);
  });

  it("stops at the most it is allowed, and has none for a place without an airport", () => {
    expect(airportPairs(["ORY", "CDG", "BVA"], ["LGW", "LHR", "STN"], 3)).toHaveLength(3);
    expect(airportPairs([], ["MAD"], 4)).toEqual([]);
  });
});

describe("the Google Flights adapter", () => {
  it("turns each outbound flight into an option with its price, times, stops and a way back", async () => {
    const options = await adapterWith(fakeDriver()).search(query());

    expect(options).toHaveLength(8);
    expect(options[0]).toMatchObject({
      originKey: "toulouse-france",
      mode: "plane",
      provider: "volotea",
      variant: "standard",
      priceEur: 146,
      priceUnit: "per_person",
      stops: 0,
      outDepartAt: "2026-12-22T20:00",
      outArriveAt: "2026-12-22T21:30",
      outDurationMin: 90,
      lastMileEur: 0,
      comfortScore: null,
      comfortLevel: null,
    });
    expect(options[0].url).toContain("google.com/travel/flights");
  });

  it("gives the flights back: the airline's own when Google lists one, else the cheapest", async () => {
    const options = await adapterWith(fakeDriver()).search(query());
    const iberia = options.find((o) => o.provider === "iberia")!;
    const volotea = options.find((o) => o.provider === "volotea")!;
    // Iberia has a flight back (the 19:40) and so it is paired with it; Volotea has none, so the cheapest goes with it
    expect(iberia).toMatchObject({ backDepartAt: "2026-12-26T19:40", backArriveAt: "2026-12-26T21:05", backDurationMin: 85 });
    expect(volotea).toMatchObject({ backDepartAt: "2026-12-26T19:40", backDurationMin: 85 });
    expect((iberia.raw as { back: { pairing: string } }).back.pairing).toBe("same-airline");
    expect((volotea.raw as { back: { pairing: string } }).back.pairing).toBe("cheapest");
  });

  it("counts the stops and keeps the whole time of a journey with a layover", async () => {
    const options = await adapterWith(fakeDriver()).search(query());
    expect(options.find((o) => o.provider === "tap-air-portugal")).toMatchObject({ stops: 1, outDurationMin: 855, outDepartAt: "2026-12-22T06:05", outArriveAt: "2026-12-22T20:20" });
  });

  it("lists them cheapest first and keeps no more than it is allowed", async () => {
    const all = await adapterWith(fakeDriver()).search(query());
    expect(all.map((o) => o.priceEur)).toEqual([...all.map((o) => o.priceEur)].sort((a, b) => a - b));
    expect(await adapterWith(fakeDriver(), { ...config, maxOptions: 3 }).search(query())).toHaveLength(3);
  });

  it("keeps a journey without a way back rather than lose it", async () => {
    const options = await adapterWith(fakeDriver([OUTBOUND])).search(query());
    expect(options).toHaveLength(8);
    expect(options[0]).toMatchObject({ backDepartAt: null, backArriveAt: null, backDurationMin: null });
  });

  it("tells the answers apart by where their flights leave from, whatever their order", async () => {
    const options = await adapterWith(fakeDriver([RETURNS, OUTBOUND, OUTBOUND])).search(query());
    expect(options).toHaveLength(8);
    expect(options.every((o) => o.backDepartAt === "2026-12-26T19:40")).toBe(true);
  });

  it("asks once per airport pair, each for its own address", async () => {
    const driver = vi.fn<FlightsDriver>(async () => ({ answers: [], rows: [] }));
    await adapterWith(driver).search(query({ origin: { ...query().origin, airports: ["ORY", "CDG"] }, destination: { ...query().destination, airports: ["BCN"] } }));
    expect(driver.mock.calls.map(([url]) => new URL(url).searchParams.get("q"))).toEqual([
      "Flights from ORY to BCN on 2026-12-22 through 2026-12-26",
      "Flights from CDG to BCN on 2026-12-22 through 2026-12-26",
    ]);
    expect(driver.mock.calls.every(([, options]) => options.wantReturn)).toBe(true);
  });

  it("adds the transfer to the destination when the arrival airport is far from it (B-S3)", async () => {
    // The flights land at MAD; Toledo is about 65 km from it, Madrid itself is next door
    const farAway = await adapterWith(fakeDriver()).search(query({ destination: { id: "d", label: "Toledo", lat: 39.8628, lon: -4.0273, airports: ["MAD"] } }));
    expect(farAway[0].lastMileEur).toBeGreaterThan(0);
    expect((await adapterWith(fakeDriver()).search(query()))[0].lastMileEur).toBe(0);
  });

  it("finds nothing for another mode, for a place without an airport, and for days already gone", async () => {
    const driver = fakeDriver();
    const adapter = adapterWith(driver);
    expect(await adapter.search(query({ mode: "car" }))).toEqual([]);
    expect(await adapter.search(query({ origin: { ...query().origin, airports: [] } }))).toEqual([]);
    expect(await adapter.search(query({ window: { from: "2026-10-19", to: "2026-10-26" } }))).toEqual([]);
    expect(driver).not.toHaveBeenCalled();
  });

  it("finds nothing, without failing, on a day nothing flies", async () => {
    const none = `)]}'\n\n20\n[["wrb.fr",null,"[null,null,null,null]"]]\n`;
    expect(await adapterWith(fakeDriver([none])).search(query())).toEqual([]);
  });

  it("says the site changed when what it got is not an answer", async () => {
    await expect(adapterWith(fakeDriver(["<html>hello</html>"])).search(query())).rejects.toBeInstanceOf(ScrapeChangedError);
  });

  it("lets the browser's failures through as they are: a block cannot be retried, a slow page can", async () => {
    const blocked = vi.fn<FlightsDriver>(async () => {
      throw new ScrapeBlockedError();
    });
    const slow = vi.fn<FlightsDriver>(async () => {
      throw new ScrapeError("Google Flights did not answer in time");
    });
    await expect(adapterWith(blocked).search(query())).rejects.toMatchObject({ retryable: false });
    await expect(adapterWith(slow).search(query())).rejects.toMatchObject({ retryable: true });
  });
});

describe("the Google Flights adapter and the cache", () => {
  function memoryCache() {
    const kept = new Map<string, unknown>();
    const asked: { key: string; refresh?: boolean }[] = [];
    const cache: ScrapeCache = {
      async remember(key, _source, _ttl, produce, options) {
        asked.push({ key, refresh: options?.refresh });
        if (!options?.refresh && kept.has(key)) return kept.get(key) as never;
        const value = await produce();
        kept.set(key, JSON.parse(JSON.stringify(value)));
        return value;
      },
    };
    return { cache, asked };
  }

  it("does not ask Google again for what it answered a moment ago", async () => {
    const { cache } = memoryCache();
    const driver = fakeDriver();
    const adapter = adapterWith(driver);
    const first = await adapter.search(query({ cache }));
    const second = await adapter.search(query({ cache }));
    expect(driver).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("asks again when told to, and keys what it keeps by the airports and the days", async () => {
    const { cache, asked } = memoryCache();
    const driver = fakeDriver();
    const adapter = adapterWith(driver);
    await adapter.search(query({ cache }));
    await adapter.search(query({ cache, refresh: true }));
    expect(driver).toHaveBeenCalledTimes(2);
    expect(asked[0].key).toBe("flights|TLS|MAD|2026-12-22|2026-12-26");
    expect(asked[1].refresh).toBe(true);
  });
});
