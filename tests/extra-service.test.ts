// Each guest's Extra from the stored facts (task.md T8.6): where a journey arrives, how long public transport takes,
// how each stay is reached, and the Extra of the ❤ or default stay, which moves at once with a ❤ on another one.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlacePoint } from "@/core/surroundings";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { hubsOf } from "@/geo/hubs";
import { ScrapeBlockedError } from "@/scrapers/errors";
import { quickestOf, type LocalTransit } from "@/scrapers/places/local-transit";
import type { StayAdapter } from "@/scrapers/types";
import { startCompute } from "@/server/services/compute";
import { tripExtras } from "@/server/services/extras";
import { setSelection } from "@/server/services/selections";
import { arrivalHubs, getPlaceSurveys, surveyAccess, surveyPlaces } from "@/server/services/surveys";
import { createTestDb } from "./helpers/db";
import { enterScenario, fixtureAdapters, montSaxonnex, reunion, runUntilIdle } from "./helpers/compute";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

const barcelona = { label: "Barcelona, Spain", lat: 41.3874, lon: 2.1686, airports: ["BCN"] };

describe("hubsOf: where a journey arrives and where the way back leaves", () => {
  it("takes a flight's arrival airport, and the way back from its return flight's first airport", () => {
    const { there, back } = hubsOf({ pair: ["MAD", "GVA"], back: { flights: ["UX1664 GVA-MAD"] } }, "plane", barcelona);
    expect(there).toMatchObject({ name: "GVA" });
    expect(there.lat).toBeCloseTo(46.24, 1);
    expect(back.name).toBe("GVA");
  });

  it("takes a train's last station there and first station back", () => {
    const leg = (from: string, to: string, lat: number, lon: number) => ({ from: { name: from, lat, lon }, to: { name: to, lat: lat + 0.1, lon } });
    const raw = { out: { legs: [leg("Lyon", "Valence", 45, 4.9), leg("Valence", "Barcelona Sants", 41.28, 2.14)] }, back: { legs: [leg("Barcelona Sants", "Lyon", 41.379, 2.14)] } };
    expect(hubsOf(raw, "train", barcelona)).toEqual({ there: { name: "Barcelona Sants", lat: 41.38, lon: 2.14 }, back: { name: "Barcelona Sants", lat: 41.379, lon: 2.14 } });
  });

  it("falls back on the destination's airport for a plane, and on the destination for a bus or a sample", () => {
    expect(hubsOf({ fixture: true }, "plane", barcelona).there.name).toBe("BCN");
    expect(hubsOf({ out: { legs: ["bus"] } }, "bus", barcelona).there).toEqual({ name: "Barcelona", lat: 41.3874, lon: 2.1686 });
  });
});

describe("quickestOf: Transitous' quickest local journey", () => {
  // As Transitous answered for Barcelona airport to the centre at midday (2026-11-14): the A2 bus, or the A2 and line 1
  const answer = {
    itineraries: [
      { duration: 3060, startTime: "2026-12-22T11:02:00Z", legs: [{ mode: "WALK" }, { mode: "BUS" }, { mode: "WALK" }] },
      { duration: 2520, startTime: "2026-12-22T11:02:00Z", legs: [{ mode: "WALK" }, { mode: "BUS" }, { mode: "SUBWAY" }] },
      { duration: 1500, startTime: "2026-12-22T13:30:00Z", legs: [{ mode: "BUS" }] },
    ],
    direct: [],
  };

  it("takes the quickest that leaves within the hour, in minutes", () => {
    expect(quickestOf(answer, "2026-12-22T11:00:00Z")).toBe(42);
  });

  it("finds none when nothing rides within the hour, and says the answer changed when it is not a plan", () => {
    expect(quickestOf({ itineraries: [answer.itineraries[2]], direct: [] }, "2026-12-22T11:00:00Z")).toBeNull();
    expect(() => quickestOf({ nope: true }, "2026-12-22T11:00:00Z")).toThrow(/not with journeys/);
  });
});

/** Two places to stay at each destination, placed: a flat with a kitchen and, dearer, a hotel without one */
const placedStays: StayAdapter = {
  id: "placed",
  async search(query) {
    const base = { photos: [], capacity: 3, rooms: 2, beds: 3, checkIn: query.window.from, checkOut: query.window.to, rating: 4.8, reviewsSample: null, url: null };
    return [
      { ...base, provider: "airbnb", externalId: `flat-${query.destination.label}`, title: "Quiet flat", totalPriceEur: 900, raw: { lat: query.destination.lat + 0.01, lon: query.destination.lon + 0.01, amenities: ["Kitchen", "Wifi"], touristTax: { included: null, amountEur: null, perPersonNightEur: null, maxNights: null, basis: null } } },
      { ...base, provider: "booking", externalId: `hotel-${query.destination.label}`, title: "Hotel", totalPriceEur: 1500, raw: { lat: query.destination.lat, lon: query.destination.lon, amenities: ["Free Wi-Fi", "Pool"], touristTax: { included: true, amountEur: null, perPersonNightEur: null, maxNights: null, basis: "google-policy" } } },
    ];
  },
};

/** Around each destination: a supermarket 300 m from the flat, bars around a spot 500 m away */
const around = (centre: { lat: number; lon: number }): PlacePoint[] => [
  { kind: "supermarket", lat: centre.lat + 0.012, lon: centre.lon + 0.01 },
  ...Array.from({ length: 12 }, (_, i): PlacePoint => ({ kind: "bar", lat: centre.lat + 0.005 + i * 0.0001, lon: centre.lon + 0.005 })),
];

describe("surveyAccess: how each stay is reached", () => {
  it("asks for each arrival point and stay at midday, and for a night bus back on a partying trip", async () => {
    const { tripId, destinations } = await enterScenario(db);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ stays: placedStays }), { fixtureFacts: false });
    expect(arrivalHubs(db, destinations.bcn.id).map((hub) => hub.name)).toEqual(["BCN"]);

    await surveyPlaces(db, { destinationId: destinations.bcn.id }, async () => around(barcelona));
    const transit = vi.fn<LocalTransit>(async (_from, _to, atUtc) => (atUtc.endsWith("T02:00:00Z") ? 25 : 40));
    expect(await surveyAccess(db, destinations.bcn.id, transit)).toEqual({ stays: 2, asked: 4, problem: null });

    const [flat] = [...getPlaceSurveys(db, destinations.bcn.id).values()];
    expect(flat.access).toMatchObject({ transfers: [{ hub: "BCN", transitMin: 40 }], nightBus: true });
    expect(flat.access!.transfers[0].km).toBeGreaterThan(10);
    // Midday on the day they arrive, three in the morning the next day
    expect(transit.mock.calls.map((call) => call[2])).toContain("2027-08-26T11:00:00Z");
    expect(transit.mock.calls.map((call) => call[2])).toContain("2027-08-27T02:00:00Z");
  });

  it("stops asking Transitous once it turns us away: the rest are taxis", async () => {
    const { tripId, destinations } = await enterScenario(db);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ stays: placedStays }), { fixtureFacts: false });
    await surveyPlaces(db, { destinationId: destinations.bcn.id }, async () => around(barcelona));
    const transit = vi.fn<LocalTransit>(async () => {
      throw new ScrapeBlockedError("Transitous asked us to slow down");
    });
    expect(await surveyAccess(db, destinations.bcn.id, transit)).toMatchObject({ asked: 1, problem: "Transitous asked us to slow down" });
    expect([...getPlaceSurveys(db, destinations.bcn.id).values()][0].access).toMatchObject({ transfers: [{ transitMin: null }], nightBus: null });
  });
});

describe("tripExtras: each guest's Extra, from the stored facts", () => {
  async function computed() {
    const scenario = await enterScenario(db);
    startCompute(db, scenario.tripId);
    const transit: LocalTransit = async (_from, _to, atUtc) => (atUtc.endsWith("T02:00:00Z") ? 25 : 40);
    // The same places around each of the three destinations
    const everywhere = [barcelona, reunion, montSaxonnex].flatMap(around);
    // What this computation found, not UC-D's reference facts
    await runUntilIdle(db, fixtureAdapters({ stays: placedStays }), { places: async () => everywhere, transit, fixtureFacts: false });
    return scenario;
  }

  it("works out Barcelona's Extra for the default stay: the flat, its kitchen, the bus from the airport by day, Martin's parking", async () => {
    const { tripId, destinations, guests } = await computed();
    const extra = tripExtras(db, tripId).get(destinations.bcn.id)!;
    expect(extra).toMatchObject({ staySource: "default", pricesSource: "rules" });
    expect(extra.input.stay).toMatchObject({ provider: "airbnb", kitchen: true, calmWords: true });
    // Partying, light budget, a kitchen: 10 % of the meals out
    expect(extra.plan.restaurantSharePct).toBe(10);
    const chloe = extra.input.guests.find((guest) => guest.guestId === guests.chloe.id)!;
    expect(chloe).toMatchObject({ mode: "plane", there: { hub: "BCN" } });
    // Martin drives: no transfer, parking instead (no free parking at the flat)
    const martin = extra.plan.guests.find((guest) => guest.guestId === guests.martin.id)!;
    expect(martin.lines.map((line) => line.id)).toContain("parking");
    expect(martin.lines.map((line) => line.id)).not.toContain("transfer");
  });

  it("moves at once with a ❤ on the hotel: no kitchen, so two meals in three out, and its tax already in the price", async () => {
    const { tripId, destinations } = await computed();
    const before = tripExtras(db, tripId).get(destinations.bcn.id)!;
    const [hotel] = db.select().from(schema.stayOptions).where(eq(schema.stayOptions.provider, "booking")).all().filter((stay) => stay.destinationId === destinations.bcn.id);

    setSelection(db, destinations.bcn.id, { kind: "stay", optionId: hotel.id });
    const after = tripExtras(db, tripId).get(destinations.bcn.id)!;

    expect(after).toMatchObject({ stayId: hotel.id, staySource: "selected" });
    expect(after.plan.restaurantSharePct).toBe(67);
    expect(after.plan.guests[0].mandatoryEur).toBeGreaterThan(before.plan.guests[0].mandatoryEur);
    expect(after.input.stay.touristTax).toMatchObject({ included: true });
  });

  it("gives every destination with a stay its Extra, by its objective", async () => {
    const { tripId, destinations } = await computed();
    const extras = tripExtras(db, tripId);
    expect(extras.get(destinations.run.id)!.input.objective).toBe("chill");
    expect(extras.get(destinations.ms.id)!.plan.hikeDays).toBe(6);
  });
});
