import { describe, expect, it, vi } from "vitest";
import { ScrapeChangedError } from "@/scrapers/errors";
import type { Http } from "@/scrapers/http";
import { createRegiojet, parseCities, parseRides, pickCity } from "@/scrapers/transport/regiojet";
import { trains } from "@/config";
import type { TransportQuery } from "@/scrapers/types";
import { memoryCache, trainJson } from "./helpers/trains";

const query = (over: Partial<TransportQuery> = {}): TransportQuery => ({
  mode: "train",
  origin: { key: "prague-czechia", label: "Prague, Czechia", lat: 50.0755, lon: 14.4378, airports: ["PRG"] },
  destination: { id: "d", label: "Vienna, Austria", lat: 48.2082, lon: 16.3738, airports: ["VIE"] },
  window: { from: "2026-12-04", to: "2026-12-06" },
  ...over,
});
const now = () => new Date("2026-10-24T10:00:00Z");

/**
 * A fake RegioJet. The captured rides are those of 4 December; asked for another day it gives the same rides on that
 * day, and the rides of any other day in the file stay where they are (the real service lists the days around too).
 */
function fakeRegiojet(routes: { routes: Record<string, unknown>[] } = trainJson("regiojet-routes.json")) {
  const urls: string[] = [];
  const http: Http = {
    getJson: vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("/consts/locations")) return trainJson("regiojet-locations.json");
      const day = new URL(url).searchParams.get("departureDate")!;
      const moved = (time: unknown) => (typeof time === "string" ? time.replace("2026-12-04", day) : time);
      return { routes: routes.routes.map((r) => ({ ...r, departureTime: moved(r.departureTime), arrivalTime: moved(r.arrivalTime) })) };
    }),
    postJson: vi.fn(),
  };
  return { http, urls };
}

describe("parseCities / parseRides (T7.8: RegioJet's answers, captured on 2026-10-24)", () => {
  it("places a city at the middle of its stations, leaving out the ones with no position", () => {
    const prague = parseCities(trainJson("regiojet-locations.json")).find((city) => city.name === "Prague")!;
    expect(prague.id).toBe(10202003);
    expect(prague.lat).toBeCloseTo(50.08, 1);
    expect(prague.lon).toBeCloseTo(14.43, 1);
  });

  it("refuses an answer that is not a list of countries", () => {
    expect(() => parseCities({ nope: 1 })).toThrow(ScrapeChangedError);
    expect(() => parseRides({ nope: 1 })).toThrow(ScrapeChangedError);
  });

  it("reads a ride's local times, duration, kind and lowest fare, and leaves out a sold-out one", () => {
    const rides = parseRides(trainJson("regiojet-routes.json"));
    expect(rides[0]).toEqual({ departAt: "2026-12-04T06:01", arriveAt: "2026-12-04T10:21", durationMin: 260, kind: "train", changes: 0, priceEur: 13.9 });
    expect(rides.find((ride) => ride.kind === "bus")).toBeDefined();
    // 8 rides in the file, one of them sold out
    expect(rides).toHaveLength(7);
  });

  it("calls a ride with a bus in it a bus", () => {
    const rides = parseRides(trainJson("regiojet-routes.json"));
    expect(rides.find((ride) => ride.changes === 1)?.kind).toBe("bus");
  });
});

describe("pickCity", () => {
  const cities = parseCities(trainJson("regiojet-locations.json"));
  it("takes the city nearest to the place, within reach", () => {
    expect(pickCity(cities, { label: "Brno, Czechia", lat: 49.19, lon: 16.61 }, 40)?.name).toBe("Brno");
    expect(pickCity(cities, { label: "Somewhere", lat: 50.1, lon: 14.4 }, 40)?.name).toBe("Prague");
  });

  it("takes none for a place with no RegioJet city near it", () => {
    expect(pickCity(cities, { label: "Toulouse, France", lat: 43.6, lon: 1.44 }, 40)).toBeNull();
  });
});

describe("createRegiojet", () => {
  const adapterWith = (http: Http) => createRegiojet({ http, now });

  it("offers the trains of the way there with the cheapest way back, the round trip's price being the two added up", async () => {
    const { http } = fakeRegiojet();
    const options = await adapterWith(http).search(query());

    expect(options.length).toBeGreaterThan(0);
    const first = options[0];
    expect(first).toMatchObject({ originKey: "prague-czechia", mode: "train", provider: "regiojet", variant: "standard", priceUnit: "per_person", lastMileEur: 0 });
    // The same rides answer both ways: the cheapest is 13.9 (the same ride at 21.9 from another station counts once, at its lowest)
    expect(first.priceEur).toBe(Math.round(13.9 + 13.9));
    expect(first.priceKind ?? "live").toBe("live");
    expect(first.url).toMatch(/regiojet\.com/);
    expect(first).toMatchObject({ outDepartAt: expect.stringMatching(/^2026-12-04T/), backDepartAt: expect.stringMatching(/^2026-12-06T/) });
  });

  it("offers only the rides of the day asked: the service lists the days around it too", async () => {
    // A very cheap ride on the 5th, which must not be taken for one of the 4th (nor of the 6th, the way back)
    const routes = trainJson("regiojet-routes.json");
    routes.routes.push({ ...routes.routes[0], id: "next-day", departureTime: "2026-12-05T06:01:00.000+01:00", arrivalTime: "2026-12-05T10:21:00.000+01:00", priceFrom: 1 });
    const { http } = fakeRegiojet(routes);
    const options = await adapterWith(http).search(query());
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.outDepartAt!.startsWith("2026-12-04") && o.backDepartAt!.startsWith("2026-12-06"))).toBe(true);
    expect(Math.min(...options.map((o) => o.priceEur))).toBeGreaterThan(2);
  });

  it("lists each ride once", async () => {
    const { http } = fakeRegiojet();
    const options = await adapterWith(http).search(query());
    const times = options.map((o) => `${o.outDepartAt}|${o.outArriveAt}`);
    expect(new Set(times).size).toBe(times.length);
  });

  it("offers buses for the bus mode, and never a bus as a train", async () => {
    const { http } = fakeRegiojet();
    const buses = await adapterWith(http).search(query({ mode: "bus" }));
    expect(buses.length).toBeGreaterThan(0);
    expect(buses.every((o) => o.mode === "bus")).toBe(true);
    expect((await adapterWith(http).search(query())).every((o) => o.mode === "train")).toBe(true);
    expect(await adapterWith(http).search(query({ mode: "plane" }))).toEqual([]);
  });

  it("says nothing for a place RegioJet does not serve, for a day that has begun, and for a way there with no way back", async () => {
    const { http } = fakeRegiojet();
    expect(await adapterWith(http).search(query({ origin: { key: "t", label: "Toulouse, France", lat: 43.6, lon: 1.44, airports: [] } }))).toEqual([]);
    expect(await adapterWith(http).search(query({ window: { from: "2026-10-24", to: "2026-10-26" } }))).toEqual([]);

    const noBack: Http = {
      getJson: vi.fn(async (url: string) => (url.includes("/consts/locations") ? trainJson("regiojet-locations.json") : url.includes("fromLocationId=10202052") ? { routes: [] } : trainJson("regiojet-routes.json"))),
      postJson: vi.fn(),
    };
    expect(await adapterWith(noBack).search(query())).toEqual([]);
  });

  it("keeps the city list for a month and each day's rides for a day, and asks again when told to", async () => {
    const { http, urls } = fakeRegiojet();
    const cache = memoryCache();
    await adapterWith(http).search(query({ cache }));
    const first = urls.length;
    await adapterWith(http).search(query({ cache }));
    expect(urls).toHaveLength(first);
    await adapterWith(http).search(query({ cache, refresh: true }));
    expect(urls.length).toBeGreaterThan(first);
  });

  it("asks politely: at most a few options, and by the cities' own ids", async () => {
    const { http, urls } = fakeRegiojet();
    const options = await adapterWith(http).search(query());
    expect(options.length).toBeLessThanOrEqual(trains.regiojet.maxOptions);
    const search = new URL(urls.find((u) => u.includes("/routes/search"))!);
    expect(search.searchParams.get("fromLocationId")).toBe("10202003");
    expect(search.searchParams.get("toLocationId")).toBe("10202052");
    expect(search.searchParams.get("departureDate")).toBe("2026-12-04");
  });
});
