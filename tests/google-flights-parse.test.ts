import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ScrapeChangedError } from "@/scrapers/errors";
import { parseFlightLabels, parseShoppingResults } from "@/scrapers/transport/google-flights-parse";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests/fixtures/google-flights", name), "utf8");

describe("parseShoppingResults: the outbound flights Toulouse → Madrid on 22 December 2026", () => {
  const flights = parseShoppingResults(fixture("tls-mad-outbound.txt"));

  it("reads Google's best flights first, then the others", () => {
    expect(flights).toHaveLength(8);
    expect(flights.map((f) => f.top)).toEqual([true, true, true, true, false, false, false, false]);
    expect(flights.map((f) => f.priceEur)).toEqual([146, 174, 199, 246, 247, 420, 626, 769]);
  });

  it("reads a nonstop flight: who flies it, when it leaves and lands (local times), how long", () => {
    expect(flights[0]).toMatchObject({
      airlines: ["Volotea"],
      durationMin: 90,
      legs: [{ from: "TLS", to: "MAD", departAt: "2026-12-22T20:00", arriveAt: "2026-12-22T21:30", durationMin: 90, flightNumber: "V72370" }],
    });
    // 6:00 AM and 7:25 AM: a time with its minutes
    expect(flights[1].legs[0]).toMatchObject({ departAt: "2026-12-22T06:00", arriveAt: "2026-12-22T07:25" });
  });

  it("reads every flight of a journey with a stop, and the total time layover included", () => {
    const viaLisbon = flights[4];
    expect(viaLisbon.legs.map((leg) => [leg.from, leg.to])).toEqual([["TLS", "LIS"], ["LIS", "MAD"]]);
    expect(viaLisbon.durationMin).toBe(855);
    expect(viaLisbon.legs[0].departAt).toBe("2026-12-22T06:05");
    expect(viaLisbon.legs[1].arriveAt).toBe("2026-12-22T20:20");
  });
});

describe("parseShoppingResults: the flights back, once an outbound is chosen", () => {
  it("reads the return flights with what the whole trip costs with each", () => {
    const flights = parseShoppingResults(fixture("mad-tls-returns.txt"));
    expect(flights.map((f) => [f.legs[0].departAt, f.priceEur])).toEqual([
      ["2026-12-26T19:40", 174],
      ["2026-12-26T07:10", 181],
      ["2026-12-26T15:40", 215],
      ["2026-12-26T10:25", 1196],
    ]);
    expect(flights[0].legs[0]).toMatchObject({ from: "MAD", to: "TLS", arriveAt: "2026-12-26T21:05" });
  });
});

describe("parseShoppingResults: what is not an answer", () => {
  it("says the site changed when the text holds nothing it knows", () => {
    expect(() => parseShoppingResults("<html>Before you continue</html>")).toThrow(ScrapeChangedError);
    expect(() => parseShoppingResults("")).toThrow(ScrapeChangedError);
  });

  it("gives no flights for an answer that has none", () => {
    const empty = `)]}'\n\n20\n[["wrb.fr",null,"[null,null,null,null]"]]\n`;
    expect(parseShoppingResults(empty)).toEqual([]);
  });

  it("skips a flight it cannot read rather than guess at it", () => {
    const broken = `)]}'\n\n${JSON.stringify([["wrb.fr", null, JSON.stringify([null, null, [[[[["V7"], ["Volotea"], [["junk"]]], [null, 99]]]]])]])}\n`;
    expect(parseShoppingResults(broken)).toEqual([]);
  });
});

describe("parseFlightLabels: the flights as the page writes them", () => {
  const nonstop = "From 146 euros round trip total.This price does not include overhead bin access. Nonstop flight with Volotea. Leaves Toulouse-Blagnac Airport at 8:00 PM on Tuesday, December 22 and arrives at Adolfo Suárez Madrid-Barajas Airport at 9:30 PM on Tuesday, December 22. Total duration 1 hr 30 min.   Select flight";
  const operated = "From 174 euros round trip total. Nonstop flight with Iberia. Operated by Air Nostrum for Iberia. Leaves Toulouse-Blagnac Airport at 6:00 AM on Tuesday, December 22 and arrives at Adolfo Suárez Madrid-Barajas Airport at 7:25 AM on Tuesday, December 22. Total duration 1 hr 25 min.   Select flight";
  const overnight = "From 1,420 euros round trip total. 2 stops flight with Air France. Leaves Geneva Airport at 11:45 PM on Tuesday, December 22 and arrives at Prague Airport at 12:10 PM on Wednesday, December 23. Total duration 12 hr 25 min.   Select flight";

  it("reads the price, the airline, the stops, the local times and the duration", () => {
    const [volotea, iberia] = parseFlightLabels([nonstop, operated], ["TLS", "MAD"], "2026-12-22");
    expect(volotea).toMatchObject({ airlines: ["Volotea"], priceEur: 146, stops: 0, durationMin: 90, top: true });
    expect(volotea.legs[0]).toMatchObject({ from: "TLS", to: "MAD", departAt: "2026-12-22T20:00", arriveAt: "2026-12-22T21:30" });
    expect(iberia).toMatchObject({ airlines: ["Iberia"], priceEur: 174, durationMin: 85 });
    expect(iberia.legs[0]).toMatchObject({ departAt: "2026-12-22T06:00", arriveAt: "2026-12-22T07:25" });
  });

  it("reads a journey that lands the next day, a thousand euros and several stops", () => {
    const [flight] = parseFlightLabels([overnight], ["GVA", "PRG"], "2026-12-22");
    expect(flight).toMatchObject({ priceEur: 1420, stops: 2, durationMin: 745 });
    expect(flight.legs[0]).toMatchObject({ departAt: "2026-12-22T23:45", arriveAt: "2026-12-23T12:10" });
  });

  it("puts a stay that begins at the end of the year in the right year", () => {
    const label = "From 99 euros round trip total. Nonstop flight with X. Leaves A Airport at 9:00 AM on Friday, January 1 and arrives at B Airport at 10:00 AM on Friday, January 1. Total duration 1 hr.   Select flight";
    expect(parseFlightLabels([label], ["A", "B"], "2026-12-30")[0].legs[0].departAt).toBe("2027-01-01T09:00");
  });

  it("reads the labels as Google really writes them: narrow no-break spaces in the times, accents in the airports, a layover note", () => {
    const real = "From 173 euros round trip total. 1 stop flight with Lufthansa. Leaves Geneva Airport at 1:20\u202fPM on Tuesday, December 8 and arrives at Letišt\u011b V\u00e1clava Havla Praha at 4:05\u202fPM on Tuesday, December 8. Total duration 2 hr 45 min.  Layover (1 of 1) is a 45 min layover at Munich International Airport in Munich. Select flight";
    const [flight] = parseFlightLabels([real], ["GVA", "PRG"], "2026-12-08");
    expect(flight).toMatchObject({ airlines: ["Lufthansa"], priceEur: 173, stops: 1, durationMin: 165 });
    expect(flight.legs[0]).toMatchObject({ departAt: "2026-12-08T13:20", arriveAt: "2026-12-08T16:05" });
  });

  it("skips a label it cannot read", () => {
    expect(parseFlightLabels(["Sponsored", "From 99 euros"], ["A", "B"], "2026-12-22")).toEqual([]);
  });
});
