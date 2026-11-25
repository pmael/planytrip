import { readFileSync } from "node:fs";
import path from "node:path";
import { AIRPORT_RADIUS_KM } from "@/config";
import { parseCsv } from "./csv";

type Airport = { iata: string; lat: number; lon: number };

const AIRPORTS_FILE = path.join(process.cwd(), "data", "airports.csv");
const EARTH_RADIUS_KM = 6371;

let airports: Airport[] | undefined;

function loadAirports(): Airport[] {
  if (airports) return airports;
  let text: string;
  try {
    text = readFileSync(AIRPORTS_FILE, "utf8");
  } catch {
    throw new Error("data/airports.csv is missing, run `npm run airports` first");
  }
  const [header, ...rows] = parseCsv(text);
  const [iata, lat, lon] = ["iata", "lat", "lon"].map((name) => header.indexOf(name));
  airports = rows
    .filter((row) => row.length > lon)
    .map((row) => ({ iata: row[iata], lat: Number(row[lat]), lon: Number(row[lon]) }));
  return airports;
}

/** Great-circle distance in km (haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Where an airport is, or null when the list does not have it. */
export function airportLocation(iata: string): { lat: number; lon: number } | null {
  const airport = loadAirports().find((candidate) => candidate.iata === iata);
  return airport ? { lat: airport.lat, lon: airport.lon } : null;
}

/** IATA codes of the airports within `radiusKm` of a point, nearest first. */
export function nearbyAirports(lat: number, lon: number, radiusKm = AIRPORT_RADIUS_KM): string[] {
  return loadAirports()
    .map((airport) => ({ iata: airport.iata, km: distanceKm(lat, lon, airport.lat, airport.lon) }))
    .filter(({ km }) => km <= radiusKm)
    .sort((a, b) => a.km - b.km)
    .map(({ iata }) => iata);
}
