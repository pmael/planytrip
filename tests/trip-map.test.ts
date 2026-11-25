import { describe, expect, it } from "vitest";
import { buildTripMap, MAP_HEIGHT, MAP_WIDTH, type MapDestination, type MapGuest } from "@/lib/tripMap";

const guests: MapGuest[] = [
  { id: "martin", name: "Martin", originKey: "madrid", city: "Madrid", lat: 40.4168, lon: -3.7038 },
  { id: "chloe", name: "Chloé", originKey: "paris", city: "Paris", lat: 48.8566, lon: 2.3522 },
  { id: "jessy", name: "Jessy", originKey: "madrid", city: "Madrid", lat: 40.4168, lon: -3.7038 },
];
const destinations: MapDestination[] = [
  { id: "bcn", label: "Barcelona", lat: 41.3874, lon: 2.1686 },
  { id: "run", label: "Réunion", lat: -21.1309, lon: 55.5266 },
  { id: "ms", label: "Mont-Saxonnex", lat: 46.0517, lon: 6.4533 },
];

const inside = ({ x, y }: { x: number; y: number }) => x >= 0 && x <= MAP_WIDTH && y >= 0 && y <= MAP_HEIGHT;

describe("buildTripMap", () => {
  const map = buildTripMap(guests, destinations);

  it("puts every guest's place and every destination on the map, off-map ones on its edge", () => {
    expect(map.destinations.map((d) => d.id)).toEqual(["bcn", "run", "ms"]);
    expect([...map.homes, ...map.destinations].every(inside)).toBe(true);
  });

  it("gives guests who leave from the same place one dot", () => {
    expect(map.homes.map((h) => [h.city, h.guestIds])).toEqual([["Madrid", ["martin", "jessy"]], ["Paris", ["chloe"]]]);
  });

  it("draws one curve from each guest to each destination, guest by guest", () => {
    expect(map.arcs).toHaveLength(9);
    expect(map.arcs.map((a) => a.guestId)).toEqual(["martin", "martin", "martin", "chloe", "chloe", "chloe", "jessy", "jessy", "jessy"]);
    expect(map.arcs.every((a) => /^M[\d.-]+,[\d.-]+ Q[\d.-]+,[\d.-]+ [\d.-]+,[\d.-]+$/.test(a.d))).toBe(true);
  });

  it("spreads the curves of guests who share a place so they can be told apart", () => {
    const toBarcelona = map.arcs.filter((a) => a.destinationId === "bcn");
    const [martin, chloe, jessy] = ["martin", "chloe", "jessy"].map((id) => toBarcelona.find((a) => a.guestId === id)!.d);
    expect(martin).not.toBe(jessy);
    expect(chloe).not.toBe(martin);
  });

  it("frames the places that sit together and points at the far one from the edge, with how far it is", () => {
    const [bcn, run, ms] = ["bcn", "run", "ms"].map((id) => map.destinations.find((d) => d.id === id)!);
    expect(run.offMap).toBe(true);
    expect(run.km).toBeGreaterThan(8000);
    expect(bcn.offMap || ms.offMap || map.homes.some((h) => h.offMap)).toBe(false);
    // It lies south-east of Europe, and that is the side of the map it is drawn on
    expect(run.x).toBeGreaterThan(bcn.x);
    expect(run.y).toBeGreaterThan(bcn.y);
    expect(Math.cos(run.angle)).toBeGreaterThan(0);
    expect(Math.sin(run.angle)).toBeGreaterThan(0);
  });

  it("keeps Madrid west of and below Paris, and the European places far enough apart to read", () => {
    const [madrid, paris] = ["Madrid", "Paris"].map((city) => map.homes.find((h) => h.city === city)!);
    expect(madrid.x).toBeLessThan(paris.x);
    expect(madrid.y).toBeGreaterThan(paris.y);
    const [bcn, ms] = ["bcn", "ms"].map((id) => map.destinations.find((d) => d.id === id)!);
    const apart = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    expect(apart(madrid, paris)).toBeGreaterThan(150);
    expect(apart(bcn, ms)).toBeGreaterThan(100);
  });

  it("frames everything when the places are spread over the world with no group among them", () => {
    const world = buildTripMap(
      [{ id: "g", name: "G", originKey: "madrid", city: "Madrid", lat: 40.4, lon: -3.7 }],
      [
        { id: "tokyo", label: "Tokyo", lat: 35.7, lon: 139.7 },
        { id: "sydney", label: "Sydney", lat: -33.9, lon: 151.2 },
      ],
    );
    expect(world.arcs).toHaveLength(2);
    expect([...world.homes, ...world.destinations].every((p) => inside(p) && Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it("draws country outlines, borders and a grid, small enough to send to the browser", () => {
    expect(map.land.startsWith("M")).toBe(true);
    expect(map.borders.startsWith("M")).toBe(true);
    expect(map.graticule.startsWith("M")).toBe(true);
    expect(map.land.length + map.borders.length + map.graticule.length).toBeLessThan(200_000);
  });

  it("stays light for a trip within one region, where the finer atlas is used", () => {
    const regional = buildTripMap(guests, destinations.filter((d) => d.id !== "run"));
    expect(regional.land.length + regional.borders.length + regional.graticule.length).toBeLessThan(150_000);
    expect(regional.land.length).toBeGreaterThan(10_000);
  });

  it("still shows a region when everything is in one place", () => {
    const home: MapGuest = { id: "g", name: "G", originKey: "paris", city: "Paris", lat: 48.85, lon: 2.35 };
    const near = buildTripMap([home], [{ id: "d", label: "Versailles", lat: 48.8, lon: 2.13 }]);
    const [h, d] = [near.homes[0], near.destinations[0]];
    // Not zoomed in so far that the two sit on opposite edges
    expect(Math.hypot(h.x - d.x, h.y - d.y)).toBeLessThan(MAP_WIDTH / 3);
    expect(inside(h) && inside(d)).toBe(true);
  });

  it("copes with no guests or no destinations", () => {
    expect(buildTripMap([], destinations).arcs).toEqual([]);
    expect(buildTripMap(guests, []).arcs).toEqual([]);
  });
});
