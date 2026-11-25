// Reading what Transitous answers (task.md T7.8). It plans journeys over the timetables of the whole of Europe
// (SNCF's, Renfe's, Trenitalia's, SBB's...) and answers with itineraries made of legs: a walk or a drive to the
// first station, the trains, a walk or a drive from the last. Only the trains matter here. Its times are UTC
// instants; the places say which time zone they are in, and the app keeps local wall-clock times.
import { z } from "zod";
import { ScrapeChangedError } from "../errors";
import type { RailLeg, TrainJourney } from "./train-types";

const Place = z.looseObject({ name: z.string(), lat: z.number(), lon: z.number(), tz: z.string().optional() });
const Leg = z.looseObject({
  mode: z.string(),
  from: Place,
  to: Place,
  startTime: z.string(),
  endTime: z.string(),
  routeShortName: z.string().optional(),
  displayName: z.string().optional(),
  routeLongName: z.string().optional(),
  agencyName: z.string().optional(),
});
const Answer = z.looseObject({ itineraries: z.array(z.looseObject({ legs: z.array(Leg) })) });

/** What is not a train: the way to and from the stations. */
const STREET = new Set(["WALK", "BIKE", "CAR", "RENTAL", "CAR_PARKING", "CAR_DROPOFF", "ODM", "RIDE_SHARING", "FLEX"]);

/** "2026-12-04T06:37:00Z" in Europe/Paris → "2026-12-04T07:37". */
export function localIso(instant: string, timeZone: string | undefined): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new ScrapeChangedError(`Transitous gave a time that is not one: ${instant}`);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: timeZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  }
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** The journeys of an answer, trains only. An answer with none (no train that day) is an empty list; one that is not shaped like an answer is an error: the site changed. */
export function parsePlan(answer: unknown): TrainJourney[] {
  const parsed = Answer.safeParse(answer);
  if (!parsed.success) throw new ScrapeChangedError("Transitous answered, but not in a form the scraper knows");

  const journeys: TrainJourney[] = [];
  for (const itinerary of parsed.data.itineraries) {
    const rides = itinerary.legs.filter((leg) => !STREET.has(leg.mode));
    if (rides.length === 0) continue;

    const legs = rides.map(
      (leg): RailLeg => ({
        from: { name: leg.from.name, lat: leg.from.lat, lon: leg.from.lon },
        to: { name: leg.to.name, lat: leg.to.lat, lon: leg.to.lon },
        departAt: localIso(leg.startTime, leg.from.tz),
        arriveAt: localIso(leg.endTime, leg.to.tz),
        train: (leg.routeShortName || leg.displayName || leg.routeLongName || "").trim(),
        operator: (leg.agencyName ?? "").trim(),
        mode: leg.mode,
      }),
    );
    const first = rides[0];
    const last = rides[rides.length - 1];
    journeys.push({
      legs,
      departAt: legs[0].departAt,
      arriveAt: legs[legs.length - 1].arriveAt,
      durationMin: Math.round((Date.parse(last.endTime) - Date.parse(first.startTime)) / 60_000),
    });
  }

  // The same train can come up twice, with another way to its station
  const seen = new Set<string>();
  return journeys.filter((journey) => {
    const key = journey.legs.map((leg) => `${leg.train}|${leg.departAt}`).join("/");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
