import { describe, expect, it, vi } from "vitest";
import { baselineEstimate, methodLabel, optionRaw, rangeCarrierOf, sameTrain, trainTypeOfLegs, type OptionWay } from "@/core/priceObservations";
import { sameStation, stationKey } from "@/core/stations";
import { agoText, observedText } from "@/lib/priceText";
import { ScrapeChangedError } from "@/scrapers/errors";
import type { Http } from "@/scrapers/http";
import { createStationLocator } from "@/scrapers/transport/transitous";
import { memoryCache } from "./helpers/trains";

describe("sameStation (T7.9)", () => {
  it("is the same station written another way: case, accents, hyphens, a hall", () => {
    expect(sameStation("Lyon Part Dieu", "LYON PART DIEU")).toBe(true);
    expect(sameStation("Lyon Part-Dieu", "Lyon Part Dieu")).toBe(true);
    expect(sameStation("Lyon Saint-Exupery TGV", "Lyon Saint-Exupéry TGV")).toBe(true);
    expect(sameStation("Paris Gare de Lyon", "Paris Gare de Lyon Hall 1 - 2")).toBe(true);
  });

  it("is the city for any of its stations, but a station is not another", () => {
    expect(sameStation("Toulouse", "Toulouse Matabiau")).toBe(true);
    expect(sameStation("Lyon Part Dieu", "Lyon")).toBe(true);
    expect(sameStation("Lyon Part Dieu", "Lyon Perrache")).toBe(false);
    expect(sameStation("Lyon Part Dieu", "Lyon Saint-Exupery TGV")).toBe(false);
  });

  it("does not take a part of a word for a name, nor an empty name for any", () => {
    expect(sameStation("Nîmes", "Nîmes Centre")).toBe(true);
    expect(sameStation("Lyon", "Lyonnais Gare")).toBe(false);
    expect(sameStation("", "Lyon")).toBe(false);
    expect(sameStation("", "")).toBe(false);
  });

  it("keeps the key it always had", () => {
    expect(stationKey("PARIS GARE DE LYON Hall 1 - 2")).toBe("PARIS GARE DE LYON");
  });

  it("is the same station as Eurostar's and Iryo's pages spell it (phase 4 of price-model.md)", () => {
    expect(sameStation("Londres St Pancras Int'l", "London St Pancras International")).toBe(true);
    expect(sameStation("London St Pancras Int'l", "London St Pancras International")).toBe(true);
    expect(sameStation("Paris Gare du Nord", "Paris Gare du Nord")).toBe(true);
    expect(sameStation("Madrid-Chamartin", "Madrid Chamartín-Clara Campoamor")).toBe(true);
    expect(sameStation("Valencia-Joaquín Sorolla", "València Joaquín Sorolla")).toBe(true);
    expect(sameStation("Londres St Pancras Int'l", "Paris Gare du Nord")).toBe(false);
    expect(sameStation("Madrid-Chamartin", "Madrid Puerta de Atocha")).toBe(false);
    expect(stationKey("Londres St Pancras Int'l")).toBe("LONDON ST PANCRAS INTERNATIONAL");
  });
});

describe("sameTrain", () => {
  const way: OptionWay = { departAt: "2026-12-04T07:37", from: "Toulouse Matabiau", to: "Lyon Part Dieu" };
  const seen = { travelDate: "2026-12-04", departTime: "07:37", departStation: "Toulouse Matabiau", arriveStation: "Lyon Part Dieu" };

  it("is the same day, the same minute and the same stations", () => {
    expect(sameTrain(seen, way, 2)).toBe(true);
  });

  it("allows the minutes the page and the timetable may differ by, and no more", () => {
    expect(sameTrain({ ...seen, departTime: "07:39" }, way, 2)).toBe(true);
    expect(sameTrain({ ...seen, departTime: "07:35" }, way, 2)).toBe(true);
    expect(sameTrain({ ...seen, departTime: "07:40" }, way, 2)).toBe(false);
  });

  it("is not another day's train at the same hour, nor another route's", () => {
    expect(sameTrain({ ...seen, travelDate: "2026-12-05" }, way, 2)).toBe(false);
    expect(sameTrain({ ...seen, arriveStation: "Lyon Perrache" }, way, 2)).toBe(false);
    expect(sameTrain({ ...seen, departStation: "Montpellier" }, way, 2)).toBe(false);
  });

  it("checks only the stations the page gave, and needs one", () => {
    expect(sameTrain({ ...seen, arriveStation: "" }, way, 2)).toBe(true);
    expect(sameTrain({ ...seen, departStation: "" }, way, 2)).toBe(true);
    expect(sameTrain({ ...seen, departStation: "", arriveStation: "" }, way, 2)).toBe(false);
  });
});

describe("optionRaw", () => {
  const leg = (from: string, to: string, departAt: string, lat = 45, lon = 4) => ({ from: { name: from, lat, lon }, to: { name: to, lat: lat + 1, lon: lon + 1 }, departAt, arriveAt: departAt, train: "TGV INOUI 1", operator: "SNCF", mode: "HIGHSPEED_RAIL" });
  const price = (priceEur: number) => ({ priceEur, kind: "estimated", note: "a range", source: "sncf-fares", link: "x" });

  it("reads each way of a train option: where it starts and ends, and its price", () => {
    const raw = optionRaw(JSON.stringify({ source: "transitous", out: { legs: [leg("A", "B", "2026-12-04T07:37"), leg("B", "C", "2026-12-04T10:00")], price: price(63) }, back: { legs: [leg("C", "A", "2026-12-06T16:39")], price: price(60) } }))!;
    expect(raw.out).toEqual({
      way: { departAt: "2026-12-04T07:37", from: "A", to: "C", fromPoint: { lat: 45, lon: 4 }, toPoint: { lat: 46, lon: 5 } },
      price: { priceEur: 63, kind: "estimated", note: "a range", source: "sncf-fares" },
    });
    expect(raw.back!.way).toMatchObject({ departAt: "2026-12-06T16:39", from: "C", to: "A" });
  });

  it("has nothing for an option that kept no trains: a bus, an old option, a search that wrote nothing", () => {
    expect(optionRaw(null)).toBeNull();
    expect(optionRaw("not json")).toBeNull();
    expect(optionRaw(JSON.stringify({ source: "flixbus", out: { legs: ["train"], priceEur: 20 } }))).toBeNull();
    expect(optionRaw(JSON.stringify({ source: "x" }))).toBeNull();
  });
});

describe("baselineEstimate", () => {
  const perKm = { eurPerKm: 0.15, minEur: 9 };
  it("estimates by the kilometre, with a least price", () => {
    expect(baselineEstimate("per_km", { distanceKm: 360, rangeMinEur: null, rangeMaxEur: null }, perKm)).toBeCloseTo(54);
    expect(baselineEstimate("per_km", { distanceKm: 10, rangeMinEur: null, rangeMaxEur: null }, perKm)).toBe(9);
    expect(baselineEstimate("per_km", { distanceKm: null, rangeMinEur: null, rangeMaxEur: null }, perKm)).toBeNull();
  });

  it("estimates by the middle or the top of SNCF's range", () => {
    expect(baselineEstimate("range_mid", { distanceKm: null, rangeMinEur: 25.5, rangeMaxEur: 101 }, perKm)).toBe(63.25);
    expect(baselineEstimate("range_max", { distanceKm: null, rangeMinEur: 25.5, rangeMaxEur: 101 }, perKm)).toBe(101);
    expect(baselineEstimate("range_mid", { distanceKm: 360, rangeMinEur: null, rangeMaxEur: null }, perKm)).toBeNull();
    expect(baselineEstimate("range_max", { distanceKm: 360, rangeMinEur: null, rangeMaxEur: null }, perKm)).toBeNull();
  });

  it("names a method with its rate", () => {
    expect(methodLabel("per_km", perKm)).toBe("per_km_0.15");
    expect(methodLabel("range_mid", perKm)).toBe("range_mid");
  });
});

describe("the trains in the page's words", () => {
  it("names the type of a journey of the timetable as the extension names the page's", () => {
    expect(trainTypeOfLegs([{ train: "TGV INOUI 6871" }])).toBe("TGV INOUI");
    expect(trainTypeOfLegs([{ train: "OUIGO 7803" }])).toBe("OUIGO");
    expect(trainTypeOfLegs([{ train: "IC 4758" }])).toBe("INTERCITES");
    expect(trainTypeOfLegs([{ train: "TER 876256" }])).toBe("TER");
    expect(trainTypeOfLegs([{ train: "TGV Lyria 9203" }])).toBe("TGV LYRIA");
    expect(trainTypeOfLegs([{ train: "RJ 53" }])).toBeNull();
  });

  it("calls a journey with changes MIXED, whatever its trains are", () => {
    expect(trainTypeOfLegs([{ train: "TGV INOUI 1" }, { train: "TER 2" }])).toBe("MIXED");
    expect(trainTypeOfLegs([{ train: "TGV INOUI 1" }, { train: "TGV INOUI 2" }])).toBe("MIXED");
  });

  it("has a range only for a direct TGV INOUI or OUIGO", () => {
    expect(rangeCarrierOf("TGV INOUI", 0)).toBe("TGV INOUI");
    expect(rangeCarrierOf("OUIGO", 0)).toBe("OUIGO");
    expect(rangeCarrierOf("TGV INOUI", 1)).toBeNull();
    expect(rangeCarrierOf("TGV INOUI", null)).toBeNull();
    expect(rangeCarrierOf("TER", 0)).toBeNull();
    expect(rangeCarrierOf(null, 0)).toBeNull();
  });
});

describe("how long ago, in French", () => {
  const now = new Date("2026-10-24T19:40:00.000Z");
  const ago = (minutes: number) => agoText(new Date(now.getTime() - minutes * 60_000).toISOString(), now);

  it("says it in minutes, hours and days", () => {
    expect(ago(0)).toBe("à l'instant");
    expect(ago(12)).toBe("il y a 12 min");
    expect(ago(59)).toBe("il y a 59 min");
    expect(ago(60)).toBe("il y a 1 h");
    expect(ago(130)).toBe("il y a 2 h");
    expect(ago(60 * 47)).toBe("il y a 47 h");
    expect(ago(60 * 24 * 3)).toBe("il y a 3 j");
  });

  it("does not say a time in the future", () => {
    expect(agoText("2026-10-24T20:00:00.000Z", now)).toBe("à l'instant");
  });

  it("writes the label of a price seen on a page", () => {
    expect(observedText("sncf-connect", "2026-10-24T17:40:00.000Z", now)).toBe("vu sur SNCF Connect il y a 2 h");
  });
});

describe("createStationLocator", () => {
  const answer = [
    { name: "Gare de Lyon", lat: 48.845, lon: 2.375, modes: ["REGIONAL_RAIL", "SUBWAY"] },
    { name: "Lyon Part Dieu", lat: 45.76, lon: 4.86, modes: ["HIGHSPEED_RAIL", "BUS"] },
    { name: "Lyon Part-Dieu Vivier Merle", lat: 45.76, lon: 4.86, modes: ["BUS"] },
  ];
  const http = (value: unknown = answer): Http & { getJson: ReturnType<typeof vi.fn> } => ({ getJson: vi.fn(async () => value), postJson: vi.fn() }) as never;

  it("finds the stop of that name that trains call at", async () => {
    const h = http();
    expect(await createStationLocator({ http: h })("Lyon Part Dieu")).toEqual({ lat: 45.76, lon: 4.86 });
    const url = new URL(h.getJson.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/v1/geocode");
    expect(url.searchParams.get("text")).toBe("Lyon Part Dieu");
    expect(url.searchParams.get("type")).toBe("STOP");
  });

  it("does not take a bus stop of the same name, nor another station", async () => {
    expect(await createStationLocator({ http: http([answer[2]]) })("Lyon Part Dieu")).toBeNull();
    expect(await createStationLocator({ http: http([answer[0]]) })("Lyon Part Dieu")).toBeNull();
  });

  it("keeps a place it found for a month, and does not keep that it found nothing", async () => {
    const h = http();
    const cache = memoryCache();
    const locate = createStationLocator({ http: h, cache });
    await locate("Lyon Part Dieu");
    await locate("Lyon Part-Dieu");
    expect(h.getJson).toHaveBeenCalledTimes(1);

    const none = http([]);
    const again = createStationLocator({ http: none, cache: memoryCache() });
    await again("Nowhere");
    await again("Nowhere");
    expect(none.getJson).toHaveBeenCalledTimes(2);
  });

  it("fails when the answer is not a list of stops", async () => {
    await expect(createStationLocator({ http: http({ nope: 1 }) })("Lyon Part Dieu")).rejects.toBeInstanceOf(ScrapeChangedError);
  });
});
