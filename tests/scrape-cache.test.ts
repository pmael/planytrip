import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { createScrapeCache, noCache } from "@/scrapers/cache";
import { createTestDb } from "./helpers/db";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

const HOUR = 3_600_000;

/** A clock the test moves by hand. */
function clock(start = "2026-10-20T10:00:00Z") {
  let time = Date.parse(start);
  return { now: () => new Date(time), advance: (ms: number) => void (time += ms) };
}

describe("createScrapeCache", () => {
  it("asks for what it does not have, and keeps it", async () => {
    const c = clock();
    const cache = createScrapeCache(db, c.now);
    const produce = vi.fn(async () => ({ listings: [1, 2, 3] }));

    expect(await cache.remember("barcelona", "airbnb", HOUR, produce)).toEqual({ listings: [1, 2, 3] });
    expect(await cache.remember("barcelona", "airbnb", HOUR, produce)).toEqual({ listings: [1, 2, 3] });
    expect(produce).toHaveBeenCalledTimes(1);
    expect(db.select().from(schema.scrapeCache).all()).toHaveLength(1);
  });

  it("asks again once what it kept is too old", async () => {
    const c = clock();
    const cache = createScrapeCache(db, c.now);
    const produce = vi.fn(async () => "fresh");
    await cache.remember("k", "airbnb", HOUR, produce);

    c.advance(HOUR - 1);
    await cache.remember("k", "airbnb", HOUR, produce);
    expect(produce).toHaveBeenCalledTimes(1);

    c.advance(2);
    await cache.remember("k", "airbnb", HOUR, produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it("asks anyway when told to refresh, and keeps the new answer", async () => {
    const cache = createScrapeCache(db, clock().now);
    let n = 0;
    const produce = async () => ++n;
    expect(await cache.remember("k", "airbnb", HOUR, produce)).toBe(1);
    expect(await cache.remember("k", "airbnb", HOUR, produce, { refresh: true })).toBe(2);
    expect(await cache.remember("k", "airbnb", HOUR, produce)).toBe(2);
    expect(db.select().from(schema.scrapeCache).all()).toHaveLength(1);
  });

  it("does not mix up different keys or different sources", async () => {
    const cache = createScrapeCache(db, clock().now);
    await cache.remember("same", "airbnb", HOUR, async () => "airbnb's");
    await cache.remember("same", "booking", HOUR, async () => "booking's");
    await cache.remember("other", "airbnb", HOUR, async () => "other");

    expect(await cache.remember("same", "airbnb", HOUR, async () => "x")).toBe("airbnb's");
    expect(await cache.remember("same", "booking", HOUR, async () => "x")).toBe("booking's");
    expect(db.select().from(schema.scrapeCache).all()).toHaveLength(3);
  });

  it("does not keep a failure: the next try asks again", async () => {
    const cache = createScrapeCache(db, clock().now);
    await expect(cache.remember("k", "airbnb", HOUR, async () => Promise.reject(new Error("blocked")))).rejects.toThrow("blocked");
    expect(db.select().from(schema.scrapeCache).all()).toHaveLength(0);
    expect(await cache.remember("k", "airbnb", HOUR, async () => "ok")).toBe("ok");
  });

  it("forgets what has expired, so the table does not grow for ever", async () => {
    const c = clock();
    const cache = createScrapeCache(db, c.now);
    await cache.remember("old", "airbnb", HOUR, async () => 1);
    c.advance(2 * HOUR);
    await cache.remember("new", "airbnb", HOUR, async () => 2);
    expect(db.select().from(schema.scrapeCache).all().map((r) => r.source)).toHaveLength(1);
  });

  it("keeps nested data as it was", async () => {
    const cache = createScrapeCache(db, clock().now);
    const value = { cards: [{ id: "1", photos: ["a", "b"], price: 900, rating: null }], pageCursors: ["x"] };
    await cache.remember("k", "airbnb", HOUR, async () => value);
    expect(await cache.remember("k", "airbnb", HOUR, async () => "other")).toEqual(value);
  });
});

describe("noCache", () => {
  it("keeps nothing: every request goes out", async () => {
    const produce = vi.fn(async () => "x");
    await noCache.remember("k", "airbnb", HOUR, produce);
    await noCache.remember("k", "airbnb", HOUR, produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });
});

describe("keepIf: what is not worth keeping is not believed", () => {
  it("does not store an answer it says is not worth keeping, and asks again", async () => {
    const { db, close } = createTestDb();
    const cache = createScrapeCache(db);
    const produce = vi.fn(async () => [] as string[]);
    await cache.remember("k", "s", 60_000, produce, { keepIf: (value) => value.length > 0 });
    await cache.remember("k", "s", 60_000, produce, { keepIf: (value) => value.length > 0 });
    expect(produce).toHaveBeenCalledTimes(2);
    expect(db.select().from(schema.scrapeCache).all()).toHaveLength(0);
    close();
  });

  it("ignores an empty answer that an older version stored, and replaces it", async () => {
    const { db, close } = createTestDb();
    const cache = createScrapeCache(db);
    await cache.remember("k", "s", 60_000, async () => [] as string[]);
    expect(db.select().from(schema.scrapeCache).all()).toHaveLength(1);

    const produce = vi.fn(async () => ["found"]);
    expect(await cache.remember("k", "s", 60_000, produce, { keepIf: (value) => value.length > 0 })).toEqual(["found"]);
    expect(await cache.remember("k", "s", 60_000, produce, { keepIf: (value) => value.length > 0 })).toEqual(["found"]);
    expect(produce).toHaveBeenCalledTimes(1);
    close();
  });
});
