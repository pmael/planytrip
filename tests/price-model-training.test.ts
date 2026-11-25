import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { priceModel, trains } from "@/config";
import { trainingArgs, trainPriceModel, TrainingBusyError, TrainingError, type Exec } from "@/server/priceModelTraining";

const ok = (stderr = "167 observations from 29 sessions\nrange: trained"): Exec => vi.fn(async () => ({ stdout: "", stderr }));
const failing = (code: string | number | undefined, stderr = "", extra: object = {}): Exec =>
  vi.fn(async () => Promise.reject(Object.assign(new Error("Command failed"), { code, stderr, ...extra })));

describe("trainPriceModel (T7.9: the 'Réentraîner' button)", () => {
  it("runs the script with uv, which installs what the script needs, and gives back what it said", async () => {
    const exec = ok();
    expect(await trainPriceModel({ exec, cwd: "/app" })).toEqual({ log: "167 observations from 29 sessions\nrange: trained" });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(vi.mocked(exec).mock.calls[0]).toEqual(["uv", ["run", "--quiet", "tools/price-model/train.py", ...trainingArgs()], { cwd: "/app", timeoutMs: priceModel.trainTimeoutMs }]);
  });

  it("gives the script the app's own rules, so that the simple method it is judged against is the app's", () => {
    expect(trainingArgs()).toEqual(["--per-km", String(trains.distanceEstimate.eurPerKm), "--min-eur", String(trains.distanceEstimate.minEur), "--min-rows", String(priceModel.activation.minRowsPerModel)]);
  });

  it("falls back on python3 when uv is not installed", async () => {
    const exec = vi.fn<Exec>().mockRejectedValueOnce(Object.assign(new Error("spawn uv ENOENT"), { code: "ENOENT" })).mockResolvedValueOnce({ stdout: "", stderr: "done" });
    expect(await trainPriceModel({ exec })).toEqual({ log: "done" });
    expect(exec.mock.calls.map(([command]) => command)).toEqual(["uv", "python3"]);
    expect(exec.mock.calls[1][1][0]).toBe("tools/price-model/train.py");
  });

  it("says what to install when there is neither, or when python3 has no scikit-learn", async () => {
    await expect(trainPriceModel({ exec: failing("ENOENT") })).rejects.toThrow("Ni uv ni python3 ne sont installés : installez uv (brew install uv), puis réessayez");
    const exec = vi.fn<Exec>().mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ENOENT" })).mockRejectedValueOnce(Object.assign(new Error("x"), { code: 1, stderr: "ModuleNotFoundError: No module named 'sklearn'" }));
    await expect(trainPriceModel({ exec })).rejects.toThrow("Il manque scikit-learn pour entraîner : installez uv (brew install uv), puis réessayez");
  });

  it("says what the script said when it fails, in its last lines", async () => {
    const error = await trainPriceModel({ exec: failing(1, "loading\nsqlite3.OperationalError: no such table: price_observations") }).catch((e) => e);
    expect(error).toBeInstanceOf(TrainingError);
    expect(error.message).toBe("L'entraînement a échoué : loading · sqlite3.OperationalError: no such table: price_observations");
  });

  it("says when it took too long", async () => {
    await expect(trainPriceModel({ exec: failing(undefined, "", { killed: true }) })).rejects.toThrow(/n'a pas fini en 120 s/);
  });

  it("runs one training at a time, and lets the next one start when the first is over", async () => {
    let release!: () => void;
    const slow: Exec = () => new Promise((resolve) => (release = () => resolve({ stdout: "", stderr: "ok" })));
    const first = trainPriceModel({ exec: slow });
    await expect(trainPriceModel({ exec: ok() })).rejects.toBeInstanceOf(TrainingBusyError);
    release();
    await first;
    await expect(trainPriceModel({ exec: ok() })).resolves.toBeDefined();
  });

  it("lets the next one start even when the first failed", async () => {
    await expect(trainPriceModel({ exec: failing(1, "boom") })).rejects.toBeInstanceOf(TrainingError);
    await expect(trainPriceModel({ exec: ok() })).resolves.toBeDefined();
  });
});

describe("what the script learns from (phase 4 of price-model.md)", () => {
  const script = readFileSync(path.join(process.cwd(), "tools/price-model/train.py"), "utf8");

  it("reads the prices seen on SNCF Connect only: the model prices SNCF's own trains, and Eurostar's and Iryo's prices must not count towards its thresholds", () => {
    expect(script).toMatch(/from price_observations where price_2nd_eur is not null and source = 'sncf-connect'/);
  });
});
