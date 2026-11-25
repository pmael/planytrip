// The work of the search jobs: ask the adapters what exists for one destination, and bring the
// stored options in line with the answer.
import { and, eq } from "drizzle-orm";
import { comfortOf, travelDurationMin } from "@/core/comfort";
import { commonWindow, tripWindow } from "@/core/dates";
import type { DateRange, TransportMode } from "@/core/types";
import { toDestination, toGuest, toTransportOption } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { createScrapeCache } from "@/scrapers/cache";
import type { StayAdapter, StayOptionInput, TransportAdapter, TransportOptionInput } from "@/scrapers/types";

type Loaded = {
  tripId: string;
  destination: ReturnType<typeof toDestination>;
  guests: ReturnType<typeof toGuest>[];
  window: DateRange;
};

/**
 * The destination, the trip's guests and the days to search for. Null when there is nothing to
 * search any more: the destination was removed while the job waited, or its dates leave no day
 * on which the whole group is free.
 */
function load(db: Db, destinationId: string): Loaded | null {
  const [row] = db.select().from(schema.destinations).where(eq(schema.destinations.id, destinationId)).all();
  if (!row) return null;
  const [trip] = db.select().from(schema.trips).where(eq(schema.trips.id, row.tripId)).all();
  const guests = db.select().from(schema.guests).where(eq(schema.guests.tripId, row.tripId)).all().map(toGuest);
  const destination = toDestination(row);

  const window = commonWindow(guests, destination);
  if (!window) return null;
  return { tripId: row.tripId, destination, guests, window: tripWindow(window, trip.nights) };
}

type Existing<T extends { id: string }> = Map<string, T[]>;

/** Rows by key. Rows sharing a key are kept in order and used up one by one. */
function byKey<T extends { id: string }>(rows: T[], keyOf: (row: T) => string): Existing<T> {
  const map: Existing<T> = new Map();
  for (const row of rows) map.set(keyOf(row), [...(map.get(keyOf(row)) ?? []), row]);
  return map;
}

const transportKey = (o: { provider: string; variant: string; outDepartAt: string | null }) =>
  `${o.provider}|${o.variant}|${o.outDepartAt ?? ""}`;

const transportColumns = (input: TransportOptionInput) => {
  const { raw, priceKind = "live", priceNote = null, soldOut = false, ...fields } = input;
  return { ...fields, priceKind, priceNote, soldOut, rawJson: raw === undefined ? null : JSON.stringify(raw), fetchedAt: new Date().toISOString() };
};

/**
 * Looks for the ways of getting from `originKey` to the destination by `mode`, and stores what the
 * adapters find. An option that is still on offer is updated in place (so a ❤ on it stays), a new
 * one is added, one that is gone is removed. Every option is rated for comfort against the fastest
 * of its route (R2). Returns how many options there are now. When one source fails and another works, what
 * the working one found is kept, nothing is removed, and the failure is then raised so that the search is tried
 * again and, in the end, reported.
 */
export async function searchTransport(
  db: Db,
  payload: { destinationId: string; originKey: string; mode: TransportMode; force?: boolean },
  adapters: TransportAdapter[],
): Promise<number> {
  const context = load(db, payload.destinationId);
  const origin = context?.guests.find((guest) => guest.originKey === payload.originKey);
  if (!context || !origin) return 0;

  const { destination } = context;
  const query = {
    mode: payload.mode,
    origin: { key: origin.originKey, label: origin.homeLabel, lat: origin.homeLat, lon: origin.homeLon, airports: origin.homeAirports },
    destination: { id: destination.id, label: destination.label, lat: destination.lat, lon: destination.lon, airports: destination.airports, countryCode: destination.countryCode },
    window: context.window,
    // What a real site was asked is kept for a while; `force` asks it again regardless
    cache: createScrapeCache(db),
    refresh: payload.force,
  };
  const settled = await Promise.allSettled(adapters.map((adapter) => adapter.search(query)));
  const found = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");

  const where = and(
    eq(schema.transportOptions.destinationId, destination.id),
    eq(schema.transportOptions.originKey, payload.originKey),
    eq(schema.transportOptions.mode, payload.mode),
  );
  db.transaction((tx) => {
    const existing = byKey(tx.select().from(schema.transportOptions).where(where).all(), transportKey);
    for (const input of found) {
      const match = existing.get(transportKey(input))?.shift();
      if (match) {
        tx.update(schema.transportOptions).set(transportColumns(input)).where(eq(schema.transportOptions.id, match.id)).run();
      } else {
        tx.insert(schema.transportOptions)
          .values({ ...transportColumns(input), tripId: context.tripId, destinationId: destination.id })
          .run();
      }
    }
    // Without a source's answer, what it had before is not known to be gone
    if (!failure) {
      for (const gone of [...existing.values()].flat()) {
        tx.delete(schema.transportOptions).where(eq(schema.transportOptions.id, gone.id)).run();
      }
    }

    // Comfort is judged against the fastest option of the same route
    const rows = tx.select().from(schema.transportOptions).where(where).all();
    const durations = rows.map(toTransportOption).flatMap((option) => travelDurationMin(option) ?? []);
    const fastest = durations.length > 0 ? Math.min(...durations) : 0;
    for (const row of rows) {
      const { score, level } = comfortOf(toTransportOption(row), fastest);
      tx.update(schema.transportOptions).set({ comfortScore: score, comfortLevel: level }).where(eq(schema.transportOptions.id, row.id)).run();
    }
  });

  // What the working sources found is kept; the failure is raised so that the search is tried again and, in the end, reported
  if (failure) throw failure.reason;
  return found.length;
}

const stayKey = (s: { provider: string; externalId: string | null; title: string }) =>
  `${s.provider}|${s.externalId ?? s.title}`;

const stayColumns = (input: StayOptionInput) => {
  const { raw, photos, reviewsSample, ...fields } = input;
  return {
    ...fields,
    photosJson: JSON.stringify(photos),
    reviewsSampleJson: reviewsSample ? JSON.stringify(reviewsSample) : null,
    rawJson: raw === undefined ? null : JSON.stringify(raw),
    fetchedAt: new Date().toISOString(),
  };
};

/**
 * Looks for places to stay at the destination and stores what the adapters find, the same way as
 * transport: kept in place, added or removed. Returns how many offers there are now. When one source
 * fails (the hotels) and another works (Airbnb), what the working one found is kept, nothing that a
 * failed source had is removed, and the failure is then raised so that the search is tried again and,
 * in the end, reported.
 */
export async function searchStays(db: Db, payload: { destinationId: string; force?: boolean }, adapters: StayAdapter[]): Promise<number> {
  const context = load(db, payload.destinationId);
  if (!context) return 0;

  const { destination } = context;
  const query = {
    destination: { id: destination.id, label: destination.label, lat: destination.lat, lon: destination.lon, airports: destination.airports },
    window: context.window,
    groupSize: context.guests.length,
    // What a real site was asked is kept for a while; `force` asks it again regardless
    cache: createScrapeCache(db),
    refresh: payload.force,
  };
  const settled = await Promise.allSettled(adapters.map((adapter) => adapter.search(query)));
  const found = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");

  db.transaction((tx) => {
    const existing = byKey(
      tx.select().from(schema.stayOptions).where(eq(schema.stayOptions.destinationId, destination.id)).all(),
      stayKey,
    );
    for (const input of found) {
      const match = existing.get(stayKey(input))?.shift();
      if (match) {
        tx.update(schema.stayOptions).set(stayColumns(input)).where(eq(schema.stayOptions.id, match.id)).run();
      } else {
        tx.insert(schema.stayOptions).values({ ...stayColumns(input), destinationId: destination.id }).run();
      }
    }
    // Without a source's answer, what it had before is not known to be gone
    if (!failure) {
      for (const gone of [...existing.values()].flat()) {
        tx.delete(schema.stayOptions).where(eq(schema.stayOptions.id, gone.id)).run();
      }
    }
  });

  if (failure) throw failure.reason;
  return found.length;
}
