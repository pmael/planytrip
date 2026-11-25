import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/types";
import { startCompute } from "@/server/services/compute";
import { validateDestination } from "@/server/services/summaries";
import { PdfUnavailableError, renderSummaryPdf, slugOf, type PdfBrowser, type PdfPage } from "@/server/services/summaryPdf";
import { createTestDb } from "./helpers/db";
import { enterScenario, fixtureAdapters, runUntilIdle } from "./helpers/compute";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

/** A browser that prints "%PDF-1.7 fake" and records what it was asked to do. */
function fakeBrowser(overrides: Partial<PdfPage> = {}) {
  const page: PdfPage = {
    goto: vi.fn(async () => ({ ok: () => true, status: () => 200 })),
    waitForSelector: vi.fn(async () => null),
    evaluate: vi.fn(async () => undefined),
    pdf: vi.fn(async () => Buffer.from("%PDF-1.7 fake")),
    ...overrides,
  };
  const browser: PdfBrowser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
  return { page, browser, launch: vi.fn(async () => browser) };
}

async function validated() {
  const scenario = await enterScenario(db);
  startCompute(db, scenario.tripId);
  await runUntilIdle(db, fixtureAdapters());
  const summary = validateDestination(db, scenario.tripId, scenario.destinations.bcn.id, new Date("2026-10-20T12:00:00Z"));
  return { ...scenario, summary };
}

const BASE = "http://127.0.0.1:3000";

describe("renderSummaryPdf (C-S8)", () => {
  it("is null for a summary that does not exist, without starting a browser", async () => {
    const { launch } = fakeBrowser();
    await expect(renderSummaryPdf(db, "nope", { baseUrl: BASE, launch })).resolves.toBeNull();
    expect(launch).not.toHaveBeenCalled();
  });

  it("prints the summary's own print page, so paper and screen are the same document", async () => {
    const { tripId, summary } = await validated();
    const { page, launch } = fakeBrowser();
    await renderSummaryPdf(db, summary.id, { baseUrl: BASE, launch });

    expect(page.goto).toHaveBeenCalledWith(`${BASE}/trips/${tripId}/summary?id=${summary.id}&print=1`, { waitUntil: "load", timeout: 30_000 });
  });

  it("waits for the document and its fonts before printing, on A4 with the backgrounds", async () => {
    const { summary } = await validated();
    const { page, launch } = fakeBrowser();
    const order: string[] = [];
    vi.mocked(page.waitForSelector).mockImplementation(async () => (order.push("document"), null));
    vi.mocked(page.evaluate).mockImplementation(async () => (order.push("fonts"), undefined));
    vi.mocked(page.pdf).mockImplementation(async () => (order.push("pdf"), Buffer.from("%PDF")));

    await renderSummaryPdf(db, summary.id, { baseUrl: BASE, launch });
    expect(order).toEqual(["document", "fonts", "pdf"]);
    expect(page.waitForSelector).toHaveBeenCalledWith("article[aria-label^='Summary']", { timeout: 30_000 });
    expect(page.pdf).toHaveBeenCalledWith({ format: "A4", printBackground: true, margin: { top: "14mm", right: "12mm", bottom: "14mm", left: "12mm" } });
  });

  it("gives back the bytes and a file name with the destination and the day it was validated", async () => {
    const { summary } = await validated();
    const { launch } = fakeBrowser();
    const result = await renderSummaryPdf(db, summary.id, { baseUrl: BASE, launch });

    expect(result!.pdf.toString()).toBe("%PDF-1.7 fake");
    expect(result!.filename).toBe("trip-summary-barcelona-2026-10-20.pdf");
  });

  it("closes the browser when it is done, and when something goes wrong", async () => {
    const { summary } = await validated();

    const ok = fakeBrowser();
    await renderSummaryPdf(db, summary.id, { baseUrl: BASE, launch: ok.launch });
    expect(ok.browser.close).toHaveBeenCalledTimes(1);

    const failing = fakeBrowser({ pdf: vi.fn(async () => Promise.reject(new Error("printing failed"))) });
    await expect(renderSummaryPdf(db, summary.id, { baseUrl: BASE, launch: failing.launch })).rejects.toThrow("printing failed");
    expect(failing.browser.close).toHaveBeenCalledTimes(1);
  });

  it("says so when the summary page does not answer properly, instead of printing an error page", async () => {
    const { summary } = await validated();
    const notFound = fakeBrowser({ goto: vi.fn(async () => ({ ok: () => false, status: () => 404 })) });
    await expect(renderSummaryPdf(db, summary.id, { baseUrl: BASE, launch: notFound.launch })).rejects.toThrow("answered 404");
    expect(notFound.page.pdf).not.toHaveBeenCalled();
    expect(notFound.browser.close).toHaveBeenCalledTimes(1);

    const nothing = fakeBrowser({ goto: vi.fn(async () => null) });
    await expect(renderSummaryPdf(db, summary.id, { baseUrl: BASE, launch: nothing.launch })).rejects.toThrow("answered nothing");
  });

  it("lets PdfUnavailableError through when Chrome cannot be started, so the route can say 503", async () => {
    const { summary } = await validated();
    const launch = vi.fn(async () => Promise.reject(new PdfUnavailableError("Chrome could not be started: not found")));
    await expect(renderSummaryPdf(db, summary.id, { baseUrl: BASE, launch })).rejects.toBeInstanceOf(PdfUnavailableError);
  });
});

describe("slugOf", () => {
  it("makes a destination safe for a file name", () => {
    expect(slugOf("Barcelona")).toBe("barcelona");
    expect(slugOf("Le Mont-Saxonnex")).toBe("le-mont-saxonnex");
    expect(slugOf("La Réunion (Saint-Gilles)")).toBe("la-reunion-saint-gilles");
    expect(slugOf("../../etc/passwd")).toBe("etc-passwd");
  });

  it("falls back to something when nothing is left", () => {
    expect(slugOf("")).toBe("trip");
    expect(slugOf("???")).toBe("trip");
  });
});
