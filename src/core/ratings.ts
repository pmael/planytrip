// Rating by rules: what scores a stay or a journey when the AI is not available. The AI is asked the
// same questions (does it fit the group, what does it cost the poorest guest, is it any good); this
// answers them by formula, so a trip always has scores, and says so ("Rules only") so nobody takes
// them for the AI's. Pure, like the rest of core.
import { extras, ratingRules } from "@/config";
import type { StayFacts } from "./extras";
import type { ComfortLevel, Objective, StayVerdict } from "./types";

export type RuleRating = { verdict: StayVerdict; score: number; reason: string };

type Budget = { name: string; maxBudgetEur: number };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** 1 at `full`, 0 at `zero`, a straight line between, whichever way round they are. */
const slope = (value: number, full: number, zero: number) => clamp01((value - zero) / (full - zero));

const euros = (value: number) => `${Math.round(value)} €`;

/**
 * The rules only ever call something good or ok by its score: "bad" is for what is plainly impossible
 * or unusable (it cannot sleep the group, it costs a guest their whole budget, it is red for
 * comfort). A low score alone is a matter of judgement, which is the AI's to make, and a rule must
 * not silently take an option out of the running.
 */
const verdictFor = (score: number): StayVerdict => (score >= ratingRules.verdicts.good ? "good" : "ok");

/** The score of something plainly unusable: what it would have scored, squeezed into the bottom of the scale. */
const unusableScore = (score: number) => Math.round(score * ratingRules.badScoreShare);

/** The guest with the smallest budget: every guest pays an equal share, so they are the one it is hardest for. */
const poorestOf = (budgets: Budget[]) => budgets.reduce((poorest, guest) => (guest.maxBudgetEur < poorest.maxBudgetEur ? guest : poorest));

export type StayRatingInput = {
  /** How many people it sleeps */
  capacity: number;
  totalPriceEur: number;
  groupSize: number;
  budgets: Budget[];
  rating: number | null;
  reviewCount: number | null;
  /** From the destination's centre */
  distanceKm: number | null;
  /** R11: how well it suits the destination's objective (stayObjectiveScore), and the objective; none for "none" */
  objective?: { name: Objective; score: number | null };
};

/**
 * Rates a stay for the group. A stay that cannot sleep everyone, or whose share alone is the whole
 * budget of the poorest guest, is bad whatever else it has going for it.
 */
export function rateStayByRules(input: StayRatingInput): RuleRating {
  const rules = ratingRules.stay;
  const share = input.totalPriceEur / input.groupSize;
  const poorest = poorestOf(input.budgets);
  const ratio = share / poorest.maxBudgetEur;

  const affordability = slope(ratio, rules.comfortableShare, 1);
  const rated = input.rating === null ? rules.unratedQuality : slope(input.rating, 5, rules.ratingFloor);
  const quality = input.rating !== null && (input.reviewCount ?? 0) < rules.fewReviews ? Math.min(rated, rules.fewReviewsCap) : rated;
  const spare = Math.max(0, input.capacity - input.groupSize - 1);
  const capacity = input.capacity < input.groupSize ? 0 : clamp01(1 - spare * rules.unusedCapacityPenalty);
  const distance = input.distanceKm === null ? 0.5 : slope(input.distanceKm, rules.distanceKm.full, rules.distanceKm.zero);

  const w = rules.weights;
  // R11: the objective's part, a quarter of the score; for "none" the score is as it always was
  const score = blendObjectiveScore(Math.round(100 * (w.affordability * affordability + w.quality * quality + w.capacity * capacity + w.distance * distance)), input.objective?.score ?? null);

  if (input.capacity < input.groupSize) {
    return { verdict: "bad", score: unusableScore(score), reason: `Rules only: it sleeps ${input.capacity} and the group is ${input.groupSize}` };
  }
  if (ratio >= 1) {
    return { verdict: "bad", score: unusableScore(score), reason: `Rules only: ${euros(share)} each is more than ${poorest.name}'s whole budget` };
  }

  const facts = [
    `${euros(share)} each is ${Math.round(ratio * 100)} % of ${poorest.name}'s budget`,
    `sleeps ${input.capacity}`,
    input.rating === null ? "no rating yet" : `rated ${input.rating}${input.reviewCount ? ` (${input.reviewCount} reviews)` : ""}`,
    ...(input.objective && input.objective.score !== null ? [`suits ${input.objective.name} ${input.objective.score}/100`] : []),
  ];
  return { verdict: verdictFor(score), score, reason: `Rules only: ${facts.join(", ")}` };
}

export type TransportRatingInput = {
  /** What it costs each guest who would take it (R5) */
  costEur: number;
  /** The guests who would take it */
  budgets: Budget[];
  comfort: { level: ComfortLevel; score: number; reasons: string[] };
  /** The seller has no seat left on it: it cannot be booked */
  soldOut?: boolean;
};

/** Rates a journey for the guests who would take it: how comfortable it is (R2) and what it takes from the poorest guest's budget. */
export function rateTransportByRules(input: TransportRatingInput): RuleRating {
  const rules = ratingRules.transport;
  const poorest = poorestOf(input.budgets);
  const ratio = input.costEur / poorest.maxBudgetEur;
  const affordability = slope(ratio, rules.shares.full, rules.shares.zero);

  const w = rules.weights;
  const score = Math.round(w.comfort * input.comfort.score + w.affordability * 100 * affordability);

  const comfort = input.comfort.level === "green" ? "comfortable" : (input.comfort.reasons[0] ?? (input.comfort.level === "red" ? "uncomfortable" : "acceptable"));
  const reason = input.soldOut
    ? "Rules only: sold out, no seat is left to book"
    : `Rules only: ${comfort}, ${euros(input.costEur)} is ${Math.round(ratio * 100)} % of ${poorest.name}'s budget`;
  const bad = input.soldOut === true || input.comfort.level === "red" || ratio >= 1;
  return { verdict: bad ? "bad" : verdictFor(score), score: bad ? unusableScore(score) : score, reason };
}

/** When the stay is used: the month of arrival (1 to 12) and the destination's latitude (south of the equator, seasons swap) */
export type StaySeason = { month: number; lat: number };

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));
/** 1 at `full`, 0 at `zero`, a straight line between; an unknown distance or count is halfway */
const reach = (value: number | null, full: number, zero: number) => (value === null ? extras.rating.unknown : clampUnit((value - zero) / (full - zero)));

/** The season at the destination: the months of the northern hemisphere, six months on south of the equator */
export function seasonOf({ month, lat }: StaySeason): "summer" | "winter" | "between" {
  const local = lat < 0 ? ((month + 5) % 12) + 1 : month;
  if ((extras.chill.summerMonths as readonly number[]).includes(local)) return "summer";
  if ((extras.chill.winterMonths as readonly number[]).includes(local)) return "winter";
  return "between";
}

/**
 * R11: how well a stay suits the destination's objective, 0 to 100, from what is known about it and around it; null for
 * "none", which rates as before.
 */
export function stayObjectiveScore(objective: Objective, facts: StayFacts, season: StaySeason): number | null {
  const r = extras.rating;
  let score: number;
  switch (objective) {
    case "none":
      return null;
    case "partying": {
      const w = r.partying.weights;
      score =
        w.nightlife * reach(facts.nightlifeKm, r.partying.nightlifeKm.full, r.partying.nightlifeKm.zero) +
        w.centre * reach(facts.centreKm, r.partying.centreKm.full, r.partying.centreKm.zero) +
        w.home * (facts.provider === "airbnb" ? 1 : r.partying.hotelHome) -
        (facts.quietRules ? r.partying.quietRulesPenalty : 0);
      break;
    }
    case "chill": {
      const w = r.chill.weights;
      const now = seasonOf(season);
      const { pool, sauna } = facts.amenities;
      const seasonal = now === "summer" ? (pool ? 1 : 0) : now === "winter" ? (sauna ? 1 : 0) : pool || sauna ? r.chill.offSeason : 0;
      score =
        w.spa * (facts.amenities.spa ? 1 : 0) +
        w.season * seasonal +
        w.view * (facts.amenities.view ? 1 : 0) +
        w.quiet * reach(facts.barsWithin500m, r.chill.quietBars.full, r.chill.quietBars.zero) +
        w.calm * (facts.calmWords ? 1 : 0);
      break;
    }
    case "culture": {
      const w = r.culture.weights;
      score =
        w.historic * reach(facts.historicCentreKm, r.culture.historicCentreKm.full, r.culture.historicCentreKm.zero) +
        w.sights * (facts.sightsWithin1Km === null ? r.unknown : Math.min(1, facts.sightsWithin1Km / r.culture.fullSights));
      break;
    }
    case "nature": {
      const w = r.nature.weights;
      score = w.nature * reach(facts.natureKm, r.nature.natureKm.full, r.nature.natureKm.zero) + w.parking * (facts.freeParking ? 1 : 0);
      break;
    }
  }
  return Math.round(100 * clampUnit(score));
}

/** R11: the rules' score of a stay with its objective's part (`config.extras.rating.objectiveWeight`); unchanged without one. */
export function blendObjectiveScore(score: number, objectiveScore: number | null): number {
  if (objectiveScore === null) return score;
  const weight = extras.rating.objectiveWeight;
  return Math.round((1 - weight) * score + weight * objectiveScore);
}
