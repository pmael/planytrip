import { eq } from "drizzle-orm";
import { cacheTtlMs } from "@/config";
import type { GeoPlace } from "@/core/types";
import { geocode as defaultGeocode, type Geocoder } from "@/geo/geocode";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";

const cacheKey = (query: string) => query.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Places matching what the user typed, at most 5. Answers are kept in `geo_cache` (30 days), so
 * the same text never hits the geocoder twice. A failed lookup is not cached.
 */
export async function searchPlaces(db: Db, query: string, geocode: Geocoder = defaultGeocode): Promise<GeoPlace[]> {
  const key = cacheKey(query);

  const [cached] = db.select().from(schema.geoCache).where(eq(schema.geoCache.query, key)).all();
  if (cached && Date.now() - Date.parse(cached.createdAt) < cacheTtlMs.geo) {
    return JSON.parse(cached.placeJson) as GeoPlace[];
  }

  const places = await geocode(query.trim());
  const now = new Date().toISOString();
  db.insert(schema.geoCache)
    .values({ query: key, placeJson: JSON.stringify(places), createdAt: now })
    .onConflictDoUpdate({ target: schema.geoCache.query, set: { placeJson: JSON.stringify(places), createdAt: now } })
    .run();
  return places;
}

/** The best match for a typed place name ("Madrid"), or null when nothing matches. */
export async function resolvePlace(db: Db, query: string, geocode?: Geocoder): Promise<GeoPlace | null> {
  return (await searchPlaces(db, query, geocode))[0] ?? null;
}
