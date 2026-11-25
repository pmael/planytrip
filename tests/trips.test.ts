import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedScenarioMartin } from "@/db/seed/scenario-martin";
import type { Db } from "@/db/types";
import { TripCreateSchema, TripUpdateSchema } from "@/server/schemas";
import { createTrip, DEFAULT_TRIP_NAME, getTrip, updateTrip } from "@/server/services/trips";
import { createTestDb } from "./helpers/db";

let db: Db;
let close: () => void;

beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

describe("createTrip", () => {
  it("starts a draft trip with a default name and the whole window", () => {
    const trip = createTrip(db);
    expect(trip).toMatchObject({ name: DEFAULT_TRIP_NAME, status: "draft", nights: null });
    expect(trip.id).toMatch(/^[0-9a-z]+$/);
    expect(trip.createdAt).toBeTruthy();
  });

  it("uses the given name", () => {
    expect(createTrip(db, { name: "Summer 2027" }).name).toBe("Summer 2027");
  });

  it("gives every trip its own id", () => {
    expect(createTrip(db).id).not.toBe(createTrip(db).id);
  });
});

describe("getTrip", () => {
  it("returns a new trip with no guests, no destinations and no common window", () => {
    const { id } = createTrip(db);
    expect(getTrip(db, id)).toMatchObject({ id, guests: [], destinations: [], commonWindow: null });
  });

  it("returns null for an unknown trip", () => {
    expect(getTrip(db, "doesnotexist")).toBeNull();
  });

  it("returns the guests, the destinations and the common window of the seeded scenario", () => {
    const { tripId } = seedScenarioMartin(db);
    const trip = getTrip(db, tripId)!;
    expect(trip.guests.map((guest) => guest.name).sort()).toEqual(["Chloé", "Jessy", "Martin"]);
    expect(trip.destinations).toHaveLength(3);
    expect(trip.commonWindow).toEqual({ from: "2027-08-26", to: "2027-09-05" });
  });

  it("returns what each guest accepts, keyed by guest id", () => {
    const { tripId } = seedScenarioMartin(db);
    const trip = getTrip(db, tripId)!;
    const byName = Object.fromEntries(trip.guests.map((guest) => [guest.name, trip.guestModes[guest.id]]));
    expect(byName).toEqual({ Martin: ["car"], Chloé: ["plane"], Jessy: ["plane"] });
  });

  it("has no modes for a trip with no guests", () => {
    expect(getTrip(db, createTrip(db).id)?.guestModes).toEqual({});
  });

  it("does not mix in another trip's guests", () => {
    seedScenarioMartin(db);
    const { id } = createTrip(db);
    expect(getTrip(db, id)?.guests).toEqual([]);
  });
});

describe("updateTrip", () => {
  it("renames the trip", () => {
    const { id } = createTrip(db);
    expect(updateTrip(db, id, { name: "Renamed" })?.name).toBe("Renamed");
    expect(getTrip(db, id)?.name).toBe("Renamed");
  });

  it("sets the number of nights, then clears it back to the whole window", () => {
    const { id } = createTrip(db);
    expect(updateTrip(db, id, { nights: 7 })?.nights).toBe(7);
    expect(updateTrip(db, id, { nights: null })?.nights).toBeNull();
  });

  it("leaves what it is not given untouched", () => {
    const { id } = createTrip(db, { name: "Keep me" });
    updateTrip(db, id, { nights: 5 });
    expect(getTrip(db, id)).toMatchObject({ name: "Keep me", nights: 5 });
  });

  it("returns the trip unchanged for an empty patch", () => {
    const trip = createTrip(db);
    expect(updateTrip(db, trip.id, {})).toEqual(trip);
  });

  it("returns null for an unknown trip", () => {
    expect(updateTrip(db, "doesnotexist", { name: "x" })).toBeNull();
    expect(updateTrip(db, "doesnotexist", {})).toBeNull();
  });
});

describe("trip input schemas", () => {
  it("accepts an empty body, a name, and a null nights", () => {
    expect(TripCreateSchema.safeParse({}).success).toBe(true);
    expect(TripCreateSchema.safeParse({ name: "Summer" }).success).toBe(true);
    expect(TripUpdateSchema.safeParse({ nights: null }).success).toBe(true);
  });

  it("rejects a blank name and a non-positive or fractional number of nights", () => {
    expect(TripCreateSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(TripUpdateSchema.safeParse({ nights: 0 }).success).toBe(false);
    expect(TripUpdateSchema.safeParse({ nights: 2.5 }).success).toBe(false);
  });
});
