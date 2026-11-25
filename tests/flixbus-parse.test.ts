import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ScrapeChangedError } from "@/scrapers/errors";
import { parseCities, parseRides } from "@/scrapers/transport/flixbus-parse";

const fixture = (name: string) => JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/flixbus", name), "utf8"));

describe("parseCities", () => {
  it("reads the cities an autocomplete lists, with where they are", () => {
    const cities = parseCities(fixture("cities-toulouse.json"));
    expect(cities[0]).toMatchObject({ id: "40dfd612-8646-11e6-9066-549f350fcb0c", name: "Toulouse" });
    expect(cities[0].lat).toBeCloseTo(43.61, 1);
    expect(cities.map((c) => c.name)).toContain("Tolosa");
  });

  it("skips what is not a city, and says the site changed when it is not a list at all", () => {
    expect(parseCities([{ nope: true }])).toEqual([]);
    expect(() => parseCities({ errors: [] })).toThrow(ScrapeChangedError);
  });
});

describe("parseRides: Toulouse → Madrid on 22 December 2026", () => {
  const rides = parseRides(fixture("tls-mad-2026-12-22.json"));

  it("reads each ride: local times, how long, what it costs one person, and the vehicles", () => {
    expect(rides).toHaveLength(4);
    const direct = rides.find((r) => r.departAt === "2026-12-22T23:05" && r.legs.length === 1)!;
    expect(direct).toMatchObject({ arriveAt: "2026-12-23T08:40", durationMin: 575, priceEur: 61, legs: ["bus"] });
  });

  it("tells buses from trains leg by leg", () => {
    expect(rides.map((r) => r.legs.join("+")).sort()).toEqual(["bus", "bus+bus", "bus+bus+train", "bus+train"]);
  });

  it("counts the fee FlixBus adds at the checkout in the price", () => {
    // The ticket is 59.99 €, 61 € with the platform fee
    expect(rides.find((r) => r.legs.join() === "bus")!.priceEur).toBe(61);
  });
});

describe("parseRides: what is not a list of rides", () => {
  it("gives none for a day with no ride", () => {
    expect(parseRides({ trips: [{ results: {} }] })).toEqual([]);
  });

  it("leaves out a ride that cannot be bought and one it cannot read", () => {
    const ride = (status: string) => ({ status, departure: { date: "2026-12-22T09:00:00+01:00" }, arrival: { date: "2026-12-22T11:00:00+01:00" }, duration: { hours: 2, minutes: 0 }, price: { total: 10 }, legs: [{ means_of_transport: "bus" }] });
    expect(parseRides({ trips: [{ results: { a: ride("sold_out"), b: ride("available"), c: { status: "available" } } }] })).toHaveLength(1);
  });

  it("says the site changed when the answer is not a search at all", () => {
    expect(() => parseRides({ code: 400, message: "To city id was not found!" })).toThrow(ScrapeChangedError);
  });
});
