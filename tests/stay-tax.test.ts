// What a stay's own page says about the tourist tax, and its amenities, for the Extra (task.md T8.2, use-cases.md R10).
import { describe, expect, it } from "vitest";
import { amenityFlags } from "@/core/amenities";
import { airbnbTax, GOOGLE_HOTELS_TAX, hostTaxStatement, UNKNOWN_TAX } from "@/scrapers/stays/stay-tax";

describe("hostTaxStatement: what the host writes about the tourist tax", () => {
  it("reads a tax paid at check-in, in the host's words, with the rate", () => {
    expect(hostTaxStatement(["The TOURIST TAX will be paid at check-in (It is not included in the apartment booking)"])).toMatchObject({ included: false, basis: "host-says-not-included" });
    expect(hostTaxStatement(["• The tourist tax (€ 9,50 per day / per adult of +17 years) will be paid by hand at check-in"])).toMatchObject({ included: false, perPersonNightEur: 9.5 });
    expect(hostTaxStatement(["<p>City tax: 3 € per person per night, to be paid in cash on arrival.</p>"])).toMatchObject({ included: false, perPersonNightEur: 3 });
    expect(hostTaxStatement(["La taxe de séjour (2,50 € par nuit et par personne) est à régler sur place."])).toMatchObject({ included: false, perPersonNightEur: 2.5 });
  });

  it("reads the lines under a heading, the highest rate and the cap on nights", () => {
    const text = "Tourist Tax in Barcelona:<br />🏛️ 6,88 EUR per person, per night<br /><br />Attention: It will increase to €10.45 per person per night (up to a maximum of 7 nights) and must be paid at check-in.<br />Check-in:<br />From 15:00, €40 at night";
    expect(hostTaxStatement([text])).toMatchObject({ included: false, perPersonNightEur: 10.45, maxNights: 7 });
  });

  it("reads a tax charged on top, at the start of the stay, or only for the first days (real Barcelona hosts, 2026-11-14)", () => {
    const onTop = "As required by law, we must collect the city tourist tax, which will be charged in addition to your booking. The tax is €9.50 per person, per day, for guests aged 17 and older. This applies only to the first 7 days of your stay.";
    expect(hostTaxStatement([onTop])).toMatchObject({ included: false, perPersonNightEur: 9.5, maxNights: 7, basis: "host-says-not-included" });
    const atStart = "In accordance with local regulations, we are required to charge a tourist tax of €2.20 per person per night at the start of your stay.";
    expect(hostTaxStatement([atStart])).toMatchObject({ included: false, perPersonNightEur: 2.2 });
  });

  it("takes a rate per person, with nothing said about it being included, for a tax the host charges", () => {
    expect(hostTaxStatement(["Tourist tax: €4 per person per night."])).toMatchObject({ included: false, perPersonNightEur: 4, basis: "host-gives-rate" });
  });

  it("reads a tax the host says is included", () => {
    expect(hostTaxStatement(["The tourist tax is included in the price."])).toMatchObject({ included: true, basis: "host-says-included" });
  });

  it("does not know when the host names the tax without saying either", () => {
    expect(hostTaxStatement(["Tourist tax applies in Lisbon."])).toMatchObject({ included: null, basis: null, evidence: "Tourist tax applies in Lisbon." });
  });

  it("says nothing when the host says nothing about it, or only about another tax", () => {
    expect(hostTaxStatement(["Lovely flat near the beach. Check-in at 15:00."])).toBeNull();
    expect(hostTaxStatement(["Tax identification number: ESB61107520", "Prices include VAT"])).toBeNull();
    expect(hostTaxStatement([])).toBeNull();
  });
});

describe("airbnbTax: Airbnb's own price details first, then the host", () => {
  const host = hostTaxStatement(["The tourist tax will be paid at check-in."]);

  it("says included when Airbnb's price details have a Taxes line, whatever the host writes", () => {
    expect(airbnbTax(68, host)).toMatchObject({ included: true, amountEur: 68, basis: "airbnb-collects", evidence: "Airbnb's price details: Taxes €68" });
  });

  it("takes the host's word without such a line, and knows nothing without either", () => {
    expect(airbnbTax(null, host)).toMatchObject({ included: false, basis: "host-says-not-included" });
    expect(airbnbTax(null, null)).toEqual(UNKNOWN_TAX);
    expect(airbnbTax(0, null)).toEqual(UNKNOWN_TAX);
  });

  it("says included for Google Hotels, by its policy", () => {
    expect(GOOGLE_HOTELS_TAX).toMatchObject({ included: true, basis: "google-policy" });
  });
});

describe("amenityFlags: what the amenities say for the Extra", () => {
  it("reads Airbnb's words", () => {
    expect(amenityFlags(["Kitchen", "Free parking on premises", "Shared outdoor pool", "Hot tub", "Sea view"])).toEqual({ kitchen: true, freeParking: true, pool: true, spa: false, sauna: true, view: true });
    expect(amenityFlags(["Kitchen", "Wifi", "Washer", "Elevator"])).toEqual({ kitchen: true, freeParking: false, pool: false, spa: false, sauna: false, view: false });
  });

  it("reads Google's words", () => {
    expect(amenityFlags(["Breakfast", "Free Wi-Fi", "Spa", "Pool", "Parking"])).toEqual({ kitchen: false, freeParking: false, pool: true, spa: true, sauna: false, view: false });
    expect(amenityFlags(["Free parking", "Sauna"])).toMatchObject({ freeParking: true, sauna: true });
  });

  it("counts cooking basics or a stove as a kitchen: Airbnb may list \"Kitchen\" as missing where one can cook", () => {
    expect(amenityFlags(["Refrigerator", "Microwave", "Cooking basics", "Dishwasher"]).kitchen).toBe(true);
    expect(amenityFlags(["Stove", "Refrigerator"]).kitchen).toBe(true);
    expect(amenityFlags(["Microwave", "Coffee maker", "Refrigerator"]).kitchen).toBe(false);
  });

  it("does not take a pool table for a pool, paid parking for free parking, or a courtyard for a view", () => {
    expect(amenityFlags(["Pool table", "Paid parking off premises", "Courtyard view"])).toEqual({ kitchen: false, freeParking: false, pool: false, spa: false, sauna: false, view: false });
  });
});
