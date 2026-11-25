// Trains all over Europe (task.md T7.8, train-sources.md).
//
// How it works, and why:
// - While SNCF Connect is turned on in Settings and answers, its trains are the trains of the search: SNCF's own times,
//   stations and changes, at the price it sells them (sncf-connect.ts). Nothing is guessed: a train with no price is left
//   out, a full one is shown as sold out.
// - Otherwise (turned off, Chrome closed, turned away, a place it does not know, a day not on sale yet, nothing within
//   reach of the stay) the journeys come from Transitous' timetables, anywhere in Europe, and the price of each from the
//   best source that knows it: a seller's own fare (Trenitalia), then SNCF's published fare range for French high-speed
//   trains, then the distance. Only the first is a real price: the others are marked "estimated" and say where they come
//   from, so the budget and the AI know how far to trust them. Why SNCF Connect was not used is kept in `fareProblems`.
// - A fare source that fails or turns us away says nothing for the rest of the search; the journeys it would have priced
//   fall to the next source. Only the timetable failing fails the search.
// - RegioJet and FlixBus list their own journeys with real prices (regiojet.ts, flixbus.ts): journeys that are
//   entirely theirs are left out here, so that they do not come up twice, the second time without a price.
// - Each outbound journey is paired with the cheapest way back. A way there with no way back is not a trip.
import { cacheTtlMs, lastMile, trains } from "@/config";
import { stationKey } from "@/core/stations";
import { distanceKm } from "@/geo/airports";
import { noCache } from "../cache";
import { ScrapeBlockedError, ScrapeError } from "../errors";
import { createHttp, userAgentFor } from "../http";
import type { ScrapeCache, TransportAdapter, TransportOptionInput, TransportQuery } from "../types";
import { createSncfConnect, placeName, quoteOf, SNCF_CONNECT, toJourney, type SncfConnectTrains } from "./sncf-connect";
import { createSncfFares } from "./sncf-fares";
import { createSncfStations, type Position, type StationTable } from "./sncf-stations";
import { mainOperator } from "./train-operators";
import { isSoldOut, type FareQuote, type FareSource, type PricePredictor, type TrainJourney } from "./train-types";
import { createTransitous, type Timetable } from "./transitous";
import { createTrenitalia } from "./trenitalia";

export type TrainsSettings = {
  transitous: Pick<typeof trains.transitous, "maxTransfers" | "maxDurationRatio" | "maxOptions" | "maxBackOptions" | "maxStationDistanceKm">;
  distanceEstimate: typeof trains.distanceEstimate;
  links: typeof trains.links;
};

const SOURCE = "transitous";
/** Sellers whose own adapters list their journeys with real prices */
const LISTED_ELSEWHERE = /flix|regiojet|student agency/i;

const place = (p: { lat: number; lon: number }) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;

/** What the transfer from the arrival station to the destination costs, beyond the distance where it matters (B-S3). */
const lastMileOf = (station: { lat: number; lon: number }, destination: { lat: number; lon: number }): number => {
  const km = distanceKm(station.lat, station.lon, destination.lat, destination.lon);
  return km >= lastMile.minDistanceKm ? Math.round((km / 10) * lastMile.eurPer10Km) : 0;
};

export function createTrainsAdapter({
  timetable,
  fares,
  config = trains,
  now = () => new Date(),
  predictor,
  sncfConnect,
  stations = async () => new Map(),
}: {
  timetable: Timetable;
  /** In the order they are trusted, for the timetable's journeys */
  fares: FareSource[];
  config?: TrainsSettings;
  now?: () => Date;
  /** The model of the prices seen on SNCF Connect, which replaces the rate per kilometre once it has proved itself */
  predictor?: PricePredictor;
  /** The trains as SNCF Connect sells them: asked first while it is on, the timetable only when it cannot answer */
  sncfConnect?: SncfConnectTrains;
  /** Where SNCF's stations are, for the trains read on SNCF Connect */
  stations?: () => Promise<StationTable>;
}): TransportAdapter {
  const linkFor = (journey: TrainJourney) => {
    const operators = journey.legs.map((leg) => mainOperator({ ...journey, legs: [leg] }).slug);
    if (operators.every((slug) => slug === "sncf")) return config.links.sncf;
    if (operators.every((slug) => slug === "trenitalia")) return config.links.trenitalia;
    return config.links.other;
  };

  /** What a train costs when nobody says: what the model says once it is in use, else so much a kilometre of the way. */
  const estimate = (journey: TrainJourney): FareQuote => {
    const modeled = predictor?.byDistance(journey);
    if (modeled) return { priceEur: Math.max(config.distanceEstimate.minEur, Math.round(modeled.priceEur)), kind: "estimated", note: modeled.note, source: "model", link: linkFor(journey) };
    const km = journey.legs.reduce((sum, leg) => sum + distanceKm(leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon), 0);
    const { eurPerKm, minEur } = config.distanceEstimate;
    return {
      priceEur: Math.max(minEur, Math.round(km * eurPerKm)),
      kind: "estimated",
      note: `Estimated from the distance, no fare is published for this train`,
      source: "distance",
      link: linkFor(journey),
    };
  };

  /**
   * The journeys worth offering: not the ones that go all round, nor those that stop far from where the group is going
   * (the timetable plans for the earliest arrival, and a station 80 km off may be that), quickest first when there are
   * too many. `atDestination` is the station of a journey that is at the destination's end.
   */
  function select(journeys: TrainJourney[], destination: { lat: number; lon: number }, atDestination: (journey: TrainJourney) => { lat: number; lon: number }, maxOptions: number): TrainJourney[] {
    const { maxTransfers, maxDurationRatio, maxStationDistanceKm } = config.transitous;
    const own = journeys
      .filter((journey) => !journey.legs.every((leg) => LISTED_ELSEWHERE.test(leg.operator)))
      .filter((journey) => {
        const station = atDestination(journey);
        return distanceKm(station.lat, station.lon, destination.lat, destination.lon) <= maxStationDistanceKm;
      });
    if (own.length === 0) return [];
    const quickest = Math.min(...own.map((journey) => journey.durationMin));
    return own
      .filter((journey) => journey.legs.length - 1 <= maxTransfers && journey.durationMin <= quickest * maxDurationRatio)
      .sort((a, b) => a.legs.length - b.legs.length || a.durationMin - b.durationMin)
      .slice(0, maxOptions)
      .sort((a, b) => a.departAt.localeCompare(b.departAt));
  }

  type Priced = { journey: TrainJourney; quote: FareQuote & { soldOut: boolean } };

  /** Each way there with the way back to pair with it, as the options of the search */
  function optionsOf(query: TransportQuery, out: Priced[], back: Priced[], raw: { source: string; problems: string[] }): TransportOptionInput[] {
    // The way back to pair with each way there: one with seats left while there is one; then the cheapest of the real fares;
    // when none is real, an estimate cannot tell one journey from another, so the one with the fewest changes and the shortest time
    const withSeats = back.filter(({ quote }) => !quote.soldOut);
    const backs = withSeats.length > 0 ? withSeats : back;
    const realBacks = backs.filter(({ quote }) => quote.kind === "live");
    const cheapestBack = realBacks.length > 0
      ? realBacks.sort((a, b) => a.quote.priceEur - b.quote.priceEur || a.journey.durationMin - b.journey.durationMin)[0]
      : backs.sort((a, b) => a.journey.legs.length - b.journey.legs.length || a.journey.durationMin - b.journey.durationMin)[0];

    return out.map(({ journey, quote: there }): TransportOptionInput => {
      const notes = [...new Set([there, cheapestBack.quote].flatMap((quote) => (quote.kind === "estimated" && quote.note ? [quote.note] : [])))];
      const last = journey.legs[journey.legs.length - 1];
      return {
        originKey: query.origin.key,
        mode: "train",
        provider: mainOperator(journey).slug,
        variant: "standard",
        outDepartAt: journey.departAt,
        outArriveAt: journey.arriveAt,
        backDepartAt: cheapestBack.journey.departAt,
        backArriveAt: cheapestBack.journey.arriveAt,
        outDurationMin: journey.durationMin,
        backDurationMin: cheapestBack.journey.durationMin,
        stops: journey.legs.length - 1,
        priceEur: there.priceEur + cheapestBack.quote.priceEur,
        priceUnit: "per_person",
        priceKind: there.kind === "live" && cheapestBack.quote.kind === "live" ? "live" : "estimated",
        priceNote: notes.length > 0 ? notes.join(" · ") : null,
        soldOut: there.soldOut || cheapestBack.quote.soldOut,
        lastMileEur: lastMileOf(last.to, query.destination),
        comfortScore: null,
        comfortLevel: null,
        url: there.link,
        raw: {
          source: raw.source,
          out: { legs: journey.legs, price: there },
          back: { legs: cheapestBack.journey.legs, price: cheapestBack.quote },
          ...(raw.problems.length > 0 ? { fareProblems: raw.problems } : {}),
        },
      };
    });
  }

  /**
   * The search's options from SNCF Connect's trains, at their real price; null, with the reason in `problems`, when it has none
   * to offer one way or the other: the timetable is asked then.
   */
  async function fromSncfConnect(seller: SncfConnectTrains, query: TransportQuery, cache: ScrapeCache, problems: string[]): Promise<TransportOptionInput[] | null> {
    const from = placeName(query.origin.label);
    const to = placeName(query.destination.label);
    const context = { cache, refresh: query.refresh };

    let known: StationTable = new Map();
    try {
      known = await stations();
    } catch (error) {
      if (!(error instanceof ScrapeError)) throw error;
      problems.push(`${SNCF_CONNECT}: ${error.message}`);
    }
    // A station SNCF's list does not have (abroad) is placed at the end of the way it is at: the transfer is then not counted
    const placed = (start: Position, end: Position) => (code: string | null | undefined, side: "origin" | "destination") =>
      (code ? known.get(code) : undefined) ?? (side === "origin" ? start : end);

    /** One way's trains worth offering, at their price; null, with the reason in `problems`, when there is none to offer */
    const way = async (origin: string, destination: string, date: string, start: Position, end: Position, atDestination: (journey: TrainJourney) => Position, maxOptions: number) => {
      // One way after the other: both drive the same Chrome, and the way back is not asked when there is no way there
      const day = await seller.day({ origin, destination, date }, context);
      if (day === null) {
        problems.push(`${SNCF_CONNECT}: knows no place called "${origin}" or "${destination}"`);
        return null;
      }
      const priced = day.flatMap((train): Priced[] => {
        const journey = toJourney(train, placed(start, end));
        const answer = quoteOf(train, config.links.sncf);
        // A train with no price (sales not open yet) is not offered: there is nothing to book
        if (!journey || answer === null) return [];
        return [{ journey, quote: "soldOut" in answer ? { ...estimate(journey), soldOut: true } : { ...answer, soldOut: false } }];
      });
      const chosen = choose(oneOfEach(priced), query.destination, atDestination, maxOptions);
      if (!chosen.some(({ quote }) => quote.kind === "live" && !quote.soldOut)) {
        problems.push(`${SNCF_CONNECT}: no train from ${origin} to ${destination} with a price on ${date} (${day.length} listed: sales may not be open yet)`);
        return null;
      }
      return chosen;
    };

    const out = await way(from, to, query.window.from, query.origin, query.destination, (journey) => journey.legs[journey.legs.length - 1].to, config.transitous.maxOptions);
    if (!out) return null;
    const back = await way(to, from, query.window.to, query.destination, query.origin, (journey) => journey.legs[0].from, Number.POSITIVE_INFINITY);
    if (!back) return null;
    return optionsOf(query, out, back, { source: SNCF_CONNECT, problems });
  }

  /**
   * One train per departure, arrival and stations: SNCF lists two trains coupled together under both their numbers (Paris →
   * Toulouse 17:06, TGV INOUI 8517 and 12267, 22 Dec 2026), and a person sees one. The one with seats, then the cheaper, is kept.
   */
  function oneOfEach(trainsOfDay: Priced[]): Priced[] {
    const rank = ({ quote }: Priced) => [quote.soldOut ? 1 : 0, quote.kind === "live" ? 0 : 1, quote.priceEur];
    const better = (a: Priced, b: Priced) => {
      const [ra, rb] = [rank(a), rank(b)];
      const index = ra.findIndex((value, i) => value !== rb[i]);
      return index >= 0 && ra[index] < rb[index];
    };
    const kept = new Map<string, Priced>();
    for (const train of trainsOfDay) {
      const { legs, departAt, arriveAt } = train.journey;
      const key = [departAt, arriveAt, stationKey(legs[0].from.name), stationKey(legs[legs.length - 1].to.name), legs.length].join("|");
      const other = kept.get(key);
      if (!other || better(train, other)) kept.set(key, train);
    }
    return [...kept.values()];
  }

  /** The trains worth offering among SNCF Connect's, as select() chooses them, and the cheapest one with seats, however slow */
  function choose(trainsOfDay: Priced[], destination: Position, atDestination: (journey: TrainJourney) => Position, maxOptions: number): Priced[] {
    const byJourney = new Map(trainsOfDay.map((train) => [train.journey, train]));
    const chosen = select(trainsOfDay.map(({ journey }) => journey), destination, atDestination, maxOptions).map((journey) => byJourney.get(journey)!);
    const reachable = trainsOfDay.filter(({ journey }) => {
      const station = atDestination(journey);
      return journey.legs.length - 1 <= config.transitous.maxTransfers && distanceKm(station.lat, station.lon, destination.lat, destination.lon) <= config.transitous.maxStationDistanceKm;
    });
    const cheapest = reachable.filter(({ quote }) => quote.kind === "live" && !quote.soldOut).sort((a, b) => a.quote.priceEur - b.quote.priceEur)[0];
    if (cheapest && !chosen.includes(cheapest)) chosen.push(cheapest);
    return chosen.sort((a, b) => a.journey.departAt.localeCompare(b.journey.departAt));
  }

  return {
    id: SOURCE,
    modes: ["train"],
    async search(query) {
      if (query.mode !== "train") return [];
      // No train is sold for a day that has already begun
      if (query.window.from <= now().toISOString().slice(0, 10)) return [];

      const cache: ScrapeCache = query.cache ?? noCache;
      const problems: string[] = [];

      if (sncfConnect?.isOn()) {
        try {
          const options = await fromSncfConnect(sncfConnect, query, cache, problems);
          if (options) return options;
        } catch (error) {
          if (!(error instanceof ScrapeError)) throw error;
          problems.push(`${SNCF_CONNECT}: ${error.message}`);
        }
      }

      const journeysOn = (from: { lat: number; lon: number }, to: { lat: number; lon: number }, day: string) =>
        cache.remember<TrainJourney[]>(`plan|${place(from)}|${place(to)}|${day}`, SOURCE, cacheTtlMs.scrape, () => timetable.journeys(from, to, day), {
          refresh: query.refresh,
          // No train at all may be a timetable that did not load: not to be believed for a day
          keepIf: (journeys) => journeys.length > 0,
        });

      const out = select(await journeysOn(query.origin, query.destination, query.window.from), query.destination, (journey) => journey.legs[journey.legs.length - 1].to, config.transitous.maxOptions);
      if (out.length === 0) return [];
      const back = select(await journeysOn(query.destination, query.origin, query.window.to), query.destination, (journey) => journey.legs[0].from, config.transitous.maxBackOptions);
      if (back.length === 0) return [];

      const turnedAway = new Set<string>();
      // A journey a seller says is full is still priced by the next sources (an estimate), and remembered as sold out
      async function price(journeys: TrainJourney[]): Promise<Priced[]> {
        const quotes: (FareQuote | null)[] = journeys.map(() => null);
        const soldOut = journeys.map(() => false);
        for (const source of fares) {
          const open = quotes.flatMap((quote, index) => (quote === null ? [index] : []));
          if (open.length === 0 || turnedAway.has(source.id)) continue;
          try {
            const answered = await source.quote(open.map((index) => journeys[index]), { cache, refresh: query.refresh });
            open.forEach((index, n) => {
              const answer = answered[n];
              if (isSoldOut(answer)) soldOut[index] = true;
              else quotes[index] = answer ?? null;
            });
          } catch (error) {
            if (!(error instanceof ScrapeError)) throw error;
            // This source says nothing more for this search, the next one is asked
            if (error instanceof ScrapeBlockedError) turnedAway.add(source.id);
            problems.push(`${source.id}: ${error.message}`);
          }
        }
        return journeys.map((journey, index) => ({ journey, quote: { ...(quotes[index] ?? estimate(journey)), soldOut: soldOut[index] } }));
      }

      return optionsOf(query, await price(out), await price(back), { source: SOURCE, problems });
    },
  };
}

/**
 * The real thing: SNCF Connect's trains when it is turned on in Settings; otherwise Transitous' timetables, Trenitalia's fares,
 * SNCF's published ranges, and the price model when there is one in use.
 */
export function createRealTrainsAdapter({
  predictor,
  sncfConnectOn = () => trains.sncfConnect.enabled,
}: {
  predictor?: PricePredictor;
  /** Asked on each search: whether SNCF Connect is read through the person's Chrome */
  sncfConnectOn?: () => boolean;
} = {}): TransportAdapter {
  return createTrainsAdapter({
    timetable: createTransitous({
      http: createHttp({ source: "Transitous", userAgent: userAgentFor(trains.transitous.contact), pauseMs: trains.transitous.pauseMs, timeoutMs: trains.transitous.timeoutMs }),
    }),
    fares: [
      createTrenitalia({
        http: createHttp({ source: "Trenitalia", userAgent: userAgentFor(null), pauseMs: trains.trenitalia.pauseMs, timeoutMs: trains.trenitalia.timeoutMs }),
      }),
      createSncfFares({ predictor }),
    ],
    predictor,
    sncfConnect: createSncfConnect({ isOn: sncfConnectOn }),
    stations: createSncfStations(),
  });
}
