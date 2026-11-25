// Where each guest stands among the destinations: the ★ says what they want, the figures say what
// they can afford (use-cases.md C-S5, C-S6). Pure, like the rest of core.
import type { GuestScenario, Scenario } from "./scenario";
import type { BudgetTier } from "./types";

/** How the guests of a destination are doing: by tier, plus those who cannot get there at all. */
export type Standing = Record<BudgetTier | "unreachable", number>;

/** Counts the guests of a destination by budget tier. A guest who cannot get there is counted once, as unreachable. */
export function standingOf(scenario: Scenario): Standing {
  const standing: Standing = { comfy: 0, limited: 0, over: 0, unreachable: 0 };
  for (const guest of scenario.guests) standing[guest.status === "unreachable" ? "unreachable" : guest.tier] += 1;
  return standing;
}

/** The share of their budget a guest's trip takes: 0.925 is 92.5 %, above 1 is over. Null without a cost. */
export const budgetRatioOf = (guest: Pick<GuestScenario, "costEur" | "maxBudgetEur">): number | null =>
  guest.costEur === null ? null : guest.costEur / guest.maxBudgetEur;

const EPSILON = 1e-9;

/**
 * The destination where a guest is best off: the one they can get to for the smallest share of
 * their budget. A tie goes to the more comfortable trip, then to the cheaper one, then to the
 * destination listed first. Null when they cannot get to any of them by a mode they accept.
 */
export function bestFitFor(scenarios: Scenario[], guestId: string): string | null {
  const candidates = scenarios.flatMap((scenario) => {
    const guest = scenario.guests.find((g) => g.guestId === guestId);
    const ratio = guest ? budgetRatioOf(guest) : null;
    return guest && guest.status === "ok" && ratio !== null && guest.transport
      ? [{ destinationId: scenario.destinationId, ratio, comfort: guest.transport.comfort.score, cost: guest.costEur! }]
      : [];
  });

  const best = candidates.reduce<(typeof candidates)[number] | null>((winner, candidate) => {
    if (!winner) return candidate;
    if (Math.abs(candidate.ratio - winner.ratio) > EPSILON) return candidate.ratio < winner.ratio ? candidate : winner;
    if (candidate.comfort !== winner.comfort) return candidate.comfort > winner.comfort ? candidate : winner;
    return candidate.cost < winner.cost ? candidate : winner;
  }, null);
  return best?.destinationId ?? null;
}
