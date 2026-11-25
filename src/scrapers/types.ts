import type { DateRange, StayOption, TransportMode, TransportOption } from "@/core/types";

/** One transport search: how to get from where a group of guests lives to a destination. */
export type TransportQuery = {
  mode: TransportMode;
  /** Where the guests leave from (guests of the same place share the search) */
  origin: { key: string; label: string; lat: number; lon: number; airports: string[] };
  /** `countryCode`: ISO 3166-1 alpha-2 ("ES"), for what depends on the country (the fuel price, task.md T8.12) */
  destination: { id: string; label: string; lat: number; lon: number; airports: string[]; countryCode?: string };
  /** The stay: the trip out leaves on `from` and the way back on `to` */
  window: DateRange;
  /** Where to keep what is scraped. Without one, nothing is kept. */
  cache?: ScrapeCache;
  /** Ask the site again even when what was scraped is still kept */
  refresh?: boolean;
};

/** What an adapter finds. The worker adds the ids and the time it was fetched when it stores it. */
export type TransportOptionInput = Omit<TransportOption, "id" | "tripId" | "destinationId" | "fetchedAt" | "priceKind" | "priceNote" | "soldOut"> & {
  /** A real price unless the adapter says it worked it out (trains) */
  priceKind?: TransportOption["priceKind"];
  priceNote?: string | null;
  /** Seats are left unless the adapter says the seller has none (trains read on SNCF Connect) */
  soldOut?: boolean;
  /** What the source said, kept for debugging */
  raw?: unknown;
};

/** A source of transport options (flights, trains, the car...). */
export interface TransportAdapter {
  id: string;
  modes: TransportMode[];
  search(query: TransportQuery): Promise<TransportOptionInput[]>;
}

/**
 * What was scraped, kept for a while so that asking again soon (a recomputation, a retry) does not
 * visit the site again: a polite scraper, and a fast one.
 */
export interface ScrapeCache {
  /**
   * What `produce` gave for `key` within the last `ttlMs`; otherwise asks `produce` and keeps what it
   * gives. `refresh` skips what is kept and asks anyway. `keepIf` says whether an answer is worth keeping: an
   * empty answer may only be a site that did not show its results, and must not be believed for a day.
   * The value must survive being written as JSON.
   */
  remember<T>(
    key: string,
    source: string,
    ttlMs: number,
    produce: () => Promise<T>,
    options?: { refresh?: boolean; keepIf?: (value: T) => boolean },
  ): Promise<T>;
}

/** One accommodation search: where to stay, and for which dates. */
export type StayQuery = {
  destination: { id: string; label: string; lat: number; lon: number; airports: string[] };
  /** Check in on `from`, check out on `to` (the destination's own dates already taken into account) */
  window: DateRange;
  /** How many people the accommodation is for: it must sleep at least that many */
  groupSize: number;
  /** Where to keep what is scraped. Without one, nothing is kept. */
  cache?: ScrapeCache;
  /** Ask the site again even when what was scraped is still kept */
  refresh?: boolean;
};

/** What an adapter finds. The worker adds the ids and the time it was fetched when it stores it. */
export type StayOptionInput = Omit<StayOption, "id" | "destinationId" | "fetchedAt"> & {
  /** What the source said, kept for debugging */
  raw?: unknown;
};

/** A source of accommodation offers (Airbnb, Google Hotels...). */
export interface StayAdapter {
  id: string;
  search(query: StayQuery): Promise<StayOptionInput[]>;
}
