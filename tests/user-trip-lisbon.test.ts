// The trip that failed on the user's machine: Mael from Toulouse by plane only (700 €), Elena from Madrid
// by car or plane, Barcelona, Lisbon and Paris on 22-26 December 2026. Toulouse lists six airports and
// Lisbon two, one of which ("CAT") Google Flights does not understand.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import type { GeoPlace } from "@/core/types";
import { ScrapeError } from "@/scrapers/errors";
import type { ScrapeCache } from "@/scrapers/types";
import { createGoogleFlightsAdapter, searchUrl } from "@/scrapers/transport/google-flights";
import type { FlightsDriver } from "@/scrapers/transport/google-flights-chrome";
import { googleFlights } from "@/config";
import { getSearchProblems, startCompute } from "@/server/services/compute";
import { addDestination } from "@/server/services/destinations";
import { addGuest, setGuestModes } from "@/server/services/guests";
import { createTrip } from "@/server/services/trips";
import { createTestDb } from "./helpers/db";
import { fakeRoute, fixtureAdapters, madrid, runUntilIdle } from "./helpers/compute";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests/fixtures/google-flights", name), "utf8");
const TLS_LIS_OUT = fixture("tls-lis-outbound.txt");
const LIS_TLS_BACK = fixture("lis-tls-returns.txt");

const toulouse: GeoPlace = { label: "Toulouse, France", countryCode: "FR", lat: 43.6044638, lon: 1.4442433, airports: ["TLS", "DCM", "CCF", "RDZ", "LDE", "LEU"] };
const lisbon: GeoPlace = { label: "Lisbon, Portugal", countryCode: "PT", lat: 38.7077507, lon: -9.1365919, airports: ["LIS", "CAT"] };
const barcelona: GeoPlace = { label: "Barcelona, Spain", countryCode: "ES", lat: 41.3825802, lon: 2.177073, airports: ["BCN", "GRO", "REU", "LEU", "ILD"] };
const paris: GeoPlace = { label: "Paris, France", countryCode: "FR", lat: 48.8534951, lon: 2.3483915, airports: ["ORY", "CDG", "BVA", "XCR"] };

const dates = { availableFrom: "2026-12-22", availableTo: "2026-12-26" };
const now = () => new Date("2026-10-20T10:00:00Z");

/**
 * Google as it answered on the day: Toulouse to Lisbon has flights, Castres (DCM) to Lisbon has none, and
 * Cascais (CAT) is an airport it does not know. Every other route has no flight.
 */
function googleOnTheDay() {
  const asked: string[] = [];
  const driver: FlightsDriver = vi.fn(async (url) => {
    const q = new URL(url).searchParams.get("q")!;
    asked.push(q.replace(/ on .*/, ""));
    if (q.startsWith("Flights from TLS to LIS")) return { answers: [TLS_LIS_OUT, LIS_TLS_BACK], rows: [] };
    // Google does not know Cascais: its landing page is shown, and the driver reports it as "no flights"
    return { answers: [], rows: [] };
  });
  return { driver, asked };
}

const flights = (driver: FlightsDriver) => createGoogleFlightsAdapter({ driver, config: googleFlights, now });

async function theTrip() {
  const trip = createTrip(db);
  const mael = (await addGuest(db, trip.id, { name: "Mael", homePlace: toulouse, maxBudgetEur: 700, ...dates, preferredMode: "plane" })).guest;
  const elena = (await addGuest(db, trip.id, { name: "Elena", homePlace: madrid, maxBudgetEur: 500, ...dates, preferredMode: "car" })).guest;
  await setGuestModes(db, elena.id, ["car", "plane"], fakeRoute);
  const bcn = await addDestination(db, trip.id, { place: barcelona, budgetLevel: "medium", objective: "culture", dateFrom: "2026-12-22", dateTo: "2026-12-26" });
  const lis = await addDestination(db, trip.id, { place: lisbon, budgetLevel: "medium", objective: "culture", dateFrom: "2026-12-22", dateTo: "2026-12-26" });
  return { tripId: trip.id, mael, destinations: { bcn, lis } };
}

describe("Toulouse to Lisbon with the airports the app really lists", () => {
  it("looks at the pairs of airports, and the one that gets no answer does not lose the flights the others found", async () => {
    const { driver, asked } = googleOnTheDay();
    const options = await flights(driver).search({
      mode: "plane",
      origin: { key: "toulouse-france", label: "Toulouse, France", lat: toulouse.lat, lon: toulouse.lon, airports: toulouse.airports },
      destination: { id: "lis", label: "Lisbon, Portugal", lat: lisbon.lat, lon: lisbon.lon, airports: lisbon.airports },
      window: { from: "2026-12-22", to: "2026-12-26" },
    });

    // The four pairs were tried: TLS-LIS answered, the others have no flight
    expect(asked).toEqual(["Flights from TLS to LIS", "Flights from TLS to CAT", "Flights from DCM to LIS", "Flights from DCM to CAT"]);
    expect(options.length).toBeGreaterThan(5);
    const cheapest = options[0];
    expect(cheapest).toMatchObject({ mode: "plane", originKey: "toulouse-france", variant: "standard", priceUnit: "per_person" });
    expect(cheapest.priceEur).toBeGreaterThan(50);
    expect(cheapest.priceEur).toBeLessThan(400);
    expect(cheapest.outDepartAt).toMatch(/^2026-12-22T\d\d:\d\d$/);
    expect(cheapest.backDepartAt).toMatch(/^2026-12-26T\d\d:\d\d$/);
    expect(options.every((o) => (o.raw as { pair: string[] }).pair.join("-") === "TLS-LIS")).toBe(true);
  });

  it("only fails when no pair answered at all", async () => {
    const down: FlightsDriver = async () => {
      throw new ScrapeError("Google Flights did not answer in time");
    };
    await expect(
      flights(down).search({
        mode: "plane",
        origin: { key: "t", label: "Toulouse, France", lat: toulouse.lat, lon: toulouse.lon, airports: toulouse.airports },
        destination: { id: "lis", label: "Lisbon, Portugal", lat: lisbon.lat, lon: lisbon.lon, airports: lisbon.airports },
        window: { from: "2026-12-22", to: "2026-12-26" },
      }),
    ).rejects.toThrow("did not answer in time");
  });
});

describe("the whole trip, as it was on the user's machine", () => {
  it("finds Mael a flight to Lisbon, stores it, and the trip has nothing to report", async () => {
    const { tripId, destinations } = await theTrip();
    const { driver } = googleOnTheDay();
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ flights: flights(driver) }));

    const planes = db.select().from(schema.transportOptions).all().filter((o) => o.mode === "plane" && o.destinationId === destinations.lis.id);
    expect(planes.length).toBeGreaterThan(5);
    expect(planes.every((o) => o.originKey === "toulouse-france")).toBe(true);
    expect(getSearchProblems(db, tripId)).toEqual([]);
  });

  it("tells that a destination added after the search has not been searched, and searching again finds it", async () => {
    const { tripId } = await theTrip();
    const { driver } = googleOnTheDay();
    const adapters = fixtureAdapters({ flights: flights(driver) });
    startCompute(db, tripId);
    await runUntilIdle(db, adapters);

    // Paris is added once the trip is already worked out: nothing looks it up
    const added = await addDestination(db, tripId, { place: paris, budgetLevel: "medium", objective: "culture", dateFrom: "2026-12-22", dateTo: "2026-12-26" });
    expect(getSearchProblems(db, tripId)).toEqual([{ kind: "not_searched", to: "Paris" }]);

    startCompute(db, tripId, { retry: true });
    await runUntilIdle(db, adapters, { route: fakeRoute });
    expect(getSearchProblems(db, tripId)).toEqual([]);
    // Its searches were made (the fake Google has no flight to Paris, so there is nothing to store)
    const parisSearches = db.select().from(schema.jobs).all().filter((j) => j.type.startsWith("search_") && JSON.parse(j.payloadJson).destinationId === added.id);
    expect(parisSearches.length).toBeGreaterThan(0);
    expect(parisSearches.every((j) => j.status === "done")).toBe(true);
  });
});

describe("the address that is asked", () => {
  it("is the one for TLS to LIS on the stay's days", () => {
    const url = new URL(searchUrl(googleFlights, "TLS", "LIS", { from: "2026-12-22", to: "2026-12-26" }));
    expect(url.searchParams.get("q")).toBe("Flights from TLS to LIS on 2026-12-22 through 2026-12-26");
  });
});

describe("Nathan from Mont-Saxonnex to Prague, where the search came back empty without saying why", () => {
  const origin = { key: "mont-saxonnex-france", label: "Mont-Saxonnex, France", lat: 46.05, lon: 6.45, airports: ["NCY", "GVA", "CMF", "LYS", "GNB", "BRN", "TRN", "DLE"] };
  const destination = { id: "prague", label: "Prague, Czechia", lat: 50.0874654, lon: 14.4212535, airports: ["PRG", "PED", "KLV", "DRS", "JCL"] };
  const window = { from: "2026-12-08", to: "2026-12-12" };

  /** Google as it answered: Annecy (NCY) is its landing page, Geneva to Prague is the airport pair that matters. */
  const search = (geneva: FlightsDriver, cache?: ScrapeCache) =>
    createGoogleFlightsAdapter({
      driver: vi.fn<FlightsDriver>(async (url, options) => (new URL(url).searchParams.get("q")!.startsWith("Flights from GVA to PRG") ? geneva(url, options) : { answers: [], rows: [] })),
      config: googleFlights,
      now,
    }).search({ mode: "plane", origin, destination, window, cache });

  const labels = [
    "From 172 euros round trip total. 1 stop flight with Lufthansa. Leaves Geneva Airport at 1:20 PM on Tuesday, December 8 and arrives at Václav Havel Airport Prague at 4:05 PM on Tuesday, December 8. Total duration 2 hr 45 min.   Select flight",
    "From 176 euros round trip total. 1 stop flight with SWISS. Leaves Geneva Airport at 6:00 AM on Tuesday, December 8 and arrives at Václav Havel Airport Prague at 8:50 AM on Tuesday, December 8. Total duration 2 hr 50 min.   Select flight",
  ];

  it("says so when the one pair that matters did not answer, instead of finding 'nothing'", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const silent: FlightsDriver = async () => {
      throw new ScrapeError("Google Flights did not answer in time");
    };
    await expect(search(silent)).rejects.toThrow("did not answer in time (GVA to PRG)");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("GVA to PRG could not be searched"));
    warn.mockRestore();
  });

  it("finds flights from what the page shows when its answer was not captured", async () => {
    const options = await search(async () => ({ answers: [], rows: labels }));
    expect(options.map((o) => [o.provider, o.priceEur, o.stops, o.outDepartAt, o.outArriveAt, o.outDurationMin])).toEqual([
      ["lufthansa", 172, 1, "2026-12-08T13:20", "2026-12-08T16:05", 165],
      ["swiss", 176, 1, "2026-12-08T06:00", "2026-12-08T08:50", 170],
    ]);
    // The page does not tell the way back
    expect(options[0].backDepartAt).toBeNull();
  });

  it("does not keep 'no flight' for a day: an empty answer may only be a page that did not load", async () => {
    const kept = new Map<string, unknown>();
    const cache: ScrapeCache = {
      async remember(key, _source, _ttl, produce, options) {
        if (!options?.refresh && kept.has(key)) return kept.get(key) as never;
        const value = await produce();
        if (options?.keepIf && !options.keepIf(value)) return value;
        kept.set(key, JSON.parse(JSON.stringify(value)));
        return value;
      },
    };
    expect(await search(async () => ({ answers: [], rows: [] }), cache)).toEqual([]);
    expect(kept.size).toBe(0);
    // Asked again, it finds them
    expect((await search(async () => ({ answers: [], rows: labels }), cache)).length).toBe(2);
    expect(kept.size).toBe(1);
  });
});
