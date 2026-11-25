// Reading what FlixBus's search service answers (task.md T7.5): the cities it knows by a name, and the
// rides of one day between two cities. Checked with zod, so that a change on their side shows up as a
// ScrapeChangedError instead of as wrong prices.
import { z } from "zod";
import { ScrapeChangedError } from "../errors";

const CitySchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.object({ lat: z.number(), lon: z.number() }),
  is_flixbus_city: z.boolean().optional(),
});

export type FlixbusCity = { id: string; name: string; lat: number; lon: number };

/** The cities an autocomplete answer lists. */
export function parseCities(json: unknown): FlixbusCity[] {
  if (!Array.isArray(json)) throw new ScrapeChangedError("FlixBus answered a city search with something the scraper does not know");
  return json.flatMap((entry) => {
    const city = CitySchema.safeParse(entry);
    return city.success ? [{ id: city.data.id, name: city.data.name, lat: city.data.location.lat, lon: city.data.location.lon }] : [];
  });
}

const RideSchema = z.object({
  status: z.string(),
  departure: z.object({ date: z.string() }),
  arrival: z.object({ date: z.string() }),
  duration: z.object({ hours: z.number(), minutes: z.number() }),
  price: z.object({ total: z.number(), total_with_platform_fee: z.number().nullish() }),
  legs: z.array(z.object({ means_of_transport: z.string() })).min(1),
});

const SearchSchema = z.object({ trips: z.array(z.object({ results: z.record(z.string(), z.unknown()) })) });

/** One way of making the journey on one day. */
export type Ride = {
  /** Local wall-clock times at each end, "2026-12-22T09:45" */
  departAt: string;
  arriveAt: string;
  durationMin: number;
  /** For one person, in euros, the fee FlixBus adds at the checkout included */
  priceEur: number;
  /** The kind of vehicle of each leg, in order */
  legs: ("bus" | "train")[];
};

/** The dates carry the local offset ("2026-12-22T09:45:00+01:00"): the first 16 characters are the local clock. */
const localClock = (date: string) => date.slice(0, 16);

/** The rides a search answer lists that can still be bought. An answer with none (no ride that day) gives an empty list. */
export function parseRides(json: unknown): Ride[] {
  const search = SearchSchema.safeParse(json);
  if (!search.success) throw new ScrapeChangedError("FlixBus answered a search with something the scraper does not know");

  return Object.values(search.data.trips.flatMap((trip) => Object.values(trip.results))).flatMap((entry) => {
    const ride = RideSchema.safeParse(entry);
    if (!ride.success || ride.data.status !== "available") return [];
    const { departure, arrival, duration, price, legs } = ride.data;
    return [
      {
        departAt: localClock(departure.date),
        arriveAt: localClock(arrival.date),
        durationMin: duration.hours * 60 + duration.minutes,
        priceEur: Math.round(price.total_with_platform_fee ?? price.total),
        legs: legs.map((leg) => (leg.means_of_transport === "train" ? "train" : "bus")),
      },
    ];
  });
}
