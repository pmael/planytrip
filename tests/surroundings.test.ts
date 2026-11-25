// What is around a place to stay, from the places OpenStreetMap lists (task.md T8.3): the survey's sums and distances,
// on made-up places, then on the places Overpass gave for central Barcelona on 2026-11-14.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { denseSpots, surroundingsOf, type PlacePoint } from "@/core/surroundings";
import { parseOverpass } from "@/scrapers/places/overpass";

const centre = { lat: 41.3874, lon: 2.1686 };
/** A point `northKm` north and `eastKm` east of the centre */
const at = (northKm: number, eastKm: number) => ({ lat: centre.lat + northKm / 110.574, lon: centre.lon + eastKm / (111.32 * Math.cos((centre.lat * Math.PI) / 180)) });
const place = (kind: PlacePoint["kind"], northKm: number, eastKm: number): PlacePoint => ({ kind, ...at(northKm, eastKm) });
const stay = (id: string, northKm: number, eastKm: number) => ({ id, ...at(northKm, eastKm) });

describe("surroundingsOf on made-up places", () => {
  it("measures the nearest supermarket, and says none beyond the 5 km it was looked for", () => {
    const points = [place("supermarket", 0, 0.3), place("supermarket", 0, 2)];
    const facts = surroundingsOf([stay("near", 0, 0), stay("far", 7, 0)], points, centre);
    expect(facts.get("near")?.supermarketKm).toBeCloseTo(0.3, 2);
    expect(facts.get("far")).toMatchObject({ supermarketKm: null, searchedKm: { supermarket: 5 } });
  });

  it("counts the bars within 500 m, the nightclubs within 1 km and the sights within 1 km", () => {
    const points = [place("bar", 0, 0.2), place("bar", 0, 0.45), place("bar", 0, 0.6), place("nightclub", 0, 0.8), place("sight", 0.9, 0), place("sight", 1.2, 0)];
    expect(surroundingsOf([stay("s", 0, 0)], points, centre).get("s")).toMatchObject({ barsWithin500m: 2, nightclubsWithin1Km: 1, sightsWithin1Km: 1 });
  });

  it("finds the nightlife district where bars are densest, and none in a village", () => {
    // 12 bars together 2 km east: a nightlife district; 3 scattered ones elsewhere
    const district = Array.from({ length: 12 }, (_, i) => place("bar", 0.02 * i, 2 + 0.02 * i));
    const scattered = [place("bar", -3, 0), place("bar", 3, 0), place("bar", 0, -3)];
    const facts = surroundingsOf([stay("in", 0.1, 2.1), stay("out", 0, 0)], [...district, ...scattered], centre);
    expect(facts.get("in")!.nightlifeKm).toBeLessThan(0.2);
    // The district reaches a few hundred metres around its bars
    expect(facts.get("out")!.nightlifeKm).toBeGreaterThan(1.5);
    expect(surroundingsOf([stay("s", 0, 0)], scattered, centre).get("s")?.nightlifeKm).toBeNull();
  });

  it("finds the historic centre where sights are densest", () => {
    const old = Array.from({ length: 8 }, (_, i) => place("sight", -1 + 0.03 * i, 0.03 * i));
    const facts = surroundingsOf([stay("s", 1, 0)], old, centre);
    expect(facts.get("s")!.historicCentreKm).toBeGreaterThan(1.7);
    expect(facts.get("s")!.historicCentreKm).toBeLessThan(2.3);
  });

  it("measures nature to the nearest hiking path or park, 0 inside a park, none beyond 40 km", () => {
    const park: PlacePoint = { kind: "park", ...at(10, 0), bounds: { minLat: at(8, 0).lat, minLon: at(0, -2).lon, maxLat: at(12, 0).lat, maxLon: at(0, 2).lon } };
    const points = [place("trail", 0, 3), park];
    const facts = surroundingsOf([stay("town", 0, 0), stay("inside", 10, 0), stay("away", -45, 0)], points, centre);
    expect(facts.get("town")!.natureKm).toBeCloseTo(3, 1);
    expect(facts.get("inside")!.natureKm).toBe(0);
    expect(facts.get("away")).toMatchObject({ natureKm: null, searchedKm: { nature: 40 } });
  });

  it("does not measure a big park by its box, inside or near it: its paths say how close it is", () => {
    // Like Collserola, whose box (11 × 15 km) covers half of Barcelona and ends 200 m from the old town
    const big: PlacePoint = { kind: "park", ...at(5, 0), bounds: { minLat: at(-1, 0).lat, minLon: at(0, -8).lon, maxLat: at(11, 0).lat, maxLon: at(0, 8).lon } };
    const facts = surroundingsOf([stay("inside", 0, 0), stay("near", -1.2, 0)], [big, place("trail", 0, 2.5)], centre);
    expect(facts.get("inside")!.natureKm).toBeCloseTo(2.5, 1);
    expect(facts.get("near")!.natureKm).toBeCloseTo(2.77, 1);
  });

  it("measures the distance to the destination's own point", () => {
    expect(surroundingsOf([stay("s", 3, 4)], [], centre).get("s")!.centreKm).toBeCloseTo(5, 1);
  });
});

describe("denseSpots", () => {
  it("keeps the spots at least half as busy as the busiest, and none below the minimum", () => {
    const points = [{ at: { x: 0, y: 0 }, weight: 6 }, { at: { x: 5, y: 5 }, weight: 4 }, { at: { x: 9, y: 9 }, weight: 1 }];
    const spots = denseSpots(points, { radiusKm: 0.5, stepKm: 0.25, share: 0.5, min: 5 });
    expect(spots.some((spot) => Math.hypot(spot.x, spot.y) < 0.3)).toBe(true);
    expect(spots.some((spot) => Math.hypot(spot.x - 5, spot.y - 5) < 0.3)).toBe(true);
    expect(spots.some((spot) => Math.hypot(spot.x - 9, spot.y - 9) < 0.3)).toBe(false);
    expect(denseSpots(points, { radiusKm: 0.5, stepKm: 0.25, share: 0.5, min: 7 })).toEqual([]);
  });
});

describe("surroundingsOf on central Barcelona (Overpass, 2026-11-14)", () => {
  const points = parseOverpass(JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/places/barcelona-overpass.json"), "utf8")));
  // Two real stays of the T8.2 check: a Gràcia penthouse, and a flat near the Sagrada Família
  const facts = surroundingsOf([{ id: "gracia", lat: 41.4025, lon: 2.1525 }, { id: "sagrada", lat: 41.4048, lon: 2.1761 }, { id: "born", lat: 41.3845, lon: 2.1815 }], points, centre);

  it("puts El Born in the nightlife district and the cathedral's quarter in the historic centre", () => {
    expect(facts.get("born")).toMatchObject({ nightlifeKm: expect.any(Number), historicCentreKm: expect.any(Number) });
    expect(facts.get("born")!.nightlifeKm).toBeLessThan(0.2);
    expect(facts.get("born")!.historicCentreKm).toBeLessThan(0.5);
    expect(facts.get("born")!.barsWithin500m).toBeGreaterThan(50);
  });

  it("counts Gràcia's own bars, and puts the Sagrada Família flat farther from the nightlife", () => {
    expect(facts.get("gracia")!.barsWithin500m).toBeGreaterThan(30);
    expect(facts.get("gracia")!.nightlifeKm).toBeLessThan(0.5);
    expect(facts.get("sagrada")!.nightlifeKm).toBeGreaterThan(facts.get("gracia")!.nightlifeKm!);
  });

  it("finds a supermarket within a few hundred metres of each", () => {
    for (const id of ["gracia", "sagrada", "born"]) expect(facts.get(id)!.supermarketKm).toBeLessThan(0.5);
  });
});
