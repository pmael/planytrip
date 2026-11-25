// Where SNCF's stations are, by UIC number, from SNCF's open list of passenger stations (data.sncf.com "gares-de-voyageurs").
// SNCF Connect names the stations of its trains and gives their UIC number, not their position: the position is needed for
// the transfer from the arrival station to the stay, and to leave out a train that stops far from it.
//
// The file is kept on disk for a month, like SNCF's fares (sncf-fares.ts). A station it does not have (abroad: Geneva,
// Milan) has no position, and the caller says where it is roughly.
import { trains } from "@/config";
import { createFareFile } from "./sncf-fares";

export type Position = { lat: number; lon: number };
/** Positions by 7-digit UIC number ("8768600", Paris Gare de Lyon): SNCF Connect's codes are the 8-digit ones without their check digit */
export type StationTable = Map<string, Position>;

/** The cells of one line of a ;-separated file, where a cell between quotes may hold a ; ("87686006;87686030") */
function cells(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === ";" && !quoted) {
      out.push(cell);
      cell = "";
    } else cell += char;
  }
  out.push(cell);
  return out;
}

/** "nom;libellecourt;segment_drg;position_geographique;codeinsee;codes_uic;id", the position as "48.844888, 2.37352" */
export function parseStations(text: string): StationTable {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const header = cells(lines[0] ?? "");
  const [position, codes] = [header.indexOf("position_geographique"), header.indexOf("codes_uic")];
  const table: StationTable = new Map();
  if (position < 0 || codes < 0) return table;
  for (const line of lines.slice(1)) {
    const row = cells(line);
    const [lat, lon] = (row[position] ?? "").split(",").map((n) => Number(n.trim()));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    for (const code of (row[codes] ?? "").split(";")) {
      if (/^\d{8}$/.test(code.trim())) table.set(code.trim().slice(0, 7), { lat, lon });
    }
  }
  return table;
}

/** The table, read once per run of the worker; asked again after a failure. */
export function createSncfStations({
  load = createFareFile({ ...trains.sncfStations, what: "SNCF's stations" }),
}: { load?: () => Promise<string> } = {}): () => Promise<StationTable> {
  let table: Promise<StationTable> | null = null;
  return () => (table ??= load().then(parseStations).catch((error) => ((table = null), Promise.reject(error))));
}
