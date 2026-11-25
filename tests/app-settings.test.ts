import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trains } from "@/config";
import { readAppSettings, writeAppSettings } from "@/server/appSettings";
import { chromeDebuggingOn } from "@/server/chromeDebugging";
import { createSncfConnect } from "@/scrapers/transport/sncf-connect";
import type { Timetable } from "@/scrapers/transport/transitous";
import { createTrainsAdapter } from "@/scrapers/transport/trains";
import { journey, memoryCache, trainJson } from "./helpers/trains";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "trip-settings-"));
  file = path.join(dir, "data", "settings.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the app's settings file", () => {
  it("has SNCF Connect off by default, with no file or a broken one", () => {
    expect(trains.sncfConnect.enabled).toBe(false);
    expect(readAppSettings({ file })).toEqual({ sncfConnect: false });
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{ half written");
    expect(readAppSettings({ file })).toEqual({ sncfConnect: false });
    writeFileSync(file, JSON.stringify({ sncfConnect: "yes" }));
    expect(readAppSettings({ file })).toEqual({ sncfConnect: false });
  });

  it("saves the switch, creating the folder, and reads it back", () => {
    expect(writeAppSettings({ sncfConnect: true }, { file })).toEqual({ sncfConnect: true });
    expect(readAppSettings({ file })).toEqual({ sncfConnect: true });
    expect(writeAppSettings({ sncfConnect: false }, { file })).toEqual({ sncfConnect: false });
    expect(readAppSettings({ file })).toEqual({ sncfConnect: false });
  });

  it("keeps what else the file holds, and leaves no temporary file behind", () => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ somethingLater: 3 }));
    writeAppSettings({ sncfConnect: true }, { file });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ somethingLater: 3, sncfConnect: true });
    expect(readFileSync(file, "utf8")).not.toMatch(/tmp/);
  });
});

describe("chromeDebuggingOn", () => {
  const files = ["Library/Application Support/Google/Chrome/DevToolsActivePort", ".config/google-chrome/DevToolsActivePort"];

  it("is whether Chrome wrote its debugging port in one of its profiles", () => {
    expect(chromeDebuggingOn({ home: dir, files })).toBe(false);
    mkdirSync(path.join(dir, ".config/google-chrome"), { recursive: true });
    writeFileSync(path.join(dir, ".config/google-chrome/DevToolsActivePort"), "9222\n/devtools/browser/abc\n");
    expect(chromeDebuggingOn({ home: dir, files })).toBe(true);
  });
});

describe("the SNCF Connect source follows the switch on each search", () => {
  it("asks nothing while it is off, and gives the trains from the search after it is turned on", async () => {
    const day = trainJson("sncf-connect-day-paris-lyon.json");
    const fetchDay = vi.fn(async () => day);
    const PARIS = { name: "Paris Gare de Lyon", lat: 48.8443, lon: 2.3743 };
    const LYON = { name: "Lyon Part-Dieu", lat: 45.7606, lon: 4.8594 };
    const timetable = {
      journeys: vi.fn<Timetable["journeys"]>(async (from) =>
        from.lat > 47 ? [journey({ from: PARIS, to: LYON, departAt: "2026-11-10T07:26", arriveAt: "2026-11-10T09:22" })] : [journey({ from: LYON, to: PARIS, departAt: "2026-11-10T18:04", arriveAt: "2026-11-10T20:00" })],
      ),
    } as Timetable;
    const adapter = createTrainsAdapter({
      timetable,
      fares: [],
      now: () => new Date("2026-10-24T10:00:00Z"),
      sncfConnect: createSncfConnect({ fetchDay, isOn: () => readAppSettings({ file }).sncfConnect }),
    });
    const query = {
      mode: "train" as const,
      origin: { key: "paris-france", label: "Paris, France", lat: 48.8566, lon: 2.3522, airports: [] },
      destination: { id: "d", label: "Lyon", lat: 45.764, lon: 4.8357, airports: [] },
      // The fixture's day both ways: its trains leave on the 10th
      window: { from: "2026-11-10", to: "2026-11-10" },
    };

    const [off] = await adapter.search({ ...query, cache: memoryCache() });
    expect(fetchDay).not.toHaveBeenCalled();
    expect(off.priceKind).toBe("estimated");

    writeAppSettings({ sncfConnect: true }, { file });
    const on = await adapter.search({ ...query, cache: memoryCache() });
    expect(on.find((option) => option.outDepartAt === "2026-11-10T07:26")).toMatchObject({ priceKind: "live", raw: { source: "sncf-connect" } });
    expect(fetchDay).toHaveBeenCalledTimes(2);
  });
});
