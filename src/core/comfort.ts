// Trip comfort (use-cases.md R2): a traffic-light level, a 0–100 score and the reasons behind them.
import { comfort as thresholds } from "@/config";
import type { ComfortLevel, TransportOption } from "./types";

/** The part of a transport option that comfort depends on. */
export type ComfortInput = Pick<
  TransportOption,
  "mode" | "variant" | "stops" | "outDepartAt" | "outDurationMin" | "backDurationMin" | "lastMileEur"
>;

export type Comfort = { level: ComfortLevel; score: number; reasons: string[] };

const LEVELS: ComfortLevel[] = ["green", "yellow", "red"];
const { transit, car, scoreWeights, scoreShape } = thresholds;

/** "23 h 40", "13 h" */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}

const formatClock = (minuteOfDay: number) =>
  `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;

/** Local wall-clock departure as minutes after midnight, read from "YYYY-MM-DDTHH:MM" without any timezone shift. */
function departureMinuteOfDay(option: ComfortInput): number | null {
  const match = option.outDepartAt?.match(/T(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

const inWindow = (minuteOfDay: number, { from, to }: { from: number; to: number }) =>
  minuteOfDay >= from * 60 && minuteOfDay < to * 60;

function scheduleLevel(minuteOfDay: number): ComfortLevel {
  if (inWindow(minuteOfDay, transit.green.departure)) return "green";
  if (transit.yellow.departureWindows.some((window) => inWindow(minuteOfDay, window))) return "yellow";
  return "red";
}

/**
 * How comfortable a local clock time "YYYY-MM-DDTHH:MM" is, by the same windows R2 applies to a
 * departure. The cards also use it for arrivals: getting in at 03:00 is no better than leaving then.
 */
export function clockComfort(localDateTime: string | null): ComfortLevel | null {
  const match = localDateTime?.match(/T(\d{2}):(\d{2})/);
  return match ? scheduleLevel(Number(match[1]) * 60 + Number(match[2])) : null;
}

const clamp = (value: number, min = 0, max = 100) => Math.min(Math.max(value, min), max);

/** Straight-line drop from 100 at `full` to 0 at `zero`. */
const slope = (value: number, full: number, zero: number) => clamp((100 * (zero - value)) / (zero - full));

/** The duration used to rate an option: the outbound leg, or the return one when it is missing. */
export const travelDurationMin = (option: Pick<ComfortInput, "outDurationMin" | "backDurationMin">) =>
  option.outDurationMin ?? option.backDurationMin ?? null;
const durationOf = travelDurationMin;

type Factor = { level: ComfortLevel; reason: string };

function transitFactors(option: ComfortInput, fastestMin: number, factors: Factor[]) {
  const stops = option.stops ?? 0;
  if (stops >= transit.red.minStops) {
    factors.push({ level: "red", reason: `${stops} stops` });
  } else if (stops > transit.green.maxStops) {
    factors.push({ level: "yellow", reason: `${stops} ${stops === 1 ? "stop" : "stops"}` });
  }

  const duration = durationOf(option);
  if (duration !== null) {
    const ratio = fastestMin > 0 ? duration / fastestMin : 1;
    if (duration > transit.red.maxDurationHours * 60) {
      factors.push({ level: "red", reason: `${formatDuration(duration)} of travel, over ${transit.red.maxDurationHours} h` });
    } else if (ratio > transit.yellow.maxDurationRatio) {
      factors.push({ level: "red", reason: `${ratio.toFixed(1)}× the fastest option (${formatDuration(fastestMin)})` });
    } else if (ratio > transit.green.maxDurationRatio) {
      factors.push({ level: "yellow", reason: `${ratio.toFixed(1)}× the fastest option (${formatDuration(fastestMin)})` });
    }
  }

  const minuteOfDay = departureMinuteOfDay(option);
  if (minuteOfDay !== null) {
    const level = scheduleLevel(minuteOfDay);
    if (level !== "green") {
      const when = minuteOfDay < transit.green.departure.from * 60 ? "early" : "late";
      factors.push({
        level,
        reason: level === "red" ? `Departs at ${formatClock(minuteOfDay)}, in the middle of the night` : `Departs at ${formatClock(minuteOfDay)}, ${when}`,
      });
    }
  }
}

function carFactors(option: ComfortInput, factors: Factor[]) {
  const duration = durationOf(option);
  if (duration === null) return;
  const hours = duration / 60;
  // For an overnight-stop variant the duration is already one day of driving
  if (hours > car.yellowMaxHoursPerDay) {
    factors.push({ level: "red", reason: `${formatDuration(duration)} of driving in a day, over ${car.yellowMaxHoursPerDay} h` });
  } else if (hours > car.greenMaxHoursPerDay) {
    factors.push({ level: "yellow", reason: `${formatDuration(duration)} of driving in a day` });
  }
}

function scoreOf(option: ComfortInput, fastestMin: number): number {
  const duration = durationOf(option);
  const isCar = option.mode === "car";

  let durationScore = 100;
  if (duration !== null) {
    durationScore = isCar
      ? slope(duration / 60, scoreShape.carFullBelowHours, scoreShape.carZeroAtHours)
      : slope(fastestMin > 0 ? duration / fastestMin : 1, 1, scoreShape.transitZeroAtRatio);
  }

  const minuteOfDay = departureMinuteOfDay(option);
  const scheduleScore =
    isCar || minuteOfDay === null ? 100 : scoreShape.scheduleScores[LEVELS.indexOf(scheduleLevel(minuteOfDay))];

  const stopsScores = scoreShape.stopsScores;
  const stopsScore = isCar ? 100 : stopsScores[Math.min(option.stops ?? 0, stopsScores.length - 1)];

  const lastMileScore = clamp(100 - option.lastMileEur * scoreShape.lastMilePenaltyPerEur);

  return Math.round(
    durationScore * scoreWeights.duration +
      scheduleScore * scoreWeights.schedule +
      stopsScore * scoreWeights.stops +
      lastMileScore * scoreWeights.lastMile,
  );
}

/**
 * Rates one transport option. `routeFastestMin` is the fastest duration (minutes) among the
 * options of the same route, the yardstick for plane, train and bus; the car ignores it.
 * The level is the worst of the criteria, `reasons` lists those that held it back (worst first)
 * and is empty for a green option.
 */
export function comfortOf(option: ComfortInput, routeFastestMin: number): Comfort {
  const factors: Factor[] = [];
  if (option.mode === "car") carFactors(option, factors);
  else transitFactors(option, routeFastestMin, factors);

  factors.sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level));
  return {
    level: factors[0]?.level ?? "green",
    score: scoreOf(option, routeFastestMin),
    reasons: factors.map((factor) => factor.reason),
  };
}

/**
 * Whether splitting this car option over two days would help: a one-driver option whose day of
 * driving is over the red limit. The overnight variant itself is already split, so it never needs
 * another stop. The trip-level rule ("every car option is red") is applied by the caller.
 */
export function needsOvernightStop(option: ComfortInput): boolean {
  if (option.mode !== "car" || option.variant === "overnight_stop") return false;
  const duration = durationOf(option);
  return duration !== null && duration / 60 > car.yellowMaxHoursPerDay;
}
