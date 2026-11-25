import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "./schema";

/** The Drizzle handle the services work with, so tests can hand them an in-memory database. */
export type Db = BetterSQLite3Database<typeof schema>;
