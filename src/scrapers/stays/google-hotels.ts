// Google Hotels (task.md T7.4): the hotels at the destination for the group's dates, with what the stay costs.
//
// Booking.com turns an automated browser away (a search for any place is sent back to its empty front
// page, even through its own form), so the hotel column is filled from Google Hotels instead. It lists
// Booking's prices next to the other sites', and does not mind a browser.
//
// How it works, and why:
// - The search address carries the place, the days and the guests (the `ts` parameter is a small
//   protobuf, built here). Google answers with the hotels for that party in ONE room.
// - So a group is put in rooms of at most `guestsPerRoom`: 3 guests take one room, 4 take two of 2, 5 take
//   a room of 3 and one of 2. Each size of room is searched, and a hotel is kept when it has all of them;
//   its price is the sum, for the whole stay, taxes and fees included.
// - Rentals (apartments, houses) are left out: Airbnb is the source for those.
// - What Google answered is kept for a day.
// - For the Extra (task.md T8.2) each hotel keeps where it is (from the page's own data), every amenity Google names,
//   and that its price has the tourist tax in it: Google's policy is that a total includes city and tourism taxes,
//   even those paid at the hotel (stay-tax.ts).
import { cacheTtlMs, googleHotels } from "@/config";
import { distanceKm } from "@/geo/airports";
import { noCache } from "../cache";
import type { StayAdapter, StayOptionInput, StayQuery } from "../types";
import { chromeHotelsDriver, type HotelsDriver } from "./google-hotels-chrome";
import { parseHotels, type Hotel } from "./google-hotels-parse";
import { GOOGLE_HOTELS_TAX } from "./stay-tax";

/** The tunable numbers of the search (config.googleHotels) */
export type GoogleHotelsSettings = {
  baseUrl: string;
  language: string;
  region: string;
  currency: string;
  guestsPerRoom: number;
  maxResults: number;
  answerTimeoutMs: number;
};

const SOURCE = "google-hotels";

/** The amenities shown with a hotel (and given to the AI): the first ones Google names */
const MAX_BADGES = 8;

// ── The address ─────────────────────────────────────────────────────────────

const varint = (value: number): number[] => {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 127) {
    bytes.push((rest & 127) | 128);
    rest = Math.floor(rest / 128);
  }
  return [...bytes, rest];
};
/** A protobuf field holding bytes: tag, length, content. */
const field = (tag: number, content: number[]) => [tag, ...varint(content.length), ...content];
const dateBytes = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return [0x08, ...varint(year), 0x10, month, 0x18, day];
};

/**
 * What Google's `ts` parameter says: the check-in and check-out days, how many adults, the currency. It is
 * a protobuf Google writes into its own addresses, read off those and rebuilt here for any dates and party.
 */
export function tsParam(adults: number, checkIn: string, checkOut: string, currency = "EUR"): string {
  const party = [...Array(adults)].flatMap(() => field(0x0a, [0x08, 0x03])).concat([0x10, 0x00]);
  const days = [...field(0x0a, dateBytes(checkIn)), ...field(0x12, dateBytes(checkOut)), 0x18, 0x01];
  const stay = [...field(0x12, days), 0x32, 0x02, 0x08, 0x01];
  const dates = [...field(0x0a, [0x1a, 0x00]), ...field(0x12, stay)];
  const code = [...currency].map((letter) => letter.charCodeAt(0));
  const bytes = [0x08, 0x01, ...field(0x12, party), ...field(0x1a, dates), ...field(0x2a, field(0x0a, [0x3a, code.length, ...code]))];
  return Buffer.from(bytes).toString("base64url");
}

export function searchUrl(settings: GoogleHotelsSettings, place: string, adults: number, window: { from: string; to: string }): string {
  const params = new URLSearchParams({
    q: `Hotels in ${place}`,
    hl: settings.language,
    gl: settings.region,
    curr: settings.currency,
    ts: tsParam(adults, window.from, window.to, settings.currency),
  });
  return `${settings.baseUrl}?${params}`;
}

/** The rooms a group takes: as few as `perRoom` allows, the guests spread evenly, the fuller rooms first. [3, 2] for 5 guests. */
export function roomPlan(guests: number, perRoom: number): number[] {
  const rooms = Math.max(1, Math.ceil(guests / perRoom));
  const base = Math.floor(guests / rooms);
  const extra = guests % rooms;
  return Array.from({ length: rooms }, (_, index) => base + (index < extra ? 1 : 0));
}

const slug = (name: string) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const nameKey = (name: string) => slug(name);

// ── The adapter ─────────────────────────────────────────────────────────────

export function createGoogleHotelsAdapter({
  driver,
  config,
  now = () => new Date(),
}: {
  driver: HotelsDriver;
  config: GoogleHotelsSettings;
  now?: () => Date;
}): StayAdapter {
  return {
    id: SOURCE,
    async search(query: StayQuery): Promise<StayOptionInput[]> {
      // Google sells no night that has already begun
      if (query.window.from <= now().toISOString().slice(0, 10) || query.groupSize < 1) return [];

      const cache = query.cache ?? noCache;
      const place = query.destination.label;
      const plan = roomPlan(query.groupSize, config.guestsPerRoom);

      const bySize = new Map<number, Hotel[]>();
      for (const size of new Set(plan)) {
        const url = searchUrl(config, place, size, query.window);
        const hotels = await cache.remember<Hotel[]>(
          `hotels|v2|${place}|${size}|${query.window.from}|${query.window.to}`,
          SOURCE,
          cacheTtlMs.scrape,
          async () => parseHotels(await driver(url)),
          // No hotel at all may only be a page that did not show them: not believed for a day
          { refresh: query.refresh, keepIf: (value) => value.length > 0 },
        );
        bySize.set(size, hotels);
      }

      // A hotel is offered when it has a room for every size the group needs; the stay costs them all
      const [firstSize] = plan;
      const options: StayOptionInput[] = [];
      for (const hotel of bySize.get(firstSize) ?? []) {
        const rooms = plan.map((size) => bySize.get(size)?.find((candidate) => nameKey(candidate.name) === nameKey(hotel.name)));
        if (rooms.some((room) => !room)) continue;
        const totalPriceEur = rooms.reduce((sum, room) => sum + room!.totalEur, 0);
        options.push({
          provider: "booking",
          externalId: hotel.entityId ?? slug(hotel.name),
          title: hotel.name,
          photos: hotel.photos,
          capacity: query.groupSize,
          rooms: plan.length,
          beds: null,
          checkIn: query.window.from,
          checkOut: query.window.to,
          totalPriceEur,
          rating: hotel.rating,
          reviewsSample: null,
          url: hotelUrl(config, hotel, place, firstSize, query.window),
          raw: {
            source: SOURCE,
            reviewCount: hotel.reviewCount,
            propertyType: hotel.stars ? `${hotel.stars}-star hotel` : "hotel",
            badges: hotel.amenities.slice(0, MAX_BADGES),
            roomPlan: plan,
            roomPrices: rooms.map((room) => room!.totalEur),
            // For the Extra (T8.2): where it is, every amenity Google names, and the tax (in Google's totals by its policy)
            distanceKm: hotel.lat !== null && hotel.lon !== null ? Math.round(distanceKm(query.destination.lat, query.destination.lon, hotel.lat, hotel.lon) * 10) / 10 : null,
            lat: hotel.lat,
            lon: hotel.lon,
            amenities: hotel.amenities,
            touristTax: GOOGLE_HOTELS_TAX,
          },
        });
        if (options.length >= config.maxResults) break;
      }
      return options;
    },
  };
}

/** Where the offer opens: Google's own page for the hotel on the group's days, with the sites that sell it. */
function hotelUrl(settings: GoogleHotelsSettings, hotel: Hotel, place: string, adults: number, window: { from: string; to: string }): string {
  const params = new URLSearchParams({ q: `${hotel.name} ${place}`, hl: settings.language, gl: settings.region, curr: settings.currency, ts: tsParam(adults, window.from, window.to, settings.currency) });
  return `${settings.baseUrl}?${params}`;
}

export const googleHotelsAdapter = createGoogleHotelsAdapter({ driver: chromeHotelsDriver, config: googleHotels });
