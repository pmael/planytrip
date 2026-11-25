// How the Destinations page writes down what the service worked out, and the small pure pieces
// behind its interactions.
import type { Blocker } from "@/core/recommend";
import type { BudgetLevel, BudgetTier, Objective } from "@/core/types";
import type { DeliberationGuest, Dossier, GuestCell, ReadyDeliberation } from "@/server/services/deliberation";

export const OBJECTIVE_LABELS: Record<Objective, string> = {
  partying: "Partying",
  chill: "Chill",
  culture: "Culture",
  nature: "Nature",
  none: "No theme",
};

export const BUDGET_LEVEL_LABELS: Record<BudgetLevel, string> = {
  light: "Light budget",
  medium: "Medium budget",
  high: "High budget",
};

/** "FR" → "France". Falls back to the code itself when the runtime does not know it. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** "Martin" → "M", "Jean Paul" → "JP" */
export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

/** What marks a guest on the page: the colour of their avatar, kept per guest across every section. */
const GUEST_HUES = ["#3f7a62", "#4a78b8", "#b07a3a", "#a9586e", "#7a5cb8", "#3e8f9e"];
export const guestHue = (index: number) => GUEST_HUES[index % GUEST_HUES.length];

/** The state of a guest at a destination, in one word: a budget tier, or ⛔ when they cannot get there. */
export type Standing = BudgetTier | "unreachable";
export const standingOfCell = (cell: Pick<GuestCell, "status" | "tier">): Standing => (cell.status === "unreachable" ? "unreachable" : cell.tier);

export const STANDING_HEX: Record<Standing, string> = {
  comfy: "#2ec48f",
  limited: "#c9a227",
  over: "#d33a2f",
  unreachable: "#8d939a",
};

export const STANDING_WORD: Record<Standing, string> = {
  comfy: "Comfy",
  limited: "Limited",
  over: "Over budget",
  unreachable: "No way there",
};

/** "Jessy +90 €" or "Martin ⛔" (use-cases.md C-S6) */
export const blockerLabel = (blocker: Blocker) =>
  blocker.kind === "over" ? `${blocker.name} +${Math.round(blocker.overBudgetEur)} €` : `${blocker.name} ⛔`;

/** The sentence under a destination's name: that it works for everyone, or who it does not work for. */
export function verdictOf(dossier: Pick<Dossier, "eligible" | "standing" | "blockers">, guestCount: number): string {
  if (dossier.eligible) {
    const { comfy } = dossier.standing;
    return comfy === guestCount ? "Works for everyone, comfortably" : `Works for everyone, ${comfy} of ${guestCount} comfortably`;
  }
  return `Doesn't work for ${dossier.blockers.length} of ${guestCount}`;
}

/** The ★ votes, overlaid on what the server last said, so a vote shows at once. `null` is a vote taken off. */
export function withVotes(view: ReadyDeliberation, votes: Record<string, string | null>): ReadyDeliberation {
  const favoriteOf = (guest: DeliberationGuest) => (guest.id in votes ? votes[guest.id] : guest.favoriteId);
  const guests = view.guests.map((guest) => ({ ...guest, favoriteId: favoriteOf(guest) }));
  const destinations = view.destinations.map((dossier) => {
    const voters = guests.filter((guest) => guest.favoriteId === dossier.id);
    return {
      ...dossier,
      votes: { count: voters.length, guestIds: voters.map((guest) => guest.id) },
      cells: dossier.cells.map((cell) => ({ ...cell, starred: voters.some((guest) => guest.id === cell.guestId) })),
    };
  });
  return { ...view, guests, destinations };
}
