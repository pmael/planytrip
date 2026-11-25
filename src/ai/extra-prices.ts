// The AI gives a destination's local prices and the things to do for its objective, once, while the trip is set up
// (task.md T8.4, use-cases.md R10). The dashboard only reads what is kept. The app checks the answer: a price far from
// the country's average (core/local-prices.ts) is replaced by it, and a thing to do the map cannot find near the
// destination is left out (server/services/localPrices.ts).
import { createHash } from "node:crypto";
import { z } from "zod";
import { ACTIVITY_KINDS } from "@/core/extras";
import type { Objective } from "@/core/types";

const price = (what: string) => z.number().describe(`${what}, in euros`);

export const LocalPricesAnswerSchema = z.object({
  prices: z.object({
    groceriesPerDay: price("Food for one adult for one day from a supermarket: three simple meals"),
    cheapMeal: price("A meal for one in a simple local restaurant, a soft drink included"),
    midMeal: price("A meal for one in a mid-range restaurant, a drink included"),
    drink: price("A drink (a beer or a cocktail, on average) in the bars and clubs where young people go out"),
    clubEntry: price("Entry to a popular nightclub on a weekend night"),
    preDrinks: price("Each person's share of the drinks bought at a supermarket before a night out"),
    transitTicket: price("One public transport ticket for one ride"),
    transitDayPass: price("A public transport pass for one day"),
    taxiStart: price("A taxi's start fee"),
    taxiPerKm: price("A taxi's price per kilometre"),
    parkingPerDay: price("Parking a car for 24 hours in a public car park near the centre"),
    carRentalPerDay: price("An economy rental car for one day in that season, basic insurance included"),
    fuelPerL: price("A litre of unleaded petrol (95)"),
  }),
  activities: z
    .array(
      z.object({
        name: z.string().describe("The thing to do as a visitor would call it, at most 60 characters"),
        kind: z.enum(ACTIVITY_KINDS).describe("What kind of thing it is"),
        mapName: z.string().describe("The name of the place where it happens or starts, as OpenStreetMap writes it: a museum, a monument, a beach, a lake, a summit, a club, a car park"),
        priceEur: z.number().describe("What one adult pays: tickets, entry, park or parking fees; 0 when free"),
        durationH: z.number().describe("The hours it takes, getting there not counted"),
        note: z.string().describe("One short sentence a guest should know (book weeks ahead, free on the first Sunday, closed on Mondays), or empty"),
      }),
    )
    .describe("The things to do, the most worthwhile first"),
  touristTax: z
    .object({
      perPersonNightEur: z.number().describe("The tourist tax one adult staying in a whole rented flat or house pays a night there, in euros; 0 when there is none"),
      maxNights: z.number().describe("The most nights it is charged for in one stay; 0 when there is no such limit"),
      note: z.string().describe('How it is set, in one short sentence ("Lisbon\'s municipal tax, from 13 years old, 7 nights at most")'),
    })
    .describe("The tourist tax at the destination, today"),
});

export type LocalPricesAnswer = z.infer<typeof LocalPricesAnswerSchema>;

export type LocalPricesFacts = {
  destination: { name: string; country: string; countryCode: string; lat: number; lon: number; outsideEurope: boolean };
  objective: Objective;
  budgetLevel: string;
  stay: { from: string; to: string; nights: number };
  /** How many things to do are wanted: none for the objective "none" */
  activitiesWanted: number;
};

/** What is asked: an answer to an older question (before the tourist tax, T8.5) is asked again */
const QUESTION_VERSION = 2;

/** A short fingerprint of what the AI was asked: prices given for another place, season or objective may no longer hold. */
export const localPricesHashOf = (facts: LocalPricesFacts) => createHash("sha256").update(JSON.stringify({ ...facts, question: QUESTION_VERSION })).digest("hex").slice(0, 24);

/** What "things to do" means for each objective (extra.md §6) */
const WHAT_TO_DO: Record<Objective, string> = {
  partying:
    "The trip is for partying: the places young visitors go out at night, the best known nightclubs and the busiest bar streets or squares (kind \"club\" or \"bar\"). priceEur is the entry fee, 0 for a bar or a square.",
  chill:
    "The trip is for relaxing: first a spa, a hammam or thermal baths if there is one worth it (kind \"spa\"), then beaches, parks, gardens and viewpoints to idle in. No hurried sightseeing.",
  culture:
    "The trip is for culture: the top things to do there, the most worthwhile first (the 3 to 5 a visitor must not miss lead the list): museums, monuments, historic quarters, boat trips, viewpoints. Give each one's real price for an adult.",
  nature:
    "The trip is for nature: day or half-day hikes that can be reached from the destination (kind \"hike\", mapName where the walk starts: a lake, a pass, a car park, a village), natural parks, beaches, lakes. priceEur is what one adult pays in fees (park entry, parking shared, a cable car); 0 when free.",
  none: "The trip has no particular purpose: give no thing to do (an empty list).",
};

export function localPricesPrompt(facts: LocalPricesFacts): string {
  return `You are helping a group of friends work out what a trip will cost them once they are there: food, getting around, going out, things to do. The app needs the LOCAL PRICES of the destination and a short list of THINGS TO DO for the kind of trip they want. They are asked once, now: the app reads them later without asking you again, and works out each guest's spending from them.

The destination, the kind of trip, the budget level and the dates are in the facts.

Prices:
- What a careful visitor actually pays there, in that season, today, in euros (convert if the country has another currency). Not the cheapest deal that can be found, not a tourist trap either.
- One figure per price, for one adult. Every price is required.

Things to do:
- ${WHAT_TO_DO[facts.objective]}
- Give ${facts.activitiesWanted} of them${facts.activitiesWanted === 0 ? " (none)" : ""}, the most worthwhile first. Each must be a real place that exists today, at the destination or within a reasonable trip from it (a day trip at most for a hike). The app looks each one up on the map by its "mapName", and leaves out one it cannot find near the destination: write the name as it is written on the map, without extra words.
- A budget level of "light" means the guests count every euro: prefer what is free or cheap, and say so in the note when something is dear. "high" means they can spend more.
- Season matters: no beach in winter, no high mountain hike under snow.

Tourist tax:
- What one adult staying in a whole rented flat or house (not a hotel) pays a night in tourist or city tax there, today, in euros, and the most nights it is charged for. 0 when the place has none.

Use what you know. Do not invent places. Write in English.

Facts (JSON):
${JSON.stringify(facts, null, 1)}`;
}
