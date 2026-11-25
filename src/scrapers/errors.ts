// What can go wrong when a real site is scraped, and whether trying again can help. The worker
// retries a failing job a couple of times, a few seconds apart: that cures a slow page, not a site
// that has refused us or a date it does not sell yet.

/** A scrape that failed. `retryable` says whether trying again a moment later could work. */
export class ScrapeError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean = true,
  ) {
    super(message);
    this.name = "ScrapeError";
  }
}

/** The site asked for proof that we are human, or turned us away. Asking again at once only makes it worse. */
export class ScrapeBlockedError extends ScrapeError {
  constructor(message = "The site asked for a verification: it will not answer an automated browser right now") {
    super(message, false);
    this.name = "ScrapeBlockedError";
  }
}

/** The site has nothing to say for what was asked, such as dates further ahead than it sells. Not an outage. */
export class ScrapeUnavailableError extends ScrapeError {
  constructor(message: string) {
    super(message, false);
    this.name = "ScrapeUnavailableError";
  }
}

/** The page is not built the way the scraper expects: the site changed. Only a code change fixes it. */
export class ScrapeChangedError extends ScrapeError {
  constructor(message: string) {
    super(message, false);
    this.name = "ScrapeChangedError";
  }
}
