// What is around each place to stay, stored per stay (task.md T8.3): the survey service, and its place in a
// computation: after the searches, before the ratings, and never in the way of the trip.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlacePoint } from "@/core/surroundings";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { ScrapeBlockedError } from "@/scrapers/errors";
import type { PlacesFetcher } from "@/scrapers/places/overpass";
import type { StayAdapter } from "@/scrapers/types";
import { getProgress, startCompute } from "@/server/services/compute";
import { getPlaceSurveys, surveyPlaces } from "@/server/services/surveys";
import { getTrip } from "@/server/services/trips";
import { createTestDb } from "./helpers/db";
import { enterScenario, fixtureAdapters, runUntilIdle } from "./helpers/compute";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

/** Places around central Barcelona: a supermarket and bars near Gràcia */
const AROUND: PlacePoint[] = [
  { kind: "supermarket", lat: 41.4027, lon: 2.1530 },
  ...Array.from({ length: 12 }, (_, i): PlacePoint => ({ kind: "bar", lat: 41.402 + i * 0.0002, lon: 2.152 + i * 0.0002 })),
  { kind: "sight", lat: 41.4036, lon: 2.1744 },
];

function addStay(destinationId: string, externalId: string, raw: Record<string, unknown>) {
  return db
    .insert(schema.stayOptions)
    .values({ destinationId, provider: "airbnb", externalId, title: externalId, capacity: 3, checkIn: "2027-08-26", checkOut: "2027-09-05", totalPriceEur: 900, rawJson: JSON.stringify(raw) })
    .returning()
    .get();
}

describe("surveyPlaces", () => {
  it("asks once for the destination's area, and stores what is around each stay it can place", async () => {
    const { destinations } = await enterScenario(db);
    const gracia = addStay(destinations.bcn.id, "gracia", { lat: 41.4025, lon: 2.1525 });
    const sagrada = addStay(destinations.bcn.id, "sagrada", { lat: 41.4048, lon: 2.1761 });
    addStay(destinations.bcn.id, "older", { distanceKm: 2 });
    const fetchPlaces = vi.fn<PlacesFetcher>(async () => AROUND);

    expect(await surveyPlaces(db, { destinationId: destinations.bcn.id }, fetchPlaces)).toEqual({ surveyed: 2, withoutPosition: 1 });
    expect(fetchPlaces).toHaveBeenCalledTimes(1);
    expect(fetchPlaces.mock.calls[0][0]).toEqual({ south: 41.3, west: 2.1, north: 41.45, east: 2.25 });

    const surveys = getPlaceSurveys(db, destinations.bcn.id);
    expect([...surveys.keys()].sort()).toEqual([gracia.id, sagrada.id].sort());
    expect(surveys.get(gracia.id)).toMatchObject({ barsWithin500m: 12, supermarketKm: expect.any(Number), nightlifeKm: expect.any(Number) });
    expect(surveys.get(gracia.id)!.supermarketKm).toBeLessThan(0.1);
    expect(surveys.get(sagrada.id)).toMatchObject({ barsWithin500m: 0, sightsWithin1Km: 1 });
  });

  it("asks nothing when no stay can be placed, and replaces the rows at the next survey", async () => {
    const { destinations } = await enterScenario(db);
    const older = addStay(destinations.bcn.id, "older", {});
    const fetchPlaces = vi.fn<PlacesFetcher>(async () => AROUND);
    expect(await surveyPlaces(db, { destinationId: destinations.bcn.id }, fetchPlaces)).toEqual({ surveyed: 0, withoutPosition: 1 });
    expect(fetchPlaces).not.toHaveBeenCalled();

    db.update(schema.stayOptions).set({ rawJson: JSON.stringify({ lat: 41.4025, lon: 2.1525 }) }).where(eq(schema.stayOptions.id, older.id)).run();
    await surveyPlaces(db, { destinationId: destinations.bcn.id }, fetchPlaces);
    await surveyPlaces(db, { destinationId: destinations.bcn.id }, fetchPlaces);
    expect(db.select().from(schema.placeSurveys).all()).toHaveLength(1);
  });

  it("loses a stay's survey with the stay, and passes `force` on as asking again", async () => {
    const { destinations } = await enterScenario(db);
    const gracia = addStay(destinations.bcn.id, "gracia", { lat: 41.4025, lon: 2.1525 });
    const fetchPlaces = vi.fn<PlacesFetcher>(async () => AROUND);
    await surveyPlaces(db, { destinationId: destinations.bcn.id, force: true }, fetchPlaces);
    expect(fetchPlaces.mock.calls[0][1]).toMatchObject({ refresh: true });

    db.delete(schema.stayOptions).where(eq(schema.stayOptions.id, gracia.id)).run();
    expect(db.select().from(schema.placeSurveys).all()).toEqual([]);
  });
});

describe("the survey in a computation", () => {
  /** The scenario's stays, placed: as the real stay adapters keep them since T8.2 */
  const placedStays: StayAdapter = {
    id: "placed",
    async search(query) {
      return [{ provider: "airbnb", externalId: `placed-${query.destination.label}`, title: "Flat", photos: [], capacity: 3, rooms: 2, beds: 3, checkIn: query.window.from, checkOut: query.window.to, totalPriceEur: 900, rating: 4.8, reviewsSample: null, url: null, raw: { lat: query.destination.lat + 0.01, lon: query.destination.lon + 0.01 } }];
    },
  };

  it("looks around each destination's stays once the searches are done, before the ratings", async () => {
    const { tripId, destinations } = await enterScenario(db);
    const order: string[] = [];
    const places = vi.fn<PlacesFetcher>(async () => (order.push("survey"), AROUND));
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ stays: placedStays }), { places });

    expect(places).toHaveBeenCalledTimes(3);
    expect(getPlaceSurveys(db, destinations.bcn.id).size).toBe(1);
    const steps = getProgress(db, tripId).steps.map((step) => [step.id, step.state]);
    expect(steps).toContainEqual(["survey", "done"]);
    const ids = steps.map(([id]) => id);
    expect(ids.indexOf("survey")).toBeGreaterThan(ids.indexOf("stays"));
    expect(ids.indexOf("survey")).toBeLessThan(ids.indexOf("rate:stays"));
    expect(getTrip(db, tripId)!.status).toBe("ready");
  });

  it("finishes the trip when OpenStreetMap turns the survey away, and says so on the progress screen", async () => {
    const { tripId } = await enterScenario(db);
    const places: PlacesFetcher = async () => {
      throw new ScrapeBlockedError("OpenStreetMap's Overpass asked us to slow down");
    };
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters({ stays: placedStays }), { places });

    expect(getTrip(db, tripId)!.status).toBe("ready");
    expect(getProgress(db, tripId).steps.find((step) => step.id === "survey")).toMatchObject({ state: "failed", error: expect.stringContaining("slow down") });
  });

  it("plans no survey for stays found before their position was kept", async () => {
    const { tripId } = await enterScenario(db);
    const places = vi.fn<PlacesFetcher>(async () => AROUND);
    startCompute(db, tripId);
    await runUntilIdle(db, fixtureAdapters(), { places });
    expect(places).not.toHaveBeenCalled();
    expect(getProgress(db, tripId).steps.some((step) => step.id === "survey")).toBe(false);
  });
});
