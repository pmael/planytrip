// What the train sources pass between them (task.md T7.8): a journey from the timetable, and what a source
// can tell about its price.
import type { PriceKind } from "@/core/types";
import type { ScrapeCache } from "../types";

export type Station = { name: string; lat: number; lon: number };

/** One ride on one train. */
export type RailLeg = {
  from: Station;
  to: Station;
  /** Local wall-clock times at each station, "2026-12-04T07:37" */
  departAt: string;
  arriveAt: string;
  /** "TGV INOUI 6871" */
  train: string;
  /** Who runs it: "SNCF VOYAGEURS" */
  operator: string;
  /** What kind of train the timetable says: HIGHSPEED_RAIL, LONG_DISTANCE, NIGHT_RAIL, REGIONAL_RAIL */
  mode: string;
};

/** A way to get from one place to another by train, changes included. Nothing about the walk or drive to the station. */
export type TrainJourney = {
  legs: RailLeg[];
  /** From the first station's departure to the last's arrival, in local wall-clock time */
  departAt: string;
  arriveAt: string;
  durationMin: number;
};

/** What a source says a journey costs, one way, for one adult. */
export type FareQuote = {
  priceEur: number;
  kind: PriceKind;
  /** Where an estimate comes from, in a few words */
  note: string | null;
  source: string;
  /** Where to check or buy it */
  link: string;
};

/**
 * A model of what trains cost, trained on prices seen on SNCF Connect (task.md T7.9). It answers only for the trains it was trained
 * for, and only once it has proved itself: otherwise it answers null and the simple estimate stands.
 */
export interface PricePredictor {
  /** A direct train whose published fare range is known: where its price falls in it, in euros */
  withinRange(journey: TrainJourney, range: { min: number; max: number }): { priceEur: number; note: string } | null;
  /** Any other train: its price from the distance */
  byDistance(journey: TrainJourney): { priceEur: number; note: string } | null;
}

/** The seller knows the train and has no seat left on it: the next sources still give it a price, as an estimate. */
export type SoldOut = { soldOut: true; source: string };

export const isSoldOut = (answer: FareQuote | SoldOut | null | undefined): answer is SoldOut => answer != null && "soldOut" in answer;

/**
 * A source that knows the price of the journeys it recognises (its own trains, or a published range). `Answer` narrows what it can
 * say: a source that never knows a train is full is a FareSource<FareQuote | null>.
 */
export interface FareSource<Answer extends FareQuote | SoldOut | null = FareQuote | SoldOut | null> {
  id: string;
  /**
   * What each journey costs, one way, for one adult; null for a journey this source does not know, SoldOut for one it knows is
   * full. All the journeys of one day are given together, so that a source can ask its site once for all of them.
   */
  quote(journeys: TrainJourney[], context: { cache: ScrapeCache; refresh?: boolean }): Promise<Answer[]>;
}
