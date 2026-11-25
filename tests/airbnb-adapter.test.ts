import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { airbnb } from "@/config";
import type { FetchedPage, PageFetcher } from "@/scrapers/browser";
import { ScrapeBlockedError, ScrapeChangedError, ScrapeError, ScrapeUnavailableError } from "@/scrapers/errors";
import { createAirbnbAdapter, listingUrl, searchUrl, shortlistOf, type AirbnbSettings } from "@/scrapers/stays/airbnb";
import type { ListingCard } from "@/scrapers/stays/airbnb-parse";
import type { ScrapeCache, StayQuery } from "@/scrapers/types";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests/fixtures/airbnb", name), "utf8");
const SEARCH = fixture("search-barcelona.html");

/** The four listings of the captured search page, and what each one's own page would say. */
const IDS = { monalisa: "1624228269452785304", gracia: "1161417", terrace: "10276293", studio: "1789800738325034649" };

function listingPage(capacity: number | null, propertyType = "Entire rental unit", name?: string) {
  const embed = { personCapacity: capacity, propertyType, name: name ?? null, starRating: 4.7, reviewCount: 120 };
  const state = { niobeClientData: [["x", { data: { stay: { embedData: embed } } }]] };
  return `<html><head><title>t</title></head><body><script id="data-deferred-state-0" type="application/json">${JSON.stringify(state)}</script></body></html>`;
}

const page = (html: string, status = 200): FetchedPage => ({ status, html, title: "" });

type Pages = { search?: () => FetchedPage; listings?: Record<string, () => FetchedPage> };

/** A fake browser: searches give the captured page, a listing gives what `pages.listings` says. */
function fakeFetcher({ search = () => page(SEARCH), listings = {} }: Pages = {}) {
  const urls: string[] = [];
  const fetchPage: PageFetcher = vi.fn(async (url: string) => {
    urls.push(url);
    if (url.includes("/s/homes")) return search();
    const id = /\/rooms\/(\d+)/.exec(url)?.[1] ?? "";
    const respond = listings[id];
    if (!respond) throw new ScrapeError(`no such listing ${id}`);
    return respond();
  });
  return { fetchPage, urls };
}

const capacities = (map: Record<string, number>): Record<string, () => FetchedPage> =>
  Object.fromEntries(Object.entries(map).map(([id, capacity]) => [id, () => page(listingPage(capacity))]));

const query = (over: Partial<StayQuery> = {}): StayQuery => ({
  destination: { id: "d", label: "Barcelona", lat: 41.3874, lon: 2.1686, airports: ["BCN"] },
  window: { from: "2027-08-26", to: "2027-09-05" },
  groupSize: 3,
  ...over,
});

const config: AirbnbSettings = { ...airbnb, minListings: 2, minCards: 3 };
const adapterWith = (pages: Pages, settings: AirbnbSettings = config) => {
  const fetcher = fakeFetcher(pages);
  return { adapter: createAirbnbAdapter({ fetchPage: fetcher.fetchPage, config: settings }), ...fetcher };
};

describe("searchUrl", () => {
  const url = new URL(searchUrl("https://www.airbnb.com", { lat: 41.3874, lon: 2.1686, radiusKm: 6 }, { from: "2027-08-26", to: "2027-09-05", guests: 3 }));

  it("asks for the group's dates, the group's size, whole homes only, in euros", () => {
    expect(url.pathname).toBe("/s/homes");
    expect(url.searchParams.get("checkin")).toBe("2027-08-26");
    expect(url.searchParams.get("checkout")).toBe("2027-09-05");
    expect(url.searchParams.get("adults")).toBe("3");
    expect(url.searchParams.getAll("room_types[]")).toEqual(["Entire home/apt"]);
    expect(url.searchParams.get("currency")).toBe("EUR");
  });

  it("searches a box around the destination's coordinates, not a name", () => {
    expect(url.searchParams.get("search_by_map")).toBe("true");
    const [ne, sw] = [Number(url.searchParams.get("ne_lat")), Number(url.searchParams.get("sw_lat"))];
    expect((ne + sw) / 2).toBeCloseTo(41.3874, 3);
    expect(ne - sw).toBeCloseTo(12 / 111, 2);
    expect(url.searchParams.has("query")).toBe(false);
  });

  it("asks for a later page with its cursor", () => {
    const next = new URL(searchUrl("https://www.airbnb.com", { lat: 1, lon: 1, radiusKm: 6 }, { from: "a", to: "b", guests: 2 }, "CURSOR"));
    expect(next.searchParams.get("cursor")).toBe("CURSOR");
  });
});

describe("listingUrl", () => {
  it("opens the listing on the group's dates and size", () => {
    expect(listingUrl("https://www.airbnb.com", "42", { from: "2027-08-26", to: "2027-09-05", guests: 3 })).toBe(
      "https://www.airbnb.com/rooms/42?check_in=2027-08-26&check_out=2027-09-05&adults=3",
    );
  });
});

describe("shortlistOf", () => {
  const card = (id: string, totalPriceEur: number, rating: number | null, reviewCount = 10) => ({ id, totalPriceEur, rating, reviewCount }) as ListingCard;

  it("takes the cheapest and the best rated in turn, so the short list has both", () => {
    const cards = [card("cheap", 500, 3.9), card("mid", 900, 4.5), card("best", 1500, 4.95), card("new", 600, null, 0)];
    expect(shortlistOf(cards, 3).map((c) => c.id)).toEqual(["cheap", "best", "new"]);
  });

  it("does not repeat a listing that is both, and respects the limit", () => {
    const cards = [card("both", 500, 4.9), card("b", 700, 4.5), card("c", 900, 4.0)];
    expect(shortlistOf(cards, 10).map((c) => c.id)).toEqual(["both", "b", "c"]);
    expect(shortlistOf(cards, 2)).toHaveLength(2);
  });
});

describe("the Airbnb adapter", () => {
  it("returns whole homes with the total for the dates, how many they sleep and a link that opens on those dates", async () => {
    const { adapter } = adapterWith({ listings: capacities({ [IDS.monalisa]: 4, [IDS.gracia]: 4, [IDS.terrace]: 4, [IDS.studio]: 3 }) });
    const options = await adapter.search(query());

    expect(options).toHaveLength(4);
    const gracia = options.find((o) => o.externalId === IDS.gracia)!;
    expect(gracia).toMatchObject({
      provider: "airbnb",
      title: "Amazing apartment in Gracia",
      capacity: 4,
      rooms: 2,
      beds: 4,
      checkIn: "2027-08-26",
      checkOut: "2027-09-05",
      totalPriceEur: 1743,
      rating: 4.7,
      reviewsSample: null,
      url: `https://www.airbnb.com/rooms/${IDS.gracia}?check_in=2027-08-26&check_out=2027-09-05&adults=3`,
    });
    expect(gracia.photos.length).toBeGreaterThan(0);
    expect(gracia.raw).toMatchObject({ source: "airbnb", reviewCount: 120, hostType: "Individual host", bathrooms: 1, capacityKnown: true });
    expect((gracia.raw as { distanceKm: number }).distanceKm).toBeLessThan(10);
  });

  it("puts a title on one line: hosts put line breaks in them", async () => {
    const { adapter } = adapterWith({ listings: { ...capacities({ [IDS.gracia]: 4, [IDS.terrace]: 4, [IDS.studio]: 4 }), [IDS.monalisa]: () => page(listingPage(4, "Entire rental unit", "The studio\n  for 4 people\nGarden ")) } });
    const options = await adapter.search(query());
    expect(options.find((o) => o.externalId === IDS.monalisa)!.title).toBe("The studio for 4 people Garden");
  });

  it("keeps places for 3 or 4 people for a group of 3, and leaves out one for 6 when enough fit", async () => {
    const { adapter } = adapterWith({ listings: capacities({ [IDS.monalisa]: 4, [IDS.gracia]: 6, [IDS.terrace]: 4, [IDS.studio]: 3 }) });
    const options = await adapter.search(query());
    expect(options.map((o) => o.capacity).sort()).toEqual([3, 4, 4]);
    expect(options.map((o) => o.externalId)).not.toContain(IDS.gracia);
  });

  it("widens the band rather than offer too little: places for 6 are kept when too few fit 3 or 4", async () => {
    const { adapter } = adapterWith(
      { listings: capacities({ [IDS.monalisa]: 4, [IDS.gracia]: 6, [IDS.terrace]: 6, [IDS.studio]: 6 }) },
      { ...config, minListings: 3 },
    );
    expect((await adapter.search(query())).map((o) => o.capacity).sort()).toEqual([4, 6, 6, 6]);
  });

  it("never offers a place that sleeps fewer than the group, however the band is widened", async () => {
    const { adapter } = adapterWith(
      { listings: capacities({ [IDS.monalisa]: 2, [IDS.gracia]: 2, [IDS.terrace]: 4, [IDS.studio]: 1 }) },
      { ...config, minListings: 4 },
    );
    expect((await adapter.search(query())).map((o) => o.capacity)).toEqual([4]);
  });

  it("leaves out anything that is not a whole home, even when the search let it through", async () => {
    const { adapter } = adapterWith({
      listings: {
        ...capacities({ [IDS.monalisa]: 4, [IDS.terrace]: 4 }),
        [IDS.gracia]: () => page(listingPage(4, "Private room in rental unit")),
        [IDS.studio]: () => page(listingPage(4, "Shared room in hostel")),
      },
    });
    expect((await adapter.search(query())).map((o) => o.externalId).sort()).toEqual([IDS.monalisa, IDS.terrace].sort());
  });

  it("takes a listing that does not say how many it sleeps at its word from the search: at least the group", async () => {
    const { adapter } = adapterWith({ listings: { ...capacities({ [IDS.monalisa]: 4, [IDS.terrace]: 4, [IDS.studio]: 3 }), [IDS.gracia]: () => page(listingPage(null)) } });
    const unknown = (await adapter.search(query())).find((o) => o.externalId === IDS.gracia)!;
    expect(unknown.capacity).toBe(3);
    expect((unknown.raw as { capacityKnown: boolean }).capacityKnown).toBe(false);
  });

  it("searches for the group's dates and size, in a box around the destination", async () => {
    const { adapter, urls } = adapterWith({ listings: capacities({ [IDS.monalisa]: 4, [IDS.gracia]: 4, [IDS.terrace]: 4, [IDS.studio]: 4 }) });
    await adapter.search(query({ groupSize: 4, window: { from: "2027-09-01", to: "2027-09-04" } }));
    const first = new URL(urls[0]);
    expect(first.searchParams.get("adults")).toBe("4");
    expect(first.searchParams.get("checkin")).toBe("2027-09-01");
    expect(first.searchParams.get("checkout")).toBe("2027-09-04");
  });

  it("reads the second page of results with the cursor the first one gave", async () => {
    const { adapter, urls } = adapterWith({ listings: capacities({ [IDS.monalisa]: 4, [IDS.gracia]: 4, [IDS.terrace]: 4, [IDS.studio]: 4 }) });
    await adapter.search(query());
    const searches = urls.filter((u) => u.includes("/s/homes")).map((u) => new URL(u));
    expect(searches).toHaveLength(2);
    expect(searches[0].searchParams.has("cursor")).toBe(false);
    expect(Buffer.from(searches[1].searchParams.get("cursor")!, "base64").toString()).toContain('"items_offset":18');
  });

  it("widens the search box when the area gives too few listings", async () => {
    const { adapter, urls } = adapterWith(
      { listings: capacities({ [IDS.monalisa]: 4, [IDS.gracia]: 4, [IDS.terrace]: 4, [IDS.studio]: 4 }) },
      { ...config, minCards: 5 },
    );
    await adapter.search(query());
    const radii = urls
      .filter((u) => u.includes("/s/homes") && !new URL(u).searchParams.has("cursor"))
      .map((u) => (Number(new URL(u).searchParams.get("ne_lat")) - Number(new URL(u).searchParams.get("sw_lat"))) * 111 / 2);
    expect(radii.map(Math.round)).toEqual([6, 15, 30]);
  });

  it("opens no more listings than the limit, and stops once enough fit", async () => {
    const limited = adapterWith({ listings: capacities({ [IDS.monalisa]: 4, [IDS.gracia]: 4, [IDS.terrace]: 4, [IDS.studio]: 4 }) }, { ...config, detailLimit: 2 });
    await limited.adapter.search(query());
    expect(limited.urls.filter((u) => u.includes("/rooms/"))).toHaveLength(2);

    const enough = adapterWith({ listings: capacities({ [IDS.monalisa]: 4, [IDS.gracia]: 4, [IDS.terrace]: 4, [IDS.studio]: 4 }) }, { ...config, enough: 1 });
    await enough.adapter.search(query());
    expect(enough.urls.filter((u) => u.includes("/rooms/"))).toHaveLength(1);
  });

  it("finds nothing, and asks nothing, for a stay of no night or of nobody", async () => {
    const { adapter, fetchPage } = adapterWith({});
    expect(await adapter.search(query({ window: { from: "2027-08-26", to: "2027-08-26" } }))).toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("asks for at least 1 and at most 16 guests, whatever the group", async () => {
    const { adapter, urls } = adapterWith({ search: () => page(fixture("no-search.html")) });
    for (const groupSize of [0, 40]) await adapter.search(query({ groupSize })).catch(() => undefined);
    expect(urls.map((u) => new URL(u).searchParams.get("adults"))).toEqual(["1", "16"]);
  });

  it("skips a listing it cannot read and keeps the others; only when none can be read does it fail", async () => {
    const some = adapterWith({ listings: { ...capacities({ [IDS.monalisa]: 4, [IDS.terrace]: 4 }), [IDS.gracia]: () => { throw new ScrapeError("timed out"); }, [IDS.studio]: () => { throw new ScrapeError("timed out"); } } });
    expect(await some.adapter.search(query())).toHaveLength(2);

    const none = adapterWith({ listings: {} });
    await expect(none.adapter.search(query())).rejects.toBeInstanceOf(ScrapeError);
  });
});

describe("for the Extra (task.md T8.2): where it is, its amenities, whether the tourist tax is in the price", () => {
  /** A listing page with amenities (one Airbnb lists as missing) and a host who says the tax is paid at check-in */
  function extraPage(hostSays: string) {
    const embed = { personCapacity: 4, propertyType: "Entire rental unit", name: null, starRating: 4.7, reviewCount: 120 };
    const pdpPresentation = {
      amenities: { seeAllAmenitiesGroups: [{ title: "Kitchen and dining", amenities: [{ title: "Kitchen", available: true }] }, { title: "Not included", amenities: [{ title: "Smoke alarm", available: false }] }] },
      location: { latitude: 41.4, longitude: 2.17 },
      descriptions: { longDescriptionHtml: { localizedStringWithTranslationPreference: `Bright flat.<br />${hostSays}` } },
    };
    const state = { niobeClientData: [["x", { data: { node: { pdpPresentation }, stay: { embedData: embed } } }]] };
    return `<html><head><title>t</title></head><body><script id="data-deferred-state-0" type="application/json">${JSON.stringify(state)}</script></body></html>`;
  }
  const atCheckIn = () => page(extraPage("The tourist tax (€6 per person per night) is paid at check-in."));

  it("keeps the position, the amenities it has, and the tax: Airbnb's own Taxes line first, else the host's words", async () => {
    const { adapter } = adapterWith({ listings: { [IDS.monalisa]: atCheckIn, [IDS.gracia]: atCheckIn, [IDS.terrace]: atCheckIn, [IDS.studio]: atCheckIn } });
    const options = await adapter.search(query());
    const raw = (id: string) => options.find((o) => o.externalId === id)!.raw as Record<string, unknown>;

    // Airbnb collects it for this one: the search's price details have "Taxes €199.50", already in the total
    expect(raw(IDS.gracia).touristTax).toMatchObject({ included: true, amountEur: 200, basis: "airbnb-collects" });
    // Not for this one: the host says it is paid at check-in
    expect(raw(IDS.terrace).touristTax).toMatchObject({ included: false, perPersonNightEur: 6, basis: "host-says-not-included" });
    expect(raw(IDS.terrace).amenities).toEqual(["Kitchen"]);
    // The search's own position is kept, and gives the distance
    expect(typeof raw(IDS.terrace).lat).toBe("number");
    expect(raw(IDS.terrace).distanceKm).toEqual(expect.any(Number));
  });

  it("says nothing is known about the tax when neither Airbnb nor the host says, and has no amenities from an older page", async () => {
    const { adapter } = adapterWith({ listings: capacities({ [IDS.monalisa]: 4, [IDS.gracia]: 4, [IDS.terrace]: 4, [IDS.studio]: 3 }) });
    const options = await adapter.search(query());
    const terrace = options.find((o) => o.externalId === IDS.terrace)!.raw as Record<string, unknown>;
    expect(terrace).toMatchObject({ amenities: [], touristTax: { included: null, basis: null } });
  });

  it("keeps a listing's page under a new key, so a page read before is read again for what it now gives", async () => {
    const keys: string[] = [];
    const cache: ScrapeCache = { remember: async (key, _source, _ttl, produce) => (keys.push(key), produce()) };
    const { adapter } = adapterWith({ listings: capacities({ [IDS.monalisa]: 4, [IDS.gracia]: 4, [IDS.terrace]: 4, [IDS.studio]: 3 }) });
    await adapter.search(query({ cache }));
    expect(keys).toContain(`listing|v2|${IDS.gracia}`);
    expect(keys.some((key) => key === `listing|${IDS.gracia}`)).toBe(false);
  });
});

describe("when Airbnb does not answer as hoped", () => {
  it("says dates it does not sell yet are not an outage, and not worth retrying", async () => {
    const { adapter } = adapterWith({ search: () => page(fixture("no-search.html")) });
    const error = await adapter.search(query()).catch((e) => e);
    expect(error).toBeInstanceOf(ScrapeUnavailableError);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("these dates");
  });

  it("stops at once when it is turned away, whatever form that takes", async () => {
    for (const response of [page(fixture("blocked.html")), page("", 429), page("", 403)]) {
      const { adapter } = adapterWith({ search: () => response });
      const error = await adapter.search(query()).catch((e) => e);
      expect(error).toBeInstanceOf(ScrapeBlockedError);
      expect(error.retryable).toBe(false);
    }
  });

  it("stops the whole search when a listing's page turns it away", async () => {
    const { adapter } = adapterWith({ listings: { [IDS.monalisa]: () => page("", 429), ...capacities({ [IDS.gracia]: 4, [IDS.terrace]: 4, [IDS.studio]: 4 }) } });
    await expect(adapter.search(query())).rejects.toBeInstanceOf(ScrapeBlockedError);
  });

  it("says when the page is not built as expected: the site changed", async () => {
    const { adapter } = adapterWith({ search: () => page(fixture("unknown.html")) });
    await expect(adapter.search(query())).rejects.toBeInstanceOf(ScrapeChangedError);
  });

  it("is worth retrying when the site has a hiccup", async () => {
    const { adapter } = adapterWith({ search: () => page("", 503) });
    const error = await adapter.search(query()).catch((e) => e);
    expect(error).toBeInstanceOf(ScrapeError);
    expect(error.retryable).toBe(true);
  });
});

describe("the cache", () => {
  /** A cache in memory that counts what it was asked and what it had. */
  function memoryCache() {
    const store = new Map<string, string>();
    const stats = { hits: 0, misses: 0, refreshes: 0 };
    const cache: ScrapeCache = {
      async remember(key, source, _ttl, produce, options) {
        const id = `${source}|${key}`;
        if (options?.refresh) stats.refreshes++;
        else if (store.has(id)) return (stats.hits++, JSON.parse(store.get(id)!));
        stats.misses++;
        const value = await produce();
        store.set(id, JSON.stringify(value));
        return value;
      },
    };
    return { cache, stats };
  }

  const listings = capacities({ [IDS.monalisa]: 4, [IDS.gracia]: 4, [IDS.terrace]: 4, [IDS.studio]: 4 });

  it("does not visit Airbnb again for what it has just read", async () => {
    const { cache } = memoryCache();
    const { adapter, fetchPage } = adapterWith({ listings });
    const first = await adapter.search(query({ cache }));
    const visits = vi.mocked(fetchPage).mock.calls.length;
    const second = await adapter.search(query({ cache }));

    expect(vi.mocked(fetchPage).mock.calls.length).toBe(visits);
    expect(second).toEqual(first);
  });

  it("visits it again when asked to refresh", async () => {
    const { cache } = memoryCache();
    const { adapter, fetchPage } = adapterWith({ listings });
    await adapter.search(query({ cache }));
    const visits = vi.mocked(fetchPage).mock.calls.length;
    await adapter.search(query({ cache, refresh: true }));
    expect(vi.mocked(fetchPage).mock.calls.length).toBe(visits * 2);
  });

  it("does not keep a failure: the next try asks again", async () => {
    const { cache } = memoryCache();
    let calls = 0;
    const { adapter } = adapterWith({ search: () => (++calls === 1 ? page("", 503) : page(SEARCH)), listings });
    await expect(adapter.search(query({ cache }))).rejects.toBeInstanceOf(ScrapeError);
    expect(await adapter.search(query({ cache }))).toHaveLength(4);
  });
});
