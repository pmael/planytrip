// Reading what Google Flights answers (task.md T7.2). The page asks its own server for the flights
// (`GetShoppingResults`) and gets back nested arrays with no field names, behind a few framing lines.
// This reads the ones that matter and nothing else. They are positions, not names, so a change on
// Google's side shows up as a ScrapeChangedError instead of as wrong flights.
import { ScrapeChangedError } from "../errors";

/** One flight of a journey: a take-off and a landing. */
export type FlightLeg = {
  from: string;
  to: string;
  /** Local wall-clock times at each airport, "2026-12-22T20:00" */
  departAt: string;
  arriveAt: string;
  durationMin: number;
  airline: string;
  flightNumber: string;
};

/** One way of getting there: one or more flights, and what Google says it costs. */
export type Flight = {
  airlines: string[];
  legs: FlightLeg[];
  /** For the round trip it belongs to (outbound listings) or for the whole trip with this return (return listings) */
  priceEur: number;
  /** From the first take-off to the last landing, layovers included */
  durationMin: number;
  /** In the order Google gives them: its own "best" ones first */
  top: boolean;
  /** Stops, when the flight was read off the page's text and its flights are not told apart */
  stops?: number;
};

type Node = unknown;
const isArray = (value: Node): value is Node[] => Array.isArray(value);
const num = (value: Node): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: Node): string | null => (typeof value === "string" ? value : null);
const pad = (value: number) => String(value).padStart(2, "0");

/** [2026, 12, 22] → "2026-12-22" */
function dateOf(value: Node): string | null {
  if (!isArray(value) || value.length < 3) return null;
  const [y, m, d] = value.map(num);
  return y && m && d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** [20] is 20:00 and [21, 30] is 21:30: Google leaves out a minute that is zero. */
function clockOf(value: Node): string | null {
  if (!isArray(value) || value.length < 1) return null;
  const hour = num(value[0]);
  const minute = value.length > 1 ? num(value[1]) : 0;
  return hour === null || minute === null ? null : `${pad(hour)}:${pad(minute)}`;
}

function legOf(raw: Node): FlightLeg | null {
  if (!isArray(raw)) return null;
  const departDate = dateOf(raw[20]);
  const arriveDate = dateOf(raw[21]);
  const depart = clockOf(raw[8]);
  const arrive = clockOf(raw[10]);
  const from = str(raw[3]);
  const to = str(raw[6]);
  const durationMin = num(raw[11]);
  if (!departDate || !arriveDate || !depart || !arrive || !from || !to || durationMin === null) return null;

  const carrier = isArray(raw[22]) ? raw[22] : [];
  return {
    from,
    to,
    departAt: `${departDate}T${depart}`,
    arriveAt: `${arriveDate}T${arrive}`,
    durationMin,
    airline: str(carrier[3]) ?? str(carrier[0]) ?? "",
    flightNumber: `${str(carrier[0]) ?? ""}${str(carrier[1]) ?? ""}`,
  };
}

function flightOf(entry: Node, top: boolean): Flight | null {
  if (!isArray(entry) || !isArray(entry[0])) return null;
  const itinerary = entry[0];
  const price = isArray(entry[1]) && isArray(entry[1][0]) ? num(entry[1][0][1]) : null;
  if (price === null || !isArray(itinerary[2])) return null;

  const legs = itinerary[2].map(legOf);
  if (legs.length === 0 || legs.some((leg) => leg === null)) return null;
  const flown = legs as FlightLeg[];
  const durationMin = num(itinerary[9]) ?? flown.reduce((sum, leg) => sum + leg.durationMin, 0);
  const airlines = isArray(itinerary[1]) ? itinerary[1].flatMap((name) => str(name) ?? []) : [];
  return { airlines: airlines.length > 0 ? airlines : [...new Set(flown.map((leg) => leg.airline))], legs: flown, priceEur: Math.round(price), durationMin, top };
}

const sameFlight = (a: Flight, b: Flight) =>
  a.priceEur === b.priceEur && a.legs.length === b.legs.length && a.legs.every((leg, i) => leg.departAt === b.legs[i].departAt && leg.flightNumber === b.legs[i].flightNumber);

/** The framing lines Google puts around its answer are dropped, what is left is JSON lines. */
function innerPayloads(text: string): Node[] {
  const payloads: Node[] = [];
  for (const line of text.replace(/^\)\]\}'\s*/, "").split("\n")) {
    if (!line.startsWith("[")) continue;
    let rows: Node;
    try {
      rows = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isArray(rows)) continue;
    for (const row of rows) {
      if (isArray(row) && row[0] === "wrb.fr" && typeof row[2] === "string") {
        try {
          payloads.push(JSON.parse(row[2]));
        } catch {
          // Not the payload we know: the check below says so
        }
      }
    }
  }
  return payloads;
}

/**
 * The flights in one answer: Google's "best" ones first, then the others it keeps behind "more
 * flights". An answer with none (nothing flies that day) gives an empty list. One that is not shaped
 * like an answer at all is an error: the site changed.
 */
export function parseShoppingResults(text: string): Flight[] {
  const payloads = innerPayloads(text);
  if (payloads.length === 0) throw new ScrapeChangedError("Google Flights answered, but not in a form the scraper knows");

  const flights: Flight[] = [];
  for (const payload of payloads) {
    if (!isArray(payload)) continue;
    // payload[2] holds the best flights and payload[3] the others, each as [[flight, ...], ...]
    for (const [index, top] of [[2, true], [3, false]] as const) {
      const group = payload[index];
      const list = isArray(group) && isArray(group[0]) ? group[0] : [];
      for (const entry of list) {
        const flight = flightOf(entry, top);
        // Google may repeat its answer in a second block: a flight counts once
        if (flight && !flights.some((known) => sameFlight(known, flight))) flights.push(flight);
      }
    }
  }
  return flights;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "1:20 PM" → "13:20" */
function clock24(text: string): string {
  const [, hour, minute, half] = /^(\d{1,2}):(\d{2}) ([AP])M$/i.exec(text) ?? [];
  return `${pad((Number(hour) % 12) + (half.toUpperCase() === "P" ? 12 : 0))}:${minute}`;
}

/**
 * The outbound flights written in the labels of the page's own rows, for when the page shows its flights
 * but its answer could not be captured. A label reads: "From 172 euros round trip total. 1 stop flight
 * with Lufthansa. Leaves Geneva Airport at 1:20 PM on Tuesday, December 8 and arrives at Prague Airport
 * at 4:05 PM on Tuesday, December 8. Total duration 2 hr 45 min." It does not name the airports or the
 * flights of a journey with stops: the pair searched stands for them, and the way back is not known.
 * `from` is the first day of the stay, which gives the year.
 */
export function parseFlightLabels(labels: string[], pair: [string, string], from: string): Flight[] {
  const [startYear, startMonth] = from.split("-").map(Number);
  const dateOf = (month: string, day: string) => {
    const number = MONTHS.indexOf(month.toLowerCase()) + 1;
    return number === 0 ? null : `${number < startMonth ? startYear + 1 : startYear}-${pad(number)}-${pad(Number(day))}`;
  };

  return labels.flatMap((raw, index): Flight[] => {
    // Google writes its times with a narrow no-break space before AM and PM
    const label = raw.replace(/[\u00a0\u202f]/g, " ");
    const price = /From ([\d,]+) euros/.exec(label);
    const carrier = /(Nonstop|(\d+) stops?) flight with ([^.]+)\./.exec(label);
    const times = /Leaves .*? at (\d{1,2}:\d{2} [AP]M) on \w+, (\w+) (\d+) and arrives at .*? at (\d{1,2}:\d{2} [AP]M) on \w+, (\w+) (\d+)\./.exec(label);
    const duration = /Total duration (?:(\d+) hr)?\s*(?:(\d+) min)?/.exec(label);
    if (!price || !carrier || !times || !duration) return [];

    const departDate = dateOf(times[2], times[3]);
    const arriveDate = dateOf(times[5], times[6]);
    const durationMin = Number(duration[1] ?? 0) * 60 + Number(duration[2] ?? 0);
    if (!departDate || !arriveDate || durationMin === 0) return [];
    const airline = carrier[3].trim();
    return [
      {
        airlines: [airline],
        legs: [{ from: pair[0], to: pair[1], departAt: `${departDate}T${clock24(times[1])}`, arriveAt: `${arriveDate}T${clock24(times[4])}`, durationMin, airline, flightNumber: "" }],
        priceEur: Number(price[1].replace(/,/g, "")),
        durationMin,
        top: index < 4,
        stops: carrier[2] ? Number(carrier[2]) : 0,
      },
    ];
  });
}
