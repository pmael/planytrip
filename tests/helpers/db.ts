import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";

/** A fresh in-memory database with every migration applied. */
export function createTestDb(): { db: Db; close: () => void } {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return { db, close: () => sqlite.close() };
}
