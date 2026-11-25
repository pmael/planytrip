// Google Flights in the shared Chrome (task.md T7.2): opens a search, listens for the answers the
// page asks Google's server for, and, to learn what the way back looks like, chooses the first flight
// the way a person would. What it hands on is Google's own text; reading it is google-flights-parse.ts.
import type { Page } from "playwright";
import { googleFlights } from "@/config";
import { withChromePage } from "../browser";
import { ScrapeBlockedError, ScrapeError } from "../errors";

/**
 * What a search gave: every answer Google's server sent the page, in order. The first holds the outbound
 * flights; choosing the first of them brings another, with the flights back. The page also asks again
 * now and then, so which answer is which is for the reader to tell by the airports (google-flights.ts).
 */
export type FlightsPage = {
  answers: string[];
  /** The labels of the flights the page shows, for when its answers could not be captured */
  rows: string[];
};

/** How the adapter gets Google's answers for a search address. Swapped for a fake in tests. */
export type FlightsDriver = (url: string, options: { wantReturn: boolean }) => Promise<FlightsPage>;

/** A flight in the list: the whole row is a link whose label starts "From 146 euros round trip total…" */
const FLIGHT_ROW = '[role="link"][aria-label*="Select flight"]';
const ANSWER = "GetShoppingResults";
/** How long an answer gets before the page is asked again, and how many times it is */
const SETTLE_MS = 10_000;
const ASKS_AGAIN = 2;

async function until(page: Page, ready: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (ready()) return true;
    await page.waitForTimeout(200);
  }
  return ready();
}

/**
 * Waits for an answer beyond the first `known` ones. When none comes (the page moved on before it could
 * be read, or Google's server answered with an error) the page is asked again, a couple of times.
 */
async function newAnswer(page: Page, answers: string[], known: number, askAgain: () => Promise<void>): Promise<boolean> {
  for (let attempt = 0; attempt <= ASKS_AGAIN; attempt++) {
    if (await until(page, () => answers.length > known, attempt === 0 ? SETTLE_MS : googleFlights.answerTimeoutMs)) return true;
    checkNotTurnedAway(page);
    if (attempt < ASKS_AGAIN) await askAgain();
  }
  return false;
}

/**
 * The page Google shows when it did not understand the search (an airport it does not know, at either
 * end): "Find cheap flights to anywhere", with the route's filters missing. A page that is only slow
 * already has its filters ("All filters", "Stops"...) or says it is loading. Looked at twice, a moment
 * apart, so that a page still being written is not taken for it.
 */
async function isLandingPage(page: Page): Promise<boolean> {
  for (let look = 0; look < 2; look++) {
    const text = await page.locator("body").innerText().catch(() => "");
    if (!/Find cheap flights .*to anywhere/i.test(text) || /All filters|Loading results/i.test(text)) return false;
    if (look === 0) await page.waitForTimeout(2_000);
  }
  return true;
}

/** The labels of the flights the page lists. */
async function flightRows(page: Page): Promise<string[]> {
  const labels = await page.evaluate(`[...document.querySelectorAll('${FLIGHT_ROW}')].map((row) => row.getAttribute("aria-label") || "")`).catch(() => []);
  return Array.isArray(labels) ? (labels as string[]) : [];
}

/** In Europe Google asks about cookies before it shows anything: refuse them, the choice is kept in Chrome's profile. */
async function passConsent(page: Page): Promise<void> {
  if (!/consent\.google\./.test(page.url())) return;
  const refuse = page.getByRole("button", { name: /reject all/i }).first();
  const accept = page.getByRole("button", { name: /accept all/i }).first();
  await ((await refuse.count()) > 0 ? refuse : accept).click();
  await page.waitForURL(/google\.[a-z.]+\/travel/, { timeout: googleFlights.answerTimeoutMs });
}

function checkNotTurnedAway(page: Page): void {
  if (/\/sorry\//.test(page.url())) throw new ScrapeBlockedError("Google asked for a verification: it will not answer an automated browser right now");
}

export const chromeFlightsDriver: FlightsDriver = (url, { wantReturn }) =>
  withChromePage(async (page) => {
    const answers: string[] = [];
    // The page often reads its answer and then cancels the request, and once cancelled the answer can no
    // longer be fetched from the browser. So the request is made here instead and handed back to the page.
    await page.route(`**/*${ANSWER}*`, async (route) => {
      try {
        const response = await route.fetch();
        const text = await response.text();
        // Now and then Google's server answers a search with an error of its own: that is no answer
        if (!text.includes("ErrorResponse")) answers.push(text);
        await route.fulfill({ response, body: text });
      } catch {
        await route.continue().catch(() => undefined);
      }
    });

    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await passConsent(page);
    } catch (error) {
      checkNotTurnedAway(page);
      throw new ScrapeError(`Could not load Google Flights: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`);
    }
    checkNotTurnedAway(page);

    const reload = () => page.reload({ waitUntil: "domcontentloaded" }).then(() => undefined);
    // An airport Google does not know (a tiny one, or one without a scheduled flight) is not searched at
    // all: the page falls back to its landing page. That is "no flights", not a page that is slow.
    if (!(await until(page, () => answers.length >= 1, SETTLE_MS)) && (await isLandingPage(page))) return { answers: [], rows: [] };
    if (!(await newAnswer(page, answers, 0, reload))) {
      checkNotTurnedAway(page);
      // The page may still show its flights though its answer was not captured: they are read off the page
      const rows = await flightRows(page);
      if (rows.length > 0) return { answers, rows };
      throw new ScrapeError("Google Flights did not answer in time");
    }
    if (!wantReturn) return { answers, rows: [] };

    // Nothing to choose when nothing flies; otherwise choose the first, which shows the flights back
    await page.waitForSelector(FLIGHT_ROW, { timeout: 5_000 }).catch(() => undefined);
    if ((await page.locator(FLIGHT_ROW).count()) === 0) return { answers, rows: [] };

    // The way back is a bonus: when it cannot be had, the flights there are still worth having
    try {
      // The row is covered by its own details, so the click is forced through. It moves the page to the
      // address of the chosen flight; loading that address again is a clean way to get the flights back,
      // because the answer to the click itself is sometimes cut off by the page moving on
      await page.locator(FLIGHT_ROW).first().click({ force: true, timeout: 8_000 });
      await page.waitForURL(/[?&]tfs=/, { timeout: googleFlights.answerTimeoutMs });
      const before = answers.length;
      await page.goto(page.url(), { waitUntil: "domcontentloaded" });
      await newAnswer(page, answers, before, reload);
    } catch (error) {
      if (error instanceof ScrapeBlockedError) throw error;
    }
    return { answers, rows: [] };
  });
