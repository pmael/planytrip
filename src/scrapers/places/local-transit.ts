// How long public transport takes between two points of a destination at a given hour (task.md T8.6), from Transitous:
// buses, trams, metros and trains, the whole of Europe's open timetables. Asked at setup, kept a month: from the airport
// or station to each stay (at midday), and back from the nightlife district to each stay (at three in the morning).
import { trains } from "@/config";
import { z } from "zod";
import { noCache } from "../cache";
import { ScrapeChangedError } from "../errors";
import { createHttp, userAgentFor, type Http } from "../http";
import type { ScrapeCache } from "../types";

export type Point = { lat: number; lon: number };

/** The quickest journey leaving within the hour after `atUtc`, in minutes; null when there is none */
export type LocalTransit = (from: Point, to: Point, atUtc: string, context?: { cache?: ScrapeCache }) => Promise<number | null>;

const Plan = z.looseObject({
  itineraries: z.array(z.looseObject({ duration: z.number(), startTime: z.string(), legs: z.array(z.looseObject({ mode: z.string() })) })),
  direct: z.array(z.looseObject({ duration: z.number() })).optional(),
});

/** The quickest itinerary that rides something, leaving within `windowMin` of the hour asked; a walk only when shorter */
export function quickestOf(answer: unknown, atUtc: string, windowMin = 60): number | null {
  const parsed = Plan.safeParse(answer);
  if (!parsed.success) throw new ScrapeChangedError("Transitous answered, but not with journeys");
  const start = Date.parse(atUtc);
  const rides = parsed.data.itineraries
    .filter((itinerary) => itinerary.legs.some((leg) => leg.mode !== "WALK") && Date.parse(itinerary.startTime) - start <= windowMin * 60_000)
    .map((itinerary) => itinerary.duration);
  const walks = (parsed.data.direct ?? []).map((walk) => walk.duration);
  const best = Math.min(...rides, ...walks);
  return Number.isFinite(best) ? Math.round(best / 60) : null;
}

export function createLocalTransit({
  http = createHttp({ source: "Transitous", userAgent: userAgentFor(trains.transitous.contact), pauseMs: trains.transitous.pauseMs, timeoutMs: trains.transitous.timeoutMs }),
  apiUrl = trains.transitous.apiUrl,
  cacheTtlMs = 30 * 24 * 60 * 60 * 1000,
}: { http?: Http; apiUrl?: string; cacheTtlMs?: number } = {}): LocalTransit {
  return (from, to, atUtc, { cache = noCache } = {}) => {
    const key = `local|${from.lat.toFixed(4)},${from.lon.toFixed(4)}|${to.lat.toFixed(4)},${to.lon.toFixed(4)}|${atUtc.slice(11, 16)}`;
    return cache.remember(key, "transitous", cacheTtlMs, async () => {
      const params = new URLSearchParams({
        fromPlace: `${from.lat},${from.lon}`,
        toPlace: `${to.lat},${to.lon}`,
        time: atUtc,
        arriveBy: "false",
        numItineraries: "3",
        searchWindow: "3600",
        maxPreTransitTime: "900",
        maxPostTransitTime: "900",
        detailedLegs: "false",
        detailedTransfers: "false",
        language: "en",
      });
      return quickestOf(await http.getJson(`${apiUrl}/v6/plan?${params}`), atUtc);
    });
  };
}

export const localTransit: LocalTransit = createLocalTransit();
