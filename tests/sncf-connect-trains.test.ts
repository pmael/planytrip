import { describe, expect, it, vi } from "vitest";
import { trains } from "@/config";
import { ScrapeBlockedError, ScrapeError, ScrapeUnavailableError } from "@/scrapers/errors";
import { createSncfConnect, modeOf, placeName, quoteOf, toJourney } from "@/scrapers/transport/sncf-connect";
import { UnknownPlaceError, type DayQuery, type SncfConnectDay, type SncfConnectTrain } from "@/scrapers/transport/sncf-connect-day";
import { createSncfStations, parseStations } from "@/scrapers/transport/sncf-stations";
import { isSoldOut, type FareQuote, type SoldOut } from "@/scrapers/transport/train-types";
import type { Timetable } from "@/scrapers/transport/transitous";
import { createTrainsAdapter } from "@/scrapers/transport/trains";
import type { TransportOptionInput } from "@/scrapers/types";
import { journey, memoryCache, trainFixture, trainJson } from "./helpers/trains";

/** What fetch_day.py printed for Paris → Lyon on 10 Nov 2026 (made from tools/sncf-api/trains.json): 31 trains */
const PARIS_LYON: SncfConnectDay = trainJson("sncf-connect-day-paris-lyon.json");
const at = (time: string) => PARIS_LYON.trains.find((t) => t.departAt === `2026-11-10T${time}`)!;

/** A train of the way back, Lyon Part-Dieu → Paris Gare de Lyon on 12 Nov */
const backTrain = (time: string, over: Partial<SncfConnectTrain> = {}): SncfConnectTrain => {
  const [h, m] = time.split(":").map(Number);
  const arrives = `${String(h + 2).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return {
    id: `2026-11-12T${time}_6600`,
    departAt: `2026-11-12T${time}`,
    arriveAt: `2026-11-12T${arrives}`,
    durationMin: 120,
    from: "Lyon Part Dieu",
    to: "Paris - Gare De Lyon - Hall 1 & 2",
    changes: 0,
    legs: [{ from: "Lyon Part Dieu", fromCode: "8772319", departs: time, to: "Paris - Gare De Lyon - Hall 1 & 2", toCode: "8768600", arrives, operator: "TGV INOUI", number: "6600" }],
    bookable: true,
    availability: "bookable",
    priceEur: { best: 49, second: 49, first: 90 },
    ...over,
  };
};
const LYON_PARIS: SncfConnectDay = {
  ...PARIS_LYON,
  date: "2026-11-12",
  trains: [backTrain("18:04"), backTrain("19:04", { bookable: false, availability: "sold-out", priceEur: { best: null, second: null, first: null } }), backTrain("20:04", { priceEur: { best: 57, second: 57, first: 99 } })],
};

const LINK = trains.links.sncf;
const priceOf = (answer: FareQuote | SoldOut | null | undefined) => (answer && !isSoldOut(answer) ? answer.priceEur : null);
const stations = createSncfStations({ load: async () => trainFixture("sncf-stations.csv") });
const settings = { blockedCooldownMs: 30 * 60_000 };

describe("placeName", () => {
  it("is the place as a person types it in SNCF Connect's search", () => {
    expect(placeName("Paris, France")).toBe("Paris");
    expect(placeName("Toulouse")).toBe("Toulouse");
    expect(placeName("La Réunion (Saint-Gilles)")).toBe("La Réunion");
  });
});

describe("quoteOf", () => {
  it("is the second-class price, rounded like the other sellers'", () => {
    expect(quoteOf(at("06:16"), LINK)).toEqual({ priceEur: 71, kind: "live", note: null, source: "sncf-connect", link: LINK });
    // OUIGO: the cheaper of its two second-class fares (34 € OUIGO PLUS, 25 € Essentiel)
    expect(priceOf(quoteOf(at("08:55"), LINK))).toBe(25);
  });

  it("is the first-class price when only first class is left, and says so", () => {
    expect(quoteOf(at("15:00"), LINK)).toEqual({ priceEur: 180, kind: "live", note: "Only first class left on SNCF Connect", source: "sncf-connect", link: LINK });
  });

  it('says a full train (SNCF\'s "Complet") is sold out', () => {
    expect(quoteOf(at("15:52"), LINK)).toEqual({ soldOut: true, source: "sncf-connect" });
  });

  it('has no price for a train whose sales are not open yet ("En vente prochainement"): it is not full', () => {
    expect(quoteOf({ ...at("15:52"), availability: "not-on-sale" }, LINK)).toBeNull();
    expect(quoteOf({ ...at("15:52"), availability: "unavailable" }, LINK)).toBeNull();
  });

  it("falls back on SNCF's best price when no class says", () => {
    expect(priceOf(quoteOf({ ...at("07:26"), priceEur: { best: 84, second: null, first: null } }, LINK))).toBe(84);
  });
});

describe("toJourney: an SNCF Connect train as a journey of the app", () => {
  const ORIGIN = { lat: 48.8566, lon: 2.3522 };
  const DESTINATION = { lat: 45.764, lon: 4.8357 };
  const where = (table: Map<string, { lat: number; lon: number }>) => (code: string | null | undefined, side: "origin" | "destination") =>
    (code ? table.get(code) : undefined) ?? (side === "origin" ? ORIGIN : DESTINATION);

  it("keeps SNCF's stations, times, trains and changes, and places the stations by their UIC number", () => {
    const table = parseStations(trainFixture("sncf-stations.csv"));
    expect(toJourney(at("06:16"), where(table))).toEqual({
      legs: [
        {
          from: { name: "Paris - Gare De Lyon - Hall 1 & 2", lat: 48.844888, lon: 2.37352 },
          departAt: "2026-11-10T06:16",
          to: { name: "Bourg-En-Bresse", lat: 46.200351, lon: 5.215063 },
          arriveAt: "2026-11-10T08:09",
          train: "LYRIA 9761",
          operator: "LYRIA",
          mode: "HIGHSPEED_RAIL",
        },
        {
          from: { name: "Bourg-En-Bresse", lat: 46.200351, lon: 5.215063 },
          departAt: "2026-11-10T08:14",
          to: { name: "Lyon Part Dieu", lat: 45.760559, lon: 4.859355 },
          arriveAt: "2026-11-10T09:04",
          train: "Train TER 889317",
          operator: "SNCF VOYAGEURS",
          mode: "REGIONAL_RAIL",
        },
      ],
      departAt: "2026-11-10T06:16",
      arriveAt: "2026-11-10T09:04",
      durationMin: 168,
    });
  });

  it("places a station it does not know at the end of the way it is at", () => {
    const [leg] = toJourney(at("07:26"), where(new Map()))!.legs;
    expect([leg.from.lat, leg.to.lat]).toEqual([ORIGIN.lat, DESTINATION.lat]);
  });

  it("puts a leg that leaves after midnight on the next day", () => {
    const late: SncfConnectTrain = {
      ...backTrain("22:50"),
      arriveAt: "2026-11-13T01:10",
      durationMin: 140,
      changes: 1,
      legs: [
        { from: "A", departs: "22:50", to: "B", arrives: "23:55", operator: "TGV INOUI", number: "1" },
        { from: "B", departs: "00:10", to: "C", arrives: "01:10", operator: "TGV INOUI", number: "2" },
      ],
    };
    expect(toJourney(late, where(new Map()))!.legs.map((leg) => [leg.departAt, leg.arriveAt])).toEqual([
      ["2026-11-12T22:50", "2026-11-12T23:55"],
      ["2026-11-13T00:10", "2026-11-13T01:10"],
    ]);
  });

  it("is no journey without a train", () => {
    expect(toJourney({ ...at("07:26"), legs: [] }, where(new Map()))).toBeNull();
  });

  it("names the kind of train as the timetable does", () => {
    expect(["TGV INOUI", "OUIGO", "Train TER", "INTERCITES", "INTERCITES DE NUIT", "OUIGO TRAIN CLASSIQUE", "LYRIA"].map(modeOf)).toEqual([
      "HIGHSPEED_RAIL",
      "HIGHSPEED_RAIL",
      "REGIONAL_RAIL",
      "LONG_DISTANCE",
      "NIGHT_RAIL",
      "LONG_DISTANCE",
      "HIGHSPEED_RAIL",
    ]);
  });
});

describe("parseStations", () => {
  it("gives each station's position by the 7-digit UIC number SNCF Connect uses, for all its codes", () => {
    const table = parseStations(trainFixture("sncf-stations.csv"));
    expect(table.get("8768600")).toEqual({ lat: 48.844888, lon: 2.37352 });
    expect(table.get("8768603")).toEqual({ lat: 48.844888, lon: 2.37352 });
    expect(table.get("8727149")).toEqual({ lat: 49.003652, lon: 2.570892 });
    expect(parseStations("not;a;station file\n1;2;3").size).toBe(0);
  });
});

describe("createSncfConnect: the day's trains between two places", () => {
  const fetchDayWith = (answer: (query: DayQuery) => SncfConnectDay | Promise<never> = () => PARIS_LYON) => vi.fn(async (query: DayQuery) => answer(query));
  const PARIS = { origin: "Paris", destination: "Lyon", date: "2026-11-10" };

  it("reads the day once, keeps it for the next search, and reads it again when asked to refresh", async () => {
    const fetchDay = fetchDayWith();
    const source = createSncfConnect({ fetchDay, config: settings });
    const cache = memoryCache();
    expect(await source.day(PARIS, { cache })).toHaveLength(31);
    await source.day(PARIS, { cache });
    expect(fetchDay).toHaveBeenCalledTimes(1);
    expect(fetchDay).toHaveBeenCalledWith(PARIS);
    expect(cache.keys()).toEqual(["trains|PARIS|LYON|2026-11-10"]);
    await source.day(PARIS, { cache, refresh: true });
    expect(fetchDay).toHaveBeenCalledTimes(2);
  });

  it("does not keep a day without a train: a page may not have loaded", async () => {
    const fetchDay = fetchDayWith(() => ({ ...PARIS_LYON, trains: [] }));
    const source = createSncfConnect({ fetchDay, config: settings });
    const cache = memoryCache();
    expect(await source.day(PARIS, { cache })).toEqual([]);
    await source.day(PARIS, { cache });
    expect(fetchDay).toHaveBeenCalledTimes(2);
  });

  it("answers nothing for a place SNCF does not know, and remembers it", async () => {
    const fetchDay = fetchDayWith(() => Promise.reject(new UnknownPlaceError("No PLACE result for: 'Xyz'")));
    const source = createSncfConnect({ fetchDay, config: settings });
    const cache = memoryCache();
    expect(await source.day(PARIS, { cache })).toBeNull();
    expect(await source.day(PARIS, { cache })).toBeNull();
    expect(fetchDay).toHaveBeenCalledTimes(1);
  });

  it("lets any other failure through", async () => {
    const fetchDay = fetchDayWith(() => Promise.reject(new ScrapeUnavailableError("Chrome is not reachable")));
    await expect(createSncfConnect({ fetchDay, config: settings }).day(PARIS, { cache: memoryCache() })).rejects.toBeInstanceOf(ScrapeUnavailableError);
  });

  it("leaves SNCF Connect alone for a while after it turned a request away", async () => {
    let clock = Date.parse("2026-10-24T10:00:00Z");
    const fetchDay = fetchDayWith(() => Promise.reject(new ScrapeBlockedError("SNCF Connect turned the request away: HTTP 403")));
    const source = createSncfConnect({ fetchDay, config: settings, now: () => clock });

    await expect(source.day(PARIS, { cache: memoryCache() })).rejects.toThrow("HTTP 403");
    clock += 10 * 60_000;
    await expect(source.day(PARIS, { cache: memoryCache() })).rejects.toThrow(new ScrapeBlockedError("SNCF Connect turned a request away: not asked again before 10:30 UTC"));
    expect(fetchDay).toHaveBeenCalledTimes(1);

    clock += 21 * 60_000;
    fetchDay.mockImplementation(async () => PARIS_LYON);
    expect(await source.day(PARIS, { cache: memoryCache() })).toHaveLength(31);
  });
});

describe("the trains of a search come from SNCF Connect while it is on", () => {
  const query = {
    mode: "train" as const,
    origin: { key: "paris-france", label: "Paris, France", lat: 48.8566, lon: 2.3522, airports: ["CDG"] },
    destination: { id: "d", label: "Lyon, France", lat: 45.764, lon: 4.8357, airports: ["LYS"] },
    window: { from: "2026-11-10", to: "2026-11-12" },
  };
  const now = () => new Date("2026-10-24T10:00:00Z");
  /** Transitous' answer, when it is asked: one estimated train each way */
  const timetable = () =>
    ({
      journeys: vi.fn<Timetable["journeys"]>(async (_from, _to, day) => [
        day === "2026-11-10"
          ? journey({ from: { name: "Paris Gare de Lyon", lat: 48.8443, lon: 2.3743 }, to: { name: "Lyon Part-Dieu", lat: 45.7606, lon: 4.8594 }, departAt: "2026-11-10T07:26", arriveAt: "2026-11-10T09:22" })
          : journey({ from: { name: "Lyon Part-Dieu", lat: 45.7606, lon: 4.8594 }, to: { name: "Paris Gare de Lyon", lat: 48.8443, lon: 2.3743 }, departAt: "2026-11-12T18:04", arriveAt: "2026-11-12T20:00" }),
      ]),
    }) as Timetable & { journeys: ReturnType<typeof vi.fn> };
  const days = (there: SncfConnectDay | Promise<never> = PARIS_LYON, back: SncfConnectDay | Promise<never> = LYON_PARIS) =>
    vi.fn(async (q: DayQuery) => (q.date === "2026-11-10" ? there : back));
  const adapterWith = (fetchDay: ReturnType<typeof days>, over: { isOn?: () => boolean; stations?: () => Promise<Map<string, { lat: number; lon: number }>> } = {}) => {
    const table = timetable();
    const adapter = createTrainsAdapter({ timetable: table, fares: [], now, sncfConnect: createSncfConnect({ fetchDay, config: settings, isOn: over.isOn }), stations: over.stations ?? stations });
    return { adapter, timetable: table };
  };
  const option = (options: TransportOptionInput[], departAt: string) => options.find((o) => o.outDepartAt === `2026-11-10T${departAt}`);

  it("offers SNCF's own trains at their real price, there and back, without asking the timetable", async () => {
    const fetchDay = days();
    const { adapter, timetable: table } = adapterWith(fetchDay);

    const options = await adapter.search({ ...query, cache: memoryCache() });

    expect(fetchDay.mock.calls.map(([q]) => q)).toEqual([
      { origin: "Paris", destination: "Lyon", date: "2026-11-10" },
      { origin: "Lyon", destination: "Paris", date: "2026-11-12" },
    ]);
    expect(table.journeys).not.toHaveBeenCalled();
    expect(options.length).toBeGreaterThan(5);
    expect(options.every((o) => o.priceKind === "live" && o.priceNote === null)).toBe(true);
    // The way back is the cheapest with seats: 18:04 at 49 €
    expect(option(options, "07:26")).toMatchObject({ priceEur: 84 + 49, provider: "sncf", url: LINK, backDepartAt: "2026-11-12T18:04", stops: 0, soldOut: false, lastMileEur: 0 });
    expect(option(options, "07:26")!.raw).toMatchObject({ source: "sncf-connect", out: { legs: [{ from: { name: "Paris - Gare De Lyon - Hall 1 & 2", lat: 48.844888 } }] } });
  });

  it("counts the transfer from a station far from the stay: OUIGO to Lyon Saint-Exupéry, 16 €, 23 km from a stay west of Lyon", async () => {
    const west = { ...query.destination, lon: 4.78 };
    const options = await adapterWith(days()).adapter.search({ ...query, destination: west, cache: memoryCache() });
    expect(option(options, "12:50")).toMatchObject({ priceEur: 16 + 49, lastMileEur: 26 });
    expect(option(options, "07:26")).toMatchObject({ lastMileEur: 0 });
  });

  it("offers the cheapest train with seats however slow, beside the quickest ones", async () => {
    const cheapTer = { ...PARIS_LYON, trains: PARIS_LYON.trains.map((t) => (t.departAt.endsWith("07:34") ? { ...t, priceEur: { best: 9, second: 9, first: null } } : t)) };
    const options = await adapterWith(days(cheapTer)).adapter.search({ ...query, cache: memoryCache() });
    expect(option(options, "07:34")).toMatchObject({ priceEur: 9 + 49, outDurationMin: 310 });
    // A slow one that is not the cheapest is not
    expect(option(options, "13:35")).toBeUndefined();
  });

  it("offers two coupled trains SNCF lists under both their numbers once, the one with seats or the cheaper", async () => {
    const coupled = (number: string, over: Partial<SncfConnectTrain>) => ({ ...at("07:26"), id: `2026-11-10T07:26_${number}`, legs: [{ ...at("07:26").legs[0], number }], ...over });
    const day = { ...PARIS_LYON, trains: [coupled("6603", { priceEur: { best: 84, second: 84, first: 158 } }), coupled("6643", { priceEur: { best: 79, second: 79, first: 158 } }), at("15:52"), coupled("6699", { departAt: "2026-11-10T15:52", arriveAt: "2026-11-10T18:00", legs: [{ ...at("15:52").legs[0], number: "6699" }] })] };
    const options = await adapterWith(days(day)).adapter.search({ ...query, cache: memoryCache() });
    expect(options.map((o) => [o.outDepartAt?.slice(11), o.priceEur, o.soldOut])).toEqual([
      ["07:26", 79 + 49, false],
      ["15:52", 84 + 49, false],
    ]);
  });

  it("shows a full train as sold out, and leaves out one with no price", async () => {
    const day = { ...PARIS_LYON, trains: [at("07:26"), at("15:52"), { ...at("09:00"), bookable: false, availability: "not-on-sale" as const }] };
    const options = await adapterWith(days(day)).adapter.search({ ...query, cache: memoryCache() });
    expect(options.map((o) => [o.outDepartAt?.slice(11), o.soldOut, o.priceKind])).toEqual([
      ["07:26", false, "live"],
      ["15:52", true, "estimated"],
    ]);
  });

  it("asks the timetable while it is off, and SNCF Connect from the search after it is turned on", async () => {
    let on = false;
    const fetchDay = days();
    const { adapter, timetable: table } = adapterWith(fetchDay, { isOn: () => on });

    const [estimated] = await adapter.search({ ...query, cache: memoryCache() });
    expect(fetchDay).not.toHaveBeenCalled();
    expect(table.journeys).toHaveBeenCalledTimes(2);
    expect(estimated).toMatchObject({ priceKind: "estimated", raw: { source: "transitous" } });

    on = true;
    const options = await adapter.search({ ...query, cache: memoryCache() });
    expect(option(options, "07:26")).toMatchObject({ priceEur: 133, priceKind: "live" });
  });

  it("goes to the timetable when a day is not on sale yet, and says why, without asking the way back", async () => {
    const notYet = { ...PARIS_LYON, trains: PARIS_LYON.trains.map((t) => ({ ...t, bookable: false, availability: "not-on-sale" as const })) };
    const fetchDay = days(notYet);
    const { adapter, timetable: table } = adapterWith(fetchDay);

    const [only, ...rest] = await adapter.search({ ...query, cache: memoryCache() });

    expect(rest).toEqual([]);
    expect(fetchDay).toHaveBeenCalledTimes(1);
    expect(table.journeys).toHaveBeenCalledTimes(2);
    expect(only.priceKind).toBe("estimated");
    expect((only.raw as { fareProblems: string[] }).fareProblems).toEqual(["sncf-connect: no train from Paris to Lyon with a price on 2026-11-10 (31 listed: sales may not be open yet)"]);
  });

  it("goes to the timetable when Chrome is not there, or SNCF knows no such place, and says why", async () => {
    const closed = await adapterWith(days(Promise.reject(new ScrapeUnavailableError("SNCF Connect is read through Chrome, which is not reachable")))).adapter.search({ ...query, cache: memoryCache() });
    expect((closed[0].raw as { fareProblems: string[] }).fareProblems).toEqual(["sncf-connect: SNCF Connect is read through Chrome, which is not reachable"]);

    const unknown = await adapterWith(days(Promise.reject(new UnknownPlaceError("No PLACE result for: 'Paris'")))).adapter.search({ ...query, cache: memoryCache() });
    expect((unknown[0].raw as { fareProblems: string[] }).fareProblems).toEqual(['sncf-connect: knows no place called "Paris" or "Lyon"']);
  });

  it("still offers SNCF's trains when the list of stations cannot be had, without the transfers", async () => {
    const options = await adapterWith(days(), { stations: () => Promise.reject(new ScrapeError("Could not get SNCF's stations: HTTP 503")) }).adapter.search({ ...query, cache: memoryCache() });
    expect(option(options, "12:50")).toMatchObject({ priceEur: 65, lastMileEur: 0, priceKind: "live" });
    expect((options[0].raw as { fareProblems: string[] }).fareProblems).toEqual(["sncf-connect: Could not get SNCF's stations: HTTP 503"]);
  });
});
