import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cellFor, NO_AIRPORT, NO_ROAD_ROUTE, OSRM_UNAVAILABLE } from "@/core/reachability";
import type { GeoPlace } from "@/core/types";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { OsrmUnavailableError, type LatLon, type RouteFn } from "@/geo/osrm";
import { NotFoundError } from "@/server/errors";
import { addDestination, updateDestination } from "@/server/services/destinations";
import { addGuest, deleteGuest, updateGuest } from "@/server/services/guests";
import { checkReachability } from "@/server/services/reachability";
import { createTrip } from "@/server/services/trips";
import { createTestDb } from "./helpers/db";

const madrid: GeoPlace = { label: "Madrid, Spain", countryCode: "ES", lat: 40.4168, lon: -3.7038, airports: ["MAD"] };
const paris: GeoPlace = { label: "Paris, France", countryCode: "FR", lat: 48.8566, lon: 2.3522, airports: ["ORY", "CDG"] };
const barcelona: GeoPlace = { label: "Barcelona, Spain", countryCode: "ES", lat: 41.3874, lon: 2.1686, airports: ["BCN"] };
const reunion: GeoPlace = { label: "Réunion, France", countryCode: "FR", lat: -21.1309, lon: 55.5266, airports: ["RUN"] };
const remote: GeoPlace = { label: "Nowhere, Spain", countryCode: "ES", lat: 42, lon: -2, airports: [] };

const dates = { availableFrom: "2027-08-26", availableTo: "2027-09-05" };
const destInput = (place: GeoPlace) => ({ place, budgetLevel: "medium" as const, objective: "none" as const });

/** A router that knows Madrid-Barcelona (618 km) and finds nothing to La Réunion, like the real one. */
function fakeRoute(): RouteFn & ReturnType<typeof vi.fn> {
  return vi.fn(async (_from: LatLon, to: LatLon) =>
    to.lat < 0 ? null : { distanceKm: 618.4, durationMin: 410.6 },
  ) as never;
}

let db: Db;
let close: () => void;
let tripId: string;
beforeEach(() => {
  ({ db, close } = createTestDb());
  tripId = createTrip(db).id;
});
afterEach(() => close());

const checksOf = () => db.select().from(schema.routeChecks).all();

async function scenario() {
  const martin = (await addGuest(db, tripId, { name: "Martin", homePlace: madrid, maxBudgetEur: 800, ...dates, preferredMode: "car" })).guest;
  const chloe = (await addGuest(db, tripId, { name: "Chloé", homePlace: paris, maxBudgetEur: 1200, ...dates, preferredMode: "plane" })).guest;
  const jessy = (await addGuest(db, tripId, { name: "Jessy", homePlace: madrid, maxBudgetEur: 400, ...dates, preferredMode: "plane" })).guest;
  const bcn = await addDestination(db, tripId, destInput(barcelona));
  const run = await addDestination(db, tripId, destInput(reunion));
  return { martin, chloe, jessy, bcn, run };
}

describe("checkReachability", () => {
  it("finds Madrid → La Réunion by car impossible, and Madrid → Barcelona about 620 km", async () => {
    const { martin, bcn, run } = await scenario();
    const matrix = await checkReachability(db, tripId, fakeRoute());

    expect(cellFor(matrix, martin.id, run.id)).toMatchObject({ status: "blocked", reason: NO_ROAD_ROUTE, fallback: "plane" });
    const barcelonaCell = cellFor(matrix, martin.id, bcn.id)!;
    expect(barcelonaCell.status).toBe("ok");
    expect(barcelonaCell.modes[0]).toMatchObject({ mode: "car", state: "reachable", distanceKm: 618, durationMin: 411 });
  });

  it("stores the checks: plane everywhere, the road modes only for the place someone drives from", async () => {
    const { bcn, run } = await scenario();
    await checkReachability(db, tripId, fakeRoute());

    const key = (c: (typeof schema.routeChecks.$inferSelect)) => `${c.originKey}/${c.mode}`;
    const forBcn = checksOf().filter((c) => c.destinationId === bcn.id).map(key).sort();
    expect(forBcn).toEqual(["madrid-spain/bus", "madrid-spain/car", "madrid-spain/plane", "madrid-spain/train", "paris-france/plane"]);

    const car = checksOf().find((c) => c.destinationId === run.id && c.originKey === "madrid-spain" && c.mode === "car")!;
    expect(car).toMatchObject({ reachable: false, reason: NO_ROAD_ROUTE, distanceKm: null });
  });

  it("asks the router once per road trip, and never for people who only fly", async () => {
    await scenario();
    const route = fakeRoute();
    await checkReachability(db, tripId, route);
    // Madrid has a driver: 2 destinations. Paris only flies and every plane check passes.
    expect(route).toHaveBeenCalledTimes(2);
    expect(route.mock.calls[0][0]).toEqual({ lat: madrid.lat, lon: madrid.lon });
  });

  it("asks nothing again on a second run", async () => {
    await scenario();
    const route = fakeRoute();
    await checkReachability(db, tripId, route);
    await checkReachability(db, tripId, route);
    expect(route).toHaveBeenCalledTimes(2);
  });

  it("only checks what is new when a destination is added", async () => {
    await scenario();
    const route = fakeRoute();
    await checkReachability(db, tripId, route);
    await addDestination(db, tripId, destInput({ ...barcelona, label: "Girona, Spain" }));
    await checkReachability(db, tripId, route);
    expect(route).toHaveBeenCalledTimes(3);
  });

  it("does not fail when the router is down: the road modes are unverified, and asked again next time", async () => {
    const { martin, bcn } = await scenario();
    const down: RouteFn = vi.fn(async () => {
      throw new OsrmUnavailableError("down");
    });
    const matrix = await checkReachability(db, tripId, down);

    expect(cellFor(matrix, martin.id, bcn.id)).toMatchObject({ status: "unverified", modes: [{ mode: "car", state: "unverified" }] });
    expect(checksOf().filter((c) => c.reason === OSRM_UNAVAILABLE)).not.toHaveLength(0);

    const route = fakeRoute();
    const recovered = await checkReachability(db, tripId, route);
    expect(route).toHaveBeenCalledTimes(2);
    expect(cellFor(recovered, martin.id, bcn.id)?.status).toBe("ok");
  });

  it("lets other errors through", async () => {
    await scenario();
    const broken: RouteFn = async () => {
      throw new Error("bug");
    };
    await expect(checkReachability(db, tripId, broken)).rejects.toThrow("bug");
  });

  it("blocks a flyer when the destination has no airport, and then checks the roads to offer a way out", async () => {
    const { chloe } = await scenario();
    const hamlet = await addDestination(db, tripId, destInput(remote));
    const route = fakeRoute();
    const matrix = await checkReachability(db, tripId, route);

    expect(cellFor(matrix, chloe.id, hamlet.id)).toMatchObject({ status: "blocked", reason: NO_AIRPORT, fallback: "train" });
    // Paris was asked about for the hamlet only: the plane could not do it
    expect(route.mock.calls.filter(([from]) => from.lat === paris.lat)).toHaveLength(1);
  });

  it("forgets the checks of a place nobody leaves from any more", async () => {
    const { chloe } = await scenario();
    await checkReachability(db, tripId, fakeRoute());
    expect(checksOf().some((c) => c.originKey === "paris-france")).toBe(true);

    deleteGuest(db, chloe.id);
    await checkReachability(db, tripId, fakeRoute());
    expect(checksOf().some((c) => c.originKey === "paris-france")).toBe(false);
  });

  it("checks the plane again each time, so a moved guest is not judged on old airports", async () => {
    const { jessy, bcn } = await scenario();
    await checkReachability(db, tripId, fakeRoute());
    await updateGuest(db, jessy.id, { homePlace: { ...paris, label: "Villeneuve, France", airports: [] } });
    const matrix = await checkReachability(db, tripId, fakeRoute());
    expect(cellFor(matrix, jessy.id, bcn.id)).toMatchObject({ status: "blocked", reason: NO_AIRPORT });
  });

  it("drops what was worked out for a destination when it is moved to another place", async () => {
    const { bcn } = await scenario();
    await checkReachability(db, tripId, fakeRoute());
    expect(checksOf().some((c) => c.destinationId === bcn.id)).toBe(true);

    await updateDestination(db, bcn.id, { place: reunion }).catch(() => undefined); // duplicate name refused: nothing changes
    expect(checksOf().some((c) => c.destinationId === bcn.id)).toBe(true);

    await updateDestination(db, bcn.id, { place: { ...barcelona, label: "Sitges, Spain" } });
    expect(checksOf().some((c) => c.destinationId === bcn.id)).toBe(false);
    expect(db.select().from(schema.destinations).where(eq(schema.destinations.id, bcn.id)).all()[0].label).toBe("Sitges, Spain");
  });

  it("returns an empty matrix for a trip with no guests or no destinations", async () => {
    expect((await checkReachability(db, tripId, fakeRoute())).cells).toEqual([]);
    await scenario();
    const empty = createTrip(db).id;
    expect((await checkReachability(db, empty, fakeRoute())).cells).toEqual([]);
  });

  it("rejects an unknown trip", async () => {
    await expect(checkReachability(db, "doesnotexist", fakeRoute())).rejects.toBeInstanceOf(NotFoundError);
  });
});
