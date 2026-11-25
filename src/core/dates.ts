// Pure date logic of the trip: the window every guest is available (use-cases.md §1.2, A-S2).
// Dates are ISO calendar days ("2026-08-26"), so they compare correctly as plain strings.
import type { DateRange, Destination, Guest, IsoDate } from "./types";

type Availability = Pick<Guest, "availableFrom" | "availableTo">;
type DestinationDates = Pick<Destination, "dateFrom" | "dateTo">;

const DAY_MS = 24 * 60 * 60 * 1000;

const latest = (dates: IsoDate[]) => dates.reduce((a, b) => (a > b ? a : b));
const earliest = (dates: IsoDate[]) => dates.reduce((a, b) => (a < b ? a : b));

/**
 * The days on which every guest is available (and, when given, the destination's own dates).
 * Both ends are inclusive. Returns null when nobody is available together, or when there is no
 * guest: that is the "No common dates" case that blocks the wizard. A one-day overlap is a valid
 * window with 0 nights.
 */
export function commonWindow(guests: Availability[], dest?: DestinationDates): DateRange | null {
  if (guests.length === 0) return null;

  const froms = guests.map((guest) => guest.availableFrom);
  const tos = guests.map((guest) => guest.availableTo);
  if (dest?.dateFrom) froms.push(dest.dateFrom);
  if (dest?.dateTo) tos.push(dest.dateTo);

  const range = { from: latest(froms), to: earliest(tos) };
  return range.from <= range.to ? range : null;
}

/** Number of nights between the first and the last day, e.g. 26/08 → 05/09 is 10. */
export function nightsBetween(range: DateRange): number {
  // Both dates are read as UTC midnights, so daylight saving can't shift the result
  return Math.round((Date.parse(range.to) - Date.parse(range.from)) / DAY_MS);
}

/**
 * The guests who set the edges of the window ("limited by Martin"): those whose availability
 * ends the window early or starts it late, while another guest could have gone further.
 * Guests who share an edge with everyone else are not limiting anyone.
 */
export function limitingGuests<G extends Availability>(guests: G[], range: DateRange): G[] {
  const startsLate = guests.some((guest) => guest.availableFrom < range.from);
  const endsEarly = guests.some((guest) => guest.availableTo > range.to);

  return guests.filter(
    (guest) =>
      (startsLate && guest.availableFrom === range.from) || (endsEarly && guest.availableTo === range.to),
  );
}

/** How well an availability fits a window: all of it, some of it, or none of it. */
export type DatesCoverage = "covers" | "partial" | "none";

export function coverageOf(availability: Availability, range: DateRange): DatesCoverage {
  if (availability.availableFrom <= range.from && availability.availableTo >= range.to) return "covers";
  const overlaps = availability.availableFrom <= range.to && availability.availableTo >= range.from;
  return overlaps ? "partial" : "none";
}

/**
 * When there is no common window, the two guests who clash: the one who arrives last and the one
 * who leaves first ("No common dates between Martin and Jessy"). Null when there is a window.
 */
export function noCommonDates<G extends Availability>(guests: G[]): [G, G] | null {
  if (guests.length < 2 || commonWindow(guests)) return null;
  const arrivesLast = guests.reduce((a, b) => (b.availableFrom > a.availableFrom ? b : a));
  const leavesFirst = guests.reduce((a, b) => (b.availableTo < a.availableTo ? b : a));
  return [arrivesLast, leavesFirst];
}

/** "2027-08-26" plus 5 days is "2027-08-31". Works on calendar days, so daylight saving never shifts it. */
export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The days of the trip: the whole window, or its first `nights` nights when the trip is set to be
 * shorter (`trips.nights`; null means the whole window).
 */
export function tripWindow(window: DateRange, nights: number | null): DateRange {
  if (nights === null) return window;
  const to = addDays(window.from, nights);
  return { from: window.from, to: to < window.to ? to : window.to };
}
