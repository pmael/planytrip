import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { limitingGuests, nightsBetween } from "@/core/dates";
import type { GeoPlace } from "@/core/types";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { FieldError, NotFoundError } from "@/server/errors";
import { GuestInputSchema, type GuestInput } from "@/server/schemas";
import { addGuest, deleteGuest, originKeyOf, setGuestModes, updateGuest } from "@/server/services/guests";
import { cellFor, NO_ROAD_ROUTE } from "@/core/reachability";
import type { LatLon, RouteFn } from "@/geo/osrm";
import { addDestination } from "@/server/services/destinations";
import { createTrip } from "@/server/services/trips";
import { createTestDb } from "./helpers/db";

const madrid: GeoPlace = { label: "Madrid, Spain", countryCode: "ES", lat: 40.4168, lon: -3.7038, airports: ["MAD"] };
const paris: GeoPlace = { label: "Paris, France", countryCode: "FR", lat: 48.8566, lon: 2.3522, airports: ["ORY", "CDG"] };

const martin: GuestInput = {
  name: "Martin", homePlace: madrid, maxBudgetEur: 800,
  availableFrom: "2027-08-26", availableTo: "2027-09-05", preferredMode: "car",
};
const chloe: GuestInput = { ...martin, name: "Chloé", homePlace: paris, maxBudgetEur: 1200, availableTo: "2027-09-14", preferredMode: "plane" };
const jessy: GuestInput = { ...martin, name: "Jessy", maxBudgetEur: 400, availableTo: "2027-09-14", preferredMode: "plane" };

let db: Db;
let close: () => void;
let tripId: string;
beforeEach(() => {
  ({ db, close } = createTestDb());
  tripId = createTrip(db).id;
});
afterEach(() => close());

const modesOf = (guestId: string) =>
  db.select().from(schema.guestModes).where(eq(schema.guestModes.guestId, guestId)).all().map((row) => row.mode);

describe("addGuest", () => {
  it("stores the guest with their city, airports and budget", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    expect(guest).toMatchObject({
      tripId, name: "Martin", homeLabel: "Madrid, Spain", homeLat: 40.4168, homeLon: -3.7038,
      homeAirports: ["MAD"], maxBudgetEur: 800, availableFrom: "2027-08-26", availableTo: "2027-09-05",
      preferredMode: "car", favoriteDestinationId: null,
    });
  });

  it("accepts the preferred mode as the first accepted mode (A-S3)", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    expect(modesOf(guest.id)).toEqual(["car"]);
  });

  it("resolves a typed city through the geocoder when no place is chosen", async () => {
    const geocode = vi.fn(async () => [madrid]);
    const { guest } = await addGuest(db, tripId, { ...martin, homePlace: undefined, homeQuery: "Madrid" }, geocode);
    expect(geocode).toHaveBeenCalledWith("Madrid");
    expect(guest.homeLabel).toBe("Madrid, Spain");
  });

  it("rejects a city nothing matches, on the city field (A-S1)", async () => {
    const typed = { ...martin, homePlace: undefined, homeQuery: "Zzzzz" };
    const error = await addGuest(db, tripId, typed, async () => []).catch((e) => e);
    expect(error).toBeInstanceOf(FieldError);
    expect(error).toMatchObject({ field: "homeQuery" });
    expect(db.select().from(schema.guests).all()).toEqual([]);
  });

  it("rejects an unknown trip", async () => {
    await expect(addGuest(db, "doesnotexist", martin)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("gives guests from the same city the same origin key, others a different one", async () => {
    const a = (await addGuest(db, tripId, martin)).guest;
    const b = (await addGuest(db, tripId, jessy)).guest;
    const c = (await addGuest(db, tripId, chloe)).guest;
    expect(a.originKey).toBe(b.originKey);
    expect(a.originKey).not.toBe(c.originKey);
    expect(a.originKey).toBe("madrid-spain");
  });

  it("only adds the guest to the trip it was given", async () => {
    const other = createTrip(db).id;
    await addGuest(db, other, martin);
    expect((await addGuest(db, tripId, jessy)).commonWindow).toEqual({ from: "2027-08-26", to: "2027-09-14" });
  });
});

describe("the common window after each addition (A-S2, A.4 #1)", () => {
  it("is the guest's own availability for the first guest", async () => {
    expect((await addGuest(db, tripId, martin)).commonWindow).toEqual({ from: "2027-08-26", to: "2027-09-05" });
  });

  it("is 26/08 → 05/09, 10 nights, limited by Martin, once the three guests are in", async () => {
    await addGuest(db, tripId, chloe);
    await addGuest(db, tripId, jessy);
    const { commonWindow, guest } = await addGuest(db, tripId, martin);
    expect(commonWindow).toEqual({ from: "2027-08-26", to: "2027-09-05" });
    expect(nightsBetween(commonWindow!)).toBe(10);
    expect(limitingGuests([guest], commonWindow!)).toEqual([]); // alone, nobody is limiting
  });

  it("is null when the new guest never overlaps with the others", async () => {
    await addGuest(db, tripId, martin);
    const { commonWindow } = await addGuest(db, tripId, { ...jessy, availableFrom: "2027-09-10", availableTo: "2027-09-14" });
    expect(commonWindow).toBeNull();
  });
});

describe("updateGuest", () => {
  it("changes only the given fields", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    const result = await updateGuest(db, guest.id, { maxBudgetEur: 900 });
    expect(result.guest).toMatchObject({ name: "Martin", maxBudgetEur: 900, availableTo: "2027-09-05" });
  });

  it("recomputes the common window", async () => {
    await addGuest(db, tripId, jessy);
    const { guest } = await addGuest(db, tripId, martin);
    const result = await updateGuest(db, guest.id, { availableTo: "2027-09-10" });
    expect(result.commonWindow).toEqual({ from: "2027-08-26", to: "2027-09-10" });
  });

  it("refuses an end date before the stored start date", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    const error = await updateGuest(db, guest.id, { availableTo: "2027-08-01" }).catch((e) => e);
    expect(error).toBeInstanceOf(FieldError);
    expect(error.field).toBe("availableTo");
  });

  it("refuses a start date after the stored end date", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    const error = await updateGuest(db, guest.id, { availableFrom: "2027-12-01" }).catch((e) => e);
    expect(error.field).toBe("availableFrom");
  });

  it("moves the guest to a new city, with its origin key and airports", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    const { guest: moved } = await updateGuest(db, guest.id, { homePlace: paris });
    expect(moved).toMatchObject({ homeLabel: "Paris, France", homeAirports: ["ORY", "CDG"], originKey: "paris-france" });
  });

  it("keeps the preferred mode among the accepted modes when it changes (A-S3)", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    await updateGuest(db, guest.id, { preferredMode: "train" });
    expect(modesOf(guest.id).sort()).toEqual(["car", "train"]);
  });

  it("returns the guest unchanged for an empty patch", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    expect((await updateGuest(db, guest.id, {})).guest).toEqual(guest);
  });

  it("rejects an unknown guest", async () => {
    await expect(updateGuest(db, "doesnotexist", { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleteGuest", () => {
  it("removes the guest and their modes, and widens the window", async () => {
    await addGuest(db, tripId, jessy);
    const { guest } = await addGuest(db, tripId, martin);
    expect(deleteGuest(db, guest.id).commonWindow).toEqual({ from: "2027-08-26", to: "2027-09-14" });
    expect(db.select().from(schema.guests).all()).toHaveLength(1);
    expect(modesOf(guest.id)).toEqual([]);
  });

  it("returns no window once the last guest is gone", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    expect(deleteGuest(db, guest.id).commonWindow).toBeNull();
  });

  it("rejects an unknown guest", () => {
    expect(() => deleteGuest(db, "doesnotexist")).toThrow(NotFoundError);
  });
});

describe("originKeyOf", () => {
  it("makes a plain slug, without accents", () => {
    expect(originKeyOf({ label: "Saint-Gilles les Bains, Réunion" })).toBe("saint-gilles-les-bains-reunion");
    expect(originKeyOf({ label: "Mont-Saxonnex, France" })).toBe("mont-saxonnex-france");
  });
});

describe("what the guest form is allowed to send (A-S1)", () => {
  it("accepts the three guests of the scenario", () => {
    for (const guest of [martin, chloe, jessy]) expect(GuestInputSchema.safeParse(guest).success).toBe(true);
  });
});

describe("setGuestModes (A-S3, A.4 #2)", () => {
  const reunion: GeoPlace = { label: "Réunion, France", countryCode: "FR", lat: -21.1309, lon: 55.5266, airports: ["RUN"] };
  const barcelona: GeoPlace = { label: "Barcelona, Spain", countryCode: "ES", lat: 41.3874, lon: 2.1686, airports: ["BCN"] };
  // Finds a road to Barcelona and none to the island, like the real router
  const route: RouteFn = vi.fn(async (_from: LatLon, to: LatLon) => (to.lat < 0 ? null : { distanceKm: 618, durationMin: 411 }));

  it("replaces the accepted modes", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    const result = await setGuestModes(db, guest.id, ["car", "train"], route);
    expect(result.modes.sort()).toEqual(["car", "train"]);
    expect(modesOf(guest.id).sort()).toEqual(["car", "train"]);
  });

  it("keeps the preferred mode even when it is left out", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    const result = await setGuestModes(db, guest.id, ["plane"], route);
    expect(result.modes.sort()).toEqual(["car", "plane"]);
  });

  it("ignores duplicates", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    expect((await setGuestModes(db, guest.id, ["car", "car", "plane", "plane"], route)).modes.sort()).toEqual(["car", "plane"]);
  });

  it("blocks Martin from La Réunion by car, and adding the plane turns the cell ok", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    const run = await addDestination(db, tripId, { place: reunion, budgetLevel: "high", objective: "chill" });
    await addDestination(db, tripId, { place: barcelona, budgetLevel: "light", objective: "partying" });

    const before = await setGuestModes(db, guest.id, ["car"], route);
    expect(cellFor(before.matrix, guest.id, run.id)).toMatchObject({ status: "blocked", reason: NO_ROAD_ROUTE, fallback: "plane" });

    const after = await setGuestModes(db, guest.id, ["car", "plane"], route);
    expect(cellFor(after.matrix, guest.id, run.id)?.status).toBe("ok");

    // and taking it away again blocks him again
    const removed = await setGuestModes(db, guest.id, ["car"], route);
    expect(cellFor(removed.matrix, guest.id, run.id)?.status).toBe("blocked");
  });

  it("only asks the router what it does not know yet", async () => {
    const { guest } = await addGuest(db, tripId, martin);
    await addDestination(db, tripId, { place: barcelona, budgetLevel: "light", objective: "partying" });
    const counted = vi.fn(route);
    await setGuestModes(db, guest.id, ["car"], counted);
    await setGuestModes(db, guest.id, ["car", "plane"], counted);
    expect(counted).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown guest", async () => {
    await expect(setGuestModes(db, "doesnotexist", ["car"], route)).rejects.toBeInstanceOf(NotFoundError);
  });
});
