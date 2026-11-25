import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { googleHotels } from "@/config";
import { ScrapeChangedError, ScrapeError } from "@/scrapers/errors";
import type { HotelsDriver } from "@/scrapers/stays/google-hotels-chrome";
import { hotelPositions, parseHotels, positionFor, type RawHotelCard } from "@/scrapers/stays/google-hotels-parse";
import { createGoogleHotelsAdapter, roomPlan, searchUrl, tsParam, type GoogleHotelsSettings } from "@/scrapers/stays/google-hotels";
import type { ScrapeCache, StayQuery } from "@/scrapers/types";

const cards = (name: string): RawHotelCard[] => JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/google-hotels", name), "utf8"));
const FOR_3 = cards("barcelona-3-guests.json");
const FOR_2 = cards("barcelona-2-guests.json");

describe("tsParam", () => {
  it("rebuilds exactly what Google writes for 2 guests from 22 to 26 December 2026", () => {
    // Read off an address Google itself made
    expect(tsParam(2, "2026-12-22", "2026-12-26")).toBe("CAESCgoCCAMKAggDEAAaIAoCGgASGhIUCgcI6g8QDBgWEgcI6g8QDBgaGAEyAggBKgcKBToDRVVS");
  });

  it("changes with the guests, the days and the currency", () => {
    expect(tsParam(3, "2026-12-22", "2026-12-26")).not.toBe(tsParam(2, "2026-12-22", "2026-12-26"));
    expect(tsParam(2, "2026-12-23", "2026-12-26")).not.toBe(tsParam(2, "2026-12-22", "2026-12-26"));
    expect(tsParam(2, "2026-12-22", "2026-12-26", "USD")).not.toBe(tsParam(2, "2026-12-22", "2026-12-26"));
  });
});

describe("searchUrl", () => {
  it("asks for the hotels in the place, in euros, with the days and the party in `ts`", () => {
    const url = new URL(searchUrl(googleHotels, "Barcelona, Spain", 3, { from: "2026-12-22", to: "2026-12-26" }));
    expect(url.origin + url.pathname).toBe("https://www.google.com/travel/search");
    expect(url.searchParams.get("q")).toBe("Hotels in Barcelona, Spain");
    expect(url.searchParams.get("curr")).toBe("EUR");
    expect(url.searchParams.get("ts")).toBe(tsParam(3, "2026-12-22", "2026-12-26"));
  });
});

describe("roomPlan", () => {
  it("puts a small group in one room and spreads a bigger one over as few as it takes", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => roomPlan(n, 3))).toEqual([[1], [2], [3], [2, 2], [3, 2], [3, 3], [3, 2, 2]]);
    expect(roomPlan(0, 3)).toEqual([0]);
  });
});

describe("parseHotels: Barcelona for 3 guests, 22 to 26 December", () => {
  const hotels = parseHotels(FOR_3);

  it("keeps the hotels and leaves the rentals to Airbnb", () => {
    const names = hotels.map((h) => h.name);
    expect(names).toContain("Generator Barcelona");
    expect(names).not.toContain("COMFORTABLE APARTMENT CLOSE TO BUNKERS DEL CARMEL!");
    expect(names).not.toContain("Triple room with balcony");
    expect(hotels.length).toBeLessThan(FOR_3.length);
  });

  it("reads a hotel: what the stay costs in all, its rating, reviews, stars and amenities", () => {
    const generator = hotels.find((h) => h.name === "Generator Barcelona")!;
    expect(generator).toMatchObject({ totalEur: 278, rating: 4.5, reviewCount: 9290, stars: 1 });
    expect(generator.amenities).toEqual(expect.arrayContaining(["Breakfast", "Free Wi-Fi", "Parking"]));
    expect(generator.entityId).toMatch(/^Chk/);
    expect(generator.photos.length).toBeGreaterThan(0);
  });

  it("reads the total for the stay, not the price of a night", () => {
    // 69 € a night for 4 nights, with taxes and fees: 278 €
    expect(hotels.find((h) => h.name === "Generator Barcelona")!.totalEur).toBe(278);
  });
});

describe("parseHotels: what is not a list of results", () => {
  const card = (over: Partial<RawHotelCard>): RawHotelCard => ({ name: "Hotel A", priceLabel: null, ratingLabel: null, amenitiesLabel: null, text: "Hotel A€90€360 total4 nights", entityId: null, photos: [], ...over });

  it("is empty for no results", () => {
    expect(parseHotels([])).toEqual([]);
  });

  it("leaves out a result whose price cannot be read, and one with no name", () => {
    expect(parseHotels([card({ text: "Hotel A sold out" }), card({ name: "" })])).toEqual([]);
  });

  it("says the page changed when nothing looks like a result", () => {
    expect(() => parseHotels([{ nope: 1 } as unknown as RawHotelCard])).toThrow(ScrapeChangedError);
  });

  it("reads thousands with a comma", () => {
    expect(parseHotels([card({ text: "Hotel A€290€1,160 total4 nights" })])[0].totalEur).toBe(1160);
  });
});

const config: GoogleHotelsSettings = { ...googleHotels };
const now = () => new Date("2026-10-20T10:00:00Z");
const query = (over: Partial<StayQuery> = {}): StayQuery => ({
  destination: { id: "d", label: "Barcelona, Spain", lat: 41.39, lon: 2.17, airports: ["BCN"] },
  window: { from: "2026-12-22", to: "2026-12-26" },
  groupSize: 3,
  ...over,
});

/** A fake browser: the captured results for a party of 3, of 2, and nothing for any other. */
function fakeDriver() {
  const driver = vi.fn<HotelsDriver>(async (url) => {
    const ts = new URL(url).searchParams.get("ts");
    if (ts === tsParam(3, "2026-12-22", "2026-12-26")) return FOR_3;
    if (ts === tsParam(2, "2026-12-22", "2026-12-26")) return FOR_2;
    return [];
  });
  return driver;
}
const adapterWith = (driver: HotelsDriver, settings = config) => createGoogleHotelsAdapter({ driver, config: settings, now });

describe("the Google Hotels adapter", () => {
  it("offers the hotels for the group, as the hotel column's offers, with the price of the whole stay", async () => {
    const driver = fakeDriver();
    const offers = await adapterWith(driver).search(query());

    expect(driver).toHaveBeenCalledTimes(1);
    expect(offers.length).toBeGreaterThan(5);
    expect(offers[0]).toMatchObject({
      provider: "booking",
      title: "Generator Barcelona",
      capacity: 3,
      rooms: 1,
      beds: null,
      checkIn: "2026-12-22",
      checkOut: "2026-12-26",
      totalPriceEur: 278,
      rating: 4.5,
    });
    expect(offers[0].raw).toMatchObject({ source: "google-hotels", reviewCount: 9290, propertyType: "1-star hotel", roomPlan: [3] });
    expect(new URL(offers[0].url!).searchParams.get("q")).toBe("Generator Barcelona Barcelona, Spain");
  });

  it("keeps no more than it is allowed", async () => {
    expect(await adapterWith(fakeDriver(), { ...config, maxResults: 4 }).search(query())).toHaveLength(4);
  });

  it("puts a group of 4 in two rooms of 2: one search, and the price of two rooms", async () => {
    const driver = fakeDriver();
    const offers = await adapterWith(driver).search(query({ groupSize: 4 }));
    expect(driver).toHaveBeenCalledTimes(1);
    expect(offers[0]).toMatchObject({ capacity: 4, rooms: 2 });
    const generatorFor2 = parseHotels(FOR_2).find((h) => h.name === offers[0].title)!;
    expect(offers[0].totalPriceEur).toBe(generatorFor2.totalEur * 2);
    expect(offers[0].raw).toMatchObject({ roomPlan: [2, 2], roomPrices: [generatorFor2.totalEur, generatorFor2.totalEur] });
  });

  it("puts 5 in a room of 3 and a room of 2, and keeps only the hotels that have both", async () => {
    const driver = fakeDriver();
    const offers = await adapterWith(driver).search(query({ groupSize: 5 }));
    expect(driver).toHaveBeenCalledTimes(2);
    const three = new Map(parseHotels(FOR_3).map((h) => [h.name, h.totalEur]));
    const two = new Map(parseHotels(FOR_2).map((h) => [h.name, h.totalEur]));
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) expect(offer.totalPriceEur).toBe(three.get(offer.title)! + two.get(offer.title)!);
    expect(offers.every((o) => o.rooms === 2 && o.capacity === 5)).toBe(true);
  });

  it("finds nothing when Google lists no hotel for the party, or for days already gone", async () => {
    // The fake lists hotels for parties of 2 and 3 only
    expect(await adapterWith(fakeDriver()).search(query({ groupSize: 1 }))).toEqual([]);
    const driver = fakeDriver();
    expect(await adapterWith(driver).search(query({ window: { from: "2026-10-20", to: "2026-10-26" } }))).toEqual([]);
    expect(driver).not.toHaveBeenCalled();
  });

  it("lets the browser's failure through as it is", async () => {
    const slow: HotelsDriver = async () => {
      throw new ScrapeError("Google Hotels did not show its results in time");
    };
    await expect(adapterWith(slow).search(query())).rejects.toMatchObject({ retryable: true });
  });
});

describe("the Google Hotels adapter and empty answers", () => {
  it("does not keep 'no hotel' for a day: it may only be a page that did not load", async () => {
    const keep: boolean[] = [];
    const cache: ScrapeCache = {
      async remember(_key, _source, _ttl, produce, options) {
        const value = await produce();
        keep.push(options?.keepIf ? options.keepIf(value) : true);
        return value;
      },
    };
    await adapterWith(vi.fn<HotelsDriver>(async () => []) ).search(query({ cache }));
    expect(keep).toEqual([false]);
    await adapterWith(fakeDriver()).search(query({ cache }));
    expect(keep).toEqual([false, true]);
  });
});

describe("the Google Hotels adapter and the cache", () => {
  it("does not ask Google again for what it answered a moment ago, and asks again when told to", async () => {
    const kept = new Map<string, unknown>();
    const cache: ScrapeCache = {
      async remember(key, _source, _ttl, produce, options) {
        if (!options?.refresh && kept.has(key)) return kept.get(key) as never;
        const value = await produce();
        kept.set(key, JSON.parse(JSON.stringify(value)));
        return value;
      },
    };
    const driver = fakeDriver();
    const adapter = adapterWith(driver);
    const first = await adapter.search(query({ cache }));
    expect(await adapter.search(query({ cache }))).toEqual(first);
    expect(driver).toHaveBeenCalledTimes(1);
    await adapter.search(query({ cache, refresh: true }));
    expect(driver).toHaveBeenCalledTimes(2);
  });
});

describe("for the Extra (task.md T8.2): where each hotel is, its amenities, the tax", () => {
  // Cut from the page Google served for Barcelona on 2026-11-14: each hotel's record starts with its name and position
  const positions = hotelPositions(readFileSync(path.join(process.cwd(), "tests/fixtures/google-hotels/barcelona-positions.txt"), "utf8"));

  it("reads each hotel's position from the page's data, by its name", () => {
    expect(positions.get("Generator Barcelona")).toEqual({ lat: 41.399238499999996, lon: 2.1625606 });
    expect(positions.get("Hotel SB | Plaça Europa")).toEqual({ lat: 41.359122, lon: 2.132418 });
    expect(positions.get("Casa Gràcia")).toEqual({ lat: 41.397282, lon: 2.1591953999999998 });
    expect(positions.size).toBe(5);
  });

  it("finds a name written a little differently, and nothing for a hotel the data does not have", () => {
    expect(positionFor("CASA GRACIA", positions)).toEqual(positions.get("Casa Gràcia"));
    expect(positionFor("Hotel Nowhere", positions)).toBeNull();
  });

  it("keeps the position, every amenity, the distance from the centre, and the tax as included by Google's policy", async () => {
    const withPositions = vi.fn<HotelsDriver>(async () => FOR_3.map((card) => ({ ...card, position: positionFor(card.name, positions) })));
    const offers = await adapterWith(withPositions).search(query());
    const generator = offers.find((offer) => offer.title === "Generator Barcelona")!.raw as Record<string, unknown>;
    expect(generator).toMatchObject({ lat: 41.399238499999996, lon: 2.1625606, touristTax: { included: true, basis: "google-policy" } });
    expect(generator.distanceKm).toEqual(expect.any(Number));
    expect(generator.amenities).toEqual(expect.arrayContaining(["Breakfast", "Free Wi-Fi", "Parking"]));
    expect((generator.badges as string[]).length).toBeLessThanOrEqual(8);
    // A hotel the page's data did not place has no position, and no distance
    expect(offers.find((offer) => offer.title === "TOC Barcelona")!.raw).toMatchObject({ lat: null, lon: null, distanceKm: null });
  });

  it("keeps what it read under a new key, so hotels read before are read again with their position", async () => {
    const keys: string[] = [];
    const cache: ScrapeCache = { remember: async (key, _source, _ttl, produce) => (keys.push(key), produce()) };
    await adapterWith(fakeDriver()).search(query({ cache }));
    expect(keys.every((key) => key.startsWith("hotels|v2|"))).toBe(true);
  });
});
