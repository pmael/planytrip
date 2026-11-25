import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { createAdapterRegistry } from "@/scrapers/registry";
import { ScrapeError } from "@/scrapers/errors";
import type { TransportAdapter, TransportOptionInput, TransportQuery } from "@/scrapers/types";
import { startCompute } from "@/server/services/compute";
import { setGuestModes } from "@/server/services/guests";
import { transportRatingInputOf } from "@/server/services/ratingInputs";
import { searchTransport } from "@/server/services/search";
import { getTransportView } from "@/server/services/transports";
import { createTestDb } from "./helpers/db";
import { enterScenario, fakeRoute, fixtureAdapters, runUntilIdle } from "./helpers/compute";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

describe("createAdapterRegistry and the trains (T7.8)", () => {
  const ids = (settings: Parameters<typeof createAdapterRegistry>[0], mode: "train" | "bus") => createAdapterRegistry(settings).transportAdaptersFor(mode).map((a) => a.id);
  const base = { flights: "fixture", stays: "fixture" };

  it("searches the trains of Europe and RegioJet's for trains, and RegioJet's for buses", () => {
    expect(ids({ ...base, trains: "transitous" }, "train")).toEqual(["transitous", "regiojet"]);
    expect(ids({ ...base, trains: "transitous" }, "bus")).toEqual(["regiojet"]);
  });

  it("adds FlixBus's own journeys, with their real prices, when FlixBus is on", () => {
    expect(ids({ ...base, trains: "transitous", ground: "flixbus" }, "train")).toEqual(["transitous", "regiojet", "flixbus"]);
    expect(ids({ ...base, trains: "transitous", ground: "flixbus" }, "bus")).toEqual(["regiojet", "flixbus"]);
  });

  it("searches no train when it is switched off, and keeps FlixBus's", () => {
    expect(ids({ ...base, trains: "none" }, "train")).toEqual([]);
    expect(ids({ ...base, trains: "none", ground: "flixbus" }, "train")).toEqual(["flixbus"]);
    expect(ids(base, "train")).toEqual([]);
  });
});

/** A train source that finds the same one train for anybody, priced the way it is told to. */
function trainAdapter(id: string, over: Partial<TransportOptionInput> = {}, outDepartAt = "2026-08-26T07:37"): TransportAdapter {
  return {
    id,
    modes: ["train"],
    async search(query: TransportQuery) {
      return [
        {
          originKey: query.origin.key,
          mode: "train",
          provider: id,
          variant: "standard",
          outDepartAt,
          outArriveAt: "2026-08-26T11:48",
          backDepartAt: "2026-09-05T16:39",
          backArriveAt: "2026-09-05T20:39",
          outDurationMin: 251,
          backDurationMin: 240,
          stops: 0,
          priceEur: 126,
          priceUnit: "per_person",
          lastMileEur: 0,
          comfortScore: null,
          comfortLevel: null,
          url: "https://sncf.example/",
          ...over,
        },
      ];
    },
  };
}
const failing = (id: string): TransportAdapter => ({ id, modes: ["train"], search: async () => Promise.reject(new ScrapeError("down")) });

const trainRows = () => db.select().from(schema.transportOptions).where(eq(schema.transportOptions.mode, "train")).all();

describe("searchTransport with several train sources", () => {
  const payload = async () => {
    const { destinations } = await enterScenario(db);
    const [guest] = db.select().from(schema.guests).all();
    return { destinationId: destinations.bcn.id, originKey: guest.originKey, mode: "train" as const };
  };

  it("stores the price kind and where an estimate comes from, and a real price when the adapter does not say", async () => {
    const p = await payload();
    await searchTransport(db, p, [trainAdapter("sncf", { priceKind: "estimated", priceNote: "SNCF's published fares: 25 to 101 € one way" }), trainAdapter("regiojet", {}, "2026-08-26T09:00")]);
    const rows = trainRows();
    expect(rows.find((r) => r.provider === "sncf")).toMatchObject({ priceKind: "estimated", priceNote: "SNCF's published fares: 25 to 101 € one way" });
    expect(rows.find((r) => r.provider === "regiojet")).toMatchObject({ priceKind: "live", priceNote: null });
  });

  it("stores a sold-out train as sold out, and a train no seller spoke of as having seats; a later search with seats clears it", async () => {
    const p = await payload();
    await searchTransport(db, p, [trainAdapter("sncf", { soldOut: true, priceKind: "estimated" }), trainAdapter("regiojet", {}, "2026-08-26T09:00")]);
    expect(trainRows().find((r) => r.provider === "sncf")?.soldOut).toBe(true);
    expect(trainRows().find((r) => r.provider === "regiojet")?.soldOut).toBe(false);

    await searchTransport(db, p, [trainAdapter("sncf"), trainAdapter("regiojet", {}, "2026-08-26T09:00")]);
    expect(trainRows().find((r) => r.provider === "sncf")?.soldOut).toBe(false);
  });

  it("keeps what the working source found when another fails, removes nothing, and raises the failure", async () => {
    const p = await payload();
    await searchTransport(db, p, [trainAdapter("sncf"), trainAdapter("regiojet", {}, "2026-08-26T09:00")]);
    expect(trainRows()).toHaveLength(2);

    // RegioJet is down: SNCF's journey is refreshed, RegioJet's is not known to be gone
    await expect(searchTransport(db, p, [trainAdapter("sncf", { priceEur: 140 }), failing("regiojet")])).rejects.toThrow("down");
    const rows = trainRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.provider === "sncf")?.priceEur).toBe(140);
  });

  it("removes a journey that is no longer offered when every source answered", async () => {
    const p = await payload();
    await searchTransport(db, p, [trainAdapter("sncf"), trainAdapter("regiojet", {}, "2026-08-26T09:00")]);
    await searchTransport(db, p, [trainAdapter("sncf")]);
    expect(trainRows().map((r) => r.provider)).toEqual(["sncf"]);
  });

  it("still fails when the only source fails, as it did", async () => {
    const p = await payload();
    await expect(searchTransport(db, p, [failing("transitous")])).rejects.toThrow("down");
  });
});

describe("an estimated train price reaches the pages and the AI", () => {
  async function withTrains() {
    const scenario = await enterScenario(db);
    await setGuestModes(db, scenario.guests.martin.id, ["car", "train"], fakeRoute);
    const base = fixtureAdapters();
    const adapters = {
      ...base,
      transportAdaptersFor: (mode: Parameters<typeof base.transportAdaptersFor>[0]) =>
        mode === "train"
          ? [trainAdapter("sncf", { priceKind: "estimated", priceNote: "SNCF's published fares: 25 to 101 € one way", outDepartAt: "2027-08-26T07:37", outArriveAt: "2027-08-26T11:48", backDepartAt: "2027-09-05T16:39", backArriveAt: "2027-09-05T20:39" })]
          : base.transportAdaptersFor(mode),
    };
    startCompute(db, scenario.tripId);
    await runUntilIdle(db, adapters);
    return scenario;
  }

  it("is on the card, so that the page says the price is an estimate and why", async () => {
    const { tripId, guests } = await withTrains();
    const view = getTransportView(db, tripId, { guestId: guests.martin.id });
    expect(view?.kind).toBe("ready");
    const column = (view as Extract<NonNullable<typeof view>, { kind: "ready" }>).columns.find((c) => c.mode === "train")!;
    const card = [column.cheapest, column.practical, ...column.more].find((c) => c !== null)!;
    expect(card).toMatchObject({ mode: "train", priceKind: "estimated", priceNote: "SNCF's published fares: 25 to 101 € one way" });
  });

  it("is in what the AI is told, so that it does not lean on the price as on a fare", async () => {
    const { destinations } = await withTrains();
    const facts = transportRatingInputOf(db, destinations.bcn.id)!.facts.candidates as { mode: string; priceIsAnEstimate: string | false }[];
    expect(facts.find((f) => f.mode === "train")?.priceIsAnEstimate).toBe("SNCF's published fares: 25 to 101 € one way");
    expect(facts.filter((f) => f.mode !== "train").every((f) => f.priceIsAnEstimate === false)).toBe(true);
  });
});
