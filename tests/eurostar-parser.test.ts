import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

// The parser is a classic browser script (the extension loads it before site-eurostar.js): it is run here the same way
type Fare = { id: string; text: string };
type Row = { way: string; id: string; details: string; fares: Fare[]; stations: string[] };
type Page = { cities: string[]; directionText: string; dayText: string; travellersText: string; rows: Row[] };
type Offer = {
  departTime: string; arriveTime: string; departStation: string | null; arriveStation: string | null;
  durationMin: number | null; changes: number | null; trainType: string | null;
  price2ndEur: number | null; price1stEur: number | null; seatsAtPrice: number[]; rawText: string;
};
type Parsed = { direction: "out" | "back" | null; origin: string | null; destination: string | null; date: string | null; offers: Offer[]; travellers: string | null };
let parser: { parsePage(page: Page, now?: Date): Parsed; travellersOf(text: string): string | null };
beforeAll(() => {
  const context: Record<string, unknown> = {};
  vm.runInNewContext(readFileSync(path.join(process.cwd(), "extension/sncf-import/eurostar-parser.js"), "utf8"), context);
  parser = context.EurostarParser as typeof parser;
});

/**
 * What site-eurostar.js read on the real page of Paris → Londres, Friday 30 October 2026 (saved from Chrome on 2026-10-26, the 19 trains of
 * the day, 1 adult). It is the reader's own output, not a transcription: the parser gets exactly this.
 */
const PAGE: Page = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/eurostar/real-page.json"), "utf8"));
const NOW = new Date("2026-10-26T12:00:00Z");
const parse = (page: Page = PAGE, now = NOW) => parser.parsePage(page, now);
const row = (id: string): Row => PAGE.rows.find((r) => r.id.startsWith(`${id}-`))!;

describe("the real Eurostar page of Paris → Londres, 30 October (task.md T7.9, price-model.md phase 4)", () => {
  it("reads the trip, the day and the way from the page", () => {
    const page = parse();
    expect(page).toMatchObject({ direction: "out", origin: "Paris", destination: "Londres", date: "2026-10-30" });
    expect(page.offers).toHaveLength(19);
  });

  it("reads who the prices are for once, though the page writes it for a wide window and for a narrow one", () => {
    expect(PAGE.travellersText.match(/1 adulte/g)).toHaveLength(2);
    expect(parse().travellers).toBe("1 adulte");
  });

  it("reads the first train as the page shows it: times, stations, 2 h 25, direct, and the fares", () => {
    expect(parse().offers[0]).toEqual({
      departTime: "07:05",
      arriveTime: "08:30",
      departStation: "Paris Gare du Nord",
      arriveStation: "Londres St Pancras Int'l",
      durationMin: 145,
      changes: 0,
      trainType: "EUROSTAR",
      price2ndEur: 135,
      price1stEur: 180,
      // Premier says 27 places left
      seatsAtPrice: [27],
      rawText: "ES 9007 · 07:05 → 08:30 · 2 h 25 · Direct · Standard 135 € · Plus 180 € · Premier 325 € (27 places)",
    });
  });

  it("takes Standard for the second-class price and Plus, the class above, for the first-class one: Premier is neither", () => {
    const offers = parse().offers;
    // 14:31: Standard 165, Plus 280 (22 left), Premier 350
    const train = offers.find((o) => o.departTime === "14:31")!;
    expect([train.price2ndEur, train.price1stEur, train.seatsAtPrice]).toEqual([165, 280, [22]]);
    expect(train.rawText).toContain("Premier 350 €");
  });

  it("reads every train's times in order, each with the duration the page gives (not the difference of two local times)", () => {
    const offers = parse().offers;
    const times = offers.map((o) => o.departTime);
    expect(times).toEqual([...times].sort());
    // 2 h 24 to 2 h 41: the page counts the hour of difference between Paris and London
    expect(Math.min(...offers.map((o) => o.durationMin!))).toBe(144);
    expect(Math.max(...offers.map((o) => o.durationMin!))).toBe(161);
    expect(offers.every((o) => o.changes === 0 && o.trainType === "EUROSTAR")).toBe(true);
  });

  it("reads the cheapest fare of the day (115 €, tagged 'Meilleur tarif') as the price, not the tag", () => {
    const last = parse().offers.at(-1)!;
    expect([last.departTime, last.price2ndEur, last.price1stEur, last.seatsAtPrice]).toEqual(["21:02", 115, 205, [22]]);
  });

  it("every train has both prices, whole euros as the page writes them", () => {
    for (const o of parse().offers) {
      expect(Number.isInteger(o.price2ndEur)).toBe(true);
      expect(o.price1stEur).toBeGreaterThan(o.price2ndEur!);
    }
  });
});

describe("what the page may do that the saved one does not", () => {
  const first = row("9007");

  it("a fare that is sold out has no price: a train with no Standard price has no second-class price to keep", () => {
    const soldOut: Row = { ...first, fares: [{ ...first.fares[0], text: "Non disponible\n,  Départ de: 07:05, Eurostar Standard, 2 heures 25 minutes, Direct" }, first.fares[1], first.fares[2]] };
    const [offer] = parse({ ...PAGE, rows: [soldOut] }).offers;
    expect([offer.price2ndEur, offer.price1stEur]).toEqual([null, 180]);
  });

  it("finds a fare's class by its tab number when the page does not name it", () => {
    const bare: Row = { ...first, fares: first.fares.map((f) => ({ ...f, text: f.text.replace(/Eurostar \w+/, "") })) };
    const [offer] = parse({ ...PAGE, rows: [bare] }).offers;
    expect([offer.price2ndEur, offer.price1stEur]).toEqual([135, 180]);
  });

  it("reads a journey with a change as MIXED, as the app calls the ones it prices", () => {
    const changing: Row = { ...first, details: first.details.replace("Direct", "1 changement") };
    const [offer] = parse({ ...PAGE, rows: [changing] }).offers;
    expect([offer.changes, offer.trainType]).toEqual([1, "MIXED"]);
  });

  it("reads 'Dernière place restante' as one seat", () => {
    const last: Row = { ...first, fares: [{ ...first.fares[0], text: "135 €\nDernière place restante à ce prix !\n,  Départ de: 07:05, Eurostar Standard, 2 heures 25 minutes, Direct" }, first.fares[1]] };
    expect(parse({ ...PAGE, rows: [last] }).offers[0].seatsAtPrice).toEqual([1]);
  });

  it("reads the way back from the list's own name, and swaps nothing: the title of the page already says Londres → Paris", () => {
    const back = (r: Row): Row => ({ ...r, way: "search-results-inbound-item" });
    const page = parse({ ...PAGE, cities: ["Londres", "", "Paris"], directionText: "LondresParis\n(voyage retour)", rows: PAGE.rows.slice(0, 2).map(back) });
    expect(page).toMatchObject({ direction: "back", origin: "Londres", destination: "Paris", date: "2026-10-30" });
  });

  it("is for the way most of its lists are: a train already chosen, shown above the other way's list, is not one of its trains", () => {
    const chosen: Row = { ...first, way: "search-results-outbound-item" };
    const returning = (r: Row): Row => ({ ...r, way: "search-results-inbound-item" });
    const page = parse({ ...PAGE, cities: ["Londres", "", "Paris"], rows: [chosen, ...PAGE.rows.slice(1, 4).map(returning)] });
    expect(page.direction).toBe("back");
    expect(page.offers.map((o) => o.departTime)).toEqual(["07:32", "08:36", "08:58"]);
  });

  it("falls back on the page's words for the way when the rows do not say", () => {
    const plain = (r: Row): Row => ({ ...r, way: "" });
    expect(parse({ ...PAGE, directionText: "LondresParis\n(voyage retour)", rows: PAGE.rows.slice(0, 1).map(plain) }).direction).toBe("back");
    expect(parse({ ...PAGE, directionText: "ParisLondres\n(outbound journey)", rows: PAGE.rows.slice(0, 1).map(plain) }).direction).toBe("out");
    expect(parse({ ...PAGE, directionText: "", rows: PAGE.rows.slice(0, 1).map(plain) }).direction).toBeNull();
  });

  it("takes the day from the selected day's tab when the trains carry none, with the year of the next time that date comes", () => {
    const unmarked = (r: Row): Row => ({ ...r, id: "", fares: r.fares.map((f) => ({ ...f, id: "" })) });
    const page = parse({ ...PAGE, rows: PAGE.rows.slice(0, 2).map(unmarked) });
    // The times then come from the details, and the day from the tab ("vendredi 30 octobre"), on 2026-10-26
    expect(page.date).toBe("2026-10-30");
    expect(page.offers.map((o) => o.departTime)).toEqual(["07:05", "07:32"]);
    // The same date in the past is next year's
    expect(parse({ ...PAGE, rows: PAGE.rows.slice(0, 1).map(unmarked) }, new Date("2026-11-20T12:00:00Z")).date).toBe("2027-10-30");
  });

  it("keeps only the trains of the page's day: every train is stored with the one date", () => {
    const nextDay: Row = { ...first, id: first.id.replace("2026-10-30", "2026-10-31"), fares: first.fares.map((f) => ({ ...f, id: f.id.replace("2026-10-30", "2026-10-31") })) };
    const page = parse({ ...PAGE, rows: [first, nextDay, row("9009")] });
    expect(page.date).toBe("2026-10-30");
    expect(page.offers.map((o) => o.departTime)).toEqual(["07:05", "07:32"]);
  });

  it("reads nothing from a row with no times, and nothing from a page with no rows", () => {
    expect(parse({ ...PAGE, rows: [{ ...first, id: "", details: "Votre voyage" }] }).offers).toEqual([]);
    expect(parse({ ...PAGE, rows: [] })).toMatchObject({ offers: [], date: "2026-10-30" });
    expect(parse({ cities: [], directionText: "", dayText: "", travellersText: "", rows: [] })).toMatchObject({ origin: null, destination: null, date: null, direction: null, travellers: null });
  });
});

describe("who the prices are for", () => {
  it("lists every kind of traveller the page counts, each once", () => {
    expect(parser.travellersOf("2 adultes\n1 enfant\n2 adultes")).toBe("2 adultes, 1 enfant");
    expect(parser.travellersOf("Recherche\n1 adult\n1 youth")).toBe("1 adult, 1 youth");
    expect(parser.travellersOf("Paris – Londres")).toBeNull();
  });
});
