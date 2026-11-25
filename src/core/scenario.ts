// Builds what a destination would cost and feel like for each guest (use-cases.md R3, R4, R5).
// Everything here is recomputed on every read, nothing is stored (database.md).
import { comfortOf, travelDurationMin, type Comfort } from "./comfort";
import { budgetTierWithExtra } from "./extras";
import { budgetTier, housingShare, transportCostFor, worstTier } from "./pricing";
import { isVerifiedUnreachable } from "./reachability";
import type {
  BudgetTier,
  Destination,
  Guest,
  GuestModes,
  RouteCheck,
  Selection,
  StayAnalysis,
  StayOption,
  StaySelection,
  TransportOption,
  TransportSelection,
} from "./types";

/** The option a guest is going to take and what it costs them. */
export type TransportChoice = {
  /** The option, with its comfort level and score filled in */
  option: TransportOption;
  comfort: Comfort;
  /** What this guest pays, unrounded */
  costEur: number;
  /**
   * default: picked by R3. selected: the guest's ❤.
   * fallback: no accepted mode gets there, this is the cheapest other mode, shown as an assumption.
   */
  source: "default" | "selected" | "fallback";
};

export type GuestScenario = {
  guestId: string;
  name: string;
  maxBudgetEur: number;
  /** unreachable (⛔): none of the guest's accepted modes gets to the destination */
  status: "ok" | "unreachable";
  /** Why it is unreachable, e.g. "no_road_route" */
  reason: string | null;
  /** null when there is no option at all, not even a fallback */
  transport: TransportChoice | null;
  housingShareEur: number;
  /** The Extra (R10): the Mandatory and the Plus, null when it is not worked out for this destination (task.md T8.9) */
  mandatoryEur: number | null;
  plusEur: number | null;
  /** Transport + housing share (+ the Extra when it is known), null without transport */
  costEur: number | null;
  /** An unreachable guest always counts as over (R6) */
  tier: BudgetTier;
  /** How far over budget, 0 when within it, null without a cost */
  overBudgetEur: number | null;
};

export type Scenario = {
  destinationId: string;
  groupSize: number;
  /** The accommodation everyone shares, null when no offer fits the group */
  stay: StayOption | null;
  staySource: "default" | "selected" | null;
  housingTotalEur: number;
  housingShareEur: number;
  guests: GuestScenario[];
  /** Sum of the guests' costs, unrounded */
  totalEur: number;
  averagePerGuestEur: number;
  /** True when a guest's cost comes from a fallback mode, so the total rests on an assumption */
  totalIncludesFallback: boolean;
  /** False when a guest has no transport at all, so the total leaves them out */
  totalComplete: boolean;
  /** The worst tier among the guests */
  tier: BudgetTier;
  /**
   * The guests' Extra is in their costs (task.md T8.9). False while the destination's local prices are not stored: the
   * costs are transport and housing, and the transport keeps its last mile, as before T8.9 (R5).
   */
  withExtra: boolean;
};

const isRed = (option: TransportOption) => option.comfortLevel === "red";

/** Rated "bad" when the trip was set up (by the AI, or by the rules without it): not to be offered by default. */
const isNotRecommended = (option: TransportOption) => option.rating?.verdict === "bad";

/** Cheapest first; on a tie the more comfortable one, then the original order. */
const byCostThenComfort = (a: TransportOption, b: TransportOption) =>
  transportCostFor(a) - transportCostFor(b) || (b.comfortScore ?? 0) - (a.comfortScore ?? 0);

const cheapestOf = (options: TransportOption[]) => [...options].sort(byCostThenComfort)[0] ?? null;

/** The options with seats left; all of them when every one is sold out (shown, and its price still an estimate of the trip). */
const withSeats = (options: TransportOption[]) => {
  const open = options.filter((option) => !option.soldOut);
  return open.length > 0 ? open : options;
};

/**
 * R3: the cheapest option that is not red. One that was also rated bad when the trip was set up is
 * skipped too, as long as another is left: the comfort rule (R2) is the spec's, the rating only
 * refines it, so the rating gives way first. Null when every option is red.
 */
export function pickCheapest(options: TransportOption[]): TransportOption | null {
  const comfortable = withSeats(options).filter((option) => !isRed(option));
  return cheapestOf(comfortable.filter((option) => !isNotRecommended(option))) ?? cheapestOf(comfortable);
}

/**
 * B-S2: the best comfort score; on a tie the better rating, then the cheapest. An option rated bad is
 * not chosen unless every option is.
 */
export function pickMostPractical(options: TransportOption[]): TransportOption | null {
  const open = withSeats(options);
  const recommended = open.filter((option) => !isNotRecommended(option));
  return (
    [...(recommended.length > 0 ? recommended : open)].sort(
      (a, b) => (b.comfortScore ?? 0) - (a.comfortScore ?? 0) || (b.rating?.score ?? 0) - (a.rating?.score ?? 0) || byCostThenComfort(a, b),
    )[0] ?? null
  );
}

/**
 * R4: the cheapest accommodation that sleeps the whole group and was not judged bad (by the AI when
 * the trip was set up, or by the rules without it); one not rated at all is still eligible. On a tie
 * the better fit score wins. When every one that fits was judged bad the cheapest of them is still
 * used, so that a destination never loses its accommodation (and its cost) because nothing pleased:
 * the rating still says it is not recommended.
 */
export function pickDefaultStay(
  stays: StayOption[],
  analyses: Map<string, StayAnalysis>,
  groupSize: number,
): StayOption | null {
  const fit = (stay: StayOption) => analyses.get(stay.id)?.fitScore ?? 0;
  const cheapestFirst = (a: StayOption, b: StayOption) => a.totalPriceEur - b.totalPriceEur || fit(b) - fit(a);
  const fitting = stays.filter((stay) => stay.capacity >= groupSize);
  return fitting.filter((stay) => analyses.get(stay.id)?.verdict !== "bad").sort(cheapestFirst)[0] ?? [...fitting].sort(cheapestFirst)[0] ?? null;
}

/**
 * Fills in each option's comfort. Plane, train and bus are judged against the fastest of their route,
 * so pass the options of one destination only.
 */
export function rateOptions(options: TransportOption[]): { rated: TransportOption[]; comforts: Map<string, Comfort> } {
  const fastest = new Map<string, number>();
  const routeOf = (option: TransportOption) => `${option.originKey}|${option.mode}`;
  for (const option of options) {
    const duration = travelDurationMin(option);
    if (duration === null) continue;
    fastest.set(routeOf(option), Math.min(fastest.get(routeOf(option)) ?? Infinity, duration));
  }

  const comforts = new Map<string, Comfort>();
  const rated = options.map((option) => {
    const comfort = comfortOf(option, fastest.get(routeOf(option)) ?? 0);
    comforts.set(option.id, comfort);
    return { ...option, comfortScore: comfort.score, comfortLevel: comfort.level };
  });
  return { rated, comforts };
}

export type ScenarioInput = {
  destination: Destination;
  guests: Guest[];
  guestModes: GuestModes;
  options: TransportOption[];
  stays: StayOption[];
  /** Keyed by stay id */
  analyses: Map<string, StayAnalysis>;
  selections: Selection[];
  checks: RouteCheck[];
  /** Each guest's Extra at this destination, by guest id (services/extras.ts): counted in their cost and tier (R5, R6, D2) */
  extras?: Map<string, { mandatoryEur: number; plusEur: number }>;
};

/**
 * The cost of going to one destination, guest by guest. Only the data of `destination` is read, so
 * callers may pass the whole trip's options, stays, selections and route checks.
 */
export function buildScenario(input: ScenarioInput): Scenario {
  const { destination, guests, guestModes, analyses } = input;
  const forDestination = <T extends { destinationId: string }>(items: T[]) =>
    items.filter((item) => item.destinationId === destination.id);

  const { rated: options, comforts } = rateOptions(forDestination(input.options));
  const stays = forDestination(input.stays);
  const selections = forDestination(input.selections);
  const checks = forDestination(input.checks);
  const groupSize = guests.length;

  const staySelection = selections.find((selection): selection is StaySelection => selection.kind === "stay");
  const selectedStay = staySelection && stays.find((stay) => stay.id === staySelection.stayOptionId);
  const stay = selectedStay ?? pickDefaultStay(stays, analyses, groupSize);
  const share = housingShare(stay, groupSize);
  const withExtra = input.extras !== undefined;

  const choiceOf = (option: TransportOption, source: TransportChoice["source"]): TransportChoice => ({
    option,
    comfort: comforts.get(option.id)!,
    costEur: transportCostFor(option, undefined, !withExtra),
    source,
  });

  const guestScenarios = guests.map((guest): GuestScenario => {
    const accepted = guestModes[guest.id] ?? [guest.preferredMode];
    const failedCheck = (mode: string) =>
      checks.find((check) => check.originKey === guest.originKey && check.mode === mode && isVerifiedUnreachable(check));

    // Options this guest could take: from their origin, by a mode that is not known to be unreachable
    const available = options.filter((option) => option.originKey === guest.originKey && !failedCheck(option.mode));
    const own = available.filter((option) => accepted.includes(option.mode));

    const transportSelection = selections.find(
      (selection): selection is TransportSelection => selection.kind === "transport" && selection.guestId === guest.id,
    );
    const selected = transportSelection && options.find((option) => option.id === transportSelection.transportOptionId);

    let status: GuestScenario["status"] = "ok";
    let transport: TransportChoice | null = null;
    if (selected) {
      transport = choiceOf(selected, "selected");
    } else if (own.length > 0) {
      // R3: the cheapest comfortable option, or the cheapest anyway when everything is red
      transport = choiceOf(pickCheapest(own) ?? cheapestOf(own)!, "default");
    } else {
      status = "unreachable";
      const others = available.filter((option) => !accepted.includes(option.mode));
      const fallback = pickCheapest(others) ?? cheapestOf(others);
      transport = fallback ? choiceOf(fallback, "fallback") : null;
    }

    // R5 and R6 with the Extra (D2): the Mandatory counts fully; the Plus can make a guest limited, never over
    const extra = input.extras?.get(guest.id) ?? null;
    const core = transport ? transport.costEur + share + (extra?.mandatoryEur ?? 0) : null;
    const cost = core === null ? null : core + (extra?.plusEur ?? 0);
    const tier: BudgetTier =
      status === "unreachable" || core === null || cost === null
        ? "over"
        : extra
          ? budgetTierWithExtra({ coreEur: core, plusEur: extra.plusEur }, guest.maxBudgetEur).tier
          : budgetTier(cost, guest.maxBudgetEur);
    return {
      guestId: guest.id,
      name: guest.name,
      maxBudgetEur: guest.maxBudgetEur,
      status,
      reason: status === "unreachable" ? (accepted.map(failedCheck).find(Boolean)?.reason ?? null) : null,
      transport,
      housingShareEur: share,
      mandatoryEur: extra?.mandatoryEur ?? null,
      plusEur: extra?.plusEur ?? null,
      costEur: cost,
      tier,
      // How far over: the core's overrun, the Plus is a suggestion
      overBudgetEur: core === null ? null : Math.max(0, core - guest.maxBudgetEur),
    };
  });

  const total = guestScenarios.reduce((sum, guest) => sum + (guest.costEur ?? 0), 0);
  return {
    destinationId: destination.id,
    groupSize,
    stay,
    staySource: stay ? (selectedStay ? "selected" : "default") : null,
    housingTotalEur: stay?.totalPriceEur ?? 0,
    housingShareEur: share,
    guests: guestScenarios,
    totalEur: total,
    averagePerGuestEur: groupSize > 0 ? total / groupSize : 0,
    totalIncludesFallback: guestScenarios.some((guest) => guest.transport?.source === "fallback"),
    totalComplete: guestScenarios.every((guest) => guest.costEur !== null),
    tier: worstTier(guestScenarios.map((guest) => guest.tier)),
    withExtra,
  };
}
