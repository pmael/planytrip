import { ScrapeError } from "@/scrapers/errors";
import { searchStays, searchTransport } from "@/server/services/search";
import type { AdapterSet } from "@/scrapers/registry";
import { parsePayload, SearchStaysPayloadSchema, SearchTransportPayloadSchema } from "../payloads";
import { PermanentJobError } from "../queue";
import type { JobHandler } from "../types";

/**
 * A scrape that failed in a way trying again cannot cure (the site turned us away, sells nothing for
 * these dates, or changed) fails for good at once: asking again a few seconds later only makes a
 * site that has refused us more suspicious. A slow page or a hiccup is tried again by the queue.
 */
async function scraped<T>(search: () => Promise<T>): Promise<T> {
  try {
    return await search();
  } catch (error) {
    if (error instanceof ScrapeError && !error.retryable) throw new PermanentJobError(error.message);
    throw error;
  }
}

/** search_transport: asks the adapters of one mode how to get from one departure place to one destination. */
export const createSearchTransportHandler =
  (adapters: AdapterSet): JobHandler =>
  async (job, { db }) => {
    const payload = parsePayload(SearchTransportPayloadSchema, job.payload);
    await scraped(() => searchTransport(db, payload, adapters.transportAdaptersFor(payload.mode)));
  };

/** search_stays: asks the adapters for places to stay at one destination. */
export const createSearchStaysHandler =
  (adapters: AdapterSet): JobHandler =>
  async (job, { db }) => {
    const payload = parsePayload(SearchStaysPayloadSchema, job.payload);
    await scraped(() => searchStays(db, payload, adapters.stayAdapters()));
  };
