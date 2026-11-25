// The browser the scrapers share (task.md T7.1): real Chrome with its own profile folder, so cookies
// and consent choices are kept between runs, and one page at a time with a polite pause between.
// Real Chrome rather than a bundled one: sites trust it far more.
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { scraping } from "@/config";
import { ScrapeError } from "./errors";
import { createPoliteThrottle } from "./throttle";

/** A page as the browser got it. */
export type FetchedPage = { status: number; html: string; title: string };

/** How a scraper gets the HTML of a page. Swapped for a fake in tests. */
export type PageFetcher = (url: string) => Promise<FetchedPage>;

type Settings = typeof scraping;

/**
 * A fetcher that loads pages in one shared Chrome, started when first needed. Images, media and
 * fonts are not loaded: the data is in the page's code, and the site is asked for as little as possible.
 */
export function createChromeFetcher(settings: Settings = scraping) {
  let context: Promise<BrowserContext> | null = null;
  const pace = createPoliteThrottle({ minMs: settings.pauseMs.min, maxMs: settings.pauseMs.max });

  function open(): Promise<BrowserContext> {
    context ??= chromium
      .launchPersistentContext(path.join(process.cwd(), settings.profileDir), {
        channel: "chrome",
        headless: settings.headless,
        viewport: { width: 1400, height: 900 },
        locale: "en-GB",
      })
      .catch((error: unknown) => {
        context = null;
        const reason = error instanceof Error ? error.message.split("\n")[0] : "unknown error";
        // A profile folder can only be used by one Chrome at a time
        const inUse = /profile|ProcessSingleton|already (?:running|in use)/i.test(reason);
        throw new ScrapeError(`Chrome could not be started${inUse ? " (is another scrape running on the same profile?)" : ""}: ${reason}`, false);
      });
    return context;
  }

  const fetchPage: PageFetcher = (url) =>
    pace(async () => {
      const page = await (await open()).newPage();
      try {
        await page.route("**/*", (route) => (["image", "media", "font"].includes(route.request().resourceType()) ? route.abort() : route.continue()));
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: settings.pageTimeoutMs });
        // The data is in the page already; this only gives a slow page a moment to finish writing it
        await page.waitForSelector("script#data-deferred-state-0", { state: "attached", timeout: 10_000 }).catch(() => undefined);
        return { status: response?.status() ?? 0, html: await page.content(), title: await page.title() };
      } catch (error) {
        throw new ScrapeError(`Could not load ${new URL(url).pathname}: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`);
      } finally {
        await page.close().catch(() => undefined);
      }
    });

  /**
   * Runs `task` on a fresh page of the shared Chrome, after the polite pause and one at a time, for a
   * scraper that has to click and listen rather than just read a page's HTML. The page is closed after.
   */
  const runPage = <T>(task: (page: Page) => Promise<T>): Promise<T> =>
    pace(async () => {
      const page = await (await open()).newPage();
      page.setDefaultTimeout(settings.pageTimeoutMs);
      try {
        return await task(page);
      } finally {
        await page.close().catch(() => undefined);
      }
    });

  async function close(): Promise<void> {
    const pending = context;
    context = null;
    if (pending) await (await pending).close().catch(() => undefined);
  }

  return { fetchPage, runPage, close };
}

/** The one Chrome the worker's scrapers share. */
const shared = createChromeFetcher();
export const fetchWithChrome: PageFetcher = shared.fetchPage;
/** Runs a task on a page of the one Chrome the worker's scrapers share. */
export const withChromePage = shared.runPage;
/** Closes the shared Chrome. The worker does it as it stops. */
export const closeBrowser = shared.close;
