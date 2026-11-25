// Accommodation offers, from the test dataset of use-cases.md §1.3, until Airbnb and Booking are
// scraped (task.md phase 7). It only knows the reference scenario's destinations.
import { destinationKeyOf, fixtureStayRaw, stayFixtures, stayOptionOf } from "@/db/seed/fixtures";
import type { StayAdapter, StayOptionInput } from "../types";

export const fixtureStaysAdapter: StayAdapter = {
  id: "fixture-stays",
  async search(query) {
    const destination = destinationKeyOf(query.destination.airports);
    if (!destination) return [];

    return stayFixtures
      .filter((fixture) => fixture.destination === destination)
      .flatMap((fixture): StayOptionInput[] => {
        const option = stayOptionOf(fixture, query.window);
        // With what its page would say: its amenities and its tax (T8.2)
        return option ? [{ ...option, raw: { ...(option.raw as object), ...fixtureStayRaw(fixture.externalId) } }] : [];
      });
  },
};
