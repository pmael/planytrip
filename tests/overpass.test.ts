// The places around a destination's stays, from OpenStreetMap's Overpass (task.md T8.3): the area asked, the query,
// reading the answer, and keeping it a month.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { places } from "@/config";
import { ScrapeChangedError, ScrapeError } from "@/scrapers/errors";
import type { Http } from "@/scrapers/http";
import { createOverpassFetcher, kindOf, overpassQuery, parseOverpass, surveyArea } from "@/scrapers/places/overpass";
import type { ScrapeCache } from "@/scrapers/types";

const BARCELONA = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/places/barcelona-overpass.json"), "utf8"));
const centre = { lat: 41.3874, lon: 2.1686 };

describe("surveyArea", () => {
  it("covers the stays and the centre with a margin, on a 0.05° grid", () => {
    // 3 km south of the centre is 41.360, less the 1.2 km margin 41.349: the grid line below is 41.30
    const area = surveyArea(centre, [{ lat: 41.4561, lon: 2.2054 }, { lat: 41.3751, lon: 2.0723 }]);
    expect(area).toEqual({ south: 41.3, west: 2.05, north: 41.5, east: 2.25 });
  });

  it("gives the same area when the stays move a little, so the answer kept serves the next search", () => {
    const one = surveyArea(centre, [{ lat: 41.40, lon: 2.15 }]);
    const other = surveyArea(centre, [{ lat: 41.41, lon: 2.16 }]);
    expect(other).toEqual(one);
  });
});

describe("overpassQuery", () => {
  const query = overpassQuery({ south: 41.35, west: 2.05, north: 41.5, east: 2.25 });

  it("asks for the places of the area, supermarkets and paths a little farther, parks much farther", () => {
    expect(query).toContain(`[timeout:${places.serverTimeoutS}]`);
    expect(query).toContain('nwr["amenity"~"^(bar|pub|nightclub)$"](41.35,2.05,41.5,2.25);');
    expect(query).toMatch(/nwr\["shop"="supermarket"\]\(41\.3,1\.95,41\.55,2\.35\);/);
    expect(query).toMatch(/nwr\["boundary"="national_park"\]\(40\.95,1\.55,41\.9,2\.75\);/);
    expect(query.match(/^out /gm)).toEqual(["out ", "out "]);
  });
});

describe("kindOf", () => {
  it("tells the places apart by their tags", () => {
    expect(kindOf({ amenity: "pub" })).toBe("bar");
    expect(kindOf({ amenity: "nightclub" })).toBe("nightclub");
    expect(kindOf({ tourism: "museum", historic: "castle" })).toBe("sight");
    expect(kindOf({ shop: "supermarket" })).toBe("supermarket");
    expect(kindOf({ highway: "path", sac_scale: "mountain_hiking" })).toBe("trail");
    expect(kindOf({ highway: "trailhead" })).toBe("trail");
    expect(kindOf({ boundary: "protected_area", protect_class: "4" })).toBe("park");
    expect(kindOf({ amenity: "restaurant" })).toBeNull();
  });
});

describe("parseOverpass", () => {
  it("reads every place of a real answer: points, the centre of a way, the box of a park", () => {
    const points = parseOverpass(BARCELONA);
    // The capture was made with a wider query: its plain historic buildings are not sights
    const leftOut = BARCELONA.elements.filter((element: { tags: Record<string, string> }) => kindOf(element.tags) === null);
    expect(leftOut).toHaveLength(42);
    expect(leftOut.every((element: { tags: Record<string, string> }) => element.tags.historic === "building")).toBe(true);
    expect(points.length).toBe(BARCELONA.elements.length - leftOut.length);
    const count = (kind: string) => points.filter((point) => point.kind === kind).length;
    expect(count("bar")).toBe(970);
    expect(count("nightclub")).toBe(57);
    expect(count("supermarket")).toBe(649);
    const park = points.find((point) => point.kind === "park")!;
    expect(park.bounds).toBeDefined();
    expect(park.lat).toBeCloseTo((park.bounds!.minLat + park.bounds!.maxLat) / 2, 6);
  });

  it("asks again when the server could not finish, and says the site changed when it is not a list of places", () => {
    const cut = () => parseOverpass({ elements: [], remark: "runtime error: Query timed out in \"query\" at line 3 after 120 seconds." });
    expect(cut).toThrow(ScrapeError);
    try {
      cut();
    } catch (error) {
      expect((error as ScrapeError).retryable).toBe(true);
    }
    expect(() => parseOverpass({ hello: 1 })).toThrow(ScrapeChangedError);
  });
});

describe("createOverpassFetcher", () => {
  it("asks once with the query in the address, and keeps the answer a month under the area's key", async () => {
    const http: Http = { getJson: vi.fn(async () => BARCELONA), postJson: vi.fn() };
    const remembered: { key: string; ttl: number; refresh?: boolean }[] = [];
    const cache: ScrapeCache = { remember: async (key, _source, ttl, produce, options) => (remembered.push({ key, ttl, refresh: options?.refresh }), produce()) };
    const area = { south: 41.35, west: 2.05, north: 41.5, east: 2.25 };
    const points = await createOverpassFetcher({ http })(area, { cache, refresh: true });

    expect(points.length).toBeGreaterThan(1000);
    expect(http.getJson).toHaveBeenCalledTimes(1);
    const url = new URL(vi.mocked(http.getJson).mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(places.overpassUrl);
    expect(url.searchParams.get("data")).toBe(overpassQuery(area));
    expect(remembered).toEqual([{ key: "overpass|v1|41.35,2.05,41.5,2.25", ttl: 30 * 24 * 60 * 60 * 1000, refresh: true }]);
  });
});
