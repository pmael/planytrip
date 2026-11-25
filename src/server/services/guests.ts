import { eq } from "drizzle-orm";
import { commonWindow } from "@/core/dates";
import type { ReachabilityMatrix } from "@/core/reachability";
import type { DateRange, GeoPlace, Guest, TransportMode } from "@/core/types";
import { toGuest } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import type { Geocoder } from "@/geo/geocode";
import type { RouteFn } from "@/geo/osrm";
import { FieldError, NotFoundError } from "../errors";
import type { GuestInput, GuestPatch } from "../schemas";
import { resolvePlace } from "./geo";
import { checkReachability } from "./reachability";

export type GuestResult = { guest: Guest; commonWindow: DateRange | null };

/** "Madrid, Spain" → "madrid-spain". Guests from the same place share the same transport searches. */
export function originKeyOf(place: Pick<GeoPlace, "label">): string {
  return place.label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const homeColumns = (place: GeoPlace) => ({
  homeLabel: place.label,
  homeLat: place.lat,
  homeLon: place.lon,
  homeAirportsJson: JSON.stringify(place.airports),
  originKey: originKeyOf(place),
});

/** The place a guest lives in: the one they picked, or the best match for what they typed (A-S1). */
async function homeOf(
  db: Db,
  { homePlace, homeQuery }: { homePlace?: GeoPlace; homeQuery?: string },
  geocode?: Geocoder,
): Promise<GeoPlace | null> {
  if (homePlace) return homePlace;
  if (!homeQuery) return null;
  const place = await resolvePlace(db, homeQuery, geocode);
  if (!place) throw new FieldError("homeQuery", `No city found for "${homeQuery}"`);
  return place;
}

function windowOfTrip(db: Db, tripId: string): DateRange | null {
  const guests = db.select().from(schema.guests).where(eq(schema.guests.tripId, tripId)).all();
  return commonWindow(guests);
}

/** Adds a guest to the trip, with their preferred mode as their first accepted mode (A-S3). */
export async function addGuest(db: Db, tripId: string, input: GuestInput, geocode?: Geocoder): Promise<GuestResult> {
  const [trip] = db.select({ id: schema.trips.id }).from(schema.trips).where(eq(schema.trips.id, tripId)).all();
  if (!trip) throw new NotFoundError("Trip not found");

  const place = (await homeOf(db, input, geocode))!;
  const row = db.transaction((tx) => {
    const [guest] = tx
      .insert(schema.guests)
      .values({
        tripId,
        name: input.name,
        ...homeColumns(place),
        maxBudgetEur: input.maxBudgetEur,
        availableFrom: input.availableFrom,
        availableTo: input.availableTo,
        preferredMode: input.preferredMode,
      })
      .returning()
      .all();
    tx.insert(schema.guestModes).values({ guestId: guest.id, mode: input.preferredMode }).run();
    return guest;
  });

  return { guest: toGuest(row), commonWindow: windowOfTrip(db, tripId) };
}

/** Changes some fields of a guest. The common window is recomputed (A-S2). */
export async function updateGuest(db: Db, guestId: string, patch: GuestPatch, geocode?: Geocoder): Promise<GuestResult> {
  const [current] = db.select().from(schema.guests).where(eq(schema.guests.id, guestId)).all();
  if (!current) throw new NotFoundError("Guest not found");

  const from = patch.availableFrom ?? current.availableFrom;
  const to = patch.availableTo ?? current.availableTo;
  if (to < from) {
    throw new FieldError(patch.availableTo ? "availableTo" : "availableFrom", "The end date can't be before the start date");
  }

  const place = await homeOf(db, patch, geocode);
  const changes: Partial<typeof schema.guests.$inferInsert> = {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(place && homeColumns(place)),
    ...(patch.maxBudgetEur !== undefined && { maxBudgetEur: patch.maxBudgetEur }),
    ...(patch.availableFrom !== undefined && { availableFrom: patch.availableFrom }),
    ...(patch.availableTo !== undefined && { availableTo: patch.availableTo }),
    ...(patch.preferredMode !== undefined && { preferredMode: patch.preferredMode }),
  };

  const row = db.transaction((tx) => {
    const [updated] =
      Object.keys(changes).length === 0
        ? [current]
        : tx.update(schema.guests).set(changes).where(eq(schema.guests.id, guestId)).returning().all();
    // The preferred mode is always an accepted one (A-S3)
    tx.insert(schema.guestModes).values({ guestId, mode: updated.preferredMode }).onConflictDoNothing().run();
    return updated;
  });

  return { guest: toGuest(row), commonWindow: windowOfTrip(db, row.tripId) };
}

/** Removes a guest, with their modes and hearts. Returns the new common window. */
export function deleteGuest(db: Db, guestId: string): { commonWindow: DateRange | null } {
  const [removed] = db.delete(schema.guests).where(eq(schema.guests.id, guestId)).returning().all();
  if (!removed) throw new NotFoundError("Guest not found");
  return { commonWindow: windowOfTrip(db, removed.tripId) };
}

/**
 * Sets the modes a guest accepts. The preferred mode is always one of them (A-S3), so asking to
 * leave it out is not an error, it just stays. Returns the modes really stored and who can get where
 * with them: the roads or flights that are new are checked now, the others come from the saved checks.
 */
export async function setGuestModes(
  db: Db,
  guestId: string,
  modes: TransportMode[],
  route?: RouteFn,
): Promise<{ modes: TransportMode[]; matrix: ReachabilityMatrix }> {
  const [guest] = db.select().from(schema.guests).where(eq(schema.guests.id, guestId)).all();
  if (!guest) throw new NotFoundError("Guest not found");

  const accepted = [...new Set([guest.preferredMode, ...modes])];
  db.transaction((tx) => {
    tx.delete(schema.guestModes).where(eq(schema.guestModes.guestId, guestId)).run();
    tx.insert(schema.guestModes).values(accepted.map((mode) => ({ guestId, mode }))).run();
  });

  return { modes: accepted, matrix: await checkReachability(db, guest.tripId, route) };
}

/**
 * Puts a guest's ★ on a destination of the trip, or takes it off with null. A guest has one ★ at
 * most (use-cases.md C-S5): giving a new one moves it.
 */
export function setFavoriteDestination(db: Db, guestId: string, destinationId: string | null): Guest {
  const [guest] = db.select().from(schema.guests).where(eq(schema.guests.id, guestId)).all();
  if (!guest) throw new NotFoundError("Guest not found");

  if (destinationId !== null) {
    const [destination] = db
      .select({ tripId: schema.destinations.tripId })
      .from(schema.destinations)
      .where(eq(schema.destinations.id, destinationId))
      .all();
    if (!destination || destination.tripId !== guest.tripId) {
      throw new FieldError("destinationId", "That destination is not part of this trip");
    }
  }

  const [row] = db
    .update(schema.guests)
    .set({ favoriteDestinationId: destinationId })
    .where(eq(schema.guests.id, guestId))
    .returning()
    .all();
  return toGuest(row);
}
