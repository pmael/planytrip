// The places around a destination's stays, from OpenStreetMap through the Overpass API (task.md T8.3): bars and
// nightclubs, sights, supermarkets, marked hiking paths and trailheads, natural parks and reserves. Open data, asked
// once per destination with one query, kept a month.
//
// The area is the stays and the destination's centre with a margin, rounded out to a grid (config.places.area), so the
// next search of the same place asks for the same area and finds the answer kept. Supermarkets and paths are looked for
// a few km further, parks and reserves 40 km further: a remote chalet's nearest supermarket is 4 km away, its natural
// park may be 30. A server that turns us away (429, 403) stops the survey: it is not asked again around it.
import { places } from "@/config";
import type { Bounds, PlaceKind, PlacePoint, Position } from "@/core/surroundings";
import { noCache } from "../cache";
import { ScrapeChangedError, ScrapeError } from "../errors";
import { createHttp, userAgentFor, type Http } from "../http";
import type { ScrapeCache } from "../types";

const SOURCE = "openstreetmap";

export type PlacesSettings = Pick<typeof places, "overpassUrl" | "serverTimeoutS" | "area" | "searchKm" | "cacheTtlMs">;

/** south, west, north, east, in degrees */
export type Box = { south: number; west: number; north: number; east: number };

const KM_PER_LAT = 110.574;
const kmPerLon = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

/** A box grown by `km` on every side */
function grown(box: Box, km: number): Box {
  const middle = (box.south + box.north) / 2;
  const dLat = km / KM_PER_LAT;
  const dLon = km / kmPerLon(middle);
  return { south: box.south - dLat, west: box.west - dLon, north: box.north + dLat, east: box.east + dLon };
}

/** A box rounded out to the grid: the same place gives the same box */
function snapped(box: Box, gridDeg: number): Box {
  const down = (value: number) => Math.round(Math.floor(value / gridDeg) * gridDeg * 1e6) / 1e6;
  const up = (value: number) => Math.round(Math.ceil(value / gridDeg) * gridDeg * 1e6) / 1e6;
  return { south: down(box.south), west: down(box.west), north: up(box.north), east: up(box.east) };
}

/** The area surveyed: every stay and the destination's centre (with `centreKm` around it), plus a margin, on the grid */
export function surveyArea(centre: Position, stays: Position[], settings: PlacesSettings = places): Box {
  const around = grown({ south: centre.lat, west: centre.lon, north: centre.lat, east: centre.lon }, settings.area.centreKm);
  const box = stays.reduce<Box>(
    (all, stay) => ({ south: Math.min(all.south, stay.lat), west: Math.min(all.west, stay.lon), north: Math.max(all.north, stay.lat), east: Math.max(all.east, stay.lon) }),
    around,
  );
  return snapped(grown(box, settings.area.marginKm), settings.area.gridDeg);
}

const bbox = ({ south, west, north, east }: Box) => `(${south},${west},${north},${east})`;

/** The one query for an area: points with their centre, then parks and reserves with the box around them */
export function overpassQuery(area: Box, settings: PlacesSettings = places): string {
  const near = bbox(area);
  const shops = bbox(snapped(grown(area, settings.searchKm.supermarket), settings.area.gridDeg));
  const paths = bbox(snapped(grown(area, settings.searchKm.trail), settings.area.gridDeg));
  const far = bbox(snapped(grown(area, settings.searchKm.park), settings.area.gridDeg));
  return [
    `[out:json][timeout:${settings.serverTimeoutS}];`,
    "(",
    `  nwr["amenity"~"^(bar|pub|nightclub)$"]${near};`,
    `  nwr["tourism"~"^(museum|attraction|gallery|viewpoint)$"]${near};`,
    `  nwr["historic"~"^(monument|castle|ruins|archaeological_site|city_gate|fort|palace|cathedral|church)$"]${near};`,
    `  nwr["shop"="supermarket"]${shops};`,
    `  way["highway"~"^(path|footway|track)$"]["sac_scale"~"^(hiking|mountain_hiking|demanding_mountain_hiking|alpine_hiking)$"]${paths};`,
    `  node["highway"="trailhead"]${paths};`,
    ");",
    "out center;",
    "(",
    `  nwr["boundary"="national_park"]${far};`,
    `  nwr["boundary"="protected_area"]["protect_class"~"^(1a|1b|2|4|5)$"]${far};`,
    `  nwr["leisure"="nature_reserve"]${far};`,
    ");",
    "out tags bb;",
  ].join("\n");
}

type Element = {
  type?: string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  bounds?: { minlat?: number; minlon?: number; maxlat?: number; maxlon?: number };
  tags?: Record<string, string>;
};

const SIGHT_TOURISM = /^(museum|attraction|gallery|viewpoint)$/;
const SIGHT_HISTORIC = /^(monument|castle|ruins|archaeological_site|city_gate|fort|palace|cathedral|church)$/;

/** What a place is, from its tags; null for one the query brought that is none of these */
export function kindOf(tags: Record<string, string>): PlaceKind | null {
  if (tags.amenity === "nightclub") return "nightclub";
  if (tags.amenity === "bar" || tags.amenity === "pub") return "bar";
  if (tags.shop === "supermarket") return "supermarket";
  if (tags.boundary === "national_park" || tags.boundary === "protected_area" || tags.leisure === "nature_reserve") return "park";
  if (tags.highway === "trailhead" || (tags.sac_scale && /^(path|footway|track)$/.test(tags.highway ?? ""))) return "trail";
  if (SIGHT_TOURISM.test(tags.tourism ?? "") || SIGHT_HISTORIC.test(tags.historic ?? "")) return "sight";
  return null;
}

/** The places of an Overpass answer. An answer the server cut short says so in a remark: worth asking again. */
export function parseOverpass(answer: unknown): PlacePoint[] {
  if (answer === null || typeof answer !== "object" || !Array.isArray((answer as { elements?: unknown }).elements)) {
    throw new ScrapeChangedError("OpenStreetMap's Overpass answered, but not with a list of places");
  }
  const { elements, remark } = answer as { elements: Element[]; remark?: string };
  if (typeof remark === "string" && /runtime error|timed out|out of memory/i.test(remark)) {
    throw new ScrapeError(`OpenStreetMap's Overpass could not finish the query: ${remark.slice(0, 160)}`);
  }
  return elements.flatMap((element): PlacePoint[] => {
    const kind = kindOf(element.tags ?? {});
    if (!kind) return [];
    const b = element.bounds;
    if (b && [b.minlat, b.minlon, b.maxlat, b.maxlon].every((value) => typeof value === "number")) {
      const bounds: Bounds = { minLat: b.minlat!, minLon: b.minlon!, maxLat: b.maxlat!, maxLon: b.maxlon! };
      return [{ kind, lat: (bounds.minLat + bounds.maxLat) / 2, lon: (bounds.minLon + bounds.maxLon) / 2, ...(kind === "park" ? { bounds } : {}) }];
    }
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    return typeof lat === "number" && typeof lon === "number" ? [{ kind, lat, lon }] : [];
  });
}

export type PlacesFetcher = (area: Box, context?: { cache?: ScrapeCache; refresh?: boolean }) => Promise<PlacePoint[]>;

/** Asks Overpass for an area, and keeps the answer a month under the area's own key. */
export function createOverpassFetcher({
  // No contact is sent: TRIP_CONTACT is for Transitous, which asks for one; Overpass does not
  http = createHttp({ source: "OpenStreetMap's Overpass", userAgent: userAgentFor(null), pauseMs: places.pauseMs, timeoutMs: places.timeoutMs }),
  config = places,
}: { http?: Http; config?: PlacesSettings } = {}): PlacesFetcher {
  return (area, { cache = noCache, refresh } = {}) =>
    cache.remember(`overpass|v1|${area.south},${area.west},${area.north},${area.east}`, SOURCE, config.cacheTtlMs, async () => parseOverpass(await http.getJson(`${config.overpassUrl}?${new URLSearchParams({ data: overpassQuery(area, config) })}`)), { refresh });
}

export const overpassFetcher: PlacesFetcher = createOverpassFetcher();
