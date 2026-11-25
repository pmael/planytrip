import { and, eq, ne } from "drizzle-orm";
import { isInScope } from "@/core/reachability";
import type { Destination, GeoPlace } from "@/core/types";
import { toDestination } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import type { Geocoder } from "@/geo/geocode";
import { FieldError, NotFoundError } from "../errors";
import type { DestinationInput, DestinationPatch } from "../schemas";
import { resolvePlace } from "./geo";

const placeColumns = (place: GeoPlace) => ({
  label: place.label,
  countryCode: place.countryCode,
  lat: place.lat,
  lon: place.lon,
  airportsJson: JSON.stringify(place.airports),
  inScope: isInScope(place),
});

/** The place picked, or the best match for what was typed. */
async function placeOf(
  db: Db,
  { place, query }: { place?: GeoPlace; query?: string },
  geocode?: Geocoder,
): Promise<GeoPlace | null> {
  if (place) return place;
  if (!query) return null;
  const found = await resolvePlace(db, query, geocode);
  if (!found) throw new FieldError("query", `No place found for "${query}"`);
  return found;
}

/** The same place cannot be compared with itself twice in one trip. */
function assertNew(db: Db, tripId: string, label: string, exceptId?: string) {
  const sameLabel = db
    .select({ id: schema.destinations.id, label: schema.destinations.label })
    .from(schema.destinations)
    .where(
      exceptId
        ? and(eq(schema.destinations.tripId, tripId), ne(schema.destinations.id, exceptId))
        : eq(schema.destinations.tripId, tripId),
    )
    .all()
    .some((other) => other.label.toLowerCase() === label.toLowerCase());
  if (sameLabel) throw new FieldError("query", `${label} is already in the list`);
}

/** Adds a destination to compare. One outside Europe is accepted but flagged (`inScope: false`). */
export async function addDestination(
  db: Db,
  tripId: string,
  input: DestinationInput,
  geocode?: Geocoder,
): Promise<Destination> {
  const [trip] = db.select({ id: schema.trips.id }).from(schema.trips).where(eq(schema.trips.id, tripId)).all();
  if (!trip) throw new NotFoundError("Trip not found");

  const place = (await placeOf(db, input, geocode))!;
  assertNew(db, tripId, place.label);

  const [row] = db
    .insert(schema.destinations)
    .values({
      tripId,
      ...placeColumns(place),
      budgetLevel: input.budgetLevel,
      objective: input.objective,
      dateFrom: input.dateFrom ?? null,
      dateTo: input.dateTo ?? null,
    })
    .returning()
    .all();
  return toDestination(row);
}

/** Changes some fields of a destination. */
export async function updateDestination(
  db: Db,
  destinationId: string,
  patch: DestinationPatch,
  geocode?: Geocoder,
): Promise<Destination> {
  const [current] = db.select().from(schema.destinations).where(eq(schema.destinations.id, destinationId)).all();
  if (!current) throw new NotFoundError("Destination not found");

  const from = patch.dateFrom !== undefined ? patch.dateFrom : current.dateFrom;
  const to = patch.dateTo !== undefined ? patch.dateTo : current.dateTo;
  if (from && to && to < from) {
    throw new FieldError(patch.dateTo ? "dateTo" : "dateFrom", "The end date can't be before the start date");
  }

  const place = await placeOf(db, patch, geocode);
  if (place) assertNew(db, current.tripId, place.label, destinationId);

  const changes: Partial<typeof schema.destinations.$inferInsert> = {
    ...(place && placeColumns(place)),
    ...(patch.budgetLevel !== undefined && { budgetLevel: patch.budgetLevel }),
    ...(patch.objective !== undefined && { objective: patch.objective }),
    ...(patch.dateFrom !== undefined && { dateFrom: patch.dateFrom }),
    ...(patch.dateTo !== undefined && { dateTo: patch.dateTo }),
  };
  if (Object.keys(changes).length === 0) return toDestination(current);

  const row = db.transaction((tx) => {
    // What was worked out for the old place no longer applies to the new one
    if (place) tx.delete(schema.routeChecks).where(eq(schema.routeChecks.destinationId, destinationId)).run();
    return tx.update(schema.destinations).set(changes).where(eq(schema.destinations.id, destinationId)).returning().all()[0];
  });
  return toDestination(row);
}

/** Removes a destination with everything computed for it; guests who starred it lose their ★. */
export function deleteDestination(db: Db, destinationId: string): void {
  const removed = db.delete(schema.destinations).where(eq(schema.destinations.id, destinationId)).returning().all();
  if (removed.length === 0) throw new NotFoundError("Destination not found");
}
