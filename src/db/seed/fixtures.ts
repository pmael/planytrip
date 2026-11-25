// Test dataset of use-cases.md §1.3: stays and transport options for the reference scenario.
// The prices are plausible estimates for testing the algorithm, not quotes. They feed the seed
// and, later, the fake adapters (task.md T3.3); the real adapters replace them.
import { nightsBetween } from "@/core/dates";
import type { ExtraActivity, LocalPrice, LocalPrices, StayFacts, TransferLeg } from "@/core/extras";
import type { StayOptionInput, TransportOptionInput } from "@/scrapers/types";
import type {
  ComfortLevel,
  DateRange,
  IsoDate,
  PriceUnit,
  StayProvider,
  StayVerdict,
  TransportMode,
  TransportVariant,
} from "@/core/types";

export type DestinationKey = "barcelona" | "la-reunion" | "mont-saxonnex";

/** The common window of the scenario: 10 nights, limited by Martin. */
export const SCENARIO_WINDOW: { from: IsoDate; to: IsoDate } = { from: "2027-08-26", to: "2027-09-05" };
export const SCENARIO_NIGHTS = 10;
export const GROUP_SIZE = 3;

export type TransportFixture = {
  destination: DestinationKey;
  originKey: "MAD" | "PAR";
  mode: TransportMode;
  provider: string;
  variant: TransportVariant;
  label: string;
  /** Local wall-clock departure of the outbound leg, "HH:MM". null when it does not matter (car). */
  departTime: string | null;
  /** One way, in minutes */
  durationMin: number;
  stops: number | null;
  /** Round trip, whole euros */
  priceEur: number;
  priceUnit: PriceUnit;
  /** Airport to lodging, round trip */
  lastMileEur?: number;
  /** The "Comfort" column of §1.3: what `comfortOf` must produce, used by tests. Not stored. */
  expectedComfort: ComfortLevel;
};

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

export const transportFixtures: TransportFixture[] = [
  // Barcelona
  { destination: "barcelona", originKey: "PAR", mode: "plane", provider: "transavia", variant: "standard", label: "Transavia ORY→BCN, departs 06:30", departTime: "06:30", durationMin: h(1, 40), stops: 0, priceEur: 120, priceUnit: "per_person", expectedComfort: "yellow" },
  { destination: "barcelona", originKey: "PAR", mode: "plane", provider: "vueling", variant: "standard", label: "Vueling ORY→BCN, departs 11:30", departTime: "11:30", durationMin: h(1, 40), stops: 0, priceEur: 165, priceUnit: "per_person", expectedComfort: "green" },
  { destination: "barcelona", originKey: "MAD", mode: "plane", provider: "vueling", variant: "standard", label: "Vueling MAD→BCN, departs 06:45", departTime: "06:45", durationMin: h(1, 15), stops: 0, priceEur: 70, priceUnit: "per_person", expectedComfort: "yellow" },
  { destination: "barcelona", originKey: "MAD", mode: "plane", provider: "iberia", variant: "standard", label: "Iberia MAD→BCN, departs 10:15", departTime: "10:15", durationMin: h(1, 15), stops: 0, priceEur: 95, priceUnit: "per_person", expectedComfort: "green" },
  { destination: "barcelona", originKey: "MAD", mode: "car", provider: "osrm", variant: "no_tolls", label: "Car without tolls (620 km)", departTime: null, durationMin: h(6, 15), stops: null, priceEur: 145, priceUnit: "per_vehicle", expectedComfort: "yellow" },
  { destination: "barcelona", originKey: "MAD", mode: "car", provider: "osrm", variant: "tolls", label: "Car with tolls", departTime: null, durationMin: h(5, 50), stops: null, priceEur: 175, priceUnit: "per_vehicle", expectedComfort: "green" },

  // La Réunion (no car option from Madrid: no road route, see the route checks)
  { destination: "la-reunion", originKey: "PAR", mode: "plane", provider: "air-austral", variant: "standard", label: "Air Austral ORY→RUN direct, departs 22:30", departTime: "22:30", durationMin: h(11, 5), stops: 0, priceEur: 880, priceUnit: "per_person", expectedComfort: "yellow" },
  { destination: "la-reunion", originKey: "PAR", mode: "plane", provider: "fixture", variant: "standard", label: "Via Marseille", departTime: "09:00", durationMin: h(14, 30), stops: 1, priceEur: 820, priceUnit: "per_person", expectedComfort: "yellow" },
  { destination: "la-reunion", originKey: "MAD", mode: "plane", provider: "fixture", variant: "standard", label: "3 stops", departTime: "07:30", durationMin: h(23, 40), stops: 3, priceEur: 910, priceUnit: "per_person", expectedComfort: "red" },
  { destination: "la-reunion", originKey: "MAD", mode: "plane", provider: "fixture", variant: "standard", label: "Via Paris-Orly", departTime: "09:30", durationMin: h(14, 30), stops: 1, priceEur: 1040, priceUnit: "per_person", expectedComfort: "yellow" },

  // Le Mont-Saxonnex (GVA is 45 km away: bus/taxi included as the last mile)
  { destination: "mont-saxonnex", originKey: "PAR", mode: "plane", provider: "easyjet", variant: "standard", label: "easyJet CDG→GVA + bus/taxi 45 km", departTime: "10:30", durationMin: h(1, 5), stops: 0, priceEur: 110, priceUnit: "per_person", lastMileEur: 50, expectedComfort: "green" },
  { destination: "mont-saxonnex", originKey: "MAD", mode: "plane", provider: "easyjet", variant: "standard", label: "easyJet MAD→GVA + bus/taxi", departTime: "11:00", durationMin: h(1, 55), stops: 0, priceEur: 140, priceUnit: "per_person", lastMileEur: 50, expectedComfort: "green" },
  { destination: "mont-saxonnex", originKey: "MAD", mode: "car", provider: "osrm", variant: "tolls", label: "Car with tolls (1,330 km)", departTime: null, durationMin: h(13), stops: null, priceEur: 531, priceUnit: "per_vehicle", expectedComfort: "red" },
  { destination: "mont-saxonnex", originKey: "MAD", mode: "car", provider: "osrm", variant: "no_tolls", label: "Car without tolls (1,390 km)", departTime: null, durationMin: h(17, 30), stops: null, priceEur: 325, priceUnit: "per_vehicle", expectedComfort: "red" },
  // 325 € + 2 hotel nights at 60 €, each way split in two days of 8 h 45
  { destination: "mont-saxonnex", originKey: "MAD", mode: "car", provider: "osrm", variant: "overnight_stop", label: "Car without tolls + 1 overnight stop each way", departTime: null, durationMin: h(8, 45), stops: null, priceEur: 445, priceUnit: "per_vehicle", expectedComfort: "yellow" },
];

export type StayFixture = {
  destination: DestinationKey;
  provider: StayProvider;
  externalId: string;
  title: string;
  rooms: number;
  beds: number;
  capacity: number;
  /** Whole stay for the group, 10 nights */
  totalPriceEur: number;
  /** The "AI verdict" column of §1.3. Stored as a stay analysis so R4 can use it. */
  verdict: StayVerdict;
  fitScore: number;
  pros: string[];
  cons: string[];
  summary: string;
};

export const stayFixtures: StayFixture[] = [
  {
    destination: "barcelona", provider: "airbnb", externalId: "fixture-barcelona-gracia",
    title: "Gràcia apartment, 2 bedrooms, 3 beds", rooms: 2, beds: 3, capacity: 3, totalPriceEur: 900,
    verdict: "ok", fitScore: 62,
    pros: ["Lively neighbourhood close to the nightlife", "Cheapest option for the group"],
    cons: ["Street noise at night", "Third bed is a sofa bed"],
    summary: "Good value and well placed for a partying trip, but not the quietest or most comfortable.",
  },
  {
    destination: "barcelona", provider: "booking", externalId: "fixture-barcelona-cuatro-naciones",
    title: "Hotel Cuatro Naciones, 2 rooms", rooms: 2, beds: 3, capacity: 3, totalPriceEur: 1200,
    verdict: "good", fitScore: 84,
    pros: ["Central location", "Daily cleaning and reception"],
    cons: ["300 € more than the apartment"],
    summary: "A comfortable, well located hotel; the price is the only drawback for a tight budget.",
  },
  {
    destination: "la-reunion", provider: "airbnb", externalId: "fixture-reunion-saint-gilles",
    title: "Villa Saint-Gilles, 2 bedrooms", rooms: 2, beds: 3, capacity: 4, totalPriceEur: 800,
    verdict: "good", fitScore: 88,
    pros: ["Close to the Saint-Gilles beaches", "Private pool and garden"],
    cons: ["A car is useful to explore the island"],
    summary: "A relaxing villa that fits a chill trip and is cheaper than the mainland options.",
  },
  {
    destination: "mont-saxonnex", provider: "airbnb", externalId: "fixture-mont-saxonnex-bargy",
    title: "Chalet Le Bargy, 3 bedrooms", rooms: 3, beds: 4, capacity: 6, totalPriceEur: 900,
    verdict: "good", fitScore: 86,
    pros: ["Each guest has a bedroom", "Right at the start of the hiking trails"],
    cons: ["Remote: a car or a taxi is needed for groceries"],
    summary: "A spacious chalet that suits a nature trip, as long as you can get around by car.",
  },
];

/** The scenario's places as geocoders and `nearbyAirports` describe them, by their airports. */
const DESTINATION_BY_AIRPORT: Record<string, DestinationKey> = { BCN: "barcelona", RUN: "la-reunion", GVA: "mont-saxonnex" };
const ORIGIN_BY_AIRPORT: Record<string, TransportFixture["originKey"]> = { MAD: "MAD", ORY: "PAR", CDG: "PAR" };

/** Which scenario destination a place is, from its airports (Barcelona has BCN...), or null. */
export const destinationKeyOf = (airports: string[]): DestinationKey | null =>
  airports.map((code) => DESTINATION_BY_AIRPORT[code]).find(Boolean) ?? null;

/** Which scenario departure place a place is, from its airports (Madrid has MAD, Paris ORY and CDG), or null. */
export const fixtureOriginOf = (airports: string[]): TransportFixture["originKey"] | null =>
  airports.map((code) => ORIGIN_BY_AIRPORT[code]).find(Boolean) ?? null;

/** When the way back leaves, every fixture alike */
export const RETURN_TIME = "16:00";

/** "2027-08-26" + "06:30" + 100 min → local wall-clock "2027-08-26T08:10". */
export function localDateTime(date: string, time: string, plusMinutes = 0): string {
  const ms = Date.parse(`${date}T${time}:00Z`) + plusMinutes * 60_000;
  return new Date(ms).toISOString().slice(0, 16);
}

/**
 * A transport fixture as an option found for `originKey` and the stay `window`: it leaves on the
 * first day and comes back on the last. Cars have no departure time (the driver chooses), and the
 * comfort is left empty for core/comfort.ts to work out.
 */
export function transportOptionOf(fixture: TransportFixture, originKey: string, window: DateRange): TransportOptionInput {
  const timed = fixture.departTime !== null;
  return {
    originKey,
    mode: fixture.mode,
    provider: fixture.provider,
    variant: fixture.variant,
    outDepartAt: timed ? localDateTime(window.from, fixture.departTime!) : null,
    outArriveAt: timed ? localDateTime(window.from, fixture.departTime!, fixture.durationMin) : null,
    backDepartAt: timed ? localDateTime(window.to, RETURN_TIME) : null,
    backArriveAt: timed ? localDateTime(window.to, RETURN_TIME, fixture.durationMin) : null,
    outDurationMin: fixture.durationMin,
    backDurationMin: fixture.durationMin,
    stops: fixture.stops,
    priceEur: fixture.priceEur,
    priceUnit: fixture.priceUnit,
    lastMileEur: fixture.lastMileEur ?? 0,
    comfortScore: null,
    comfortLevel: null,
    url: null,
    raw: { fixture: true, label: fixture.label },
  };
}

/**
 * A stay fixture as an offer for the stay `window`. The fixture prices are for the scenario's 10
 * nights; another length of stay costs the same per night. Null when there is no night to sell.
 */
export function stayOptionOf(fixture: StayFixture, window: DateRange): StayOptionInput | null {
  const nights = nightsBetween(window);
  if (nights < 1) return null;
  return {
    provider: fixture.provider,
    externalId: fixture.externalId,
    title: fixture.title,
    photos: [],
    capacity: fixture.capacity,
    rooms: fixture.rooms,
    beds: fixture.beds,
    checkIn: window.from,
    checkOut: window.to,
    totalPriceEur: nights === SCENARIO_NIGHTS ? fixture.totalPriceEur : Math.round((fixture.totalPriceEur / SCENARIO_NIGHTS) * nights),
    rating: null,
    reviewsSample: null,
    url: null,
    raw: { fixture: true },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The Extra (use-cases.md UC-D, R10 to R12): what the AI and the surveys would have found for the scenario. Plausible
// estimates for testing the rules, not quotes, like the prices above. They have no table yet: T8.3 and T8.4 store them,
// and the seed writes them then. Until then the tests read them from here (tests/helpers/extras.ts).

const ai = (eur: number): LocalPrice => ({ eur, source: "ai" });

/** Local prices at each destination, one adult */
export const localPriceFixtures: Record<DestinationKey, LocalPrices> = {
  barcelona: {
    groceriesPerDay: ai(12), cheapMeal: ai(15), midMeal: ai(30), drink: ai(6), clubEntry: ai(15), preDrinks: ai(4),
    transitTicket: ai(2.5), transitDayPass: ai(10), taxiStart: ai(2.5), taxiPerKm: ai(1.5), parkingPerDay: ai(15),
    carRentalPerDay: ai(45), fuelPerL: { eur: 1.6, source: "open-data" },
  },
  "la-reunion": {
    groceriesPerDay: ai(15), cheapMeal: ai(18), midMeal: ai(30), drink: ai(5), clubEntry: ai(12), preDrinks: ai(4),
    transitTicket: ai(2), transitDayPass: ai(6), taxiStart: ai(3), taxiPerKm: ai(2), parkingPerDay: ai(8),
    carRentalPerDay: ai(40), fuelPerL: ai(1.9),
  },
  "mont-saxonnex": {
    groceriesPerDay: ai(15), cheapMeal: ai(18), midMeal: ai(28), drink: ai(6), clubEntry: ai(15), preDrinks: ai(4),
    transitTicket: ai(2.5), transitDayPass: ai(10), taxiStart: ai(4), taxiPerKm: ai(2), parkingPerDay: ai(10),
    carRentalPerDay: ai(55), fuelPerL: { eur: 1.8, source: "open-data" },
  },
};

const noAmenities = { spa: false, pool: false, sauna: false, view: false };

/** What is known about each stay of §1.3 and around it, by its `externalId` */
export const stayFactFixtures: Record<string, StayFacts> = {
  "fixture-barcelona-gracia": {
    provider: "airbnb", kitchen: true, freeParking: false, amenities: noAmenities, calmWords: false, quietRules: false,
    supermarketKm: 0.2, centreKm: 2, historicCentreKm: 2.2, nightlifeKm: 0.3, natureKm: null, barsWithin500m: 40, sightsWithin1Km: 3,
    nightlife: { transitBack: true, taxiBackKm: 2 },
    // Catalonia, 7 nights at most; this listing's host collects it at check-in (Airbnb does for some listings only)
    touristTax: { perNightEur: 5, maxNights: 7, included: false, source: "ai" },
  },
  "fixture-barcelona-cuatro-naciones": {
    provider: "booking", kitchen: false, freeParking: false, amenities: noAmenities, calmWords: false, quietRules: false,
    supermarketKm: 0.3, centreKm: 0.3, historicCentreKm: 0.1, nightlifeKm: 0.2, natureKm: null, barsWithin500m: 60, sightsWithin1Km: 12,
    nightlife: { transitBack: true, taxiBackKm: 1 },
    touristTax: { perNightEur: 6, maxNights: 7, included: false, source: "ai" },
  },
  "fixture-reunion-saint-gilles": {
    provider: "airbnb", kitchen: true, freeParking: true, amenities: { ...noAmenities, pool: true, view: true }, calmWords: true, quietRules: false,
    supermarketKm: 0.8, centreKm: 1, historicCentreKm: null, nightlifeKm: 1.5, natureKm: 12, barsWithin500m: 4, sightsWithin1Km: 1,
    nightlife: { transitBack: false, taxiBackKm: 3 },
    // Saint-Paul taxes "au réel": Airbnb collects it
    touristTax: { perNightEur: 1.5, maxNights: null, included: true, source: "open-data" },
  },
  "fixture-mont-saxonnex-bargy": {
    provider: "airbnb", kitchen: true, freeParking: true, amenities: { ...noAmenities, view: true }, calmWords: true, quietRules: false,
    supermarketKm: 4, centreKm: 1.5, historicCentreKm: null, nightlifeKm: null, natureKm: 0, barsWithin500m: 0, sightsWithin1Km: 0,
    nightlife: null,
    touristTax: { perNightEur: 1, maxNights: null, included: true, source: "open-data" },
  },
};

/** From each stay to the airport its guests land at: by road, and the public transport Transitous would find by day */
export type HubFixture = { hub: string; km: number; transit: { durationMin: number; fareEur: number }; transitHours: { from: string; to: string } };

export const hubFixtures: Record<string, HubFixture> = {
  "fixture-barcelona-gracia": { hub: "BCN", km: 16, transit: { durationMin: 45, fareEur: 7 }, transitHours: { from: "05:30", to: "23:30" } },
  "fixture-barcelona-cuatro-naciones": { hub: "BCN", km: 14, transit: { durationMin: 35, fareEur: 7 }, transitHours: { from: "05:30", to: "23:30" } },
  "fixture-reunion-saint-gilles": { hub: "RUN", km: 45, transit: { durationMin: 75, fareEur: 5 }, transitHours: { from: "06:00", to: "20:00" } },
  // A bus via Cluses: it exists, but takes longer than the transfer allows
  "fixture-mont-saxonnex-bargy": { hub: "GVA", km: 45, transit: { durationMin: 105, fareEur: 12 }, transitHours: { from: "06:00", to: "20:00" } },
};

/** The way between a stay and its airport at a local time "2027-08-26T23:30": no public transport outside its hours */
export function transferLegOf(stayExternalId: string, at: string): TransferLeg {
  const hub = hubFixtures[stayExternalId];
  const time = at.slice(11, 16);
  const running = time >= hub.transitHours.from && time <= hub.transitHours.to;
  return { at, hub: hub.hub, km: hub.km, transit: running ? hub.transit : null };
}

const activity = (name: string, kind: ExtraActivity["kind"], priceEur: number, roadKmFromStay: number, transit: ExtraActivity["transit"] = null, durationH: number | null = null): ExtraActivity => ({
  name, kind, priceEur, durationH, roadKmFromStay, transit, source: "ai",
});

/** What the AI would list for each destination's objective, most worthwhile first */
export const activityFixtures: Record<DestinationKey, ExtraActivity[]> = {
  // Partying: the nights out are priced from the club entry and the drinks, not from a list
  barcelona: [],
  "la-reunion": [
    activity("Spa session in Saint-Gilles", "spa", 60, 3, { durationMin: 20, fareEur: 4 }, 2),
    activity("Boucan Canot beach", "beach", 0, 2),
    activity("The lagoon at L'Hermitage", "beach", 0, 4),
  ],
  "mont-saxonnex": [
    activity("Lac de Bénit and the Pointe d'Orchez", "hike", 0, 0, null, 5),
    activity("Plateau de Solaison", "hike", 0, 15, null, 4),
    activity("Lake Annecy, Doussard beach", "beach", 5, 45, { durationMin: 130, fareEur: 14 }),
    activity("Cascade du Rouget", "hike", 0, 25, null, 3),
    activity("Aiguille du Midi cable car", "viewpoint", 75, 60, { durationMin: 95, fareEur: 16 }, 4),
    activity("Parc de Merlet", "park", 12, 55, null, 3),
  ],
};

// ── The reference facts as the app stores them (T8.9): the seed and the tests write the same ─────────────────────────

/** What a stay's page would have said (T8.2): its amenities and its tax, as `raw_json` keeps them */
export function fixtureStayRaw(externalId: string): { amenities: string[]; touristTax: { included: boolean | null; amountEur: number | null; perPersonNightEur: number | null; maxNights: number | null; basis: string | null } } | null {
  const facts = stayFactFixtures[externalId];
  if (!facts) return null;
  const tax = facts.touristTax;
  return {
    amenities: [
      ...(facts.kitchen ? ["Kitchen"] : []),
      ...(facts.freeParking ? ["Free parking on premises"] : []),
      ...(facts.amenities.pool ? ["Pool"] : []),
      ...(facts.amenities.sauna ? ["Sauna"] : []),
      ...(facts.amenities.spa ? ["Spa"] : []),
      ...(facts.amenities.view ? ["Mountain view"] : []),
      "Wifi",
    ],
    touristTax: tax?.included
      ? { included: true, amountEur: null, perPersonNightEur: null, maxNights: null, basis: "airbnb-collects" }
      : { included: tax ? false : null, amountEur: null, perPersonNightEur: tax?.perNightEur ?? null, maxNights: tax?.maxNights ?? null, basis: tax ? "host-says-not-included" : null },
  };
}

/** What is around a stay (T8.3) and how it is reached from its airport (T8.6), as `place_surveys.facts_json` keeps it */
export function fixtureSurveyFacts(externalId: string, airport: (code: string) => { lat: number; lon: number } | null): Record<string, unknown> | null {
  const facts = stayFactFixtures[externalId];
  const hub = hubFixtures[externalId];
  if (!facts || !hub) return null;
  return {
    centreKm: facts.centreKm,
    supermarketKm: facts.supermarketKm,
    barsWithin500m: facts.barsWithin500m,
    nightclubsWithin1Km: 0,
    sightsWithin1Km: facts.sightsWithin1Km,
    nightlifeKm: facts.nightlifeKm,
    historicCentreKm: facts.historicCentreKm,
    natureKm: facts.natureKm,
    searchedKm: { supermarket: 5, nature: 40 },
    // The airport line's own fare (7 € for Barcelona's airport bus), not a plain ticket
    access: { transfers: [{ hub: hub.hub, ...(airport(hub.hub) ?? { lat: 0, lon: 0 }), km: hub.km, transitMin: hub.transit.durationMin, fareEur: hub.transit.fareEur }], nightBus: facts.nightlife?.transitBack ?? null },
  };
}

/**
 * The things to do as `extra_activities` keeps them, for a destination whose point is `centre`: each put north of it so
 * that its road from there is the fixture's (T8.6), with its public transport from there
 */
export function fixtureActivityRows(key: DestinationKey, centre: { lat: number; lon: number }) {
  return activityFixtures[key].map((activity, index) => ({
    rank: index + 1,
    name: activity.name,
    kind: activity.kind,
    priceEur: activity.priceEur,
    durationH: activity.durationH,
    note: null,
    mapName: activity.name,
    lat: centre.lat + activity.roadKmFromStay / 1.3 / 110.574,
    lon: centre.lon,
    roadKmFromCentre: activity.roadKmFromStay,
    transitMinFromCentre: activity.transit?.durationMin ?? null,
    source: activity.source,
  }));
}
