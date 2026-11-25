import { eq, inArray, sql } from "drizzle-orm";
import { commonWindow } from "@/core/dates";
import type { Trip, TripDetails } from "@/core/types";
import { toDestination, toGuest, toGuestModes, toTrip } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import type { TripCreateInput, TripUpdateInput } from "../schemas";

export const DEFAULT_TRIP_NAME = "My trip";

/** Starts a trip in draft, ready for the setup wizard. */
export function createTrip(db: Db, input: TripCreateInput = {}): Trip {
  const [row] = db
    .insert(schema.trips)
    .values({ name: input.name ?? DEFAULT_TRIP_NAME })
    .returning()
    .all();
  return toTrip(row);
}

/** The trip with its guests, destinations and common window, or null when it does not exist. */
export function getTrip(db: Db, tripId: string): TripDetails | null {
  const [row] = db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).all();
  if (!row) return null;

  const guests = db.select().from(schema.guests).where(eq(schema.guests.tripId, tripId)).orderBy(sql`rowid`).all().map(toGuest);
  const destinations = db
    .select()
    .from(schema.destinations)
    .where(eq(schema.destinations.tripId, tripId))
    .orderBy(sql`rowid`)
    .all()
    .map(toDestination);

  const guestModes = toGuestModes(
    guests.length > 0
      ? db.select().from(schema.guestModes).where(inArray(schema.guestModes.guestId, guests.map((guest) => guest.id))).all()
      : [],
  );

  return { ...toTrip(row), guests, guestModes, destinations, commonWindow: commonWindow(guests) };
}

/** Renames the trip and/or sets how many nights it lasts. Null when the trip does not exist. */
export function updateTrip(db: Db, tripId: string, patch: TripUpdateInput): Trip | null {
  const changes: Partial<typeof schema.trips.$inferInsert> = {};
  if (patch.name !== undefined) changes.name = patch.name;
  if (patch.nights !== undefined) changes.nights = patch.nights;

  const [row] =
    Object.keys(changes).length === 0
      ? db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).all()
      : db.update(schema.trips).set(changes).where(eq(schema.trips.id, tripId)).returning().all();
  return row ? toTrip(row) : null;
}

/** Moves the trip along its life: draft → computing → ready → validated. */
export function setTripStatus(db: Db, tripId: string, status: Trip["status"]): void {
  db.update(schema.trips).set({ status }).where(eq(schema.trips.id, tripId)).run();
}
