// Which destination works for everyone (use-cases.md R7, C-S5, C-S6).
import type { Scenario } from "./scenario";
import type { Guest } from "./types";

/** What keeps a guest from going to a destination: over budget by some euros, or no way to get there. */
export type Blocker =
  | { kind: "over"; guestId: string; name: string; overBudgetEur: number }
  | { kind: "unreachable"; guestId: string; name: string };

export type RankedDestination = {
  destinationId: string;
  /** 1 is the best */
  rank: number;
  /** Every guest can get there and nobody is in the red */
  eligible: boolean;
  /** Guests whose budget tier is comfy */
  comfyGuests: number;
  /** What the guests over budget are over by, in all (the core's overrun, R6): smaller first among destinations that do not work */
  overrunEur: number;
  /** Mean comfort score (0-100) of the guests' trips, null when nobody has a trip */
  averageComfortScore: number | null;
  votes: number;
  totalEur: number;
  /** Empty for an eligible destination */
  blockers: Blocker[];
};

/** Counts the ★ votes per destination id. */
export function countVotes(guests: Pick<Guest, "favoriteDestinationId">[]): Map<string, number> {
  const votes = new Map<string, number>();
  for (const { favoriteDestinationId } of guests) {
    if (favoriteDestinationId) votes.set(favoriteDestinationId, (votes.get(favoriteDestinationId) ?? 0) + 1);
  }
  return votes;
}

/** The guests who keep a destination from working: overruns first, then those who cannot get there. */
export function blockersOf(scenario: Scenario): Blocker[] {
  const over: Blocker[] = [];
  const unreachable: Blocker[] = [];
  for (const guest of scenario.guests) {
    // A guest who cannot get there is reported once, as ⛔, even if their fallback also costs too much
    if (guest.status === "unreachable") {
      unreachable.push({ kind: "unreachable", guestId: guest.guestId, name: guest.name });
    } else if (guest.tier === "over" && guest.overBudgetEur !== null) {
      over.push({ kind: "over", guestId: guest.guestId, name: guest.name, overBudgetEur: guest.overBudgetEur });
    }
  }
  return [...over, ...unreachable];
}

/** The blockers as short labels: "Jessy +90 €", "Martin ⛔" (C-S6). */
export function explainBlockers(scenario: Scenario): string[] {
  return blockersOf(scenario).map((blocker) =>
    blocker.kind === "over" ? `${blocker.name} +${Math.round(blocker.overBudgetEur)} €` : `${blocker.name} ⛔`,
  );
}

function averageComfortScore(scenario: Scenario): number | null {
  const scores = scenario.guests.flatMap((guest) => (guest.transport ? [guest.transport.comfort.score] : []));
  return scores.length === 0 ? null : scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

/**
 * Ranks the destinations criterion by criterion (R7):
 * 1. eligible ones first, 2. more guests comfortably within budget, then the smaller total overrun (open question 6,
 * decided for T8.9: among destinations that do not work, the one closest to working), 3. better average comfort,
 * 4. more ★ votes, 5. cheaper total. A ★ only breaks ties among equals, it can never make an
 * ineligible destination eligible (C-S5). Destinations tied on everything keep their given order.
 */
export function rankDestinations(scenarios: Scenario[], votes: Map<string, number>): RankedDestination[] {
  const candidates = scenarios.map((scenario) => {
    const blockers = blockersOf(scenario);
    return {
      destinationId: scenario.destinationId,
      eligible: blockers.length === 0,
      comfyGuests: scenario.guests.filter((guest) => guest.tier === "comfy").length,
      overrunEur: scenario.guests.reduce((sum, guest) => sum + (guest.tier === "over" ? (guest.overBudgetEur ?? 0) : 0), 0),
      averageComfortScore: averageComfortScore(scenario),
      votes: votes.get(scenario.destinationId) ?? 0,
      totalEur: scenario.totalEur,
      blockers,
    };
  });

  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        Number(b.candidate.eligible) - Number(a.candidate.eligible) ||
        b.candidate.comfyGuests - a.candidate.comfyGuests ||
        a.candidate.overrunEur - b.candidate.overrunEur ||
        (b.candidate.averageComfortScore ?? -1) - (a.candidate.averageComfortScore ?? -1) ||
        b.candidate.votes - a.candidate.votes ||
        a.candidate.totalEur - b.candidate.totalEur ||
        a.index - b.index,
    )
    .map(({ candidate }, position) => ({ ...candidate, rank: position + 1 }));
}

/** The destination to recommend: the best eligible one, or null when none works for everyone. */
export function recommendedDestination(ranked: RankedDestination[]): RankedDestination | null {
  return ranked.find((destination) => destination.eligible) ?? null;
}

/** The criterion of R7 that put one destination ahead of another. */
export type DecidingCriterion = "eligibility" | "comfy" | "overrun" | "comfort" | "votes" | "price" | "order";

/**
 * Why `better` is ranked above `other`: the first criterion of R7, in its order, on which they
 * differ ("order" when they tie on everything and the given order decides). It is the sentence
 * behind "Why?" on the recommendation (C-S6).
 */
export function decidingCriterion(better: RankedDestination, other: RankedDestination): DecidingCriterion {
  if (better.eligible !== other.eligible) return "eligibility";
  if (better.comfyGuests !== other.comfyGuests) return "comfy";
  if (Math.abs(better.overrunEur - other.overrunEur) > 1e-9) return "overrun";
  if ((better.averageComfortScore ?? -1) !== (other.averageComfortScore ?? -1)) return "comfort";
  if (better.votes !== other.votes) return "votes";
  if (better.totalEur !== other.totalEur) return "price";
  return "order";
}
