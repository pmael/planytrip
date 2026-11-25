// Flights, from the test dataset of use-cases.md §1.3, until the real sites are scraped (task.md
// phase 7). It only knows the reference scenario: any other pair of places has no flight.
import { destinationKeyOf, fixtureOriginOf, transportFixtures, transportOptionOf } from "@/db/seed/fixtures";
import type { TransportAdapter } from "../types";

export const fixtureFlightsAdapter: TransportAdapter = {
  id: "fixture-flights",
  modes: ["plane"],
  async search(query) {
    if (query.mode !== "plane") return [];

    const origin = fixtureOriginOf(query.origin.airports);
    const destination = destinationKeyOf(query.destination.airports);
    if (!origin || !destination) return [];

    return transportFixtures
      .filter(
        (fixture) => fixture.mode === "plane" && fixture.originKey === origin && fixture.destination === destination,
      )
      .map((fixture) => transportOptionOf(fixture, query.origin.key, query.window));
  },
};
