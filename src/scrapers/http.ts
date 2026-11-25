// Plain JSON requests to a site's own API, one after the other with a polite pause, from a program that
// says what it is. Shared by the train sources (task.md T7.8); FlixBus has its own, older, copy.
//
// A site that answers like a wall (403, 429, a web page where data was expected) is a ScrapeBlockedError:
// the search stops there and is not tried again around it (train-sources.md, "Ground rules").
import { ScrapeBlockedError, ScrapeError, ScrapeUnavailableError } from "./errors";
import { createPoliteThrottle } from "./throttle";

/** How an adapter asks a site for JSON. Swapped for a fake in tests. */
export type Http = {
  getJson(url: string): Promise<unknown>;
  postJson(url: string, body: unknown): Promise<unknown>;
};

export type HttpOptions = {
  /** The site's name, for the messages: "Transitous" */
  source: string;
  userAgent: string;
  pauseMs: { min: number; max: number };
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

/** Who is asking: what the app is and, when there is one, how to reach its owner (Transitous asks for it). */
export const userAgentFor = (contact: string | null) => `planytrip/1.0 (personal use, low volume${contact ? `; ${contact}` : ""})`;

export function createHttp({ source, userAgent, pauseMs, timeoutMs, fetchImpl = fetch }: HttpOptions): Http {
  const pace = createPoliteThrottle({ minMs: pauseMs.min, maxMs: pauseMs.max });

  const request = (url: string, init: RequestInit) =>
    pace(async () => {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          ...init,
          headers: { accept: "application/json", "user-agent": userAgent, ...(init.headers as Record<string, string> | undefined) },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new ScrapeError(`Could not reach ${source}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      if (response.status === 401 || response.status === 403) throw new ScrapeBlockedError(`${source} turned the request away`);
      if (response.status === 429) throw new ScrapeBlockedError(`${source} asked us to slow down`);
      if (response.status >= 500) throw new ScrapeError(`${source} answered ${response.status}`);
      if (!response.ok) throw new ScrapeUnavailableError(`${source} did not accept the search (${response.status})`);

      const text = await response.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        // A page where data was expected is a verification or an "access restricted" notice
        if (/^\s*</.test(text)) throw new ScrapeBlockedError(`${source} answered with a web page instead of data: it is turning automated requests away`);
        throw new ScrapeError(`${source} answered with something that is not JSON`);
      }
    });

  return {
    getJson: (url) => request(url, { method: "GET" }),
    postJson: (url, body) => request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  };
}
