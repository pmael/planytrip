// Zod schemas for every input of the API in task.md §4 (bodies, query strings, path ids).
// Responses are typed in core/types.ts, not validated here.
import { z } from "zod";
import {
  BUDGET_LEVELS,
  OBJECTIVES,
  SELECTION_KINDS,
  STAY_PROVIDERS,
  TRANSPORT_MODES,
} from "@/core/types";

// ── Shared pieces ──────────────────────────────────────────────────────────

export const IdSchema = z.cuid2();
export const IsoDateSchema = z.iso.date();
export const TransportModeSchema = z.enum(TRANSPORT_MODES);

const NameSchema = z.string().trim().min(1, "Required").max(100);

export const GeoPlaceSchema = z.object({
  label: z.string().trim().min(1),
  countryCode: z.string().length(2).toUpperCase(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  airports: z.array(z.string().regex(/^[A-Z]{3}$/)).max(10),
});

// ── Prices seen on SNCF Connect, Eurostar and Iryo (task.md T7.9) ────────────
// The extension reads a page and the person sees what it sends before it goes, so the messages are in French.

const Time = z.string({ error: "L'heure d'un train n'a pas été reconnue" }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, "L'heure d'un train n'a pas été reconnue");
const Station = z.string().trim().max(120).nullish();

export const PriceObservationOfferSchema = z.object({
  departTime: Time,
  arriveTime: Time,
  departStation: Station,
  arriveStation: Station,
  durationMin: z.number().int().min(0).max(3000).nullish(),
  changes: z.number().int().min(0).max(10).nullish(),
  trainType: z.string().trim().toUpperCase().max(30).nullish(),
  price2ndEur: z.number().min(0).max(5000).nullish(),
  price1stEur: z.number().min(0).max(5000).nullish(),
  seatsAtPrice: z.array(z.number().int().min(0).max(1000)).max(5).optional(),
  rawText: z.string().max(2000).optional(),
  /** What the card's logo carried (alt text, file name...), kept to learn how to tell the type of a train */
  logoHint: z.string().max(300).optional(),
});

export const PriceObservationsBodySchema = z.object({
  /** The seller whose page the person was looking at: what the extension runs on (extension/sncf-import/manifest.json) */
  source: z.enum(["sncf-connect", "eurostar", "iryo"], { error: "La source des prix n'est pas connue" }),
  pageUrl: z.string().max(2000).optional(),
  capturedAt: z.iso.datetime({ offset: true, error: "La date de la capture est invalide" }),
  direction: z.enum(["out", "back"]).nullish(),
  origin: z.string({ error: "Le trajet n'a pas été reconnu sur la page (départ)" }).trim().min(1, "Le trajet n'a pas été reconnu sur la page (départ)").max(100),
  destination: z.string({ error: "Le trajet n'a pas été reconnu sur la page (arrivée)" }).trim().min(1, "Le trajet n'a pas été reconnu sur la page (arrivée)").max(100),
  date: z.iso.date({ error: "La date du trajet n'a pas été reconnue sur la page" }),
  offers: z
    .array(PriceObservationOfferSchema, { error: "Aucun train n'a été reconnu sur la page" })
    .min(1, "Aucun train n'a été reconnu sur la page")
    .max(200, "Trop de trains dans un seul import"),
});
export type PriceObservationsBody = z.infer<typeof PriceObservationsBodySchema>;

/** Query-string flag: "1" is true, anything else (or nothing) is false. */
const FlagSchema = z
  .enum(["0", "1"])
  .optional()
  .transform((value) => value === "1");

/** Query-string list: "a,b,c" → ["a", "b", "c"]. */
const csv = <T extends z.ZodType>(item: T, { min = 0, max = Infinity } = {}) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.split(",").filter(Boolean) : value),
    z.array(item).min(min).max(max),
  );

const isOrdered = (from: string | undefined, to: string | undefined) => !from || !to || to >= from;

// ── Trips ──────────────────────────────────────────────────────────────────

/** POST /api/trips */
export const TripCreateSchema = z.object({ name: NameSchema.optional() });

/** PATCH /api/trips/:tripId. `nights: null` means the whole common window. */
export const TripUpdateSchema = z.object({
  name: NameSchema.optional(),
  nights: z.number().int().positive().nullable().optional(),
});

// ── Geo ────────────────────────────────────────────────────────────────────

/** GET /api/geo/search */
export const GeoSearchQuerySchema = z.object({ q: z.string().trim().min(2) });

// ── Guests ─────────────────────────────────────────────────────────────────

const guestShape = {
  name: NameSchema,
  /** Free text to geocode, or an already resolved place: exactly one of the two. */
  homeQuery: z.string().trim().min(2).optional(),
  homePlace: GeoPlaceSchema.optional(),
  maxBudgetEur: z.number().int().positive(),
  availableFrom: IsoDateSchema,
  availableTo: IsoDateSchema,
  preferredMode: TransportModeSchema,
};

const exactlyOneHome = (guest: { homeQuery?: unknown; homePlace?: unknown }) =>
  (guest.homeQuery === undefined) !== (guest.homePlace === undefined);

/** POST /api/trips/:tripId/guests (A-S1) */
export const GuestInputSchema = z
  .object(guestShape)
  .refine(exactlyOneHome, { message: "Give either homeQuery or homePlace", path: ["homeQuery"] })
  .refine((guest) => isOrdered(guest.availableFrom, guest.availableTo), {
    message: "availableTo must not be before availableFrom",
    path: ["availableTo"],
  });

/** PATCH /api/guests/:guestId */
export const GuestPatchSchema = z
  .object(guestShape)
  .partial()
  .refine((guest) => guest.homeQuery === undefined || guest.homePlace === undefined, {
    message: "Give either homeQuery or homePlace, not both",
    path: ["homeQuery"],
  })
  .refine((guest) => isOrdered(guest.availableFrom, guest.availableTo), {
    message: "availableTo must not be before availableFrom",
    path: ["availableTo"],
  });

/** PUT /api/guests/:guestId/modes (A-S3: at least one mode) */
export const GuestModesSchema = z.object({
  modes: z
    .array(TransportModeSchema)
    .min(1, "At least one mode")
    .transform((modes) => [...new Set(modes)]),
});

/** PUT /api/guests/:guestId/favorite. `null` clears the ★. */
export const FavoriteSchema = z.object({ destinationId: IdSchema.nullable() });

// ── Destinations ───────────────────────────────────────────────────────────

const destinationShape = {
  /** Free text to geocode, or an already resolved place: exactly one of the two. */
  query: z.string().trim().min(2).optional(),
  place: GeoPlaceSchema.optional(),
  budgetLevel: z.enum(BUDGET_LEVELS),
  objective: z.enum(OBJECTIVES),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
};

const datesOrdered = (destination: { dateFrom?: string; dateTo?: string }) =>
  isOrdered(destination.dateFrom, destination.dateTo);

/** POST /api/trips/:tripId/destinations */
export const DestinationInputSchema = z
  .object(destinationShape)
  .refine((destination) => (destination.query === undefined) !== (destination.place === undefined), {
    message: "Give either query or place",
    path: ["query"],
  })
  .refine(datesOrdered, { message: "dateTo must not be before dateFrom", path: ["dateTo"] });

/** PATCH /api/destinations/:destinationId */
export const DestinationPatchSchema = z
  .object(destinationShape)
  .partial()
  .refine((destination) => destination.query === undefined || destination.place === undefined, {
    message: "Give either query or place, not both",
    path: ["query"],
  })
  .refine(datesOrdered, { message: "dateTo must not be before dateFrom", path: ["dateTo"] });

// ── Computation and dashboard queries ──────────────────────────────────────

/**
 * POST /api/trips/:tripId/compute. `force` searches everything again; `rerate` only rates again what is
 * stored; `retry` searches again what failed last time.
 */
export const ComputeQuerySchema = z.object({ force: FlagSchema, rerate: FlagSchema, retry: FlagSchema });

/** GET /api/trips/:tripId/dashboard */
export const DashboardQuerySchema = z.object({ dest: IdSchema.optional() });

export const BUDGET_SHOWS = ["dates", "housing", "transports", "extra"] as const;

/** GET /api/trips/:tripId/budget (C-S2: the chips, multi-select) */
export const BudgetQuerySchema = z.object({
  show: csv(z.enum(BUDGET_SHOWS)).optional(),
  guest: IdSchema.optional(),
});

// ── Stays ──────────────────────────────────────────────────────────────────

/** GET /api/destinations/:destinationId/stays */
/** The Extra page (task.md T8.10): which destination, and whose view (everyone without `guest`) */
export const ExtraQuerySchema = z.object({ dest: IdSchema.optional(), guest: IdSchema.optional() });

export const StaysQuerySchema = z.object({
  provider: z.enum(STAY_PROVIDERS).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

/** GET /api/destinations/:destinationId/stays/compare (B-S7: 2 or 3 offers) */
export const StayCompareQuerySchema = z.object({ ids: csv(IdSchema, { min: 2, max: 3 }) });

// ── Transports ─────────────────────────────────────────────────────────────

/** "cheapest" = cheapest non-red option (B-S1), "practical" = best comfort score (B-S2). */
export const TRANSPORT_SORTS = ["cheapest", "practical"] as const;
export type TransportSort = (typeof TRANSPORT_SORTS)[number];

/** GET /api/destinations/:destinationId/transports */
export const TransportsQuerySchema = z.object({
  guest: IdSchema.optional(),
  mode: TransportModeSchema.optional(),
  sort: z.enum(TRANSPORT_SORTS).default("cheapest"),
  includeRed: FlagSchema,
});

/** POST /api/stays/:stayId/analysis: `refresh` asks again, for an advice that may be out of date. */
export const StayAnalysisRequestSchema = z.object({ refresh: z.boolean().default(false) });

// ── Summaries ──────────────────────────────────────────────────────────────

/** POST /api/trips/:tripId/summaries: validates a destination, freezing what the group decided. */
export const SummaryCreateSchema = z.object({ destinationId: IdSchema });

// ── AI synthesis ───────────────────────────────────────────────────────────

/** POST /api/trips/:tripId/synthesis: `refresh` asks again for what the trip looks like now. */
export const SynthesisRequestSchema = z.object({ refresh: z.boolean().default(false) });

// ── Selections (the ❤) ─────────────────────────────────────────────────────

const transportNeedsGuest = (selection: { kind: string; guestId?: string }) =>
  selection.kind !== "transport" || selection.guestId !== undefined;

/** PUT /api/destinations/:destinationId/selections. A transport ❤ belongs to a guest. */
export const SelectionInputSchema = z
  .object({
    kind: z.enum(SELECTION_KINDS),
    optionId: IdSchema,
    guestId: IdSchema.optional(),
    reason: z.string().trim().min(1).max(200).optional(),
  })
  .refine(transportNeedsGuest, { message: "guestId is required for a transport selection", path: ["guestId"] });

/** DELETE /api/destinations/:destinationId/selections */
export const SelectionClearSchema = z
  .object({ kind: z.enum(SELECTION_KINDS), guestId: IdSchema.optional() })
  .refine(transportNeedsGuest, { message: "guestId is required for a transport selection", path: ["guestId"] });

// ── Summaries ──────────────────────────────────────────────────────────────

/** POST /api/trips/:tripId/summaries */
export const SummaryInputSchema = z.object({ destinationId: IdSchema });

// ── Inferred input types ───────────────────────────────────────────────────

export type GeoPlaceInput = z.infer<typeof GeoPlaceSchema>;
export type TripCreateInput = z.infer<typeof TripCreateSchema>;
export type TripUpdateInput = z.infer<typeof TripUpdateSchema>;
export type GuestInput = z.infer<typeof GuestInputSchema>;
export type GuestPatch = z.infer<typeof GuestPatchSchema>;
/** PUT /api/settings/sncf-connect */
export const SncfConnectSettingSchema = z.object({ enabled: z.boolean() });

export type GuestModesInput = z.infer<typeof GuestModesSchema>;
export type DestinationInput = z.infer<typeof DestinationInputSchema>;
export type DestinationPatch = z.infer<typeof DestinationPatchSchema>;
export type SelectionInput = z.infer<typeof SelectionInputSchema>;
export type SelectionClear = z.infer<typeof SelectionClearSchema>;
