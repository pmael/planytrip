// Google Hotels in the shared Chrome (task.md T7.4): opens a search for given dates and guests and reads
// the results off the page.
import type { Page } from "playwright";
import { googleHotels } from "@/config";
import { withChromePage } from "../browser";
import { ScrapeBlockedError, ScrapeError } from "../errors";
import { hotelPositions, positionFor, type RawHotelCard } from "./google-hotels-parse";

/** How the adapter gets the results for a search address. Swapped for a fake in tests. */
export type HotelsDriver = (url: string) => Promise<RawHotelCard[]>;

const PRICE = 'a[aria-label^="Prices starting from"]';

/**
 * Reads the results off the page. Plain JavaScript in a string, not a function: the tools that run this
 * project add helpers to functions that do not exist in the page.
 */
const READ_RESULTS = `(() => {
  const read = [];
  for (const heading of document.querySelectorAll("h2")) {
    const card = heading.closest("c-wiz");
    if (!card || card.querySelectorAll('a[aria-label^="Prices starting from"]').length === 0) continue;
    const label = (selector) => { const el = card.querySelector(selector); return el ? el.getAttribute("aria-label") : null; };
    const entity = card.querySelector('[ssk*="/entity/"]');
    const match = /\\/entity\\/([\\w-]+)/.exec(entity ? entity.getAttribute("ssk") || "" : "");
    read.push({
      name: heading.textContent || "",
      priceLabel: label('a[aria-label^="Prices starting from"]'),
      ratingLabel: label('[aria-label*="out of 5 stars"]'),
      amenitiesLabel: label('[aria-label^="Amenities for"]'),
      text: card.textContent || "",
      entityId: match ? match[1] : null,
      photos: [...card.querySelectorAll("img")].map((img) => img.getAttribute("src") || "").filter((src) => src.startsWith("http")).slice(0, 3),
    });
  }
  return read;
})()`;

/** The text of the page's scripts, where its data is */
const SCRIPTS = `[...document.scripts].map((script) => script.textContent || "").join("\\n")`;

async function passConsent(page: Page): Promise<void> {
  if (!/consent\.google\./.test(page.url())) return;
  const refuse = page.getByRole("button", { name: /reject all/i }).first();
  const accept = page.getByRole("button", { name: /accept all/i }).first();
  await ((await refuse.count()) > 0 ? refuse : accept).click();
  await page.waitForURL(/google\.[a-z.]+\/travel/, { timeout: googleHotels.answerTimeoutMs });
}

/** A driver that reads the results in a page of `runPage`'s Chrome: the scrapers' shared one by default. */
export const createChromeHotelsDriver =
  (runPage: <T>(task: (page: Page) => Promise<T>) => Promise<T> = withChromePage): HotelsDriver =>
  (url) =>
  runPage(async (page) => {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await passConsent(page);
    } catch (error) {
      throw new ScrapeError(`Could not load Google Hotels: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`);
    }
    if (/\/sorry\//.test(page.url())) throw new ScrapeBlockedError("Google asked for a verification: it will not answer an automated browser right now");

    const found = await page.waitForSelector(PRICE, { timeout: googleHotels.answerTimeoutMs }).then(() => true, () => false);
    if (!found) {
      // A place with nothing to offer for these days says so; anything else is a page that did not load
      const text = await page.locator("body").innerText().catch(() => "");
      if (/no results|no hotels|no available/i.test(text)) return [];
      throw new ScrapeError("Google Hotels did not show its results in time");
    }
    // The prices arrive a moment after the names
    await page.waitForTimeout(2_000);

    const cards = (await page.evaluate(READ_RESULTS)) as RawHotelCard[];
    // Where each hotel is: in the data the page carries in its scripts, next to the hotel's name (T8.2)
    const scripts = (await page.evaluate(SCRIPTS)) as string;
    const positions = hotelPositions(scripts);
    return cards.map((card) => ({ ...card, position: positionFor(card.name, positions) }));
  });

export const chromeHotelsDriver: HotelsDriver = createChromeHotelsDriver();
