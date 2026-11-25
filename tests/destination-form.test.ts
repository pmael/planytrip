import { describe, expect, it } from "vitest";
import { destinationErrorsFromResponse, destinationPayload, validateDestinationForm } from "@/lib/destinationForm";

const barcelona = { label: "Barcelona, Spain", countryCode: "ES", lat: 41.4, lon: 2.2, airports: ["BCN"] };

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const valid = {
  place: "Barcelona, Spain",
  placePlace: JSON.stringify(barcelona),
  budget: "light",
  objective: "partying",
  datesFrom: "",
  datesTo: "",
};

describe("validateDestinationForm", () => {
  it("accepts a destination without dates", () => {
    expect(validateDestinationForm(form(valid))).toEqual({
      input: { place: barcelona, budgetLevel: "light", objective: "partying" },
    });
  });

  it("accepts dates, and a single date", () => {
    expect(validateDestinationForm(form({ ...valid, datesFrom: "2027-08-26", datesTo: "2027-09-05" }))).toMatchObject({
      input: { dateFrom: "2027-08-26", dateTo: "2027-09-05" },
    });
    expect(validateDestinationForm(form({ ...valid, datesFrom: "2027-08-26" }))).toMatchObject({
      input: { dateFrom: "2027-08-26" },
    });
  });

  it("falls back to the typed place when none was picked", () => {
    expect(validateDestinationForm(form({ ...valid, placePlace: "", place: "Barcelona" }))).toMatchObject({
      input: { query: "Barcelona" },
    });
  });

  it("asks for a place when there is none, even if other fields are wrong too", () => {
    const result = validateDestinationForm(form({ budget: "", objective: "" }));
    expect("errors" in result && result.errors).toEqual({
      place: "Choose a destination from the suggestions",
      budget: "Choose a type of budget",
      objective: "Choose an objective",
    });
  });

  it("asks for a place, in plain words, when everything else is fine", () => {
    const result = validateDestinationForm(form({ ...valid, place: "", placePlace: "" }));
    expect("errors" in result && result.errors).toEqual({ place: "Choose a destination from the suggestions" });
  });

  it("rejects an end date before the start date, with its own message", () => {
    const result = validateDestinationForm(form({ ...valid, datesFrom: "2027-09-10", datesTo: "2027-09-01" }));
    expect("errors" in result && result.errors).toEqual({ dates: "The end date can't be before the start date" });
  });

  it("rejects an unknown budget type or objective", () => {
    const result = validateDestinationForm(form({ ...valid, budget: "huge", objective: "skiing" }));
    expect("errors" in result && Object.keys(result.errors).sort()).toEqual(["budget", "objective"]);
  });
});

describe("destinationPayload", () => {
  it("ignores a hidden place that is not valid JSON", () => {
    expect(destinationPayload(form({ ...valid, placePlace: "{broken" }))).toMatchObject({ query: "Barcelona, Spain" });
  });
});

describe("destinationErrorsFromResponse", () => {
  it("keeps the server's message for an unknown place or a duplicate", () => {
    expect(destinationErrorsFromResponse({ fieldErrors: { query: ['No place found for "Zzzz"'] } })).toEqual({
      place: 'No place found for "Zzzz"',
    });
    expect(destinationErrorsFromResponse({ fieldErrors: { query: ["Barcelona, Spain is already in the list"] } })).toEqual({
      place: "Barcelona, Spain is already in the list",
    });
  });

  it("maps the other fields to the form's", () => {
    expect(destinationErrorsFromResponse({ fieldErrors: { dateTo: ["The end date can't be before the start date"] } })).toEqual({
      dates: "The end date can't be before the start date",
    });
  });
});
