// Validating a destination: the group's decision, frozen (use-cases.md C-S7). The snapshot holds
// everything the summary shows (the offers with their prices and links, what each guest pays), so
// that a later recomputation cannot change what was decided. It can only be told apart from it:
// the prices stored now are compared with the frozen ones to flag the ones that moved.
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { commonWindow, nightsBetween, tripWindow } from "@/core/dates";
import { EXTRA_LINE_IDS } from "@/core/extras";
import { recommendedDestination } from "@/core/recommend";
import {
  BUDGET_LEVELS,
  BUDGET_TIERS,
  COMFORT_LEVELS,
  OBJECTIVES,
  PRICE_KINDS,
  PRICE_UNITS,
  RATING_SOURCES,
  STAY_PROVIDERS,
  STAY_VERDICTS,
  TRANSPORT_MODES,
  TRANSPORT_VARIANTS,
  type Summary,
  type TripStatus,
} from "@/core/types";
import { toSummary, toTransportOption } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { extraSections } from "@/lib/extraLines";
import { ConflictError, FieldError, NotFoundError } from "../errors";
import { extraAdviceOf } from "./extraAdvice";
import { tripExtras } from "./extras";
import { withObservedPrices } from "./observedPrices";
import { judgementOf, loadTripScenarios } from "./scenarios";
import { setTripStatus } from "./trips";

// ── What is frozen ──────────────────────────────────────────────────────────

const Nullable = <T extends z.ZodType>(schema: T) => schema.nullable();

const TransportSnapshot = z.object({
  optionId: z.string(),
  mode: z.enum(TRANSPORT_MODES),
  provider: z.string(),
  variant: z.enum(TRANSPORT_VARIANTS),
  priceEur: z.number(),
  priceUnit: z.enum(PRICE_UNITS),
  /** Summaries saved before trains had estimated prices have neither: their prices were all asked by the seller */
  priceKind: z.enum(PRICE_KINDS).optional(),
  priceNote: Nullable(z.string()).optional(),
  lastMileEur: z.number(),
  /** What this guest pays for it */
  costEur: z.number(),
  outDepartAt: Nullable(z.string()),
  outArriveAt: Nullable(z.string()),
  backDepartAt: Nullable(z.string()),
  backArriveAt: Nullable(z.string()),
  outDurationMin: Nullable(z.number()),
  backDurationMin: Nullable(z.number()),
  stops: Nullable(z.number()),
  comfortLevel: z.enum(COMFORT_LEVELS),
  comfortReasons: z.array(z.string()),
  url: Nullable(z.string()),
  /** default: the cheapest comfortable one. selected: the guest's ❤. fallback: no accepted mode gets there */
  source: z.enum(["default", "selected", "fallback"]),
});

const GuestSnapshot = z.object({
  id: z.string(),
  name: z.string(),
  home: z.string(),
  maxBudgetEur: z.number(),
  status: z.enum(["ok", "unreachable"]),
  tier: z.enum(BUDGET_TIERS),
  costEur: Nullable(z.number()),
  overBudgetEur: Nullable(z.number()),
  housingShareEur: z.number(),
  /**
   * Their Extra when it was validated (use-cases.md R10, task.md T8.9), counted in `costEur`: the Mandatory (food, the
   * transfer from the airport or station, the tourist tax) and the Plus. Summaries saved before have neither, and their
   * transport's cost has the last mile in it.
   */
  mandatoryEur: Nullable(z.number()).optional(),
  plusEur: Nullable(z.number()).optional(),
  /** Their ★ is on this destination */
  starred: z.boolean(),
  transport: Nullable(TransportSnapshot),
});

const HousingSnapshot = z.object({
  stayId: z.string(),
  provider: z.enum(STAY_PROVIDERS),
  title: z.string(),
  url: Nullable(z.string()),
  rooms: Nullable(z.number()),
  beds: Nullable(z.number()),
  capacity: z.number(),
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number(),
  totalEur: z.number(),
  perGuestEur: z.number(),
  rating: Nullable(z.number()),
  /** The group's ❤, rather than the cheapest that fits */
  chosenByGroup: z.boolean(),
  analysis: Nullable(
    z.object({
      verdict: z.enum(STAY_VERDICTS),
      fitScore: z.number(),
      summary: z.string(),
      pros: z.array(z.string()),
      cons: z.array(z.string()),
      /** Who rated it; a summary frozen before ratings existed does not say, and its score is the AI's analysis */
      ratedBy: z.enum(RATING_SOURCES).nullish(),
      /** Whether the AI explained it ("Why this?"), as opposed to only scoring it */
      explained: z.boolean().optional(),
    }),
  ),
});

/** A line of the Extra as the Extra page showed it for everyone (lib/extraLines.ts): words, formula, prices, amounts */
const ExtraLineSnapshot = z.object({
  id: z.enum(EXTRA_LINE_IDS),
  label: z.string(),
  summary: z.string(),
  formula: z.string(),
  /** Rests on an estimate: shown with ≈ */
  estimate: z.boolean(),
  rows: z.array(z.object({ label: z.string(), value: z.string(), source: Nullable(z.string()), href: z.string().optional() })),
  groupEur: z.number(),
  /** Each guest who has it, with their amount */
  byGuest: z.array(z.object({ guestId: z.string(), name: z.string(), eur: z.number() })),
});

/**
 * What the trip costs once there when it was validated (task.md T8.13, use-cases.md R10), and the advice on it (R12).
 * Summaries saved before have none: their figures are in `guests` only.
 */
const ExtraSnapshot = z.object({
  /** The stay it was worked out for */
  stayTitle: z.string(),
  /** Who gave the local prices; "eu-average" when none were stored and the budget did not count it */
  pricesSource: z.enum(["ai", "rules", "eu-average"]),
  /** The budget counted it (the guests' costs have it in them) */
  counted: z.boolean(),
  sections: z.array(z.object({ kind: z.enum(["mandatory", "plus"]), groupEur: z.number(), perGuestEur: z.number(), lines: z.array(ExtraLineSnapshot) })),
  totalEur: z.number(),
  advice: Nullable(
    z.object({
      source: z.enum(RATING_SOURCES),
      /** Written before a budget, the ❤ stay, an offer or the dates last changed */
      stale: z.boolean(),
      group: z.array(z.object({ text: z.string(), savingEachEur: z.record(z.string(), z.number()) })),
      guests: z.array(z.object({ guestId: z.string(), name: z.string(), budgetEur: z.number(), afterEur: z.number(), fits: z.boolean(), lines: z.array(z.object({ text: z.string(), savingEur: z.number() })) })),
    }),
  ),
});

const BlockerSnapshot = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("over"), guestId: z.string(), name: z.string(), overBudgetEur: z.number() }),
  z.object({ kind: z.literal("unreachable"), guestId: z.string(), name: z.string() }),
]);

export const SummarySnapshotSchema = z.object({
  version: z.literal(1),
  tripName: z.string(),
  destination: z.object({
    id: z.string(),
    label: z.string(),
    shortLabel: z.string(),
    countryCode: z.string(),
    airports: z.array(z.string()),
    objective: z.enum(OBJECTIVES),
    budgetLevel: z.enum(BUDGET_LEVELS),
    inScope: z.boolean(),
  }),
  /** The days of the trip, null when no dates work for everyone */
  dates: Nullable(z.object({ from: z.string(), to: z.string(), nights: z.number() })),
  totals: z.object({
    totalEur: z.number(),
    perGuestEur: z.number(),
    tier: z.enum(BUDGET_TIERS),
    includesFallback: z.boolean(),
    complete: z.boolean(),
  }),
  /** How it stood among the destinations when it was chosen: a group may validate one that does not work for everyone */
  ranking: z.object({ rank: z.number(), eligible: z.boolean(), recommended: z.boolean(), votes: z.number(), blockers: z.array(BlockerSnapshot) }),
  guests: z.array(GuestSnapshot),
  housing: Nullable(HousingSnapshot),
  extra: Nullable(ExtraSnapshot).optional(),
});

export type SummarySnapshot = z.infer<typeof SummarySnapshotSchema>;

/** A price that is not what it was when the destination was validated. */
export type PriceChange = {
  kind: "transport" | "stay";
  /** What it is, e.g. "Jessy's plane (vueling)" */
  label: string;
  wasEur: number;
  /** Null when the offer is no longer there */
  nowEur: number | null;
};

export type SummaryView = Summary<SummarySnapshot> & { priceChanges: PriceChange[] };

/** What the offers cost now, by id: a fare and its last mile, a stay's total. A missing id is an offer that is gone. */
export type CurrentPrices = { transport: Map<string, { priceEur: number; lastMileEur: number }>; stay: Map<string, number> };

/** Compares the frozen prices with the current ones (C-S7). Offers shared by several guests are reported once. */
export function priceChangesOf(snapshot: SummarySnapshot, current: CurrentPrices): PriceChange[] {
  const changes: PriceChange[] = [];

  const byOption = new Map<string, { guests: string[]; transport: NonNullable<SummarySnapshot["guests"][number]["transport"]> }>();
  for (const guest of snapshot.guests) {
    if (!guest.transport) continue;
    const entry = byOption.get(guest.transport.optionId) ?? { guests: [], transport: guest.transport };
    entry.guests.push(guest.name);
    byOption.set(guest.transport.optionId, entry);
  }
  // With the Extra (T8.9), the way from the airport is its transfer: the option's last mile no longer counts
  const lastMileCounts = !snapshot.guests.some((guest) => guest.mandatoryEur != null);
  for (const [optionId, { guests, transport }] of byOption) {
    const was = transport.priceEur + (lastMileCounts ? transport.lastMileEur : 0);
    const found = current.transport.get(optionId);
    const now = found ? found.priceEur + (lastMileCounts ? found.lastMileEur : 0) : null;
    if (now !== was) changes.push({ kind: "transport", label: `${guests.join(" and ")}'s ${transport.mode} (${transport.provider})`, wasEur: was, nowEur: now });
  }

  if (snapshot.housing) {
    const now = current.stay.get(snapshot.housing.stayId) ?? null;
    if (now !== snapshot.housing.totalEur) changes.push({ kind: "stay", label: snapshot.housing.title, wasEur: snapshot.housing.totalEur, nowEur: now });
  }
  return changes;
}

// ── Validating ──────────────────────────────────────────────────────────────

const shortLabel = (label: string) => label.split(",")[0];

function parseSnapshot(json: unknown): SummarySnapshot {
  const parsed = SummarySnapshotSchema.safeParse(json);
  if (!parsed.success) throw new Error(`A stored summary can't be read: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

function asSummary(row: typeof schema.summaries.$inferSelect): Summary<SummarySnapshot> {
  const summary = toSummary(row);
  return { ...summary, snapshot: parseSnapshot(summary.snapshot) };
}

/** What the group decided, as it stands now: the scenario of one destination, with every offer behind it. */
function snapshotOf(db: Db, tripId: string, destinationId: string): SummarySnapshot {
  const loaded = loadTripScenarios(db, tripId);
  if (!loaded) throw new NotFoundError("Trip not found");
  const { trip, scenarios, analyses, ranked } = loaded;
  if (!(trip.status === "ready" || trip.status === "validated") || scenarios.length === 0) {
    throw new ConflictError("not_ready", "The trip has not been worked out yet");
  }

  const destination = trip.destinations.find((d) => d.id === destinationId);
  const scenario = scenarios.find((s) => s.destinationId === destinationId);
  const entry = ranked.find((r) => r.destinationId === destinationId);
  if (!destination || !scenario || !entry) throw new FieldError("destinationId", "That destination is not part of this trip");

  const rawWindow = commonWindow(trip.guests, destination);
  const window = rawWindow && tripWindow(rawWindow, trip.nights);
  const stay = scenario.stay;
  const analysis = stay ? analyses.get(stay.id) : undefined;
  const extra = extraSnapshotOf(db, loaded, destinationId);

  return {
    version: 1,
    tripName: trip.name,
    destination: {
      id: destination.id,
      label: destination.label,
      shortLabel: shortLabel(destination.label),
      countryCode: destination.countryCode,
      airports: destination.airports,
      objective: destination.objective,
      budgetLevel: destination.budgetLevel,
      inScope: destination.inScope,
    },
    dates: window ? { from: window.from, to: window.to, nights: nightsBetween(window) } : null,
    totals: {
      totalEur: scenario.totalEur,
      perGuestEur: scenario.averagePerGuestEur,
      tier: scenario.tier,
      includesFallback: scenario.totalIncludesFallback,
      complete: scenario.totalComplete,
    },
    ranking: {
      rank: entry.rank,
      eligible: entry.eligible,
      recommended: recommendedDestination(ranked)?.destinationId === destinationId,
      votes: entry.votes,
      blockers: entry.blockers,
    },
    guests: scenario.guests.map((guest) => {
      const person = trip.guests.find((g) => g.id === guest.guestId)!;
      const choice = guest.transport;
      return {
        id: guest.guestId,
        name: guest.name,
        home: person.homeLabel,
        maxBudgetEur: guest.maxBudgetEur,
        status: guest.status,
        tier: guest.tier,
        costEur: guest.costEur,
        overBudgetEur: guest.overBudgetEur,
        housingShareEur: guest.housingShareEur,
        mandatoryEur: guest.mandatoryEur,
        plusEur: guest.plusEur,
        starred: person.favoriteDestinationId === destinationId,
        transport: choice && {
          optionId: choice.option.id,
          mode: choice.option.mode,
          provider: choice.option.provider,
          variant: choice.option.variant,
          priceEur: choice.option.priceEur,
          priceUnit: choice.option.priceUnit,
          priceKind: choice.option.priceKind,
          priceNote: choice.option.priceNote,
          lastMileEur: choice.option.lastMileEur,
          costEur: choice.costEur,
          outDepartAt: choice.option.outDepartAt,
          outArriveAt: choice.option.outArriveAt,
          backDepartAt: choice.option.backDepartAt,
          backArriveAt: choice.option.backArriveAt,
          outDurationMin: choice.option.outDurationMin,
          backDurationMin: choice.option.backDurationMin,
          stops: choice.option.stops,
          comfortLevel: choice.comfort.level,
          comfortReasons: choice.comfort.reasons,
          url: choice.option.url,
          source: choice.source,
        },
      };
    }),
    housing: stay && {
      stayId: stay.id,
      provider: stay.provider,
      title: stay.title,
      url: stay.url,
      rooms: stay.rooms,
      beds: stay.beds,
      capacity: stay.capacity,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      nights: Math.max(1, nightsBetween({ from: stay.checkIn, to: stay.checkOut })),
      totalEur: scenario.housingTotalEur,
      perGuestEur: scenario.housingShareEur,
      rating: stay.rating,
      chosenByGroup: scenario.staySource === "selected",
      analysis: judgementOf(analysis),
    },
    extra,
  };
}

/** The Extra as the Extra page shows it for everyone, and its advice, to be frozen (T8.13); null without a stay */
function extraSnapshotOf(db: Db, loaded: NonNullable<ReturnType<typeof loadTripScenarios>>, destinationId: string): SummarySnapshot["extra"] {
  const { trip, scenarios } = loaded;
  const found = tripExtras(db, trip.id, loaded).get(destinationId);
  const scenario = scenarios.find((candidate) => candidate.destinationId === destinationId);
  if (!found || !scenario?.stay) return null;
  const nameOf = (guestId: string) => trip.guests.find((guest) => guest.id === guestId)?.name ?? "?";
  const sections = extraSections(found.input, found.plan, null, nameOf);
  const kept = extraAdviceOf(db, trip.id, destinationId, loaded);
  return {
    stayTitle: scenario.stay.title,
    pricesSource: found.pricesSource,
    counted: scenario.withExtra,
    sections: sections.map((section) => ({
      kind: section.kind,
      groupEur: section.groupEur,
      perGuestEur: section.perGuestEur,
      lines: section.lines.map((line) => ({ id: line.id, label: line.label, summary: line.summary, formula: line.formula, estimate: line.estimate, rows: line.rows, groupEur: line.groupEur, byGuest: line.byGuest })),
    })),
    totalEur: sections.reduce((total, section) => total + section.groupEur, 0),
    advice: kept && {
      source: kept.source,
      stale: kept.stale,
      group: kept.advice.group.map((line) => ({ text: line.text, savingEachEur: line.savingEachEur })),
      guests: kept.advice.guests.map((guest) => ({ guestId: guest.guestId, name: guest.name, budgetEur: guest.budgetEur, afterEur: guest.afterEur, fits: guest.fits, lines: guest.lines.map((line) => ({ text: line.text, savingEur: line.savingEur })) })),
    },
  };
}

/**
 * Validates a destination: freezes its scenario as a summary and marks the trip validated (C-S7).
 * Any destination can be validated, even one that does not work for everyone: the snapshot says
 * so. Validating the same thing again gives back the summary that already says it.
 */
export function validateDestination(db: Db, tripId: string, destinationId: string, now: Date = new Date()): Summary<SummarySnapshot> {
  const snapshot = snapshotOf(db, tripId, destinationId);

  const [latest] = db
    .select()
    .from(schema.summaries)
    .where(and(eq(schema.summaries.tripId, tripId), eq(schema.summaries.destinationId, destinationId)))
    .orderBy(desc(schema.summaries.createdAt), desc(sql`rowid`))
    .limit(1)
    .all();
  if (latest && JSON.stringify(JSON.parse(latest.snapshotJson)) === JSON.stringify(snapshot)) {
    setTripStatus(db, tripId, "validated");
    return asSummary(latest);
  }

  const row = db.transaction((tx) => {
    const [created] = tx
      .insert(schema.summaries)
      .values({ tripId, destinationId, snapshotJson: JSON.stringify(snapshot), totalEur: Math.round(snapshot.totals.totalEur), createdAt: now.toISOString() })
      .returning()
      .all();
    tx.update(schema.trips).set({ status: "validated" }).where(eq(schema.trips.id, tripId)).run();
    return created;
  });
  return asSummary(row);
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** The prices of the offers a snapshot refers to, as they are stored now. */
function currentPricesOf(db: Db, snapshot: SummarySnapshot): CurrentPrices {
  const transport: CurrentPrices["transport"] = new Map();
  for (const guest of snapshot.guests) {
    if (!guest.transport) continue;
    const [row] = db.select().from(schema.transportOptions).where(eq(schema.transportOptions.id, guest.transport.optionId)).all();
    // The price the pages show: a train seen on SNCF Connect in the last day is priced as it was seen
    if (row) transport.set(row.id, { priceEur: withObservedPrices(db, [toTransportOption(row)])[0].priceEur, lastMileEur: row.lastMileEur });
  }
  const stay = new Map<string, number>();
  if (snapshot.housing) {
    const [row] = db.select().from(schema.stayOptions).where(eq(schema.stayOptions.id, snapshot.housing.stayId)).all();
    if (row) stay.set(row.id, row.totalPriceEur);
  }
  return { transport, stay };
}

/** A summary as frozen, with the prices that have moved since flagged (C-S7). Null when there is no such summary. */
export function getSummary(db: Db, summaryId: string): SummaryView | null {
  const [row] = db.select().from(schema.summaries).where(eq(schema.summaries.id, summaryId)).all();
  if (!row) return null;
  const summary = asSummary(row);
  return { ...summary, priceChanges: priceChangesOf(summary.snapshot, currentPricesOf(db, summary.snapshot)) };
}

/** The id of the trip's latest summary, or null when nothing was validated. */
export function latestSummaryId(db: Db, tripId: string): string | null {
  const [row] = db
    .select({ id: schema.summaries.id })
    .from(schema.summaries)
    .where(eq(schema.summaries.tripId, tripId))
    .orderBy(desc(schema.summaries.createdAt), desc(sql`rowid`))
    .limit(1)
    .all();
  return row?.id ?? null;
}

/** The destination the trip was last validated for, and its summary. Null when no decision was taken. */
export function validatedDestinationOf(db: Db, tripId: string): { summaryId: string; destinationId: string } | null {
  const [row] = db
    .select({ id: schema.summaries.id, destinationId: schema.summaries.destinationId })
    .from(schema.summaries)
    .where(eq(schema.summaries.tripId, tripId))
    .orderBy(desc(schema.summaries.createdAt), desc(sql`rowid`))
    .limit(1)
    .all();
  return row ? { summaryId: row.id, destinationId: row.destinationId } : null;
}

// ── Reopening ───────────────────────────────────────────────────────────────

/**
 * Takes a decision back: the summary is deleted, and a trip with no summary left is ready again,
 * to be decided anew. A trip that is being worked out keeps saying so. Returns the trip's status
 * afterwards, or null when there is no such summary.
 */
export function deleteSummary(db: Db, summaryId: string): { tripStatus: TripStatus } | null {
  const [removed] = db.delete(schema.summaries).where(eq(schema.summaries.id, summaryId)).returning().all();
  if (!removed) return null;

  const [trip] = db.select({ status: schema.trips.status }).from(schema.trips).where(eq(schema.trips.id, removed.tripId)).all();
  if (trip.status === "validated" && latestSummaryId(db, removed.tripId) === null) {
    setTripStatus(db, removed.tripId, "ready");
    return { tripStatus: "ready" };
  }
  return { tripStatus: trip.status };
}
