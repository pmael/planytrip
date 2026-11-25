import { and, eq, inArray, notInArray } from "drizzle-orm";
import {
  isPlaneReachable,
  NO_AIRPORT,
  NO_ROAD_ROUTE,
  OSRM_UNAVAILABLE,
  reachabilityMatrix,
  ROAD_MODES,
  type ReachabilityMatrix,
} from "@/core/reachability";
import type { Guest, TransportMode } from "@/core/types";
import { toDestination, toGuest, toGuestModes, toRouteCheck } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { OsrmUnavailableError, osrmRoute, type RouteFn } from "@/geo/osrm";
import { NotFoundError } from "../errors";

type CheckRow = typeof schema.routeChecks.$inferInsert;

/**
 * Works out, for every place the guests leave from and every destination, which modes get there,
 * and stores it in `route_checks` (use-cases.md A-S4). Nothing is scraped:
 * - the plane needs an airport at both ends, which costs nothing to know;
 * - the road modes share one routing answer, asked only when someone accepts one of them (or when
 *   the plane cannot do it, so that a road mode can be offered instead). Answers are kept, so a
 *   second run asks nothing, except again for the ones the routing service could not answer.
 * Returns who can get where, from everything checked so far.
 */
export async function checkReachability(
  db: Db,
  tripId: string,
  route: RouteFn = osrmRoute,
  /** Called after each destination and departure place is looked at, for a progress screen */
  onProgress?: (done: number, total: number) => void,
): Promise<ReachabilityMatrix> {
  const [trip] = db.select({ id: schema.trips.id }).from(schema.trips).where(eq(schema.trips.id, tripId)).all();
  if (!trip) throw new NotFoundError("Trip not found");

  const guests = db.select().from(schema.guests).where(eq(schema.guests.tripId, tripId)).all().map(toGuest);
  const destinations = db
    .select()
    .from(schema.destinations)
    .where(eq(schema.destinations.tripId, tripId))
    .all()
    .map(toDestination);
  const guestModes = toGuestModes(
    guests.length > 0
      ? db
          .select()
          .from(schema.guestModes)
          .where(inArray(schema.guestModes.guestId, guests.map((guest) => guest.id)))
          .all()
      : [],
  );
  const destinationIds = destinations.map((destination) => destination.id);
  const storedChecks = () =>
    destinationIds.length > 0
      ? db.select().from(schema.routeChecks).where(inArray(schema.routeChecks.destinationId, destinationIds)).all()
      : [];

  // Guests who leave from the same place share every check
  const origins = new Map<string, Guest[]>();
  for (const guest of guests) origins.set(guest.originKey, [...(origins.get(guest.originKey) ?? []), guest]);

  const upsert = (rows: CheckRow[]) => {
    for (const row of rows) {
      db.insert(schema.routeChecks)
        .values(row)
        .onConflictDoUpdate({
          target: [schema.routeChecks.destinationId, schema.routeChecks.originKey, schema.routeChecks.mode],
          set: {
            reachable: row.reachable,
            reason: row.reason ?? null,
            distanceKm: row.distanceKm ?? null,
            durationMin: row.durationMin ?? null,
            checkedAt: new Date().toISOString(),
          },
        })
        .run();
    }
  };

  const known = storedChecks();
  const total = destinations.length * origins.size;
  let done = 0;
  for (const destination of destinations) {
    for (const [originKey, group] of origins) {
      onProgress?.(done++, total);
      const home = group[0];
      const planeOk = isPlaneReachable({ airports: home.homeAirports }, destination);
      upsert([
        { destinationId: destination.id, originKey, mode: "plane", reachable: planeOk, reason: planeOk ? null : NO_AIRPORT },
      ]);

      const acceptsRoad = group.some((guest) =>
        (guestModes[guest.id] ?? [guest.preferredMode]).some((mode) => ROAD_MODES.includes(mode)),
      );
      if (!acceptsRoad && planeOk) continue;

      const answered = ROAD_MODES.every((mode) =>
        known.some(
          (check) =>
            check.destinationId === destination.id &&
            check.originKey === originKey &&
            check.mode === mode &&
            check.reason !== OSRM_UNAVAILABLE,
        ),
      );
      if (answered) continue;

      let outcome: Pick<CheckRow, "reachable" | "reason" | "distanceKm" | "durationMin">;
      try {
        const found = await route({ lat: home.homeLat, lon: home.homeLon }, { lat: destination.lat, lon: destination.lon });
        outcome = found
          ? {
              reachable: true,
              reason: null,
              distanceKm: Math.round(found.distanceKm),
              durationMin: Math.round(found.durationMin),
            }
          : { reachable: false, reason: NO_ROAD_ROUTE };
      } catch (error) {
        // The routing service being down must not stop the rest of the computation (A.5)
        if (!(error instanceof OsrmUnavailableError)) throw error;
        outcome = { reachable: false, reason: OSRM_UNAVAILABLE };
      }
      upsert(ROAD_MODES.map((mode) => ({ destinationId: destination.id, originKey, mode: mode as TransportMode, ...outcome })));
    }
  }
  onProgress?.(total, total);

  // Forget the places nobody leaves from any more
  if (destinationIds.length > 0) {
    const originKeys = [...origins.keys()];
    db.delete(schema.routeChecks)
      .where(
        and(
          inArray(schema.routeChecks.destinationId, destinationIds),
          originKeys.length > 0 ? notInArray(schema.routeChecks.originKey, originKeys) : undefined,
        ),
      )
      .run();
  }

  return reachabilityMatrix(guests, guestModes, destinations, storedChecks().map(toRouteCheck));
}
