// Seed of the reference scenario (use-cases.md §1): Martin, Chloé and Jessy choosing between
// Barcelona, La Réunion and Le Mont-Saxonnex. Run with `npm run db:seed`; it replaces any
// previous copy of the scenario and leaves other trips alone.
import { eq } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import type { TransportMode } from "@/core/types";
import * as schema from "../schema";
import type { Db } from "../types";
import { airportLocation } from "@/geo/airports";
import {
  fixtureActivityRows,
  fixtureStayRaw,
  fixtureSurveyFacts,
  localPriceFixtures,
  SCENARIO_WINDOW,
  stayFixtures,
  stayOptionOf,
  transportFixtures,
  transportOptionOf,
  type DestinationKey,
} from "./fixtures";

export const SEED_TRIP_NAME = "Martin's trip (seed)";

type GuestKey = "martin" | "chloe" | "jessy";

const guestRows: Record<
  GuestKey,
  Omit<typeof schema.guests.$inferInsert, "tripId" | "favoriteDestinationId"> & { modes: TransportMode[] }
> = {
  martin: {
    name: "Martin", homeLabel: "Madrid", homeLat: 40.4168, homeLon: -3.7038,
    homeAirportsJson: JSON.stringify(["MAD"]), originKey: "MAD", maxBudgetEur: 800,
    availableFrom: "2027-08-26", availableTo: "2027-09-05", preferredMode: "car", modes: ["car"],
  },
  chloe: {
    name: "Chloé", homeLabel: "Paris", homeLat: 48.8566, homeLon: 2.3522,
    homeAirportsJson: JSON.stringify(["ORY", "CDG"]), originKey: "PAR", maxBudgetEur: 1200,
    availableFrom: "2027-08-26", availableTo: "2027-09-14", preferredMode: "plane", modes: ["plane"],
  },
  jessy: {
    name: "Jessy", homeLabel: "Madrid", homeLat: 40.4168, homeLon: -3.7038,
    homeAirportsJson: JSON.stringify(["MAD"]), originKey: "MAD", maxBudgetEur: 400,
    availableFrom: "2027-08-26", availableTo: "2027-09-14", preferredMode: "plane", modes: ["plane"],
  },
};

const destinationRows: Record<DestinationKey, Omit<typeof schema.destinations.$inferInsert, "tripId">> = {
  barcelona: {
    label: "Barcelona", countryCode: "ES", lat: 41.3874, lon: 2.1686,
    airportsJson: JSON.stringify(["BCN"]), inScope: true, budgetLevel: "light", objective: "partying",
  },
  // "RE" is outside the Europe scope: computed for reference but flagged
  "la-reunion": {
    label: "La Réunion (Saint-Gilles)", countryCode: "RE", lat: -21.0597, lon: 55.2203,
    airportsJson: JSON.stringify(["RUN"]), inScope: false, budgetLevel: "high", objective: "chill",
  },
  "mont-saxonnex": {
    label: "Le Mont-Saxonnex", countryCode: "FR", lat: 46.0517, lon: 6.4533,
    airportsJson: JSON.stringify(["GVA"]), inScope: true, budgetLevel: "high", objective: "nature",
  },
};

export type SeededScenario = {
  tripId: string;
  guestIds: Record<GuestKey, string>;
  destinationIds: Record<DestinationKey, string>;
};

export function seedScenarioMartin(db: Db): SeededScenario {
  return db.transaction((tx) => {
    // Cascades remove the previous copy's guests, destinations, options and checks
    tx.delete(schema.trips).where(eq(schema.trips.name, SEED_TRIP_NAME)).run();

    const [trip] = tx
      .insert(schema.trips)
      .values({ name: SEED_TRIP_NAME, status: "ready" })
      .returning()
      .all();

    const guestIds = {} as Record<GuestKey, string>;
    for (const key of Object.keys(guestRows) as GuestKey[]) {
      const { modes, ...row } = guestRows[key];
      const [guest] = tx.insert(schema.guests).values({ ...row, tripId: trip.id }).returning().all();
      guestIds[key] = guest.id;
      tx.insert(schema.guestModes).values(modes.map((mode) => ({ guestId: guest.id, mode }))).run();
    }

    const destinationIds = {} as Record<DestinationKey, string>;
    for (const key of Object.keys(destinationRows) as DestinationKey[]) {
      const [destination] = tx
        .insert(schema.destinations)
        .values({ ...destinationRows[key], tripId: trip.id })
        .returning()
        .all();
      destinationIds[key] = destination.id;
    }

    // Route checks, as the reachability step (A-S4) would produce them
    const routeChecks: (typeof schema.routeChecks.$inferInsert)[] = [];
    for (const key of Object.keys(destinationIds) as DestinationKey[]) {
      const destinationId = destinationIds[key];
      for (const originKey of ["MAD", "PAR"]) {
        routeChecks.push({ destinationId, originKey, mode: "plane", reachable: true });
      }
    }
    const carRoutes: Record<DestinationKey, Partial<typeof schema.routeChecks.$inferInsert> & { reachable: boolean }> = {
      barcelona: { reachable: true, distanceKm: 620, durationMin: 350 },
      "la-reunion": { reachable: false, reason: "no_road_route" },
      "mont-saxonnex": { reachable: true, distanceKm: 1330, durationMin: 780 },
    };
    for (const key of Object.keys(carRoutes) as DestinationKey[]) {
      routeChecks.push({ destinationId: destinationIds[key], originKey: "MAD", mode: "car", ...carRoutes[key] });
    }
    tx.insert(schema.routeChecks).values(routeChecks).run();

    tx.insert(schema.transportOptions)
      .values(
        transportFixtures.map((fixture) => {
          const { raw, ...option } = transportOptionOf(fixture, fixture.originKey, SCENARIO_WINDOW);
          return {
            ...option,
            tripId: trip.id,
            destinationId: destinationIds[fixture.destination],
            rawJson: JSON.stringify(raw),
          };
        }),
      )
      .run();

    for (const fixture of stayFixtures) {
      const { raw: fixtureRaw, photos, reviewsSample, ...option } = stayOptionOf(fixture, SCENARIO_WINDOW)!;
      // What the stay's page would have said (T8.2): its amenities and its tax
      const raw = { ...(fixtureRaw as object), ...fixtureStayRaw(fixture.externalId) };
      const [stay] = tx
        .insert(schema.stayOptions)
        .values({
          ...option,
          destinationId: destinationIds[fixture.destination],
          photosJson: JSON.stringify(photos),
          reviewsSampleJson: reviewsSample ? JSON.stringify(reviewsSample) : null,
          rawJson: JSON.stringify(raw),
        })
        .returning()
        .all();
      // What is around it (T8.3) and how it is reached from its airport (T8.6), as the fixtures describe it
      tx.insert(schema.placeSurveys)
        .values({ destinationId: destinationIds[fixture.destination], stayOptionId: stay.id, source: "fixture", factsJson: JSON.stringify(fixtureSurveyFacts(fixture.externalId, airportLocation)) })
        .run();
      tx.insert(schema.stayAnalyses)
        .values({
          stayId: stay.id,
          verdict: fixture.verdict,
          fitScore: fixture.fitScore,
          prosJson: JSON.stringify(fixture.pros),
          consJson: JSON.stringify(fixture.cons),
          summary: fixture.summary,
          inputHash: "fixture-v1",
        })
        .run();
    }

    // The local prices and things to do the AI would have given (task.md T8.4, use-cases.md UC-D), each thing to do put
    // at its fixture's road distance from the destination
    for (const key of Object.keys(destinationIds) as DestinationKey[]) {
      const destinationId = destinationIds[key];
      tx.insert(schema.destinationPrices).values({ destinationId, pricesJson: JSON.stringify(localPriceFixtures[key]), source: "ai", inputHash: "fixture-v1", message: null }).run();
      const centre = { lat: destinationRows[key].lat!, lon: destinationRows[key].lon! };
      for (const row of fixtureActivityRows(key, centre)) tx.insert(schema.extraActivities).values({ ...row, destinationId, objective: destinationRows[key].objective! }).run();
    }

    return { tripId: trip.id, guestIds, destinationIds };
  });
}

async function main() {
  // Imported here so that importing this module from a test never opens data/trip.db
  const { db } = await import("../client");
  try {
    const seeded = seedScenarioMartin(db);
    console.log(`Seeded "${SEED_TRIP_NAME}" (${seeded.tripId}): 3 guests, 3 destinations,`);
    console.log(`${transportFixtures.length} transport options and ${stayFixtures.length} stays, with their local prices and things to do.`);
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(`${error.message} ${error.cause ?? ""}`)) {
      console.error("The tables are missing: run `npm run db:migrate` first.");
      process.exit(1);
    }
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
