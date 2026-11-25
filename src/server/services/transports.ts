// The Transports page: how one guest can get to a destination, mode by mode (use-cases.md UC-B
// B-S1 to B-S3, A-S7, A-S8). Each mode has a "Cheapest" and a "Most Practical" card, and the rest
// of its options (the uncomfortable ones last) are under "More".
import { and, eq } from "drizzle-orm";
import { clockComfort } from "@/core/comfort";
import { colorOf } from "@/core/colors";
import { tripWindow } from "@/core/dates";
import { transportCostFor } from "@/core/pricing";
import { isVerifiedUnreachable } from "@/core/reachability";
import { recommendedDestination } from "@/core/recommend";
import { pickCheapest, pickMostPractical, rateOptions } from "@/core/scenario";
import {
  TRANSPORT_MODES,
  type Color,
  type ComfortLevel,
  type IsoDate,
  type OptionRating,
  type PriceKind,
  type PriceUnit,
  type TransportMode,
  type TransportVariant,
} from "@/core/types";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { NotFoundError } from "../errors";
import type { TransportSort } from "../schemas";
import { destinationChoices, type DestinationChoice, type NotReady } from "./dashboard";
import { loadTripScenarios } from "./scenarios";

/** One way of a trip. Cars have no clock times: the driver chooses when to leave. */
export type TransportLeg = {
  date: IsoDate | null;
  departTime: string | null;
  arriveTime: string | null;
  departColor: Color;
  arriveColor: Color;
  /** 1 when the arrival is the next day, and so on */
  arrivesDaysLater: number;
  durationMin: number | null;
};

export type TransportCard = {
  id: string;
  mode: TransportMode;
  provider: string;
  variant: TransportVariant;
  /** What the guest pays for it, whole trip (R5): the fare plus the last mile, or their share of the car */
  costEur: number;
  /** Cheaper is greener, among everything this guest could take to this destination */
  priceColor: Color;
  priceUnit: PriceUnit;
  /** "estimated": worked out from a published range or the distance, not asked by the seller */
  priceKind: PriceKind;
  /** Where an estimate comes from, in a few words */
  priceNote: string | null;
  /** The seller has no seat left on it: shown, not picked */
  soldOut: boolean;
  lastMileEur: number;
  stops: number | null;
  comfort: { level: ComfortLevel; color: Color; score: number; reasons: string[] };
  /** How the AI (or the rules, when it was not available) rated it for the group while the trip was set up; null when nothing did */
  rating: OptionRating | null;
  out: TransportLeg;
  back: TransportLeg;
  url: string | null;
  /** The guest's ❤ is on this one */
  hearted: boolean;
  /** The budget is worked out with this one (the ❤, or else R3's pick) */
  inBudget: boolean;
};

export type TransportColumn = {
  mode: TransportMode;
  /** "Cheapest": the cheapest option that is not red. Null when there is none (B-S1) */
  cheapest: TransportCard | null;
  /** "Most Practical": the best comfort score (B-S2) */
  practical: TransportCard | null;
  /** Everything else, red options at the end */
  more: TransportCard[];
  /** Why nothing is offered: the route check found no way (e.g. "no_road_route"), else null */
  blockedReason: string | null;
  /** Nothing was found and the mode is not blocked: the sources had no offer */
  empty: boolean;
};

export type TransportGuest = { id: string; name: string; originKey: string; originLabel: string };

export type TransportView =
  | NotReady
  | {
      kind: "ready";
      tripId: string;
      destinations: DestinationChoice[];
      selectedId: string;
      destinationLabel: string;
      guests: TransportGuest[];
      guestId: string;
      /** None of the guest's accepted modes gets there: the budget assumes `fallbackMode` */
      unreachable: { reason: string | null; fallbackMode: TransportMode | null } | null;
      columns: TransportColumn[];
    };

export type TransportViewOptions = {
  destinationId?: string;
  guestId?: string;
  /** Only this mode's column */
  mode?: TransportMode;
  /** How "More" is ordered (red options stay last either way) */
  sort?: TransportSort;
  /** Keep the red options in "More". The page does; the API leaves them out unless asked */
  includeRed?: boolean;
};

const dayOf = (localDateTime: string) => localDateTime.slice(0, 10);
const clockOf = (localDateTime: string) => localDateTime.slice(11, 16);

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function legOf(
  departAt: string | null,
  arriveAt: string | null,
  durationMin: number | null,
  fallbackDate: IsoDate | null,
): TransportLeg {
  const colorOfClock = (at: string | null) => colorOf("comfort", clockComfort(at));
  return {
    date: departAt ? dayOf(departAt) : fallbackDate,
    departTime: departAt ? clockOf(departAt) : null,
    arriveTime: arriveAt ? clockOf(arriveAt) : null,
    departColor: colorOfClock(departAt),
    arriveColor: colorOfClock(arriveAt),
    arrivesDaysLater: departAt && arriveAt ? Math.max(0, daysBetween(dayOf(departAt), dayOf(arriveAt))) : 0,
    durationMin,
  };
}

const cityOf = (label: string) => label.split(",")[0];
const MODE_ORDER = new Map(TRANSPORT_MODES.map((mode, index) => [mode, index]));

/** The rating says not to offer it: it goes last in "More". */
const isNotRecommended = (card: TransportCard) => card.rating?.verdict === "bad";

/** How "More" is ordered within the comfortable options and within the red ones. */
const orderOf = (sort: TransportSort) => (a: TransportCard, b: TransportCard) =>
  sort === "practical" ? b.comfort.score - a.comfort.score || a.costEur - b.costEur : a.costEur - b.costEur || b.comfort.score - a.comfort.score;

/**
 * How one guest can get to a destination (the recommended one by default; the first guest by
 * default). Null when the trip does not exist.
 */
export function getTransportView(db: Db, tripId: string, options: TransportViewOptions = {}): TransportView | null {
  const loaded = loadTripScenarios(db, tripId);
  if (!loaded) return null;
  const { trip, scenarios, ranked } = loaded;
  if (!(trip.status === "ready" || trip.status === "validated") || scenarios.length === 0 || trip.guests.length === 0) {
    return { kind: "not-ready", tripId, status: trip.status };
  }

  const recommended = recommendedDestination(ranked)?.destinationId;
  const scenario =
    scenarios.find((s) => s.destinationId === options.destinationId) ??
    scenarios.find((s) => s.destinationId === (recommended ?? ranked[0].destinationId))!;
  const destination = trip.destinations.find((d) => d.id === scenario.destinationId)!;
  const guest = trip.guests.find((g) => g.id === options.guestId) ?? trip.guests[0];
  const guestScenario = scenario.guests.find((g) => g.guestId === guest.id)!;
  const chosen = guestScenario.transport;

  const checks = loaded.checks.filter((check) => check.destinationId === destination.id && check.originKey === guest.originKey);
  const blockedReasonOf = (mode: TransportMode) =>
    checks.find((check) => check.mode === mode && isVerifiedUnreachable(check))?.reason ?? null;

  // Rated against the other options of the same route, so only this destination's are given
  const { rated, comforts } = rateOptions(loaded.options.filter((option) => option.destinationId === destination.id));
  const mine = rated.filter((option) => option.originKey === guest.originKey && blockedReasonOf(option.mode) === null);
  const window = trip.commonWindow && tripWindow(trip.commonWindow, trip.nights);

  // The guest's accepted modes; a guest who cannot get there by any of them also sees the mode the budget assumes
  const accepted = trip.guestModes[guest.id] ?? [guest.preferredMode];
  const fallbackMode = guestScenario.status === "unreachable" ? (chosen?.option.mode ?? null) : null;
  const guestModes = [...new Set([...accepted, ...(fallbackMode ? [fallbackMode] : [])])].sort((a, b) => MODE_ORDER.get(a)! - MODE_ORDER.get(b)!);
  const modes = guestModes.filter((mode) => options.mode === undefined || mode === options.mode);

  // As the budget counts it: the last mile is the Extra's transfer once the Extra counts (task.md T8.9), in the fare before
  const lastMile = !scenario.withExtra;
  // A price is judged against what this guest could take, not against modes they never would
  const costs = mine.filter((option) => guestModes.includes(option.mode)).map((option) => transportCostFor(option, undefined, lastMile));

  const cards = new Map(
    mine.map((option): [string, TransportCard] => {
      const level = option.comfortLevel ?? "green";
      const cost = transportCostFor(option, undefined, lastMile);
      return [
        option.id,
        {
          id: option.id,
          mode: option.mode,
          provider: option.provider,
          variant: option.variant,
          costEur: cost,
          priceColor: colorOf("relativePrice", cost, costs),
          priceUnit: option.priceUnit,
          priceKind: option.priceKind,
          priceNote: option.priceNote,
          soldOut: option.soldOut,
          lastMileEur: lastMile ? option.lastMileEur : 0,
          stops: option.stops,
          comfort: { level, color: colorOf("comfort", level), score: option.comfortScore ?? 0, reasons: comforts.get(option.id)?.reasons ?? [] },
          rating: option.rating ?? null,
          out: legOf(option.outDepartAt, option.outArriveAt, option.outDurationMin, window?.from ?? null),
          back: legOf(option.backDepartAt, option.backArriveAt, option.backDurationMin, window?.to ?? null),
          url: option.url,
          hearted: chosen?.source === "selected" && chosen.option.id === option.id,
          inBudget: chosen?.option.id === option.id,
        },
      ];
    }),
  );

  const columns = modes.map((mode): TransportColumn => {
    const ofMode = mine.filter((option) => option.mode === mode);
    const cheapest = pickCheapest(ofMode);
    const practical = pickMostPractical(ofMode);
    const shown = new Set([cheapest?.id, practical?.id]);
    const more = ofMode
      .filter((option) => !shown.has(option.id))
      .map((option) => cards.get(option.id)!)
      .filter((card) => options.includeRed !== false || card.comfort.level !== "red")
      .sort((a, b) => Number(isNotRecommended(a)) - Number(isNotRecommended(b)) || Number(a.comfort.level === "red") - Number(b.comfort.level === "red") || orderOf(options.sort ?? "cheapest")(a, b));

    const blockedReason = blockedReasonOf(mode);
    return {
      mode,
      cheapest: cheapest ? cards.get(cheapest.id)! : null,
      practical: practical ? cards.get(practical.id)! : null,
      more,
      blockedReason,
      empty: ofMode.length === 0 && blockedReason === null,
    };
  });

  return {
    kind: "ready",
    tripId,
    destinations: destinationChoices(trip.destinations, scenarios, recommended),
    selectedId: destination.id,
    destinationLabel: cityOf(destination.label),
    guests: trip.guests.map((g) => ({ id: g.id, name: g.name, originKey: g.originKey, originLabel: cityOf(g.homeLabel) })),
    guestId: guest.id,
    unreachable: guestScenario.status === "unreachable" ? { reason: guestScenario.reason, fallbackMode } : null,
    columns,
  };
}

/**
 * The same view reached from a destination (GET /api/destinations/:id/transports). Throws when the
 * destination, or the guest asked for, does not exist.
 */
export function getDestinationTransports(db: Db, destinationId: string, options: Omit<TransportViewOptions, "destinationId"> = {}): TransportView {
  const [destination] = db
    .select({ tripId: schema.destinations.tripId })
    .from(schema.destinations)
    .where(eq(schema.destinations.id, destinationId))
    .all();
  if (!destination) throw new NotFoundError("Destination not found");

  if (options.guestId) {
    const [guest] = db
      .select({ id: schema.guests.id })
      .from(schema.guests)
      .where(and(eq(schema.guests.id, options.guestId), eq(schema.guests.tripId, destination.tripId)))
      .all();
    if (!guest) throw new NotFoundError("Guest not found");
  }
  return getTransportView(db, destination.tripId, { ...options, destinationId })!;
}
