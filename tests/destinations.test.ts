import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeoPlace } from "@/core/types";
import * as schema from "@/db/schema";
import { seedScenarioMartin } from "@/db/seed/scenario-martin";
import type { Db } from "@/db/types";
import { FieldError, NotFoundError } from "@/server/errors";
import { DestinationInputSchema, type DestinationInput } from "@/server/schemas";
import { addDestination, deleteDestination, updateDestination } from "@/server/services/destinations";
import { addGuest } from "@/server/services/guests";
import { createTrip, getTrip } from "@/server/services/trips";
import { createTestDb } from "./helpers/db";

const barcelona: GeoPlace = { label: "Barcelona, Spain", countryCode: "ES", lat: 41.3874, lon: 2.1686, airports: ["BCN", "GRO"] };
const reunion: GeoPlace = { label: "Réunion, France", countryCode: "FR", lat: -21.1309, lon: 55.5266, airports: ["ZSE", "RUN"] };
const montSaxonnex: GeoPlace = { label: "Mont-Saxonnex, France", countryCode: "FR", lat: 46.0517, lon: 6.4533, airports: ["GVA"] };

const input = (place: GeoPlace, rest: Partial<DestinationInput> = {}): DestinationInput => ({
  place,
  budgetLevel: "light",
  objective: "partying",
  ...rest,
});

let db: Db;
let close: () => void;
let tripId: string;
beforeEach(() => {
  ({ db, close } = createTestDb());
  tripId = createTrip(db).id;
});
afterEach(() => close());

describe("addDestination", () => {
  it("stores the place with its airports, budget level and objective", async () => {
    const destination = await addDestination(db, tripId, input(barcelona));
    expect(destination).toMatchObject({
      tripId, label: "Barcelona, Spain", countryCode: "ES", lat: 41.3874, lon: 2.1686,
      airports: ["BCN", "GRO"], budgetLevel: "light", objective: "partying", dateFrom: null, dateTo: null,
    });
  });

  it("stores the dates when there are some", async () => {
    const destination = await addDestination(db, tripId, input(barcelona, { dateFrom: "2027-08-26", dateTo: "2027-09-05" }));
    expect(destination).toMatchObject({ dateFrom: "2027-08-26", dateTo: "2027-09-05" });
  });

  it("flags La Réunion as outside Europe, but still adds it", async () => {
    const destination = await addDestination(db, tripId, input(reunion, { budgetLevel: "high", objective: "chill" }));
    expect(destination.inScope).toBe(false);
    expect(getTrip(db, tripId)?.destinations).toHaveLength(1);
  });

  it("keeps Barcelona and Mont-Saxonnex in scope", async () => {
    expect((await addDestination(db, tripId, input(barcelona))).inScope).toBe(true);
    expect((await addDestination(db, tripId, input(montSaxonnex))).inScope).toBe(true);
  });

  it("resolves a typed place through the geocoder when none is chosen", async () => {
    const geocode = vi.fn(async () => [barcelona]);
    const destination = await addDestination(db, tripId, { ...input(barcelona), place: undefined, query: "Barcelona" }, geocode);
    expect(geocode).toHaveBeenCalledWith("Barcelona");
    expect(destination.label).toBe("Barcelona, Spain");
  });

  it("rejects a place nothing matches, on the place field", async () => {
    const typed = { ...input(barcelona), place: undefined, query: "Zzzzz" };
    const error = await addDestination(db, tripId, typed, async () => []).catch((e) => e);
    expect(error).toBeInstanceOf(FieldError);
    expect(error.field).toBe("query");
  });

  it("rejects the same place twice in a trip, whatever the case, but not in another trip", async () => {
    await addDestination(db, tripId, input(barcelona));
    const error = await addDestination(db, tripId, input({ ...barcelona, label: "BARCELONA, SPAIN" })).catch((e) => e);
    expect(error).toBeInstanceOf(FieldError);
    expect(error.message).toMatch(/already in the list/);

    const other = createTrip(db).id;
    await expect(addDestination(db, other, input(barcelona))).resolves.toMatchObject({ label: "Barcelona, Spain" });
  });

  it("rejects an unknown trip", async () => {
    await expect(addDestination(db, "doesnotexist", input(barcelona))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("updateDestination", () => {
  it("changes only the given fields", async () => {
    const { id } = await addDestination(db, tripId, input(barcelona));
    const updated = await updateDestination(db, id, { objective: "culture" });
    expect(updated).toMatchObject({ label: "Barcelona, Spain", budgetLevel: "light", objective: "culture" });
  });

  it("moves to another place and recomputes the scope", async () => {
    const { id } = await addDestination(db, tripId, input(barcelona));
    const updated = await updateDestination(db, id, { place: reunion });
    expect(updated).toMatchObject({ label: "Réunion, France", inScope: false, airports: ["ZSE", "RUN"] });
  });

  it("sets and clears the dates", async () => {
    const { id } = await addDestination(db, tripId, input(barcelona));
    expect(await updateDestination(db, id, { dateFrom: "2027-08-26", dateTo: "2027-09-05" })).toMatchObject({ dateFrom: "2027-08-26" });
  });

  it("refuses an end date before the stored start date", async () => {
    const { id } = await addDestination(db, tripId, input(barcelona, { dateFrom: "2027-08-26", dateTo: "2027-09-05" }));
    const error = await updateDestination(db, id, { dateTo: "2027-08-01" }).catch((e) => e);
    expect(error).toBeInstanceOf(FieldError);
    expect(error.field).toBe("dateTo");
  });

  it("lets a destination keep its own name when it is patched", async () => {
    const { id } = await addDestination(db, tripId, input(barcelona));
    await expect(updateDestination(db, id, { place: barcelona })).resolves.toMatchObject({ label: "Barcelona, Spain" });
  });

  it("refuses to rename onto another destination of the trip", async () => {
    await addDestination(db, tripId, input(barcelona));
    const { id } = await addDestination(db, tripId, input(montSaxonnex));
    await expect(updateDestination(db, id, { place: barcelona })).rejects.toBeInstanceOf(FieldError);
  });

  it("returns the destination unchanged for an empty patch, and rejects an unknown one", async () => {
    const destination = await addDestination(db, tripId, input(barcelona));
    expect(await updateDestination(db, destination.id, {})).toEqual(destination);
    await expect(updateDestination(db, "doesnotexist", { objective: "chill" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleteDestination", () => {
  it("removes the destination", async () => {
    const { id } = await addDestination(db, tripId, input(barcelona));
    deleteDestination(db, id);
    expect(getTrip(db, tripId)?.destinations).toEqual([]);
  });

  it("removes what was computed for it and clears the ★ of guests who voted for it", () => {
    const seeded = seedScenarioMartin(db);
    const barcelonaId = seeded.destinationIds.barcelona;
    db.update(schema.guests).set({ favoriteDestinationId: barcelonaId }).where(eq(schema.guests.id, seeded.guestIds.martin)).run();

    deleteDestination(db, barcelonaId);

    const options = db.select().from(schema.transportOptions).where(eq(schema.transportOptions.destinationId, barcelonaId)).all();
    const stays = db.select().from(schema.stayOptions).where(eq(schema.stayOptions.destinationId, barcelonaId)).all();
    expect(options).toEqual([]);
    expect(stays).toEqual([]);
    const [martin] = db.select().from(schema.guests).where(eq(schema.guests.id, seeded.guestIds.martin)).all();
    expect(martin.favoriteDestinationId).toBeNull();
    expect(getTrip(db, seeded.tripId)?.destinations).toHaveLength(2);
  });

  it("rejects an unknown destination", () => {
    expect(() => deleteDestination(db, "doesnotexist")).toThrow(NotFoundError);
  });
});

describe("what the destination form is allowed to send", () => {
  it("accepts the three destinations of the scenario", () => {
    for (const place of [barcelona, reunion, montSaxonnex]) {
      expect(DestinationInputSchema.safeParse(input(place)).success).toBe(true);
    }
  });

  it("does not depend on the guests", async () => {
    await addGuest(db, tripId, {
      name: "Martin", homePlace: barcelona, maxBudgetEur: 800,
      availableFrom: "2027-08-26", availableTo: "2027-09-05", preferredMode: "car",
    });
    await expect(addDestination(db, tripId, input(barcelona))).resolves.toBeTruthy();
  });
});
