// Domain model shared by core/, server/, db/ and the UI. Pure types, no I/O.
// These mirror database.md, with the `*_json` columns already parsed (arrays instead of strings)
// and dates kept as ISO-8601 strings. The enum tuples are the single source of truth: the Drizzle
// schema and the Zod schemas both build on them.

export const TRIP_STATUSES = ["draft", "computing", "ready", "validated"] as const;
export const TRANSPORT_MODES = ["plane", "train", "bus", "car"] as const;
export const BUDGET_LEVELS = ["light", "medium", "high"] as const;
export const OBJECTIVES = ["partying", "chill", "culture", "nature", "none"] as const;
export const TRANSPORT_VARIANTS = ["standard", "tolls", "no_tolls", "overnight_stop"] as const;
export const PRICE_UNITS = ["per_person", "per_vehicle"] as const;
/**
 * A price the seller asks ("live"), one worked out from a published range, the distance or a model ("estimated"), or one
 * the person saw on the seller's own page a short while ago ("observed", never stored on an option: it is laid over it when read).
 */
export const PRICE_KINDS = ["live", "estimated", "observed"] as const;
export const COMFORT_LEVELS = ["green", "yellow", "red"] as const;
export const STAY_PROVIDERS = ["airbnb", "booking"] as const;
export const STAY_VERDICTS = ["good", "ok", "bad"] as const;
export const SELECTION_KINDS = ["transport", "stay"] as const;
export const JOB_TYPES = ["compute_trip", "search_transport", "search_stays", "survey_places", "price_destination", "rate_stays", "rate_transport", "advise_extras", "analyze_stay", "synthesize_destinations"] as const;
export const RATING_SOURCES = ["ai", "rules"] as const;
export const RATING_KINDS = ["stays", "transport"] as const;
export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export const BUDGET_TIERS = ["comfy", "limited", "over"] as const;
export const TRENDS = ["▲", "▼", "≈"] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];
export type TransportMode = (typeof TRANSPORT_MODES)[number];
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];
export type Objective = (typeof OBJECTIVES)[number];
export type TransportVariant = (typeof TRANSPORT_VARIANTS)[number];
export type PriceUnit = (typeof PRICE_UNITS)[number];
export type PriceKind = (typeof PRICE_KINDS)[number];
export type ComfortLevel = (typeof COMFORT_LEVELS)[number];
export type StayProvider = (typeof STAY_PROVIDERS)[number];
export type RatingSource = (typeof RATING_SOURCES)[number];
export type RatingKind = (typeof RATING_KINDS)[number];
export type StayVerdict = (typeof STAY_VERDICTS)[number];
export type SelectionKind = (typeof SELECTION_KINDS)[number];
export type JobType = (typeof JOB_TYPES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type BudgetTier = (typeof BUDGET_TIERS)[number];
export type Trend = (typeof TRENDS)[number];

/** Result of `colorOf()`: the single source of every on-screen colour (R8). */
export type Color = ComfortLevel | "neutral";

/** ISO-8601 calendar date, "2026-08-26". */
export type IsoDate = string;
/** ISO-8601 timestamp, "2026-08-26T06:30:00.000Z". */
export type IsoDateTime = string;

/** Inclusive range of calendar days. */
export type DateRange = { from: IsoDate; to: IsoDate };

/** A resolved place: geocoding result plus the airports within reach. */
export type GeoPlace = {
  label: string;
  /** ISO 3166-1 alpha-2, e.g. "ES" */
  countryCode: string;
  lat: number;
  lon: number;
  /** IATA codes, nearest first */
  airports: string[];
};

export type Trip = {
  id: string;
  name: string;
  /** null = the whole common window */
  nights: number | null;
  status: TripStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type Guest = {
  id: string;
  tripId: string;
  name: string;
  homeLabel: string;
  homeLat: number;
  homeLon: number;
  homeAirports: string[];
  /** Guests from the same place share the same searches, e.g. "MAD" */
  originKey: string;
  maxBudgetEur: number;
  availableFrom: IsoDate;
  availableTo: IsoDate;
  preferredMode: TransportMode;
  /** The ★ vote */
  favoriteDestinationId: string | null;
};

/** Accepted transport modes per guest id (step 3). Always contains the guest's preferred mode. */
export type GuestModes = Record<string, TransportMode[]>;

export type Destination = {
  id: string;
  tripId: string;
  label: string;
  countryCode: string;
  lat: number;
  lon: number;
  airports: string[];
  /** Europe, the POC scope. Out-of-scope destinations are computed but flagged. */
  inScope: boolean;
  budgetLevel: BudgetLevel;
  objective: Objective;
  dateFrom: IsoDate | null;
  dateTo: IsoDate | null;
};

export type RouteCheck = {
  id: string;
  destinationId: string;
  originKey: string;
  mode: TransportMode;
  reachable: boolean;
  /** e.g. "no_road_route" */
  reason: string | null;
  distanceKm: number | null;
  durationMin: number | null;
  checkedAt: IsoDateTime;
};

/**
 * How well an option suits the group, as rated while the trip was set up: by the AI, or by simple
 * rules when the AI was not available (`source`). The dashboard only reads it, it never asks the AI.
 */
export type OptionRating = {
  verdict: StayVerdict;
  /** 0-100 */
  score: number;
  /** One short sentence, with the figures behind it */
  reason: string;
  source: RatingSource;
};

export type TransportOption = {
  id: string;
  tripId: string;
  destinationId: string;
  originKey: string;
  mode: TransportMode;
  /** e.g. "transavia", "google-flights", "osrm" */
  provider: string;
  variant: TransportVariant;
  outDepartAt: IsoDateTime | null;
  outArriveAt: IsoDateTime | null;
  backDepartAt: IsoDateTime | null;
  backArriveAt: IsoDateTime | null;
  outDurationMin: number | null;
  backDurationMin: number | null;
  stops: number | null;
  /** Round trip, whole euros */
  priceEur: number;
  priceUnit: PriceUnit;
  /** "estimated": worked out, not asked by the seller (trains whose fare is only known as a range or from the distance) */
  priceKind: PriceKind;
  /** Where an estimate comes from, in a few words */
  priceNote: string | null;
  /** The seller says no seat is left, there or back: shown, never picked while another option is left. The price is then an estimate */
  soldOut: boolean;
  /** Airport to lodging, round trip */
  lastMileEur: number;
  /** 0-100, drives the "Most Practical" sort */
  comfortScore: number | null;
  comfortLevel: ComfortLevel | null;
  /** The AI's (or the rules') rating of this option for the group; null until the trip has been rated */
  rating?: OptionRating | null;
  url: string | null;
  fetchedAt: IsoDateTime;
};

export type StayOption = {
  id: string;
  destinationId: string;
  provider: StayProvider;
  externalId: string | null;
  title: string;
  photos: string[];
  capacity: number;
  rooms: number | null;
  beds: number | null;
  checkIn: IsoDate;
  checkOut: IsoDate;
  /** Whole stay, whole euros */
  totalPriceEur: number;
  rating: number | null;
  reviewsSample: string[] | null;
  url: string | null;
  fetchedAt: IsoDateTime;
};

export type StayAnalysis = {
  id: string;
  stayId: string;
  /** The rating's verdict when the stay was rated while the trip was set up, else the analysis's own */
  verdict: StayVerdict;
  /** 0-100, likewise */
  fitScore: number;
  pros: string[];
  cons: string[];
  summary: string;
  inputHash: string;
  createdAt: IsoDateTime;
  /** Who rated it, when it was rated while the trip was set up */
  ratedBy?: RatingSource;
  /** The rating's one-line reason */
  ratingReason?: string;
  /** Whether "Why this?" has been asked: pros, cons and summary are then the AI's explanation */
  explained?: boolean;
};

/** What a card shows of a stay's rating: the score, who gave it, and the AI's explanation when it was asked for. */
export type StayJudgement = Pick<StayAnalysis, "verdict" | "fitScore" | "summary" | "pros" | "cons"> & {
  /** Who rated it: the AI, or the rules ("not rated by the AI"); null for an analysis made before ratings existed */
  ratedBy: RatingSource | null;
  /** Whether "Why this?" has been answered: only then are the pros, cons and summary the AI's own words */
  explained: boolean;
};

/** A ❤ on one transport option, for one guest. */
export type TransportSelection = {
  id: string;
  tripId: string;
  destinationId: string;
  kind: "transport";
  guestId: string;
  transportOptionId: string;
  reason: string | null;
  createdAt: IsoDateTime;
};

/** A ❤ on one stay, for the whole group (unique per destination). */
export type StaySelection = {
  id: string;
  tripId: string;
  destinationId: string;
  kind: "stay";
  stayOptionId: string;
  reason: string | null;
  createdAt: IsoDateTime;
};

export type Selection = TransportSelection | StaySelection;

/** Frozen copy of a validated scenario. */
export type Summary<Snapshot = unknown> = {
  id: string;
  tripId: string;
  destinationId: string;
  /** Parsed `snapshot_json`: the options, prices, links and per-guest costs at validation time */
  snapshot: Snapshot;
  totalEur: number;
  createdAt: IsoDateTime;
};

/** How far each step of a job is, keyed by the step's name, e.g. "routes" → { done: 2, total: 6 } */
export type JobProgress = Record<string, { done: number; total: number }>;

export type Job = {
  id: string;
  tripId: string;
  type: JobType;
  payload: unknown;
  status: JobStatus;
  progress: JobProgress | null;
  error: string | null;
  attempts: number;
  runAfter: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

/** What a ❤ would change for each guest, shown as the "Jessy +70 €" toast. */
export type BudgetDelta = {
  perGuest: { guestId: string; before: number; after: number; tier: BudgetTier }[];
  totalBefore: number;
  totalAfter: number;
  warnings: string[];
};

/** A trip with what the wizard and the dashboard need around it. */
export type TripDetails = Trip & {
  guests: Guest[];
  /** The modes each guest accepts (step 3), keyed by guest id */
  guestModes: GuestModes;
  destinations: Destination[];
  /** Days everyone is available, null when there is none (or no guest yet) */
  commonWindow: DateRange | null;
};
