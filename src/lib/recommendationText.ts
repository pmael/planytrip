// How the recommendation explains itself in words (use-cases.md C-S6): every sentence carries the
// numbers it rests on.
import { formatEur } from "./form";
import { MODE_LABELS } from "./reachabilityText";
import type { BlockerView, Recommendation, RecommendationReason } from "@/server/services/dashboard";

const lower = (text: string) => text.toLowerCase();

/** "Jessy +907 €", or "Martin cannot go by car (plane fallback: +507 €)" (C.1 step 5). */
export function blockerText(blocker: BlockerView): string {
  if (blocker.kind === "over") return `${blocker.name} +${Math.round(blocker.overBudgetEur)} €`;

  const modes = blocker.modes.map((mode) => lower(MODE_LABELS[mode])).join(" or ");
  const { fallback } = blocker;
  const instead = !fallback
    ? "no other way found"
    : fallback.overBudgetEur > 0
      ? `${lower(MODE_LABELS[fallback.mode])} fallback: +${Math.round(fallback.overBudgetEur)} €`
      : `${lower(MODE_LABELS[fallback.mode])} fallback: ${formatEur(fallback.costEur)}`;
  return `${blocker.name} cannot go${modes ? ` by ${modes}` : ""} (${instead})`;
}

const list = (blockers: BlockerView[]) => blockers.map(blockerText).join(", ");

/** "Barcelona works for everyone: 1,235 € in total." */
export function headlineOf(recommendation: Pick<Recommendation, "works" | "shortLabel" | "totalEur">): string {
  return recommendation.works
    ? `${recommendation.shortLabel} works for everyone: ${formatEur(recommendation.totalEur)} in total.`
    : `No destination works for everyone yet. Closest: ${recommendation.shortLabel}.`;
}

/** One reason, in a sentence. */
export function reasonText(reason: RecommendationReason): string {
  switch (reason.kind) {
    case "works": {
      const comfort = reason.averageComfort === null ? "" : `, and the journeys average ${Math.round(reason.averageComfort)}/100 for comfort`;
      return `Everyone can get there and nobody is over budget. ${reason.comfyGuests} of ${reason.guests} guests are comfortably within budget${comfort}.`;
    }
    case "leads": {
      const { over, mine, theirs } = reason;
      switch (reason.criterion) {
        case "eligibility":
          return `${over} doesn't work for everyone: ${list(reason.theirBlockers)}.`;
        case "comfy":
          return `${over} has fewer guests comfortably within budget (${theirs.comfyGuests} against ${mine.comfyGuests}).`;
        case "overrun":
          return `${over} is further from working: its guests are over budget by ${formatEur(theirs.overrunEur)} in all, against ${formatEur(mine.overrunEur)}.`;
        case "comfort":
          return `${over}'s journeys are less comfortable (${Math.round(theirs.averageComfort ?? 0)}/100 against ${Math.round(mine.averageComfort ?? 0)}/100).`;
        case "votes":
          return `Level with ${over} on everything else, it has more ★ (${mine.votes} against ${theirs.votes}).`;
        case "price":
          return `Level with ${over} on everything else, it is cheaper (${formatEur(mine.totalEur)} against ${formatEur(theirs.totalEur)}).`;
        case "order":
          return `Level with ${over} on everything: the order the destinations were added decides.`;
      }
      return "";
    }
    case "closest":
      return `It is the closest to working. In the way: ${list(reason.blockers)}.`;
    case "star_cannot_override":
      return `${reason.names.join(", ")} put${reason.names.length === 1 ? "s" : ""} a ★ on ${reason.destination}, but a ★ never makes a destination eligible (${list(reason.blockers)}).`;
  }
}
