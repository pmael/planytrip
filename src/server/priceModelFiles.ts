// The files tools/price-model/train.py writes (config.priceModel): read when they change, not on every search.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { priceModel } from "@/config";
import { PriceModelFileSchema, PriceModelReportSchema, type PriceModelFile, type PriceModelReport } from "@/core/price-model";

export type PriceModelFiles = { file: string; reportFile: string };

const kept = new Map<string, { mtimeMs: number; value: unknown }>();

/** The parsed file, kept until its modification time changes. Null when it is not there or is not what train.py writes. */
function read<T>(file: string, parse: (raw: unknown) => T | null): T | null {
  const full = path.resolve(process.cwd(), file);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(full).mtimeMs;
  } catch {
    return null;
  }
  const hit = kept.get(full);
  if (hit && hit.mtimeMs === mtimeMs) return hit.value as T | null;
  let value: T | null = null;
  try {
    value = parse(JSON.parse(readFileSync(full, "utf8")));
  } catch {
    // A file that is half written, or not JSON: as if there were none
  }
  kept.set(full, { mtimeMs, value });
  return value;
}

export const readPriceModelFile = (files: PriceModelFiles = priceModel): PriceModelFile | null =>
  read(files.file, (raw) => {
    const parsed = PriceModelFileSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  });

export const readPriceModelReport = (files: PriceModelFiles = priceModel): PriceModelReport | null =>
  read(files.reportFile, (raw) => {
    const parsed = PriceModelReportSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  });
