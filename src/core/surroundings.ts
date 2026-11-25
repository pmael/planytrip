// What is around a place to stay (task.md T8.3, use-cases.md R10, R11), worked out from the places OpenStreetMap lists
// in the area: how far the nearest supermarket is, how many bars and sights are close, how far the nightlife district,
// the historic centre and the nearest trail or natural park are. Pure: the places are fetched elsewhere
// (scrapers/places/overpass.ts).
//
// The nightlife district and the historic centre are not names on a map: they are where bars (or sights) are densest.
// Checked on Barcelona (2026-11-14): the densest bars are in El Born, the densest sights next to the cathedral, and
// with every spot at least half as dense counted as nightlife, a Gràcia flat is 0.2 km from it and a Camp Nou studio 3.4.
import { places } from "@/config";

export type PlaceKind = "bar" | "nightclub" | "sight" | "supermarket" | "trail" | "park";

export type Bounds = { minLat: number; minLon: number; maxLat: number; maxLon: number };

/** A place of the area: a point, or for a natural park or reserve the box around it */
export type PlacePoint = { kind: PlaceKind; lat: number; lon: number; bounds?: Bounds };

export type Position = { lat: number; lon: number };

export type Surroundings = {
  /** To the destination's own point, as the geocoder gave it */
  centreKm: number;
  /** null: none within `searchedKm.supermarket` */
  supermarketKm: number | null;
  /** Bars, pubs and nightclubs within 500 m */
  barsWithin500m: number;
  nightclubsWithin1Km: number;
  /** Museums, galleries, attractions, viewpoints, monuments within 1 km */
  sightsWithin1Km: number;
  /** null: the area has no nightlife district (a village) */
  nightlifeKm: number | null;
  /** The nearest spot of the nightlife district: where a night out ends, to ask how to get back (T8.6) */
  nightlifeAt?: Position | null;
  /** null: the area has no cluster of sights */
  historicCentreKm: number | null;
  /** To the nearest marked hiking path, trailhead, or small natural park or reserve (a big one by its paths); null: none within `searchedKm.park` */
  natureKm: number | null;
  /** As the crow flies, every distance. A null above means nothing within these */
  searchedKm: { supermarket: number; nature: number };
};

type Settings = Pick<typeof places, "searchKm" | "withinKm" | "clusters" | "parkBoxKm">;

/** Kilometres on a flat map around `origin`: exact enough over the few tens of km of a destination */
function projector(origin: Position) {
  const kmPerLon = 111.32 * Math.cos((origin.lat * Math.PI) / 180);
  const kmPerLat = 110.574;
  return (point: Position) => ({ x: (point.lon - origin.lon) * kmPerLon, y: (point.lat - origin.lat) * kmPerLat });
}

/** Back from kilometres on the flat map to a position */
function unprojector(origin: Position) {
  const kmPerLon = 111.32 * Math.cos((origin.lat * Math.PI) / 180);
  const kmPerLat = 110.574;
  return (xy: { x: number; y: number }): Position => ({ lat: Math.round((origin.lat + xy.y / kmPerLat) * 1e6) / 1e6, lon: Math.round((origin.lon + xy.x / kmPerLon) * 1e6) / 1e6 });
}

type Xy = { x: number; y: number };

const between = (a: Xy, b: Xy) => Math.hypot(a.x - b.x, a.y - b.y);

/** Points bucketed by square cells, to find those near a spot without looking at them all */
function bucketed(points: { at: Xy; weight: number }[], cellKm: number) {
  const cells = new Map<string, { at: Xy; weight: number }[]>();
  const key = (cx: number, cy: number) => `${cx}|${cy}`;
  for (const point of points) {
    const k = key(Math.floor(point.at.x / cellKm), Math.floor(point.at.y / cellKm));
    const cell = cells.get(k);
    if (cell) cell.push(point);
    else cells.set(k, [point]);
  }
  return {
    /** The weight of the points within `radiusKm` of a spot (`radiusKm` no more than the cell) */
    weightNear(spot: Xy, radiusKm: number): number {
      const cx = Math.floor(spot.x / cellKm);
      const cy = Math.floor(spot.y / cellKm);
      let sum = 0;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const point of cells.get(key(cx + dx, cy + dy)) ?? []) if (between(point.at, spot) <= radiusKm) sum += point.weight;
      return sum;
    },
  };
}

/**
 * The spots of a grid over the area where the weight within `radiusKm` is at least `share` of the busiest spot's; none
 * when the busiest has less than `min`.
 */
/** The most spots a grid has: a wider area is looked at more coarsely rather than with millions of spots */
const MAX_SPOTS = 250_000;

export function denseSpots(points: { at: Xy; weight: number }[], { radiusKm, stepKm, share, min }: { radiusKm: number; stepKm: number; share: number; min: number }): Xy[] {
  if (points.length === 0) return [];
  const index = bucketed(points, radiusKm);
  const xs = points.map((point) => point.at.x);
  const ys = points.map((point) => point.at.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const step = Math.max(stepKm, Math.sqrt(((maxX - minX + stepKm) * (maxY - minY + stepKm)) / MAX_SPOTS));
  const grid: { at: Xy; weight: number }[] = [];
  for (let x = minX; x <= maxX + step / 2; x += step) {
    for (let y = minY; y <= maxY + step / 2; y += step) {
      const at = { x, y };
      grid.push({ at, weight: index.weightNear(at, radiusKm) });
    }
  }
  const busiest = Math.max(...grid.map((spot) => spot.weight));
  if (busiest < min) return [];
  return grid.filter((spot) => spot.weight >= share * busiest).map((spot) => spot.at);
}

/** How far a point is from a box, 0 inside it */
function toBox(point: Xy, box: { min: Xy; max: Xy }): number {
  const dx = Math.max(box.min.x - point.x, 0, point.x - box.max.x);
  const dy = Math.max(box.min.y - point.y, 0, point.y - box.max.y);
  return Math.hypot(dx, dy);
}

const round2 = (km: number) => Math.round(km * 100) / 100;

/** Places farther than this from the destination are not of its area */
const FAR_KM = 60;

/**
 * What is around each stay, from the places of the area. `centre` is the destination's point. The clusters (nightlife,
 * historic centre) are worked out once for all the stays.
 */
export function surroundingsOf<T extends Position & { id: string }>(
  stays: T[],
  points: PlacePoint[],
  centre: Position,
  settings: Settings = places,
): Map<string, Surroundings> {
  const project = projector(centre);
  const at = (point: Position) => project(point);
  // A place this far from the destination cannot be of its area (the flat map would not hold either)
  const near = points.filter((point) => point.kind === "park" || Math.hypot(at(point).x, at(point).y) <= FAR_KM);
  const ofKind = (...kinds: PlaceKind[]) => near.filter((point) => kinds.includes(point.kind));

  const bars = ofKind("bar", "nightclub").map((point) => ({ at: at(point), weight: point.kind === "nightclub" ? 2 : 1, kind: point.kind }));
  const sights = ofKind("sight").map((point) => ({ at: at(point), weight: 1 }));
  const supermarkets = ofKind("supermarket").map(at);
  const trails = ofKind("trail").map(at);
  const parks = ofKind("park").flatMap((point) =>
    point.bounds ? [{ min: at({ lat: point.bounds.minLat, lon: point.bounds.minLon }), max: at({ lat: point.bounds.maxLat, lon: point.bounds.maxLon }) }] : [{ min: at(point), max: at(point) }],
  );

  const { clusters, searchKm, withinKm } = settings;
  const nightlife = denseSpots(bars, { radiusKm: clusters.radiusKm, stepKm: clusters.stepKm, share: clusters.share, min: clusters.minNightlife });
  const historic = denseSpots(sights, { radiusKm: clusters.radiusKm, stepKm: clusters.stepKm, share: clusters.share, min: clusters.minHistoric });

  const nearest = (from: Xy, targets: Xy[], within: number) => {
    const best = targets.reduce((min, target) => Math.min(min, between(from, target)), Number.POSITIVE_INFINITY);
    return best <= within ? round2(best) : null;
  };
  const count = (from: Xy, targets: { at: Xy }[], within: number) => targets.filter((target) => between(from, target.at) <= within).length;

  const back = unprojector(centre);
  const nearestSpot = (from: Xy, spots: Xy[]) => spots.reduce<Xy | null>((best, spot) => (best === null || between(from, spot) < between(from, best) ? spot : best), null);

  const result = new Map<string, Surroundings>();
  for (const stay of stays) {
    const here = at(stay);
    const spot = nearestSpot(here, nightlife);
    const toTrail = nearest(here, trails, searchKm.trail);
    // A big park's box says nothing, inside or near it: its shape may be far from the box (Collserola's covers half of
    // Barcelona, and ends 200 m from the old town). Its marked paths tell how close it is instead
    const toPark = parks.reduce((min, park) => (between(park.min, park.max) > settings.parkBoxKm ? min : Math.min(min, toBox(here, park))), Number.POSITIVE_INFINITY);
    const nature = Math.min(toTrail ?? Number.POSITIVE_INFINITY, toPark);
    result.set(stay.id, {
      centreKm: round2(between(here, at(centre))),
      supermarketKm: nearest(here, supermarkets, searchKm.supermarket),
      barsWithin500m: count(here, bars, withinKm.bars),
      nightclubsWithin1Km: count(
        here,
        bars.filter((bar) => bar.kind === "nightclub"),
        withinKm.nightclubs,
      ),
      sightsWithin1Km: count(here, sights, withinKm.sights),
      nightlifeKm: nightlife.length > 0 ? nearest(here, nightlife, Number.POSITIVE_INFINITY) : null,
      nightlifeAt: spot ? back(spot) : null,
      historicCentreKm: historic.length > 0 ? nearest(here, historic, Number.POSITIVE_INFINITY) : null,
      natureKm: nature <= searchKm.park ? round2(nature) : null,
      searchedKm: { supermarket: searchKm.supermarket, nature: searchKm.park },
    });
  }
  return result;
}
