// How the app tells the person about the ratings it keeps for the options: that the AI could not
// rate some of them and the rules did ("not rated by the AI"), and that some may be out of date.
import type { RatingKind } from "@/core/types";
import type { RatingStatus } from "@/server/services/ratings";

/** "A", "A and B", "A, B and C". */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What a rating pass was about, for a sentence: "the housing at Barcelona and Réunion". */
function subjectOf(kind: RatingKind, destinations: string[]): string {
  return `the ${kind === "stays" ? "housing at" : "transport to"} ${listOf(destinations)}`;
}

/** What the ratings are about, a sentence's subject: each kind with something to say and its destinations, in a stable order. */
function subjectsOf(items: { destination: string; kind: RatingKind }[]): { text: string; plural: boolean } {
  const subjects = (["stays", "transport"] as const).flatMap((kind) => {
    const destinations = [...new Set(items.filter((item) => item.kind === kind).map((item) => item.destination))];
    return destinations.length > 0 ? [{ text: subjectOf(kind, destinations), plural: destinations.length > 1 }] : [];
  });
  return { text: listOf(subjects.map((subject) => subject.text)), plural: subjects.length > 1 || subjects.some((subject) => subject.plural) };
}

export type RatingNotice = {
  /** The headline */
  title: string;
  text: string;
  /** What went wrong, when it is known */
  detail: string | null;
  /** What the button offers to do */
  action: string;
};

export type RatingNotices = {
  /** The rules scored it because the AI was not available */
  notRated: RatingNotice | null;
  /** The AI scored it, for facts that have since changed */
  outOfDate: RatingNotice | null;
};

/** What to tell the person about the ratings of a trip; nothing to say gives nulls. */
export function ratingNoticesOf(status: RatingStatus): RatingNotices {
  const byRules = subjectsOf(status.byRules);
  const stale = subjectsOf(status.stale);
  const why = status.byRules.find((entry) => entry.message)?.message ?? null;

  return {
    notRated:
      status.byRules.length === 0
        ? null
        : {
            title: "Not rated by the AI",
            text: `${capitalise(byRules.text)} ${byRules.plural ? "were" : "was"} scored with simple rules instead of the AI, because it wasn’t available.`,
            detail: why,
            action: "Rate with the AI",
          },
    outOfDate:
      status.stale.length === 0
        ? null
        : {
            title: "These scores may be out of date",
            text: `A guest’s budget, the dates or an offer changed since the AI rated ${stale.text}. Rating again brings them up to date; nothing is asked of the AI until you do.`,
            detail: null,
            action: "Re-rate with the AI",
          },
  };
}
