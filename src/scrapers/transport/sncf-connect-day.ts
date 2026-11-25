// One day of SNCF Connect trains between two places, from tools/sncf-api/fetch_day.py run as a separate process.
// It runs the script and hands back what it printed, checked; sncf-connect.ts makes the trains of a search of it.
//
// How it works, and why:
// - The script drives the person's own running Chrome, so it is Python and runs beside the worker, on the Mac.
//   `uv` is tried first, as it installs playwright by itself (the script declares it); a python3 that has it will do.
// - stdout is one JSON document: the day's trains, or {error: {kind, message}}. The kind says what went wrong and
//   becomes the scraper error that says whether trying again can help. The exit code is not read: uv has its own.
// - One run at a time: two would drive the same Chrome tab at once.
import { execFile } from "node:child_process";
import { trains } from "@/config";
import { z } from "zod";
import { ScrapeBlockedError, ScrapeChangedError, ScrapeError, ScrapeUnavailableError } from "../errors";

export type Exec = (command: string, args: string[], options: { cwd: string; timeoutMs: number }) => Promise<{ stdout: string; stderr: string }>;

/** SNCF Connect knows no place by one of the names asked: the other pairs of stations of a search can still be asked. */
export class UnknownPlaceError extends ScrapeUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownPlaceError";
  }
}

export type SncfConnectSettings = { script: string; timeoutMs: number };

const Leg = z.object({
  from: z.string(),
  /** The station's 7-digit UIC number, for its position (sncf-stations.ts); missing in days read before 2026-11-12 */
  fromCode: z.string().nullable().optional(),
  departs: z.string(),
  to: z.string(),
  toCode: z.string().nullable().optional(),
  arrives: z.string(),
  operator: z.string().nullable(),
  number: z.string(),
});

const Minute = z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
const Euros = z.number().nonnegative().nullable();

const Train = z.object({
  id: z.string(),
  /** Paris local wall-clock time, "2026-11-10T06:16" */
  departAt: Minute,
  arriveAt: Minute,
  durationMin: z.number().int().nonnegative(),
  from: z.string(),
  to: z.string(),
  changes: z.number().int().nonnegative(),
  legs: z.array(Leg),
  bookable: z.boolean(),
  /** Why it can or cannot be booked: SNCF says "not bookable" both for a full train ("Complet") and for one whose sales are not open yet */
  availability: z.enum(["bookable", "sold-out", "not-on-sale", "unavailable"]),
  /** `best` can be a first-class price when second class is sold out: read `second` for a second-class trip */
  priceEur: z.object({ best: Euros, second: Euros, first: Euros }),
});

const Place = z.object({ query: z.string(), label: z.string().nullable(), id: z.string().nullable() });

const Day = z.object({
  schema: z.literal(1),
  source: z.literal("sncf-connect"),
  date: z.string(),
  origin: Place,
  destination: Place,
  fetchedAt: z.string(),
  trains: z.array(Train),
});

const Failure = z.object({ schema: z.literal(1), error: z.object({ kind: z.string(), message: z.string() }) });

export type SncfConnectTrain = z.infer<typeof Train>;
export type SncfConnectDay = z.infer<typeof Day>;

export type DayQuery = {
  /** A city or a station, as SNCF Connect names it: "Paris", "Lyon" */
  origin: string;
  destination: string;
  /** Paris local date, "2026-11-10" */
  date: string;
  /** Non-stop trains only */
  direct?: boolean;
  /** Convert a saved answer instead of asking SNCF (tests, checks) */
  fromFile?: string;
};

export const defaultExec: Exec = (command, args, { cwd, timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(error, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
  });

export const scriptArgs = ({ origin, destination, date, direct, fromFile }: DayQuery): string[] => [
  origin,
  destination,
  date,
  ...(direct ? ["--direct"] : []),
  ...(fromFile ? ["--from-file", fromFile] : []),
];

type ExecFailure = Error & { code?: string | number; stdout?: string; stderr?: string; killed?: boolean };

/** One run at a time: the next waits for the one before, whatever became of it. */
let queue: Promise<unknown> = Promise.resolve();

export function fetchSncfConnectDay(
  query: DayQuery,
  { exec = defaultExec, cwd = process.cwd(), config = trains.sncfConnect }: { exec?: Exec; cwd?: string; config?: SncfConnectSettings } = {},
): Promise<SncfConnectDay> {
  const run = queue.then(() => runOnce(query, exec, cwd, config));
  queue = run.catch(() => undefined);
  return run;
}

async function runOnce(query: DayQuery, exec: Exec, cwd: string, config: SncfConnectSettings): Promise<SncfConnectDay> {
  const args = [config.script, ...scriptArgs(query)];
  const options = { cwd, timeoutMs: config.timeoutMs };
  let stdout: string;
  try {
    ({ stdout } = await runPython(exec, args, options));
  } catch (error) {
    throw asScrapeError(error as ExecFailure, query, config);
  }
  const parsed = Day.safeParse(parseJson(stdout));
  if (!parsed.success) throw new ScrapeChangedError(`fetch_day.py printed something that is not a day of trains: ${z.prettifyError(parsed.error).split("\n")[0]}`);
  return parsed.data;
}

/** uv first, which installs what the script declares; python3 when there is no uv. */
async function runPython(exec: Exec, args: string[], options: { cwd: string; timeoutMs: number }) {
  try {
    return await exec("uv", ["run", "--quiet", ...args], options);
  } catch (error) {
    if ((error as ExecFailure).code !== "ENOENT") throw error;
  }
  return exec("python3", args, options);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asScrapeError(error: ExecFailure, query: DayQuery, config: SncfConnectSettings): ScrapeError {
  if (error.code === "ENOENT") return new ScrapeUnavailableError("Neither uv nor python3 is installed: install uv (brew install uv) to read SNCF Connect");
  if (error.killed) return new ScrapeError(`SNCF Connect did not answer within ${Math.round(config.timeoutMs / 1000)} s`);

  const failure = Failure.safeParse(parseJson(error.stdout ?? ""));
  if (failure.success) {
    const { kind, message } = failure.data.error;
    switch (kind) {
      case "browser":
        return new ScrapeUnavailableError(`SNCF Connect is read through Chrome, which is not reachable: ${message}`);
      case "blocked":
        return new ScrapeBlockedError(`SNCF Connect turned the request away: ${message}`);
      case "no-place":
        return new UnknownPlaceError(`SNCF Connect knows no place called "${query.origin}" or "${query.destination}": ${message}`);
      case "changed":
        return new ScrapeChangedError(`SNCF Connect answered in a form fetch_day.py does not know: ${message}`);
      case "usage":
        return new ScrapeError(`fetch_day.py was called wrongly: ${message}`, false);
      default:
        return new ScrapeError(`SNCF Connect failed: ${message}`);
    }
  }

  // No JSON: the script did not get far enough (python3 without playwright, uv unable to install it, a crash)
  const stderr = (error.stderr ?? "").trim();
  if (/No module named '?(playwright|pytz)/i.test(stderr)) {
    return new ScrapeUnavailableError("python3 has no playwright: install uv (brew install uv), which installs it by itself");
  }
  const last = (stderr || error.message || "").split("\n").filter(Boolean).slice(-3).join(" · ");
  return new ScrapeError(`fetch_day.py failed: ${last || "unknown error"}`, false);
}
