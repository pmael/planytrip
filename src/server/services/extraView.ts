// The Extra page (task.md T8.10, extra.md §9, use-cases.md R10 and R12): a destination's Extra line by line, for
// everyone or for one guest, each line with its detail, each guest's whole trip with it, and the advice. Read on every
// page: nothing here asks a site or the AI ("Ask again" queues the advice job: extraAdvice.ts).
import { colorOf } from "@/core/colors";
import { recommendedDestination } from "@/core/recommend";
import type { BudgetLevel, BudgetTier, Color, Objective, RatingSource, StayProvider } from "@/core/types";
import type { Db } from "@/db/types";
import { extraSections, type ExtraSection } from "@/lib/extraLines";
import { destinationChoices, type DestinationChoice, type NotReady } from "./dashboard";
import { adviceJobPending, extraAdviceOf, type StoredAdvice } from "./extraAdvice";
import { tripExtras } from "./extras";
import { loadTripScenarios } from "./scenarios";

// The lines' types live with their words (lib/extraLines.ts), shared with the summary (summaries.ts)
export type { ExtraLineView, ExtraSection } from "@/lib/extraLines";

/** One guest's whole trip with the Extra: what they pay against their budget (R5, R6 with D2) */
export type ExtraStanding = {
  guestId: string;
  name: string;
  status: "ok" | "unreachable";
  transportEur: number | null;
  housingEur: number;
  mandatoryEur: number;
  plusEur: number;
  costEur: number | null;
  maxBudgetEur: number;
  tier: BudgetTier;
  color: Color;
  overBudgetEur: number | null;
};

export type ExtraAdviceView = {
  source: RatingSource;
  message: string | null;
  createdAt: string;
  /** A budget, the ❤ stay, an offer or the dates changed since it was written */
  stale: boolean;
  /** What the group could agree on, what it saves each guest (by guest id) */
  group: StoredAdvice["group"];
  /** The guests' own lines: only the guest shown in their view */
  guests: StoredAdvice["guests"];
};

export type ExtraView =
  | NotReady
  | {
      kind: "ready";
      tripId: string;
      destinations: DestinationChoice[];
      selectedId: string;
      destination: { shortLabel: string; objective: Objective; budgetLevel: BudgetLevel; nights: number | null };
      guests: { id: string; name: string }[];
      /** Whose view: null for everyone */
      guestId: string | null;
      /** Null when the destination has no stay to work the Extra out for */
      extra: {
        stay: { id: string; title: string; provider: StayProvider; chosen: boolean };
        /** Who gave the local prices; "eu-average" while none are stored, when the budget does not count the Extra yet */
        pricesSource: "ai" | "rules" | "eu-average";
        /** The budget counts it (R5, task.md T8.9) */
        counted: boolean;
        sections: ExtraSection[];
        total: { perGuestEur: number; groupEur: number };
        estimate: boolean;
      } | null;
      /** Everyone's, or the guest's in their view */
      standing: ExtraStanding[];
      advice: ExtraAdviceView | null;
      /** The advice is being written: "Ask again" was pressed */
      advicePending: boolean;
    };

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/**
 * The Extra of one destination (the recommended one, or the closest, by default), for everyone or for `guestId`. Null
 * when the trip does not exist; not ready before it is worked out.
 */
export function getExtraView(db: Db, tripId: string, { destinationId, guestId }: { destinationId?: string; guestId?: string } = {}): ExtraView | null {
  const loaded = loadTripScenarios(db, tripId);
  if (!loaded) return null;
  const { trip, scenarios, ranked } = loaded;
  if (!(trip.status === "ready" || trip.status === "validated") || scenarios.length === 0) return { kind: "not-ready", tripId, status: trip.status };

  const recommended = recommendedDestination(ranked)?.destinationId;
  const scenario = scenarios.find((s) => s.destinationId === destinationId) ?? scenarios.find((s) => s.destinationId === (recommended ?? ranked[0].destinationId))!;
  const destination = trip.destinations.find((d) => d.id === scenario.destinationId)!;
  const viewer = trip.guests.find((guest) => guest.id === guestId)?.id ?? null;
  const nameOf = (id: string) => trip.guests.find((guest) => guest.id === id)?.name ?? "?";
  const shown = (id: string) => viewer === null || id === viewer;

  const found = tripExtras(db, tripId, loaded).get(destination.id) ?? null;
  let extra: Extract<ExtraView, { kind: "ready" }>["extra"] = null;
  if (found) {
    const { input, plan } = found;
    const guests = plan.guests.filter((guest) => shown(guest.guestId));
    const sections = extraSections(input, plan, viewer, nameOf);
    const groupEur = sum(sections.map((section) => section.groupEur));
    extra = {
      stay: { id: found.stayId, title: scenario.stay!.title, provider: scenario.stay!.provider, chosen: found.staySource === "selected" },
      pricesSource: found.pricesSource,
      counted: scenario.withExtra,
      sections,
      total: { groupEur, perGuestEur: groupEur / Math.max(1, guests.length) },
      estimate: sections.some((section) => section.lines.some((line) => line.estimate)),
    };
  }

  // Each guest's trip with the Extra as the page works it out (the budget counts it only once the local prices are stored)
  const planOf = (id: string) => found?.plan.guests.find((guest) => guest.guestId === id);
  const standing = scenario.guests
    .filter((guest) => shown(guest.guestId))
    .map((guest): ExtraStanding => {
      const own = planOf(guest.guestId);
      return {
        guestId: guest.guestId,
        name: guest.name,
        status: guest.status,
        transportEur: guest.transport?.costEur ?? null,
        housingEur: guest.housingShareEur,
        mandatoryEur: guest.mandatoryEur ?? own?.mandatoryEur ?? 0,
        plusEur: guest.plusEur ?? own?.plusEur ?? 0,
        costEur: guest.costEur,
        maxBudgetEur: guest.maxBudgetEur,
        tier: guest.tier,
        color: colorOf("budget", guest.tier),
        overBudgetEur: guest.overBudgetEur,
      };
    });

  const kept = found ? extraAdviceOf(db, tripId, destination.id, loaded) : null;
  return {
    kind: "ready",
    tripId,
    destinations: destinationChoices(trip.destinations, scenarios, recommended),
    selectedId: destination.id,
    destination: { shortLabel: destination.label.split(",")[0], objective: destination.objective, budgetLevel: destination.budgetLevel, nights: found?.input.nights ?? null },
    guests: trip.guests.map((guest) => ({ id: guest.id, name: guest.name })),
    guestId: viewer,
    extra,
    standing,
    advice: kept && {
      source: kept.source,
      message: kept.message,
      createdAt: kept.createdAt,
      stale: kept.stale,
      group: kept.advice.group,
      guests: kept.advice.guests.filter((guest) => shown(guest.guestId)),
    },
    advicePending: adviceJobPending(db, tripId, destination.id),
  };
}
