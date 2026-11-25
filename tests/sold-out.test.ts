import { describe, expect, it, vi } from "vitest";
import { rateTransportByRules } from "@/core/ratings";
import { pickCheapest, pickMostPractical } from "@/core/scenario";
import type { TransportOption } from "@/core/types";
import type { FareQuote, FareSource, SoldOut, TrainJourney } from "@/scrapers/transport/train-types";
import type { Timetable } from "@/scrapers/transport/transitous";
import { createTrainsAdapter } from "@/scrapers/transport/trains";
import { journey, memoryCache } from "./helpers/trains";

/** Just the parts of an option the picks look at. */
const option = (id: string, priceEur: number, over: Partial<TransportOption> = {}) =>
  ({ id, priceEur, priceUnit: "per_person", lastMileEur: 0, comfortLevel: "green", comfortScore: 80, rating: null, soldOut: false, ...over }) as TransportOption;

describe("the picks leave sold-out trains out", () => {
  it("does not take the cheapest when it is sold out (R3)", () => {
    expect(pickCheapest([option("full", 40, { soldOut: true }), option("seats", 90)])?.id).toBe("seats");
  });

  it("does not take the most practical when it is sold out (B-S2)", () => {
    expect(pickMostPractical([option("full", 90, { soldOut: true, comfortScore: 99 }), option("seats", 90, { comfortScore: 60 })])?.id).toBe("seats");
  });

  it("still picks one when every option is sold out: there is nothing else to show the trip's cost with", () => {
    expect(pickCheapest([option("a", 120, { soldOut: true }), option("b", 80, { soldOut: true })])?.id).toBe("b");
    expect(pickMostPractical([option("a", 120, { soldOut: true })])?.id).toBe("a");
  });
});

describe("the rules rate a sold-out train as unusable", () => {
  const input = { costEur: 60, budgets: [{ name: "Chloé", maxBudgetEur: 500 }], comfort: { level: "green" as const, score: 90, reasons: [] } };

  it("is bad, whatever its price and comfort, and says why", () => {
    const fine = rateTransportByRules(input);
    const full = rateTransportByRules({ ...input, soldOut: true });
    expect(fine.verdict).not.toBe("bad");
    expect(full.verdict).toBe("bad");
    expect(full.score).toBeLessThan(fine.score);
    expect(full.reason).toBe("Rules only: sold out, no seat is left to book");
  });
});

describe("the trains adapter with a seller that says a train is full", () => {
  const now = () => new Date("2026-10-24T10:00:00Z");
  const query = {
    mode: "train" as const,
    origin: { key: "toulouse-france", label: "Toulouse, France", lat: 43.6047, lon: 1.4442, airports: ["TLS"] },
    destination: { id: "d", label: "Lyon, France", lat: 45.764, lon: 4.8357, airports: ["LYS"] },
    window: { from: "2026-12-04", to: "2026-12-06" },
  };
  const there = journey();
  const back = (departAt: string, arriveAt: string) =>
    journey({
      from: { name: "Lyon Part Dieu", lat: 45.7606, lon: 4.8594 },
      to: { name: "Toulouse Matabiau", lat: 43.6112, lon: 1.4536 },
      departAt: `2026-12-06T${departAt}`,
      arriveAt: `2026-12-06T${arriveAt}`,
    });
  const timetableOf = (backs: TrainJourney[]) => ({ journeys: vi.fn<Timetable["journeys"]>(async (_from, _to, day) => (day === "2026-12-04" ? [there] : backs)) }) as Timetable;

  const live = (priceEur: number): FareQuote => ({ priceEur, kind: "live", note: null, source: "sncf-connect", link: "https://sncf.example/" });
  const FULL: SoldOut = { soldOut: true, source: "sncf-connect" };
  /** The seller: full for the journeys leaving at these times, else the price given */
  const seller = (full: string[], price = 49): FareSource => ({ id: "sncf-connect", quote: async (js) => js.map((j) => (full.includes(j.departAt.slice(11)) ? FULL : live(price))) });
  const range: FareSource<FareQuote> = { id: "sncf-fares", quote: async (js) => js.map(() => ({ priceEur: 63, kind: "estimated", note: "SNCF's published fares for this route: 26 to 101 € one way", source: "sncf-fares", link: "https://sncf.example/" })) };

  it("keeps a full way there, priced by the next source as an estimate, and marks it sold out", async () => {
    const adapter = createTrainsAdapter({ timetable: timetableOf([back("16:39", "20:39")]), fares: [seller(["07:37"]), range], now });
    const [option] = await adapter.search({ ...query, cache: memoryCache() });
    expect(option.soldOut).toBe(true);
    expect(option.priceEur).toBe(63 + 49);
    expect(option.priceKind).toBe("estimated");
    expect(option.priceNote).toBe("SNCF's published fares for this route: 26 to 101 € one way");
  });

  it("pairs the way there with a way back that has seats, even a dearer one", async () => {
    const adapter = createTrainsAdapter({
      timetable: timetableOf([back("16:39", "20:39"), back("18:00", "22:00")]),
      fares: [{ id: "sncf-connect", quote: async (js) => js.map((j) => (j.departAt.endsWith("16:39") ? FULL : live(j.departAt.endsWith("18:00") ? 80 : 49))) }, range],
      now,
    });
    const [option] = await adapter.search({ ...query, cache: memoryCache() });
    expect(option.backDepartAt).toBe("2026-12-06T18:00");
    expect(option.soldOut).toBe(false);
    expect(option.priceEur).toBe(49 + 80);
    expect(option.priceKind).toBe("live");
  });

  it("marks the trip sold out when every way back is full", async () => {
    const adapter = createTrainsAdapter({ timetable: timetableOf([back("16:39", "20:39")]), fares: [seller(["16:39"]), range], now });
    const [option] = await adapter.search({ ...query, cache: memoryCache() });
    expect(option.soldOut).toBe(true);
    expect(option.priceEur).toBe(49 + 63);
  });

  it("says nothing of seats when no seller knows: the option is not sold out", async () => {
    const adapter = createTrainsAdapter({ timetable: timetableOf([back("16:39", "20:39")]), fares: [range], now });
    const [option] = await adapter.search({ ...query, cache: memoryCache() });
    expect(option.soldOut).toBe(false);
  });
});
