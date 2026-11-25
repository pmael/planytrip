import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

/** `TRIP_DB_PATH` points the app at another database file, for trying things out on a copy. */
export const DB_PATH = process.env.TRIP_DB_PATH ? path.resolve(process.env.TRIP_DB_PATH) : path.join(process.cwd(), "data", "trip.db");

mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
