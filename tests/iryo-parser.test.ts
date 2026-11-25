import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

// The parser is a classic browser script (the extension loads it before site-iryo.js): it is run here the same way
type Cell = { id: string; paid: string; original: string; text: string };
type Row = { id: string; originStation: string; destinationStation: string; duration: string; times: string[]; text: string; cells: Cell[] };
type Page = {
  active: number; tabs: { date: string }[]; cities: string; stations: string; travellersText: string;
  addressDates: { outbound?: string; inbound?: string }; columns: string[]; rows: Row[];
};
type Offer = {
  departTime: string; arriveTime: string; departStation: string | null; arriveStation: string | null;
  durationMin: number | null; changes: number | null; trainType: string | null;
  price2ndEur: number | null; price1stEur: number | null; seatsAtPrice: number[]; rawText: string;
};
type Parsed = { direction: "out" | "back" | null; origin: string | null; destination: string | null; date: string | null; offers: Offer[]; travellers: string | null };
let parser: { parsePage(page: Page, now?: Date): Parsed };
beforeAll(() => {
  const context: Record<string, unknown> = {};
  vm.runInNewContext(readFileSync(path.join(process.cwd(), "extension/sncf-import/iryo-parser.js"), "utf8"), context);
  parser = context.IryoParser as typeof parser;
});

/**
 * What site-iryo.js read on the real page of Madrid → Valencia, Saturday 31 October 2026 (saved from Chrome on 2026-10-26, the 7 trains of
 * the day, 1 adult). It is the reader's own output, not a transcription: the parser gets exactly this.
 */
const PAGE: Page = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/iryo/real-page.json"), "utf8"));
const NOW = new Date("2026-10-26T12:00:00Z");
const parse = (page: Page = PAGE, now = NOW) => parser.parsePage(page, now);

describe("the real Iryo page of Madrid → Valencia, 31 October (task.md T7.9, price-model.md phase 4)", () => {
  it("reads the trip, the day and the way from the page", () => {
    const page = parse();
    expect(page).toMatchObject({ direction: "out", origin: "Madrid", destination: "Valencia", date: "2026-10-31", travellers: "1 adulto" });
    expect(page.offers).toHaveLength(7);
  });

  it("reads the first train: the price paid (not the one struck through), the stations, 2 h, direct", () => {
    expect(parse().offers[0]).toEqual({
      departTime: "09:30",
      arriveTime: "11:30",
      departStation: "Madrid-Chamartin",
      // The row leaves it blank: the search names the one station the trains arrive at
      arriveStation: "Valencia-Joaquín Sorolla",
      durationMin: 120,
      changes: 0,
      trainType: "IRYO",
      // Inicial 41,30 € (43,47 € before the cut), Infinita 52,06 € (54,79 €); Infinita Bistró is 73,74 €
      price2ndEur: 41.3,
      price1stEur: 52.06,
      seatsAtPrice: [],
      rawText: "Madrid-Chamartin · 09:30 → 11:30 · 2h · Inicial 41,30 € (43,47 € avant remise) · Infinita 52,06 € (54,79 € avant remise) · Infinita Bistró 73,74 € (77,62 € avant remise)",
    });
  });

  it("reads 1h 59m as 119 minutes, and every train's prices in order of comfort", () => {
    const offers = parse().offers;
    expect(offers.map((o) => o.durationMin)).toEqual([120, 119, 114, 114, 119, 114, 114]);
    expect(offers.map((o) => [o.departTime, o.price2ndEur, o.price1stEur])).toEqual([
      ["09:30", 41.3, 52.06],
      ["10:45", 37.07, 45.69],
      ["13:30", 28.91, 39.31],
      ["15:15", 27.18, 36.94],
      ["16:45", 21.7, 29.11],
      ["19:30", 21.06, 27.58],
      ["20:45", 17.89, 34.16],
    ]);
  });

  it("is the same train from one row to the next: a direct Iryo", () => {
    expect(parse().offers.every((o) => o.changes === 0 && o.trainType === "IRYO" && o.departStation === "Madrid-Chamartin")).toBe(true);
  });
});

describe("the way back, the days, and what the page may do that the saved one does not", () => {
  const first = PAGE.rows[0];

  it("reads the way back from the tab that is showing: the trip is turned round, and 'every station' is not a station", () => {
    const back: Page = { ...PAGE, active: 1, rows: PAGE.rows.slice(0, 1).map((r) => ({ ...r, id: r.id.replace("outSchedule", "inSchedule"), originStation: "Valencia-Joaquín Sorolla" })) };
    const page = parse(back);
    expect(page).toMatchObject({ direction: "back", origin: "Valencia", destination: "Madrid", date: "2026-11-01" });
    // The search's other end is "Madrid-Todas las estaciones": no station to keep
    expect([page.offers[0].departStation, page.offers[0].arriveStation]).toEqual(["Valencia-Joaquín Sorolla", null]);
  });

  it("takes the way from the tab alone when the rows' ids do not say", () => {
    const bare = (active: number): Page => ({ ...PAGE, active, rows: PAGE.rows.slice(0, 1).map((r) => ({ ...r, id: "row_0" })) });
    expect(parse(bare(0)).direction).toBe("out");
    expect(parse(bare(1)).direction).toBe("back");
  });

  it("gives the tab's day the year of the address when the address agrees, else the next time that date comes", () => {
    expect(parse().date).toBe("2026-10-31");
    // An address that says another day (the search was changed on the page): what the tab shows is the day the prices are for
    expect(parse({ ...PAGE, addressDates: { outbound: "2026-12-24" } }).date).toBe("2026-10-31");
    // No address: the next 31 October after 20 November is next year's
    expect(parse({ ...PAGE, addressDates: {} }, new Date("2026-11-20T12:00:00Z")).date).toBe("2027-10-31");
    // No day on the tab: the address has it
    expect(parse({ ...PAGE, tabs: [{ date: "" }, { date: "" }] }).date).toBe("2026-10-31");
    expect(parse({ ...PAGE, tabs: [], addressDates: {} }).date).toBeNull();
  });

  it.each([
    ["31 Octubre", "2026-10-31"],
    ["01 noviembre", "2026-11-01"],
    ["3 de diciembre", "2026-12-03"],
    ["04 desembre", "2026-12-04"],
    ["28 December", "2026-12-28"],
    ["30 gener", "2027-01-30"],
    ["15 mayo", "2027-05-15"],
    ["9 agosto", "2027-08-09"],
  ])("reads the day %s in Spanish, Catalan or English", (tabDate, date) => {
    expect(parse({ ...PAGE, addressDates: {}, tabs: [{ date: tabDate }] }).date).toBe(date);
  });

  it("writes a city as a name when the page shouts it", () => {
    expect(parse({ ...PAGE, cities: "SAN SEBASTIÁN - ZARAGOZA" })).toMatchObject({ origin: "San Sebastián", destination: "Zaragoza" });
    expect(parse({ ...PAGE, cities: "" })).toMatchObject({ origin: null, destination: null });
  });

  it("keeps a price with no cut as it is, and a fare with no price as none", () => {
    const row = { ...first, cells: [{ ...first.cells[0], original: "", text: "41,30 €" }, { id: "x", paid: "", original: "", text: "" }, first.cells[2]] };
    const [offer] = parse({ ...PAGE, rows: [row] }).offers;
    // 41,30 € alone is the price; the next fare is not sold, so there is no "first class" price (and the third is not read as it)
    expect([offer.price2ndEur, offer.price1stEur]).toEqual([41.3, null]);
    expect(offer.rawText).toContain("Infinita - €");
    expect(offer.rawText).toContain("Inicial 41,30 €");
  });

  it("reads a price from the cell's text when the price paid has no element of its own", () => {
    const row = { ...first, cells: first.cells.map((c) => ({ ...c, paid: "", original: "" })) };
    expect(parse({ ...PAGE, rows: [row] }).offers[0]).toMatchObject({ price2ndEur: 41.3, price1stEur: 52.06 });
  });

  it("skips a train with no price at all, and a row with no times", () => {
    const sold = { ...first, cells: first.cells.map((c) => ({ ...c, paid: "", original: "", text: "Agotado" })) };
    expect(parse({ ...PAGE, rows: [sold] }).offers).toEqual([]);
    expect(parse({ ...PAGE, rows: [{ ...first, times: [], text: "Madrid-Chamartin" }] }).offers).toEqual([]);
    // The times come from the row's text when the page does not mark them
    expect(parse({ ...PAGE, rows: [{ ...first, times: [] }] }).offers[0]).toMatchObject({ departTime: "09:30", arriveTime: "11:30" });
  });

  it("reads seats left, and a change, only when the row says so", () => {
    const few = { ...first, text: `${first.text} 1 conexión`, cells: [{ ...first.cells[0], text: "3 plazas 41,30 €" }, ...first.cells.slice(1)] };
    expect(parse({ ...PAGE, rows: [few] }).offers[0]).toMatchObject({ seatsAtPrice: [3], changes: 1, trainType: "MIXED" });
  });

  it("reads who the prices are for", () => {
    expect(parse({ ...PAGE, travellersText: "2 Adultos 1 Niño" }).travellers).toBe("2 adultos, 1 niño");
  });
});
