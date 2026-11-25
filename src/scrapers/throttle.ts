// A polite pace for scraping: pages are loaded one after the other, never closer than a random
// pause apart, so the rhythm is not that of a machine and the site is not hammered.

type Options = {
  minMs: number;
  maxMs: number;
  /** Swapped for a fake in tests */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs tasks one after the other. Before each one it waits until a random pause between `minMs` and
 * `maxMs` has passed since the previous one finished. The first task starts at once. A task that
 * fails does not hold up the next.
 */
export function createPoliteThrottle({ minMs, maxMs, sleep = realSleep, random = Math.random, now = Date.now }: Options) {
  let queue: Promise<unknown> = Promise.resolve();
  let lastEnd: number | null = null;

  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(async () => {
      if (lastEnd !== null) {
        const pause = minMs + random() * (maxMs - minMs);
        const wait = lastEnd + pause - now();
        if (wait > 0) await sleep(wait);
      }
      try {
        return await task();
      } finally {
        lastEnd = now();
      }
    });
    queue = result.catch(() => undefined);
    return result;
  };
}
