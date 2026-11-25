import { describe, expect, it } from "vitest";
import { capitalize, field, formatDateRange, formatDayMonth, formatEur, formatEurShort } from "@/lib/form";

describe("formatDateRange", () => {
  it("shows both days", () => {
    expect(formatDateRange("2026-08-26", "2026-09-14")).toBe("26 aug - 14 sep");
  });

  it("shows the only day given, or nothing", () => {
    expect(formatDateRange("2026-08-26", "")).toBe("26 aug");
    expect(formatDateRange("", "2026-09-14")).toBe("14 sep");
    expect(formatDateRange("", "")).toBe("");
  });
});

describe("formatDayMonth", () => {
  it("is day/month", () => {
    expect(formatDayMonth("2026-08-26")).toBe("26/08");
    expect(formatDayMonth("2026-09-05")).toBe("05/09");
  });
});

describe("field and capitalize", () => {
  it("reads and trims a form value, empty when absent", () => {
    const form = new FormData();
    form.set("name", "  Martin ");
    expect(field(form, "name")).toBe("Martin");
    expect(field(form, "missing")).toBe("");
  });

  it("capitalizes the first letter", () => {
    expect(capitalize("plane")).toBe("Plane");
    expect(capitalize("")).toBe("");
  });
});

describe("formatEur", () => {
  it("shows a whole number of euros as it is", () => {
    expect(formatEur(1800)).toBe("1800 €");
    expect(formatEur(0)).toBe("0 €");
  });

  it("rounds float noise away: 3700.0000001 € is 3700 €", () => {
    expect(formatEur(3699.9999999)).toBe("3700 €");
    expect(formatEur(3700.0000001)).toBe("3700 €");
  });

  it("marks an amount that had to be rounded with a ~ and one decimal", () => {
    expect(formatEur(2166.3333)).toBe("~ 2166.3 €");
    expect(formatEur(1233.3333)).toBe("~ 1233.3 €");
    expect(formatEur(266.6667)).toBe("~ 266.7 €");
  });
});

describe("formatEurShort", () => {
  it("writes a whole amount without decimals and a tenth otherwise", () => {
    expect(formatEurShort(1200)).toBe("1200€");
    expect(formatEurShort(400)).toBe("400€");
    expect(formatEurShort(21.05)).toBe("21.1€");
    expect(formatEurShort(466.6667)).toBe("466.7€");
    expect(formatEurShort(24.5)).toBe("24.5€");
  });

  it("does not leave a '.0' behind when rounding lands on a whole number", () => {
    expect(formatEurShort(299.96)).toBe("300€");
    expect(formatEurShort(0)).toBe("0€");
  });
});
