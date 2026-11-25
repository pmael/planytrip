// The choices made in Settings that belong to the app, not to a trip (config.appSettings): kept in a small JSON file in data/,
// which the pages write and the worker reads on each search, so that a change counts from the next search without a restart.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appSettings as config, trains } from "@/config";
import { z } from "zod";

export type AppSettings = {
  /** Read SNCF Connect's own prices through the person's running Chrome (train-sources.md) */
  sncfConnect: boolean;
};

const FileSchema = z.looseObject({ sncfConnect: z.boolean().optional() });

const defaults = (): AppSettings => ({ sncfConnect: trains.sncfConnect.enabled });

const fullPath = (file: string) => path.resolve(process.cwd(), file);

/** What the file says, with config's defaults for what it does not say. A missing or broken file is all defaults. */
function readFile(file: string): z.infer<typeof FileSchema> {
  try {
    const parsed = FileSchema.safeParse(JSON.parse(readFileSync(fullPath(file), "utf8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function readAppSettings({ file = config.file }: { file?: string } = {}): AppSettings {
  const saved = readFile(file);
  return { ...defaults(), ...(saved.sncfConnect === undefined ? {} : { sncfConnect: saved.sncfConnect }) };
}

/** Saves a change and gives back the settings as they now are. What else the file holds is kept. */
export function writeAppSettings(change: Partial<AppSettings>, { file = config.file }: { file?: string } = {}): AppSettings {
  const full = fullPath(file);
  const next = { ...readFile(file), ...change };
  mkdirSync(path.dirname(full), { recursive: true });
  // Written beside it, then put in its place: the worker never reads a half-written file
  const temporary = `${full}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temporary, full);
  return readAppSettings({ file });
}
