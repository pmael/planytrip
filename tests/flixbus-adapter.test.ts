import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { flixbus } from "@/config";
import { ScrapeError } from "@/scrapers/errors";
import { createFlixbusAdapter, pickCity, type FlixbusSettings, type JsonFetcher } from "@/scrapers/transport/flixbus";
import type { FlixbusCity } from "@/scrapers/transport/flixbus-parse";
import type { ScrapeCache, TransportQuery } from "@/scrapers/types";

const fixture = (name: string) => JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/flixbus", name), "utf8"));
const TOULOUSE = "40dfd612-8646-11e6-9066-549f350fcb0c";
const MADRID = "9a07bb38-3596-48eb-a857-18fd01199c62";

const query = (over: Partial<TransportQuery> = {}): TransportQuery => ({
  mode: "bus",
  origin: { key: "toulouse-france", label: "Toulouse, France", lat: 43.6045, lon: 1.4442, airports: ["TLS"] },
  destination: { id: "d", label: "Madrid, Spain", lat: 40.4168, lon: -3.7038, airports: ["MAD"] },
  window: { from: "2026-12-22", to: "2026-12-26" },
  ...over,
});

const config: FlixbusSettings = { ...flixbus };
const now = () => new Date("2026-10-20T10:00:00Z");

/** A fake FlixBus: city searches by name, and the captured rides for each direction. */
function fakeFlixbus(over: { rides?: (from: string, to: string) => unknown } = {}) {
  const urls: string[] = [];
  const fetchJson: JsonFetcher = vi.fn(async (url: string) => {
    urls.push(url);
    const params = new URL(url).searchParams;
    if (url.includes("/autocomplete/cities")) return params.get("q") === "Toulouse" ? fixture("cities-toulouse.json") : fixture("cities-madrid.json");
    const from = params.get("from_city_id")!;
    const to = params.get("to_city_id")!;
    if (over.rides) return over.rides(from, to);
    return from === TOULOUSE ? fixture("tls-mad-2026-12-22.json") : fixture("mad-tls-2026-12-26.json");
  });
  return { fetchJson, urls };
}
const adapterWith = (fetchJson: JsonFetcher) => createFlixbusAdapter({ fetchJson, config, now });

describe("pickCity", () => {
  const cities: FlixbusCity[] = [
    { id: "airport", name: "Toulouse Blagnac Airport", lat: 43.629, lon: 1.368 },
    { id: "city", name: "Toulouse", lat: 43.613, lon: 1.452 },
    { id: "tolosa", name: "Tolosa", lat: 43.135, lon: -2.075 },
  ];
  const place = { label: "Toulouse, France", lat: 43.6045, lon: 1.4442 };

  it("takes the city with the name asked for, near the place", () => {
    expect(pickCity(cities, place, 50)?.id).toBe("city");
  });

  it("does not take a namesake far away, and takes the nearest when no name matches", () => {
    expect(pickCity([cities[2]], place, 50)).toBeNull();
    expect(pickCity([cities[0]], { ...place, label: "Blagnac, France" }, 50)?.id).toBe("airport");
  });

  it("ignores accents and capitals in the name", () => {
    expect(pickCity([{ id: "x", name: "MÁLAGA", lat: 36.72, lon: -4.42 }], { label: "Malaga, Spain", lat: 36.72, lon: -4.42 }, 50)?.id).toBe("x");
  });
});

describe("the FlixBus adapter", () => {
  it("makes round trips of each ride there with the cheapest ride back: one price for both", async () => {
    const options = await adapterWith(fakeFlixbus().fetchJson).search(query());

    expect(options).toHaveLength(4);
    // 61 € there on the direct night bus and 51 € back (fees included)
    expect(options[0]).toMatchObject({
      originKey: "toulouse-france",
      mode: "bus",
      provider: "flixbus",
      variant: "standard",
      priceUnit: "per_person",
      priceEur: 112,
      outDepartAt: "2026-12-22T23:05",
      outArriveAt: "2026-12-23T08:40",
      outDurationMin: 575,
      stops: 0,
      backDepartAt: "2026-12-26T20:50",
      backArriveAt: "2026-12-27T06:30",
      backDurationMin: 580,
      lastMileEur: 0,
      comfortScore: null,
      comfortLevel: null,
    });
  });

  it("lists them cheapest first, counts changes as stops, and links to the search on the first day", async () => {
    const options = await adapterWith(fakeFlixbus().fetchJson).search(query());
    expect(options.map((o) => o.priceEur)).toEqual([...options.map((o) => o.priceEur)].sort((a, b) => a - b));
    expect(options.map((o) => o.stops)).toContain(2);
    const url = new URL(options[0].url!);
    expect(url.origin + url.pathname).toBe("https://shop.flixbus.com/search");
    expect(url.searchParams.get("departureCity")).toBe(TOULOUSE);
    expect(url.searchParams.get("arrivalCity")).toBe(MADRID);
    expect(url.searchParams.get("rideDate")).toBe("22.12.2026");
  });

  it("asks FlixBus for each way on its own day, in euros, for one adult", async () => {
    const { fetchJson, urls } = fakeFlixbus();
    await adapterWith(fetchJson).search(query());
    const searches = urls.filter((u) => u.includes("/search/service/")).map((u) => new URL(u).searchParams);
    expect(searches.map((p) => [p.get("from_city_id"), p.get("to_city_id"), p.get("departure_date")])).toEqual([
      [TOULOUSE, MADRID, "22.12.2026"],
      [MADRID, TOULOUSE, "26.12.2026"],
    ]);
    expect(searches[0].get("currency")).toBe("EUR");
    expect(JSON.parse(searches[0].get("products")!)).toEqual({ adult: 1 });
  });

  it("keeps no more than it is allowed", async () => {
    expect(await createFlixbusAdapter({ fetchJson: fakeFlixbus().fetchJson, config: { ...config, maxOptions: 2 }, now }).search(query())).toHaveLength(2);
  });

  it("finds no train where FlixBus sells none, and only the all-train rides for a train", async () => {
    expect(await adapterWith(fakeFlixbus().fetchJson).search(query({ mode: "train" }))).toEqual([]);

    const trainOnly = (from: string) => ({
      trips: [{ results: { t: { status: "available", departure: { date: from === TOULOUSE ? "2026-12-22T09:00:00+01:00" : "2026-12-26T09:00:00+01:00" }, arrival: { date: from === TOULOUSE ? "2026-12-22T14:00:00+01:00" : "2026-12-26T14:00:00+01:00" }, duration: { hours: 5, minutes: 0 }, price: { total: 49 }, legs: [{ means_of_transport: "train" }] } } }],
    });
    const options = await adapterWith(fakeFlixbus({ rides: (from) => trainOnly(from) }).fetchJson).search(query({ mode: "train" }));
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ mode: "train", priceEur: 98, outDurationMin: 300 });
  });

  it("offers no trip when there is no way back: the price would be half of one", async () => {
    const empty = { trips: [{ results: {} }] };
    const options = await adapterWith(fakeFlixbus({ rides: (from) => (from === TOULOUSE ? fixture("tls-mad-2026-12-22.json") : empty) }).fetchJson).search(query());
    expect(options).toEqual([]);
  });

  it("finds nothing for a place FlixBus does not serve, another mode, or days already gone, without asking", async () => {
    const { fetchJson } = fakeFlixbus();
    const adapter = adapterWith(fetchJson);
    expect(await adapter.search(query({ mode: "car" }))).toEqual([]);
    expect(await adapter.search(query({ mode: "plane" }))).toEqual([]);
    expect(await adapter.search(query({ window: { from: "2026-10-20", to: "2026-10-26" } }))).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalled();

    const island = query({ destination: { id: "r", label: "Réunion, France", lat: -21.13, lon: 55.53, airports: ["RUN"] } });
    expect(await adapter.search(island)).toEqual([]);
  });

  it("lets a failing site's error through as it is", async () => {
    const down: JsonFetcher = async () => {
      throw new ScrapeError("FlixBus answered 503");
    };
    await expect(adapterWith(down).search(query())).rejects.toMatchObject({ retryable: true, message: "FlixBus answered 503" });
  });
});

describe("the FlixBus adapter and the cache", () => {
  function memoryCache() {
    const kept = new Map<string, unknown>();
    const keys: string[] = [];
    const cache: ScrapeCache = {
      async remember(key, _source, _ttl, produce, options) {
        keys.push(key);
        if (!options?.refresh && kept.has(key)) return kept.get(key) as never;
        const value = await produce();
        kept.set(key, JSON.parse(JSON.stringify(value)));
        return value;
      },
    };
    return { cache, keys };
  }

  it("does not ask FlixBus again for the cities or the days it answered a moment ago", async () => {
    const { cache } = memoryCache();
    const { fetchJson } = fakeFlixbus();
    const adapter = adapterWith(fetchJson);
    const first = await adapter.search(query({ cache }));
    const calls = vi.mocked(fetchJson).mock.calls.length;
    expect(calls).toBe(4);
    expect(await adapter.search(query({ cache }))).toEqual(first);
    expect(vi.mocked(fetchJson).mock.calls.length).toBe(calls);
  });

  it("asks again when told to", async () => {
    const { cache } = memoryCache();
    const { fetchJson } = fakeFlixbus();
    const adapter = adapterWith(fetchJson);
    await adapter.search(query({ cache }));
    await adapter.search(query({ cache, refresh: true }));
    expect(vi.mocked(fetchJson).mock.calls.length).toBe(8);
  });
});
