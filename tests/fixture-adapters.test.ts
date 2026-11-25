import { describe, expect, it } from "vitest";
import { SCENARIO_WINDOW, stayFixtures, transportFixtures, type DestinationKey } from "@/db/seed/fixtures";
import { fixtureStaysAdapter } from "@/scrapers/stays/fixture-stays";
import { fixtureFlightsAdapter } from "@/scrapers/transport/fixture-flights";
import type { StayQuery, TransportQuery } from "@/scrapers/types";
import { loadScenario } from "./helpers/scenario";

// The scenario's places as a geocoder and the airports list describe them
const madrid = { key: "madrid-spain", label: "Madrid, Spain", lat: 40.4168, lon: -3.7038, airports: ["MAD"] };
const paris = { key: "paris-france", label: "Paris, France", lat: 48.8566, lon: 2.3522, airports: ["ORY", "CDG"] };
const lyon = { key: "lyon-france", label: "Lyon, France", lat: 45.76, lon: 4.84, airports: ["LYS"] };

const barcelona = { id: "d-bcn", label: "Barcelona, Spain", lat: 41.3874, lon: 2.1686, airports: ["BCN", "GRO"] };
const reunion = { id: "d-run", label: "Réunion, France", lat: -21.1309, lon: 55.5266, airports: ["ZSE", "RUN"] };
const montSaxonnex = { id: "d-ms", label: "Mont-Saxonnex, France", lat: 46.0517, lon: 6.4533, airports: ["NCY", "GVA", "CMF"] };
const nowhere = { id: "d-x", label: "Nowhere", lat: 0, lon: 0, airports: ["XXX"] };

const flights = (origin: typeof madrid, destination: typeof barcelona, window = SCENARIO_WINDOW): Promise<unknown[]> =>
  fixtureFlightsAdapter.search({ mode: "plane", origin, destination, window } satisfies TransportQuery);

describe("fixtureFlightsAdapter", () => {
  it("is the plane source", () => {
    expect(fixtureFlightsAdapter).toMatchObject({ id: "fixture-flights", modes: ["plane"] });
  });

  it.each([
    ["Madrid", madrid, "MAD", "Barcelona", barcelona, "barcelona", 2],
    ["Paris", paris, "PAR", "Barcelona", barcelona, "barcelona", 2],
    ["Madrid", madrid, "MAD", "La Réunion", reunion, "la-reunion", 2],
    ["Paris", paris, "PAR", "La Réunion", reunion, "la-reunion", 2],
    ["Madrid", madrid, "MAD", "Mont-Saxonnex", montSaxonnex, "mont-saxonnex", 1],
    ["Paris", paris, "PAR", "Mont-Saxonnex", montSaxonnex, "mont-saxonnex", 1],
  ] as const)("%s → %s has exactly the §1.3 flights", async (_o, origin, originKey, _d, destination, destinationKey, count) => {
    const found = (await flights(origin, destination)) as { provider: string; priceEur: number }[];
    const expected = transportFixtures.filter(
      (f) => f.mode === "plane" && f.originKey === originKey && f.destination === (destinationKey as DestinationKey),
    );
    expect(found).toHaveLength(count);
    expect(found.map((o) => [o.provider, o.priceEur])).toEqual(expected.map((f) => [f.provider, f.priceEur]));
  });

  it("has the Madrid → Barcelona flights of the table: Vueling 06:45 at 70 € and Iberia 10:15 at 95 €", async () => {
    const found = await flights(madrid, barcelona);
    expect(found).toMatchObject([
      { provider: "vueling", priceEur: 70, priceUnit: "per_person", stops: 0, outDurationMin: 75, outDepartAt: "2027-08-26T06:45", outArriveAt: "2027-08-26T08:00" },
      { provider: "iberia", priceEur: 95, priceUnit: "per_person", stops: 0, outDurationMin: 75, outDepartAt: "2027-08-26T10:15" },
    ]);
  });

  it("has the 910 € flight to La Réunion, 3 stops and 23 h 40, among the offers from Madrid", async () => {
    const found = await flights(madrid, reunion);
    expect(found).toContainEqual(expect.objectContaining({ priceEur: 910, stops: 3, outDurationMin: 1420 }));
    expect(found).toContainEqual(expect.objectContaining({ priceEur: 1040, stops: 1, outDurationMin: 870 }));
  });

  it("adds the 50 € bus or taxi to Mont-Saxonnex as the last mile", async () => {
    expect(await flights(paris, montSaxonnex)).toMatchObject([{ provider: "easyjet", priceEur: 110, lastMileEur: 50 }]);
    expect(await flights(madrid, barcelona)).toSatisfy((all: { lastMileEur: number }[]) => all.every((o) => o.lastMileEur === 0));
  });

  it("keeps the departure place's own key, so the worker files the options under the guests' origin", async () => {
    const found = (await flights(paris, barcelona)) as { originKey: string }[];
    expect(found.every((o) => o.originKey === "paris-france")).toBe(true);
  });

  it("finds the same flights for guests who leave from Paris by Orly or by Roissy", async () => {
    const byOrly = await flights({ ...paris, airports: ["ORY"] }, barcelona);
    const byRoissy = await flights({ ...paris, airports: ["CDG"] }, barcelona);
    expect(byOrly).toEqual(byRoissy);
    expect(byOrly).toHaveLength(2);
  });

  it("returns the flights of the dates asked for: out on the first day, back on the last", async () => {
    const [first] = (await flights(madrid, barcelona, { from: "2028-03-10", to: "2028-03-17" })) as Record<string, unknown>[];
    expect(first).toMatchObject({
      outDepartAt: "2028-03-10T06:45", outArriveAt: "2028-03-10T08:00",
      backDepartAt: "2028-03-17T16:00", backArriveAt: "2028-03-17T17:15",
      priceEur: 70,
    });
  });

  it("leaves the comfort to core/comfort.ts: nothing is rated here", async () => {
    const found = (await flights(madrid, barcelona)) as { comfortScore: number | null; comfortLevel: string | null }[];
    expect(found.every((o) => o.comfortScore === null && o.comfortLevel === null)).toBe(true);
  });

  it("only knows the scenario: any other pair of places has no flight", async () => {
    expect(await flights(lyon, barcelona)).toEqual([]);
    expect(await flights(madrid, nowhere)).toEqual([]);
    expect(await flights({ ...madrid, airports: [] }, barcelona)).toEqual([]);
  });

  it("has nothing for the other modes, and never hands out the car fixtures", async () => {
    for (const mode of ["car", "train", "bus"] as const) {
      expect(await fixtureFlightsAdapter.search({ mode, origin: madrid, destination: barcelona, window: SCENARIO_WINDOW })).toEqual([]);
    }
    const found = (await flights(madrid, montSaxonnex)) as { mode: string }[];
    expect(found.every((o) => o.mode === "plane")).toBe(true);
  });
});

const stays = (destination: typeof barcelona, window = SCENARIO_WINDOW, groupSize = 3) =>
  fixtureStaysAdapter.search({ destination, window, groupSize } satisfies StayQuery);

describe("fixtureStaysAdapter", () => {
  it("is a stay source", () => {
    expect(fixtureStaysAdapter.id).toBe("fixture-stays");
  });

  it("has exactly the §1.3 offers of each destination", async () => {
    expect((await stays(barcelona)).map((s) => [s.provider, s.totalPriceEur])).toEqual([["airbnb", 900], ["booking", 1200]]);
    expect((await stays(reunion)).map((s) => [s.provider, s.totalPriceEur])).toEqual([["airbnb", 800]]);
    expect((await stays(montSaxonnex)).map((s) => [s.provider, s.totalPriceEur])).toEqual([["airbnb", 900]]);
  });

  it("describes the Gràcia apartment: 2 bedrooms, 3 beds, for the whole stay", async () => {
    const [apartment] = await stays(barcelona);
    expect(apartment).toMatchObject({
      title: "Gràcia apartment, 2 bedrooms, 3 beds", rooms: 2, beds: 3, capacity: 3,
      checkIn: "2027-08-26", checkOut: "2027-09-05", externalId: "fixture-barcelona-gracia",
    });
  });

  it("knows nothing it should not invent: no rating, reviews, photos or link", async () => {
    const [apartment] = await stays(barcelona);
    expect(apartment).toMatchObject({ rating: null, reviewsSample: null, photos: [], url: null });
  });

  it("charges the same per night for another length of stay", async () => {
    // 900 € for 10 nights is 90 € a night
    expect((await stays(barcelona, { from: "2027-08-26", to: "2027-08-31" }))[0].totalPriceEur).toBe(450);
    expect((await stays(barcelona, { from: "2027-08-26", to: "2027-08-27" }))[0].totalPriceEur).toBe(90);
    expect((await stays(reunion, { from: "2027-08-26", to: "2027-09-02" }))[0].totalPriceEur).toBe(560);
  });

  it("takes the dates of the stay asked for", async () => {
    const [first] = await stays(barcelona, { from: "2028-03-10", to: "2028-03-17" });
    expect(first).toMatchObject({ checkIn: "2028-03-10", checkOut: "2028-03-17" });
  });

  it("has nothing to sell for a stay of no night", async () => {
    expect(await stays(barcelona, { from: "2027-08-26", to: "2027-08-26" })).toEqual([]);
  });

  it("returns every offer whatever the group size: choosing one that fits is up to the caller", async () => {
    expect(await stays(barcelona, SCENARIO_WINDOW, 8)).toHaveLength(2);
  });

  it("only knows the scenario's destinations", async () => {
    expect(await stays(nowhere)).toEqual([]);
  });

  it("matches the fixtures table: 4 offers in all, none for the other places", async () => {
    const all = (await Promise.all([barcelona, reunion, montSaxonnex].map((d) => stays(d)))).flat();
    expect(all).toHaveLength(stayFixtures.length);
  });
});

/** The object without the given keys: what is the database's own (ids, fetch time) or the adapter's own (raw). */
const without = (object: object, ...keys: string[]) =>
  Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));

describe("the adapters and the seeded database give the same scenario", () => {
  const s = loadScenario();
  const byKey = (destination: DestinationKey) => s.destinations[destination];

  it("finds, for every pair, the flights the seed stored (same dates, prices, times, stops, last mile)", async () => {
    const places = { MAD: madrid, PAR: paris };
    const dest = { barcelona, "la-reunion": reunion, "mont-saxonnex": montSaxonnex };
    for (const [destKey, destination] of Object.entries(dest) as [DestinationKey, typeof barcelona][]) {
      for (const [originKey, origin] of Object.entries(places)) {
        // The seed files its options under the fixtures' own keys: ask under the same one to compare
        const found = (await flights({ ...origin, key: originKey } as typeof madrid, destination)) as Record<string, unknown>[];
        const stored = s.options
          .filter((o) => o.destinationId === byKey(destKey).id && o.originKey === originKey && o.mode === "plane")
          // A fare found by an adapter is a real price unless it says otherwise: the stored row says so with its defaults
          .map((o) => without(o, "id", "tripId", "destinationId", "fetchedAt", "priceKind", "priceNote", "soldOut"));
        expect(found.map((o) => without(o, "raw"))).toEqual(stored);
      }
    }
  });

  it("finds, for every destination, the stays the seed stored", async () => {
    const dest = { barcelona, "la-reunion": reunion, "mont-saxonnex": montSaxonnex };
    for (const [destKey, destination] of Object.entries(dest) as [DestinationKey, typeof barcelona][]) {
      const stored = s.stays
        .filter((stay) => stay.destinationId === byKey(destKey).id)
        .map((stay) => without(stay, "id", "destinationId", "fetchedAt"));
      expect((await stays(destination)).map((stay) => without(stay, "raw"))).toEqual(stored);
    }
  });
});
