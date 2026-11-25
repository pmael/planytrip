import type { Destination, Guest, GuestModes, RouteCheck, StayAnalysis, StayOption, TransportOption } from "@/core/types";
import type { Scenario } from "@/core/scenario";
import type { Selection } from "@/core/types";
import {
  toDestination,
  toGuest,
  toGuestModes,
  toRouteCheck,
  toStayAnalysis,
  toStayOption,
  toTransportOption,
} from "@/db/mappers";
import * as schema from "@/db/schema";
import type { DestinationKey } from "@/db/seed/fixtures";
import { seedScenarioMartin } from "@/db/seed/scenario-martin";
import { scenarioWithExtra } from "@/server/services/scenarios";
import { createTestDb } from "./db";

export type LoadedScenario = {
  tripId: string;
  martin: Guest;
  chloe: Guest;
  jessy: Guest;
  guests: Guest[];
  guestModes: GuestModes;
  destinations: Record<DestinationKey, Destination>;
  options: TransportOption[];
  stays: StayOption[];
  analyses: Map<string, StayAnalysis>;
  checks: RouteCheck[];
  /** Scenario of one destination, optionally with ❤ selections or other accepted modes. */
  scenarioFor: (
    key: DestinationKey,
    extra?: { selections?: Selection[]; guestModes?: GuestModes },
  ) => Scenario;
};

/**
 * The seeded reference scenario, read back from a fresh in-memory database as domain objects. Each guest's Extra is in
 * their cost (task.md T8.9), from the seed's facts: the database stays open for it.
 */
export function loadScenario(): LoadedScenario {
  const { db } = createTestDb();

  const seeded = seedScenarioMartin(db);
  const guests = db.select().from(schema.guests).all().map(toGuest);
  const byName = (name: string) => guests.find((guest) => guest.name === name)!;
  const destinationList = db.select().from(schema.destinations).all().map(toDestination);

  const loaded = {
    tripId: seeded.tripId,
    martin: byName("Martin"),
    chloe: byName("Chloé"),
    jessy: byName("Jessy"),
    guests,
    guestModes: toGuestModes(db.select().from(schema.guestModes).all()),
    destinations: Object.fromEntries(
      (Object.keys(seeded.destinationIds) as DestinationKey[]).map((key) => [
        key,
        destinationList.find((destination) => destination.id === seeded.destinationIds[key])!,
      ]),
    ) as Record<DestinationKey, Destination>,
    options: db.select().from(schema.transportOptions).all().map(toTransportOption),
    stays: db.select().from(schema.stayOptions).all().map(toStayOption),
    analyses: new Map(db.select().from(schema.stayAnalyses).all().map((row) => [row.stayId, toStayAnalysis(row)])),
    checks: db.select().from(schema.routeChecks).all().map(toRouteCheck),
  };

  return {
    ...loaded,
    scenarioFor: (key, extra = {}) =>
      scenarioWithExtra(db, {
        destination: loaded.destinations[key],
        guests: loaded.guests,
        guestModes: extra.guestModes ?? loaded.guestModes,
        options: loaded.options,
        stays: loaded.stays,
        analyses: loaded.analyses,
        selections: extra.selections ?? [],
        checks: loaded.checks,
      }),
  };
}
