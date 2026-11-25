// The PDF of a summary (use-cases.md C-S8): the summary's own print page, printed by Chrome. What is
// on paper is what is on screen, so there is one document to keep right, not two.
import type { Db } from "@/db/types";
import { chromium } from "playwright";
import { getSummary } from "./summaries";

/** The part of a Playwright page the printing needs. A fake stands in for it in tests. */
export type PdfPage = {
  goto(url: string, options: { waitUntil: "load"; timeout: number }): Promise<{ ok(): boolean; status(): number } | null>;
  waitForSelector(selector: string, options: { timeout: number }): Promise<unknown>;
  evaluate(script: () => unknown): Promise<unknown>;
  pdf(options: { format: "A4"; printBackground: boolean; margin: { top: string; right: string; bottom: string; left: string } }): Promise<Buffer>;
};
export type PdfBrowser = { newPage(): Promise<PdfPage>; close(): Promise<void> };
export type LaunchBrowser = () => Promise<PdfBrowser>;

/** The PDF cannot be made here: Chrome is missing or would not start. Worth saying so, and not worth retrying. */
export class PdfUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfUnavailableError";
  }
}

/** Real Chrome rather than a bundled browser: it is already installed, and prints the page as the user sees it. */
const launchChrome: LaunchBrowser = async () => {
  try {
    return (await chromium.launch({ channel: "chrome", headless: true })) as unknown as PdfBrowser;
  } catch (error) {
    throw new PdfUnavailableError(`Chrome could not be started: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`);
  }
};

const LOAD_TIMEOUT_MS = 30_000;
const MARGIN = { top: "14mm", right: "12mm", bottom: "14mm", left: "12mm" };

/** "Le Mont-Saxonnex" → "le-mont-saxonnex": safe in a file name, accents dropped. */
export const slugOf = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "trip";

/**
 * Prints a summary to PDF. `baseUrl` is where the app itself can be reached (it opens its own print
 * page there), so it should be the app's own address and never one taken from a visitor. Null when
 * there is no such summary; throws PdfUnavailableError when Chrome cannot be used.
 */
export async function renderSummaryPdf(
  db: Db,
  summaryId: string,
  { baseUrl, launch = launchChrome }: { baseUrl: string; launch?: LaunchBrowser },
): Promise<{ pdf: Buffer; filename: string } | null> {
  const summary = getSummary(db, summaryId);
  if (!summary) return null;

  const browser = await launch();
  try {
    const page = await browser.newPage();
    const response = await page.goto(`${baseUrl}/trips/${summary.tripId}/summary?id=${summary.id}&print=1`, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
    if (!response || !response.ok()) throw new Error(`The summary page answered ${response?.status() ?? "nothing"}`);

    // The document is there, and so are its fonts: printing before that gives a page of fallback type
    await page.waitForSelector("article[aria-label^='Summary']", { timeout: LOAD_TIMEOUT_MS });
    await page.evaluate(() => document.fonts.ready);

    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: MARGIN });
    // The day as the page writes it ("Validated on 20 October"), not the UTC one
    const validated = new Date(summary.createdAt);
    const day = `${validated.getFullYear()}-${String(validated.getMonth() + 1).padStart(2, "0")}-${String(validated.getDate()).padStart(2, "0")}`;
    return { pdf, filename: `trip-summary-${slugOf(summary.snapshot.destination.shortLabel)}-${day}.pdf` };
  } finally {
    await browser.close();
  }
}
