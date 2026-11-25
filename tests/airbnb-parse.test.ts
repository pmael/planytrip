import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cardOf,
  collectedTaxesOf,
  isWholePlace,
  listingIdOf,
  parseEuroAmount,
  parseListingPage,
  parseSearchPage,
  ratingOf,
  sleepingOf,
  totalPriceOf,
} from "@/scrapers/stays/airbnb-parse";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests/fixtures/airbnb", name), "utf8");

describe("parseEuroAmount", () => {
  it("reads the ways the site writes euros", () => {
    expect(parseEuroAmount("€1,593")).toBe(1593);
    expect(parseEuroAmount("€1,742.34")).toBe(1742);
    expect(parseEuroAmount("1.593 €")).toBe(1593);
    expect(parseEuroAmount("€ 1 593")).toBe(1593);
    expect(parseEuroAmount("€900")).toBe(900);
    expect(parseEuroAmount("€1,000,000")).toBe(1_000_000);
    expect(parseEuroAmount("€12.50")).toBe(13);
  });

  it("refuses what is not in euros, or not an amount", () => {
    expect(parseEuroAmount("$1,593")).toBeNull();
    expect(parseEuroAmount("£900")).toBeNull();
    expect(parseEuroAmount("€")).toBeNull();
    expect(parseEuroAmount("free")).toBeNull();
    expect(parseEuroAmount(null)).toBeNull();
  });
});

describe("totalPriceOf", () => {
  it("takes the amount before the word total, discounted price first", () => {
    expect(totalPriceOf("€1,593 total, originally €1,742")).toBe(1593);
    expect(totalPriceOf("€2,381 total")).toBe(2381);
  });

  it("does not take a price per night for the price of the stay", () => {
    expect(totalPriceOf("€176 per night, €1,768 total")).toBe(1768);
    expect(totalPriceOf("€176 per night")).toBeNull();
  });

  it("is null without a total, or in another currency", () => {
    expect(totalPriceOf(null)).toBeNull();
    expect(totalPriceOf("$1,593 total")).toBeNull();
  });
});

describe("ratingOf", () => {
  it("reads the rating and the number of reviews", () => {
    expect(ratingOf("4.84 (2910)")).toEqual({ rating: 4.84, reviewCount: 2910 });
    expect(ratingOf("5.0 (5)")).toEqual({ rating: 5, reviewCount: 5 });
    expect(ratingOf("4,9 (1.234)")).toEqual({ rating: 4.9, reviewCount: 1234 });
    expect(ratingOf("4.7")).toEqual({ rating: 4.7, reviewCount: null });
  });

  it("has none for a listing that is new", () => {
    expect(ratingOf("New")).toEqual({ rating: null, reviewCount: null });
    expect(ratingOf(null)).toEqual({ rating: null, reviewCount: null });
  });
});

describe("sleepingOf", () => {
  it("reads bedrooms, beds and bathrooms out of the card's lines", () => {
    expect(sleepingOf(["2 bedrooms", "4 single beds", "1 bath"])).toEqual({ bedrooms: 2, beds: 4, bathrooms: 1 });
    expect(sleepingOf(["1 bedroom", "2 beds", "1.5 baths"])).toEqual({ bedrooms: 1, beds: 2, bathrooms: 1.5 });
    expect(sleepingOf(["Studio", "1 double bed"])).toEqual({ bedrooms: 0, beds: 1, bathrooms: null });
  });

  it("does not take bedrooms for beds, and leaves out what is not there", () => {
    expect(sleepingOf(["3 bedrooms"])).toEqual({ bedrooms: 3, beds: null, bathrooms: null });
    expect(sleepingOf([])).toEqual({ bedrooms: null, beds: null, bathrooms: null });
  });
});

describe("listingIdOf", () => {
  it("decodes Airbnb's listing id", () => {
    expect(listingIdOf(Buffer.from("DemandStayListing:1161417").toString("base64"))).toBe("1161417");
  });

  it("gives null for anything else", () => {
    expect(listingIdOf(null)).toBeNull();
    expect(listingIdOf("not base64 of a listing")).toBeNull();
    expect(listingIdOf(Buffer.from("Other:12").toString("base64"))).toBeNull();
  });
});

describe("parseSearchPage on a page captured from Airbnb", () => {
  const page = parseSearchPage(fixture("search-barcelona.html"));

  it("finds the listings and leaves out the apartment complexes, whose price is for one of several kinds of unit", () => {
    expect(page.kind).toBe("results");
    if (page.kind !== "results") return;
    // 6 results on the page: 2 are "N apartments available"
    expect(page.cards).toHaveLength(4);
    expect(page.skipped).toBe(2);
    expect(page.cards.map((c) => c.id)).toEqual(["1624228269452785304", "1161417", "10276293", "1789800738325034649"]);
  });

  it("reads each listing: the total for the dates, rating, bedrooms and beds, host, photos and where it is", () => {
    if (page.kind !== "results") throw new Error("no results");
    const gracia = page.cards.find((c) => c.id === "1161417")!;
    expect(gracia).toMatchObject({
      name: "Amazing apartment in Gracia",
      placeType: "Apartment in Barcelona",
      totalPriceEur: 1743,
      rating: 4.54,
      reviewCount: 621,
      bedrooms: 2,
      beds: 4,
      bathrooms: 1,
      hostType: "Individual host",
    });
    expect(gracia.photos.length).toBeGreaterThan(0);
    expect(gracia.photos.every((url) => url.startsWith("https://"))).toBe(true);
    expect(gracia.lat).toBeCloseTo(41.4, 0);
    expect(gracia.lon).toBeCloseTo(2.17, 0);
  });

  it("reads a listing with no discount and one that is new", () => {
    if (page.kind !== "results") throw new Error("no results");
    expect(page.cards.find((c) => c.id === "10276293")!.totalPriceEur).toBe(2381);
    const fresh = page.cards.find((c) => c.id === "1789800738325034649")!;
    expect(fresh).toMatchObject({ totalPriceEur: 1577, rating: null, reviewCount: null, bedrooms: 1, beds: 2 });
  });

  it("gives the cursors of the next pages", () => {
    if (page.kind !== "results") throw new Error("no results");
    expect(page.pageCursors).toHaveLength(3);
    expect(Buffer.from(page.pageCursors[1], "base64").toString()).toContain('"items_offset":18');
  });
});

describe("parseSearchPage on the layout Airbnb serves now (beds in the map's line, host in the first)", () => {
  const page = parseSearchPage(fixture("search-barcelona-new-layout.html"));

  it("finds the same facts in the lines wherever the layout puts them", () => {
    if (page.kind !== "results") throw new Error("no results");
    // 6 results: one is an apartment complex
    expect(page.cards).toHaveLength(5);
    expect(page.skipped).toBe(1);
    const monalisa = page.cards.find((c) => c.id === "1624228269452785304")!;
    expect(monalisa).toMatchObject({ name: "Monalisa Apartment", totalPriceEur: 1593, rating: 5, bedrooms: 2, beds: 4, bathrooms: 1, hostType: "Individual host", placeType: null });
  });

  it("reads a business host, and a listing whose lines are repeated and name no host", () => {
    if (page.kind !== "results") throw new Error("no results");
    expect(page.cards.find((c) => c.id === "10276293")).toMatchObject({ hostType: "Business host", bedrooms: 2, beds: 3, totalPriceEur: 2381 });
    expect(page.cards.find((c) => c.name === "Historic Charm in city center")).toMatchObject({ hostType: null, bedrooms: 2, beds: 3, bathrooms: 2, totalPriceEur: 5000 });
  });

  it("gives the same listing the same facts as the older layout does", () => {
    const old = parseSearchPage(fixture("search-barcelona.html"));
    if (page.kind !== "results" || old.kind !== "results") throw new Error("no results");
    const [a, b] = [page, old].map((p) => (p.kind === "results" ? p.cards.find((c) => c.id === "1161417")! : null));
    expect(a).toMatchObject({ name: b!.name, totalPriceEur: b!.totalPriceEur, rating: b!.rating, bedrooms: b!.bedrooms, beds: b!.beds, bathrooms: b!.bathrooms, hostType: b!.hostType });
  });

  it("does not take a rating without a count for a count: that comes from the listing's own page", () => {
    if (page.kind !== "results") throw new Error("no results");
    expect(page.cards.find((c) => c.id === "1161417")).toMatchObject({ rating: 4.54, reviewCount: null });
  });
});

describe("parseSearchPage on pages that are not results", () => {
  it("says a page with data but no search is not something the site sells (dates too far ahead)", () => {
    expect(parseSearchPage(fixture("no-search.html"))).toEqual({ kind: "no-search" });
  });

  it("recognises a page that turns the visitor away", () => {
    expect(parseSearchPage(fixture("blocked.html"))).toEqual({ kind: "blocked" });
  });

  it("does not take a page it does not understand for a refusal", () => {
    expect(parseSearchPage(fixture("unknown.html"))).toEqual({ kind: "unknown" });
  });

  it("does not take the word 'captcha' in the code of a normal page for a refusal", () => {
    const html = fixture("search-barcelona.html").replace("</body>", "<script>var recaptcha = 'captcha';</script></body>");
    expect(parseSearchPage(html).kind).toBe("results");
  });
});

describe("cardOf", () => {
  const result = (over: object = {}) => ({
    title: "Apartment in Barcelona",
    subtitle: "A flat",
    avgRatingLocalized: "4.5 (10)",
    demandStayListing: { id: Buffer.from("DemandStayListing:42").toString("base64") },
    structuredContent: { primaryLine: [{ body: "2 bedrooms" }, { body: "3 beds" }] },
    structuredDisplayPrice: { primaryLine: { accessibilityLabel: "€900 total" } },
    ...over,
  });

  it("builds a card from the parts it needs", () => {
    expect(cardOf(result())).toMatchObject({ id: "42", name: "A flat", totalPriceEur: 900, bedrooms: 2, beds: 3, rating: 4.5 });
  });

  it("drops a result with no price for the stay, or no listing number", () => {
    expect(cardOf(result({ structuredDisplayPrice: { primaryLine: { accessibilityLabel: "€90 per night" } } }))).toBeNull();
    expect(cardOf(result({ demandStayListing: null }))).toBeNull();
    expect(cardOf("garbage")).toBeNull();
    expect(cardOf(null)).toBeNull();
  });
});

describe("parseListingPage on a page captured from Airbnb", () => {
  it("reads how many people it sleeps, what kind of place it is and its rating", () => {
    expect(parseListingPage(fixture("listing-10276293.html"))).toEqual({
      capacity: 4,
      propertyType: "Entire rental unit",
      rating: 4.92,
      reviewCount: 392,
      name: "Apartment with terrace in Barcelona",
      // An older capture, cut down to the capacity: nothing else is in it
      amenities: [],
      lat: null,
      lon: null,
      hostTax: null,
    });
  });

  it("falls back on what the page's text says when the data has moved", () => {
    const html = '<html><body><script id="other">{"personCapacity":6,"propertyType":"Entire home"}</script></body></html>';
    expect(parseListingPage(html)).toMatchObject({ capacity: 6, propertyType: "Entire home" });
  });

  it("has no capacity, but the rest, when the page has its data and does not say how many it sleeps", () => {
    const html = '<html><body><script id="data-deferred-state-0" type="application/json">{"a":{"embedData":{"name":"Flat","personCapacity":null,"propertyType":"Entire home","starRating":4.5,"reviewCount":3}}}</script></body></html>';
    expect(parseListingPage(html)).toEqual({ capacity: null, propertyType: "Entire home", rating: 4.5, reviewCount: 3, name: "Flat", amenities: [], lat: null, lon: null, hostTax: null });
  });

  it("still reads the amenities, the position and the tax when the capacity is only in the page's text", () => {
    // A real page (Barcelona, 2026-11-14) kept its capacity outside the data the rest is read from
    const state = { niobeClientData: [["x", { data: { node: { pdpPresentation: { amenities: { seeAllAmenitiesGroups: [{ amenities: [{ title: "Microwave", available: true }] }] }, location: { latitude: 41.37, longitude: 2.17 } } } } }]] };
    const html = `<html><body><script id="data-deferred-state-0" type="application/json">${JSON.stringify(state)}</script><script>{"personCapacity":4,"propertyType":"Entire rental unit"}</script></body></html>`;
    expect(parseListingPage(html)).toMatchObject({ capacity: 4, amenities: ["Microwave"], lat: 41.37, lon: 2.17 });
  });

  it("treats a star rating of 0 as no rating: that is how a listing with no review yet is described", () => {
    const html = '<html><body><script id="data-deferred-state-0" type="application/json">{"a":{"embedData":{"name":"New","personCapacity":4,"propertyType":"Entire home","starRating":0,"reviewCount":0}}}</script></body></html>';
    expect(parseListingPage(html)).toMatchObject({ rating: null, reviewCount: 0, capacity: 4 });
  });

  it("is null for a page with nothing about the place", () => {
    expect(parseListingPage(fixture("unknown.html"))).toBeNull();
  });
});

describe("isWholePlace", () => {
  it("is true for an entire home, whatever its kind", () => {
    expect(isWholePlace("Entire rental unit")).toBe(true);
    expect(isWholePlace("Entire home")).toBe(true);
    expect(isWholePlace("Entire villa")).toBe(true);
  });

  it("is false for a room, private or shared, or a hotel room", () => {
    expect(isWholePlace("Private room in rental unit")).toBe(false);
    expect(isWholePlace("Shared room in hostel")).toBe(false);
    expect(isWholePlace("Room in boutique hotel")).toBe(false);
  });

  it("goes by the card's title when the page says nothing", () => {
    expect(isWholePlace(null, "Apartment in Barcelona")).toBe(true);
    expect(isWholePlace(null, "Rental unit in Gràcia")).toBe(true);
    expect(isWholePlace(null, "Room in Barcelona")).toBe(false);
    expect(isWholePlace(null, "Private room in home")).toBe(false);
    expect(isWholePlace(null, "Hotel room in Barcelona")).toBe(false);
  });
});

// ── For the Extra (task.md T8.2): pages captured on 2026-11-14, for 3 adults, 10 to 14 March 2027 ──────────────────

describe("the taxes Airbnb collects itself, in a search result's price details", () => {
  it("reads Paris' \"Taxes\" line: Airbnb collects the tax there, and the total already has it", () => {
    const page = parseSearchPage(fixture("search-paris-taxes.html"));
    if (page.kind !== "results") throw new Error(page.kind);
    expect(page.cards.map((card) => [card.id, card.totalPriceEur, card.taxesEur])).toEqual([
      ["1168724881261077997", 519, 68],
      ["1048431945097796092", 607, 82],
    ]);
  });

  it("reads it listing by listing: in Barcelona Airbnb collects it for one listing, the hosts of the others do", () => {
    // Captured in October 2026, 10 nights: €199.50 of tax on €1,742.34
    const page = parseSearchPage(fixture("search-barcelona.html"));
    if (page.kind !== "results") throw new Error(page.kind);
    expect(page.cards.map((card) => [card.id, card.taxesEur])).toEqual([
      ["1624228269452785304", null],
      ["1161417", 200],
      ["10276293", null],
      ["1789800738325034649", null],
    ]);
  });

  it("adds up the tax lines and leaves out the rest", () => {
    const line = (description: string, priceString: string) => ({ description, priceString });
    expect(collectedTaxesOf([{ items: [line("4 nights x €112.50", "€450.00"), line("Discount from Airbnb", "-€13.45")] }])).toBeNull();
    expect(collectedTaxesOf([{ items: [line("4 nights x €112.50", "€450.00"), line("Occupancy taxes", "€20.00")] }, { items: [line("City tax", "€5.00")] }])).toBe(25);
    expect(collectedTaxesOf(null)).toBeNull();
  });
});

describe("parseListingPage: what the Extra needs from a Barcelona listing", () => {
  const first = parseListingPage(fixture("listing-barcelona-22234830.html"))!;
  const second = parseListingPage(fixture("listing-barcelona-9306147.html"))!;

  it("reads where it is", () => {
    expect([first.lat, first.lon]).toEqual([41.403, 2.1718]);
    expect([second.lat, second.lon]).toEqual([41.4044, 2.17445]);
  });

  it("keeps the amenities it has, not those Airbnb lists as missing", () => {
    expect(first.amenities).toEqual(expect.arrayContaining(["Kitchen", "Washer", "Air conditioning", "Wifi", "Elevator"]));
    expect(first.amenities).not.toContain("Smoke alarm");
    expect(first.amenities).toHaveLength(22);
  });

  it("reads that the tourist tax is paid at check-in, with the host's rate and the 7-night cap", () => {
    expect(first.hostTax).toMatchObject({ included: false, perPersonNightEur: 10.45, maxNights: 7, basis: "host-says-not-included" });
    expect(first.hostTax?.evidence).toMatch(/Tourist Tax in Barcelona/);
    expect(second.hostTax).toMatchObject({ included: false, perPersonNightEur: 9.5, basis: "host-says-not-included" });
    expect(second.hostTax?.evidence).toMatch(/paid at check-in/);
  });
});
