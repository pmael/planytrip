// Source of truth for the schema, kept in sync with database.md.
// Conventions: ids are cuid2 text, dates are ISO-8601 text, amounts are whole euros,
// `*_json` columns are JSON text validated with Zod at the service boundary.
// The enum tuples come from core/types.ts so the model has one source of truth.
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import {
  BUDGET_LEVELS,
  COMFORT_LEVELS,
  JOB_STATUSES,
  JOB_TYPES,
  OBJECTIVES,
  PRICE_KINDS,
  PRICE_UNITS,
  RATING_KINDS,
  RATING_SOURCES,
  SELECTION_KINDS,
  STAY_PROVIDERS,
  STAY_VERDICTS,
  TRANSPORT_MODES,
  TRANSPORT_VARIANTS,
  TRIP_STATUSES,
} from "@/core/types";

const id = () => text("id").primaryKey().$defaultFn(createId);
const now = () => sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const createdAt = () => text("created_at").notNull().default(now());

export const trips = sqliteTable("trips", {
  id: id(),
  name: text("name").notNull(),
  /** null = the whole common window */
  nights: integer("nights"),
  status: text("status", { enum: TRIP_STATUSES }).notNull().default("draft"),
  createdAt: createdAt(),
  updatedAt: text("updated_at").notNull().default(now()).$onUpdateFn(() => new Date().toISOString()),
});

export const destinations = sqliteTable(
  "destinations",
  {
    id: id(),
    tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    countryCode: text("country_code").notNull(),
    lat: real("lat").notNull(),
    lon: real("lon").notNull(),
    airportsJson: text("airports_json").notNull().default("[]"),
    /** 1 = Europe (POC scope) */
    inScope: integer("in_scope", { mode: "boolean" }).notNull().default(true),
    budgetLevel: text("budget_level", { enum: BUDGET_LEVELS }).notNull().default("medium"),
    objective: text("objective", { enum: OBJECTIVES }).notNull().default("none"),
    dateFrom: text("date_from"),
    dateTo: text("date_to"),
  },
  (t) => [index("destinations_trip_idx").on(t.tripId)],
);

export const guests = sqliteTable(
  "guests",
  {
    id: id(),
    tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    homeLabel: text("home_label").notNull(),
    homeLat: real("home_lat").notNull(),
    homeLon: real("home_lon").notNull(),
    homeAirportsJson: text("home_airports_json").notNull().default("[]"),
    /** Grouping key so guests from the same place share the same searches, e.g. MAD */
    originKey: text("origin_key").notNull(),
    maxBudgetEur: integer("max_budget_eur").notNull(),
    availableFrom: text("available_from").notNull(),
    availableTo: text("available_to").notNull(),
    preferredMode: text("preferred_mode", { enum: TRANSPORT_MODES }).notNull(),
    /** The star vote */
    favoriteDestinationId: text("favorite_destination_id").references(
      (): AnySQLiteColumn => destinations.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [
    index("guests_trip_idx").on(t.tripId),
    check("guests_budget_positive", sql`${t.maxBudgetEur} > 0`),
    check("guests_dates_ordered", sql`${t.availableTo} >= ${t.availableFrom}`),
  ],
);

/** Accepted modes (step 3). The preferred mode is always included (checked in the service). */
export const guestModes = sqliteTable(
  "guest_modes",
  {
    guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: TRANSPORT_MODES }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.guestId, t.mode] })],
);

export const routeChecks = sqliteTable(
  "route_checks",
  {
    id: id(),
    destinationId: text("destination_id").notNull().references(() => destinations.id, { onDelete: "cascade" }),
    originKey: text("origin_key").notNull(),
    mode: text("mode", { enum: TRANSPORT_MODES }).notNull(),
    reachable: integer("reachable", { mode: "boolean" }).notNull(),
    /** e.g. no_road_route */
    reason: text("reason"),
    distanceKm: integer("distance_km"),
    durationMin: integer("duration_min"),
    checkedAt: text("checked_at").notNull().default(now()),
  },
  (t) => [uniqueIndex("route_checks_unique").on(t.destinationId, t.originKey, t.mode)],
);

export const transportOptions = sqliteTable(
  "transport_options",
  {
    id: id(),
    tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    destinationId: text("destination_id").notNull().references(() => destinations.id, { onDelete: "cascade" }),
    originKey: text("origin_key").notNull(),
    mode: text("mode", { enum: TRANSPORT_MODES }).notNull(),
    /** transavia, google-flights, osrm... */
    provider: text("provider").notNull(),
    variant: text("variant", { enum: TRANSPORT_VARIANTS }).notNull().default("standard"),
    outDepartAt: text("out_depart_at"),
    outArriveAt: text("out_arrive_at"),
    backDepartAt: text("back_depart_at"),
    backArriveAt: text("back_arrive_at"),
    outDurationMin: integer("out_duration_min"),
    backDurationMin: integer("back_duration_min"),
    stops: integer("stops"),
    /** Round trip */
    priceEur: integer("price_eur").notNull(),
    priceUnit: text("price_unit", { enum: PRICE_UNITS }).notNull(),
    /** "live" is what the seller asks; "estimated" was worked out (a published range, the distance) and may be off */
    priceKind: text("price_kind", { enum: PRICE_KINDS }).notNull().default("live"),
    /** Where an estimate comes from, in a few words, for the card ("SNCF's fares for this route: 25 to 101 €") */
    priceNote: text("price_note"),
    /** The seller says no seat is left, there or back (SNCF Connect's "Complet"): kept on the page, not picked */
    soldOut: integer("sold_out", { mode: "boolean" }).notNull().default(false),
    /** Airport to lodging, round trip */
    lastMileEur: integer("last_mile_eur").notNull().default(0),
    comfortScore: integer("comfort_score"),
    comfortLevel: text("comfort_level", { enum: COMFORT_LEVELS }),
    url: text("url"),
    rawJson: text("raw_json"),
    fetchedAt: text("fetched_at").notNull().default(now()),
  },
  (t) => [
    index("transport_options_search_idx").on(t.destinationId, t.originKey, t.mode),
    check("transport_options_comfort_score_range", sql`${t.comfortScore} is null or ${t.comfortScore} between 0 and 100`),
  ],
);

export const stayOptions = sqliteTable(
  "stay_options",
  {
    id: id(),
    destinationId: text("destination_id").notNull().references(() => destinations.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: STAY_PROVIDERS }).notNull(),
    externalId: text("external_id"),
    title: text("title").notNull(),
    photosJson: text("photos_json").notNull().default("[]"),
    capacity: integer("capacity").notNull(),
    rooms: integer("rooms"),
    beds: integer("beds"),
    checkIn: text("check_in").notNull(),
    checkOut: text("check_out").notNull(),
    totalPriceEur: integer("total_price_eur").notNull(),
    rating: real("rating"),
    reviewsSampleJson: text("reviews_sample_json"),
    url: text("url"),
    rawJson: text("raw_json"),
    fetchedAt: text("fetched_at").notNull().default(now()),
  },
  (t) => [index("stay_options_price_idx").on(t.destinationId, t.totalPriceEur)],
);

/**
 * What is around a place to stay, from OpenStreetMap (task.md T8.3): one row per stay, replaced at each survey and
 * gone with the stay. `facts_json` is core/surroundings.ts's `Surroundings`.
 */
export const placeSurveys = sqliteTable(
  "place_surveys",
  {
    id: id(),
    destinationId: text("destination_id").notNull().references(() => destinations.id, { onDelete: "cascade" }),
    stayOptionId: text("stay_option_id").notNull().references(() => stayOptions.id, { onDelete: "cascade" }),
    factsJson: text("facts_json").notNull(),
    /** Where the facts come from: "openstreetmap" */
    source: text("source").notNull(),
    surveyedAt: text("surveyed_at").notNull().default(now()),
  },
  (t) => [uniqueIndex("place_surveys_one_per_stay").on(t.stayOptionId), index("place_surveys_destination_idx").on(t.destinationId)],
);

/**
 * A destination's local prices (task.md T8.4): one row per destination, given by the AI once while the trip is set up,
 * or by the rules (the EU average times the country's price level) without it. `prices_json` is core/extras.ts's
 * `LocalPrices`, each price with its own source.
 */
export const destinationPrices = sqliteTable("destination_prices", {
  id: id(),
  destinationId: text("destination_id")
    .notNull()
    .unique()
    .references(() => destinations.id, { onDelete: "cascade" }),
  pricesJson: text("prices_json").notNull(),
  /** Who gave them: the AI, or the rules when it was not available */
  source: text("source", { enum: RATING_SOURCES }).notNull(),
  /** Fingerprint of what the AI was asked: the place, the objective, the budget level, the dates */
  inputHash: text("input_hash").notNull(),
  /** Why the rules gave them, or what of the AI's answer was not kept */
  message: text("message"),
  /** The tourist tax a guest of a whole rented home pays there (core/tourist-tax.ts `TaxRule`), null when not known (T8.5) */
  touristTaxJson: text("tourist_tax_json"),
  createdAt: createdAt(),
});

/** The things to do at a destination for its objective (task.md T8.4), as the AI listed them, each found on the map. */
export const extraActivities = sqliteTable(
  "extra_activities",
  {
    id: id(),
    destinationId: text("destination_id").notNull().references(() => destinations.id, { onDelete: "cascade" }),
    /** 1 is the most worthwhile */
    rank: integer("rank").notNull(),
    objective: text("objective", { enum: OBJECTIVES }).notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    /** One adult; 0 when free */
    priceEur: real("price_eur").notNull(),
    durationH: real("duration_h"),
    note: text("note"),
    /** What it was looked up by on the map, and where the map put it; null when the map could not be asked */
    mapName: text("map_name").notNull(),
    lat: real("lat"),
    lon: real("lon"),
    /** From the destination's point (T8.6, Nature): by road (OSRM), and by public transport at 08:00 (Transitous); null when not known */
    roadKmFromCentre: real("road_km_from_centre"),
    transitMinFromCentre: integer("transit_min_from_centre"),
    source: text("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("extra_activities_destination_idx").on(t.destinationId, t.rank)],
);

/**
 * The advice on fitting a destination's Extra into the budgets (task.md T8.8, use-cases.md R12): one row per
 * destination, written by the AI once while the trip is set up (or on "Ask again"), or by the rules without it, with the
 * fingerprint of what it was written for: when that changes (a budget, the ❤ stay, an offer), it is out of date.
 */
export const extraAdvice = sqliteTable("extra_advice", {
  id: id(),
  destinationId: text("destination_id")
    .notNull()
    .unique()
    .references(() => destinations.id, { onDelete: "cascade" }),
  /** server/services/extraAdvice.ts `StoredAdvice`: the group's lines and each guest's, with the app's euros */
  payloadJson: text("payload_json").notNull(),
  source: text("source", { enum: RATING_SOURCES }).notNull(),
  inputHash: text("input_hash").notNull(),
  /** Why the rules wrote it, or how many of the AI's lines were not kept */
  message: text("message"),
  createdAt: createdAt(),
});

export const stayAnalyses = sqliteTable("stay_analyses", {
  id: id(),
  stayId: text("stay_id").notNull().unique().references(() => stayOptions.id, { onDelete: "cascade" }),
  verdict: text("verdict", { enum: STAY_VERDICTS }).notNull(),
  fitScore: integer("fit_score").notNull(),
  prosJson: text("pros_json").notNull().default("[]"),
  consJson: text("cons_json").notNull().default("[]"),
  summary: text("summary").notNull(),
  inputHash: text("input_hash").notNull(),
  createdAt: createdAt(),
});

/**
 * The AI's synthesis of a trip's destinations, written for one state of the data: `inputHash`
 * fingerprints the facts it was given, so it is known to be out of date as soon as a ★, a ❤ or a
 * budget changes. A trip keeps the few latest ones.
 */
export const destinationSyntheses = sqliteTable(
  "destination_syntheses",
  {
    id: id(),
    tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    inputHash: text("input_hash").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("destination_syntheses_trip_hash").on(t.tripId, t.inputHash)],
);

/**
 * How well one option suits the group, rated while the trip was set up (a stay or a transport option,
 * exactly one of the two). Read by the dashboard, never written by it. Deleted with its option.
 */
export const optionRatings = sqliteTable(
  "option_ratings",
  {
    id: id(),
    tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    destinationId: text("destination_id").notNull().references(() => destinations.id, { onDelete: "cascade" }),
    stayOptionId: text("stay_option_id").references(() => stayOptions.id, { onDelete: "cascade" }),
    transportOptionId: text("transport_option_id").references(() => transportOptions.id, { onDelete: "cascade" }),
    verdict: text("verdict", { enum: STAY_VERDICTS }).notNull(),
    score: integer("score").notNull(),
    reason: text("reason").notNull(),
    /** Who rated it: the AI, or the rules when the AI was not available */
    source: text("source", { enum: RATING_SOURCES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("option_ratings_one_per_stay").on(t.stayOptionId).where(sql`${t.stayOptionId} is not null`),
    uniqueIndex("option_ratings_one_per_transport").on(t.transportOptionId).where(sql`${t.transportOptionId} is not null`),
    check("option_ratings_one_target", sql`(${t.stayOptionId} is not null) + (${t.transportOptionId} is not null) = 1`),
    check("option_ratings_score_range", sql`${t.score} between 0 and 100`),
  ],
);

/**
 * One rating pass over one destination's stays or transport options: who did it, what it was shown
 * (`input_hash`, which includes the guests' budgets, so a change of budget makes it out of date) and,
 * when the rules had to do it, why the AI did not.
 */
export const ratingRuns = sqliteTable(
  "rating_runs",
  {
    id: id(),
    tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    destinationId: text("destination_id").notNull().references(() => destinations.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: RATING_KINDS }).notNull(),
    source: text("source", { enum: RATING_SOURCES }).notNull(),
    inputHash: text("input_hash").notNull(),
    /** Why the rules rated instead of the AI */
    message: text("message"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("rating_runs_one_per_destination_and_kind").on(t.destinationId, t.kind)],
);

/** A heart: the option chosen for a guest (transport) or for the whole group (stay). */
export const selections = sqliteTable(
  "selections",
  {
    id: id(),
    tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    destinationId: text("destination_id").notNull().references(() => destinations.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SELECTION_KINDS }).notNull(),
    /** Required for transport */
    guestId: text("guest_id").references(() => guests.id, { onDelete: "cascade" }),
    transportOptionId: text("transport_option_id").references(() => transportOptions.id, { onDelete: "cascade" }),
    stayOptionId: text("stay_option_id").references(() => stayOptions.id, { onDelete: "cascade" }),
    /** e.g. leaves work late */
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("selections_one_stay_per_destination")
      .on(t.destinationId, t.kind)
      .where(sql`${t.kind} = 'stay'`),
    uniqueIndex("selections_one_transport_per_guest")
      .on(t.destinationId, t.kind, t.guestId)
      .where(sql`${t.kind} = 'transport'`),
    check(
      "selections_kind_target",
      sql`(${t.kind} = 'transport' and ${t.guestId} is not null and ${t.transportOptionId} is not null and ${t.stayOptionId} is null)
        or (${t.kind} = 'stay' and ${t.stayOptionId} is not null and ${t.transportOptionId} is null)`,
    ),
  ],
);

/** Frozen copy of a validated scenario. */
export const summaries = sqliteTable("summaries", {
  id: id(),
  tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
  destinationId: text("destination_id").notNull().references(() => destinations.id, { onDelete: "cascade" }),
  snapshotJson: text("snapshot_json").notNull(),
  totalEur: integer("total_eur").notNull(),
  createdAt: createdAt(),
});

/**
 * A train and its price as the person saw them on SNCF Connect, sent by the browser extension (task.md T7.9). They are
 * kept for good: they say how wrong the estimates are and train the price model. Prices are in euros and cents (the
 * only amounts that are not whole euros: a model learns from the cents), and the station and time are the page's own.
 */
export const priceObservations = sqliteTable(
  "price_observations",
  {
    id: id(),
    /** "sncf-connect", "eurostar" or "iryo" (later "trainline") */
    source: text("source").notNull(),
    capturedAt: text("captured_at").notNull(),
    travelDate: text("travel_date").notNull(),
    /** Days from the capture to the travel date */
    daysBefore: integer("days_before").notNull(),
    /** The page was the way there or the way back */
    direction: text("direction", { enum: ["out", "back"] }),
    originLabel: text("origin_label").notNull(),
    destinationLabel: text("destination_label").notNull(),
    /** "" when the page did not say, so that the unique index below works */
    departStation: text("depart_station").notNull().default(""),
    arriveStation: text("arrive_station").notNull().default(""),
    departTime: text("depart_time").notNull(),
    arriveTime: text("arrive_time").notNull(),
    durationMin: integer("duration_min"),
    changes: integer("changes"),
    /** TGV INOUI, OUIGO, TER, INTERCITES, MIXED... null when the page did not say */
    trainType: text("train_type"),
    /** The cheapest fare still on sale ("Dès") in second class, and in first */
    price2ndEur: real("price_2nd_eur").notNull(),
    price1stEur: real("price_1st_eur"),
    /** As the crow flies, from the station it leaves to the station it arrives at; null when the stations are not known */
    distanceKm: integer("distance_km"),
    /** SNCF's published range for this pair of stations (direct TGV INOUI and OUIGO only) */
    rangeMinEur: real("range_min_eur"),
    rangeMaxEur: real("range_max_eur"),
    /** The option this train was matched with, when there is one */
    transportOptionId: text("transport_option_id").references(() => transportOptions.id, { onDelete: "set null" }),
    /** What the app estimated for this train when the page was captured, and how */
    estimateEur: real("estimate_eur"),
    estimateMethod: text("estimate_method"),
    rawJson: text("raw_json").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("price_observations_train_idx").on(t.travelDate, t.departTime),
    uniqueIndex("price_observations_once").on(t.source, t.travelDate, t.departStation, t.departTime, t.capturedAt),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    type: text("type", { enum: JOB_TYPES }).notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
    progressJson: text("progress_json"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: text("run_after").notNull().default(now()),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull().default(now()).$onUpdateFn(() => new Date().toISOString()),
  },
  (t) => [index("jobs_queue_idx").on(t.status, t.runAfter)],
);

export const scrapeCache = sqliteTable(
  "scrape_cache",
  {
    /** Request hash */
    key: text("key").primaryKey(),
    source: text("source").notNull(),
    payloadJson: text("payload_json").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("scrape_cache_expires_idx").on(t.expiresAt)],
);

export const geoCache = sqliteTable("geo_cache", {
  query: text("query").primaryKey(),
  placeJson: text("place_json").notNull(),
  createdAt: createdAt(),
});
