import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ScrapeBlockedError, ScrapeChangedError } from "@/scrapers/errors";
import type { Http } from "@/scrapers/http";
import { carrierOf, createFareFile, createSncfFares, parseFares, stationKey } from "@/scrapers/transport/sncf-fares";
import { parsePlan } from "@/scrapers/transport/transitous-parse";
import { createTrenitalia } from "@/scrapers/transport/trenitalia";
import { journey, memoryCache, trainFixture, trainJson } from "./helpers/trains";

describe("stationKey", () => {
  it("makes the timetable's names and the fare file's names the same", () => {
    expect(stationKey("Toulouse Matabiau")).toBe("TOULOUSE MATABIAU");
    expect(stationKey("Lyon-Part-Dieu")).toBe("LYON PART DIEU");
    expect(stationKey("Paris Gare de Lyon Hall 1 - 2")).toBe("PARIS GARE DE LYON");
    expect(stationKey("Paris Montparnasse 1 - 2")).toBe("PARIS MONTPARNASSE");
    expect(stationKey("Nîmes Centre")).toBe("NIMES CENTRE");
  });
});

describe("carrierOf", () => {
  it("knows the trains the fare file covers, and only SNCF's", () => {
    expect(carrierOf({ train: "TGV INOUI 6871", operator: "SNCF VOYAGEURS" })).toBe("TGV INOUI");
    expect(carrierOf({ train: "OUIGO 7803", operator: "SNCF VOYAGEURS" })).toBe("OUIGO");
    expect(carrierOf({ train: "OUIGO_TC 4091", operator: "SNCF VOYAGEURS" })).toBe("OUIGO TRAIN CLASSIQUE");
    expect(carrierOf({ train: "TER 876256", operator: "SNCF VOYAGEURS" })).toBeNull();
    expect(carrierOf({ train: "IC 4758", operator: "SNCF VOYAGEURS" })).toBeNull();
    // Ouigo España is not French: the file says nothing of it
    expect(carrierOf({ train: "TGV 6501", operator: "OUIGO Espana" })).toBeNull();
  });
});

describe("parseFares (T7.8: SNCF's open fare file, as downloaded on 2026-10-24)", () => {
  const fares = parseFares(trainFixture("sncf-fares.csv"));

  it("keeps the second-class full fare of each pair, as a range", () => {
    expect(fares.get("TGV INOUI|LYON PERRACHE|TOULOUSE MATABIAU")).toEqual({ min: 25.5, max: 101 });
    expect(fares.get("TGV INOUI|LYON PART DIEU|TOULOUSE MATABIAU")).toEqual({ min: 25.5, max: 101 });
  });

  it("leaves out first class and the reduced fares", () => {
    // First class and the student fare exist for this pair in the file, and are not what is asked
    const csv = trainFixture("sncf-fares.csv");
    expect(csv).toMatch(/Tarif Elève/);
    expect(csv).toMatch(/;1;Tarif Normal/);
    expect([...fares.values()].every((range) => range.min <= range.max)).toBe(true);
  });

  it("refuses a file that is not the one it knows", () => {
    expect(() => parseFares("a;b;c\n1;2;3")).toThrow(/not in the form/);
  });
});

describe("createSncfFares", () => {
  const source = createSncfFares({ load: async () => trainFixture("sncf-fares.csv"), config: { positionInRange: 0.5 } });
  const quote = (journeys = [journey()]) => source.quote(journeys, { cache: memoryCache() });

  it("prices a TGV INOUI at the middle of SNCF's range for the route, and says it is an estimate", async () => {
    const [direct] = await quote();
    expect(direct).toMatchObject({
      priceEur: 63, // 25.5 to 101
      kind: "estimated",
      source: "sncf-fares",
      note: "SNCF's published fares for this route: 26 to 101 € one way",
    });
    expect(direct!.link).toMatch(/sncf-connect/);
  });

  it("can count a point nearer the top of the range, as config says", async () => {
    const high = createSncfFares({ load: async () => trainFixture("sncf-fares.csv"), config: { positionInRange: 1 } });
    expect((await high.quote([journey()], { cache: memoryCache() }))[0]!.priceEur).toBe(101);
  });

  it("finds the pair whichever way the file wrote it (it has only Lyon to Toulouse)", async () => {
    const [back] = await quote([journey({ from: { name: "Lyon Part Dieu", lat: 45.76, lon: 4.86 }, to: { name: "Toulouse Matabiau", lat: 43.61, lon: 1.45 } })]);
    expect(back!.priceEur).toBe(63);
  });

  it("says nothing of a train it does not know: a TER, another operator, a pair that is not in the file", async () => {
    const answers = await quote([
      journey({ train: "TER 876256", mode: "REGIONAL_RAIL" }),
      journey({ operator: "RENFE OPERADORA", train: "AVE 03081" }),
      journey({ to: { name: "Perpignan", lat: 42.7, lon: 2.88 } }),
    ]);
    expect(answers).toEqual([null, null, null]);
  });

  it("adds up the ranges of a journey of two trains when it knows both, and says nothing when it knows only one", async () => {
    const two = journey();
    two.legs.push({ ...two.legs[0], from: { name: "Lyon Part Dieu", lat: 45.76, lon: 4.86 }, to: { name: "Toulouse Matabiau", lat: 43.61, lon: 1.45 } });
    // Two ranges of 25.5 to 101: 51 to 202 together, 126.5 in the middle
    expect((await quote([two]))[0]).toMatchObject({ priceEur: 127, note: "SNCF's published fares for this route: 51 to 202 € one way" });
    const mixed = journey();
    mixed.legs.push({ ...mixed.legs[0], train: "TER 1", mode: "REGIONAL_RAIL" });
    expect(await quote([mixed])).toEqual([null]);
  });

  it("reads the file once, however many journeys it is asked about", async () => {
    const load = vi.fn(async () => trainFixture("sncf-fares.csv"));
    const once = createSncfFares({ load });
    await once.quote([journey()], { cache: memoryCache() });
    await once.quote([journey()], { cache: memoryCache() });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("tries to load the file again after it failed", async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(trainFixture("sncf-fares.csv"));
    const flaky = createSncfFares({ load });
    await expect(flaky.quote([journey()], { cache: memoryCache() })).rejects.toThrow("offline");
    expect((await flaky.quote([journey()], { cache: memoryCache() }))[0]).not.toBeNull();
  });
});

describe("createFareFile", () => {
  const withFolder = async (run: (file: string) => Promise<void>) => {
    const folder = mkdtempSync(join(tmpdir(), "fares-"));
    try {
      await run(join(folder, "nested", "fares.csv"));
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  };
  const answer = (text: string, status = 200) => vi.fn<typeof fetch>(async () => new Response(text, { status }));

  it("downloads the file once and keeps it on disk", async () => {
    await withFolder(async (file) => {
      const fetchImpl = answer("csv one");
      const load = createFareFile({ file, url: "https://example.test/f.csv", fetchImpl });
      expect(await load()).toBe("csv one");
      expect(await load()).toBe("csv one");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  it("downloads it again when the copy is older than a month", async () => {
    await withFolder(async (file) => {
      const fetchImpl = answer("new copy");
      await createFareFile({ file, fetchImpl, now: () => 0 })();
      const old = new Date(Date.now() - 40 * 24 * 3600 * 1000);
      utimesSync(file, old, old);
      expect(await createFareFile({ file, fetchImpl })()).toBe("new copy");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps using an old copy when the site cannot be reached: fares move slowly", async () => {
    await withFolder(async (file) => {
      await createFareFile({ file, fetchImpl: answer("old copy") })();
      const old = new Date(Date.now() - 40 * 24 * 3600 * 1000);
      utimesSync(file, old, old);
      expect(await createFareFile({ file, fetchImpl: answer("", 503) })()).toBe("old copy");
    });
  });

  it("says so when there is no copy and no way to get one", async () => {
    await withFolder(async (file) => {
      await expect(createFareFile({ file, fetchImpl: answer("", 503) })()).rejects.toThrow(/Could not get SNCF's fares/);
    });
  });
});

describe("createTrenitalia (T7.8: the real fares, captured on 2026-10-24)", () => {
  /** A fake Trenitalia: stations by name, then the day's solutions (10 at a time) */
  function fakeTrenitalia(pages: unknown[] = [trainJson("trenitalia-solutions.json")]) {
    const gets: string[] = [];
    const posts: { offset: number; body: Record<string, unknown> }[] = [];
    const http: Http = {
      getJson: vi.fn(async (url: string) => {
        gets.push(decodeURIComponent(url));
        return gets[gets.length - 1].toLowerCase().includes("milano") ? trainJson("trenitalia-locations-milano.json") : trainJson("trenitalia-locations-roma.json");
      }),
      postJson: vi.fn(async (_url: string, body: unknown) => {
        const b = body as { criteria: { offset: number } } & Record<string, unknown>;
        posts.push({ offset: b.criteria.offset, body: b });
        return pages[Math.min(b.criteria.offset / 10, pages.length - 1)];
      }),
    };
    return { http, gets, posts };
  }
  const milanoRoma = () => parsePlan(trainJson("transitous-milano-roma.json"));

  it("gives the fare of the solution that leaves and arrives at the same times, as a real price", async () => {
    const { http } = fakeTrenitalia();
    const [first, second] = await createTrenitalia({ http }).quote(milanoRoma(), { cache: memoryCache() });
    // 06:35 → 09:34 is on sale at 62.9 €; the 07:00 is not in what was captured
    expect(first).toMatchObject({ priceEur: 63, kind: "live", note: null, source: "trenitalia" });
    expect(first!.link).toMatch(/lefrecce\.it/);
    expect(second).toBeNull();
  });

  it("looks the stations up by name, once for each, and searches the day once for the pair", async () => {
    const { http, gets, posts } = fakeTrenitalia();
    await createTrenitalia({ http }).quote(milanoRoma(), { cache: memoryCache() });
    expect(gets).toHaveLength(2);
    expect(gets[0]).toMatch(/name=MILANO[ +]CENTRALE/);
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ departureLocationId: 830001700, arrivalLocationId: 830008409, departureTime: "2026-12-04T06:35:00.000", adults: 1 });
  });

  it("reads on, ten solutions at a time, until it has reached the last train it wants", async () => {
    // Solution n leaves at 05:00 + 10 minutes × n, and costs 50 + n: 12:20 is the 45th, on the fifth page
    const at = (minutes: number) => `2026-12-04T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00.000+01:00`;
    const solution = (n: number) => ({ solution: { departureTime: at(300 + n * 10), arrivalTime: at(300 + n * 10 + 180), status: "SALEABLE", price: { amount: 50 + n } } });
    const pages = Array.from({ length: 6 }, (_, page) => ({ solutions: Array.from({ length: 10 }, (_, i) => solution(page * 10 + i)) }));
    const { http, posts } = fakeTrenitalia(pages);

    const station = { from: { name: "MILANO CENTRALE", lat: 45.48, lon: 9.2 }, to: { name: "ROMA TERMINI", lat: 41.9, lon: 12.5 }, operator: "TRENITALIA", train: "FR" };
    const first = journey({ ...station, departAt: "2026-12-04T05:00", arriveAt: "2026-12-04T08:00" });
    const last = journey({ ...station, departAt: "2026-12-04T12:20", arriveAt: "2026-12-04T15:20" });
    const [early, late] = await createTrenitalia({ http }).quote([first, last], { cache: memoryCache() });

    expect(posts.map((p) => p.offset)).toEqual([0, 10, 20, 30, 40]);
    expect(early).toMatchObject({ priceEur: 50, kind: "live" });
    expect(late).toMatchObject({ priceEur: 94, kind: "live" });
  });

  it("stops reading after a few pages even if the train wanted never comes", async () => {
    const same = { solutions: Array.from({ length: 10 }, () => ({ solution: { departureTime: "2026-12-04T05:00:00.000+01:00", arrivalTime: "2026-12-04T08:00:00.000+01:00", status: "SALEABLE", price: { amount: 50 } } })) };
    const { http, posts } = fakeTrenitalia([same]);
    const station = { from: { name: "MILANO CENTRALE", lat: 45.48, lon: 9.2 }, to: { name: "ROMA TERMINI", lat: 41.9, lon: 12.5 }, operator: "TRENITALIA", train: "FR" };
    await createTrenitalia({ http, config: { apiUrl: "https://example.test", pageSize: 10, maxPages: 3 } }).quote([journey({ ...station, departAt: "2026-12-04T05:00", arriveAt: "2026-12-04T08:00" }), journey({ ...station, departAt: "2026-12-04T23:00", arriveAt: "2026-12-05T02:00" })], { cache: memoryCache() });
    expect(posts).toHaveLength(3);
  });

  it("asks nothing about a journey that is not entirely Trenitalia's", async () => {
    const { http, posts } = fakeTrenitalia();
    const answers = await createTrenitalia({ http }).quote([journey(), journey({ operator: "RENFE OPERADORA" })], { cache: memoryCache() });
    expect(answers).toEqual([null, null]);
    expect(posts).toHaveLength(0);
  });

  it("does not ask again for what it was already told (the cache keeps the stations and the day)", async () => {
    const { http, posts, gets } = fakeTrenitalia();
    const cache = memoryCache();
    const source = createTrenitalia({ http });
    await source.quote(milanoRoma(), { cache });
    await source.quote(milanoRoma(), { cache });
    expect(posts).toHaveLength(1);
    expect(gets).toHaveLength(2);
    await source.quote(milanoRoma(), { cache, refresh: true });
    expect(posts).toHaveLength(2);
  });

  it("gives no price to a solution with no fare on sale", async () => {
    const { http } = fakeTrenitalia();
    const noFare = journey({ operator: "TRENITALIA", train: "FR", from: { name: "MILANO CENTRALE", lat: 45.48, lon: 9.2 }, to: { name: "ROMA TERMINI", lat: 41.9, lon: 12.5 }, departAt: "2026-12-04T07:20", arriveAt: "2026-12-04T18:10" });
    expect(await createTrenitalia({ http }).quote([noFare], { cache: memoryCache() })).toEqual([null]);
  });

  it("says nothing for a station it cannot find, and fails when the site changed", async () => {
    const lost: Http = { getJson: vi.fn(async () => []), postJson: vi.fn() };
    expect(await createTrenitalia({ http: lost }).quote(milanoRoma(), { cache: memoryCache() })).toEqual([null, null, null]);

    const changed: Http = { getJson: vi.fn(async () => ({ not: "a list" })), postJson: vi.fn() };
    await expect(createTrenitalia({ http: changed }).quote(milanoRoma(), { cache: memoryCache() })).rejects.toBeInstanceOf(ScrapeChangedError);
  });

  it("lets a wall through to the caller, which stops asking this source", async () => {
    const walled: Http = { getJson: vi.fn(async () => Promise.reject(new ScrapeBlockedError("Trenitalia turned the request away"))), postJson: vi.fn() };
    await expect(createTrenitalia({ http: walled }).quote(milanoRoma(), { cache: memoryCache() })).rejects.toBeInstanceOf(ScrapeBlockedError);
  });
});
