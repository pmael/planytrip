import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeoPlace } from "@/core/types";
import { GeocoderUnavailableError } from "@/geo/geocode";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { resolvePlace, searchPlaces } from "@/server/services/geo";
import { createTestDb } from "./helpers/db";

const madrid: GeoPlace = { label: "Madrid, Spain", countryCode: "ES", lat: 40.417, lon: -3.704, airports: ["MAD"] };
const madre: GeoPlace = { label: "Madré, France", countryCode: "FR", lat: 48.477, lon: -0.38, airports: [] };

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

describe("searchPlaces", () => {
  it("returns what the geocoder finds", async () => {
    const geocode = vi.fn(async () => [madre, madrid]);
    expect(await searchPlaces(db, "Madr", geocode)).toEqual([madre, madrid]);
    expect(geocode).toHaveBeenCalledWith("Madr");
  });

  it("does not ask the geocoder twice for the same text", async () => {
    const geocode = vi.fn(async () => [madrid]);
    await searchPlaces(db, "Madrid", geocode);
    expect(await searchPlaces(db, "Madrid", geocode)).toEqual([madrid]);
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it("ignores case and spacing when looking in the cache", async () => {
    const geocode = vi.fn(async () => [madrid]);
    await searchPlaces(db, "Mont Saxonnex", geocode);
    await searchPlaces(db, "  mont   SAXONNEX ", geocode);
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it("caches an empty answer too", async () => {
    const geocode = vi.fn(async () => []);
    await searchPlaces(db, "zzzz", geocode);
    await searchPlaces(db, "zzzz", geocode);
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it("asks again once the cached answer is older than 30 days", async () => {
    const geocode = vi.fn(async () => [madrid]);
    await searchPlaces(db, "Madrid", geocode);
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    db.update(schema.geoCache).set({ createdAt: old }).where(eq(schema.geoCache.query, "madrid")).run();

    await searchPlaces(db, "Madrid", geocode);
    expect(geocode).toHaveBeenCalledTimes(2);
    // and the refreshed entry is fresh again
    await searchPlaces(db, "Madrid", geocode);
    expect(geocode).toHaveBeenCalledTimes(2);
    expect(db.select().from(schema.geoCache).all()).toHaveLength(1);
  });

  it("keeps different texts apart", async () => {
    const geocode = vi.fn(async (q: string) => (q === "Madr" ? [madre] : [madrid]));
    expect(await searchPlaces(db, "Madr", geocode)).toEqual([madre]);
    expect(await searchPlaces(db, "Madrid", geocode)).toEqual([madrid]);
  });

  it("lets the error through and does not cache it", async () => {
    const geocode = vi
      .fn()
      .mockRejectedValueOnce(new GeocoderUnavailableError("down"))
      .mockResolvedValueOnce([madrid]);
    await expect(searchPlaces(db, "Madrid", geocode)).rejects.toBeInstanceOf(GeocoderUnavailableError);
    expect(await searchPlaces(db, "Madrid", geocode)).toEqual([madrid]);
  });
});

describe("resolvePlace", () => {
  it("is the first match", async () => {
    expect(await resolvePlace(db, "Madrid", async () => [madrid, madre])).toEqual(madrid);
  });

  it("is null when nothing matches", async () => {
    expect(await resolvePlace(db, "zzzz", async () => [])).toBeNull();
  });
});
