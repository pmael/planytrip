// What the Settings page shows about a trip: its name and length, and how fresh its fares are.
import { and, desc, eq, sql } from "drizzle-orm";
import { commonWindow, nightsBetween } from "@/core/dates";
import type { TripStatus } from "@/core/types";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { getTrip } from "./trips";

export type SettingsView = {
  tripId: string;
  name: string;
  /** null = the whole common window */
  nights: number | null;
  status: TripStatus;
  /** Nights in the common window, the longest a trip can be. Null when there are no common dates */
  windowNights: number | null;
  /** When the options were last worked out, null if they never were */
  lastWorkedOutAt: string | null;
  counts: { guests: number; destinations: number; transportOptions: number; stays: number };
};

const countOf = (db: Db, table: typeof schema.transportOptions | typeof schema.stayOptions, destinationIds: string[]) =>
  destinationIds.length === 0
    ? 0
    : db
        .select({ n: sql<number>`count(*)` })
        .from(table)
        .where(sql`${table.destinationId} in (${sql.join(destinationIds.map((id) => sql`${id}`), sql`, `)})`)
        .all()[0].n;

/** The trip's settings. Null when the trip does not exist. */
export function getSettingsView(db: Db, tripId: string): SettingsView | null {
  const trip = getTrip(db, tripId);
  if (!trip) return null;

  const [lastRun] = db
    .select({ updatedAt: schema.jobs.updatedAt })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.tripId, tripId), eq(schema.jobs.type, "compute_trip"), eq(schema.jobs.status, "done")))
    .orderBy(desc(schema.jobs.updatedAt), desc(sql`rowid`))
    .limit(1)
    .all();

  const destinationIds = trip.destinations.map((destination) => destination.id);
  const window = commonWindow(trip.guests);
  return {
    tripId,
    name: trip.name,
    nights: trip.nights,
    status: trip.status,
    windowNights: window ? nightsBetween(window) : null,
    lastWorkedOutAt: lastRun?.updatedAt ?? null,
    counts: {
      guests: trip.guests.length,
      destinations: trip.destinations.length,
      transportOptions: countOf(db, schema.transportOptions, destinationIds),
      stays: countOf(db, schema.stayOptions, destinationIds),
    },
  };
}
