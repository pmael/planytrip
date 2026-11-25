import { describe, expect, it } from "vitest";
import { errorsFromResponse, guestPayload, validateGuestForm } from "@/lib/guestForm";

const madrid = { label: "Madrid, Spain", countryCode: "ES", lat: 40.4, lon: -3.7, airports: ["MAD"] };

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const valid = {
  name: "Martin",
  home: "Madrid, Spain",
  homePlace: JSON.stringify(madrid),
  budget: "800",
  availabilitiesFrom: "2027-08-26",
  availabilitiesTo: "2027-09-05",
  transport: "car",
};

describe("validateGuestForm (A-S1)", () => {
  it("accepts a complete form and builds the API input", () => {
    expect(validateGuestForm(form(valid))).toEqual({
      input: {
        name: "Martin", homePlace: madrid, maxBudgetEur: 800,
        availableFrom: "2027-08-26", availableTo: "2027-09-05", preferredMode: "car",
      },
    });
  });

  it("falls back to the typed city when none was picked from the suggestions", () => {
    const result = validateGuestForm(form({ ...valid, homePlace: "", home: "Madrid" }));
    expect(result).toMatchObject({ input: { homeQuery: "Madrid" } });
    expect(result).not.toHaveProperty("input.homePlace");
  });

  it("reads a budget typed with a currency sign or spaces", () => {
    expect(validateGuestForm(form({ ...valid, budget: "1 200 €" }))).toMatchObject({ input: { maxBudgetEur: 1200 } });
  });

  it("flags every empty field with its own message", () => {
    const result = validateGuestForm(form({}));
    expect("errors" in result && result.errors).toEqual({
      name: "Enter the guest's name",
      home: "Choose a city from the suggestions",
      budget: "Enter a budget above 0",
      availabilities: "Pick a start date and an end date",
      transport: "Choose a means of transportation",
    });
  });

  it("rejects a blank name", () => {
    const result = validateGuestForm(form({ ...valid, name: "   " }));
    expect("errors" in result && Object.keys(result.errors)).toEqual(["name"]);
  });

  it("rejects a budget of 0", () => {
    const result = validateGuestForm(form({ ...valid, budget: "0" }));
    expect("errors" in result && result.errors.budget).toBe("Enter a budget above 0");
  });

  it("rejects an end date before the start date, with its own message", () => {
    const result = validateGuestForm(form({ ...valid, availabilitiesFrom: "2027-09-10", availabilitiesTo: "2027-09-01" }));
    expect("errors" in result && result.errors).toEqual({ availabilities: "The end date can't be before the start date" });
  });

  it("rejects an unknown means of transportation", () => {
    const result = validateGuestForm(form({ ...valid, transport: "boat" }));
    expect("errors" in result && result.errors.transport).toBeTruthy();
  });
});

describe("guestPayload", () => {
  it("ignores a hidden place that is not valid JSON", () => {
    expect(guestPayload(form({ ...valid, homePlace: "{broken" }))).toMatchObject({ homeQuery: "Madrid, Spain" });
  });
});

describe("errorsFromResponse", () => {
  it("keeps the server's message for an unknown city", () => {
    expect(errorsFromResponse({ fieldErrors: { homeQuery: ['No city found for "Zzzz"'] } })).toEqual({
      home: 'No city found for "Zzzz"',
    });
  });

  it("maps API fields to form fields", () => {
    expect(errorsFromResponse({ fieldErrors: { maxBudgetEur: ["Too small"], availableTo: ["The end date can't be before the start date"] } })).toEqual({
      budget: "Enter a budget above 0",
      availabilities: "The end date can't be before the start date",
    });
  });

  it("is empty without field errors", () => {
    expect(errorsFromResponse({})).toEqual({});
  });
});
