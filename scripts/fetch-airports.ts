// Downloads the OurAirports dump and keeps the large and medium airports that have an IATA code
// and scheduled passenger flights (this drops military and business-only fields, e.g. Torrejón
// next to Madrid), as data/airports.csv. Run with `npm run airports`.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv, toCsv } from "../src/geo/csv";

const SOURCE = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const OUTPUT = path.join(process.cwd(), "data", "airports.csv");
const KEPT_TYPES = new Set(["large_airport", "medium_airport"]);

async function main() {
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);

  const [header, ...records] = parseCsv(await response.text());
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index === -1) throw new Error(`Column "${name}" is missing from ${SOURCE}`);
    return index;
  };
  const [iata, type, name, lat, lon, country, scheduled] = [
    "iata_code",
    "type",
    "name",
    "latitude_deg",
    "longitude_deg",
    "iso_country",
    "scheduled_service",
  ].map(column);

  const airports = records
    .filter((r) => KEPT_TYPES.has(r[type]) && r[iata] && r[scheduled] === "yes")
    .map((r) => [r[iata], r[name], r[type], r[lat], r[lon], r[country]]);

  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, toCsv([["iata", "name", "type", "lat", "lon", "country"], ...airports]));
  console.log(`${airports.length} airports written to ${path.relative(process.cwd(), OUTPUT)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
