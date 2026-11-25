// Airbnb (task.md T7.3): whole homes that sleep the group, for the group's dates, around the destination.
//
// How it works, and why:
// - It searches a map box around the destination's coordinates. Asking by name puts "Saint-Gilles"
//   (La Réunion) in Europe; coordinates are never ambiguous. A sparse area widens the box.
// - The search asks for the group's dates, the group's size (Airbnb then only returns places that
//   sleep at least that many) and whole homes only. The price it shows is the total for those dates.
// - The search page does not say how many people a place sleeps, so the most promising listings are
//   opened one by one: that gives the exact capacity and confirms it is a whole home.
// - It keeps places sleeping N to N + 1 people for a group of N, never fewer. If too few fit that
//   band it is widened, rather than offering nothing.
// - For the Extra (task.md T8.2) each offer keeps where it is, its amenities, and whether its price has the tourist
//   tax in it (stay-tax.ts): Airbnb's own "Taxes" line says yes, the host saying it is paid at check-in says no.
import { airbnb, cacheTtlMs } from "@/config";
import { nightsBetween } from "@/core/dates";
import { distanceKm } from "@/geo/airports";
import { fetchWithChrome, type PageFetcher } from "../browser";
import { noCache } from "../cache";
import { ScrapeBlockedError, ScrapeChangedError, ScrapeError, ScrapeUnavailableError } from "../errors";
import type { StayAdapter, StayOptionInput, StayQuery } from "../types";
import { isWholePlace, parseListingPage, parseSearchPage, type ListingCard, type ListingDetails } from "./airbnb-parse";
import { airbnbTax } from "./stay-tax";

/** The tunable numbers of the Airbnb search (config.airbnb) */
export type AirbnbSettings = {
  baseUrl: string;
  searchPages: number;
  radiiKm: readonly number[];
  minCards: number;
  detailLimit: number;
  extraCapacity: number;
  relaxedExtraCapacity: number;
  minListings: number;
  enough: number;
};

/** The most people Airbnb lets a search be for. */
const MAX_GUESTS = 16;
/** Results kept at most, whatever the band: more would only cost the AI more to read */
const MAX_RESULTS = 12;

/** The cache key of a listing's page: "v2" since its amenities, position and the host's tax are read (T8.2), so an older entry is not taken for one */
const listingKey = (id: string) => `listing|v2|${id}`;

const SOURCE = "airbnb";

type SearchArea = { lat: number; lon: number; radiusKm: number };

/** The address of a page of results: a box around the destination, the dates, the group, whole homes. */
export function searchUrl(
  baseUrl: string,
  { lat, lon, radiusKm }: SearchArea,
  { from, to, guests }: { from: string; to: string; guests: number },
  cursor?: string,
): string {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const params = new URLSearchParams({
    search_by_map: "true",
    ne_lat: (lat + dLat).toFixed(5),
    ne_lng: (lon + dLon).toFixed(5),
    sw_lat: (lat - dLat).toFixed(5),
    sw_lng: (lon - dLon).toFixed(5),
    zoom: "12",
    checkin: from,
    checkout: to,
    adults: String(guests),
    currency: "EUR",
    locale: "en",
  });
  params.append("room_types[]", "Entire home/apt");
  if (cursor) params.set("cursor", cursor);
  return `${baseUrl}/s/homes?${params}`;
}

/** The address of a listing for the group's dates: what the guests open to book it. */
export const listingUrl = (baseUrl: string, id: string, { from, to, guests }: { from: string; to: string; guests: number }) =>
  `${baseUrl}/rooms/${id}?${new URLSearchParams({ check_in: from, check_out: to, adults: String(guests) })}`;

/** The cheapest and the best rated, taking turns: a short list that has both, rather than only one kind. */
export function shortlistOf(cards: ListingCard[], limit: number): ListingCard[] {
  const cheapest = [...cards].sort((a, b) => a.totalPriceEur - b.totalPriceEur);
  const bestRated = [...cards].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0) || a.totalPriceEur - b.totalPriceEur);

  const picked: ListingCard[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < cards.length && picked.length < limit; i++) {
    for (const card of [cheapest[i], bestRated[i]]) {
      if (card && !seen.has(card.id) && picked.length < limit) {
        seen.add(card.id);
        picked.push(card);
      }
    }
  }
  return picked;
}

/**
 * An Airbnb adapter. `fetchPage` is how pages are loaded (the shared Chrome by default), `config` the
 * tunable numbers; both are swapped in tests.
 */
export function createAirbnbAdapter({ fetchPage = fetchWithChrome, config = airbnb }: { fetchPage?: PageFetcher; config?: AirbnbSettings } = {}): StayAdapter {
  async function loadSearch(url: string) {
    const fetched = await fetchPage(url);
    if (fetched.status === 403 || fetched.status === 429) throw new ScrapeBlockedError(`Airbnb answered ${fetched.status}: it is turning automated visitors away`);
    if (fetched.status >= 500) throw new ScrapeError(`Airbnb answered ${fetched.status}`);

    const page = parseSearchPage(fetched.html);
    switch (page.kind) {
      case "results":
        return { cards: page.cards, pageCursors: page.pageCursors };
      case "blocked":
        throw new ScrapeBlockedError();
      case "no-search":
        throw new ScrapeUnavailableError("Airbnb has nothing to show for these dates yet: it only sells about a year ahead");
      case "unknown":
        throw new ScrapeChangedError("Airbnb's search page is not built the way this scraper expects: the site has changed");
    }
  }

  async function loadDetails(id: string, url: string): Promise<ListingDetails> {
    const fetched = await fetchPage(url);
    if (fetched.status === 403 || fetched.status === 429) throw new ScrapeBlockedError(`Airbnb answered ${fetched.status}: it is turning automated visitors away`);
    if (fetched.status === 404 || fetched.status === 410) throw new ScrapeUnavailableError(`Listing ${id} is gone`);
    const details = parseListingPage(fetched.html);
    if (!details) {
      if (parseSearchPage(fetched.html).kind === "blocked") throw new ScrapeBlockedError();
      throw new ScrapeChangedError(`Listing ${id}: its page has no capacity in it`);
    }
    return details;
  }

  return {
    id: SOURCE,
    async search(query: StayQuery): Promise<StayOptionInput[]> {
      const { destination, window } = query;
      if (nightsBetween(window) < 1) return [];

      const guests = Math.min(Math.max(1, Math.round(query.groupSize)), MAX_GUESTS);
      const stay = { from: window.from, to: window.to, guests };
      const cache = query.cache ?? noCache;
      const remember = <T>(key: string, produce: () => Promise<T>) =>
        cache.remember(key, SOURCE, cacheTtlMs.scrape, produce, { refresh: query.refresh });

      // 1. The listings around the destination, in a box that grows until the area gives enough
      const cards = new Map<string, ListingCard>();
      for (const radiusKm of config.radiiKm) {
        const area = { lat: destination.lat, lon: destination.lon, radiusKm };
        cards.clear();
        // The first page lists where every page starts: page N is asked for with the Nth of those
        let cursors: string[] = [];
        for (let pageNumber = 0; pageNumber < config.searchPages; pageNumber++) {
          const cursor = pageNumber === 0 ? undefined : cursors[pageNumber];
          if (pageNumber > 0 && !cursor) break;
          const url = searchUrl(config.baseUrl, area, stay, cursor);
          const result = await remember(`search|${url}`, () => loadSearch(url));
          if (pageNumber === 0) cursors = result.pageCursors;
          for (const card of result.cards) if (isWholePlace(null, card.placeType) && !cards.has(card.id)) cards.set(card.id, card);
        }
        if (cards.size >= config.minCards) break;
      }
      if (cards.size === 0) return [];

      // 2. The most promising ones are opened: that is where the exact capacity and the kind of place are
      const kept: { card: ListingCard; details: ListingDetails | null; capacity: number }[] = [];
      const inBand = (capacity: number) => capacity >= guests && capacity <= guests + config.extraCapacity;
      let opened = 0;
      let failure: unknown = null;
      for (const card of shortlistOf([...cards.values()], config.detailLimit)) {
        if (opened >= config.detailLimit || kept.filter((k) => inBand(k.capacity)).length >= config.enough) break;
        opened++;
        try {
          const details = await remember(listingKey(card.id), () => loadDetails(card.id, `${config.baseUrl}/rooms/${card.id}`));
          if (!isWholePlace(details.propertyType, card.placeType)) continue;
          // A page that does not say is taken at its word from the search: it sleeps at least the group
          const capacity = details.capacity ?? guests;
          if (capacity < guests) continue;
          kept.push({ card, details, capacity });
        } catch (error) {
          // A refusal ends the search; one listing that cannot be read does not
          if (error instanceof ScrapeBlockedError) throw error;
          failure ??= error;
        }
      }
      if (kept.length === 0 && failure) throw failure;

      // 3. N to N + 1 people, never fewer; wider only when that leaves too little to choose from
      const band = kept.filter((k) => inBand(k.capacity));
      const chosen = band.length >= config.minListings ? band : kept.filter((k) => k.capacity <= guests + config.relaxedExtraCapacity);

      return chosen.slice(0, MAX_RESULTS).map(({ card, details, capacity }): StayOptionInput => {
        const lat = card.lat ?? details?.lat ?? null;
        const lon = card.lon ?? details?.lon ?? null;
        return {
          provider: "airbnb",
          externalId: card.id,
          // Hosts put line breaks in their titles: it is shown on one line
          title: (details?.name ?? card.name ?? card.placeType ?? `Airbnb ${card.id}`).replace(/\s+/g, " ").trim(),
          photos: card.photos,
          capacity,
          // A studio is one room
          rooms: card.bedrooms === 0 ? 1 : card.bedrooms,
          beds: card.beds,
          checkIn: window.from,
          checkOut: window.to,
          totalPriceEur: card.totalPriceEur,
          rating: details?.rating ?? card.rating,
          reviewsSample: null,
          url: listingUrl(config.baseUrl, card.id, stay),
          raw: {
            source: SOURCE,
            reviewCount: details?.reviewCount ?? card.reviewCount,
            hostType: card.hostType,
            propertyType: details?.propertyType ?? card.placeType,
            bedrooms: card.bedrooms,
            beds: card.beds,
            bathrooms: card.bathrooms,
            badges: card.badges,
            distanceKm: lat !== null && lon !== null ? Math.round(distanceKm(destination.lat, destination.lon, lat, lon) * 10) / 10 : null,
            capacityKnown: details?.capacity != null,
            lat,
            lon,
            amenities: details?.amenities ?? [],
            touristTax: airbnbTax(card.taxesEur, details?.hostTax ?? null),
          },
        };
      });
    },
  };
}

/** The Airbnb adapter, loading its pages in the shared Chrome. */
export const airbnbAdapter: StayAdapter = createAirbnbAdapter();
