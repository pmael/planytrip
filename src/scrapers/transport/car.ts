// The car as a transport source: real routes, with the cost worked out from the config
// (use-cases.md A-S5, A-S6), the fuel at the pump price of the countries at both ends (EU Weekly Oil Bulletin, task.md
// T8.12) when it has them.
import { car, comfort } from "@/config";
import { needsOvernightStop } from "@/core/comfort";
import { carTripCostEur } from "@/core/pricing";
import type { TransportVariant } from "@/core/types";
import { osrmRoute, type LatLon, type RouteFn } from "@/geo/osrm";
import { ValhallaUnavailableError, valhallaRoute, type TollRoute, type TollRouteFn } from "@/geo/valhalla";
import { ScrapeError } from "../errors";
import { oilBulletin, petrolPriceIn, type FuelPricesSource } from "../prices/oil-bulletin";
import type { TransportAdapter, TransportOptionInput, TransportQuery } from "../types";

type Drive = {
  variant: TransportVariant;
  route: TollRoute;
  engine: "valhalla" | "osrm";
  /** False when the engine knows nothing about tolls, so the price is the fuel only */
  tollsKnown: boolean;
};

/** Two drives are the same when the toll-free way turns out to be the same road. */
const sameDrive = (a: TollRoute, b: TollRoute) =>
  Math.abs(a.durationMin - b.durationMin) < 1 && Math.abs(a.tollKm - b.tollKm) < 1;

/** The ways to drive there: with tolls and without when they differ, a single one when they do not. */
async function drivesFor(
  from: LatLon,
  to: LatLon,
  tollRoute: TollRouteFn,
  roadRoute: RouteFn,
): Promise<Drive[]> {
  let fastest: TollRoute | null;
  try {
    fastest = await tollRoute(from, to);
  } catch (error) {
    if (!(error instanceof ValhallaUnavailableError)) throw error;
    // Too long for the toll-aware engine, or it is down: OSRM still gives the distance and the time
    const road = await roadRoute(from, to);
    return road
      ? [{ variant: "standard", route: { ...road, tollKm: 0, hasToll: false }, engine: "osrm", tollsKnown: false }]
      : [];
  }
  if (!fastest) return [];
  if (!fastest.hasToll) return [{ variant: "standard", route: fastest, engine: "valhalla", tollsKnown: true }];

  let avoiding: TollRoute | null = null;
  try {
    avoiding = await tollRoute(from, to, { avoidTolls: true });
  } catch (error) {
    // The toll-free way is a bonus: not having it still leaves the fastest one
    if (!(error instanceof ValhallaUnavailableError)) throw error;
  }
  const drives: Drive[] = [{ variant: "tolls", route: fastest, engine: "valhalla", tollsKnown: true }];
  if (avoiding && !sameDrive(fastest, avoiding)) {
    drives.push({ variant: "no_tolls", route: avoiding, engine: "valhalla", tollsKnown: true });
  }
  return drives;
}

/** The pump price a drive is costed at, and where it comes from */
type FuelPrice = { eurPerL: number; from: string };

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

/**
 * Petrol for the drive: the mean of the home country's and the destination's prices in the EU Weekly Oil Bulletin (the
 * tank is filled at both ends), the one it has when it has one, else the config's price. The home country is the last
 * part of its label ("Madrid, Spain"); the destination's is its code.
 */
async function fuelFor(query: TransportQuery, fuel: FuelPricesSource): Promise<FuelPrice> {
  const fallback = { eurPerL: car.fuelPriceEurPerL, from: "config" };
  let bulletin;
  try {
    bulletin = await fuel({ cache: query.cache });
  } catch (error) {
    if (error instanceof ScrapeError) return fallback;
    throw error;
  }
  const home = query.origin.label.split(",").at(-1)?.trim() ?? "";
  const there = query.destination.countryCode ? (countryNames.of(query.destination.countryCode) ?? "") : (query.destination.label.split(",").at(-1)?.trim() ?? "");
  const prices = [home, there].map((country) => petrolPriceIn(bulletin, country)).filter((price): price is number => price !== null);
  if (prices.length === 0) return fallback;
  return { eurPerL: Math.round((prices.reduce((sum, price) => sum + price, 0) / prices.length) * 1000) / 1000, from: `EU Weekly Oil Bulletin, ${bulletin.date}` };
}

function optionOf(query: TransportQuery, drive: Drive, fuel: FuelPrice): TransportOptionInput {
  const minutes = Math.round(drive.route.durationMin);
  return {
    originKey: query.origin.key,
    mode: "car",
    provider: drive.engine,
    variant: drive.variant,
    // The guest chooses when to leave
    outDepartAt: null,
    outArriveAt: null,
    backDepartAt: null,
    backArriveAt: null,
    outDurationMin: minutes,
    backDurationMin: minutes,
    stops: null,
    priceEur: carTripCostEur(drive.route, fuel.eurPerL),
    priceUnit: "per_vehicle",
    lastMileEur: 0,
    comfortScore: null,
    comfortLevel: null,
    url: null,
    raw: {
      distanceKm: Math.round(drive.route.distanceKm),
      tollKm: Math.round(drive.route.tollKm),
      tollsKnown: drive.tollsKnown,
      fuelEurPerL: fuel.eurPerL,
      fuelPriceFrom: fuel.from,
    },
  };
}

/**
 * When every way of driving is more than a day's comfortable driving (R2: red), a variant that
 * splits the trip over several days, with a hotel night per leg (A-S5). It starts from the cheapest
 * variant, adds `overnightStopEur` for each night of both ways, and its duration is one day of driving.
 */
function overnightVariant(options: TransportOptionInput[]): TransportOptionInput | null {
  if (options.length === 0 || !options.every((option) => needsOvernightStop(option))) return null;

  const base = [...options].sort((a, b) => a.priceEur - b.priceEur || a.outDurationMin! - b.outDurationMin!)[0];
  const days = Math.ceil(base.outDurationMin! / 60 / comfort.car.yellowMaxHoursPerDay);
  const nightsEachWay = days - 1;
  const perDay = Math.ceil(base.outDurationMin! / days);

  return {
    ...base,
    variant: "overnight_stop",
    outDurationMin: perDay,
    backDurationMin: perDay,
    stops: nightsEachWay,
    priceEur: base.priceEur + 2 * nightsEachWay * car.overnightStopEur,
    raw: { ...(base.raw as object), basedOn: base.variant, nightsEachWay, drivingPerDayMin: perDay },
  };
}

/**
 * Builds the car adapter. `tollRoute` knows about tolls (Valhalla); `roadRoute` (OSRM) takes over
 * for drives the first one refuses, with the fuel as the only cost since it cannot see tolls.
 * `fuel` gives the pump prices (the EU Weekly Oil Bulletin); when it cannot, the config's price is used.
 */
export function createCarAdapter({
  tollRoute = valhallaRoute,
  roadRoute = osrmRoute,
  fuel = oilBulletin,
}: { tollRoute?: TollRouteFn; roadRoute?: RouteFn; fuel?: FuelPricesSource } = {}): TransportAdapter {
  return {
    id: "car",
    modes: ["car"],
    async search(query) {
      if (query.mode !== "car") return [];
      const from = { lat: query.origin.lat, lon: query.origin.lon };
      const to = { lat: query.destination.lat, lon: query.destination.lon };

      const drives = await drivesFor(from, to, tollRoute, roadRoute);
      if (drives.length === 0) return [];
      const price = await fuelFor(query, fuel);
      const options = drives.map((drive) => optionOf(query, drive, price));
      const overnight = overnightVariant(options);
      return overnight ? [...options, overnight] : options;
    },
  };
}

export const carAdapter: TransportAdapter = createCarAdapter();
