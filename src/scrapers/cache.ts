// What was scraped, kept in the `scrape_cache` table (database.md) so that a recomputation or a
// retry shortly after does not visit the site again.
import { createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import type { ScrapeCache } from "./types";

/** A short, uniform key for any request: the same source and key always give the same one. */
const hashed = (source: string, key: string) => createHash("sha256").update(`${source}|${key}`).digest("hex").slice(0, 40);

/** A cache over the `scrape_cache` table. `now` is swapped for a fixed clock in tests. */
export function createScrapeCache(db: Db, now: () => Date = () => new Date()): ScrapeCache {
  return {
    async remember<T>(
      key: string,
      source: string,
      ttlMs: number,
      produce: () => Promise<T>,
      { refresh = false, keepIf = () => true }: { refresh?: boolean; keepIf?: (value: T) => boolean } = {},
    ): Promise<T> {
      const id = hashed(source, key);
      if (!refresh) {
        const [kept] = db.select().from(schema.scrapeCache).where(eq(schema.scrapeCache.key, id)).all();
        // What is kept but not worth keeping (an empty answer an older version stored) is asked for again
        if (kept && kept.expiresAt > now().toISOString()) {
          const value = JSON.parse(kept.payloadJson) as T;
          if (keepIf(value)) return value;
        }
      }

      const value = await produce();
      if (!keepIf(value)) return value;
      const row = { key: id, source, payloadJson: JSON.stringify(value), expiresAt: new Date(now().getTime() + ttlMs).toISOString() };
      db.insert(schema.scrapeCache)
        .values(row)
        .onConflictDoUpdate({ target: schema.scrapeCache.key, set: { source: row.source, payloadJson: row.payloadJson, expiresAt: row.expiresAt } })
        .run();
      // What has expired is of no use to anyone
      db.delete(schema.scrapeCache).where(lt(schema.scrapeCache.expiresAt, now().toISOString())).run();
      return value;
    },
  };
}

/** A cache that keeps nothing: every request goes to the site. */
export const noCache: ScrapeCache = { remember: (_key, _source, _ttl, produce) => produce() };
