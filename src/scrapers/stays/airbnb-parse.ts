// Reading Airbnb's pages. Pure: it is given the HTML a browser fetched and gives back plain data, so
// it is tested on saved pages and nothing here touches the network or a browser.
//
// Airbnb is a web app: the first screen of results is already inside the page, as JSON in a
// `<script id="data-deferred-state-0">`. That is what is read, rather than the screen's markup,
// which changes far more often.
import { z } from "zod";
import { hostTaxStatement, type StayTaxFinding } from "./stay-tax";

// ── The page as a whole ─────────────────────────────────────────────────────

/** The JSON Airbnb embeds in its pages, or null when the page has none. */
export function deferredStateOf(html: string): unknown | null {
  const match = /<script[^>]*id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** Words a page that turns visitors away uses. They also appear in the code of a normal page, so they only count on a page with no data. */
const BLOCK_HINT = /captcha|are you a (?:robot|human)|verify (?:you are|that you)|access denied|unusual traffic|pardon the interruption/i;

export type SearchPage =
  /** Results: possibly none, when nothing is offered for what was asked */
  | { kind: "results"; cards: ListingCard[]; skipped: number; pageCursors: string[] }
  /** A page with data but no search in it: what was asked is not something it sells (dates too far ahead) */
  | { kind: "no-search" }
  /** The site asked for proof of being human */
  | { kind: "blocked" }
  /** Not a page this reader understands: the site changed */
  | { kind: "unknown" };

// ── A listing on the results page ───────────────────────────────────────────

export type ListingCard = {
  /** Airbnb's number for the listing, as in airbnb.com/rooms/<id> */
  id: string;
  name: string | null;
  /** "Apartment in Barcelona", "Rental unit in Gràcia"... */
  placeType: string | null;
  /** The whole stay for the dates asked, fees included, in euros */
  totalPriceEur: number;
  rating: number | null;
  reviewCount: number | null;
  bedrooms: number | null;
  beds: number | null;
  bathrooms: number | null;
  /** "Individual host", "Business host"... */
  hostType: string | null;
  badges: string[];
  photos: string[];
  lat: number | null;
  lon: number | null;
  /** The "Taxes" line of Airbnb's price details: what it collects itself (the tourist tax), already in the total. null when there is none */
  taxesEur: number | null;
};

const Text = z.string().nullish();

const Message = z.looseObject({ body: Text });

const SearchResultSchema = z.looseObject({
  title: Text,
  subtitle: Text,
  nameLocalized: z.looseObject({ localizedStringWithTranslationPreference: Text }).nullish(),
  avgRatingLocalized: Text,
  demandStayListing: z
    .looseObject({
      id: Text,
      location: z.looseObject({ coordinate: z.looseObject({ latitude: z.number().nullish(), longitude: z.number().nullish() }).nullish() }).nullish(),
      description: z.looseObject({ name: z.looseObject({ localizedStringWithTranslationPreference: Text }).nullish() }).nullish(),
    })
    .nullish(),
  structuredContent: z
    .looseObject({
      primaryLine: z.array(Message).nullish(),
      secondaryLine: z.array(Message).nullish(),
      tertiaryLine: z.array(Message).nullish(),
      mapPrimaryLine: z.array(Message).nullish(),
      mapSecondaryLine: z.array(Message).nullish(),
    })
    .nullish(),
  structuredDisplayPrice: z
    .looseObject({
      primaryLine: z.looseObject({ accessibilityLabel: Text }).nullish(),
      explanationData: z
        .looseObject({ priceDetails: z.array(z.looseObject({ items: z.array(z.looseObject({ description: Text, priceString: Text })).nullish() })).nullish() })
        .nullish(),
    })
    .nullish(),
  badges: z.array(z.looseObject({ text: Text })).nullish(),
  contextualPictures: z.array(z.looseObject({ picture: Text })).nullish(),
});

/** "DemandStayListing:1161417" in base64 → "1161417". Null for anything else. */
export function listingIdOf(encoded: string | null | undefined): string | null {
  if (!encoded) return null;
  try {
    return /^DemandStayListing:(\d+)$/.exec(Buffer.from(encoded, "base64").toString("utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * An amount of euros as the site writes it: "€1,593", "€1,742.34", "1.593 €", "€ 1 593". Null when it is not in euros.
 * A comma or a dot followed by exactly three digits is a thousands separator, otherwise a decimal point.
 */
export function parseEuroAmount(text: string | null | undefined): number | null {
  if (!text || !text.includes("€")) return null;
  const digits = /\d[\d.,\s  ]*\d|\d/.exec(text)?.[0];
  if (!digits) return null;

  const compact = digits.replace(/[\s  ]/g, "");
  const lastSeparator = Math.max(compact.lastIndexOf(","), compact.lastIndexOf("."));
  const afterSeparator = lastSeparator >= 0 ? compact.length - lastSeparator - 1 : 0;
  const isDecimal = lastSeparator >= 0 && afterSeparator !== 3;
  const whole = isDecimal ? compact.slice(0, lastSeparator) : compact;
  const fraction = isDecimal ? compact.slice(lastSeparator + 1) : "";
  const value = Number(`${whole.replace(/[.,]/g, "")}${fraction ? `.${fraction}` : ""}`);
  return Number.isFinite(value) ? Math.round(value) : null;
}

/** The amount written right before the word "total": "€1,593 total, originally €1,742" → 1593; "€176 per night, €1,768 total" → 1768. */
export function totalPriceOf(accessibilityLabel: string | null | undefined): number | null {
  if (!accessibilityLabel) return null;
  const amount = /(€\s*\d[\d.,\s\u00a0\u202f]*|\d[\d.,\s\u00a0\u202f]*\s*€)\s*total\b/i.exec(accessibilityLabel)?.[1];
  return amount ? parseEuroAmount(amount) : null;
}

/** A line of the price details that is a tax Airbnb collects: "Taxes", "Occupancy taxes", "Tourist tax", "City tax" */
const TAX_LINE = /^(?:taxes|occupancy tax(?:es)?|touris[mt]\s+tax(?:es)?|city tax(?:es)?|local tax(?:es)?)$/i;

/** What the price details say Airbnb collects as taxes, in whole euros; null when there is no such line. */
export function collectedTaxesOf(details: { items?: { description?: string | null; priceString?: string | null }[] | null }[] | null | undefined): number | null {
  const amounts = (details ?? [])
    .flatMap((group) => group.items ?? [])
    .filter((item) => TAX_LINE.test((item.description ?? "").trim()))
    .map((item) => parseEuroAmount(item.priceString));
  return amounts.length === 0 || amounts.some((amount) => amount === null) ? null : amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
}

/** "4.84 (2910)" → 4.84 and 2910; "New" → nothing. */
export function ratingOf(text: string | null | undefined): { rating: number | null; reviewCount: number | null } {
  const match = /^\s*(\d(?:[.,]\d+)?)\s*(?:\(\s*([\d.,\s]+)\s*\))?/.exec(text ?? "");
  if (!match) return { rating: null, reviewCount: null };
  const reviews = match[2] ? Number(match[2].replace(/[^\d]/g, "")) : null;
  return { rating: Number(match[1].replace(",", ".")), reviewCount: reviews !== null && Number.isFinite(reviews) ? reviews : null };
}

/** "2 bedrooms", "4 single beds", "1 bath", "Studio" read out of a card's lines. */
export function sleepingOf(lines: string[]): { bedrooms: number | null; beds: number | null; bathrooms: number | null } {
  let bedrooms: number | null = null;
  let beds: number | null = null;
  let bathrooms: number | null = null;
  for (const line of lines.map((l) => l.trim())) {
    if (/^studio$/i.test(line)) bedrooms = 0;
    else if (/^(\d+)\s+bedrooms?$/i.test(line)) bedrooms = Number(/^(\d+)/.exec(line)![1]);
    else if (/^(\d+)\s+(?:[a-z-]+\s+)*beds?$/i.test(line)) beds = Number(/^(\d+)/.exec(line)![1]);
    else if (/^(\d+(?:\.\d+)?)\s+(?:[a-z-]+\s+)*bath(?:room)?s?$/i.test(line)) bathrooms = Number(/^(\d+(?:\.\d+)?)/.exec(line)![1]);
  }
  return { bedrooms, beds, bathrooms };
}

/** An apartment complex ("4 apartments available"): the price is for one of several kinds of unit, not for a place that can be judged. */
const isComplex = (lines: string[]) => lines.some((line) => /\d+\s+apartments?\s+available/i.test(line));

const MAX_PHOTOS = 5;

/** One result of the page as a listing card, or null when it is not one this app can use (no price, a complex...). */
export function cardOf(result: unknown): ListingCard | null {
  const parsed = SearchResultSchema.safeParse(result);
  if (!parsed.success) return null;
  const r = parsed.data;

  const id = listingIdOf(r.demandStayListing?.id);
  const price = totalPriceOf(r.structuredDisplayPrice?.primaryLine?.accessibilityLabel);
  // Airbnb shows the same facts in different lines depending on the layout it serves (the beds are in
  // the first line in one and in the map's line in another), so every line is read and each fact is
  // recognised by how it is written
  const content = r.structuredContent;
  const lines = [content?.primaryLine, content?.secondaryLine, content?.tertiaryLine, content?.mapPrimaryLine, content?.mapSecondaryLine]
    .flatMap((group) => group ?? [])
    .map((message) => message.body ?? "")
    .filter(Boolean);
  if (!id || price === null || price <= 0 || isComplex(lines)) return null;

  const coordinate = r.demandStayListing?.location?.coordinate;
  return {
    id,
    name: r.nameLocalized?.localizedStringWithTranslationPreference ?? r.subtitle ?? r.demandStayListing?.description?.name?.localizedStringWithTranslationPreference ?? null,
    placeType: r.title ?? null,
    totalPriceEur: price,
    ...ratingOf(r.avgRatingLocalized),
    ...sleepingOf(lines),
    hostType: lines.find((line) => /\bhost\b/i.test(line)) ?? null,
    badges: (r.badges ?? []).map((b) => b.text ?? "").filter(Boolean),
    photos: (r.contextualPictures ?? []).map((p) => p.picture ?? "").filter(Boolean).slice(0, MAX_PHOTOS),
    lat: coordinate?.latitude ?? null,
    lon: coordinate?.longitude ?? null,
    taxesEur: collectedTaxesOf(r.structuredDisplayPrice?.explanationData?.priceDetails),
  };
}

/** Finds the first value stored under `key`, however deep in the data. Airbnb moves things around, the names stay. */
function findKey(data: unknown, key: string, depth = 0): unknown {
  if (depth > 14 || data === null || typeof data !== "object") return undefined;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findKey(item, key, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = data as Record<string, unknown>;
  if (key in record && record[key] !== undefined) return record[key];
  for (const value of Object.values(record)) {
    const found = findKey(value, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Reads a page of search results. */
export function parseSearchPage(html: string): SearchPage {
  const state = deferredStateOf(html);
  if (state === null) return BLOCK_HINT.test(html.slice(0, 40_000)) || BLOCK_HINT.test(/<title>([^<]*)/.exec(html)?.[1] ?? "") ? { kind: "blocked" } : { kind: "unknown" };

  const search = findKey(state, "staysSearch");
  if (search === undefined) return { kind: "unknown" };
  if (search === null) return { kind: "no-search" };

  const results = (search as { results?: { searchResults?: unknown[]; paginationInfo?: { pageCursors?: unknown } } | null }).results;
  if (!results || !Array.isArray(results.searchResults)) return { kind: "no-search" };

  const cards = results.searchResults.map(cardOf);
  const pageCursors = Array.isArray(results.paginationInfo?.pageCursors) ? results.paginationInfo.pageCursors.filter((c): c is string => typeof c === "string") : [];
  return { kind: "results", cards: cards.filter((c): c is ListingCard => c !== null), skipped: cards.filter((c) => c === null).length, pageCursors };
}

// ── A listing's own page ────────────────────────────────────────────────────

export type ListingDetails = {
  /** How many people it sleeps at most */
  capacity: number | null;
  /** "Entire rental unit", "Private room in..."; the whole place or not */
  propertyType: string | null;
  rating: number | null;
  reviewCount: number | null;
  name: string | null;
  /** The amenities it has, as Airbnb names them ("Kitchen", "Free parking on premises"); not those it lists as missing */
  amenities: string[];
  lat: number | null;
  lon: number | null;
  /** What the host writes about the tourist tax in the description or the rules; null when nothing */
  hostTax: StayTaxFinding | null;
};

const EmbedSchema = z.looseObject({
  name: Text,
  personCapacity: z.number().nullish(),
  propertyType: Text,
  reviewCount: z.number().nullish(),
  starRating: z.number().nullish(),
});

const AmenityGroupsSchema = z.array(z.looseObject({ amenities: z.array(z.looseObject({ title: Text, available: z.boolean().nullish() })).nullish() }));

/** The amenities the place has, from the "What this place offers" groups; Airbnb lists missing ones there too, marked unavailable. */
function amenitiesOf(state: unknown): string[] {
  const groups = AmenityGroupsSchema.safeParse(findKey(state, "seeAllAmenitiesGroups") ?? findKey(state, "previewAmenitiesGroups"));
  if (!groups.success) return [];
  const titles = groups.data.flatMap((group) => group.amenities ?? []).filter((amenity) => amenity.available !== false).map((amenity) => (amenity.title ?? "").trim());
  return [...new Set(titles.filter(Boolean))];
}

const LocationSchema = z.looseObject({ latitude: z.number(), longitude: z.number() });

/** Where the place is: the listing's own map, as the search also gives it */
function positionOf(state: unknown): { lat: number | null; lon: number | null } {
  const presentation = findKey(state, "pdpPresentation") as { location?: unknown } | undefined;
  const parsed = LocationSchema.safeParse(presentation?.location ?? findKey(state, "coordinate"));
  return parsed.success ? { lat: parsed.data.latitude, lon: parsed.data.longitude } : { lat: null, lon: null };
}

/** Every piece of text the host wrote that the page carries: the description and the sections' texts (rules, "other things to note") */
function hostTextsOf(state: unknown): string[] {
  const texts: string[] = [];
  const walk = (data: unknown, depth: number) => {
    if (depth > 20 || data === null || typeof data !== "object") return;
    if (Array.isArray(data)) return data.forEach((item) => walk(item, depth + 1));
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (typeof value === "string" && (key === "htmlText" || (key === "localizedStringWithTranslationPreference" && texts.length < 200))) texts.push(value);
      else walk(value, depth + 1);
    }
  };
  walk(state, 0);
  return [...new Set(texts)];
}

/** What a listing's page says about the place itself: capacity, kind, rating, amenities, where it is, the tax. Null when the page has no such data. */
export function parseListingPage(html: string): ListingDetails | null {
  const state = deferredStateOf(html);
  // Read wherever the page has them, even when the capacity has moved
  const extras = state === null ? { amenities: [], lat: null, lon: null, hostTax: null } : { amenities: amenitiesOf(state), ...positionOf(state), hostTax: hostTaxStatement(hostTextsOf(state)) };
  const parsed = EmbedSchema.safeParse(state === null ? undefined : findKey(state, "embedData"));
  if (parsed.success) {
    // The page has its data but may not say how many it sleeps: the caller decides what that means
    const e = parsed.data;
    return {
      capacity: typeof e.personCapacity === "number" ? e.personCapacity : null,
      propertyType: e.propertyType ?? null,
      rating: e.starRating && e.starRating > 0 ? e.starRating : null,
      reviewCount: e.reviewCount ?? null,
      name: e.name ?? null,
      ...extras,
    };
  }

  // The data moved: the same two facts are still written out in the page's text
  const capacity = /"personCapacity":(\d+)/.exec(html)?.[1];
  const propertyType = /"propertyType":"(Entire[^"]*|Private[^"]*|Shared[^"]*|Room[^"]*|Hotel[^"]*)"/.exec(html)?.[1];
  return capacity ? { capacity: Number(capacity), propertyType: propertyType ?? null, rating: null, reviewCount: null, name: null, ...extras } : null;
}

/** Whether a kind of place is a whole home, as opposed to a room in someone's home or a shared one. */
export const isWholePlace = (propertyType: string | null | undefined, placeType?: string | null) =>
  propertyType ? /^entire\b/i.test(propertyType) : !/\b(?:private|shared)?\s*room\b/i.test(placeType ?? "");
