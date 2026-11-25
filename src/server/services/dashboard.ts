// What the dashboard pages show, worked out from the scenarios (use-cases.md UC-C). Raw figures
// and colour words only: the pages decide how to write them down.
import { eq } from "drizzle-orm";
import { colorOf } from "@/core/colors";
import { commonWindow, limitingGuests, nightsBetween, noCommonDates, tripWindow } from "@/core/dates";
import { budgetRatioOf } from "@/core/preferences";
import { decidingCriterion, recommendedDestination, type DecidingCriterion, type RankedDestination } from "@/core/recommend";
import type { Scenario } from "@/core/scenario";
import { trends } from "@/core/trends";
import type { BudgetTier, Color, Destination, Guest, Objective, RatingSource, StayJudgement, StayProvider, StayVerdict, TransportMode, Trend, TripStatus } from "@/core/types";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { airlineCode } from "@/lib/airlines";
import { MODE_LABELS } from "@/lib/reachabilityText";
import { providerLabel } from "@/lib/transportText";
import type { BUDGET_SHOWS } from "../schemas";
import { localPricesOf } from "./localPrices";
import { judgementOf, loadTripScenarios, type TripScenarios } from "./scenarios";
import { validatedDestinationOf } from "./summaries";

export type BudgetShow = (typeof BUDGET_SHOWS)[number];

/** A trip whose options were not computed yet has nothing to show: the page sends the user to the wizard. */
export type NotReady = { kind: "not-ready"; tripId: string; status: TripStatus };

const isReady = ({ trip }: TripScenarios) => trip.status === "ready" || trip.status === "validated";
const shortLabel = (label: string) => label.split(",")[0];

/** A figure is shown with a "~" when it is not a whole number of euros. */
export const isWholeEuros = (value: number) => Math.abs(value - Math.round(value)) < 0.005;

// ── Dashboard home ─────────────────────────────────────────────────────────

export type DestinationChoice = {
  id: string;
  label: string;
  shortLabel: string;
  /** False outside Europe: computed for reference only */
  inScope: boolean;
  tier: BudgetTier;
  recommended: boolean;
};

/** The trip's destinations as the dashboard's pickers list them. `recommendedId` is the one R7 recommends, if any. */
export function destinationChoices(
  destinations: Destination[],
  scenarios: Scenario[],
  recommendedId: string | undefined,
): DestinationChoice[] {
  return destinations.map((destination) => ({
    id: destination.id,
    label: destination.label,
    shortLabel: shortLabel(destination.label),
    inScope: destination.inScope,
    tier: scenarios.find((scenario) => scenario.destinationId === destination.id)!.tier,
    recommended: destination.id === recommendedId,
  }));
}

export type DashboardGuest = {
  id: string;
  name: string;
  tier: BudgetTier;
  availableFrom: string;
  availableTo: string;
  /** Whoever sets the limit of the common window is yellow, whoever clashes is red */
  datesColor: Color;
  /** Whether this guest's ★ is on the selected destination */
  starred: boolean;
};

export type DashboardView =
  | NotReady
  | {
      kind: "ready";
      tripId: string;
      status: TripStatus;
      destinations: DestinationChoice[];
      selectedId: string;
      budget: { totalEur: number; perGuestEur: number; tier: BudgetTier; includesFallback: boolean };
      /** The stay the budget counts, with its first photo and its score as the Housing page shows them */
      housing: {
        title: string;
        provider: StayProvider;
        totalEur: number;
        shareEur: number;
        photo: string | null;
        verdict: StayVerdict | null;
        fitScore: number | null;
        ratedBy: RatingSource | null;
        ratingReason: string | null;
      } | null;
      /** The means of transportation the guests would take there */
      transportModes: TransportMode[];
      /** The same, with the companies that fly them there (one per airline): `airline` is its two-letter code, null when it is not a flight or not known */
      carriers: { mode: TransportMode; label: string; airline: string | null }[];
      /** The Extra card: the trip's objective (its words, lib/extraText.ts) and the group's Extra, null until the local prices are known */
      extra: { objective: Objective; totalEur: number | null };
      guests: DashboardGuest[];
      /** The destination the group validated, and its summary; null while nothing is decided */
      validated: { summaryId: string; destinationId: string } | null;
    };

function datesColorOf(guest: Guest, guests: Guest[]): Color {
  if (noCommonDates(guests)?.includes(guest)) return "red";
  const window = commonWindow(guests);
  return window && limitingGuests(guests, window).includes(guest) ? "yellow" : "green";
}

/** Who takes the guests there: each airline once, any other mode once */
function carriersOf(db: Db, scenario: Scenario): { mode: TransportMode; label: string; airline: string | null }[] {
  const carriers = new Map<string, { mode: TransportMode; label: string; airline: string | null }>();
  for (const { transport } of scenario.guests) {
    if (!transport) continue;
    const { id, mode, provider } = transport.option;
    if (mode !== "plane") {
      carriers.set(mode, { mode, label: MODE_LABELS[mode], airline: null });
      continue;
    }
    const [row] = db.select({ rawJson: schema.transportOptions.rawJson }).from(schema.transportOptions).where(eq(schema.transportOptions.id, id)).all();
    let flights: unknown;
    try {
      flights = row?.rawJson ? (JSON.parse(row.rawJson) as { flights?: unknown } | null)?.flights : undefined;
    } catch {
      // Not readable: the company's name says which it is
    }
    carriers.set(`plane|${provider}`, { mode, label: providerLabel(provider), airline: airlineCode(provider, Array.isArray(flights) ? flights[0] : undefined) });
  }
  return [...carriers.values()];
}

/**
 * The home of the dashboard, for the destination `destinationId` (the recommended one when it is
 * missing or unknown). Null when the trip does not exist.
 */
export function getDashboard(db: Db, tripId: string, destinationId?: string): DashboardView | null {
  const loaded = loadTripScenarios(db, tripId);
  if (!loaded) return null;
  if (!isReady(loaded) || loaded.scenarios.length === 0) return { kind: "not-ready", tripId, status: loaded.trip.status };

  const { trip, scenarios, analyses, ranked } = loaded;
  const recommended = recommendedDestination(ranked)?.destinationId;
  const selected =
    scenarios.find((scenario) => scenario.destinationId === destinationId) ??
    scenarios.find((scenario) => scenario.destinationId === (recommended ?? ranked[0].destinationId))!;
  const rated = selected.stay ? analyses.get(selected.stay.id) : undefined;

  return {
    kind: "ready",
    tripId,
    status: trip.status,
    destinations: destinationChoices(trip.destinations, scenarios, recommended),
    selectedId: selected.destinationId,
    budget: {
      totalEur: selected.totalEur,
      perGuestEur: selected.averagePerGuestEur,
      tier: selected.tier,
      includesFallback: selected.totalIncludesFallback,
    },
    housing: selected.stay
      ? {
          title: selected.stay.title,
          provider: selected.stay.provider,
          totalEur: selected.housingTotalEur,
          shareEur: selected.housingShareEur,
          photo: selected.stay.photos[0] ?? null,
          verdict: rated?.verdict ?? null,
          fitScore: rated?.fitScore ?? null,
          ratedBy: rated?.ratedBy ?? null,
          ratingReason: rated?.ratingReason ?? null,
        }
      : null,
    transportModes: [...new Set(selected.guests.flatMap((guest) => (guest.transport ? [guest.transport.option.mode] : [])))],
    carriers: carriersOf(db, selected),
    extra: {
      objective: trip.destinations.find((destination) => destination.id === selected.destinationId)!.objective,
      totalEur: selected.guests.some((guest) => guest.mandatoryEur !== null)
        ? selected.guests.reduce((sum, guest) => sum + (guest.mandatoryEur ?? 0) + (guest.plusEur ?? 0), 0)
        : null,
    },
    validated: validatedDestinationOf(db, tripId),
    guests: selected.guests.map((scenarioGuest) => {
      const guest = trip.guests.find((g) => g.id === scenarioGuest.guestId)!;
      return {
        id: guest.id,
        name: guest.name,
        tier: scenarioGuest.tier,
        availableFrom: guest.availableFrom,
        availableTo: guest.availableTo,
        datesColor: datesColorOf(guest, trip.guests),
        starred: guest.favoriteDestinationId === selected.destinationId,
      };
    }),
  };
}

// ── Budget view ────────────────────────────────────────────────────────────

export type FigureBlock = {
  totalEur: number;
  perGuestEur: number;
  color: Color;
  /** ▲ lowest among the destinations, ▼ highest, ≈ in between (C-S3) */
  trend: Trend;
};

/** Something that keeps a destination from working for a guest, with the numbers behind it. */
export type BlockerView =
  | { kind: "over"; guestId: string; name: string; overBudgetEur: number }
  | {
      kind: "unreachable";
      guestId: string;
      name: string;
      /** What they accept, none of which gets there */
      modes: TransportMode[];
      /** The cheapest other way, counted as an assumption; null when there is none at all */
      fallback: { mode: TransportMode; costEur: number; overBudgetEur: number } | null;
    };

/** One guest at one destination: what the trip costs them and how that sits with their budget. */
export type GuestCardView = {
  guestId: string;
  name: string;
  status: "ok" | "unreachable";
  tier: BudgetTier;
  color: Color;
  /** Transport, their share of the housing and their Extra (task.md T8.9), null without any transport */
  costEur: number | null;
  overBudgetEur: number | null;
  maxBudgetEur: number;
  /** 0.93 is 93 % of their budget */
  budgetRatio: number | null;
  housingShareEur: number;
  transport: { costEur: number; mode: TransportMode; durationMin: number | null; comfort: Color; assumed: boolean } | null;
};

export type BudgetCard = {
  destinationId: string;
  label: string;
  shortLabel: string;
  inScope: boolean;
  tier: BudgetTier;
  total: FigureBlock & {
    /** The total rests on an assumption: a guest who cannot get there is counted with another mode */
    includesFallback: boolean;
    /** False when a guest has no way of getting there at all, so the total leaves them out */
    complete: boolean;
  };
  /** 1 is the best (R7) */
  rank: number;
  /** Everyone can get there and nobody is in the red */
  eligible: boolean;
  /** What keeps it from working: who is over budget by how much, who cannot get there (C-S6) */
  blockers: BlockerView[];
  /** The ★ this destination has, and whose they are */
  votes: { count: number; guestIds: string[]; names: string[] };
  /** The card as one guest sees it: their own cost, coloured by their own budget (C-S4). Keyed by guest id */
  guestViews: Record<string, GuestCardView>;
  /** The days everyone is free. Null when there are none. */
  dates: { from: string; to: string; nights: number; limitedBy: string[]; setByDestination: boolean } | null;
  housing:
    | (FigureBlock & {
        stay: { id: string; title: string; provider: string };
        analysis: StayJudgement | null;
      })
    | null;
  transports:
    | (FigureBlock & {
        guests: {
          guestId: string;
          name: string;
          costEur: number | null;
          mode: TransportMode | null;
          durationMin: number | null;
          comfort: Color;
          /** The guest cannot get there by what they accept: this is another mode, as an assumption */
          assumed: boolean;
        }[];
      })
    | null;
  /**
   * What the trip costs once there (use-cases.md R10, task.md T8.9): the Mandatory (food, the transfer, the tourist tax)
   * and the Plus (what the trip is for), in the totals above. Null until the destination's local prices are known.
   */
  extra:
    | (FigureBlock & {
        mandatoryEur: number;
        plusEur: number;
        /** The local prices are the AI's; false: worked out by the rules from the country's price level */
        pricesByAi: boolean;
        guests: { guestId: string; name: string; mandatoryEur: number; plusEur: number }[];
      })
    | null;
};

/** One line of the ranking behind the recommendation: the criteria of R7 for a destination. */
export type RankingRow = {
  destinationId: string;
  shortLabel: string;
  rank: number;
  eligible: boolean;
  comfyGuests: number;
  /** What the guests over budget are over by, in all (R7, T8.9) */
  overrunEur: number;
  averageComfort: number | null;
  votes: number;
  totalEur: number;
  blockers: BlockerView[];
};

type Standing = Pick<RankingRow, "comfyGuests" | "overrunEur" | "averageComfort" | "votes" | "totalEur">;

/** Why the recommendation is what it is, as facts the page writes down (C-S6). */
export type RecommendationReason =
  /** The destination works for everyone */
  | { kind: "works"; comfyGuests: number; guests: number; averageComfort: number | null }
  /** It is ahead of the next one, and which of the criteria of R7 put it there */
  | { kind: "leads"; criterion: DecidingCriterion; over: string; mine: Standing; theirs: Standing; theirBlockers: BlockerView[] }
  /** Nothing works for everyone: this is the closest, and these are the guests in the way */
  | { kind: "closest"; blockers: BlockerView[] }
  /** Guests put a ★ on a destination that does not work: a ★ only breaks ties (C-S5) */
  | { kind: "star_cannot_override"; names: string[]; destination: string; blockers: BlockerView[] };

export type Recommendation = {
  /** A destination works for everyone */
  works: boolean;
  /** The recommended destination, or the closest one when none works */
  destinationId: string;
  label: string;
  shortLabel: string;
  totalEur: number;
  perGuestEur: number;
  includesFallback: boolean;
  reasons: RecommendationReason[];
  /** Every destination, best first, with the figures that ranked it */
  ranking: RankingRow[];
};

export type BudgetView =
  | NotReady
  | {
      kind: "ready";
      tripId: string;
      show: BudgetShow[];
      /** The guest whose view the page opens on, null for everyone (C-S4) */
      guestId: string | null;
      guests: { id: string; name: string }[];
      recommendation: Recommendation;
      cards: BudgetCard[];
    };

/** The trend and colour of each destination's figure, for the destinations that have one. */
function compare(values: Map<string, number>) {
  const all = [...values.values()];
  const marks = trends(Object.fromEntries(values));
  return (id: string) => ({
    trend: marks[id],
    color: colorOf("relativePrice", values.get(id)!, all),
  });
}

/**
 * The Budget page: every destination side by side with its total and per-guest cost, and the
 * housing, transport and dates behind them, the recommendation with the reasons for it, and each
 * guest's own view of every card. All the sections are worked out; `show` says which the page opens
 * with (the chips, kept in the URL), `guestId` whose view. Null when the trip does not exist.
 */
export function getBudgetView(db: Db, tripId: string, { show = [], guestId }: { show?: BudgetShow[]; guestId?: string } = {}): BudgetView | null {
  const loaded = loadTripScenarios(db, tripId);
  if (!loaded) return null;
  if (!isReady(loaded) || loaded.scenarios.length === 0) return { kind: "not-ready", tripId, status: loaded.trip.status };

  const { trip, scenarios, analyses, ranked } = loaded;
  const transportTotal = (scenario: Scenario) =>
    scenario.guests.reduce((sum, guest) => sum + (guest.transport?.costEur ?? 0), 0);
  const withTransport = scenarios.filter((scenario) => scenario.guests.some((guest) => guest.transport));

  const totalMarks = trends(Object.fromEntries(scenarios.map((s) => [s.destinationId, s.totalEur])));
  const housing = compare(new Map(scenarios.filter((s) => s.stay).map((s) => [s.destinationId, s.housingTotalEur])));
  const transport = compare(new Map(withTransport.map((s) => [s.destinationId, transportTotal(s)])));
  const extraGuests = (scenario: Scenario) =>
    scenario.guests.flatMap((guest) => (guest.mandatoryEur === null ? [] : [{ guestId: guest.guestId, name: guest.name, mandatoryEur: guest.mandatoryEur, plusEur: guest.plusEur ?? 0 }]));
  const extraTotal = (scenario: Scenario) => extraGuests(scenario).reduce((sum, guest) => sum + guest.mandatoryEur + guest.plusEur, 0);
  const extra = compare(new Map(scenarios.filter((s) => extraGuests(s).length > 0).map((s) => [s.destinationId, extraTotal(s)])));


  const shortOf = (destinationId: string) => shortLabel(trip.destinations.find((d) => d.id === destinationId)!.label);
  const blockersOf = (entry: RankedDestination): BlockerView[] => {
    const scenario = scenarios.find((s) => s.destinationId === entry.destinationId)!;
    return entry.blockers.map((blocker): BlockerView => {
      if (blocker.kind === "over") return blocker;
      const guest = scenario.guests.find((g) => g.guestId === blocker.guestId)!;
      const fallback = guest.transport?.source === "fallback" ? guest.transport : null;
      return {
        ...blocker,
        modes: trip.guestModes[blocker.guestId] ?? [],
        fallback: fallback && { mode: fallback.option.mode, costEur: guest.costEur ?? fallback.costEur, overBudgetEur: guest.overBudgetEur ?? 0 },
      };
    });
  };
  const rankOf = (destinationId: string) => ranked.find((entry) => entry.destinationId === destinationId)!;

  const cards = scenarios.map((scenario): BudgetCard => {
    const destination = trip.destinations.find((d) => d.id === scenario.destinationId)!;
    const rawWindow = commonWindow(trip.guests, destination);
    const window = rawWindow && tripWindow(rawWindow, trip.nights);
    const guestsWindow = commonWindow(trip.guests);

    const stay = scenario.stay;
    const analysis = stay ? analyses.get(stay.id) : undefined;
    const entry = rankOf(scenario.destinationId);
    const voters = trip.guests.filter((guest) => guest.favoriteDestinationId === scenario.destinationId);

    return {
      destinationId: scenario.destinationId,
      label: destination.label,
      shortLabel: shortLabel(destination.label),
      inScope: destination.inScope,
      tier: scenario.tier,
      rank: entry.rank,
      eligible: entry.eligible,
      blockers: blockersOf(entry),
      votes: { count: voters.length, guestIds: voters.map((g) => g.id), names: voters.map((g) => g.name) },
      guestViews: Object.fromEntries(
        scenario.guests.map((guest): [string, GuestCardView] => [
          guest.guestId,
          {
            guestId: guest.guestId,
            name: guest.name,
            status: guest.status,
            tier: guest.tier,
            color: colorOf("budget", guest.tier),
            costEur: guest.costEur,
            overBudgetEur: guest.overBudgetEur,
            maxBudgetEur: guest.maxBudgetEur,
            budgetRatio: budgetRatioOf(guest),
            housingShareEur: guest.housingShareEur,
            transport: guest.transport && {
              costEur: guest.transport.costEur,
              mode: guest.transport.option.mode,
              durationMin: guest.transport.option.outDurationMin,
              comfort: colorOf("comfort", guest.transport.comfort.level),
              assumed: guest.transport.source === "fallback",
            },
          },
        ]),
      ),
      total: {
        totalEur: scenario.totalEur,
        perGuestEur: scenario.averagePerGuestEur,
        color: colorOf("budget", scenario.tier),
        trend: totalMarks[scenario.destinationId],
        includesFallback: scenario.totalIncludesFallback,
        complete: scenario.totalComplete,
      },
      dates: window
        ? {
            from: window.from,
            to: window.to,
            nights: nightsBetween(window),
            limitedBy: limitingGuests(trip.guests, window).map((guest) => guest.name),
            setByDestination: guestsWindow !== null && (guestsWindow.from !== window.from || guestsWindow.to !== window.to) && trip.nights === null,
          }
        : null,
      housing: stay
        ? {
            totalEur: scenario.housingTotalEur,
            perGuestEur: scenario.housingShareEur,
            ...housing(scenario.destinationId),
            stay: { id: stay.id, title: stay.title, provider: stay.provider },
            analysis: judgementOf(analysis),
          }
        : null,
      transports: scenario.guests.some((guest) => guest.transport)
        ? {
            totalEur: transportTotal(scenario),
            perGuestEur: transportTotal(scenario) / scenario.guests.filter((guest) => guest.transport).length,
            ...transport(scenario.destinationId),
            guests: scenario.guests.map((guest) => ({
              guestId: guest.guestId,
              name: guest.name,
              costEur: guest.transport?.costEur ?? null,
              mode: guest.transport?.option.mode ?? null,
              durationMin: guest.transport?.option.outDurationMin ?? null,
              comfort: colorOf("comfort", guest.transport?.comfort.level),
              assumed: guest.transport?.source === "fallback",
            })),
          }
        : null,
      extra: extraGuests(scenario).length > 0
        ? {
            totalEur: extraTotal(scenario),
            perGuestEur: extraTotal(scenario) / extraGuests(scenario).length,
            ...extra(scenario.destinationId),
            mandatoryEur: extraGuests(scenario).reduce((sum, guest) => sum + guest.mandatoryEur, 0),
            plusEur: extraGuests(scenario).reduce((sum, guest) => sum + guest.plusEur, 0),
            pricesByAi: localPricesOf(db, scenario.destinationId)?.source === "ai",
            guests: extraGuests(scenario),
          }
        : null,
    };
  });

  const recommendedEntry = ranked.find((entry) => entry.eligible) ?? null;
  const lead = recommendedEntry ?? ranked[0];
  const leadScenario = scenarios.find((s) => s.destinationId === lead.destinationId)!;
  const standingOf = (entry: RankedDestination): Standing => ({
    comfyGuests: entry.comfyGuests,
    overrunEur: entry.overrunEur,
    averageComfort: entry.averageComfortScore,
    votes: entry.votes,
    totalEur: entry.totalEur,
  });

  const reasons: RecommendationReason[] = [];
  if (recommendedEntry) {
    reasons.push({ kind: "works", comfyGuests: lead.comfyGuests, guests: trip.guests.length, averageComfort: lead.averageComfortScore });
  } else {
    reasons.push({ kind: "closest", blockers: blockersOf(lead) });
  }
  const next = ranked.find((entry) => entry.destinationId !== lead.destinationId && entry.rank === lead.rank + 1);
  if (recommendedEntry && next) {
    reasons.push({
      kind: "leads",
      criterion: decidingCriterion(lead, next),
      over: shortOf(next.destinationId),
      mine: standingOf(lead),
      theirs: standingOf(next),
      theirBlockers: blockersOf(next),
    });
  }
  // A ★ on a destination that does not work changes nothing: say so, so the vote is not wondered about
  for (const entry of ranked) {
    const names = trip.guests.filter((g) => g.favoriteDestinationId === entry.destinationId).map((g) => g.name);
    if (!entry.eligible && names.length > 0) {
      reasons.push({ kind: "star_cannot_override", names, destination: shortOf(entry.destinationId), blockers: blockersOf(entry) });
    }
  }

  const recommendation: Recommendation = {
    works: recommendedEntry !== null,
    destinationId: lead.destinationId,
    label: trip.destinations.find((d) => d.id === lead.destinationId)!.label,
    shortLabel: shortOf(lead.destinationId),
    totalEur: leadScenario.totalEur,
    perGuestEur: leadScenario.averagePerGuestEur,
    includesFallback: leadScenario.totalIncludesFallback,
    reasons,
    ranking: ranked.map((entry) => ({
      destinationId: entry.destinationId,
      shortLabel: shortOf(entry.destinationId),
      rank: entry.rank,
      eligible: entry.eligible,
      comfyGuests: entry.comfyGuests,
      overrunEur: entry.overrunEur,
      averageComfort: entry.averageComfortScore,
      votes: entry.votes,
      totalEur: entry.totalEur,
      blockers: blockersOf(entry),
    })),
  };

  return {
    kind: "ready",
    tripId,
    show,
    // A guest who is not on the trip is not an error: the page opens on everyone
    guestId: trip.guests.some((guest) => guest.id === guestId) ? (guestId ?? null) : null,
    guests: trip.guests.map((guest) => ({ id: guest.id, name: guest.name })),
    recommendation,
    cards,
  };
}
