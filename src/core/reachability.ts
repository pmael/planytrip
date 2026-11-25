// Which places the POC covers, and who can get where (use-cases.md R1).
import { comfort, europe } from "@/config";
import { transportCostFor } from "./pricing";
import type { Destination, Guest, GuestModes, GeoPlace, RouteCheck, TransportMode, TransportOption } from "./types";

const EUROPEAN_COUNTRIES = new Set<string>(europe.countryCodes);

/**
 * Whether a destination is inside the POC's scope, Europe. Outside it, a destination is still
 * computed but flagged "Outside Europe, computed for reference". The country is not enough: La
 * Réunion is reported as "FR", so the position has to be in Europe too.
 */
export function isInScope(place: Pick<GeoPlace, "countryCode" | "lat" | "lon">): boolean {
  const { minLat, maxLat, minLon, maxLon } = europe.bounds;
  return (
    EUROPEAN_COUNTRIES.has(place.countryCode.toUpperCase()) &&
    place.lat >= minLat &&
    place.lat <= maxLat &&
    place.lon >= minLon &&
    place.lon <= maxLon
  );
}

/** Why a check came out negative. Stored in `route_checks.reason`. */
export const NO_ROAD_ROUTE = "no_road_route";
export const NO_AIRPORT = "no_airport";
/** The routing service was down: the mode is not verified, which is not the same as unreachable. */
export const OSRM_UNAVAILABLE = "osrm_unavailable";

/** Modes that follow roads: one routing answer covers all three. */
export const ROAD_MODES: readonly TransportMode[] = ["car", "train", "bus"];

const FALLBACK_ORDER: readonly TransportMode[] = ["plane", "train", "bus", "car"];

/**
 * R1: a plane is possible when both ends have an airport within reach. The places already list
 * the airports within AIRPORT_RADIUS_KM (150 km), so having one is what counts.
 */
export function isPlaneReachable(from: Pick<GeoPlace, "airports">, to: Pick<GeoPlace, "airports">): boolean {
  return from.airports.length > 0 && to.airports.length > 0;
}

/** A check that really found no way, as opposed to one that could not be made. */
export const isVerifiedUnreachable = (check: Pick<RouteCheck, "reachable" | "reason">) =>
  !check.reachable && check.reason !== OSRM_UNAVAILABLE;

export type ModeState =
  /** A way exists */
  | "reachable"
  /** Checked, and there is none (see `reason`) */
  | "unreachable"
  /** Checked, but the routing service was down */
  | "unverified"
  /** Not checked yet */
  | "unchecked";

export type ModeCheck = {
  mode: TransportMode;
  state: ModeState;
  reason: string | null;
  distanceKm: number | null;
  durationMin: number | null;
};

export type ReachabilityCell = {
  guestId: string;
  destinationId: string;
  /**
   * ok: at least one accepted mode gets there. warning: only by a long drive. blocked (⛔): none
   * of the accepted modes does. unverified: nothing could be confirmed, yet or because the
   * routing service was down.
   */
  status: "ok" | "warning" | "blocked" | "unverified";
  /** One entry per accepted mode */
  modes: ModeCheck[];
  /** Set when the only way is a drive of more than a day's comfortable driving ("an overnight stop will be suggested") */
  warning: { kind: "long_drive"; mode: "car"; hours: number } | null;
  /** Why it is blocked, e.g. "no_road_route" */
  reason: string | null;
  /** A mode the guest did not accept that would get them there, to offer in one click */
  fallback: TransportMode | null;
};

export type ReachabilityMatrix = { cells: ReachabilityCell[] };

export const cellFor = (matrix: ReachabilityMatrix, guestId: string, destinationId: string) =>
  matrix.cells.find((cell) => cell.guestId === guestId && cell.destinationId === destinationId);

const findCheck = (checks: RouteCheck[], destinationId: string, originKey: string, mode: TransportMode) =>
  checks.find((c) => c.destinationId === destinationId && c.originKey === originKey && c.mode === mode);

function modeCheck(checks: RouteCheck[], destinationId: string, originKey: string, mode: TransportMode): ModeCheck {
  const check = findCheck(checks, destinationId, originKey, mode);
  const state: ModeState = !check
    ? "unchecked"
    : check.reachable
      ? "reachable"
      : check.reason === OSRM_UNAVAILABLE
        ? "unverified"
        : "unreachable";
  return {
    mode,
    state,
    reason: check?.reason ?? null,
    distanceKm: check?.distanceKm ?? null,
    durationMin: check?.durationMin ?? null,
  };
}

/**
 * The mode to offer a guest who cannot get somewhere by the modes they accept (R1): among the
 * other modes that are known to get there, the cheapest when prices are known, otherwise the
 * first of plane, train, bus, car. Null when none does.
 */
export function fallbackMode(
  guest: Pick<Guest, "originKey">,
  accepted: readonly TransportMode[],
  destination: Pick<Destination, "id">,
  checks: RouteCheck[],
  options: TransportOption[] = [],
): TransportMode | null {
  const candidates = FALLBACK_ORDER.filter(
    (mode) => !accepted.includes(mode) && findCheck(checks, destination.id, guest.originKey, mode)?.reachable,
  );
  if (candidates.length === 0) return null;

  const priced = options.filter(
    (option) =>
      option.destinationId === destination.id &&
      option.originKey === guest.originKey &&
      candidates.includes(option.mode),
  );
  const cheapest = [...priced].sort((a, b) => transportCostFor(a) - transportCostFor(b))[0];
  return cheapest?.mode ?? candidates[0];
}

/** Who can get where: one cell per guest and destination, from the checks made so far. */
export function reachabilityMatrix(
  guests: Guest[],
  guestModes: GuestModes,
  destinations: Destination[],
  checks: RouteCheck[],
  options: TransportOption[] = [],
): ReachabilityMatrix {
  const cells = guests.flatMap((guest) => {
    const accepted = guestModes[guest.id] ?? [guest.preferredMode];
    return destinations.map((destination): ReachabilityCell => {
      const modes = accepted.map((mode) => modeCheck(checks, destination.id, guest.originKey, mode));
      const reachable = modes.filter((m) => m.state === "reachable");

      let status: ReachabilityCell["status"];
      let warning: ReachabilityCell["warning"] = null;
      if (reachable.length > 0) {
        status = "ok";
        const onlyCar = reachable.every((m) => m.mode === "car");
        const hours = (reachable[0].durationMin ?? 0) / 60;
        if (onlyCar && hours > comfort.car.yellowMaxHoursPerDay) {
          status = "warning";
          warning = { kind: "long_drive", mode: "car", hours: Math.round(hours * 10) / 10 };
        }
      } else if (modes.some((m) => m.state === "unverified" || m.state === "unchecked")) {
        status = "unverified";
      } else {
        status = "blocked";
      }

      return {
        guestId: guest.id,
        destinationId: destination.id,
        status,
        modes,
        warning,
        reason: status === "blocked" ? (modes[0]?.reason ?? null) : null,
        fallback: status === "blocked" ? fallbackMode(guest, accepted, destination, checks, options) : null,
      };
    });
  });
  return { cells };
}
