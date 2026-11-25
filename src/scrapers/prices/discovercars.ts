// A rental car's daily price at an airport, by month (task.md T8.11, rental-sources.md): what DiscoverCars publishes on
// its own airport pages, "Average rental costs per day", month by month, from its customers' bookings. A real figure for
// the place and the season, not a quote for the dates: the app shows it with ≈ and says whose average it is.
//
// Only the pages its robots.txt leaves open are read: the country page (to find the airport's page) and the airport page,
// one at a time with a pause, each kept a month. Its search, its offers and its JSON are not asked (robots.txt forbids
// them). A page that answers like a wall is a ScrapeBlockedError and is not tried again around; a place it has no page
// for, or a page in another currency, is simply no price: the AI's estimate stays.
import { extraPrices } from "@/config";
import type { ScrapeCache } from "../types";
import { ScrapeBlockedError, ScrapeChangedError, ScrapeError } from "../errors";
import { userAgentFor } from "../http";
import { createPoliteThrottle } from "../throttle";

const settings = extraPrices.rentalCars;

export type RentalAverage = {
  /** The stay's months, weighted by its nights */
  eurPerDay: number;
  /** Each month's average, January first; null where the page has none */
  monthsEur: (number | null)[];
  /** The airport's code, and the page it was read on (for a person to compare on their own dates) */
  airport: string;
  url: string;
};

/** The rental price at the destination's airports during the stay, or null when none of them has a page */
export type RentalPriceSource = (place: { country: string; airports: string[]; from: string; to: string }, options?: { cache?: ScrapeCache }) => Promise<RentalAverage | null>;

/** "Côte d'Ivoire" → "cote-d-ivoire", "France" → "france": the country part of DiscoverCars' addresses */
export const countrySlug = (country: string) =>
  country
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The airport pages a country page links to, by code: `GVA` → "/france/ferney-voltaire/gva" */
export function airportPagesOf(html: string, country: string): Map<string, string> {
  const slug = countrySlug(country);
  const pages = new Map<string, string>();
  for (const [, path, code] of html.matchAll(new RegExp(`href="(/${slug}/[a-z0-9-]+/([a-z]{3}))"`, "g"))) {
    if (!pages.has(code.toUpperCase())) pages.set(code.toUpperCase(), path);
  }
  return pages;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The twelve monthly averages of an airport page, in euros, January first; null when the page has no such chart. Only
 * euros are taken: a page in another currency gives nothing rather than a wrong figure.
 */
export function monthlyAverages(html: string): (number | null)[] | null {
  const start = html.indexOf("content-rent-price");
  if (start < 0) return null;
  const block = html.slice(start, start + 60_000);
  const months: (number | null)[] = Array(12).fill(null);
  let found = 0;
  for (const [, value, month] of block.matchAll(/ColumnTooltip_Medium">([^<]+)<\/p><p class="[^"]*ColumnTooltip_Small">in (\w+)<\/p>/g)) {
    const index = MONTHS.indexOf(month);
    const euros = /^€\s?(\d+(?:[.,]\d+)?)$/.exec(value.trim());
    if (index < 0 || months[index] !== null) continue;
    if (!euros) return null;
    months[index] = Number(euros[1].replace(",", "."));
    found++;
  }
  return found >= 6 ? months : null;
}

/** The stay's months weighted by its nights: 26 August → 5 September is six nights of August and four of September */
export function stayAverage(monthsEur: (number | null)[], from: string, to: string): number | null {
  let total = 0;
  let nights = 0;
  for (let day = new Date(`${from}T00:00:00Z`); day < new Date(`${to}T00:00:00Z`); day = new Date(day.getTime() + 86_400_000)) {
    const eur = monthsEur[day.getUTCMonth()];
    if (eur === null) return null;
    total += eur;
    nights++;
  }
  return nights > 0 ? Math.round((total / nights) * 100) / 100 : null;
}

/** Bot walls seen on the web: a page that has one is not read */
const WALL = /captcha-delivery|cf-chl|challenge-platform|px-captcha|g-recaptcha|hcaptcha|awswaf|Pardon Our Interruption/i;

export type PageFetcher = (url: string) => Promise<string | null>;

/** One page at a time, with a pause, saying what the app is. Null for a page that does not exist. */
export function pageFetcher(fetchImpl: typeof fetch = fetch, pauseMs: { min: number; max: number } = settings.pauseMs): PageFetcher {
  const pace = createPoliteThrottle({ minMs: pauseMs.min, maxMs: pauseMs.max });
  return (url) =>
    pace(async () => {
      let response: Response;
      try {
        response = await fetchImpl(url, { headers: { accept: "text/html", "user-agent": userAgentFor(null) }, signal: AbortSignal.timeout(settings.timeoutMs) });
      } catch (error) {
        throw new ScrapeError(`Could not reach DiscoverCars: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      if (response.status === 404 || response.status === 410) return null;
      if (response.status === 401 || response.status === 403) throw new ScrapeBlockedError("DiscoverCars turned the request away");
      if (response.status === 429) throw new ScrapeBlockedError("DiscoverCars asked us to slow down");
      if (!response.ok) throw new ScrapeError(`DiscoverCars answered ${response.status}`);
      const html = await response.text();
      if (WALL.test(html.slice(0, 200_000))) throw new ScrapeBlockedError("DiscoverCars answered with a verification page: it is turning automated requests away");
      return html;
    });
}

/**
 * The rental price at the first of `airports` DiscoverCars has a page for in the destination's country, for the stay's
 * months (its country page lists the airport pages). Null when it has none, or no chart in euros.
 */
export function createDiscoverCarsRental(fetchPage: PageFetcher = pageFetcher()): RentalPriceSource {
  return async ({ country, airports, from, to }, { cache } = {}) => {
    const remember = <T>(key: string, produce: () => Promise<T>) => (cache ? cache.remember(key, "discovercars", settings.cacheTtlMs, produce) : produce());
    const slug = countrySlug(country);
    if (!slug || airports.length === 0) return null;

    const pages = await remember(`country|${slug}`, async () => {
      const html = await fetchPage(`${settings.site}/${slug}`);
      return html ? [...airportPagesOf(html, country)] : [];
    });
    const known = new Map(pages);
    for (const airport of airports) {
      const path = known.get(airport.toUpperCase());
      if (!path) continue;
      const monthsEur = await remember(`airport|${path}`, async () => {
        const html = await fetchPage(`${settings.site}${path}`);
        if (html === null) return null;
        const months = monthlyAverages(html);
        if (!months && !html.includes("content-rent-price")) return null;
        if (!months) throw new ScrapeChangedError("DiscoverCars' airport page no longer has its monthly prices in euros where they were");
        return months;
      });
      if (!monthsEur) continue;
      const eurPerDay = stayAverage(monthsEur, from, to);
      if (eurPerDay !== null) return { eurPerDay, monthsEur, airport: airport.toUpperCase(), url: `${settings.site}${path}` };
    }
    return null;
  };
}

export const discoverCarsRental: RentalPriceSource = createDiscoverCarsRental();
