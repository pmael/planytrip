import { describe, expect, it, vi } from "vitest";
import { trains } from "@/config";
import { ScrapeBlockedError, ScrapeError } from "@/scrapers/errors";
import type { FareQuote, FareSource, TrainJourney } from "@/scrapers/transport/train-types";
import type { Timetable } from "@/scrapers/transport/transitous";
import { createTrainsAdapter } from "@/scrapers/transport/trains";
import type { TransportQuery } from "@/scrapers/types";
import { journey, memoryCache } from "./helpers/trains";

const now = () => new Date("2026-10-24T10:00:00Z");
const query = (over: Partial<TransportQuery> = {}): TransportQuery => ({
  mode: "train",
  origin: { key: "toulouse-france", label: "Toulouse, France", lat: 43.6047, lon: 1.4442, airports: ["TLS"] },
  destination: { id: "d", label: "Lyon, France", lat: 45.764, lon: 4.8357, airports: ["LYS"] },
  window: { from: "2026-12-04", to: "2026-12-06" },
  ...over,
});

/** The way there leaves at 07:37, the ways back at 16:39 and 18:00 */
const there = journey();
const back = (over: Parameters<typeof journey>[0] = {}) =>
  journey({
    from: { name: "Lyon Part Dieu", lat: 45.7606, lon: 4.8594 },
    to: { name: "Toulouse Matabiau", lat: 43.6112, lon: 1.4536 },
    departAt: "2026-12-06T16:39",
    arriveAt: "2026-12-06T20:39",
    ...over,
  });

const timetable = (out: TrainJourney[] = [there], backs: TrainJourney[] = [back()]) => {
  const journeys = vi.fn<Timetable["journeys"]>(async (_from, _to, day) => (day === "2026-12-04" ? out : backs));
  return { timetable: { journeys } as Timetable, journeys };
};

const live = (priceEur: number, link = "https://seller.example/"): FareQuote => ({ priceEur, kind: "live", note: null, source: "seller", link });
const range = (priceEur: number): FareQuote => ({ priceEur, kind: "estimated", note: "SNCF's published fares for this route: 25 to 101 € one way", source: "sncf-fares", link: "https://sncf.example/" });
const source = (id: string, quote: (journeys: TrainJourney[]) => (FareQuote | null)[] | Promise<never>): FareSource & { quote: ReturnType<typeof vi.fn> } => ({
  id,
  quote: vi.fn(async (journeys: TrainJourney[]) => quote(journeys)),
}) as never;

const adapter = (parts: { timetable: Timetable; fares?: FareSource[] }) => createTrainsAdapter({ timetable: parts.timetable, fares: parts.fares ?? [], now });

describe("the trains adapter (T7.8)", () => {
  it("is for trains only, and has nothing for a day that has already begun", async () => {
    const { timetable: t } = timetable();
    expect(await adapter({ timetable: t }).search(query({ mode: "bus" }))).toEqual([]);
    expect(await adapter({ timetable: t }).search(query({ window: { from: "2026-10-24", to: "2026-10-26" } }))).toEqual([]);
  });

  it("asks the timetable for the way there on the first day and the way back on the last, from one place to the other", async () => {
    const { timetable: t, journeys } = timetable();
    await adapter({ timetable: t }).search(query());
    expect(journeys.mock.calls.map(([from, to, day]) => [from.lat, to.lat, day])).toEqual([
      [43.6047, 45.764, "2026-12-04"],
      [45.764, 43.6047, "2026-12-06"],
    ]);
  });

  it("gives a real price, a round trip, when a source knows the fare of both ways", async () => {
    const { timetable: t } = timetable();
    const seller = source("seller", (js) => js.map((j) => live(j === there ? 66 : 71)));
    const [option] = await adapter({ timetable: t, fares: [seller] }).search(query());

    expect(option).toMatchObject({
      originKey: "toulouse-france",
      mode: "train",
      provider: "sncf",
      variant: "standard",
      outDepartAt: "2026-12-04T07:37",
      outArriveAt: "2026-12-04T11:48",
      backDepartAt: "2026-12-06T16:39",
      backArriveAt: "2026-12-06T20:39",
      outDurationMin: 251,
      stops: 0,
      priceEur: 137,
      priceUnit: "per_person",
      priceKind: "live",
      priceNote: null,
      url: "https://seller.example/",
    });
  });

  it("marks the price as an estimate when it comes from a published range, and says from where", async () => {
    const { timetable: t } = timetable();
    const [option] = await adapter({ timetable: t, fares: [source("sncf-fares", (js) => js.map(() => range(63)))] }).search(query());
    expect(option).toMatchObject({ priceEur: 126, priceKind: "estimated", priceNote: "SNCF's published fares for this route: 25 to 101 € one way" });
    expect(option.url).toBe("https://sncf.example/");
  });

  it("is an estimate even when one of the two ways is a real fare: half a real price is not one", async () => {
    const { timetable: t } = timetable();
    const first = source("seller", (js) => js.map((j) => (j === there ? live(66) : null)));
    const second = source("sncf-fares", (js) => js.map(() => range(63)));
    const [option] = await adapter({ timetable: t, fares: [first, second] }).search(query());
    expect(option).toMatchObject({ priceEur: 129, priceKind: "estimated" });
  });

  it("asks a source only about the journeys the sources before it could not price", async () => {
    const { timetable: t } = timetable([there, journey({ departAt: "2026-12-04T10:00", arriveAt: "2026-12-04T14:00", train: "TGV INOUI 1" })]);
    const first = source("first", (js) => js.map((j) => (j.departAt === "2026-12-04T07:37" ? live(66) : null)));
    const second = source("second", (js) => js.map(() => range(63)));
    await adapter({ timetable: t, fares: [first, second] }).search(query());
    // Out: both journeys to the first, one left for the second; back: the one journey, priced by neither of the first
    expect(second.quote.mock.calls[0][0].map((j: TrainJourney) => j.departAt)).toEqual(["2026-12-04T10:00"]);
  });

  it("works a price out from the distance when no source knows it, and says so", async () => {
    const { timetable: t } = timetable();
    const [option] = await adapter({ timetable: t }).search(query());
    // Toulouse to Lyon is about 360 km as the crow flies, each way
    const oneWay = option.priceEur / 2;
    expect(oneWay).toBeGreaterThan(50);
    expect(oneWay).toBeLessThan(60);
    expect(option).toMatchObject({ priceKind: "estimated", priceNote: expect.stringMatching(/Estimated from the distance/) });
  });

  it("never works out less than a minimum for a short ride", async () => {
    const short = journey({ from: { name: "A", lat: 45, lon: 4 }, to: { name: "B", lat: 45.01, lon: 4 } });
    const { timetable: t } = timetable([short], [back({ from: { name: "B", lat: 45.01, lon: 4 }, to: { name: "A", lat: 45, lon: 4 } })]);
    const [option] = await adapter({ timetable: t }).search(query({ destination: { id: "d", label: "B", lat: 45.01, lon: 4, airports: [] } }));
    expect(option.priceEur).toBe(trains.distanceEstimate.minEur * 2);
  });

  describe("the way back", () => {
    const twoBacks = [back({ departAt: "2026-12-06T16:39", arriveAt: "2026-12-06T20:39" }), back({ departAt: "2026-12-06T18:00", arriveAt: "2026-12-06T22:00" })];

    it("is the cheapest of the real fares", async () => {
      const { timetable: t } = timetable([there], twoBacks);
      const seller = source("seller", (js) => js.map((j) => live(j === there ? 66 : j.departAt.endsWith("18:00") ? 40 : 90)));
      const [option] = await adapter({ timetable: t, fares: [seller] }).search(query());
      expect(option).toMatchObject({ backDepartAt: "2026-12-06T18:00", priceEur: 106 });
    });

    it("is the one with the fewest changes and the shortest time when no fare is real, as an estimate cannot tell them apart", async () => {
      const slow = back({ departAt: "2026-12-06T09:00", arriveAt: "2026-12-06T19:00" });
      const withChange = back({ departAt: "2026-12-06T10:00", arriveAt: "2026-12-06T13:00" });
      withChange.legs.push({ ...withChange.legs[0], train: "TER 1" });
      const { timetable: t } = timetable([there], [withChange, slow, twoBacks[0]]);
      const [option] = await adapter({ timetable: t, fares: [source("sncf-fares", (js) => js.map(() => range(63)))] }).search(query());
      // Direct and quickest of the direct ones: 16:39 → 20:39 is 4 h, 09:00 → 19:00 is 10 h
      expect(option.backDepartAt).toBe("2026-12-06T16:39");
    });

    it("has to exist: a way there with no way back is not a trip", async () => {
      const { timetable: t } = timetable([there], []);
      expect(await adapter({ timetable: t }).search(query())).toEqual([]);
      const none = timetable([], [back()]);
      expect(await adapter({ timetable: none.timetable }).search(query())).toEqual([]);
    });
  });

  describe("which journeys are offered", () => {
    const other = (over: Parameters<typeof journey>[0]) => journey({ departAt: "2026-12-04T10:00", arriveAt: "2026-12-04T14:11", ...over });
    const offered = async (out: TrainJourney[], over: Partial<TransportQuery> = {}) =>
      (await adapter({ timetable: timetable(out).timetable }).search(query(over))).map((o) => o.outDepartAt);

    it("leaves out journeys that are entirely FlixBus's or RegioJet's: their own adapters list them with real prices", async () => {
      expect(await offered([there, other({ operator: "FlixTrain GmbH" }), other({ operator: "RegioJet a.s.", departAt: "2026-12-04T11:00", arriveAt: "2026-12-04T15:11" })])).toEqual(["2026-12-04T07:37"]);
    });

    it("leaves out those that take more than twice the quickest, and those with too many changes", async () => {
      const slow = other({ departAt: "2026-12-04T09:00", arriveAt: "2026-12-04T19:00" });
      const manyChanges = other({ departAt: "2026-12-04T12:00", arriveAt: "2026-12-04T15:00" });
      manyChanges.legs.push(...Array.from({ length: 4 }, () => ({ ...manyChanges.legs[0] })));
      expect(await offered([there, slow, manyChanges])).toEqual(["2026-12-04T07:37"]);
    });

    it("leaves out those that stop far from the destination (the timetable plans for the earliest arrival: it may be a station 80 km off)", async () => {
      const far = other({ to: { name: "Saint-Etienne", lat: 45.44, lon: 4.38 }, departAt: "2026-12-04T09:00", arriveAt: "2026-12-04T11:00" });
      expect(await offered([there, far])).toEqual(["2026-12-04T07:37"]);
    });

    it("keeps a station near enough, and counts the taxi from it as the last mile (11 € per 10 km beyond 20)", async () => {
      // 30 km from Lyon
      const near = journey({ to: { name: "Vienne", lat: 45.5253, lon: 4.8742 } });
      const { timetable: t } = timetable([near], [back({ from: { name: "Vienne", lat: 45.5253, lon: 4.8742 } })]);
      const [option] = await adapter({ timetable: t }).search(query());
      expect(option.lastMileEur).toBeGreaterThan(20);
      expect(option.lastMileEur).toBeLessThan(40);
      // And none when the station is in the city
      expect((await adapter({ timetable: timetable().timetable }).search(query()))[0].lastMileEur).toBe(0);
    });

    it("keeps at most the number of options config says, quickest first, in the order of the day", async () => {
      const many = Array.from({ length: 14 }, (_, i) => other({ departAt: `2026-12-04T${String(6 + i).padStart(2, "0")}:00`, arriveAt: `2026-12-04T${String(10 + i).padStart(2, "0")}:${String(i * 3).padStart(2, "0")}` }));
      const found = await offered(many);
      expect(found).toHaveLength(trains.transitous.maxOptions);
      expect(found).toEqual([...found].sort());
    });
  });

  describe("when a source fails", () => {
    it("prices with the next source, and writes down what went wrong", async () => {
      const { timetable: t } = timetable();
      const broken = source("trenitalia", () => Promise.reject(new ScrapeError("Trenitalia answered 503")));
      const sncf = source("sncf-fares", (js) => js.map(() => range(63)));
      const [option] = await adapter({ timetable: t, fares: [broken, sncf] }).search(query());
      expect(option.priceKind).toBe("estimated");
      expect(option.priceEur).toBe(126);
      expect((option.raw as { fareProblems: string[] }).fareProblems[0]).toMatch(/trenitalia: Trenitalia answered 503/);
    });

    it("stops asking a source that turned us away, for the rest of the search", async () => {
      const { timetable: t } = timetable();
      const walled = source("trenitalia", () => Promise.reject(new ScrapeBlockedError("Trenitalia turned the request away")));
      await adapter({ timetable: t, fares: [walled] }).search(query());
      // Asked for the way there; not asked again for the way back
      expect(walled.quote).toHaveBeenCalledTimes(1);
    });

    it("does not hide a mistake in the code: only scraping problems are forgiven", async () => {
      const { timetable: t } = timetable();
      const buggy = source("buggy", () => Promise.reject(new TypeError("x is undefined")));
      await expect(adapter({ timetable: t, fares: [buggy] }).search(query())).rejects.toBeInstanceOf(TypeError);
    });

    it("fails the search when the timetable does", async () => {
      const failing: Timetable = { journeys: vi.fn(async () => Promise.reject(new ScrapeError("Could not reach Transitous"))) };
      await expect(adapter({ timetable: failing }).search(query())).rejects.toThrow("Could not reach Transitous");
    });
  });

  describe("the cache", () => {
    it("keeps the timetable of a day, and asks again when told to", async () => {
      const { timetable: t, journeys } = timetable();
      const cache = memoryCache();
      await adapter({ timetable: t }).search(query({ cache }));
      await adapter({ timetable: t }).search(query({ cache }));
      expect(journeys).toHaveBeenCalledTimes(2);
      await adapter({ timetable: t }).search(query({ cache, refresh: true }));
      expect(journeys).toHaveBeenCalledTimes(4);
    });

    it("does not keep a day with no train: it may be a timetable that did not load, and must not be believed for a day", async () => {
      const { timetable: t, journeys } = timetable([], []);
      const cache = memoryCache();
      await adapter({ timetable: t }).search(query({ cache }));
      await adapter({ timetable: t }).search(query({ cache }));
      expect(journeys).toHaveBeenCalledTimes(2);
    });
  });

  it("names the operator of the longest fast train, not of the regional one that brings you to it", async () => {
    const regional = journey({ operator: "DB Regio AG Bayern", train: "RE40", mode: "REGIONAL_RAIL", departAt: "2026-12-04T07:00", arriveAt: "2026-12-04T07:30" });
    const fast = journey({ operator: "SBB", train: "EC 191", mode: "LONG_DISTANCE", departAt: "2026-12-04T07:37", arriveAt: "2026-12-04T10:00" });
    const mixed: TrainJourney = { legs: [regional.legs[0], fast.legs[0]], departAt: "2026-12-04T07:00", arriveAt: "2026-12-04T10:00", durationMin: 180 };
    const { timetable: t } = timetable([mixed]);
    const [option] = await adapter({ timetable: t }).search(query());
    expect(option).toMatchObject({ provider: "sbb", stops: 1 });
  });
});
