// The tourist tax of a stay (task.md T8.5, use-cases.md R10): whether its price already has it, and what a guest pays a
// night when it does not. Pure: the stay's own page was read by its scraper (scrapers/stays/stay-tax.ts), the place's
// rate comes from France's open data, the config table or the AI (stored by the price_destination job).
import { touristTaxes } from "@/config";
import type { TouristTax } from "./extras";
import type { StayProvider } from "./types";

/** What a place charges a guest of a whole rented home; `perPersonNightEur` 0 when there is no tourist tax */
export type TaxRule = {
  perPersonNightEur: number | null;
  /** A share of the price per person per night, in %, instead of a fixed amount */
  percentOfPrice: number | null;
  /** The most a night costs a person with a share of the price */
  capPerNightEur: number | null;
  maxNights: number | null;
  /** France's "forfait": the host pays it, from the number of beds, not the guest */
  paidByHost: boolean;
  source: "open-data" | "config" | "ai";
  /** In words, for the page: "Paris: 5 % of the price a person a night, with the extra taxes, at most €15.60" */
  label: string;
};

/** What the stay's page said (scrapers/stays/stay-tax.ts, kept in `raw_json.touristTax`) */
export type PageTax = { included: boolean | null; amountEur: number | null; perPersonNightEur: number | null; maxNights: number | null; basis: string | null };

type Place = { country: string; lat: number; lon: number };
type ConfigPlace = (typeof touristTaxes.places)[number];

const KM_PER_LAT = 110.574;
const within = (place: Place, entry: ConfigPlace): boolean => {
  if (place.country.toUpperCase() !== entry.country) return false;
  if ("near" in entry) {
    const dy = (place.lat - entry.near.lat) * KM_PER_LAT;
    const dx = (place.lon - entry.near.lon) * 111.32 * Math.cos((entry.near.lat * Math.PI) / 180);
    return Math.hypot(dx, dy) <= entry.near.km;
  }
  if ("box" in entry) return place.lat >= entry.box.south && place.lat <= entry.box.north && place.lon >= entry.box.west && place.lon <= entry.box.east;
  return true;
};

/** The config table's rule for a place: the first entry it falls in (cities before regions and countries), or null. */
export function configTaxRule(place: Place, table: readonly ConfigPlace[] = touristTaxes.places): TaxRule | null {
  const entry = table.find((candidate) => within(place, candidate));
  if (!entry) return null;
  const percent = "percentOfPrice" in entry ? entry.percentOfPrice : null;
  return {
    perPersonNightEur: percent === null && "perPersonNightEur" in entry ? entry.perPersonNightEur : null,
    percentOfPrice: percent,
    capPerNightEur: null,
    maxNights: entry.maxNights,
    paidByHost: false,
    source: "config",
    label: `${entry.name}: ${entry.note}`,
  };
}

const cents = (eur: number) => Math.round(eur * 100) / 100;

/** What a person pays a night under a rule, for a stay at that price; null when the rule has no amount */
export function nightlyTax(rule: TaxRule, stay: { totalPriceEur: number; nights: number; guests: number }): number | null {
  if (rule.percentOfPrice !== null) {
    if (stay.nights < 1 || stay.guests < 1) return null;
    const share = ((stay.totalPriceEur / stay.nights / stay.guests) * rule.percentOfPrice) / 100;
    return cents(rule.capPerNightEur !== null ? Math.min(share, rule.capPerNightEur) : share);
  }
  return rule.perPersonNightEur;
}

/**
 * The stay's tourist tax, or null when there is none or nothing is known.
 * - In the price: what the page says first (Airbnb's own "Taxes" line, a host who says it is included, Google Hotels'
 *   policy). An Airbnb without that line is one Airbnb does not collect for: the guest pays it on top, unless the host
 *   pays it (France's "forfait"). A hotel's total has it.
 * - The rate: the host's own figure when they give one, else the place's rule.
 */
export function touristTaxOf({ page, provider, rule, stay }: { page: PageTax | null; provider: StayProvider; rule: TaxRule | null; stay: { totalPriceEur: number; nights: number; guests: number } }): TouristTax | null {
  // In the price: what it was, when the page says (Airbnb's line); otherwise 0, since the place's rate for a rented flat
  // is not what a hotel pays
  const inThePrice = (source: TouristTax["source"]): TouristTax => ({
    perNightEur: page?.amountEur != null && stay.nights > 0 && stay.guests > 0 ? cents(page.amountEur / stay.nights / stay.guests) : 0,
    maxNights: page?.maxNights ?? null,
    included: true,
    source,
  });
  if (page?.included === true) return inThePrice("page");
  if (page?.perPersonNightEur) {
    return { perNightEur: page.perPersonNightEur, maxNights: page.maxNights ?? rule?.maxNights ?? null, included: false, source: "page" };
  }
  if (!rule) return null;
  const perNight = nightlyTax(rule, stay);
  if (perNight === null || perNight <= 0) return null;
  if (page?.included !== false && (provider === "booking" || rule.paidByHost)) return inThePrice(rule.source);
  return { perNightEur: perNight, maxNights: rule.maxNights, included: false, source: rule.source };
}
