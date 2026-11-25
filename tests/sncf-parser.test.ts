import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

// The parser is a classic browser script (the extension loads it before content.js): it is run here the same way
type Offer = {
  departTime: string; arriveTime: string; departStation: string | null; arriveStation: string | null;
  durationMin: number | null; changes: number | null; trainType: string | null;
  price2ndEur: number | null; price1stEur: number | null; seatsAtPrice: number[]; rawText: string;
};
type Header = { direction: "out" | "back" | null; origin: string | null; destination: string | null; date: string | null };
type Parser = {
  parseHeader(text: string, now?: Date): Header;
  parseCard(text: string, logoAlt?: string): Offer | null;
  parsePage(page: { headerText: string; cards: { text: string; logoAlt?: string }[] }, now?: Date): Header & { offers: Offer[] };
};
let parser: Parser;
beforeAll(() => {
  const context: Record<string, unknown> = {};
  vm.runInNewContext(readFileSync(path.join(process.cwd(), "extension/sncf-import/sncf-parser.js"), "utf8"), context);
  parser = context.SncfParser as Parser;
});

/**
 * The six trains of the SNCF Connect results page "Aller : Toulouse - Lyon, vendredi 04 décembre", as seen on
 * 2026-10-24 (transcribed from a screenshot): each with its times, stations, duration, changes, and its two fares.
 */
const PAGE = [
  { from: "06:51", fromStation: "Toulouse Matabiau", to: "11:58", toStation: "Lyon Saint-Exupery TGV", duration: "5h07", changes: "2 correspondances", extra: "Itinéraire bis", first: ["Dès", "49,50 €"], second: ["6 places à ce prix", "64,30 €"], logo: "" },
  { from: "07:37", fromStation: "Toulouse Matabiau", to: "11:48", toStation: "Lyon Part Dieu", duration: "4h11", changes: "Direct", extra: "", first: ["Dès", "66 €"], second: ["5 places à ce prix", "77 €"], logo: "TGV INOUI" },
  { from: "10:42", fromStation: "Toulouse Matabiau", to: "15:50", toStation: "Lyon Part Dieu", duration: "5h08", changes: "1 correspondance", extra: "", first: ["2 places à ce prix", "84 €"], second: ["4 places à ce prix", "113 €"], logo: "" },
  { from: "11:16", fromStation: "Toulouse Matabiau", to: "16:49", toStation: "Lyon Part Dieu", duration: "5h33", changes: "2 correspondances", extra: "", first: ["Dès", "65 €"], second: ["7 places à ce prix", "69 €"], logo: "" },
  { from: "15:42", fromStation: "Toulouse Matabiau", to: "19:50", toStation: "Lyon Part Dieu", duration: "4h08", changes: "Direct", extra: "", first: ["Dès", "101 €"], second: ["Dès", "107 €"], logo: "TGV INOUI" },
  { from: "17:43", fromStation: "Toulouse Matabiau", to: "21:38", toStation: "Lyon Part Dieu", duration: "3h55", changes: "Direct", extra: "", first: ["Dès", "71 €"], second: ["Dès", "97 €"], logo: "TGV INOUI" },
];
type Train = (typeof PAGE)[number];

/** Each piece of the card on a line of its own, the way an `innerText` reads a card built of blocks */
const stacked = (t: Train) =>
  [t.from, t.fromStation, t.to, t.toStation, t.extra, t.duration, t.changes, "Détail du trajet", ...t.first, ...t.second].filter(Boolean).join("\n");
/** The station on the time's own line */
const inline = (t: Train) =>
  [`${t.from} ${t.fromStation}`, `${t.to} ${t.toStation}`, t.extra, `${t.duration} ${t.changes}`, "Détail du trajet", ...t.first, ...t.second].filter(Boolean).join("\n");

describe.each([
  ["each piece on its own line", stacked],
  ["the station on the time's line", inline],
])("parseCard, %s (T7.9, the six trains of the page of 4 December)", (_layout, write) => {
  const offers = () => PAGE.map((t) => parser.parseCard(write(t), t.logo)!);

  it("reads the times and the stations", () => {
    expect(offers().map((o) => [o.departTime, o.arriveTime])).toEqual(PAGE.map((t) => [t.from, t.to]));
    expect(offers().map((o) => [o.departStation, o.arriveStation])).toEqual(PAGE.map((t) => [t.fromStation, t.toStation]));
  });

  it("reads the duration in minutes and the changes (a direct train has none)", () => {
    expect(offers().map((o) => o.durationMin)).toEqual([307, 251, 308, 333, 248, 235]);
    expect(offers().map((o) => o.changes)).toEqual([2, 0, 1, 2, 0, 0]);
  });

  it("reads the two fares, the first column being second class, and how many seats are at the price", () => {
    expect(offers().map((o) => [o.price2ndEur, o.price1stEur])).toEqual([[49.5, 64.3], [66, 77], [84, 113], [65, 69], [101, 107], [71, 97]]);
    expect(offers().map((o) => o.seatsAtPrice)).toEqual([[6], [5], [2, 4], [7], [], []]);
  });

  it("tells the type of a train from its logo, and calls a journey with changes and no logo MIXED", () => {
    expect(offers().map((o) => o.trainType)).toEqual(["MIXED", "TGV INOUI", "MIXED", "MIXED", "TGV INOUI", "TGV INOUI"]);
  });

  it("keeps the card's text, for the tests of the next page that comes out wrong", () => {
    expect(offers()[1].rawText).toContain("Lyon Part Dieu");
  });
});

describe("parseCard, the cases that went wrong", () => {
  it("does not take a duration for a time: 4h11 between the two times is not the arrival", () => {
    const card = "07:37 Toulouse Matabiau\n4h11 Direct\n11:48 Lyon Part Dieu\nDès\n66 €";
    expect(parser.parseCard(card)).toMatchObject({ departTime: "07:37", arriveTime: "11:48", durationMin: 251 });
  });

  it("finds the right station when the minutes of the time also start the line (07:07)", () => {
    const card = "07:07 Toulouse Matabiau\n11:07 Lyon Part Dieu\nDès\n66 €";
    expect(parser.parseCard(card)).toMatchObject({ departStation: "Toulouse Matabiau", arriveStation: "Lyon Part Dieu" });
  });

  it("reads a time with no leading zero, and a price with a thin no-break space", () => {
    const card = "6:51\nToulouse Matabiau\n11:58\nLyon Part Dieu\nDès\n66 €";
    expect(parser.parseCard(card)).toMatchObject({ departTime: "06:51", departStation: "Toulouse Matabiau", price2ndEur: 66 });
  });

  it("does not take the next detail for a station name", () => {
    const card = "07:37\n11:48\nDirect\nDès\n66 €";
    expect(parser.parseCard(card)).toMatchObject({ departStation: null, arriveStation: null });
  });

  it("recognises the other trains and OUIGO first", () => {
    const type = (text: string, alt = "") => parser.parseCard(`07:37\nA\n11:48\nB\nDirect\n66 €\n${text}`, alt)!.trainType;
    expect(type("", "OUIGO")).toBe("OUIGO");
    expect(type("", "inOui")).toBe("TGV INOUI");
    expect(type("Intercités")).toBe("INTERCITES");
    expect(type("TER Occitanie")).toBe("TER");
    expect(type("TGV Lyria")).toBe("TGV LYRIA");
    expect(type("")).toBeNull();
  });

  it("is nothing when it is not a train: no two times, or no price", () => {
    expect(parser.parseCard("Rechercher un billet\n12 €")).toBeNull();
    expect(parser.parseCard("07:37 Toulouse\n11:48 Lyon\nSans prix")).toBeNull();
  });
});

/**
 * Cards as SNCF Connect's page really gave them (read by the extension on 2026-10-24 and 2026-10-26 and stored by the app): each piece
 * on its own line, the fares labelled "Seconde classe" and "Première classe", the type of train on the first line.
 */
const REAL = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/sncf-connect/real-cards.json"), "utf8")) as Record<string, string>;

describe("parseCard, on the cards the real page gives (T7.9)", () => {
  it("reads a TGV INOUI: stations, duration, no change, and the two fares by their labels", () => {
    expect(parser.parseCard(REAL["tgv-inoui"])).toMatchObject({
      departTime: "06:04", arriveTime: "08:14", departStation: "Lyon Part Dieu", arriveStation: "Paris - Gare De Lyon - Hall 1 & 2",
      durationMin: 130, changes: 0, trainType: "TGV INOUI", price2ndEur: 51, price1stEur: 74, seatsAtPrice: [2],
    });
  });

  it("reads the seats left in each class, however many", () => {
    expect(parser.parseCard(REAL["tgv-inoui-singular-and-plural-seats"])).toMatchObject({ price2ndEur: 47, price1stEur: 60, seatsAtPrice: [1, 9] });
  });

  it("reads an OUIGO, whose first class is a dash", () => {
    expect(parser.parseCard(REAL["ouigo"])).toMatchObject({ trainType: "OUIGO", price2ndEur: 39, price1stEur: null, durationMin: 107 });
  });

  it("knows a TER, which the page writes with its letters apart: 'Train T E R'", () => {
    expect(REAL["ter"]).toMatch(/^Train T E R/);
    expect(parser.parseCard(REAL["ter"])).toMatchObject({ trainType: "TER", changes: 0 });
  });

  it("calls a night train an Intercités, as the timetable names it", () => {
    expect(parser.parseCard(REAL["night"])).toMatchObject({ trainType: "INTERCITES", departTime: "22:13", arriveTime: "07:44", departStation: "Paris Austerlitz", arriveStation: "Toulouse Matabiau", durationMin: 571, price2ndEur: 50 });
  });

  it("does not take the first-class price for the second class when the second is full", () => {
    // The old positional reading gave 74 € as the second-class price here
    const full = REAL["tgv-inoui"].replace(/Seconde classe\nDès\n51\s€/, "Seconde classe\nComplet");
    expect(full).toContain("Complet");
    expect(parser.parseCard(full)).toMatchObject({ price2ndEur: null, price1stEur: 74 });
  });

  it("tells the type from what the logo carried when the card's text does not say, and keeps the hint", () => {
    const text = "17:43\nToulouse Matabiau\n21:38\nLyon Part Dieu\n\n3h55\nDirect\n\nSeconde classe\nDès\n101\u00a0€\n\nPremière classe\nDès\n107\u00a0€";
    expect(parser.parseCard(text)).toMatchObject({ trainType: null, logoHint: undefined });
    expect(parser.parseCard(text, "inoui.svg")).toMatchObject({ trainType: "TGV INOUI", logoHint: "inoui.svg" });
    expect(parser.parseCard(text, "logo-ouigo.svg")).toMatchObject({ trainType: "OUIGO" });
  });

  it("tells an Intercités from the row's hidden title, which the card's own text and its logo (a drawing) do not carry", () => {
    // Page of Toulouse → Marseille, 30 October: the row's <h3> reads "INTERCITES Départ de Toulouse Matabiau 06:43 à destination de …"
    const card = REAL["intercites-direct"];
    expect(parser.parseCard(card)).toMatchObject({ trainType: null });
    expect(parser.parseCard(card, "INTERCITES")).toMatchObject({
      trainType: "INTERCITES", departTime: "06:43", arriveTime: "10:35", departStation: "Toulouse Matabiau", arriveStation: "Marseille Saint-Charles",
      durationMin: 232, changes: 0, price2ndEur: 35, price1stEur: 42, seatsAtPrice: [7],
    });
  });

  it("takes the title's type over a service that names another train", () => {
    // An opened Intercités lists "Presse et contenus sur le Portail TGV INOUI" among its services
    const opened = `${REAL["intercites-direct"]}\nPresse et contenus sur le\nPortail TGV INOUI`;
    expect(parser.parseCard(opened)).toMatchObject({ trainType: "TGV INOUI" });
    expect(parser.parseCard(opened, "INTERCITES")).toMatchObject({ trainType: "INTERCITES" });
  });

  it("reads 'dès60 €' (no space) as the second-class price, and a dash as no first class", () => {
    expect(parser.parseCard(REAL["intercites-dash-first"], "INTERCITES")).toMatchObject({ price2ndEur: 60, price1stEur: null, seatsAtPrice: [], durationMin: 242 });
  });

  it("still reads two prices in order when the page does not label them", () => {
    expect(parser.parseCard("07:37 Toulouse\n11:48 Lyon\nDès\n66 €\n77 €")).toMatchObject({ price2ndEur: 66, price1stEur: 77 });
  });
});

describe("parseHeader", () => {
  const header = "Aller : Toulouse - Lyon\nVendredi 04 décembre, à partir de 6:00";

  it("reads the route, its direction and the date, in the next year when the day has passed", () => {
    expect(parser.parseHeader(header, new Date("2026-10-24T10:00:00"))).toEqual({ direction: "out", origin: "Toulouse", destination: "Lyon", date: "2026-12-04" });
    expect(parser.parseHeader(header, new Date("2026-12-10T10:00:00")).date).toBe("2027-12-04");
  });

  it("takes the year when the page gives one, and reads the way back", () => {
    expect(parser.parseHeader("Retour : Lyon - Toulouse\nDimanche 6 décembre 2026", new Date("2026-10-24T10:00:00"))).toEqual({ direction: "back", origin: "Lyon", destination: "Toulouse", date: "2026-12-06" });
  });

  it("keeps the hyphens of a name, and reads a month with an accent or without", () => {
    expect(parser.parseHeader("Aller : Aix-en-Provence - Lyon\nSamedi 1 février", new Date("2026-10-24T10:00:00"))).toMatchObject({ origin: "Aix-en-Provence", destination: "Lyon", date: "2027-02-01" });
    expect(parser.parseHeader("Aller : A - B\n3 aout", new Date("2026-10-24T10:00:00")).date).toBe("2027-08-03");
  });

  it("says nothing it does not know", () => {
    expect(parser.parseHeader("Mon compte")).toEqual({ direction: null, origin: null, destination: null, date: null });
  });
});

describe("parsePage", () => {
  it("gives the route, the date and the trains, leaving out what is not a train", () => {
    const page = parser.parsePage(
      { headerText: "Aller : Toulouse - Lyon\nVendredi 04 décembre, à partir de 6:00", cards: [...PAGE.map((t) => ({ text: stacked(t), logoAlt: t.logo })), { text: "Voir plus de trains" }] },
      new Date("2026-10-24T10:00:00"),
    );
    expect(page).toMatchObject({ direction: "out", origin: "Toulouse", destination: "Lyon", date: "2026-12-04" });
    expect(page.offers).toHaveLength(6);
  });
});
