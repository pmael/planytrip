import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/types";
import { NotFoundError } from "@/server/errors";
import { startCompute } from "@/server/services/compute";
import { setSelection } from "@/server/services/selections";
import { getDestinationTransports, getTransportView, type TransportViewOptions } from "@/server/services/transports";
import * as schema from "@/db/schema";
import { createTestDb } from "./helpers/db";
import { enterScenario, fixtureAdapters, runUntilIdle } from "./helpers/compute";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

async function computed(options: Parameters<typeof enterScenario>[1] = {}) {
  const scenario = await enterScenario(db, options);
  startCompute(db, scenario.tripId);
  await runUntilIdle(db, fixtureAdapters());
  return scenario;
}

function transports(tripId: string, options?: TransportViewOptions) {
  const view = getTransportView(db, tripId, options);
  expect(view?.kind).toBe("ready");
  return view as Extract<NonNullable<typeof view>, { kind: "ready" }>;
}

const columnOf = (view: ReturnType<typeof transports>, mode: string) => view.columns.find((column) => column.mode === mode)!;

describe("getTransportView", () => {
  it("is not ready for a trip that was not computed, and null for an unknown one", async () => {
    const { tripId } = await enterScenario(db);
    expect(getTransportView(db, tripId)).toMatchObject({ kind: "not-ready", status: "draft" });
    expect(getTransportView(db, "doesnotexist")).toBeNull();
  });

  it("opens on the recommended destination and the first guest, with a column per accepted mode", async () => {
    const { tripId, destinations, guests } = await computed();
    const view = transports(tripId);
    expect(view.selectedId).toBe(destinations.bcn.id);
    expect(view.destinationLabel).toBe("Barcelona");
    expect(view.guestId).toBe(guests.martin.id);
    // Martin only drives
    expect(view.columns.map((column) => column.mode)).toEqual(["car"]);
    expect(view.destinations.map((d) => d.shortLabel)).toEqual(["Barcelona", "Réunion", "Mont-Saxonnex"]);
  });

  it("lists the guests with where they leave from, so the page can group those of the same place (A-S8)", async () => {
    const { tripId } = await computed();
    const view = transports(tripId);
    expect(view.guests.map((g) => [g.name, g.originKey])).toEqual([["Martin", "madrid-spain"], ["Chloé", "paris-france"], ["Jessy", "madrid-spain"]]);
    expect(view.guests[0].originLabel).toBe("Madrid");
  });

  it("prices a flight as the budget counts it: the way to the stay is in the Extra, or in the fare while the Extra does not count (task.md T8.9)", async () => {
    const { tripId, destinations, guests } = await computed();
    const flightOf = () => {
      const plane = columnOf(transports(tripId, { destinationId: destinations.ms.id, guestId: guests.chloe.id }), "plane");
      return [plane.cheapest, plane.practical, ...plane.more].find((card) => card?.provider === "easyjet")!;
    };
    // easyJet CDG→GVA, 110 €: the 50 € to the chalet are the Extra's transfer
    expect(flightOf()).toMatchObject({ costEur: 110, lastMileEur: 0 });
    db.delete(schema.destinationPrices).run();
    expect(flightOf()).toMatchObject({ costEur: 160, lastMileEur: 50 });
  });

  it("orders the columns plane before car for a guest who accepts both", async () => {
    const { tripId, guests } = await computed({ martinAcceptsPlane: true });
    expect(transports(tripId, { guestId: guests.martin.id }).columns.map((column) => column.mode)).toEqual(["plane", "car"]);
  });

  it("offers Jessy Cheapest = Vueling 70 € and Most Practical = Iberia 95 € to Barcelona (B.2)", async () => {
    const { tripId, destinations, guests } = await computed();
    const plane = columnOf(transports(tripId, { destinationId: destinations.bcn.id, guestId: guests.jessy.id }), "plane");
    expect(plane.cheapest).toMatchObject({ provider: "vueling", costEur: 70, comfort: { level: "yellow" } });
    expect(plane.practical).toMatchObject({ provider: "iberia", costEur: 95, comfort: { level: "green" } });
    expect(plane.more).toEqual([]);
  });

  it("shows the clock times coloured by how pleasant the hours are, with the date, the length and the way back", async () => {
    const { tripId, destinations, guests } = await computed();
    const plane = columnOf(transports(tripId, { destinationId: destinations.bcn.id, guestId: guests.jessy.id }), "plane");
    expect(plane.cheapest!.out).toEqual({
      date: "2027-08-26",
      departTime: "06:45",
      arriveTime: "08:00",
      departColor: "yellow",
      arriveColor: "green",
      arrivesDaysLater: 0,
      durationMin: 75,
    });
    expect(plane.practical!.out).toMatchObject({ departTime: "10:15", departColor: "green" });
    expect(plane.cheapest!.back).toMatchObject({ date: "2027-09-05", departTime: "16:00", durationMin: 75 });
  });

  it("marks an arrival on the next day", async () => {
    const { tripId, destinations, guests } = await computed();
    const view = transports(tripId, { destinationId: destinations.run.id, guestId: guests.chloe.id });
    // Air Austral ORY→RUN leaves at 22:30 and takes 11 h 05
    const direct = columnOf(view, "plane").more.concat(columnOf(view, "plane").cheapest!, columnOf(view, "plane").practical!).find((c) => c.provider === "air-austral")!;
    expect(direct.out).toMatchObject({ departTime: "22:30", arriveTime: "09:35", arrivesDaysLater: 1 });
  });

  it("gives a car no clock times: the dates come from the trip, and the figures are the driver's share", async () => {
    const { tripId, destinations } = await computed();
    const car = columnOf(transports(tripId, { destinationId: destinations.bcn.id }), "car");
    expect(car.cheapest).toMatchObject({ variant: "no_tolls", costEur: 145, comfort: { level: "yellow" } });
    expect(car.practical).toMatchObject({ variant: "tolls", costEur: 175, comfort: { level: "green" } });
    expect(car.cheapest!.out).toMatchObject({ date: "2027-08-26", departTime: null, arriveTime: null, durationMin: 375 });
    expect(car.cheapest!.back).toMatchObject({ date: "2027-09-05" });
  });

  it("colours a price against the modes the guest could take, not ones they never would", async () => {
    const { tripId, destinations, guests } = await computed();
    // Martin only drives: his 145 € is the cheap end of his car fares, whatever the flights from Madrid cost
    const car = columnOf(transports(tripId, { destinationId: destinations.bcn.id, guestId: guests.martin.id }), "car");
    expect([car.cheapest!.priceColor, car.practical!.priceColor]).toEqual(["green", "red"]);
  });

  it("keeps the 910 € flight out of Cheapest and under More with its red reasons (B-S1, B.4 #2)", async () => {
    const { tripId, destinations, guests } = await computed();
    const plane = columnOf(transports(tripId, { destinationId: destinations.run.id, guestId: guests.jessy.id }), "plane");
    expect(plane.cheapest).toMatchObject({ costEur: 1040, comfort: { level: "yellow" } });
    expect(plane.practical).toMatchObject({ costEur: 1040 });
    expect(plane.more).toHaveLength(1);
    expect(plane.more[0]).toMatchObject({ costEur: 910, stops: 3, comfort: { level: "red" } });
    expect(plane.more[0].comfort.reasons.join(" | ")).toContain("3 stops");
    expect(plane.more[0].comfort.reasons.join(" | ")).toContain("23 h 40");
  });

  it("leaves the red options out of More when asked, and filters by mode", async () => {
    const { tripId, destinations, guests } = await computed({ martinAcceptsPlane: true });
    const base = { destinationId: destinations.run.id, guestId: guests.jessy.id };
    expect(columnOf(transports(tripId, { ...base, includeRed: false }), "plane").more).toEqual([]);
    const martin = transports(tripId, { destinationId: destinations.ms.id, guestId: guests.martin.id, mode: "car" });
    expect(martin.columns.map((column) => column.mode)).toEqual(["car"]);
  });

  it("sorts More by price or by comfort, the red ones always last", async () => {
    const { tripId, destinations, guests } = await computed();
    // Two more flights for Jessy to Barcelona: Y is cheap but leaves early (yellow), X is dear but comfortable (green)
    const [vueling] = db.select().from(schema.transportOptions).all().filter(
      (o) => o.destinationId === destinations.bcn.id && o.originKey === "madrid-spain" && o.provider === "vueling",
    );
    db.insert(schema.transportOptions).values({ ...vueling, id: "extra-y", priceEur: 80, outDepartAt: "2027-08-26T06:30", outArriveAt: "2027-08-26T07:45" }).run();
    db.insert(schema.transportOptions).values({ ...vueling, id: "extra-x", priceEur: 200, outDepartAt: "2027-08-26T13:00", outArriveAt: "2027-08-26T14:15" }).run();

    const plane = (sort: "cheapest" | "practical") =>
      columnOf(transports(tripId, { destinationId: destinations.bcn.id, guestId: guests.jessy.id, sort }), "plane");
    expect(plane("cheapest").more.map((card) => card.id)).toEqual(["extra-y", "extra-x"]);
    expect(plane("practical").more.map((card) => card.id)).toEqual(["extra-x", "extra-y"]);
  });

  it("puts the red options after the others in More, whichever way it is sorted", async () => {
    const { tripId, destinations, guests } = await computed();
    const car = columnOf(transports(tripId, { destinationId: destinations.ms.id, guestId: guests.martin.id }), "car");
    // The only comfortable car option is the one with the overnight stop: it is both Cheapest and Most Practical
    expect(car.cheapest).toMatchObject({ variant: "overnight_stop" });
    expect(car.practical).toMatchObject({ variant: "overnight_stop" });
    expect(car.more.map((card) => [card.variant, card.comfort.level])).toEqual([["no_tolls", "red"], ["tolls", "red"]]);
  });

  it("flags the option the budget uses and the one the guest chose", async () => {
    const { tripId, destinations, guests } = await computed();
    const base = { destinationId: destinations.bcn.id, guestId: guests.jessy.id };
    const before = columnOf(transports(tripId, base), "plane");
    expect(before.cheapest).toMatchObject({ hearted: false, inBudget: true });
    expect(before.practical).toMatchObject({ hearted: false, inBudget: false });

    setSelection(db, destinations.bcn.id, { kind: "transport", optionId: before.practical!.id, guestId: guests.jessy.id });
    const after = columnOf(transports(tripId, base), "plane");
    expect(after.cheapest).toMatchObject({ hearted: false, inBudget: false });
    expect(after.practical).toMatchObject({ hearted: true, inBudget: true });
  });

  it("keeps one guest's ❤ off the other guests' pages (A-S7)", async () => {
    const { tripId, destinations, guests } = await computed();
    const jessy = columnOf(transports(tripId, { destinationId: destinations.bcn.id, guestId: guests.jessy.id }), "plane");
    setSelection(db, destinations.bcn.id, { kind: "transport", optionId: jessy.practical!.id, guestId: guests.jessy.id });

    const chloe = columnOf(transports(tripId, { destinationId: destinations.bcn.id, guestId: guests.chloe.id }), "plane");
    expect([chloe.cheapest, chloe.practical].some((card) => card?.hearted)).toBe(false);
    // Chloé leaves from Paris: her options are not Jessy's
    expect(chloe.cheapest).toMatchObject({ provider: "transavia", costEur: 120 });
  });

  it("falls back to the first guest and the recommended destination for ones it doesn't know", async () => {
    const { tripId, destinations, guests } = await computed();
    const view = transports(tripId, { destinationId: "nope", guestId: "nobody" });
    expect(view.selectedId).toBe(destinations.bcn.id);
    expect(view.guestId).toBe(guests.martin.id);
  });

  it("says why a guest who only drives has nothing to La Réunion, and shows the mode the budget assumes instead", async () => {
    const { tripId, destinations, guests } = await computed();
    const view = transports(tripId, { destinationId: destinations.run.id, guestId: guests.martin.id });
    expect(view.unreachable).toEqual({ reason: "no_road_route", fallbackMode: "plane" });
    expect(columnOf(view, "car")).toMatchObject({ blockedReason: "no_road_route", cheapest: null, practical: null, more: [], empty: false });
    expect(columnOf(view, "plane").cheapest).toMatchObject({ costEur: 1040, inBudget: true });
  });

  it("reports an accepted mode with no offer as empty rather than blocked", async () => {
    const { tripId, destinations, guests } = await computed({ martinAcceptsPlane: true });
    db.delete(schema.transportOptions).run();
    const view = transports(tripId, { destinationId: destinations.bcn.id, guestId: guests.martin.id });
    expect(view.columns.map((c) => [c.mode, c.empty, c.blockedReason, c.cheapest])).toEqual([
      ["plane", true, null, null],
      ["car", true, null, null],
    ]);
  });
});

describe("getDestinationTransports", () => {
  it("answers for a destination without the trip being named", async () => {
    const { destinations, guests } = await computed();
    const view = getDestinationTransports(db, destinations.bcn.id, { guestId: guests.jessy.id });
    expect(view).toMatchObject({ kind: "ready", selectedId: destinations.bcn.id, guestId: guests.jessy.id });
  });

  it("throws for a destination that does not exist, or a guest who is not on the trip", async () => {
    const { destinations } = await computed();
    expect(() => getDestinationTransports(db, "nope")).toThrow(NotFoundError);
    expect(() => getDestinationTransports(db, destinations.bcn.id, { guestId: "nobody" })).toThrow(NotFoundError);
  });
});
