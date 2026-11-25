// Prices seen on SNCF Connect (task.md T7.9, price-model.md): matching a train of a page with a train of an option, and
// the simple estimates the app can be compared with. Pure: nothing here reads the database.
import { z } from "zod";
import { sameStation } from "./stations";
import type { PriceKind } from "./types";

// ── Matching ────────────────────────────────────────────────────────────────

/** One way of an option: its first train's departure and where the journey starts and ends (with where those stations are, when known). */
export type OptionWay = { departAt: string; from: string; to: string; fromPoint?: { lat: number; lon: number }; toPoint?: { lat: number; lon: number } };

/** What an option's search kept of each way: the journey, and the price it was given. */
export type OptionPrice = { priceEur: number; kind: Exclude<PriceKind, "observed">; note: string | null; source: string };
export type OptionRaw = { out: { way: OptionWay; price: OptionPrice } | null; back: { way: OptionWay; price: OptionPrice } | null };

const Station = z.looseObject({ name: z.string(), lat: z.number().optional(), lon: z.number().optional() });
const Leg = z.looseObject({ from: Station, to: Station, departAt: z.string() });
const Way = z.looseObject({
  legs: z.array(Leg).min(1),
  price: z.looseObject({ priceEur: z.number(), kind: z.enum(["live", "estimated"]), note: z.string().nullish(), source: z.string() }).optional(),
});
const Raw = z.looseObject({ out: Way.optional(), back: Way.optional() });

/** The trains of an option, from what its search kept (`raw_json`). Null for an option that kept nothing of the kind (a bus, an old option). */
export function optionRaw(rawJson: string | null): OptionRaw | null {
  if (!rawJson) return null;
  let parsed: z.infer<typeof Raw>;
  try {
    const result = Raw.safeParse(JSON.parse(rawJson));
    if (!result.success) return null;
    parsed = result.data;
  } catch {
    return null;
  }
  const point = (s: z.infer<typeof Station>) => (s.lat !== undefined && s.lon !== undefined ? { lat: s.lat, lon: s.lon } : undefined);
  const way = (w: z.infer<typeof Way> | undefined) =>
    w && w.price
      ? {
          way: {
            departAt: w.legs[0].departAt,
            from: w.legs[0].from.name,
            to: w.legs[w.legs.length - 1].to.name,
            fromPoint: point(w.legs[0].from),
            toPoint: point(w.legs[w.legs.length - 1].to),
          },
          price: { priceEur: w.price.priceEur, kind: w.price.kind, note: w.price.note ?? null, source: w.price.source },
        }
      : null;
  const [out, back] = [way(parsed.out), way(parsed.back)];
  return out || back ? { out, back } : null;
}

/** A train of a page: the day, when it leaves and the stations (empty when the page did not say). */
export type ObservedTrain = { travelDate: string; departTime: string; departStation: string; arriveStation: string };

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/**
 * The same train: the same day, leaving within `toleranceMin` minutes, and every station the page gave is the way's own.
 * A page that gave no station at all cannot say which train it is.
 */
export function sameTrain(seen: ObservedTrain, way: OptionWay, toleranceMin: number): boolean {
  if (way.departAt.slice(0, 10) !== seen.travelDate) return false;
  if (Math.abs(minutesOf(way.departAt.slice(11, 16)) - minutesOf(seen.departTime)) > toleranceMin) return false;
  if (!seen.departStation && !seen.arriveStation) return false;
  return (!seen.departStation || sameStation(seen.departStation, way.from)) && (!seen.arriveStation || sameStation(seen.arriveStation, way.to));
}

// ── What the app would estimate, to compare ─────────────────────────────────

export type BaselineMethod = "per_km" | "range_mid" | "range_max";
export type BaselineInput = { distanceKm: number | null; rangeMinEur: number | null; rangeMaxEur: number | null };

/** What each simple method estimates for a train, or null when it has what it needs from nothing. */
export function baselineEstimate(method: BaselineMethod, input: BaselineInput, perKm: { eurPerKm: number; minEur: number }): number | null {
  switch (method) {
    case "per_km":
      return input.distanceKm === null ? null : Math.max(perKm.minEur, input.distanceKm * perKm.eurPerKm);
    case "range_mid":
      return input.rangeMinEur === null || input.rangeMaxEur === null ? null : (input.rangeMinEur + input.rangeMaxEur) / 2;
    case "range_max":
      return input.rangeMaxEur;
  }
}

/** The name a method goes by on the pages: "per_km_0.15" says which rate. */
export const methodLabel = (method: BaselineMethod, perKm: { eurPerKm: number }) => (method === "per_km" ? `per_km_${perKm.eurPerKm}` : method);

// ── Trains, in the page's words ─────────────────────────────────────────────

/** What the extension calls the type of a train, from its logo and its text. */
export const TRAIN_TYPES = ["TGV INOUI", "OUIGO", "INTERCITES", "TER", "TGV LYRIA", "EUROSTAR", "TRENITALIA", "MIXED"] as const;
export type TrainType = (typeof TRAIN_TYPES)[number];

/** The same words for a journey of the timetable, one train name per leg ("TGV INOUI 6871", "IC 4758", "TER 876256"). */
export function trainTypeOfLegs(legs: { train: string }[]): TrainType | null {
  const types = legs.map(({ train }): TrainType | null => {
    if (/^OUIGO/i.test(train)) return "OUIGO";
    if (/^TGV INOUI/i.test(train)) return "TGV INOUI";
    if (/^TGV LYRIA/i.test(train)) return "TGV LYRIA";
    if (/^(IC|INTERCIT)/i.test(train)) return "INTERCITES";
    if (/^TER/i.test(train)) return "TER";
    if (/^EUROSTAR|^ES\b/i.test(train)) return "EUROSTAR";
    return null;
  });
  // A journey with changes is MIXED, as the page calls one whose trains it does not name
  if (legs.length > 1) return "MIXED";
  return types[0];
}

/** The carrier whose fare range SNCF publishes, for a direct train of a page; null for any other. */
export const rangeCarrierOf = (trainType: string | null, changes: number | null): "TGV INOUI" | "OUIGO" | null =>
  changes === 0 && (trainType === "TGV INOUI" || trainType === "OUIGO") ? trainType : null;
