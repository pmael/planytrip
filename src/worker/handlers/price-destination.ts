import { ClaudeUnavailableError, type AskFn } from "@/ai/claude";
import { LocalPricesAnswerSchema, localPricesPrompt, type LocalPricesAnswer } from "@/ai/extra-prices";
import { shorten, tidyText } from "@/ai/text";
import { extraPrices } from "@/config";
import type { LocalPrices } from "@/core/extras";
import { checkedPrices, rulesPrices } from "@/core/local-prices";
import { configTaxRule, type TaxRule } from "@/core/tourist-tax";
import { GeocoderUnavailableError } from "@/geo/geocode";
import { findPlace as photonFindPlace, type PlaceFinder } from "@/geo/places";
import { ScrapeError } from "@/scrapers/errors";
import { discoverCarsRental, type RentalPriceSource } from "@/scrapers/prices/discovercars";
import { oilBulletin, petrolPriceIn, type FuelPricesSource } from "@/scrapers/prices/oil-bulletin";
import { eurostatPriceLevels, type PriceLevelsSource } from "@/scrapers/prices/eurostat";
import { franceTaxRules as officialFranceTaxRules, type FranceTaxRules } from "@/scrapers/prices/france-tourist-tax";
import { createScrapeCache } from "@/scrapers/cache";
import { extraActivitiesOf, localPricesInputOf, localPricesOf, storeLocalPrices, type ActivityToStore, type LocalPricesInput } from "@/server/services/localPrices";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { distanceKm } from "@/geo/airports";
import { osrmRoute, type RouteFn } from "@/geo/osrm";
import { localTransit as transitousLocal, type LocalTransit } from "@/scrapers/places/local-transit";
import { parsePayload, PriceDestinationPayloadSchema } from "../payloads";
import { defaultRetryPolicy } from "../queue";
import type { JobHandler } from "../types";

export type PriceDestinationDeps = {
  ask: AskFn;
  levels: PriceLevelsSource;
  findPlace: PlaceFinder;
  franceTax: FranceTaxRules;
  route: RouteFn;
  transit: LocalTransit;
  rental: RentalPriceSource;
  fuel: FuelPricesSource;
};

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The months the stay's nights fall in: "August", "August and September" */
function monthsOfStay(from: string, to: string): string {
  const months = new Set<number>();
  for (let day = new Date(`${from}T00:00:00Z`); day < new Date(`${to}T00:00:00Z`); day = new Date(day.getTime() + 86_400_000)) months.add(day.getUTCMonth());
  return [...months].map((month) => MONTH_NAMES[month]).join(" and ");
}

/**
 * A Nature trip's rental car at a real price (task.md T8.11, rental-sources.md): DiscoverCars' published average at the
 * destination's airport for the stay's months, in place of the AI's or the rules' estimate. The other objectives rent no
 * car. `note` says why it is still an estimate, for the prices' message.
 */
async function withPublishedRental(db: Db, input: LocalPricesInput, prices: LocalPrices, rental: RentalPriceSource): Promise<{ prices: LocalPrices; note: string | null }> {
  if (input.objective !== "nature") return { prices, note: null };
  const { from, to } = input.facts.stay;
  try {
    const found = await rental({ country: input.country, airports: input.airports, from, to }, { cache: createScrapeCache(db) });
    if (!found) return { prices, note: "DiscoverCars publishes no average for the destination's airports: the rental car's price is an estimate" };
    const carRentalPerDay = { eur: found.eurPerDay, source: "published" as const, note: `DiscoverCars' average at ${found.airport}, ${monthsOfStay(from, to)}`, url: found.url };
    return { prices: { ...prices, carRentalPerDay }, note: null };
  } catch (error) {
    if (!(error instanceof ScrapeError)) throw error;
    return { prices, note: `The rental car's price is an estimate: ${error.message.replace(/\.$/, "")}` };
  }
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * A Nature trip's fuel at the country's pump price (task.md T8.12): Euro-super 95 in the latest EU Weekly Oil Bulletin, in
 * place of the AI's or the rules' estimate. Countries outside the EU are not in it: the estimate stays.
 */
async function withBulletinFuel(db: Db, input: LocalPricesInput, prices: LocalPrices, fuel: FuelPricesSource): Promise<{ prices: LocalPrices; note: string | null }> {
  if (input.objective !== "nature") return { prices, note: null };
  try {
    const bulletin = await fuel({ cache: createScrapeCache(db) });
    const eur = petrolPriceIn(bulletin, input.country);
    if (eur === null) return { prices, note: `${input.country} is not in the EU Weekly Oil Bulletin: the fuel price is an estimate` };
    const fuelPerL = { eur, source: "open-data" as const, note: `EU Weekly Oil Bulletin, ${DATE.format(new Date(`${bulletin.date}T00:00:00Z`))}: Euro-super 95`, url: bulletin.url };
    return { prices: { ...prices, fuelPerL }, note: null };
  } catch (error) {
    if (!(error instanceof ScrapeError)) throw error;
    return { prices, note: `The fuel price is an estimate: ${error.message.replace(/\.$/, "")}` };
  }
}

/** The real prices a Nature trip can have (the rental car, the fuel), and why each that is not real stays an estimate */
async function withRealPrices(db: Db, input: LocalPricesInput, prices: LocalPrices, { rental, fuel }: Pick<PriceDestinationDeps, "rental" | "fuel">): Promise<{ prices: LocalPrices; notes: string[] }> {
  const car = await withPublishedRental(db, input, prices, rental);
  const petrol = await withBulletinFuel(db, input, car.prices, fuel);
  return { prices: petrol.prices, notes: [car.note, petrol.note].filter((note): note is string => note !== null) };
}

/**
 * For a nature trip, how far each thing to do is from the destination (T8.6): by road, and by public transport at 08:00.
 * Asked once for each, and left unknown when the routing services cannot be asked.
 */
async function reachActivities(db: Db, input: LocalPricesInput, route: RouteFn, transit: LocalTransit): Promise<void> {
  if (input.objective !== "nature") return;
  const cache = createScrapeCache(db);
  const morning = `${input.facts.stay.from}T07:00:00Z`;
  for (const activity of extraActivitiesOf(db, input.destinationId)) {
    if (activity.lat === null || activity.lon === null || activity.roadKmFromCentre !== null) continue;
    const to = { lat: activity.lat, lon: activity.lon };
    const road = await route(input.centre, to).catch(() => null);
    const minutes = await transit(input.centre, to, morning, { cache }).catch(() => null);
    db.update(schema.extraActivities)
      .set({ roadKmFromCentre: road ? Math.round(road.distanceKm * 10) / 10 : Math.round(distanceKm(input.centre.lat, input.centre.lon, to.lat, to.lon) * 1.3 * 10) / 10, transitMinFromCentre: minutes })
      .where(eq(schema.extraActivities.id, activity.id))
      .run();
  }
}

/** France and the overseas departments that share its tourist tax (and its open data) */
const FRENCH = new Set(["FR", "RE", "GP", "MQ", "GF", "YT"]);

/** Why the AI could not give the prices, in words for the person who will read "rule-based" */
function whyNot(error: unknown): string {
  if (error instanceof ClaudeUnavailableError) return error.message;
  return `the AI did not answer properly: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`;
}

/**
 * The AI's things to do, each looked up on the map near the destination: one the map cannot find is left out. When the
 * map cannot be asked at all, they are kept without a position rather than lost.
 */
async function placed(answer: LocalPricesAnswer["activities"], input: LocalPricesInput, findPlace: PlaceFinder): Promise<{ activities: ActivityToStore[]; leftOut: string[] }> {
  const maxKm = input.objective === "nature" ? extraPrices.placeCheckKm.nature : extraPrices.placeCheckKm.city;
  const activities: ActivityToStore[] = [];
  const leftOut: string[] = [];
  let mapDown = false;
  for (const activity of answer.slice(0, Math.max(input.facts.activitiesWanted, 0))) {
    const name = shorten(tidyText(activity.name), 80);
    const mapName = shorten(tidyText(activity.mapName || activity.name), 120);
    const keep = (lat: number | null, lon: number | null) =>
      activities.push({ name, kind: activity.kind, priceEur: Math.max(0, Math.round(activity.priceEur * 100) / 100), durationH: activity.durationH > 0 ? activity.durationH : null, note: shorten(tidyText(activity.note), 200) || null, mapName, lat, lon });
    if (mapDown) {
      keep(null, null);
      continue;
    }
    try {
      const found = (await findPlace(mapName, input.centre, maxKm)) ?? (mapName !== name ? await findPlace(name, input.centre, maxKm) : null);
      if (found) keep(found.lat, found.lon);
      else leftOut.push(name);
    } catch (error) {
      if (!(error instanceof GeocoderUnavailableError)) throw error;
      mapDown = true;
      keep(null, null);
    }
  }
  return { activities, leftOut };
}

/**
 * price_destination: a destination's local prices and the things to do for its objective (task.md T8.4), asked of the
 * AI once while the trip is set up and kept with the fingerprint of what it was asked.
 *
 * - What the AI already gave for exactly this place, objective, budget level and dates is not asked again.
 * - Each price is checked against the country's average (Eurostat): one far from it is replaced by it, and said.
 * - Without the AI (no CLI, not logged in, or failing on its last try), the rules give every price, marked rule-based,
 *   and the things to do stay as they were. Setting up the trip never waits for an AI that is not there.
 */
export const createPriceDestinationHandler =
  ({ ask, levels, findPlace, franceTax, route, transit, rental, fuel }: PriceDestinationDeps): JobHandler =>
  async (job, { db }) => {
    const { destinationId } = parsePayload(PriceDestinationPayloadSchema, job.payload);
    const input = localPricesInputOf(db, destinationId);
    if (!input) return;
    const kept = localPricesOf(db, destinationId);
    if (kept?.source === "ai" && kept.inputHash === input.hash) {
      // Kept from before the rental car and the fuel had real prices (T8.11, T8.12): only those are asked
      if (input.objective === "nature" && (kept.prices.carRentalPerDay.source !== "published" || kept.prices.fuelPerL.source !== "open-data")) {
        const real = await withRealPrices(db, input, kept.prices, { rental, fuel });
        if (real.prices.carRentalPerDay !== kept.prices.carRentalPerDay || real.prices.fuelPerL !== kept.prices.fuelPerL) {
          storeLocalPrices(db, input, { prices: real.prices, source: kept.source, message: kept.message, touristTax: kept.touristTax }, null);
        }
      }
      return reachActivities(db, input, route, transit);
    }

    // The rules' prices: what the AI's are checked against, and what is kept without it
    let rules: ReturnType<typeof rulesPrices>;
    try {
      rules = rulesPrices(await levels(input.countryCode), input.country);
    } catch (error) {
      if (!(error instanceof ScrapeError)) throw error;
      rules = rulesPrices(null, input.country);
      rules.message = `Eurostat could not be reached: the EU average of each thing`;
    }

    // The tourist tax (T8.5): France's own rates for its communes, else the config table; the AI's comes last
    let placeTax: TaxRule | null = null;
    if (FRENCH.has(input.countryCode)) {
      try {
        placeTax = await franceTax(input.centre, Number(input.facts.stay.from.slice(0, 4)), { cache: createScrapeCache(db) });
      } catch (error) {
        if (!(error instanceof ScrapeError)) throw error;
      }
    }
    placeTax ??= configTaxRule({ country: input.countryCode, ...input.centre });

    try {
      const answer = await ask(localPricesPrompt(input.facts), LocalPricesAnswerSchema, { timeoutMs: extraPrices.timeoutMs });
      const checked = checkedPrices(answer.prices, rules.prices);
      const { replaced } = checked;
      const { activities, leftOut } = await placed(answer.activities, input, findPlace);
      const { prices, notes: realNotes } = await withRealPrices(db, input, checked.prices, { rental, fuel });
      const notes = [
        replaced.length > 0 ? `${replaced.length} price${replaced.length > 1 ? "s" : ""} the AI gave ${replaced.length > 1 ? "were" : "was"} far from the country's average and replaced by it (${replaced.join(", ")})` : null,
        leftOut.length > 0 ? `${leftOut.length} thing${leftOut.length > 1 ? "s" : ""} to do not found on the map near the destination, left out (${leftOut.join(", ")})` : null,
        ...realNotes,
      ].filter(Boolean);
      const aiTax = answer.touristTax;
      const touristTax: TaxRule | null =
        placeTax ??
        (Number.isFinite(aiTax.perPersonNightEur) && aiTax.perPersonNightEur >= 0 && aiTax.perPersonNightEur < 30
          ? { perPersonNightEur: Math.round(aiTax.perPersonNightEur * 100) / 100, percentOfPrice: null, capPerNightEur: null, maxNights: aiTax.maxNights > 0 ? Math.round(aiTax.maxNights) : null, paidByHost: false, source: "ai", label: `${input.facts.destination.name}: ${shorten(tidyText(aiTax.note), 160) || "the AI's estimate"}` }
          : null);
      storeLocalPrices(db, input, { prices, source: "ai", message: notes.length > 0 ? notes.join("; ") : null, touristTax }, activities);
      await reachActivities(db, input, route, transit);
    } catch (error) {
      const finalAttempt = job.attempts > defaultRetryPolicy.maxRetries;
      if (error instanceof ClaudeUnavailableError || finalAttempt) {
        const { prices, notes: realNotes } = await withRealPrices(db, input, rules.prices, { rental, fuel });
        const message = [`Not given by the AI (${whyNot(error).replace(/\.$/, "")}): ${rules.message}`, ...realNotes].join("; ");
        return storeLocalPrices(db, input, { prices, source: "rules", message, touristTax: placeTax }, null);
      }
      throw error;
    }
  };

/** The real AI, Eurostat and the map */
export const priceDestinationDeps = (ask: AskFn): PriceDestinationDeps => ({
  ask,
  levels: eurostatPriceLevels,
  findPlace: photonFindPlace,
  franceTax: officialFranceTaxRules,
  route: osrmRoute,
  transit: transitousLocal,
  rental: discoverCarsRental,
  fuel: oilBulletin,
});
