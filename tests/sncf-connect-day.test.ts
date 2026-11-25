import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { trains } from "@/config";
import { ScrapeBlockedError, ScrapeChangedError, ScrapeError, ScrapeUnavailableError } from "@/scrapers/errors";
import { defaultExec, fetchSncfConnectDay, scriptArgs, type Exec } from "@/scrapers/transport/sncf-connect-day";

const QUERY = { origin: "Paris", destination: "Lyon", date: "2026-11-10" };

const train = {
  id: "2026-11-10T06:16_9761",
  departAt: "2026-11-10T06:16",
  arriveAt: "2026-11-10T09:04",
  durationMin: 168,
  from: "Paris - Gare De Lyon - Hall 1 & 2",
  to: "Lyon Part Dieu",
  changes: 1,
  legs: [
    { from: "Paris - Gare De Lyon - Hall 1 & 2", fromCode: "8768600", departs: "06:16", to: "Bourg-En-Bresse", toCode: "8774300", arrives: "08:09", operator: "LYRIA", number: "9761" },
    { from: "Bourg-En-Bresse", fromCode: "8774300", departs: "08:14", to: "Lyon Part Dieu", toCode: "8772319", arrives: "09:04", operator: "Train TER", number: "889317" },
  ],
  bookable: true,
  availability: "bookable",
  priceEur: { best: 70.6, second: 70.6, first: 78.6 },
};

const day = {
  schema: 1,
  source: "sncf-connect",
  date: "2026-11-10",
  origin: { query: "Paris", label: "Paris", id: "CITY_FR_6455259" },
  destination: { query: "Lyon", label: "Lyon", id: "CITY_FR_6454573" },
  fetchedAt: "2026-11-10T14:02:11Z",
  trains: [train],
};

const answers = (stdout: string, stderr = "[page 1] querying from 00:00 Paris … got 8 proposals"): Exec => vi.fn(async () => ({ stdout, stderr }));
const fails = (fields: { code?: string | number; stdout?: string; stderr?: string; killed?: boolean }): Exec =>
  vi.fn(async () => Promise.reject(Object.assign(new Error("Command failed"), fields)));
const failsWith = (kind: string, message: string, code = 1) => fails({ code, stdout: JSON.stringify({ schema: 1, error: { kind, message } }) });

describe("fetchSncfConnectDay: fetch_day.py run as a separate process", () => {
  it("runs the script with uv, which installs playwright by itself, and gives back the day it printed", async () => {
    const exec = answers(JSON.stringify(day));
    expect(await fetchSncfConnectDay(QUERY, { exec, cwd: "/app" })).toEqual(day);
    expect(vi.mocked(exec).mock.calls).toEqual([
      ["uv", ["run", "--quiet", "tools/sncf-api/fetch_day.py", "Paris", "Lyon", "2026-11-10"], { cwd: "/app", timeoutMs: trains.sncfConnect.timeoutMs }],
    ]);
  });

  it("passes the options as the script's flags", () => {
    expect(scriptArgs({ ...QUERY, direct: true, fromFile: "raw.json" })).toEqual(["Paris", "Lyon", "2026-11-10", "--direct", "--from-file", "raw.json"]);
  });

  it("falls back on python3 when uv is not installed", async () => {
    const exec = vi.fn<Exec>().mockRejectedValueOnce(Object.assign(new Error("spawn uv ENOENT"), { code: "ENOENT" })).mockResolvedValueOnce({ stdout: JSON.stringify(day), stderr: "" });
    expect((await fetchSncfConnectDay(QUERY, { exec })).trains).toHaveLength(1);
    expect(exec.mock.calls.map(([command, args]) => [command, args[0]])).toEqual([
      ["uv", "run"],
      ["python3", "tools/sncf-api/fetch_day.py"],
    ]);
  });

  it("says what to install when there is neither, or when python3 has no playwright", async () => {
    await expect(fetchSncfConnectDay(QUERY, { exec: fails({ code: "ENOENT" }) })).rejects.toThrow(new ScrapeUnavailableError("Neither uv nor python3 is installed: install uv (brew install uv) to read SNCF Connect"));
    const exec = vi
      .fn<Exec>()
      .mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ENOENT" }))
      .mockRejectedValueOnce(Object.assign(new Error("x"), { code: 1, stdout: "", stderr: "ModuleNotFoundError: No module named 'playwright'" }));
    const error = await fetchSncfConnectDay(QUERY, { exec }).catch((e) => e);
    expect(error).toBeInstanceOf(ScrapeUnavailableError);
    expect(error.message).toMatch(/python3 has no playwright/);
  });

  it.each([
    ["browser", 3, ScrapeUnavailableError, /read through Chrome, which is not reachable: Chrome is not running/],
    ["blocked", 4, ScrapeBlockedError, /turned the request away: HTTP 403/],
    ["changed", 5, ScrapeChangedError, /a form fetch_day.py does not know/],
    ["no-place", 6, ScrapeUnavailableError, /knows no place called "Paris" or "Lyon"/],
  ] as const)("turns the script's %s error into the scraper error that says whether to try again", async (kind, code, Type, message) => {
    const text = { browser: "Chrome is not running with remote debugging on", blocked: "HTTP 403 from /bff/api/v1/itineraries", changed: "unknown duration 'x'", "no-place": "No station found for: 'Paris'" }[kind];
    const error = await fetchSncfConnectDay(QUERY, { exec: failsWith(kind, text, code) }).catch((e) => e);
    expect(error).toBeInstanceOf(Type);
    expect(error.message).toMatch(message);
    expect(error.retryable).toBe(false);
  });

  it("lets an unknown SNCF failure be tried again, and not a wrong call", async () => {
    const other = await fetchSncfConnectDay(QUERY, { exec: failsWith("error", "HTTP 502 from /bff/api/v1/itineraries", 5) }).catch((e) => e);
    expect(other).toBeInstanceOf(ScrapeError);
    expect(other.retryable).toBe(true);
    const usage = await fetchSncfConnectDay(QUERY, { exec: failsWith("usage", "cannot read raw.json", 2) }).catch((e) => e);
    expect(usage.retryable).toBe(false);
    expect(usage.message).toBe("fetch_day.py was called wrongly: cannot read raw.json");
  });

  it("reads the error from what the script printed, not from the exit code, which uv may use for itself", async () => {
    const error = await fetchSncfConnectDay(QUERY, { exec: failsWith("blocked", "HTTP 429", 2) }).catch((e) => e);
    expect(error).toBeInstanceOf(ScrapeBlockedError);
  });

  it("says when it took too long, and lets it be tried again", async () => {
    const error = await fetchSncfConnectDay(QUERY, { exec: fails({ killed: true, stdout: "", stderr: "" }) }).catch((e) => e);
    expect(error.message).toBe("SNCF Connect did not answer within 120 s");
    expect(error.retryable).toBe(true);
  });

  it("says what the script said when it crashed without JSON, in its last lines", async () => {
    const error = await fetchSncfConnectDay(QUERY, { exec: fails({ code: 1, stdout: "", stderr: "Traceback\n  File x\nRuntimeError: boom" }) }).catch((e) => e);
    expect(error.message).toBe("fetch_day.py failed: Traceback ·   File x · RuntimeError: boom");
  });

  it("refuses an answer that is not a day of trains", async () => {
    await expect(fetchSncfConnectDay(QUERY, { exec: answers("[page 1] querying …\n{}") })).rejects.toBeInstanceOf(ScrapeChangedError);
    const wrong = { ...day, trains: [{ ...train, departAt: "06:16" }] };
    await expect(fetchSncfConnectDay(QUERY, { exec: answers(JSON.stringify(wrong)) })).rejects.toBeInstanceOf(ScrapeChangedError);
    await expect(fetchSncfConnectDay(QUERY, { exec: answers(JSON.stringify({ ...day, schema: 2 })) })).rejects.toBeInstanceOf(ScrapeChangedError);
  });

  it("runs one at a time: two would drive the same Chrome tab", async () => {
    let running = 0;
    let most = 0;
    const exec: Exec = async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
      return { stdout: JSON.stringify(day), stderr: "" };
    };
    await Promise.all([fetchSncfConnectDay(QUERY, { exec }), fetchSncfConnectDay(QUERY, { exec }), fetchSncfConnectDay(QUERY, { exec })]);
    expect(most).toBe(1);
  });

  it("goes on with the next run when one failed", async () => {
    const first = fetchSncfConnectDay(QUERY, { exec: failsWith("blocked", "HTTP 403") });
    const second = fetchSncfConnectDay(QUERY, { exec: answers(JSON.stringify(day)) });
    await expect(first).rejects.toBeInstanceOf(ScrapeBlockedError);
    await expect(second).resolves.toEqual(day);
  });
});

// The real script, in a real process, on the saved answer: no Chrome. python3 only, so that uv does not install playwright for a test.
const SAMPLE = path.resolve("tools/sncf-api/trains.json");
const hasPython = (() => {
  try {
    execFileSync("python3", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();
const python3Only: Exec = (command, args, options) =>
  command === "uv" ? Promise.reject(Object.assign(new Error("spawn uv ENOENT"), { code: "ENOENT" })) : defaultExec(command, args, options);

describe.skipIf(!hasPython || !existsSync(SAMPLE))("fetch_day.py for real, on tools/sncf-api/trains.json", () => {
  it("prints the 31 trains of the saved day, which the app reads and checks", async () => {
    const result = await fetchSncfConnectDay({ ...QUERY, fromFile: SAMPLE }, { exec: python3Only });
    expect(result.trains).toHaveLength(31);
    expect(result.trains[0]).toEqual(train);
    expect(result.trains.filter((t) => !t.bookable)).toHaveLength(6);
    expect(result.origin).toEqual({ query: "Paris", label: null, id: null });
  });

  it("turns a file it cannot read into an error that says so", async () => {
    const error = await fetchSncfConnectDay({ ...QUERY, fromFile: "/nonexistent/raw.json" }, { exec: python3Only }).catch((e) => e);
    expect(error.message).toMatch(/^fetch_day.py was called wrongly: cannot read \/nonexistent\/raw.json/);
  });
});
