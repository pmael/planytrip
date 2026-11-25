import { describe, expect, it } from "vitest";
import { isInScope } from "@/core/reachability";

const at = (countryCode: string, lat: number, lon: number) => ({ countryCode, lat, lon });

describe("isInScope (the POC covers Europe)", () => {
  it.each([
    ["Madrid", at("ES", 40.4168, -3.7038)],
    ["Barcelona", at("ES", 41.3874, 2.1686)],
    ["Paris", at("FR", 48.8566, 2.3522)],
    ["Le Mont-Saxonnex", at("FR", 46.0517, 6.4533)],
    ["Reykjavik", at("IS", 64.1466, -21.9426)],
    ["Istanbul", at("TR", 41.0082, 28.9784)],
    ["Moscow", at("RU", 55.7558, 37.6173)],
    ["Athens", at("GR", 37.9838, 23.7275)],
    ["Nicosia", at("CY", 35.1856, 33.3823)],
    ["Tromsø", at("NO", 69.6492, 18.9553)],
  ])("%s is in scope", (_name, place) => {
    expect(isInScope(place)).toBe(true);
  });

  it("puts La Réunion out of scope even though geocoders report it as France", () => {
    expect(isInScope(at("FR", -21.1309, 55.5266))).toBe(false);
    expect(isInScope(at("RE", -21.0597, 55.2203))).toBe(false);
  });

  it.each([
    ["Martinique", at("FR", 14.6415, -61.0242)],
    ["French Guiana", at("FR", 4.9224, -52.3135)],
    ["Canary Islands", at("ES", 28.1235, -15.4363)],
    ["New York", at("US", 40.7128, -74.006)],
    ["Marrakech", at("MA", 31.6295, -7.9811)],
    ["Tangier", at("MA", 35.7595, -5.834)],
    ["Tokyo", at("JP", 35.6762, 139.6503)],
    ["Dubai", at("AE", 25.2048, 55.2708)],
  ])("%s is out of scope", (_name, place) => {
    expect(isInScope(place)).toBe(false);
  });

  it("needs both a European country and a European position", () => {
    expect(isInScope(at("US", 48.85, 2.35))).toBe(false); // right place, wrong country
    expect(isInScope(at("FR", 48.85, 100))).toBe(false); // right country, wrong place
  });

  it("is not case sensitive about the country code", () => {
    expect(isInScope(at("es", 40.4, -3.7))).toBe(true);
  });
});
