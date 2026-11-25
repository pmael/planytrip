// Training the price model from the app (price-model.md P3.3: "Réentraîner"): it runs tools/price-model/train.py, which is Python
// and is not needed by the app to run. `uv` is preferred, as it installs scikit-learn by itself; a python3 that already has it will do.
import { execFile } from "node:child_process";
import { priceModel, trains } from "@/config";

export type Exec = (command: string, args: string[], options: { cwd: string; timeoutMs: number }) => Promise<{ stdout: string; stderr: string }>;

/** The training could not be done, and the message (in French) says what to do about it. */
export class TrainingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrainingError";
  }
}

/** A training is already under way: the answer to a second click is that one. */
export class TrainingBusyError extends Error {
  constructor() {
    super("Un entraînement est déjà en cours");
    this.name = "TrainingBusyError";
  }
}

const SCRIPT = "tools/price-model/train.py";

/** What the app tells train.py of its own rules, so that the baselines it is judged against are the app's. */
export const trainingArgs = () => [
  "--per-km", String(trains.distanceEstimate.eurPerKm),
  "--min-eur", String(trains.distanceEstimate.minEur),
  "--min-rows", String(priceModel.activation.minRowsPerModel),
];

const defaultExec: Exec = (command, args, { cwd, timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(error, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
  });

let running = false;

/** Trains the model on the observations in the database and writes data/price-model.json and its report. Returns what the script said. */
export async function trainPriceModel({ exec = defaultExec, cwd = process.cwd() }: { exec?: Exec; cwd?: string } = {}): Promise<{ log: string }> {
  if (running) throw new TrainingBusyError();
  running = true;
  try {
    const options = { cwd, timeoutMs: priceModel.trainTimeoutMs };
    try {
      // The script's own progress goes to stderr
      return { log: (await exec("uv", ["run", "--quiet", SCRIPT, ...trainingArgs()], options)).stderr.trim() };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw asTrainingError(error);
    }
    // No uv on this machine: the python3 there is, if it has what the script needs
    try {
      return { log: (await exec("python3", [SCRIPT, ...trainingArgs()], options)).stderr.trim() };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new TrainingError("Ni uv ni python3 ne sont installés : installez uv (brew install uv), puis réessayez");
      throw asTrainingError(error);
    }
  } finally {
    running = false;
  }
}

function asTrainingError(error: unknown): TrainingError {
  if (error instanceof TrainingError) return error;
  const stderr = ((error as { stderr?: string }).stderr ?? "").trim();
  if (/No module named '?(numpy|sklearn)/i.test(stderr)) return new TrainingError("Il manque scikit-learn pour entraîner : installez uv (brew install uv), puis réessayez");
  if ((error as { killed?: boolean }).killed) return new TrainingError(`L'entraînement n'a pas fini en ${Math.round(priceModel.trainTimeoutMs / 1000)} s`);
  // The last lines of what the script said, which says what went wrong in plain words; the system's own words when it said nothing
  const last = (stderr || (error as Error).message || "").split("\n").filter(Boolean).slice(-3).join(" · ");
  return new TrainingError(`L'entraînement a échoué : ${last || "erreur inconnue"}`);
}
