// The geometry of the Destinations map, worked out on the server so the browser is only sent a few
// SVG paths, not a world atlas. Country outlines come from `world-atlas`, offline.
import { geoDistance, geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { Topology } from "topojson-specification";
import coarseAtlas from "world-atlas/countries-110m.json";
import fineAtlas from "world-atlas/countries-50m.json";

export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 560;
/** Room kept free around the points, in map units */
const PADDING = 110;
/** However close the places are, the map never shows less than this: a city centre says nothing */
const MIN_SPAN = { lon: 12, lat: 7 };
/** How far arcs bow away from a straight line, as a share of their length */
const BULGE = 0.2;
/** How far apart arcs that share their ends are spread, in map units */
const SPREAD = 16;
/** Places farther than this from the middle of the others are not framed: they are pointed at from the edge instead */
const CORE_KM = 3200;
const EARTH_KM = 6371;
/** How close to the edge of the map a place that is off it is drawn */
const EDGE_INSET = 70;

export type MapGuest = { id: string; name: string; originKey: string; city: string; lat: number; lon: number };
export type MapDestination = { id: string; label: string; lat: number; lon: number };

/**
 * Where something is drawn. `offMap` is for a place too far to frame with the others: it sits at
 * the edge of the map, `angle` (radians) says which way it lies and `km` how far from the others.
 */
export type Placed = { x: number; y: number; offMap: boolean; angle: number; km: number };

export type TripMapData = {
  width: number;
  height: number;
  land: string;
  borders: string;
  graticule: string;
  /** One per place guests leave from, with those who leave from it */
  homes: (Placed & { originKey: string; city: string; guestIds: string[] })[];
  destinations: (Placed & { id: string; label: string })[];
  /** One curve from each guest's place to each destination, in the order guest by guest */
  arcs: { guestId: string; destinationId: string; d: string }[];
};

type AtlasObject = Parameters<typeof mesh>[1];

/** The countries as one shape and their shared borders as lines, parsed once: the atlas does not change. */
function shapesOf(atlas: unknown) {
  const topology = atlas as Topology;
  const countries = topology.objects.countries as unknown as AtlasObject;
  return { land: feature(topology, countries as Parameters<typeof feature>[1]), borders: mesh(topology, countries, (a, b) => a !== b) };
}

const fine = shapesOf(fineAtlas);
const coarse = shapesOf(coarseAtlas);

/** Beyond this many degrees across, the detail of the fine atlas is lost on the screen and only makes the page heavier. */
const COARSE_ABOVE = { lon: 30, lat: 20 };

const round = (value: number) => Math.round(value * 10) / 10;

type Coordinate = [number, number];

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const kmBetween = (a: Coordinate, b: Coordinate) => geoDistance(a, b) * EARTH_KM;

/**
 * The points to frame: all of them, unless some lie far from the rest (a trip to an island across
 * the world), in which case just the ones around the middle, so the places that matter stay legible.
 */
function framedPoints(points: Coordinate[]): { framed: Coordinate[]; centre: Coordinate } {
  const centre: Coordinate = [median(points.map(([lon]) => lon)), median(points.map(([, lat]) => lat))];
  const near = points.filter((point) => kmBetween(point, centre) <= CORE_KM);
  return { framed: near.length >= 2 ? near : points, centre };
}

/** The points widened to the minimum span, so a trip within one region still shows a region. */
function extentOf(points: Coordinate[]): { corners: Coordinate[]; lonSpan: number; latSpan: number } {
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  const [minLon, maxLon] = [Math.min(...lons), Math.max(...lons)];
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const lonPad = Math.max(0, (MIN_SPAN.lon - (maxLon - minLon)) / 2);
  const latPad = Math.max(0, (MIN_SPAN.lat - (maxLat - minLat)) / 2);
  return {
    corners: [...points, [minLon - lonPad, minLat - latPad], [maxLon + lonPad, maxLat + latPad]],
    lonSpan: maxLon - minLon + 2 * lonPad,
    latSpan: maxLat - minLat + 2 * latPad,
  };
}

/** A curve from one point to another, bowed upwards; `offset` spreads arcs that would lie on top of each other. */
function arcBetween([x1, y1]: [number, number], [x2, y2]: [number, number], offset: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  // Perpendicular to the line, always pointing up the page
  let nx = -dy / length;
  let ny = dx / length;
  if (ny > 0) [nx, ny] = [-nx, -ny];
  const bow = length * BULGE + offset * SPREAD;
  const cx = (x1 + x2) / 2 + nx * bow;
  const cy = (y1 + y2) / 2 + ny * bow;
  return `M${round(x1)},${round(y1)} Q${round(cx)},${round(cy)} ${round(x2)},${round(y2)}`;
}

/** Where a projected point is drawn: where it is, or, when that is off the map, on the edge in its direction. */
function placeOnMap([x, y]: [number, number], km: number): Placed {
  const dx = x - MAP_WIDTH / 2;
  const dy = y - MAP_HEIGHT / 2;
  const angle = Math.atan2(dy, dx);
  const room = { x: MAP_WIDTH / 2 - EDGE_INSET, y: MAP_HEIGHT / 2 - EDGE_INSET };
  if (Math.abs(dx) <= room.x && Math.abs(dy) <= room.y) return { x: round(x), y: round(y), offMap: false, angle, km };

  const pull = Math.min(room.x / Math.max(Math.abs(dx), 1e-6), room.y / Math.max(Math.abs(dy), 1e-6));
  return { x: round(MAP_WIDTH / 2 + dx * pull), y: round(MAP_HEIGHT / 2 + dy * pull), offMap: true, angle, km };
}

/** Projects the guests' places and the destinations onto a map that frames the ones that sit together, and draws who could go where. */
export function buildTripMap(guests: MapGuest[], destinations: MapDestination[]): TripMapData {
  const points = [...guests, ...destinations].map((place): Coordinate => [place.lon, place.lat]);
  if (points.length === 0) return { width: MAP_WIDTH, height: MAP_HEIGHT, land: "", borders: "", graticule: "", homes: [], destinations: [], arcs: [] };

  const { framed, centre } = framedPoints(points);
  const extent = extentOf(framed);
  const shapes = extent.lonSpan > COARSE_ABOVE.lon || extent.latSpan > COARSE_ABOVE.lat ? coarse : fine;
  const projection = geoNaturalEarth1()
    .fitExtent(
      [
        [PADDING, PADDING],
        [MAP_WIDTH - PADDING, MAP_HEIGHT - PADDING],
      ],
      { type: "MultiPoint", coordinates: extent.corners },
    )
    // Only what is on the map is drawn: at this zoom most of the atlas is off it
    .clipExtent([
      [0, 0],
      [MAP_WIDTH, MAP_HEIGHT],
    ]);
  const path = geoPath(projection).digits(1);
  const at = (place: { lon: number; lat: number }): Placed =>
    placeOnMap(projection([place.lon, place.lat]) ?? [MAP_WIDTH / 2, MAP_HEIGHT / 2], Math.round(kmBetween([place.lon, place.lat], centre)));

  // Guests who leave from the same place share one dot
  const origins = [...new Set(guests.map((guest) => guest.originKey))];
  const homes = origins.map((originKey) => {
    const members = guests.filter((guest) => guest.originKey === originKey);
    return { ...at(members[0]), originKey, city: members[0].city, guestIds: members.map((guest) => guest.id) };
  });

  const placed = destinations.map((destination) => ({ ...at(destination), id: destination.id, label: destination.label }));

  const arcs = guests.flatMap((guest) => {
    const home = homes.find((h) => h.originKey === guest.originKey)!;
    const slot = home.guestIds.indexOf(guest.id) - (home.guestIds.length - 1) / 2;
    return placed.map((destination) => ({
      guestId: guest.id,
      destinationId: destination.id,
      d: arcBetween([home.x, home.y], [destination.x, destination.y], slot),
    }));
  });

  return {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    land: path(shapes.land) ?? "",
    borders: path(shapes.borders) ?? "",
    graticule: path(geoGraticule10()) ?? "",
    homes,
    destinations: placed,
    arcs,
  };
}
